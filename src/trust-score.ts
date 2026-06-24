import { config } from './config';
import { withTimeout, fetchWithTimeout } from './lib/timeout';
import { algod } from './lib/algorand-client';
import { MICRO_ALGO, SECONDS_PER_BLOCK, SECONDS_PER_DAY, TESTNET_GENESIS_ROUND, MAX_ROUNDS_LOOKBACK, isValidWallet } from './lib/constants';
import { LRUCache } from './lib/cache';
import { logger } from './lib/logger';

const INDEXER_URL = config.indexerUrl;
const INDEXER_TOKEN = config.indexerToken;

export interface WalletTrustScore {
  wallet: string;
  trustScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approved: boolean;
  recommendedLimit: number;
  breakdown: {
    ageScore: number;
    activityScore: number;
    volumeScore: number;
    velocityScore: number;
    complianceScore: number;
  };
  onChain: {
    balanceAlgo: number;
    totalTxns: number;
    assetCount: number;
    appCount: number;
    accountAgeDays: number;
    firstSeenRound: number;
    lastSeenRound: number;
  };
  explanation: string[];
}

export function computeAgeScore(days: number): number {
  if (days <= 0) return 0;
  if (days >= 730) return 100;
  const linear = (days / 730) * 100;
  const log = (Math.log10(days + 1) / Math.log10(731)) * 100;
  return Math.round((linear * 0.6 + log * 0.4) * 10) / 10;
}

export function computeActivityScore(txns: number, days: number, assets: number): number {
  if (days <= 0) return 0;
  const txPerMonth = txns / (days / 30);
  return Math.min(100,
    Math.min(40, txPerMonth * 2) +
    Math.min(30, (days / 365) * 30) +
    Math.min(30, assets * 3)
  );
}

export function computeVolumeScore(balanceMicroAlgo: number, txns: number): number {
  const algo = balanceMicroAlgo / MICRO_ALGO;
  return Math.min(100,
    Math.min(50, Math.log10(Math.max(1, algo)) * 10) +
    Math.min(50, txns * 0.5)
  );
}

export function computeVelocityScore(txns: number, days: number): number {
  if (days === 0) return 0;
  const perDay = txns / Math.max(1, days);
  if (perDay > 100) return 0;
  if (perDay > 50) return 20;
  if (perDay > 20) return 40;
  if (perDay > 5) return 60;
  if (perDay > 1) return 80;
  return 100;
}

/**
 * Computes compliance score with continuous penalties.
 *
 * Design rationale:
 * - Binary thresholds (pass/fail) create cliff effects that are gameable
 * - Continuous penalties provide smoother graduation between risk levels
 * - Floor of 10 (not 0) because even worst wallet technically exists on-chain
 * - Credit bureau alignment: FICO doesn't score dormant files at all; we give minimal credit
 *
 * Balance penalty: Scales linearly from 0 (≥1 ALGO) to 40 (0 ALGO)
 *   - Below 1 ALGO indicates wallet may be abandoned or freshly created
 *   - Log scale would compress the low end too much; linear is more interpretable
 *
 * Transaction penalty: Scales from 50 (0 txns) to ~0 (100+ txns) using log₁₀
 *   - Log scale prevents diminishing returns from spam
 *   - 0 transactions = maximum penalty (wallet has never been used)
 *   - 100+ transactions = near-zero penalty (well-established usage)
 *
 * Worst case: 100 - 40 - 50 = 10 (floor)
 * Best case: 100 - 0 - 0 = 100
 */
export function computeComplianceScore(balanceMicroAlgo: number, txns: number): number {
  const algo = balanceMicroAlgo / MICRO_ALGO;
  // Balance: continuous penalty below 1 ALGO, max 40 points
  const balancePenalty = algo >= 1 ? 0 : Math.round((1 - algo) * 40);
  // Transactions: log-scaled penalty, 0 txns = 50, 100+ txns ≈ 0
  const txnPenalty = txns === 0 ? 50 : Math.round(Math.max(0, 50 - Math.log10(txns + 1) * 25));
  const score = 100 - balancePenalty - txnPenalty;
  return Math.max(0, Math.min(100, score));
}

export function computeTrustScore(breakdown: {
  ageScore: number;
  activityScore: number;
  volumeScore: number;
  velocityScore: number;
  complianceScore: number;
}): number {
  const w = { age: 0.2, activity: 0.25, volume: 0.2, velocity: 0.15, compliance: 0.2 };
  const total = w.age + w.activity + w.volume + w.velocity + w.compliance;

  return Math.round(Math.max(0, Math.min(100,
    (w.age / total) * breakdown.ageScore +
    (w.activity / total) * breakdown.activityScore +
    (w.volume / total) * breakdown.volumeScore +
    (w.velocity / total) * breakdown.velocityScore +
    (w.compliance / total) * breakdown.complianceScore
  )) * 10) / 10;
}

/**
 * Computes staleness multiplier based on days since last activity.
 *
 * Design rationale (credit bureau alignment):
 * - FICO requires data within last 6 months to be scorable
 * - Files without updates in 6+ months are "stale" / "dormant"
 * - Exponential decay (not linear) matches credit bureau behavior:
 *   "a 5-year-old delinquency carries much less weight than one from last month"
 *
 * Parameters:
 *   Grace period: 180 days (6 months) — no penalty
 *   Half-life: 365 days — score halves every year of inactivity
 *   Floor: 0.30 — never fully zeroed (wallet still exists on-chain)
 *
 * Examples:
 *   0 days inactive   → 1.00 (no penalty)
 *   180 days inactive → 1.00 (end of grace)
 *   545 days inactive → 0.50 (1 year past grace)
 *   910 days inactive → 0.25 (2 years past grace, capped at floor)
 */
export function computeStalenessPenalty(daysSinceLastActivity: number): number {
  const STALENESS_GRACE_DAYS = 180;
  const STALENESS_HALF_LIFE_DAYS = 365;
  const STALENESS_FLOOR = 0.30;
  if (daysSinceLastActivity <= STALENESS_GRACE_DAYS) return 1.0;
  const staleDays = daysSinceLastActivity - STALENESS_GRACE_DAYS;
  return Math.max(STALENESS_FLOOR, Math.pow(0.5, staleDays / STALENESS_HALF_LIFE_DAYS));
}

/**
 * Caps trust score for fresh wallets (< 30 days old).
 *
 * Design rationale:
 * - A brand-new wallet should not be approved based on single-transaction metrics
 * - 30-day minimum aligns with standard KYC/account maturation periods
 * - Cap of 30 ensures fresh wallets stay in "critical" risk tier (below 45 medium threshold)
 * - Prevents the attack: create wallet → fund → single txn → approved
 *
 * The cap only applies to wallets younger than 30 days.
 * At exactly 30 days, no cap is applied.
 */
export function applyFreshWalletCap(trustScore: number, accountAgeDays: number): number {
  const FRESH_WALLET_THRESHOLD_DAYS = 30;
  const FRESH_WALLET_MAX_SCORE = 30;
  if (accountAgeDays < FRESH_WALLET_THRESHOLD_DAYS) {
    return Math.min(trustScore, FRESH_WALLET_MAX_SCORE);
  }
  return trustScore;
}

/**
 * Applies sybil risk penalty to trust score.
 *
 * Design rationale:
 * - Sybil clusters indicate coordinated inauthentic behavior
 * - Penalty scales with severity: low risk → no penalty, high risk → 50% reduction
 * - Applied in underwriting layer (not base trust score) because sybil detection
 *   requires cluster analysis that isn't available in single-wallet scoring
 * - Thresholds align with classifySybilRisk boundaries
 *
 * Tiers:
 *   sybilRisk < 0.25 (low)      → no penalty
 *   sybilRisk < 0.45 (medium)   → no penalty (monitoring threshold)
 *   sybilRisk < 0.70 (high)     → 20% reduction
 *   sybilRisk >= 0.70 (critical) → 50% reduction
 */
export function applySybilPenalty(trustScore: number, sybilRisk: number): number {
  if (sybilRisk < 0.45) return trustScore;
  if (sybilRisk < 0.70) return Math.round(trustScore * 0.8 * 10) / 10;
  return Math.round(trustScore * 0.5 * 10) / 10;
}

export function classifyRisk(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 70) return 'low';
  if (score >= 45) return 'medium';
  if (score >= 20) return 'high';
  return 'critical';
}

export function computeRecommendedLimit(score: number): number {
  const base = (score / 100) * 500;
  const tier = score >= 80 ? 1.5 : score >= 60 ? 1.2 : score >= 40 ? 1.0 : 0.7;
  return Math.round(base * tier * 100) / 100;
}

export function generateExplanation(
  onChain: { balanceAlgo: number; totalTxns: number; assetCount: number; accountAgeDays: number },
  trustScore: number
): string[] {
  const reasons: string[] = [];
  const { balanceAlgo, totalTxns, assetCount, accountAgeDays } = onChain;

  if (accountAgeDays > 365) reasons.push(`${Math.floor(accountAgeDays / 365)}+ year wallet history`);
  else if (accountAgeDays > 30) reasons.push(`${Math.floor(accountAgeDays / 30)}-month wallet history`);
  else reasons.push('New wallet with limited history');

  if (totalTxns > 100) reasons.push(`${totalTxns} transactions — active wallet`);
  else if (totalTxns > 10) reasons.push(`${totalTxns} transactions — moderate activity`);
  else reasons.push(`${totalTxns} transactions — limited activity`);

  if (balanceAlgo > 100) reasons.push(`Balance: ${balanceAlgo.toFixed(2)} ALGO — well-funded`);
  else if (balanceAlgo > 1) reasons.push(`Balance: ${balanceAlgo.toFixed(4)} ALGO`);
  else reasons.push(`Balance: ${balanceAlgo.toFixed(6)} ALGO — low balance`);

  if (assetCount > 5) reasons.push(`${assetCount} assets — diverse portfolio`);

  if (trustScore >= 70) reasons.push('Strong overall trust profile');
  else if (trustScore >= 40) reasons.push('Moderate trust profile');
  else reasons.push('Weak trust profile — additional verification recommended');

  return reasons;
}

type AccountInfo = {
  amount: number;
  assetCount: number;
  appCount: number;
  createdRound: number;
  lastRound: number;
};

const accountInfoCache = new LRUCache<AccountInfo>(200, 60_000);

const INDEXER_PAGE_SIZE = 2000;
const MAX_TRANSACTION_PAGES = 10; // P1 FIX: Cap at 20K transactions to prevent memory exhaustion

async function fetchAccountInfo(wallet: string, fresh: boolean = false): Promise<AccountInfo | null> {
  if (!fresh) {
    const cached = accountInfoCache.get(wallet);
    if (cached) return cached;
  }

  try {
    // P0 FIX: Only fetch algod.status() when not cached, or use cached lastRound
    const info = await withTimeout(algod.accountInformation(wallet).do(), 10_000, 'accountInformation');
    const data = info as any;

    // Fetch current round — reuse if available from cache, otherwise fetch fresh
    let lastRound: number;
    if (!fresh) {
      // For non-fresh requests, try to get round from a lightweight status call
      const status = await withTimeout(algod.status().do(), 10_000, 'algod.status');
      lastRound = Number((status as any)['last-round'] || 0);
    } else {
      const status = await withTimeout(algod.status().do(), 10_000, 'algod.status');
      lastRound = Number((status as any)['last-round'] || 0);
    }

    const result: AccountInfo = {
      amount: Number(data.amount || 0),
      assetCount: (data.assets || []).length,
      appCount: (data['created-apps'] || []).length,
      createdRound: data['created-at-round'] || 0,
      lastRound,
    };
    if (!fresh) accountInfoCache.set(wallet, result);
    return result;
  } catch (e) {
    logger.warn('fetchAccountInfo failed', { wallet, error: String(e) });
    return null;
  }
}

async function fetchTransactionHistory(wallet: string, fresh: boolean = false): Promise<{
  totalTxns: number;
  firstRound: number;
  lastRound: number;
}> {
  try {
    let allTxns: any[] = [];
    let nextToken: string | undefined;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_TRANSACTION_PAGES) {
      const url = new URL(`${INDEXER_URL}/v2/accounts/${wallet}/transactions`);
      url.searchParams.set('limit', String(INDEXER_PAGE_SIZE));
      if (nextToken) url.searchParams.set('next', nextToken);

      const res = await fetchWithTimeout(url.toString(), { timeoutMs: 10_000 });
      if (!res.ok) break;

      const data = await res.json() as any;
      const txns = data.transactions || [];
      allTxns = allTxns.concat(txns);

      nextToken = data['next-token'];
      hasMore = nextToken !== undefined && nextToken !== null && txns.length === INDEXER_PAGE_SIZE;
      pages++;
    }

    if (pages >= MAX_TRANSACTION_PAGES && hasMore) {
      logger.warn('Transaction history hit page limit', { wallet, pages, totalTxns: allTxns.length });
    }

    let first = Infinity;
    let last = 0;
    for (const t of allTxns) {
      const round = t['confirmed-round'] || 0;
      if (round > 0) {
        first = Math.min(first, round);
        last = Math.max(last, round);
      }
    }
    return {
      totalTxns: allTxns.length,
      firstRound: first === Infinity ? 0 : first,
      lastRound: last,
    };
  } catch (e) {
    logger.warn('fetchTransactionHistory failed', { wallet, error: String(e) });
    return { totalTxns: 0, firstRound: 0, lastRound: 0 };
  }
}

/**
 * Scores a wallet's trust using cached data (for API endpoints).
 */
export async function scoreWallet(wallet: string): Promise<WalletTrustScore | null> {
  return scoreWalletInternal(wallet, false);
}

/**
 * Scores a wallet's trust using fresh data (for passport generation).
 * Bypasses all LRU caches to guarantee data freshness.
 */
export async function scoreWalletFresh(wallet: string): Promise<WalletTrustScore | null> {
  return scoreWalletInternal(wallet, true);
}

async function scoreWalletInternal(wallet: string, fresh: boolean): Promise<WalletTrustScore | null> {
  if (!isValidWallet(wallet)) return null;

  const [accountInfo, txHistory] = await Promise.all([
    fetchAccountInfo(wallet, fresh),
    fetchTransactionHistory(wallet, fresh),
  ]);

  const latestRound = accountInfo?.lastRound || TESTNET_GENESIS_ROUND;
  const createdRound = accountInfo?.createdRound || txHistory.firstRound || latestRound - MAX_ROUNDS_LOOKBACK;
  const accountAgeDays = Math.max(1, Math.floor(((latestRound - createdRound) * SECONDS_PER_BLOCK) / SECONDS_PER_DAY));

  const balanceAlgo = (accountInfo?.amount || 0) / MICRO_ALGO;

  const onChain = {
    balanceAlgo,
    totalTxns: txHistory.totalTxns,
    assetCount: accountInfo?.assetCount || 0,
    appCount: accountInfo?.appCount || 0,
    accountAgeDays,
    firstSeenRound: txHistory.firstRound,
    lastSeenRound: txHistory.lastRound,
  };

  const breakdown = {
    ageScore: computeAgeScore(accountAgeDays),
    activityScore: computeActivityScore(txHistory.totalTxns, accountAgeDays, onChain.assetCount),
    volumeScore: computeVolumeScore(accountInfo?.amount || 0, txHistory.totalTxns),
    velocityScore: computeVelocityScore(txHistory.totalTxns, accountAgeDays),
    complianceScore: computeComplianceScore(accountInfo?.amount || 0, txHistory.totalTxns),
  };

  const trustScore = computeTrustScore(breakdown);

  // Apply staleness decay: old wallets without recent activity lose trust
  const daysSinceLastActivity = txHistory.lastRound > 0
    ? Math.max(0, Math.floor(((latestRound - txHistory.lastRound) * SECONDS_PER_BLOCK) / SECONDS_PER_DAY))
    : accountAgeDays;
  const stalenessMultiplier = computeStalenessPenalty(daysSinceLastActivity);
  const stalenessAdjusted = Math.round(trustScore * stalenessMultiplier * 10) / 10;

  // Apply fresh wallet cap: new wallets cannot achieve high trust
  const adjustedTrustScore = applyFreshWalletCap(stalenessAdjusted, accountAgeDays);

  const riskLevel = classifyRisk(adjustedTrustScore);
  const recommendedLimit = computeRecommendedLimit(adjustedTrustScore);
  const explanation = generateExplanation(onChain, adjustedTrustScore);

  return {
    wallet,
    trustScore: adjustedTrustScore,
    riskLevel,
    approved: adjustedTrustScore >= 40,
    recommendedLimit,
    breakdown,
    onChain,
    explanation,
  };
}

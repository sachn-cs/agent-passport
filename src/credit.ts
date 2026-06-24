import { scoreWallet, type WalletTrustScore } from './trust-score';
import { isValidWallet } from './lib/constants';

export interface CreditEstimate {
  wallet: string;
  estimatedLimit: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  approved: boolean;
  breakdown: {
    balanceCapacity: number;
    activityBonus: number;
    ageBonus: number;
    riskPenalty: number;
  };
  explanation: string[];
}

// ── Pure math functions (exported for testing) ─────────────────

export function computeBalanceCapacity(balanceAlgo: number): number {
  return Math.min(1000, Math.max(0, balanceAlgo * 0.5));
}

export function computeActivityBonus(totalTxns: number): number {
  return Math.min(200, Math.max(0, totalTxns * 2));
}

export function computeAgeBonus(accountAgeDays: number): number {
  return Math.min(150, Math.max(0, (accountAgeDays / 365) * 150));
}

/**
 * Computes risk penalty for low velocity and compliance scores.
 *
 * Design rationale:
 * - Binary thresholds (pass/fail) create cliff effects at arbitrary boundaries
 * - Continuous penalties provide smoother graduation between risk levels
 * - Velocity penalty (0-50): penalizes bot/spam behavior, scales with severity
 * - Compliance penalty (0-100): penalizes low balance/zero txns, scales with severity
 * - Velocity < 40 = bot-like behavior → up to $50 penalty
 * - Compliance < 60 = low usage/abandoned → up to $100 penalty
 *
 * Examples:
 *   velocity=39, compliance=90 → (40-39)/40*50 = $1.25
 *   velocity=20, compliance=40 → (40-20)/40*50 + (60-20)/60*100 = $25+$67 = $92
 *   velocity=0,  compliance=0  → 50 + 100 = $150 (max penalty)
 */
export function computeRiskPenalty(velocityScore: number, complianceScore: number): number {
  const velocityPenalty = velocityScore < 40
    ? Math.round((40 - velocityScore) / 40 * 50 * 100) / 100
    : 0;
  const compliancePenalty = complianceScore < 60
    ? Math.round((60 - complianceScore) / 60 * 100 * 100) / 100
    : 0;
  return Math.round((velocityPenalty + compliancePenalty) * 100) / 100;
}

/**
 * Computes credit limit from on-chain capacity components only.
 *
 * Design rationale (post-audit):
 * - Delegation is a trust endorsement, not collateral — removed from capacity formula
 * - Credit capacity must be backed by the wallet's own on-chain activity
 * - Max capacity = 1000 (balance) + 200 (activity) + 150 (age) = 1350
 * - This prevents double-counting: delegation score is used ONLY in underwriting
 *   as a quality multiplier on the credit limit, not as a capacity component
 *
 * Formula: max(0, min(1350, balanceCapacity + activityBonus + ageBonus - riskPenalty))
 */
export function computeCreditLimit(breakdown: {
  balanceCapacity: number;
  activityBonus: number;
  ageBonus: number;
  riskPenalty: number;
}): number {
  const raw = breakdown.balanceCapacity + breakdown.activityBonus +
    breakdown.ageBonus - breakdown.riskPenalty;
  return Math.round(Math.max(0, Math.min(1350, raw)) * 100) / 100;
}

export function classifyCreditRisk(
  limit: number,
  requestedAmount?: number
): 'low' | 'medium' | 'high' | 'critical' {
  if (requestedAmount && requestedAmount > 0) {
    const ratio = limit / requestedAmount;
    if (ratio >= 2.0) return 'low';
    if (ratio >= 1.2) return 'medium';
    if (ratio >= 0.8) return 'high';
    return 'critical';
  }

  if (limit >= 500) return 'low';
  if (limit >= 200) return 'medium';
  if (limit >= 50) return 'high';
  return 'critical';
}

export function computeCreditConfidence(dataPoints: number): number {
  return Math.round(Math.max(0.40, Math.min(0.95, 0.40 + dataPoints * 0.12)) * 100) / 100;
}

export function generateCreditExplanation(
  balanceAlgo: number,
  totalTxns: number,
  accountAgeDays: number,
  estimatedLimit: number,
  requestedAmount?: number,
  approved?: boolean
): string[] {
  const reasons: string[] = [];

  if (balanceAlgo > 100) {
    reasons.push(`Balance: ${balanceAlgo.toFixed(2)} ALGO — strong collateral base`);
  } else if (balanceAlgo > 1) {
    reasons.push(`Balance: ${balanceAlgo.toFixed(4)} ALGO — moderate collateral`);
  } else {
    reasons.push(`Balance: ${balanceAlgo.toFixed(6)} ALGO — minimal collateral`);
  }

  if (accountAgeDays > 365) {
    reasons.push(`${Math.floor(accountAgeDays / 365)}+ year account history`);
  } else if (accountAgeDays > 30) {
    reasons.push(`${Math.floor(accountAgeDays / 30)}-month account history`);
  } else {
    reasons.push('New account with limited history');
  }

  if (totalTxns > 100) {
    reasons.push(`${totalTxns} transactions — strong activity proof`);
  } else if (totalTxns > 10) {
    reasons.push(`${totalTxns} transactions — moderate activity`);
  } else {
    reasons.push(`${totalTxns} transactions — limited activity`);
  }

  if (requestedAmount && approved !== undefined) {
    if (approved) {
      reasons.push(`Request ($${requestedAmount}) within estimated capacity of $${estimatedLimit.toFixed(2)}`);
    } else {
      reasons.push(`Request ($${requestedAmount}) exceeds estimated capacity of $${estimatedLimit.toFixed(2)}`);
    }
  }

  return reasons;
}

// ── Main function ──────────────────────────────────────────────

export async function estimateCredit(
  wallet: string,
  requestedAmount?: number
): Promise<CreditEstimate | null> {
  if (!isValidWallet(wallet)) return null;

  const onChainResult = await scoreWallet(wallet);

  const balanceAlgo = onChainResult?.onChain.balanceAlgo ?? 0;
  const totalTxns = onChainResult?.onChain.totalTxns ?? 0;
  const accountAgeDays = onChainResult?.onChain.accountAgeDays ?? 0;
  const velocityScore = onChainResult?.breakdown.velocityScore ?? 50;
  const complianceScore = onChainResult?.breakdown.complianceScore ?? 50;

  const breakdown = {
    balanceCapacity: computeBalanceCapacity(balanceAlgo),
    activityBonus: computeActivityBonus(totalTxns),
    ageBonus: computeAgeBonus(accountAgeDays),
    riskPenalty: computeRiskPenalty(velocityScore, complianceScore),
  };

  const estimatedLimit = computeCreditLimit(breakdown);
  const risk = classifyCreditRisk(estimatedLimit, requestedAmount);
  const approved = requestedAmount && requestedAmount > 0
    ? estimatedLimit >= requestedAmount
    : true;

  // Count data points for confidence
  let dataPoints = 0;
  if (balanceAlgo > 1) dataPoints++;
  if (totalTxns > 10) dataPoints++;
  if (accountAgeDays > 30) dataPoints++;
  if (complianceScore >= 80) dataPoints++;
  const confidence = computeCreditConfidence(dataPoints);

  const explanation = generateCreditExplanation(
    balanceAlgo, totalTxns, accountAgeDays,
    estimatedLimit, requestedAmount, approved
  );

  return {
    wallet,
    estimatedLimit,
    risk,
    confidence,
    approved,
    breakdown,
    explanation,
  };
}

/**
 * Estimates credit using pre-fetched trust data (for passport generation).
 * Eliminates the redundant scoreWallet() call that estimateCredit() makes internally.
 *
 * This ensures the trust score used for identityStrength and the trust score used
 * for credit limit are identical — preventing contradictory passports.
 */
export async function estimateCreditWithTrust(
  wallet: string,
  trustData: WalletTrustScore | null,
  requestedAmount?: number
): Promise<CreditEstimate | null> {
  if (!isValidWallet(wallet)) return null;

  const balanceAlgo = trustData?.onChain.balanceAlgo ?? 0;
  const totalTxns = trustData?.onChain.totalTxns ?? 0;
  const accountAgeDays = trustData?.onChain.accountAgeDays ?? 0;
  const velocityScore = trustData?.breakdown.velocityScore ?? 50;
  const complianceScore = trustData?.breakdown.complianceScore ?? 50;

  const breakdown = {
    balanceCapacity: computeBalanceCapacity(balanceAlgo),
    activityBonus: computeActivityBonus(totalTxns),
    ageBonus: computeAgeBonus(accountAgeDays),
    riskPenalty: computeRiskPenalty(velocityScore, complianceScore),
  };

  const estimatedLimit = computeCreditLimit(breakdown);
  const risk = classifyCreditRisk(estimatedLimit, requestedAmount);
  const approved = requestedAmount && requestedAmount > 0
    ? estimatedLimit >= requestedAmount
    : true;

  let dataPoints = 0;
  if (balanceAlgo > 1) dataPoints++;
  if (totalTxns > 10) dataPoints++;
  if (accountAgeDays > 30) dataPoints++;
  if (complianceScore >= 80) dataPoints++;
  const confidence = computeCreditConfidence(dataPoints);

  const explanation = generateCreditExplanation(
    balanceAlgo, totalTxns, accountAgeDays,
    estimatedLimit, requestedAmount, approved
  );

  return {
    wallet,
    estimatedLimit,
    risk,
    confidence,
    approved,
    breakdown,
    explanation,
  };
}

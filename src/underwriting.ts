import { scoreWallet, scoreWalletFresh, applySybilPenalty } from './trust-score';
import { scoreDelegationFresh } from './delegation';
import { estimateCreditWithTrust } from './credit';
import { detectSybil, detectSybilFresh } from './sybil';
import { computeReputation } from './reputation';
import { logger } from './lib/logger';
import { isValidWallet } from './lib/constants';
import {
  MAX_SYSTEM_EXPOSURE,
  getSystemExposure,
  addSystemExposure,
  resetSystemExposure,
  capToSystemCapacity,
} from './lib/system-exposure';

// Re-export for backward compatibility
export { MAX_SYSTEM_EXPOSURE, getSystemExposure, addSystemExposure, resetSystemExposure, capToSystemCapacity };

export interface UnderwritingFactor {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  status: 'positive' | 'neutral' | 'negative';
}

export interface UnderwritingDecision {
  wallet: string;
  approved: boolean;
  recommendedLimit: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  compositeScore: number;
  factors: UnderwritingFactor[];
  explanation: string[];
}

// ── Pure math functions (exported for testing) ─────────────────

export function computeCompositeScore(factors: UnderwritingFactor[]): number {
  if (factors.length === 0) return 0;
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  return Math.round(Math.max(0, Math.min(100, weightedSum / totalWeight)) * 10) / 10;
}

export function classifyUnderwritingRisk(
  score: number
): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 70) return 'low';
  if (score >= 45) return 'medium';
  if (score >= 20) return 'high';
  return 'critical';
}

/**
 * Computes recommended limit from credit capacity + quality multipliers.
 *
 * Design rationale (post-audit):
 * - creditLimit is the base (backed by on-chain collateral)
 * - compositeScore multiplier scales quality: better wallets get more of their capacity
 * - sybilMultiplier penalizes coordinated inauthentic behavior
 * - reputationMultiplier rewards positive on-chain reputation
 * - NO delegation double-count: delegation appears ONLY in compositeScore
 * - NO self-reference: creditLimit does NOT feed back into compositeScore
 * - Formula is O(creditLimit), not O(creditLimit²)
 *
 * Bounds:
 * - scoreMultiplier ∈ [0.5, 1.5]
 * - sybilMultiplier ∈ [0.3, 1.0]
 * - reputationMultiplier ∈ [1.0, 1.3]
 * - Max recommendedLimit = creditLimit × 1.5 × 1.0 × 1.3 = 1.95 × creditLimit
 */
export function computeUnderwritingLimit(
  compositeScore: number,
  creditLimit: number,
  sybilRisk: number,
  reputation: number
): number {
  let limit = creditLimit;

  // Apply composite score multiplier (0.5 – 1.5)
  const scoreMultiplier = 0.5 + (compositeScore / 100) * 1.0;
  limit *= scoreMultiplier;

  // Apply sybil penalty (0.3 – 1.0)
  const sybilMultiplier = 1.0 - (sybilRisk * 0.7);
  limit *= sybilMultiplier;

  // Apply reputation bonus (1.0 – 1.3)
  const reputationMultiplier = 1.0 + (reputation / 100) * 0.3;
  limit *= reputationMultiplier;

  return Math.round(Math.max(0, Math.min(1350, limit)) * 100) / 100;
}

export function decideApproval(
  compositeScore: number,
  sybilRisk: number,
  reputation: number
): boolean {
  // Deny if sybil risk is critical
  if (sybilRisk >= 0.70) return false;
  // Deny if composite score is too low
  if (compositeScore < 30) return false;
  // Deny if reputation is critical with low score
  if (reputation < 10 && compositeScore < 50) return false;
  return true;
}

export function computeUnderwritingConfidence(
  factors: UnderwritingFactor[]
): number {
  // Confidence based on how many factors have data (non-zero score)
  const factorsWithData = factors.filter(f => f.score > 0).length;
  const totalFactors = factors.length;
  if (totalFactors === 0) return 0.40;
  const coverage = factorsWithData / totalFactors;
  return Math.round(Math.max(0.40, Math.min(0.95, 0.40 + coverage * 0.55)) * 100) / 100;
}

export function generateUnderwritingExplanation(
  factors: UnderwritingFactor[],
  approved: boolean,
  compositeScore: number,
  recommendedLimit: number
): string[] {
  const reasons: string[] = [];

  if (approved) {
    reasons.push(`Approved with composite score ${compositeScore}`);
  } else {
    reasons.push(`Denied — composite score ${compositeScore} below threshold`);
  }

  reasons.push(`Recommended limit: $${recommendedLimit.toFixed(2)}`);

  const positiveFactors = factors.filter(f => f.status === 'positive');
  const negativeFactors = factors.filter(f => f.status === 'negative');

  if (positiveFactors.length > 0) {
    reasons.push(`Strong signals: ${positiveFactors.map(f => f.name).join(', ')}`);
  }
  if (negativeFactors.length > 0) {
    reasons.push(`Weak signals: ${negativeFactors.map(f => f.name).join(', ')}`);
  }

  const criticalFactors = factors.filter(f => f.score < 20);
  if (criticalFactors.length > 0) {
    reasons.push(`Critical concerns: ${criticalFactors.map(f => f.name).join(', ')}`);
  }

  return reasons;
}

// ── Main function ──────────────────────────────────────────────

/**
 * Underwrites a wallet for credit.
 *
 * Factor architecture (post-audit, no double-counting):
 *   Trust Score (0.35)    — on-chain quality, includes activity/age/volume/velocity/compliance
 *   Delegation (0.25)     — endorsement network quality
 *   Sybil Resistance (0.20) — resistance to coordinated fake accounts
 *   Reputation (0.20)     — on-chain event reputation
 *
 * Each factor represents an independent signal:
 * - Trust Score: wallet's own on-chain behavior
 * - Delegation: external endorsements from other wallets
 * - Sybil Resistance: cluster analysis of related wallets
 * - Reputation: event-based track record
 *
 * Credit capacity (creditLimit) is used ONLY as the base in computeUnderwritingLimit.
 * It does NOT appear in compositeScore, preventing self-referential O(creditLimit²).
 */
export async function underwrite(
  wallet: string
): Promise<UnderwritingDecision | null> {
  if (!isValidWallet(wallet)) return null;

  // P1 FIX: Fetch trust data first (needed for credit estimation), then fetch others in parallel
  const trustResult = await scoreWalletFresh(wallet)
    .catch(e => { logger.warn('scoreWalletFresh failed', { wallet, error: String(e) }); return null; });

  // Fetch remaining services in parallel using fresh data
  const [delegationResult, creditResult, sybilResult, reputationResult] =
    await Promise.all([
      scoreDelegationFresh(wallet).catch(e => { logger.warn('scoreDelegationFresh failed', { wallet, error: String(e) }); return null; }),
      // P1 FIX: Use estimateCreditWithTrust to prevent redundant fetch and ensure consistency
      estimateCreditWithTrust(wallet, trustResult).catch(e => { logger.warn('estimateCreditWithTrust failed', { wallet, error: String(e) }); return null; }),
      detectSybilFresh(wallet).catch(e => { logger.warn('detectSybilFresh failed', { wallet, error: String(e) }); return null; }),
      computeReputation(wallet).catch(e => { logger.warn('computeReputation failed', { wallet, error: String(e) }); return null; }),
    ]);

  // Build factors — each independent, no double-counting
  const factors: UnderwritingFactor[] = [];

  // Factor 1: Trust Score (weight: 0.35)
  // Apply sybil penalty: high sybil risk reduces trust contribution
  const rawTrustScore = trustResult?.trustScore ?? 0;
  const sybilRiskValue = sybilResult?.sybilRisk ?? 0;
  const trustScore = applySybilPenalty(rawTrustScore, sybilRiskValue);
  factors.push({
    name: 'Trust Score',
    score: trustScore,
    weight: 0.35,
    contribution: trustScore * 0.35,
    status: trustScore >= 70 ? 'positive' : trustScore >= 40 ? 'neutral' : 'negative',
  });

  // Factor 2: Delegation (weight: 0.25)
  // NOT in credit formula — only here as quality multiplier
  const delegationScore = delegationResult?.trustScore ?? 0;
  factors.push({
    name: 'Delegation Trust',
    score: delegationScore,
    weight: 0.25,
    contribution: delegationScore * 0.25,
    status: delegationScore >= 70 ? 'positive' : delegationScore >= 40 ? 'neutral' : 'negative',
  });

  // Factor 3: Sybil Resistance (weight: 0.20) — inverted (low sybil = high score)
  const sybilScore = sybilResult ? (1 - sybilResult.sybilRisk) * 100 : 50;
  factors.push({
    name: 'Sybil Resistance',
    score: sybilScore,
    weight: 0.20,
    contribution: sybilScore * 0.20,
    status: sybilScore >= 70 ? 'positive' : sybilScore >= 40 ? 'neutral' : 'negative',
  });

  // Factor 4: Reputation (weight: 0.20)
  const reputationScore = reputationResult?.reputation ?? 0;
  factors.push({
    name: 'Reputation',
    score: reputationScore,
    weight: 0.20,
    contribution: reputationScore * 0.20,
    status: reputationScore >= 70 ? 'positive' : reputationScore >= 40 ? 'neutral' : 'negative',
  });

  // Compute composite score (no self-reference — creditLimit NOT included)
  const compositeScore = computeCompositeScore(factors);

  // Decision
  const sybilRisk = sybilResult?.sybilRisk ?? 0;
  const reputation = reputationResult?.reputation ?? 0;
  const approved = decideApproval(compositeScore, sybilRisk, reputation);
  const riskLevel = classifyUnderwritingRisk(compositeScore);

  // Recommended limit (creditLimit as base, NOT in compositeScore)
  let creditLimit = creditResult?.estimatedLimit ?? 0;
  let recommendedLimit = approved
    ? computeUnderwritingLimit(compositeScore, creditLimit, sybilRisk, reputation)
    : 0;

  // System capacity guard: cap to remaining system exposure
  recommendedLimit = capToSystemCapacity(recommendedLimit);

  // Track system exposure
  if (recommendedLimit > 0) {
    addSystemExposure(recommendedLimit);
  }

  // Confidence
  const confidence = computeUnderwritingConfidence(factors);

  // Explanation
  const explanation = generateUnderwritingExplanation(
    factors, approved, compositeScore, recommendedLimit
  );

  return {
    wallet,
    approved,
    recommendedLimit,
    riskLevel,
    confidence,
    compositeScore,
    factors,
    explanation,
  };
}

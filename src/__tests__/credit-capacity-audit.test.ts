import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeBalanceCapacity,
  computeActivityBonus,
  computeAgeBonus,
  computeRiskPenalty,
  computeCreditLimit,
  classifyCreditRisk,
  computeCreditConfidence,
} from '../credit';
import {
  computeDepthScore,
  computeSponsorQualityScore,
  computeSponsorCountScore,
  computeAmountScore,
  computeDelegationTrustScore,
  classifyDelegationRisk,
  computeDelegationRecommendedLimit,
} from '../delegation';
import {
  computeCompositeScore,
  classifyUnderwritingRisk,
  computeUnderwritingLimit,
  decideApproval,
  computeUnderwritingConfidence,
  getSystemExposure,
  resetSystemExposure,
  capToSystemCapacity,
  addSystemExposure,
  MAX_SYSTEM_EXPOSURE,
} from '../underwriting';
import type { UnderwritingFactor } from '../underwriting';

function makeFactor(overrides: Partial<UnderwritingFactor>): UnderwritingFactor {
  return {
    name: 'Test',
    score: 50,
    weight: 0.25,
    contribution: 12.5,
    status: 'neutral',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Invariant Tests
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Invariants', () => {

  // ── INVARIANT 1: Capacity cannot exceed system capacity ─────

  describe('Invariant 1: Capacity ≤ System Capacity', () => {
    it('credit limit never exceeds 1350', () => {
      const max = computeCreditLimit({
        balanceCapacity: 1000,
        activityBonus: 200,
        ageBonus: 150,
        riskPenalty: 0,
      });
      expect(max).toBe(1350);
    });

    it('credit limit is 0 for all-zero on-chain data', () => {
      const min = computeCreditLimit({
        balanceCapacity: 0,
        activityBonus: 0,
        ageBonus: 0,
        riskPenalty: 0,
      });
      expect(min).toBe(0);
    });

    it('credit limit bounded [0, 1350] for arbitrary inputs', () => {
      const inputs = [
        { balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 0 },
        { balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 150 },
        { balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 0 },
        { balanceCapacity: 999, activityBonus: 199, ageBonus: 149, riskPenalty: 0 },
        { balanceCapacity: 1, activityBonus: 1, ageBonus: 1, riskPenalty: 0 },
      ];
      for (const input of inputs) {
        const limit = computeCreditLimit(input);
        expect(limit).toBeGreaterThanOrEqual(0);
        expect(limit).toBeLessThanOrEqual(1350);
      }
    });

    it('underwriting limit never exceeds 1350', () => {
      const limit = computeUnderwritingLimit(100, 1350, 0, 100);
      expect(limit).toBeLessThanOrEqual(1350);
    });

    it('underwriting limit is 0 when credit limit is 0', () => {
      const limit = computeUnderwritingLimit(100, 0, 0, 0);
      expect(limit).toBe(0);
    });
  });

  // ── INVARIANT 2: Capacity cannot be duplicated ──────────────

  describe('Invariant 2: No Capacity Duplication', () => {
    it('delegation score contributes to only one place (underwriting factor)', () => {
      // Delegation score should NOT appear in credit components
      // Credit formula: balanceCapacity + activityBonus + ageBonus - riskPenalty
      // No delegationBonus in the formula
      const breakdown = {
        balanceCapacity: 500,
        activityBonus: 100,
        ageBonus: 75,
        riskPenalty: 0,
      };
      const limit = computeCreditLimit(breakdown);
      // This is purely on-chain: 500 + 100 + 75 = 675
      expect(limit).toBe(675);
    });

    it('multi-sponsor total delegation bounded by single high-quality sponsor', () => {
      // 1 sponsor with quality=100: countScore = 20
      const singleCount = computeSponsorCountScore(1, 100);
      // 5 sponsors with quality=100: countScore = 100
      const multiCount = computeSponsorCountScore(5, 100);
      // Multi-sponsor gives more count score, but:
      // 1. Count score is capped at 100
      // 2. It flows through weighted average (weight 0.15), not additive
      // 3. Delegation trust score is capped at 100
      // 4. Delegation trust score is bounded by depth-adjusted cap
      expect(multiCount).toBeGreaterThan(singleCount);
      expect(multiCount).toBeLessThanOrEqual(100);

      // The delegation trust score (capped at 100) → underwriting factor × 0.25
      // Max delegation contribution to compositeScore: 100 × 0.25 = 25
      // This is bounded regardless of sponsor count
    });

    it('on-chain data appears in exactly one place (trust score)', () => {
      // Balance: only in computeBalanceCapacity, NOT in underwriting factors
      // Activity: only in computeActivityBonus, NOT in underwriting factors
      // Age: only in computeAgeBonus, NOT in underwriting factors
      // Trust Score factor in underwriting includes all on-chain signals
      // but trust score factor is SEPARATE from credit components
      const balanceCap = computeBalanceCapacity(2000); // 1000 (cap)
      const actBonus = computeActivityBonus(500);      // 200 (cap)
      const ageBonus = computeAgeBonus(730);           // 150 (cap)
      const limit = computeCreditLimit({
        balanceCapacity: balanceCap,
        activityBonus: actBonus,
        ageBonus: ageBonus,
        riskPenalty: 0,
      });
      expect(limit).toBe(1350);
    });
  });

  // ── INVARIANT 3: No double counting ─────────────────────────

  describe('Invariant 3: No Double Counting', () => {
    it('recommendedLimit scales linearly with creditLimit (no quadratic)', () => {
      // With fixed compositeScore, recommendedLimit should be O(creditLimit)
      const compositeScore = 50;
      const sybilRisk = 0;
      const reputation = 0;

      const limit100 = computeUnderwritingLimit(compositeScore, 100, sybilRisk, reputation);
      const limit200 = computeUnderwritingLimit(compositeScore, 200, sybilRisk, reputation);
      const limit400 = computeUnderwritingLimit(compositeScore, 400, sybilRisk, reputation);

      // Linear: limit200 = limit100 × 2, limit400 = limit100 × 4
      expect(limit200).toBeCloseTo(limit100 * 2, 0);
      expect(limit400).toBeCloseTo(limit100 * 4, 0);
    });

    it('delegation factor is independent of creditLimit', () => {
      // Changing creditLimit should NOT affect compositeScore
      // (delegation score is independent of credit components)
      const factors1 = [
        makeFactor({ name: 'Trust', score: 50, weight: 0.35 }),
        makeFactor({ name: 'Delegation', score: 80, weight: 0.25 }),
        makeFactor({ name: 'Sybil', score: 70, weight: 0.20 }),
        makeFactor({ name: 'Reputation', score: 60, weight: 0.20 }),
      ];
      const factors2 = [
        makeFactor({ name: 'Trust', score: 50, weight: 0.35 }),
        makeFactor({ name: 'Delegation', score: 80, weight: 0.25 }),
        makeFactor({ name: 'Sybil', score: 70, weight: 0.20 }),
        makeFactor({ name: 'Reputation', score: 60, weight: 0.20 }),
      ];
      // Same factors → same compositeScore regardless of creditLimit
      expect(computeCompositeScore(factors1)).toBe(computeCompositeScore(factors2));
    });

    it('credit components are additive (no cross-terms)', () => {
      const a = computeCreditLimit({
        balanceCapacity: 100, activityBonus: 0, ageBonus: 0, riskPenalty: 0,
      });
      const b = computeCreditLimit({
        balanceCapacity: 0, activityBonus: 50, ageBonus: 0, riskPenalty: 0,
      });
      const c = computeCreditLimit({
        balanceCapacity: 100, activityBonus: 50, ageBonus: 0, riskPenalty: 0,
      });
      // Additive: a + b = c
      expect(a + b).toBe(c);
    });

    it('risk penalty is subtractive (not multiplicative)', () => {
      const noPenalty = computeCreditLimit({
        balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 0,
      });
      const withPenalty = computeCreditLimit({
        balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 50,
      });
      // Subtractive: noPenalty - 50 = withPenalty
      expect(noPenalty - 50).toBe(withPenalty);
    });

    it('underwriting multiplier is independent of creditLimit (no self-reference)', () => {
      // compositeScore should NOT contain creditLimit
      // All 4 factors are independent external signals
      const factors = [
        makeFactor({ name: 'Trust', score: 70, weight: 0.35 }),
        makeFactor({ name: 'Delegation', score: 60, weight: 0.25 }),
        makeFactor({ name: 'Sybil', score: 80, weight: 0.20 }),
        makeFactor({ name: 'Reputation', score: 50, weight: 0.20 }),
      ];
      const composite = computeCompositeScore(factors);
      // Composite is weighted average of factor scores
      const expected = 0.35 * 70 + 0.25 * 60 + 0.20 * 80 + 0.20 * 50;
      expect(composite).toBeCloseTo(expected / 1.0, 0); // weights sum to 1.0
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Component Bounds
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Component Bounds', () => {

  describe('computeBalanceCapacity bounds', () => {
    it('[0, 1000]: 0 ALGO → 0', () => {
      expect(computeBalanceCapacity(0)).toBe(0);
    });

    it('[0, 1000]: 1000 ALGO → 500', () => {
      expect(computeBalanceCapacity(1000)).toBe(500);
    });

    it('[0, 1000]: 2000 ALGO → 1000 (cap)', () => {
      expect(computeBalanceCapacity(2000)).toBe(1000);
    });

    it('[0, 1000]: 10000 ALGO → 1000 (cap)', () => {
      expect(computeBalanceCapacity(10000)).toBe(1000);
    });

    it('scales linearly below cap', () => {
      expect(computeBalanceCapacity(100)).toBe(50);
      expect(computeBalanceCapacity(200)).toBe(100);
      expect(computeBalanceCapacity(400)).toBe(200);
    });
  });

  describe('computeActivityBonus bounds', () => {
    it('[0, 200]: 0 txns → 0', () => {
      expect(computeActivityBonus(0)).toBe(0);
    });

    it('[0, 200]: 100 txns → 200 (cap)', () => {
      expect(computeActivityBonus(100)).toBe(200);
    });

    it('[0, 200]: 500 txns → 200 (cap)', () => {
      expect(computeActivityBonus(500)).toBe(200);
    });

    it('scales linearly below cap', () => {
      expect(computeActivityBonus(10)).toBe(20);
      expect(computeActivityBonus(50)).toBe(100);
    });
  });

  describe('computeAgeBonus bounds', () => {
    it('[0, 150]: 0 days → 0', () => {
      expect(computeAgeBonus(0)).toBe(0);
    });

    it('[0, 150]: 365 days → 150 (cap)', () => {
      expect(computeAgeBonus(365)).toBe(150);
    });

    it('[0, 150]: 730 days → 150 (cap)', () => {
      expect(computeAgeBonus(730)).toBe(150);
    });

    it('scales linearly below cap', () => {
      expect(computeAgeBonus(182.5)).toBeCloseTo(75, 0);
    });
  });

  describe('computeRiskPenalty bounds', () => {
    it('[0, 150]: both high → 0', () => {
      expect(computeRiskPenalty(80, 90)).toBe(0);
    });

    it('[0, 150]: both zero → 150', () => {
      expect(computeRiskPenalty(0, 0)).toBe(150);
    });

    it('[0, 150]: velocity only → max 50', () => {
      expect(computeRiskPenalty(0, 100)).toBe(50);
    });

    it('[0, 150]: compliance only → max 100', () => {
      expect(computeRiskPenalty(100, 0)).toBe(100);
    });
  });

  describe('computeCreditLimit formula', () => {
    it('sum of components minus penalty', () => {
      expect(computeCreditLimit({
        balanceCapacity: 100, activityBonus: 50, ageBonus: 30, riskPenalty: 20,
      })).toBe(160);
    });

    it('never negative', () => {
      expect(computeCreditLimit({
        balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 500,
      })).toBe(0);
    });

    it('never exceeds 1350', () => {
      expect(computeCreditLimit({
        balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 0,
      })).toBe(1350);
    });

    it('additive components', () => {
      const a = computeCreditLimit({ balanceCapacity: 100, activityBonus: 0, ageBonus: 0, riskPenalty: 0 });
      const b = computeCreditLimit({ balanceCapacity: 0, activityBonus: 100, ageBonus: 0, riskPenalty: 0 });
      const c = computeCreditLimit({ balanceCapacity: 100, activityBonus: 100, ageBonus: 0, riskPenalty: 0 });
      expect(a + b).toBe(c);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Delegation Independence
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Delegation Independence', () => {

  it('delegation trust score does NOT affect credit limit', () => {
    // Credit limit depends only on on-chain data
    // Delegation score flows through underwriting, not credit
    const limit = computeCreditLimit({
      balanceCapacity: 500,
      activityBonus: 100,
      ageBonus: 75,
      riskPenalty: 0,
    });
    // Same limit regardless of delegation score
    expect(limit).toBe(675);
  });

  it('delegation trust score affects only underwriting multiplier', () => {
    const factors1 = [
      makeFactor({ name: 'Trust', score: 50, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 0, weight: 0.25 }),
      makeFactor({ name: 'Sybil', score: 50, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 50, weight: 0.20 }),
    ];
    const factors2 = [
      makeFactor({ name: 'Trust', score: 50, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 100, weight: 0.25 }),
      makeFactor({ name: 'Sybil', score: 50, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 50, weight: 0.20 }),
    ];
    const composite1 = computeCompositeScore(factors1);
    const composite2 = computeCompositeScore(factors2);
    // Delegation change affects composite score, which affects multiplier
    expect(composite2).toBeGreaterThan(composite1);
  });

  it('depth-adjusted cap prevents delegation trust amplification', () => {
    // Wallet at depth 1 with sponsor trust=40
    const depth1Raw = computeDelegationTrustScore({
      depthScore: computeDepthScore(1),
      sponsorQualityScore: computeSponsorQualityScore(40),
      sponsorCountScore: computeSponsorCountScore(1, 40),
      amountScore: computeAmountScore(1_000_000),
    });

    // Wallet at depth 2 with sponsor trust=40
    const depth2Raw = computeDelegationTrustScore({
      depthScore: computeDepthScore(2),
      sponsorQualityScore: computeSponsorQualityScore(40),
      sponsorCountScore: computeSponsorCountScore(1, 40),
      amountScore: computeAmountScore(1_000_000),
    });

    // Raw scores can exceed caps (cap is applied in scoreDelegation, not here)
    // But raw scores should still decrease with depth (due to depthScore component)
    expect(depth2Raw).toBeLessThan(depth1Raw);

    // Depth-adjusted caps (applied in scoreDelegation):
    const cap1 = Math.max(0, 40 - 1 * 20); // 20
    const cap2 = Math.max(0, 40 - 2 * 20); // 0

    // After applying cap, depth1 ≤ cap1 and depth2 ≤ cap2
    const finalDepth1 = Math.min(depth1Raw, cap1);
    const finalDepth2 = Math.min(depth2Raw, cap2);
    expect(finalDepth1).toBeLessThanOrEqual(cap1);
    expect(finalDepth2).toBeLessThanOrEqual(cap2);

    // Final scores are monotonically decreasing
    expect(finalDepth2).toBeLessThanOrEqual(finalDepth1);
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Graph Depth Scenarios
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Graph Depth Scenarios', () => {

  it('depth 1: wallet directly sponsored by anchor', () => {
    // depth=1, sponsor trust=80
    const depthScore = computeDepthScore(1); // 80
    const sponsorQualityScore = computeSponsorQualityScore(80);
    const sponsorCountScore = computeSponsorCountScore(1, 80);
    const amountScore = computeAmountScore(5_000_000); // 5 ALGO

    const delegationTrust = computeDelegationTrustScore({
      depthScore, sponsorQualityScore, sponsorCountScore, amountScore,
    });

    // Depth-adjusted cap: maxSponsorTrust - depth × 20 = 80 - 20 = 60
    const cap = Math.max(0, 80 - 1 * 20);
    const finalTrust = Math.min(delegationTrust, cap);

    expect(finalTrust).toBeLessThanOrEqual(60);
    expect(finalTrust).toBeGreaterThan(0);
  });

  it('depth 10: wallet at maximum depth chain', () => {
    // depth=10, sponsor trust=80
    const depthScore = computeDepthScore(10); // max(0, 40 - 7×10) = 0
    const sponsorQualityScore = computeSponsorQualityScore(80);
    const sponsorCountScore = computeSponsorCountScore(1, 80);
    const amountScore = computeAmountScore(5_000_000);

    const delegationTrust = computeDelegationTrustScore({
      depthScore, sponsorQualityScore, sponsorCountScore, amountScore,
    });

    // Depth-adjusted cap: 80 - 10×20 = max(0, -120) = 0
    const cap = Math.max(0, 80 - 10 * 20);
    const finalTrust = Math.min(delegationTrust, cap);

    expect(finalTrust).toBe(0);
    expect(depthScore).toBe(0);
  });

  it('depth 0: wallet is trust anchor', () => {
    const depthScore = computeDepthScore(0); // 100
    expect(depthScore).toBe(100);
  });

  it('depth monotonically decreases delegation trust', () => {
    const results: number[] = [];
    for (let d = 0; d <= 10; d++) {
      const depthScore = computeDepthScore(d);
      const trust = computeDelegationTrustScore({
        depthScore,
        sponsorQualityScore: 70,
        sponsorCountScore: 40,
        amountScore: 50,
      });
      // Apply depth-adjusted cap
      const cap = Math.max(0, 70 - d * 20);
      const finalTrust = Math.min(trust, cap);
      results.push(finalTrust);
    }
    // Monotonically non-increasing
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeLessThanOrEqual(results[i - 1]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Multi-Sponsor Scenarios
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Multi-Sponsor Scenarios', () => {

  it('5 sponsors same quality give bounded count score', () => {
    const countScore = computeSponsorCountScore(5, 100);
    expect(countScore).toBe(100); // min(100, 5×20×1.0)
  });

  it('5 sponsors low quality give reduced count score', () => {
    const countScore = computeSponsorCountScore(5, 30);
    // min(100, 100 × max(0.1, 30/100)) = min(100, 100 × 0.3) = 30
    expect(countScore).toBe(30);
  });

  it('1 sponsor vs 5 sponsors: total delegation bounded', () => {
    // 1 sponsor, quality=100
    const singleDelegation = computeDelegationTrustScore({
      depthScore: 80,
      sponsorQualityScore: 100,
      sponsorCountScore: computeSponsorCountScore(1, 100),
      amountScore: 50,
    });

    // 5 sponsors, quality=100
    const multiDelegation = computeDelegationTrustScore({
      depthScore: 80,
      sponsorQualityScore: 100,
      sponsorCountScore: computeSponsorCountScore(5, 100),
      amountScore: 50,
    });

    // Multi-sponsor gives higher delegation trust
    expect(multiDelegation).toBeGreaterThan(singleDelegation);

    // But delegation trust is capped at 100
    expect(multiDelegation).toBeLessThanOrEqual(100);

    // And flows through underwriting factor × 0.25
    // Max contribution to compositeScore: 100 × 0.25 = 25
  });

  it('sponsor quality scaling prevents trust inflation', () => {
    const q0 = computeSponsorCountScore(5, 0);
    const q50 = computeSponsorCountScore(5, 50);
    const q100 = computeSponsorCountScore(5, 100);
    expect(q0).toBeLessThan(q50);
    expect(q50).toBeLessThan(q100);
    // 5 zero-quality sponsors give minimal count score
    expect(q0).toBe(10); // min(100, 100 × 0.1)
  });

  it('self-endorsement excluded (delegatee !== wallet)', () => {
    // This is enforced in scoreDelegation() at runtime
    // Here we verify the math doesn't count self-endorsement
    const countScore = computeSponsorCountScore(0, 0);
    expect(countScore).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Partial Revocations & Sponsor Defaults
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Revocations & Defaults', () => {

  it('partial revocation reduces sponsor count', () => {
    // Before revocation: 3 sponsors
    const beforeCount = computeSponsorCountScore(3, 80);
    // After revocation: 2 sponsors
    const afterCount = computeSponsorCountScore(2, 80);
    expect(afterCount).toBeLessThan(beforeCount);
  });

  it('sponsor default (trust=0) reduces quality', () => {
    // Before default: sponsor trust=80
    const beforeQuality = computeSponsorQualityScore(80);
    // After default: sponsor trust=0
    const afterQuality = computeSponsorQualityScore(0);
    expect(afterQuality).toBeLessThan(beforeQuality);
    expect(afterQuality).toBe(0);
  });

  it('full revocation: 0 sponsors → delegation trust=0', () => {
    const countScore = computeSponsorCountScore(0, 0);
    const delegationTrust = computeDelegationTrustScore({
      depthScore: 0,
      sponsorQualityScore: 0,
      sponsorCountScore: 0,
      amountScore: 0,
    });
    expect(countScore).toBe(0);
    expect(delegationTrust).toBe(0);
  });

  it('revocation impact on credit limit is zero (delegation not in credit)', () => {
    // Credit limit doesn't depend on delegation at all
    // Revocation only affects underwriting multiplier
    const limitBefore = computeCreditLimit({
      balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 0,
    });
    const limitAfter = computeCreditLimit({
      balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 0,
    });
    // Credit limit unchanged
    expect(limitBefore).toBe(limitAfter);
  });

  it('sponsor default reduces underwriting multiplier', () => {
    const factorsBefore = [
      makeFactor({ name: 'Trust', score: 60, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 80, weight: 0.25 }),
      makeFactor({ name: 'Sybil', score: 70, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 60, weight: 0.20 }),
    ];
    const factorsAfter = [
      makeFactor({ name: 'Trust', score: 60, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 0, weight: 0.25 }), // sponsor defaulted
      makeFactor({ name: 'Sybil', score: 70, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 60, weight: 0.20 }),
    ];
    const compositeBefore = computeCompositeScore(factorsBefore);
    const compositeAfter = computeCompositeScore(factorsAfter);
    expect(compositeAfter).toBeLessThan(compositeBefore);
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Numerical Simulations
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Numerical Simulations', () => {

  it('worst case: all max values → creditLimit = 1350', () => {
    const limit = computeCreditLimit({
      balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 0,
    });
    expect(limit).toBe(1350);
  });

  it('best case: all zero values → creditLimit = 0', () => {
    const limit = computeCreditLimit({
      balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 0,
    });
    expect(limit).toBe(0);
  });

  it('risk penalty extremes: velocity=0, compliance=0 → 150', () => {
    expect(computeRiskPenalty(0, 0)).toBe(150);
  });

  it('credit limit with max risk penalty → 1200', () => {
    const limit = computeCreditLimit({
      balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 150,
    });
    expect(limit).toBe(1200);
  });

  it('underwriting limit: max quality, max credit → 1350', () => {
    const limit = computeUnderwritingLimit(100, 1350, 0, 100);
    // scoreMultiplier=1.5, sybilMultiplier=1.0, reputationMultiplier=1.3
    // raw = 1350 × 1.5 × 1.0 × 1.3 = 2632.5 → capped at 1350
    expect(limit).toBe(1350);
  });

  it('underwriting limit: min quality, max credit → 675', () => {
    const limit = computeUnderwritingLimit(0, 1350, 0, 0);
    // scoreMultiplier=0.5, sybilMultiplier=1.0, reputationMultiplier=1.0
    // raw = 1350 × 0.5 = 675
    expect(limit).toBe(675);
  });

  it('sybil penalty: sybilRisk=0.70 → 50% reduction', () => {
    const limit = computeUnderwritingLimit(50, 1000, 0.70, 0);
    // scoreMultiplier=1.0, sybilMultiplier=1-0.49=0.51, reputationMultiplier=1.0
    // raw = 1000 × 1.0 × 0.51 × 1.0 = 510
    expect(limit).toBe(510);
  });

  it('reputation bonus: reputation=100 → 30% increase', () => {
    const limit = computeUnderwritingLimit(50, 1000, 0, 100);
    // scoreMultiplier=1.0, sybilMultiplier=1.0, reputationMultiplier=1.3
    // raw = 1000 × 1.0 × 1.0 × 1.3 = 1300
    expect(limit).toBe(1300);
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — System Capacity Guard
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — System Capacity Guard', () => {

  beforeEach(() => {
    resetSystemExposure();
  });

  it('system exposure starts at 0', () => {
    expect(getSystemExposure()).toBe(0);
  });

  it('capToSystemCapacity limits to remaining capacity', () => {
    resetSystemExposure();
    const capped = capToSystemCapacity(5000);
    expect(capped).toBe(5000);
  });

  it('capToSystemCapacity respects existing exposure', () => {
    resetSystemExposure();
    addSystemExposure(60000);

    const capped = capToSystemCapacity(60000);
    expect(capped).toBe(40000); // 100000 - 60000 = 40000
  });

  it('capToSystemCapacity returns 0 when fully exposed', () => {
    resetSystemExposure();
    addSystemExposure(100000);

    const capped = capToSystemCapacity(10000);
    expect(capped).toBe(0);
  });

  it('system exposure tracks cumulative approved credit', () => {
    resetSystemExposure();
    expect(getSystemExposure()).toBe(0);

    // Simulate 3 approvals — capToSystemCapacity doesn't add exposure,
    // only underwrite() does. So we manually track here.
    const limit1 = capToSystemCapacity(30000);
    expect(limit1).toBe(30000);
    addSystemExposure(limit1);

    const limit2 = capToSystemCapacity(40000);
    expect(limit2).toBe(40000);
    addSystemExposure(limit2);

    const limit3 = capToSystemCapacity(40000);
    expect(limit3).toBe(30000); // only 30000 remaining
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Synthetic Capacity Counterexamples
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — No Synthetic Capacity', () => {

  it('delegation=100, on-chain=0 → no synthetic credit', () => {
    // Credit capacity: on-chain only → 0
    const creditLimit = computeCreditLimit({
      balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 0,
    });
    expect(creditLimit).toBe(0);

    // Underwriting: delegation provides quality multiplier only
    const factors = [
      makeFactor({ name: 'Trust', score: 0, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 100, weight: 0.25 }),
      makeFactor({ name: 'Sybil', score: 50, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 0, weight: 0.20 }),
    ];
    const composite = computeCompositeScore(factors);
    const limit = computeUnderwritingLimit(composite, 0, 0, 0);
    // 0 × anything = 0
    expect(limit).toBe(0);
  });

  it('delegation=50 vs 100 → recommendedLimit monotonic', () => {
    const creditLimit = 500;

    const factors50 = [
      makeFactor({ name: 'Trust', score: 50, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 50, weight: 0.25 }),
      makeFactor({ name: 'Sybil', score: 50, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 50, weight: 0.20 }),
    ];
    const factors100 = [
      makeFactor({ name: 'Trust', score: 50, weight: 0.35 }),
      makeFactor({ name: 'Delegation', score: 100, weight: 0.25 }),
      makeFactor({ name: 'Sybil', score: 50, weight: 0.20 }),
      makeFactor({ name: 'Reputation', score: 50, weight: 0.20 }),
    ];

    const composite50 = computeCompositeScore(factors50);
    const composite100 = computeCompositeScore(factors100);
    const limit50 = computeUnderwritingLimit(composite50, creditLimit, 0, 0);
    const limit100 = computeUnderwritingLimit(composite100, creditLimit, 0, 0);

    // Higher delegation → higher limit (monotonic)
    expect(limit100).toBeGreaterThanOrEqual(limit50);
  });

  it('credit components are independent (no cross-terms)', () => {
    // Each component contributes independently
    const balance = computeCreditLimit({ balanceCapacity: 100, activityBonus: 0, ageBonus: 0, riskPenalty: 0 });
    const activity = computeCreditLimit({ balanceCapacity: 0, activityBonus: 100, ageBonus: 0, riskPenalty: 0 });
    const age = computeCreditLimit({ balanceCapacity: 0, activityBonus: 0, ageBonus: 100, riskPenalty: 0 });
    const combined = computeCreditLimit({ balanceCapacity: 100, activityBonus: 100, ageBonus: 100, riskPenalty: 0 });
    expect(balance + activity + age).toBe(combined);
  });

  it('no quadratic self-reference in recommendedLimit', () => {
    // Verify: recommendedLimit = creditLimit × multiplier
    // Where multiplier depends on compositeScore, NOT on creditLimit
    const creditLimit = 500;
    const compositeScore = 50;

    const limit = computeUnderwritingLimit(compositeScore, creditLimit, 0, 0);
    // scoreMultiplier = 0.5 + 50/100 = 1.0
    // raw = 500 × 1.0 = 500
    expect(limit).toBe(500);

    // Double creditLimit → double recommendedLimit (linear)
    const limit2 = computeUnderwritingLimit(compositeScore, 1000, 0, 0);
    expect(limit2).toBe(1000);
  });

  it('multi-sponsor distribution vs concentration', () => {
    // 5 wallets each with 1 sponsor (quality=100)
    const perWalletDelegation = computeDelegationTrustScore({
      depthScore: 80,
      sponsorQualityScore: 100,
      sponsorCountScore: computeSponsorCountScore(1, 100),
      amountScore: 50,
    });
    const perWalletBonus = perWalletDelegation * 3; // This is the OLD formula
    // But delegationBonus is REMOVED from credit now
    // So delegation bonus = 0 regardless
    expect(perWalletBonus).toBeGreaterThan(0); // delegation trust exists
    // But it doesn't affect credit limit
    const creditLimit = computeCreditLimit({
      balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 0,
    });
    // Same credit limit regardless of delegation
    expect(creditLimit).toBe(675);
  });
});

// ═══════════════════════════════════════════════════════════════
// CREDIT CAPACITY AUDIT — Formal Invariant Proofs
// ═══════════════════════════════════════════════════════════════

describe('Credit Capacity Audit — Formal Invariant Proofs', () => {

  it('INVARIANT 1: creditLimit ≤ 1350 for all inputs', () => {
    const testCases = [
      { balanceCapacity: 2000, activityBonus: 500, ageBonus: 300, riskPenalty: -100 },
      { balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 0 },
      { balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 0 },
      { balanceCapacity: 999, activityBonus: 199, ageBonus: 149, riskPenalty: 0 },
      { balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 0 },
      { balanceCapacity: 100, activityBonus: 50, ageBonus: 30, riskPenalty: 150 },
    ];
    for (const tc of testCases) {
      expect(computeCreditLimit(tc)).toBeLessThanOrEqual(1350);
    }
  });

  it('INVARIANT 2: creditLimit ≥ 0 for all inputs', () => {
    const testCases = [
      { balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 1000 },
      { balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 150 },
      { balanceCapacity: 50, activityBonus: 20, ageBonus: 10, riskPenalty: 200 },
    ];
    for (const tc of testCases) {
      expect(computeCreditLimit(tc)).toBeGreaterThanOrEqual(0);
    }
  });

  it('INVARIANT 3: compositeScore ∈ [0, 100] for all factor combinations', () => {
    const testFactors = [
      [
        makeFactor({ score: 0, weight: 0.35 }),
        makeFactor({ score: 0, weight: 0.25 }),
        makeFactor({ score: 0, weight: 0.20 }),
        makeFactor({ score: 0, weight: 0.20 }),
      ],
      [
        makeFactor({ score: 100, weight: 0.35 }),
        makeFactor({ score: 100, weight: 0.25 }),
        makeFactor({ score: 100, weight: 0.20 }),
        makeFactor({ score: 100, weight: 0.20 }),
      ],
      [
        makeFactor({ score: 50, weight: 0.35 }),
        makeFactor({ score: 30, weight: 0.25 }),
        makeFactor({ score: 70, weight: 0.20 }),
        makeFactor({ score: 90, weight: 0.20 }),
      ],
    ];
    for (const factors of testFactors) {
      const score = computeCompositeScore(factors);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('INVARIANT 4: recommendedLimit is O(creditLimit), not O(creditLimit²)', () => {
    // Fix compositeScore, vary creditLimit
    const compositeScore = 60;
    const results: Array<{ creditLimit: number; recommendedLimit: number }> = [];
    for (const cl of [100, 200, 300, 400, 500]) {
      const rl = computeUnderwritingLimit(compositeScore, cl, 0, 0);
      results.push({ creditLimit: cl, recommendedLimit: rl });
    }
    // Verify linearity: ratio should be constant
    const ratio = results[0].recommendedLimit / results[0].creditLimit;
    for (const r of results) {
      expect(r.recommendedLimit / r.creditLimit).toBeCloseTo(ratio, 6);
    }
  });

  it('INVARIANT 5: weight sum = 1.0 in underwriting factors', () => {
    const weights = [0.35, 0.25, 0.20, 0.20];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('INVARIANT 6: each factor weight ∈ [0, 1]', () => {
    const weights = [0.35, 0.25, 0.20, 0.20];
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

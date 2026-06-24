import { describe, it, expect } from 'vitest';
import {
  computeCompositeScore,
  classifyUnderwritingRisk,
  computeUnderwritingLimit,
  decideApproval,
  computeUnderwritingConfidence,
  generateUnderwritingExplanation,
  capToSystemCapacity,
  addSystemExposure,
  getSystemExposure,
  resetSystemExposure,
  MAX_SYSTEM_EXPOSURE,
} from '../underwriting';
import type { UnderwritingFactor } from '../underwriting';
import { applySybilPenalty } from '../trust-score';
import {
  computeIdentityStrength,
  computePaymentReliability,
  computeOverallRisk,
  classifyOverallRisk,
  generatePassportSummary,
} from '../passport';

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

describe('Underwriting Decision Engine — Pure Math Functions', () => {
  describe('computeCompositeScore', () => {
    it('returns 0 for empty factors', () => {
      expect(computeCompositeScore([])).toBe(0);
    });

    it('computes weighted average', () => {
      const factors = [
        makeFactor({ score: 80, weight: 0.5 }),
        makeFactor({ score: 40, weight: 0.5 }),
      ];
      expect(computeCompositeScore(factors)).toBe(60);
    });

    it('handles unequal weights', () => {
      const factors = [
        makeFactor({ score: 100, weight: 0.75 }),
        makeFactor({ score: 0, weight: 0.25 }),
      ];
      expect(computeCompositeScore(factors)).toBe(75);
    });

    it('caps at 100', () => {
      const factors = [makeFactor({ score: 200, weight: 1.0 })];
      expect(computeCompositeScore(factors)).toBe(100);
    });

    it('floors at 0', () => {
      const factors = [makeFactor({ score: -50, weight: 1.0 })];
      expect(computeCompositeScore(factors)).toBe(0);
    });
  });

  describe('classifyUnderwritingRisk', () => {
    it('returns low for score >= 70', () => {
      expect(classifyUnderwritingRisk(70)).toBe('low');
      expect(classifyUnderwritingRisk(100)).toBe('low');
    });

    it('returns medium for score 45-69', () => {
      expect(classifyUnderwritingRisk(45)).toBe('medium');
      expect(classifyUnderwritingRisk(60)).toBe('medium');
    });

    it('returns high for score 20-44', () => {
      expect(classifyUnderwritingRisk(20)).toBe('high');
      expect(classifyUnderwritingRisk(35)).toBe('high');
    });

    it('returns critical for score < 20', () => {
      expect(classifyUnderwritingRisk(0)).toBe('critical');
      expect(classifyUnderwritingRisk(19)).toBe('critical');
    });
  });

  describe('computeUnderwritingLimit', () => {
    it('returns 0 for zero credit limit', () => {
      expect(computeUnderwritingLimit(50, 0, 0, 50)).toBe(0);
    });

    it('applies score multiplier', () => {
      const result = computeUnderwritingLimit(50, 1000, 0, 0);
      // 1000 * (0.5 + 0.5) = 1000
      expect(result).toBe(1000);
    });

    it('applies sybil penalty', () => {
      const result = computeUnderwritingLimit(50, 1000, 0.5, 0);
      // 1000 * 1.0 * (1 - 0.35) = 650
      expect(result).toBe(650);
    });

    it('applies reputation bonus', () => {
      const result = computeUnderwritingLimit(50, 1000, 0, 100);
      // 1000 * 1.0 * 1.0 * 1.3 = 1300
      expect(result).toBe(1300);
    });

    it('caps at 1350', () => {
      const result = computeUnderwritingLimit(100, 10000, 0, 100);
      // raw = 10000 * 1.5 * 1.0 * 1.3 = 19500 → capped at 1350
      expect(result).toBe(1350);
    });

    it('floors at 0', () => {
      const result = computeUnderwritingLimit(0, 100, 1.0, 0);
      // scoreMultiplier = 0.5 + 0 = 0.5, limit = 100 * 0.5 = 50
      // sybilMultiplier = 1.0 - 0.7 = 0.3, limit = 50 * 0.3 = 15
      expect(result).toBe(15);
    });
  });

  describe('decideApproval', () => {
    it('denies if sybil risk is critical', () => {
      expect(decideApproval(80, 0.80, 50)).toBe(false);
    });

    it('denies if composite score is too low', () => {
      expect(decideApproval(25, 0.10, 50)).toBe(false);
    });

    it('denies if reputation is critical with low score', () => {
      expect(decideApproval(40, 0.10, 5)).toBe(false);
    });

    it('approves for good profile', () => {
      expect(decideApproval(70, 0.10, 50)).toBe(true);
    });

    it('approves for moderate profile', () => {
      expect(decideApproval(50, 0.20, 30)).toBe(true);
    });
  });

  describe('computeUnderwritingConfidence', () => {
    it('returns 0.40 for empty factors', () => {
      expect(computeUnderwritingConfidence([])).toBe(0.40);
    });

    it('increases with more factors having data', () => {
      const factors = [
        makeFactor({ score: 50 }),
        makeFactor({ score: 50 }),
        makeFactor({ score: 0 }),
      ];
      const result = computeUnderwritingConfidence(factors);
      expect(result).toBeGreaterThan(0.40);
      expect(result).toBeLessThan(0.95);
    });

    it('caps at 0.95', () => {
      const factors = Array(10).fill(null).map(() => makeFactor({ score: 80 }));
      expect(computeUnderwritingConfidence(factors)).toBe(0.95);
    });
  });

  describe('generateUnderwritingExplanation', () => {
    it('reports approval', () => {
      const factors = [makeFactor({ score: 80 })];
      const reasons = generateUnderwritingExplanation(factors, true, 75, 500);
      expect(reasons.some(r => r.includes('Approved'))).toBe(true);
    });

    it('reports denial', () => {
      const factors = [makeFactor({ score: 20 })];
      const reasons = generateUnderwritingExplanation(factors, false, 20, 0);
      expect(reasons.some(r => r.includes('Denied'))).toBe(true);
    });

    it('reports recommended limit', () => {
      const factors = [makeFactor({ score: 80 })];
      const reasons = generateUnderwritingExplanation(factors, true, 75, 500);
      expect(reasons.some(r => r.includes('$500'))).toBe(true);
    });

    it('reports strong signals', () => {
      const factors = [
        makeFactor({ name: 'Trust', score: 80, status: 'positive' }),
        makeFactor({ name: 'Credit', score: 20, status: 'negative' }),
      ];
      const reasons = generateUnderwritingExplanation(factors, true, 60, 300);
      expect(reasons.some(r => r.includes('Trust'))).toBe(true);
    });
  });

  describe('Sybil→Trust feedback integration', () => {
    it('applySybilPenalty reduces trust score when sybil risk is high', () => {
      expect(applySybilPenalty(70, 0.50)).toBe(56);
    });

    it('applySybilPenalty has no effect when sybil risk is low', () => {
      expect(applySybilPenalty(70, 0.20)).toBe(70);
    });

    it('applySybilPenalty halves trust score when sybil risk is critical', () => {
      expect(applySybilPenalty(80, 0.80)).toBe(40);
    });

    it('combined effect: high trust + high sybil → reduced composite', () => {
      const adjustedTrust = applySybilPenalty(70, 0.50);
      expect(adjustedTrust).toBe(56);

      // New 4-factor architecture: Trust 0.35, Delegation 0.25, Sybil 0.20, Reputation 0.20
      const factors = [
        makeFactor({ name: 'Trust Score', score: adjustedTrust, weight: 0.35 }),
        makeFactor({ name: 'Delegation Trust', score: 60, weight: 0.25 }),
        makeFactor({ name: 'Sybil Resistance', score: 50, weight: 0.20 }),
        makeFactor({ name: 'Reputation', score: 60, weight: 0.20 }),
      ];
      const composite = computeCompositeScore(factors);
      expect(composite).toBeLessThan(70);
    });

    it('extreme case: zero trust + critical sybil → minimum factor', () => {
      expect(applySybilPenalty(0, 0.80)).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// UNDERWRITING AUDIT — Multi-Condition Decision Analysis
// ═══════════════════════════════════════════════════════════════

describe('Underwriting Decision Audit', () => {
  describe('Multi-Condition Decision Logic', () => {
    it('deny if sybil risk is critical (>= 0.70)', () => {
      expect(decideApproval(80, 0.70, 50)).toBe(false);
      expect(decideApproval(100, 0.80, 100)).toBe(false);
    });

    it('deny if composite score is too low (< 30)', () => {
      expect(decideApproval(29, 0.10, 50)).toBe(false);
      expect(decideApproval(0, 0, 0)).toBe(false);
    });

    it('deny if reputation is critical (< 10) AND composite is low (< 50)', () => {
      expect(decideApproval(49, 0.10, 9)).toBe(false);
      expect(decideApproval(50, 0.10, 9)).toBe(true);
      expect(decideApproval(40, 0.10, 10)).toBe(true);
    });

    it('approve for good profile', () => {
      expect(decideApproval(70, 0.10, 50)).toBe(true);
    });

    it('approve for moderate profile', () => {
      expect(decideApproval(50, 0.20, 30)).toBe(true);
    });

    it('sybil override: high composite but critical sybil → denied', () => {
      expect(decideApproval(90, 0.70, 100)).toBe(false);
    });

    it('composite override: low composite but low sybil → denied', () => {
      expect(decideApproval(25, 0.10, 80)).toBe(false);
    });
  });

  describe('Composite Score Sensitivity', () => {
    it('1-point change in trust factor (weight 0.35) changes composite by 0.35', () => {
      const base = [
        { name: 'Trust', score: 50, weight: 0.35 },
        { name: 'Delegation', score: 50, weight: 0.25 },
        { name: 'Sybil', score: 50, weight: 0.20 },
        { name: 'Reputation', score: 50, weight: 0.20 },
      ];
      const high = [
        { name: 'Trust', score: 51, weight: 0.35 },
        { name: 'Delegation', score: 50, weight: 0.25 },
        { name: 'Sybil', score: 50, weight: 0.20 },
        { name: 'Reputation', score: 50, weight: 0.20 },
      ];
      const baseScore = computeCompositeScore(base);
      const highScore = computeCompositeScore(high);
      expect(highScore - baseScore).toBeCloseTo(0.35, 0);
    });

    it('composite score is bounded [0, 100]', () => {
      const allZero = [
        { name: 'T', score: 0, weight: 0.35 },
        { name: 'D', score: 0, weight: 0.25 },
        { name: 'S', score: 0, weight: 0.20 },
        { name: 'R', score: 0, weight: 0.20 },
      ];
      const allHundred = [
        { name: 'T', score: 100, weight: 0.35 },
        { name: 'D', score: 100, weight: 0.25 },
        { name: 'S', score: 100, weight: 0.20 },
        { name: 'R', score: 100, weight: 0.20 },
      ];
      expect(computeCompositeScore(allZero)).toBe(0);
      expect(computeCompositeScore(allHundred)).toBe(100);
    });

    it('weight sum is 1.0', () => {
      const weights = [0.35, 0.25, 0.20, 0.20];
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    });
  });

  describe('Underwriting Limit Sensitivity', () => {
    it('sybil risk 0.50 reduces limit by 35%', () => {
      const base = computeUnderwritingLimit(50, 1000, 0, 0);
      const withSybil = computeUnderwritingLimit(50, 1000, 0.50, 0);
      expect(base).toBe(1000);
      expect(withSybil).toBe(650);
    });

    it('reputation 100 increases limit by 30%', () => {
      const base = computeUnderwritingLimit(50, 1000, 0, 0);
      const withRep = computeUnderwritingLimit(50, 1000, 0, 100);
      expect(base).toBe(1000);
      expect(withRep).toBe(1300);
    });

    it('combined effects: high sybil + high reputation partially offset', () => {
      const result = computeUnderwritingLimit(50, 1000, 0.50, 100);
      // 1000 * 1.0 * (1 - 0.35) * 1.3 = 1000 * 0.65 * 1.3 = 845
      expect(result).toBe(845);
    });

    it('limit is linear in creditLimit (no self-reference)', () => {
      const base = computeUnderwritingLimit(60, 500, 0, 0);
      const double = computeUnderwritingLimit(60, 1000, 0, 0);
      expect(double).toBeCloseTo(base * 2, 0);
    });
  });

  describe('Confidence Analysis', () => {
    it('all 4 factors present → confidence 0.95', () => {
      const factors = [
        { name: 'T', score: 80, weight: 0.35, contribution: 28, status: 'positive' as const },
        { name: 'D', score: 60, weight: 0.25, contribution: 15, status: 'neutral' as const },
        { name: 'S', score: 70, weight: 0.20, contribution: 14, status: 'positive' as const },
        { name: 'R', score: 50, weight: 0.20, contribution: 10, status: 'neutral' as const },
      ];
      expect(computeUnderwritingConfidence(factors)).toBe(0.95);
    });

    it('no factors present → confidence 0.40', () => {
      expect(computeUnderwritingConfidence([])).toBe(0.40);
    });

    it('confidence increases with more data', () => {
      const few = [
        { name: 'T', score: 0, weight: 0.35, contribution: 0, status: 'negative' as const },
      ];
      const many = [
        { name: 'T', score: 50, weight: 0.35, contribution: 17.5, status: 'neutral' as const },
        { name: 'D', score: 50, weight: 0.25, contribution: 12.5, status: 'neutral' as const },
        { name: 'S', score: 50, weight: 0.20, contribution: 10, status: 'neutral' as const },
        { name: 'R', score: 50, weight: 0.20, contribution: 10, status: 'neutral' as const },
      ];
      expect(computeUnderwritingConfidence(many)).toBeGreaterThan(computeUnderwritingConfidence(few));
    });
  });

  describe('System Capacity Guard', () => {
    it('capToSystemCapacity limits to remaining', () => {
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
  });
});

// ═══════════════════════════════════════════════════════════════
// PASSPORT AUDIT — Cross-Module Consistency
// ═══════════════════════════════════════════════════════════════

describe('Passport Decision Audit', () => {
  describe('Risk Map Justification', () => {
    it('riskMap values are 10/35/65/90 for low/medium/high/critical', () => {
      const lowRisk = computeOverallRisk('low', 0, 'low', 'low');
      const medRisk = computeOverallRisk('medium', 0.5, 'medium', 'medium');
      const highRisk = computeOverallRisk('high', 0.7, 'high', 'high');
      const critRisk = computeOverallRisk('critical', 1.0, 'critical', 'critical');

      expect(lowRisk).toBe(7.5);
      expect(medRisk).toBe(38.8);
      expect(critRisk).toBe(92.5);
    });
  });

  describe('Overall Risk Classification', () => {
    it('risk <= 25 → low', () => {
      expect(classifyOverallRisk(0)).toBe('low');
      expect(classifyOverallRisk(25)).toBe('low');
    });

    it('risk 26-50 → medium', () => {
      expect(classifyOverallRisk(26)).toBe('medium');
      expect(classifyOverallRisk(50)).toBe('medium');
    });

    it('risk 51-75 → high', () => {
      expect(classifyOverallRisk(51)).toBe('high');
      expect(classifyOverallRisk(75)).toBe('high');
    });

    it('risk > 75 → critical', () => {
      expect(classifyOverallRisk(76)).toBe('critical');
      expect(classifyOverallRisk(100)).toBe('critical');
    });
  });

  describe('Identity Strength Sensitivity', () => {
    it('trust score contributes 40% to identity strength', () => {
      const base = computeIdentityStrength(50, 365, 100, 10);
      const high = computeIdentityStrength(100, 365, 100, 10);
      expect(high - base).toBeCloseTo(20, 0);
    });

    it('age contributes 25% (capped at 730 days)', () => {
      const base = computeIdentityStrength(50, 0, 100, 10);
      const old = computeIdentityStrength(50, 730, 100, 10);
      expect(old - base).toBeCloseTo(25, 0);
    });

    it('activity contributes 20% (capped at 500 txns)', () => {
      const base = computeIdentityStrength(50, 365, 0, 10);
      const active = computeIdentityStrength(50, 365, 500, 10);
      expect(active - base).toBeCloseTo(20, 0);
    });
  });

  describe('Payment Reliability Sensitivity', () => {
    it('trust contributes 40%, reputation 35%, credit 25%', () => {
      const base = computePaymentReliability(50, 50, 500);
      const high = computePaymentReliability(100, 50, 500);
      expect(high - base).toBeCloseTo(20, 0);
    });
  });

  describe('Summary Generation', () => {
    it('generates descriptive summary', () => {
      const summary = generatePassportSummary(80, 80, 80, 20, 0.1);
      expect(summary).toContain('well-established');
      expect(summary).toContain('highly reputed');
      expect(summary).toContain('reliable payer');
      expect(summary).toContain('low-risk');
      expect(summary).toContain('clean');
    });

    it('generates warning summary for risky wallet', () => {
      const summary = generatePassportSummary(20, 20, 20, 80, 0.8);
      expect(summary).toContain('new');
      expect(summary).toContain('untested');
      expect(summary).toContain('unproven');
      expect(summary).toContain('high-risk');
      expect(summary).toContain('flagged');
    });
  });
});

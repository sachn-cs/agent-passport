import { describe, it, expect } from 'vitest';
import {
  computeCombinedScore,
  computeConfidence,
  decideAllow,
  classifyCounterpartyRisk,
  generateCounterpartyExplanation,
} from '../counterparty';

describe('Counterparty Verification — Pure Math Functions', () => {
  describe('computeCombinedScore', () => {
    it('returns 0 for 0/0', () => {
      expect(computeCombinedScore(0, 0)).toBe(0);
    });

    it('returns 100 for 100/100', () => {
      expect(computeCombinedScore(100, 100)).toBe(100);
    });

    it('weights on-chain at 0.6', () => {
      expect(computeCombinedScore(100, 0)).toBe(60);
    });

    it('weights delegation at 0.4', () => {
      expect(computeCombinedScore(0, 100)).toBe(40);
    });

    it('computes weighted average correctly', () => {
      expect(computeCombinedScore(50, 50)).toBe(50);
    });

    it('rounds to 1 decimal', () => {
      const result = computeCombinedScore(33, 67);
      expect(result).toBe(Math.round((0.6 * 33 + 0.4 * 67) * 10) / 10);
    });
  });

  describe('computeConfidence', () => {
    it('returns 0.30 for score 0', () => {
      expect(computeConfidence(0)).toBe(0.30);
    });

    it('returns 0.50 for score 40 (threshold boundary)', () => {
      expect(computeConfidence(40)).toBe(0.50);
    });

    it('returns 0.70 for score 60 (upper tier boundary)', () => {
      expect(computeConfidence(60)).toBe(0.70);
    });

    it('returns 1.00 for score 100', () => {
      expect(computeConfidence(100)).toBe(1.00);
    });

    it('never returns below 0.30', () => {
      expect(computeConfidence(-10)).toBeGreaterThanOrEqual(0.30);
    });

    it('never returns above 1.00', () => {
      expect(computeConfidence(200)).toBeLessThanOrEqual(1.00);
    });

    it('increases monotonically', () => {
      const scores = [0, 20, 40, 50, 60, 80, 100];
      const confidences = scores.map(computeConfidence);
      for (let i = 1; i < confidences.length; i++) {
        expect(confidences[i]).toBeGreaterThanOrEqual(confidences[i - 1]);
      }
    });

    it('has correct range for low tier (0-39)', () => {
      expect(computeConfidence(0)).toBe(0.30);
      expect(computeConfidence(20)).toBeLessThan(0.50);
    });

    it('has correct range for mid tier (40-59)', () => {
      expect(computeConfidence(40)).toBe(0.50);
      expect(computeConfidence(59)).toBeLessThan(0.70);
    });

    it('has correct range for high tier (60-100)', () => {
      expect(computeConfidence(60)).toBe(0.70);
      expect(computeConfidence(100)).toBe(1.00);
    });
  });

  describe('decideAllow', () => {
    it('returns false for score 39', () => {
      expect(decideAllow(39)).toBe(false);
    });

    it('returns true for score 40 with sufficient confidence', () => {
      expect(decideAllow(40, 0.50)).toBe(true);
    });

    it('returns true for score 100', () => {
      expect(decideAllow(100)).toBe(true);
    });

    it('returns false for score 0', () => {
      expect(decideAllow(0)).toBe(false);
    });

    it('returns false when confidence is below 0.45', () => {
      expect(decideAllow(50, 0.40)).toBe(false);
    });

    it('returns true when confidence is exactly 0.45', () => {
      expect(decideAllow(40, 0.45)).toBe(true);
    });

    it('returns true when confidence is not provided (default 1.0)', () => {
      expect(decideAllow(40)).toBe(true);
    });

    it('denies low-confidence wallets even with score >= 40', () => {
      // Score 40 with confidence 0.30 → denied
      expect(decideAllow(40, 0.30)).toBe(false);
    });
  });

  describe('classifyCounterpartyRisk', () => {
    it('returns low for 70+', () => {
      expect(classifyCounterpartyRisk(70)).toBe('low');
      expect(classifyCounterpartyRisk(100)).toBe('low');
    });

    it('returns medium for 45-69', () => {
      expect(classifyCounterpartyRisk(45)).toBe('medium');
      expect(classifyCounterpartyRisk(69)).toBe('medium');
    });

    it('returns high for 20-44', () => {
      expect(classifyCounterpartyRisk(20)).toBe('high');
      expect(classifyCounterpartyRisk(44)).toBe('high');
    });

    it('returns critical for <20', () => {
      expect(classifyCounterpartyRisk(0)).toBe('critical');
      expect(classifyCounterpartyRisk(19)).toBe('critical');
    });
  });

  describe('generateCounterpartyExplanation', () => {
    it('identifies strong on-chain history', () => {
      const reasons = generateCounterpartyExplanation(80, 60, 72, true, 0.85);
      expect(reasons.some(r => r.includes('Strong on-chain'))).toBe(true);
    });

    it('identifies weak on-chain history', () => {
      const reasons = generateCounterpartyExplanation(10, 50, 26, false, 0.4);
      expect(reasons.some(r => r.includes('Weak on-chain'))).toBe(true);
    });

    it('identifies well-sponsored', () => {
      const reasons = generateCounterpartyExplanation(60, 80, 68, true, 0.8);
      expect(reasons.some(r => r.includes('Well-sponsored'))).toBe(true);
    });

    it('identifies no delegation data', () => {
      const reasons = generateCounterpartyExplanation(70, 0, 42, true, 0.5);
      expect(reasons.some(r => r.includes('No delegation'))).toBe(true);
    });

    it('reports approved with confidence', () => {
      const reasons = generateCounterpartyExplanation(70, 70, 70, true, 0.85);
      expect(reasons.some(r => r.includes('Approved'))).toBe(true);
      expect(reasons.some(r => r.includes('85%'))).toBe(true);
    });

    it('reports denied with score', () => {
      const reasons = generateCounterpartyExplanation(20, 10, 16, false, 0.38);
      expect(reasons.some(r => r.includes('Denied'))).toBe(true);
      expect(reasons.some(r => r.includes('16'))).toBe(true);
    });

    it('returns multiple reasons', () => {
      const reasons = generateCounterpartyExplanation(80, 75, 78, true, 0.9);
      expect(reasons.length).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// DECISION ENGINE AUDIT — Risk Engine Analysis
// ═══════════════════════════════════════════════════════════════

describe('Decision Engine Audit', () => {
  // ── Decision Discontinuities ────────────────────────────────

  describe('Decision Discontinuities', () => {
    it('score 39.9 → denied, 40.0 → allowed (cliff at 40)', () => {
      expect(decideAllow(39.9, 0.50)).toBe(false);
      expect(decideAllow(40.0, 0.50)).toBe(true);
    });

    it('confidence 0.44 → denied, 0.45 → allowed (cliff at 0.45)', () => {
      expect(decideAllow(50, 0.44)).toBe(false);
      expect(decideAllow(50, 0.45)).toBe(true);
    });

    it('combined score changes smoothly (no cliff in scoring)', () => {
      // On-chain 39.9 vs 40.0 with same delegation
      const s1 = computeCombinedScore(39.9, 50);
      const s2 = computeCombinedScore(40.0, 50);
      expect(Math.abs(s2 - s1)).toBeLessThan(0.15);
    });

    it('confidence changes smoothly (no cliff in confidence)', () => {
      const c1 = computeConfidence(39.9);
      const c2 = computeConfidence(40.0);
      expect(Math.abs(c2 - c1)).toBeLessThan(0.05);
    });
  });

  // ── Sensitivity Analysis ────────────────────────────────────

  describe('Sensitivity Analysis', () => {
    it('1-point change in on-chain score changes combined by 0.6', () => {
      const base = computeCombinedScore(50, 50);
      const high = computeCombinedScore(51, 50);
      expect(high - base).toBeCloseTo(0.6, 0);
    });

    it('1-point change in delegation score changes combined by 0.4', () => {
      const base = computeCombinedScore(50, 50);
      const high = computeCombinedScore(50, 51);
      expect(high - base).toBeCloseTo(0.4, 0);
    });

    it('on-chain is 1.5x more sensitive than delegation', () => {
      const onChainDelta = computeCombinedScore(51, 50) - computeCombinedScore(50, 50);
      const delegationDelta = computeCombinedScore(50, 51) - computeCombinedScore(50, 50);
      expect(onChainDelta / delegationDelta).toBeCloseTo(1.5, 0);
    });

    it('similar wallets get similar combined scores', () => {
      // Wallet A: onChain=60, delegation=50
      // Wallet B: onChain=61, delegation=51
      const a = computeCombinedScore(60, 50);
      const b = computeCombinedScore(61, 51);
      expect(Math.abs(b - a)).toBeLessThan(2);
    });

    it('extreme delegation (0 vs 100) changes combined by 40', () => {
      const low = computeCombinedScore(50, 0);
      const high = computeCombinedScore(50, 100);
      expect(high - low).toBe(40);
    });
  });

  // ── False Positive Analysis ─────────────────────────────────

  describe('False Positive Analysis', () => {
    it('high on-chain + low delegation → allowed (on-chain dominates)', () => {
      // onChain=80, delegation=0: combined=48, confidence=0.56
      const score = computeCombinedScore(80, 0);
      const confidence = computeConfidence(score);
      expect(decideAllow(score, confidence)).toBe(true);
      // But confidence is only 56% — should be flagged for review
      expect(confidence).toBeLessThan(0.70);
    });

    it('low on-chain + high delegation → allowed (delegation saves)', () => {
      // onChain=20, delegation=100: combined=48
      const score = computeCombinedScore(20, 100);
      expect(decideAllow(score, computeConfidence(score))).toBe(true);
    });

    it('both moderate → allowed (borderline)', () => {
      // onChain=45, delegation=30: combined=39 → denied
      const score = computeCombinedScore(45, 30);
      expect(decideAllow(score, computeConfidence(score))).toBe(false);
      // But onChain=50, delegation=30: combined=42 → allowed
      const score2 = computeCombinedScore(50, 30);
      expect(decideAllow(score2, computeConfidence(score2))).toBe(true);
    });
  });

  // ── False Negative Analysis ─────────────────────────────────

  describe('False Negative Analysis', () => {
    it('wallet with no delegation data gets score 0 for delegation', () => {
      // onChain=65, delegation=0: combined=39 → denied
      const score = computeCombinedScore(65, 0);
      expect(score).toBe(39);
      expect(decideAllow(score, computeConfidence(score))).toBe(false);
      // This is a false negative: wallet has good on-chain history
      // but is denied because delegation service returned 0
    });

    it('wallet with moderate scores across both → denied', () => {
      // onChain=50, delegation=25: combined=40 → allowed
      const score = computeCombinedScore(50, 25);
      expect(decideAllow(score, computeConfidence(score))).toBe(true);
      // But onChain=49, delegation=25: combined=39.4 → denied
      const score2 = computeCombinedScore(49, 25);
      expect(decideAllow(score2, computeConfidence(score2))).toBe(false);
    });
  });

  // ── Adversarial Wallet Analysis ─────────────────────────────

  describe('Adversarial Wallet Analysis', () => {
    it('sybil endorsement attack: 5 wallets endorse target', () => {
      // Target has onChain=30, delegation=80 (from 5 sybil endorsements)
      // Combined: 0.6*30 + 0.4*80 = 18+32 = 50 → allowed
      const score = computeCombinedScore(30, 80);
      expect(score).toBe(50);
      expect(decideAllow(score, computeConfidence(score))).toBe(true);
      // But confidence is only 0.60 — sybil detection should catch this
    });

    it('threshold gaming: wallet at 39 adds minimal activity', () => {
      // onChain=39, delegation=0: combined=23.4 → denied
      const score1 = computeCombinedScore(39, 0);
      expect(decideAllow(score1, computeConfidence(score1))).toBe(false);
      // onChain=40, delegation=0: combined=24 → still denied
      const score2 = computeCombinedScore(40, 0);
      expect(decideAllow(score2, computeConfidence(score2))).toBe(false);
      // Need delegation too to reach 40 combined
    });

    it('component isolation: high balance, zero activity', () => {
      // This is tested via the credit path, not counterparty
      // Counterparty uses combinedScore which doesn't directly use balance
      const score = computeCombinedScore(100, 0);
      expect(score).toBe(60);
      expect(decideAllow(score, computeConfidence(score))).toBe(true);
    });
  });

  // ── Threshold Justification ─────────────────────────────────

  describe('Threshold Justification', () => {
    it('approval threshold 40 allows wallets with moderate trust', () => {
      // onChain=50, delegation=25: combined=40 → allowed
      expect(decideAllow(40, 0.50)).toBe(true);
      // onChain=45, delegation=25: combined=39 → denied
      expect(decideAllow(39, 0.50)).toBe(false);
    });

    it('confidence threshold 0.45 prevents low-confidence approvals', () => {
      // Score 40, confidence 0.44 → denied
      expect(decideAllow(40, 0.44)).toBe(false);
      // Score 40, confidence 0.45 → allowed
      expect(decideAllow(40, 0.45)).toBe(true);
    });

    it('risk tiers align with trust score ranges', () => {
      expect(classifyCounterpartyRisk(70)).toBe('low');
      expect(classifyCounterpartyRisk(45)).toBe('medium');
      expect(classifyCounterpartyRisk(20)).toBe('high');
      expect(classifyCounterpartyRisk(19)).toBe('critical');
    });
  });

  // ── Consistency Analysis ────────────────────────────────────

  describe('Consistency Analysis', () => {
    it('same inputs always produce same output (deterministic)', () => {
      for (let i = 0; i < 100; i++) {
        expect(computeCombinedScore(50, 50)).toBe(50);
        expect(decideAllow(50, 0.60)).toBe(true);
      }
    });

    it('combined score is bounded [0, 100]', () => {
      const inputs = [
        [0, 0], [0, 100], [100, 0], [100, 100],
        [50, 50], [30, 70], [70, 30],
      ];
      for (const [onChain, delegation] of inputs) {
        const score = computeCombinedScore(onChain, delegation);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });

    it('confidence is bounded [0.30, 1.00]', () => {
      for (let score = 0; score <= 100; score += 5) {
        const confidence = computeConfidence(score);
        expect(confidence).toBeGreaterThanOrEqual(0.30);
        expect(confidence).toBeLessThanOrEqual(1.00);
      }
    });

    it('explanation always has exactly 3 reasons', () => {
      const inputs = [
        [80, 70, 74, true, 0.85],
        [30, 20, 26, false, 0.40],
        [50, 50, 50, true, 0.60],
        [0, 0, 0, false, 0.30],
      ];
      for (const args of inputs) {
        const reasons = generateCounterpartyExplanation(args[0] as number, args[1] as number, args[2] as number, args[3] as boolean, args[4] as number);
        expect(reasons.length).toBe(3);
      }
    });
  });
});

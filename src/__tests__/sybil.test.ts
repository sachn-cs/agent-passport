import { describe, it, expect } from 'vitest';
import {
  computeCreationClustering,
  computeInteractionDensity,
  computeBalanceSimilarity,
  computeCircularActivity,
  computeTimingRegularity,
  computeAmountFingerprint,
  computeFundingCorrelation,
  computeSybilRisk,
  classifySybilRisk,
  computeSybilConfidence,
  generateSybilExplanation,
} from '../sybil';

describe('Sybil Detection — Pure Math Functions', () => {
  describe('computeCreationClustering', () => {
    it('returns 0 for single wallet', () => {
      expect(computeCreationClustering([1000], 1000)).toBe(0);
    });

    it('returns 0 when no wallets in window', () => {
      expect(computeCreationClustering([1000, 50000], 1000)).toBe(0);
    });

    it('returns 1.0 when all wallets in window', () => {
      expect(computeCreationClustering([1000, 1010, 1020, 1030], 1000)).toBe(1);
    });

    it('returns partial score for mixed cluster', () => {
      const result = computeCreationClustering([1000, 1010, 1020, 50000], 1000);
      expect(result).toBe(0.67);
    });

    it('handles empty array', () => {
      expect(computeCreationClustering([], 1000)).toBe(0);
    });

    it('handles two wallets in window', () => {
      expect(computeCreationClustering([1000, 1010], 1000)).toBe(1);
    });
  });

  describe('computeInteractionDensity', () => {
    it('returns 0 for no transactions', () => {
      expect(computeInteractionDensity(0, 0)).toBe(0);
    });

    it('returns 1.0 for all internal', () => {
      expect(computeInteractionDensity(10, 0)).toBe(1);
    });

    it('returns 0.0 for all external', () => {
      expect(computeInteractionDensity(0, 10)).toBe(0);
    });

    it('returns 0.5 for equal split', () => {
      expect(computeInteractionDensity(5, 5)).toBe(0.5);
    });

    it('rounds to 2 decimal places', () => {
      const result = computeInteractionDensity(1, 3);
      expect(result).toBe(0.25);
    });
  });

  describe('computeBalanceSimilarity', () => {
    it('returns 0 for single wallet', () => {
      expect(computeBalanceSimilarity([100])).toBe(0);
    });

    it('returns 1.0 for identical balances', () => {
      expect(computeBalanceSimilarity([100, 100, 100])).toBe(1);
    });

    it('returns high score for similar balances', () => {
      const result = computeBalanceSimilarity([100, 105, 95]);
      expect(result).toBeGreaterThanOrEqual(0.8);
    });

    it('returns low score for very different balances', () => {
      const result = computeBalanceSimilarity([1, 1000, 500000]);
      expect(result).toBeLessThan(0.5);
    });

    it('returns 0 for all-zero balances', () => {
      expect(computeBalanceSimilarity([0, 0, 0])).toBe(0);
    });

    it('handles empty array', () => {
      expect(computeBalanceSimilarity([])).toBe(0);
    });
  });

  describe('computeCircularActivity', () => {
    it('returns 0 for no transactions', () => {
      expect(computeCircularActivity([])).toBe(0);
    });

    it('returns 1.0 for fully circular (A→B and B→A)', () => {
      const txns = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ];
      expect(computeCircularActivity(txns)).toBe(1);
    });

    it('returns 0 for one-way only', () => {
      const txns = [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
      ];
      expect(computeCircularActivity(txns)).toBe(0);
    });

    it('handles mixed circular and non-circular', () => {
      const txns = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
        { from: 'A', to: 'C' },
      ];
      const result = computeCircularActivity(txns);
      expect(result).toBe(0.5);
    });

    it('ignores self-transactions', () => {
      const txns = [
        { from: 'A', to: 'A' },
        { from: 'A', to: 'B' },
      ];
      expect(computeCircularActivity(txns)).toBe(0);
    });
  });

  describe('computeTimingRegularity', () => {
    it('returns 0 for single interval', () => {
      expect(computeTimingRegularity([100])).toBe(0);
    });

    it('returns 1.0 for perfectly regular intervals', () => {
      expect(computeTimingRegularity([100, 100, 100, 100])).toBe(1);
    });

    it('returns low score for irregular intervals', () => {
      const result = computeTimingRegularity([10, 500, 20, 800]);
      expect(result).toBeLessThan(0.3);
    });

    it('returns 0 for empty array', () => {
      expect(computeTimingRegularity([])).toBe(0);
    });

    it('handles two intervals', () => {
      expect(computeTimingRegularity([100, 100])).toBe(1);
    });
  });

  describe('computeAmountFingerprint', () => {
    it('returns 0 for single amount', () => {
      expect(computeAmountFingerprint([100])).toBe(0);
    });

    it('returns high score for all identical amounts', () => {
      // 10 identical amounts: 1 - 1/10 = 0.9
      expect(computeAmountFingerprint([100, 100, 100, 100, 100, 100, 100, 100, 100, 100])).toBe(0.9);
    });

    it('returns 0 for all different amounts', () => {
      expect(computeAmountFingerprint([100, 200, 300, 400])).toBe(0);
    });

    it('returns 0.5 for half identical', () => {
      expect(computeAmountFingerprint([100, 100, 200, 200])).toBe(0.5);
    });

    it('returns 0 for empty array', () => {
      expect(computeAmountFingerprint([])).toBe(0);
    });
  });

  describe('computeFundingCorrelation', () => {
    it('returns 0 for single funder', () => {
      expect(computeFundingCorrelation(['A'])).toBe(0);
    });

    it('returns high score for all same funder', () => {
      // 10 same funders: 1 - 1/10 = 0.9
      expect(computeFundingCorrelation(['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'])).toBe(0.9);
    });

    it('returns 0 for all different funders', () => {
      expect(computeFundingCorrelation(['A', 'B', 'C', 'D'])).toBe(0);
    });

    it('returns 0.5 for half same', () => {
      expect(computeFundingCorrelation(['A', 'A', 'B', 'B'])).toBe(0.5);
    });

    it('returns 0 for empty array', () => {
      expect(computeFundingCorrelation([])).toBe(0);
    });
  });

  describe('computeSybilRisk', () => {
    it('returns 0 for all-zero signals', () => {
      expect(computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
      })).toBe(0);
    });

    it('returns 1.0 for all-max signals', () => {
      expect(computeSybilRisk({
        creationClustering: 1,
        interactionDensity: 1,
        balanceSimilarity: 1,
        circularActivity: 1,
        timingRegularity: 1,
        amountFingerprint: 1,
        fundingCorrelation: 1,
        neighborhoodClustering: 1,
        hubScore: 1,
        intermediateDensity: 1,
        temporalCorrelation: 1,
      })).toBe(1);
    });

    it('weights creation clustering at 0.20', () => {
      const result = computeSybilRisk({
        creationClustering: 1,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
      });
      expect(result).toBe(0.20);
    });

    it('weights interaction density at 0.15', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 1,
        balanceSimilarity: 0,
        circularActivity: 0,
      });
      expect(result).toBe(0.15);
    });

    it('weights balance similarity at 0.10', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 1,
        circularActivity: 0,
      });
      expect(result).toBe(0.10);
    });

    it('weights circular activity at 0.05', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 1,
      });
      expect(result).toBe(0.05);
    });

    it('weights timing regularity at 0.08', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        timingRegularity: 1,
      });
      expect(result).toBe(0.08);
    });

    it('weights amount fingerprint at 0.05', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        amountFingerprint: 1,
      });
      expect(result).toBe(0.05);
    });

    it('weights funding correlation at 0.02', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        fundingCorrelation: 1,
      });
      expect(result).toBe(0.02);
    });

    it('weights neighborhood clustering at 0.10', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        neighborhoodClustering: 1,
      });
      expect(result).toBe(0.10);
    });

    it('weights hub score at 0.08', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        hubScore: 1,
      });
      expect(result).toBe(0.08);
    });

    it('weights intermediate density at 0.10', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        intermediateDensity: 1,
      });
      expect(result).toBe(0.10);
    });

    it('weights temporal correlation at 0.07', () => {
      const result = computeSybilRisk({
        creationClustering: 0,
        interactionDensity: 0,
        balanceSimilarity: 0,
        circularActivity: 0,
        temporalCorrelation: 1,
      });
      expect(result).toBe(0.07);
    });

    it('clamps to [0, 1]', () => {
      expect(computeSybilRisk({
        creationClustering: 2,
        interactionDensity: 2,
        balanceSimilarity: 2,
        circularActivity: 2,
      })).toBe(1);
    });
  });

  describe('classifySybilRisk', () => {
    it('returns low for risk < 0.25', () => {
      expect(classifySybilRisk(0)).toBe('low');
      expect(classifySybilRisk(0.1)).toBe('low');
      expect(classifySybilRisk(0.24)).toBe('low');
    });

    it('returns medium for risk 0.25-0.44', () => {
      expect(classifySybilRisk(0.25)).toBe('medium');
      expect(classifySybilRisk(0.35)).toBe('medium');
      expect(classifySybilRisk(0.44)).toBe('medium');
    });

    it('returns high for risk 0.45-0.69', () => {
      expect(classifySybilRisk(0.45)).toBe('high');
      expect(classifySybilRisk(0.55)).toBe('high');
      expect(classifySybilRisk(0.69)).toBe('high');
    });

    it('returns critical for risk >= 0.70', () => {
      expect(classifySybilRisk(0.70)).toBe('critical');
      expect(classifySybilRisk(0.91)).toBe('critical');
      expect(classifySybilRisk(1.0)).toBe('critical');
    });
  });

  describe('computeSybilConfidence', () => {
    it('returns 0.50 for 0 data points', () => {
      expect(computeSybilConfidence(0)).toBe(0.50);
    });

    it('increases by 0.12 per data point', () => {
      expect(computeSybilConfidence(1)).toBe(0.62);
      expect(computeSybilConfidence(3)).toBe(0.86);
    });

    it('caps at 0.95', () => {
      expect(computeSybilConfidence(4)).toBe(0.95);
      expect(computeSybilConfidence(10)).toBe(0.95);
    });

    it('never goes below 0.50', () => {
      expect(computeSybilConfidence(-5)).toBe(0.50);
    });
  });

  describe('generateSybilExplanation', () => {
    it('reports no clustering for single wallet', () => {
      const reasons = generateSybilExplanation(1, 0, 0, 0, 0, 0);
      expect(reasons.some(r => r.includes('No clustering detected'))).toBe(true);
    });

    it('reports cluster size', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91);
      expect(reasons.some(r => r.includes('4 wallets'))).toBe(true);
    });

    it('reports high interaction density', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91);
      expect(reasons.some(r => r.includes('95%'))).toBe(true);
    });

    it('reports high balance similarity', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91);
      expect(reasons.some(r => r.includes('85%'))).toBe(true);
    });

    it('reports circular patterns', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91);
      expect(reasons.some(r => r.includes('Circular transaction patterns'))).toBe(true);
    });

    it('reports high sybil risk', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91);
      expect(reasons.some(r => r.includes('High sybil risk'))).toBe(true);
    });

    it('reports low sybil risk for clean wallet', () => {
      const reasons = generateSybilExplanation(1, 0, 0, 0, 0, 0.05);
      expect(reasons.some(r => r.includes('Low sybil risk'))).toBe(true);
    });

    it('reports bot-like timing patterns', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91, 0.9, 0.8, 0.6);
      expect(reasons.some(r => r.includes('Bot-like timing'))).toBe(true);
    });

    it('reports uniform amounts', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91, 0.9, 0.8, 0.6);
      expect(reasons.some(r => r.includes('Uniform transaction amounts'))).toBe(true);
    });

    it('reports common funding source', () => {
      const reasons = generateSybilExplanation(4, 0.9, 0.95, 0.85, 0.7, 0.91, 0.9, 0.8, 0.6);
      expect(reasons.some(r => r.includes('Common funding source'))).toBe(true);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeBalanceCapacity,
  computeActivityBonus,
  computeAgeBonus,
  computeRiskPenalty,
  computeCreditLimit,
  classifyCreditRisk,
  computeCreditConfidence,
  generateCreditExplanation,
} from '../credit';

describe('Credit Capacity Estimation — Pure Math Functions', () => {
  describe('computeBalanceCapacity', () => {
    it('returns 0 for 0 balance', () => {
      expect(computeBalanceCapacity(0)).toBe(0);
    });

    it('returns 50% of balance', () => {
      expect(computeBalanceCapacity(100)).toBe(50);
      expect(computeBalanceCapacity(200)).toBe(100);
    });

    it('caps at 1000', () => {
      expect(computeBalanceCapacity(3000)).toBe(1000);
      expect(computeBalanceCapacity(10000)).toBe(1000);
    });

    it('handles fractional balance', () => {
      expect(computeBalanceCapacity(0.5)).toBe(0.25);
    });
  });

  describe('computeActivityBonus', () => {
    it('returns 0 for 0 txns', () => {
      expect(computeActivityBonus(0)).toBe(0);
    });

    it('returns $2 per transaction', () => {
      expect(computeActivityBonus(10)).toBe(20);
      expect(computeActivityBonus(50)).toBe(100);
    });

    it('caps at 200', () => {
      expect(computeActivityBonus(100)).toBe(200);
      expect(computeActivityBonus(500)).toBe(200);
    });
  });

  describe('computeAgeBonus', () => {
    it('returns 0 for 0 days', () => {
      expect(computeAgeBonus(0)).toBe(0);
    });

    it('scales linearly to $150 at 365 days', () => {
      expect(computeAgeBonus(365)).toBe(150);
      expect(computeAgeBonus(182.5)).toBe(75);
    });

    it('caps at 150', () => {
      expect(computeAgeBonus(730)).toBe(150);
      expect(computeAgeBonus(1000)).toBe(150);
    });
  });

  describe('computeRiskPenalty', () => {
    it('returns 0 when both scores are high', () => {
      expect(computeRiskPenalty(80, 90)).toBe(0);
    });

    it('penalizes low velocity (< 40) continuously', () => {
      expect(computeRiskPenalty(39, 90)).toBe(1.25);
      expect(computeRiskPenalty(20, 90)).toBe(25);
      expect(computeRiskPenalty(0, 90)).toBe(50);
    });

    it('penalizes low compliance (< 60) continuously', () => {
      expect(computeRiskPenalty(80, 59)).toBe(1.67);
      expect(computeRiskPenalty(80, 30)).toBe(50);
      expect(computeRiskPenalty(80, 0)).toBe(100);
    });

    it('penalizes both when both are low', () => {
      expect(computeRiskPenalty(30, 50)).toBe(29.17);
    });

    it('does not penalize velocity at exactly 40', () => {
      expect(computeRiskPenalty(40, 90)).toBe(0);
    });

    it('does not penalize compliance at exactly 60', () => {
      expect(computeRiskPenalty(80, 60)).toBe(0);
    });

    it('max penalty when both are 0', () => {
      expect(computeRiskPenalty(0, 0)).toBe(150);
    });

    it('penalty scales smoothly (no cliff at threshold)', () => {
      const p39 = computeRiskPenalty(39, 90);
      const p40 = computeRiskPenalty(40, 90);
      expect(p39).toBeGreaterThan(0);
      expect(p40).toBe(0);
      expect(p39).toBeLessThan(5);
    });
  });

  describe('computeCreditLimit', () => {
    it('returns 0 for all-zero breakdown', () => {
      expect(computeCreditLimit({
        balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 0,
      })).toBe(0);
    });

    it('computes sum of bonuses minus penalty', () => {
      expect(computeCreditLimit({
        balanceCapacity: 100, activityBonus: 50, ageBonus: 30, riskPenalty: 0,
      })).toBe(180);
    });

    it('subtracts risk penalty', () => {
      expect(computeCreditLimit({
        balanceCapacity: 100, activityBonus: 50, ageBonus: 30, riskPenalty: 100,
      })).toBe(80);
    });

    it('never goes below 0', () => {
      expect(computeCreditLimit({
        balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 500,
      })).toBe(0);
    });

    it('caps at 1350', () => {
      expect(computeCreditLimit({
        balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 0,
      })).toBe(1350);
    });
  });

  describe('classifyCreditRisk', () => {
    it('returns low when ratio >= 2.0', () => {
      expect(classifyCreditRisk(400, 200)).toBe('low');
      expect(classifyCreditRisk(600, 200)).toBe('low');
    });

    it('returns medium when ratio 1.2-2.0', () => {
      expect(classifyCreditRisk(300, 200)).toBe('medium');
      expect(classifyCreditRisk(240, 200)).toBe('medium');
    });

    it('returns high when ratio 0.8-1.2', () => {
      expect(classifyCreditRisk(200, 200)).toBe('high');
      expect(classifyCreditRisk(180, 200)).toBe('high');
    });

    it('returns critical when ratio < 0.8', () => {
      expect(classifyCreditRisk(100, 200)).toBe('critical');
      expect(classifyCreditRisk(0, 200)).toBe('critical');
    });

    it('falls back to absolute limits without requested amount', () => {
      expect(classifyCreditRisk(600)).toBe('low');
      expect(classifyCreditRisk(300)).toBe('medium');
      expect(classifyCreditRisk(100)).toBe('high');
      expect(classifyCreditRisk(20)).toBe('critical');
    });
  });

  describe('computeCreditConfidence', () => {
    it('returns 0.40 for 0 data points', () => {
      expect(computeCreditConfidence(0)).toBe(0.40);
    });

    it('increases by 0.12 per data point', () => {
      expect(computeCreditConfidence(1)).toBe(0.52);
      expect(computeCreditConfidence(3)).toBe(0.76);
    });

    it('caps at 0.95', () => {
      expect(computeCreditConfidence(5)).toBe(0.95);
      expect(computeCreditConfidence(10)).toBe(0.95);
    });

    it('never goes below 0.40', () => {
      expect(computeCreditConfidence(-5)).toBe(0.40);
    });
  });

  describe('generateCreditExplanation', () => {
    it('identifies strong collateral', () => {
      const reasons = generateCreditExplanation(500, 50, 100, 400);
      expect(reasons.some(r => r.includes('strong collateral'))).toBe(true);
    });

    it('identifies minimal collateral', () => {
      const reasons = generateCreditExplanation(0.001, 0, 1, 0);
      expect(reasons.some(r => r.includes('minimal collateral'))).toBe(true);
    });

    it('identifies old account', () => {
      const reasons = generateCreditExplanation(10, 50, 400, 200);
      expect(reasons.some(r => r.includes('year account'))).toBe(true);
    });

    it('identifies new account', () => {
      const reasons = generateCreditExplanation(10, 5, 10, 50);
      expect(reasons.some(r => r.includes('New account'))).toBe(true);
    });

    it('identifies strong activity', () => {
      const reasons = generateCreditExplanation(10, 200, 100, 300);
      expect(reasons.some(r => r.includes('strong activity'))).toBe(true);
    });

    it('reports request within capacity', () => {
      const reasons = generateCreditExplanation(100, 50, 100, 300, 200, true);
      expect(reasons.some(r => r.includes('within estimated capacity'))).toBe(true);
    });

    it('reports request exceeds capacity', () => {
      const reasons = generateCreditExplanation(10, 5, 10, 50, 200, false);
      expect(reasons.some(r => r.includes('exceeds estimated capacity'))).toBe(true);
    });
  });
});

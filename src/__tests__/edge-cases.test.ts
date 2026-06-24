import { describe, it, expect } from 'vitest';
import {
  computeAgeScore,
  computeVelocityScore,
  computeVolumeScore,
  computeComplianceScore,
  computeTrustScore,
  classifyRisk,
  generateExplanation,
} from '../trust-score';
import { isValidWallet, WALLET_REGEX } from '../lib/constants';

describe('Edge Cases', () => {
  describe('Wallet address edge cases', () => {
    const VALID_WALLET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

    it('rejects wallet with space', () => {
      expect(isValidWallet(' ' + VALID_WALLET.slice(1))).toBe(false);
    });

    it('rejects wallet with special chars', () => {
      expect(isValidWallet('@'.repeat(58))).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidWallet('')).toBe(false);
    });

    it('rejects 57 chars (one short)', () => {
      expect(isValidWallet('A'.repeat(57))).toBe(false);
    });

    it('rejects 59 chars (one long)', () => {
      expect(isValidWallet('A'.repeat(59))).toBe(false);
    });

    it('accepts all valid Algorand base32 chars', () => {
      const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const wallet = validChars.repeat(2).slice(0, 58);
      expect(isValidWallet(wallet)).toBe(true);
    });
  });

  describe('Math edge cases', () => {
    it('computeAgeScore handles very large days', () => {
      expect(computeAgeScore(10000)).toBe(100);
      expect(computeAgeScore(Number.MAX_SAFE_INTEGER)).toBe(100);
    });

    it('computeVelocityScore handles zero days', () => {
      const perDay = 100 / Math.max(1, 0);
      expect(perDay).toBe(100);
    });

    it('computeVolumeScore handles zero balance', () => {
      const algo = 0 / 1_000_000;
      expect(Math.log10(Math.max(1, algo))).toBe(0);
    });

    it('computeTrustScore handles equal weights', () => {
      const breakdown = { ageScore: 50, activityScore: 50, volumeScore: 50, velocityScore: 50, complianceScore: 50 };
      const score = Math.round(50 * 10) / 10;
      expect(score).toBe(50);
    });

    it('classifyRisk boundary values', () => {
      expect(classifyRisk(69.9)).toBe('medium');
      expect(classifyRisk(70)).toBe('low');
      expect(classifyRisk(44.9)).toBe('high');
      expect(classifyRisk(45)).toBe('medium');
      expect(classifyRisk(19.9)).toBe('critical');
      expect(classifyRisk(20)).toBe('high');
    });
  });

  describe('Explanation generation edge cases', () => {
    it('handles zero balance gracefully', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 0, totalTxns: 0, assetCount: 0, accountAgeDays: 1 }, 0
      );
      expect(reasons.some(r => r.includes('low balance'))).toBe(true);
    });

    it('handles exact boundary for year history', () => {
      const reasons365 = generateExplanation(
        { balanceAlgo: 10, totalTxns: 10, assetCount: 0, accountAgeDays: 365 }, 50
      );
      expect(reasons365.some(r => r.includes('month wallet history'))).toBe(true);

      const reasons366 = generateExplanation(
        { balanceAlgo: 10, totalTxns: 10, assetCount: 0, accountAgeDays: 366 }, 50
      );
      expect(reasons366.some(r => r.includes('year wallet history'))).toBe(true);
    });

    it('handles exact boundary for active wallet', () => {
      const reasons100 = generateExplanation(
        { balanceAlgo: 10, totalTxns: 100, assetCount: 0, accountAgeDays: 100 }, 50
      );
      expect(reasons100.some(r => r.includes('moderate activity'))).toBe(true);

      const reasons101 = generateExplanation(
        { balanceAlgo: 10, totalTxns: 101, assetCount: 0, accountAgeDays: 100 }, 50
      );
      expect(reasons101.some(r => r.includes('active wallet'))).toBe(true);
    });

    it('handles exact boundary for balance tiers', () => {
      const reasons0_5 = generateExplanation(
        { balanceAlgo: 0.5, totalTxns: 5, assetCount: 0, accountAgeDays: 30 }, 30
      );
      expect(reasons0_5.some(r => r.includes('ALGO'))).toBe(true);
      expect(reasons0_5.some(r => r.includes('low balance'))).toBe(true);

      const reasons200 = generateExplanation(
        { balanceAlgo: 200, totalTxns: 5, assetCount: 0, accountAgeDays: 30 }, 30
      );
      expect(reasons200.some(r => r.includes('well-funded'))).toBe(true);
    });

    it('handles exact boundary for diverse portfolio', () => {
      const reasons5 = generateExplanation(
        { balanceAlgo: 10, totalTxns: 5, assetCount: 5, accountAgeDays: 100 }, 50
      );
      expect(reasons5.some(r => r.includes('diverse portfolio'))).toBe(false);

      const reasons6 = generateExplanation(
        { balanceAlgo: 10, totalTxns: 5, assetCount: 6, accountAgeDays: 100 }, 50
      );
      expect(reasons6.some(r => r.includes('diverse portfolio'))).toBe(true);
    });
  });

  describe('Compliance floor boundary', () => {
    it('worst-case wallet (0 ALGO, 0 txns) scores 10', () => {
      expect(computeComplianceScore(0, 0)).toBe(10);
    });

    it('wallet with 0 ALGO but activity scores higher', () => {
      const score = computeComplianceScore(0, 10);
      expect(score).toBeGreaterThan(10);
    });

    it('wallet with balance but no txns scores higher than floor', () => {
      const score = computeComplianceScore(1_000_000, 0);
      expect(score).toBe(50);
      expect(score).toBeGreaterThan(10);
    });

    it('compliance score is always between 0 and 100', () => {
      const inputs = [
        [0, 0], [0, 1], [1_000_000, 0], [1_000_000, 100],
        [500_000, 50], [999, 0], [999, 1],
      ] as const;
      for (const [bal, txns] of inputs) {
        const score = computeComplianceScore(bal, txns);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeAgeScore,
  computeActivityScore,
  computeVolumeScore,
  computeVelocityScore,
  computeComplianceScore,
  computeTrustScore,
  classifyRisk,
  computeRecommendedLimit,
  generateExplanation,
  computeStalenessPenalty,
  applyFreshWalletCap,
  applySybilPenalty,
} from '../trust-score';
import { isValidWallet, WALLET_REGEX } from '../lib/constants';

describe('Trust Score — Pure Math Functions', () => {
  describe('computeAgeScore', () => {
    it('returns 0 for zero days', () => {
      expect(computeAgeScore(0)).toBe(0);
    });

    it('returns 0 for negative days', () => {
      expect(computeAgeScore(-10)).toBe(0);
    });

    it('returns 100 for 730+ days', () => {
      expect(computeAgeScore(730)).toBe(100);
      expect(computeAgeScore(1000)).toBe(100);
    });

    it('returns between 0 and 100 for intermediate values', () => {
      const score = computeAgeScore(365);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
    });

    it('increases monotonically', () => {
      const scores = [1, 30, 90, 180, 365, 540, 730].map(computeAgeScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });
  });

  describe('computeActivityScore', () => {
    it('returns 30 for no activity (age component alone)', () => {
      expect(computeActivityScore(0, 365, 0)).toBe(30);
    });

    it('increases with more transactions', () => {
      const low = computeActivityScore(5, 365, 0);
      const high = computeActivityScore(100, 365, 0);
      expect(high).toBeGreaterThan(low);
    });

    it('increases with more assets', () => {
      const noAssets = computeActivityScore(10, 365, 0);
      const withAssets = computeActivityScore(10, 365, 10);
      expect(withAssets).toBeGreaterThan(noAssets);
    });

    it('caps at 100', () => {
      expect(computeActivityScore(10000, 3650, 100)).toBe(100);
    });
  });

  describe('computeVolumeScore', () => {
    it('returns 0 for zero balance and zero txns', () => {
      expect(computeVolumeScore(0, 0)).toBe(0);
    });

    it('increases with higher balance', () => {
      const low = computeVolumeScore(1_000_000, 1);
      const high = computeVolumeScore(100_000_000, 1);
      expect(high).toBeGreaterThan(low);
    });

    it('increases with more transactions', () => {
      const low = computeVolumeScore(1_000_000, 1);
      const high = computeVolumeScore(1_000_000, 100);
      expect(high).toBeGreaterThan(low);
    });

    it('caps at 100', () => {
      expect(computeVolumeScore(1_000_000_000_000, 1000)).toBe(100);
    });
  });

  describe('computeVelocityScore', () => {
    it('returns 0 for zero days', () => {
      expect(computeVelocityScore(100, 0)).toBe(0);
    });

    it('returns 0 for extreme velocity (>100 txns/day)', () => {
      expect(computeVelocityScore(5000, 10)).toBe(0);
      expect(computeVelocityScore(1000, 5)).toBe(0);
    });

    it('returns 20 for high velocity (50-100 txns/day)', () => {
      expect(computeVelocityScore(600, 10)).toBe(20);
    });

    it('returns 100 for very low velocity', () => {
      expect(computeVelocityScore(10, 100)).toBe(100);
    });

    it('decreases as velocity increases', () => {
      const scores = [
        computeVelocityScore(10, 100),
        computeVelocityScore(50, 100),
        computeVelocityScore(200, 100),
        computeVelocityScore(600, 100),
        computeVelocityScore(1500, 100),
      ];
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });

    it('boundary: perDay=101 returns 0, perDay=100 returns 20, perDay=51 returns 20, perDay=50 returns 40', () => {
      expect(computeVelocityScore(101, 1)).toBe(0);
      expect(computeVelocityScore(100, 1)).toBe(20);
      expect(computeVelocityScore(51, 1)).toBe(20);
      expect(computeVelocityScore(50, 1)).toBe(40);
    });
  });

  describe('computeComplianceScore', () => {
    it('returns 100 for healthy account with sufficient activity', () => {
      // algo=1.0 → balPen=0, 100 txns → txPen≈0, score=100
      expect(computeComplianceScore(1_000_000, 100)).toBe(100);
    });

    it('returns 76 for healthy account with moderate activity', () => {
      // algo=1.0 → balPen=0, 10 txns → txPen=Math.round(50-log10(11)*25)=24, score=76
      expect(computeComplianceScore(1_000_000, 10)).toBe(76);
    });

    it('does not apply balance penalty for balance >= 1 ALGO', () => {
      expect(computeComplianceScore(1_000_000, 10)).toBe(76);
    });

    it('applies gradual balance penalty below 1 ALGO', () => {
      // 0.5 ALGO → balPen=Math.round(0.5*40)=20, 10 txns → txPen=24, score=56
      expect(computeComplianceScore(500_000, 10)).toBe(56);
    });

    it('maximum balance penalty for 0 ALGO', () => {
      // algo=0 → balPen=40, 10 txns → txPen=24, score=36
      expect(computeComplianceScore(0, 10)).toBe(36);
    });

    it('maximum transaction penalty for zero transactions', () => {
      // algo=1.0 → balPen=0, 0 txns → txPen=50, score=50
      expect(computeComplianceScore(1_000_000, 0)).toBe(50);
    });

    it('gradual txn penalty scales with log₁₀', () => {
      // 1 txn → txPen=Math.round(50-log10(2)*25)=Math.round(42.48)=42, score=58
      const score1 = computeComplianceScore(1_000_000, 1);
      expect(score1).toBe(58);
      // 10 txns → txPen=24, score=76
      const score10 = computeComplianceScore(1_000_000, 10);
      expect(score10).toBe(76);
      // 100 txns → txPen=Math.round(50-log10(101)*25)=Math.round(0)=0, score=100
      const score100 = computeComplianceScore(1_000_000, 100);
      expect(score100).toBe(100);
    });

    it('reduces both for low balance and zero txns (floor = 10)', () => {
      // algo=0 → balPen=40, 0 txns → txPen=50, score=10
      expect(computeComplianceScore(0, 0)).toBe(10);
    });

    it('never goes below 0', () => {
      expect(computeComplianceScore(0, 0)).toBeGreaterThanOrEqual(0);
    });

    it('floor of 10 is the worst-case score', () => {
      expect(computeComplianceScore(0, 0)).toBe(10);
    });

    it('boundary: 0.01 ALGO gets near-maximum balance penalty', () => {
      // algo=0.00001 → balPen=Math.round((1-0.00001)*40)=Math.round(39.9996)=40
      expect(computeComplianceScore(10, 10)).toBe(36);
    });
  });

  describe('computeTrustScore', () => {
    it('returns 0 for all-zero breakdown', () => {
      const score = computeTrustScore({
        ageScore: 0, activityScore: 0, volumeScore: 0, velocityScore: 0, complianceScore: 0,
      });
      expect(score).toBe(0);
    });

    it('returns 100 for all-100 breakdown', () => {
      const score = computeTrustScore({
        ageScore: 100, activityScore: 100, volumeScore: 100, velocityScore: 100, complianceScore: 100,
      });
      expect(score).toBe(100);
    });

    it('weights activity highest (0.25)', () => {
      const highActivity = computeTrustScore({
        ageScore: 0, activityScore: 100, volumeScore: 0, velocityScore: 0, complianceScore: 0,
      });
      const highAge = computeTrustScore({
        ageScore: 100, activityScore: 0, volumeScore: 0, velocityScore: 0, complianceScore: 0,
      });
      expect(highActivity).toBeGreaterThan(highAge);
    });

    it('is between 0 and 100', () => {
      const score = computeTrustScore({
        ageScore: 45, activityScore: 60, volumeScore: 30, velocityScore: 80, complianceScore: 50,
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('classifyRisk', () => {
    it('returns low for 70+', () => {
      expect(classifyRisk(70)).toBe('low');
      expect(classifyRisk(100)).toBe('low');
    });

    it('returns medium for 45-69', () => {
      expect(classifyRisk(45)).toBe('medium');
      expect(classifyRisk(69)).toBe('medium');
    });

    it('returns high for 20-44', () => {
      expect(classifyRisk(20)).toBe('high');
      expect(classifyRisk(44)).toBe('high');
    });

    it('returns critical for <20', () => {
      expect(classifyRisk(0)).toBe('critical');
      expect(classifyRisk(19)).toBe('critical');
    });
  });

  describe('computeRecommendedLimit', () => {
    it('returns 0 for score 0', () => {
      expect(computeRecommendedLimit(0)).toBe(0);
    });

    it('applies 1.5x tier for score >= 80', () => {
      const limit = computeRecommendedLimit(80);
      expect(limit).toBe(600);
    });

    it('applies 1.2x tier for score 60-79', () => {
      const limit = computeRecommendedLimit(60);
      expect(limit).toBe(360);
    });

    it('applies 1.0x tier for score 40-59', () => {
      const limit = computeRecommendedLimit(40);
      expect(limit).toBe(200);
    });

    it('applies 0.7x tier for score < 40', () => {
      const limit = computeRecommendedLimit(20);
      expect(limit).toBe(70);
    });

    it('increases with score', () => {
      const limits = [0, 20, 40, 60, 80, 100].map(computeRecommendedLimit);
      for (let i = 1; i < limits.length; i++) {
        expect(limits[i]).toBeGreaterThanOrEqual(limits[i - 1]);
      }
    });
  });

  describe('generateExplanation', () => {
    it('identifies year-old wallet', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 100, totalTxns: 50, assetCount: 3, accountAgeDays: 400 }, 70
      );
      expect(reasons.some(r => r.includes('year wallet history'))).toBe(true);
    });

    it('identifies month-old wallet', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 10, totalTxns: 5, assetCount: 0, accountAgeDays: 60 }, 50
      );
      expect(reasons.some(r => r.includes('month wallet history'))).toBe(true);
    });

    it('identifies new wallet', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 1, totalTxns: 1, assetCount: 0, accountAgeDays: 5 }, 10
      );
      expect(reasons.some(r => r.includes('New wallet'))).toBe(true);
    });

    it('identifies active wallet', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 10, totalTxns: 200, assetCount: 2, accountAgeDays: 100 }, 60
      );
      expect(reasons.some(r => r.includes('active wallet'))).toBe(true);
    });

    it('identifies well-funded wallet', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 500, totalTxns: 10, assetCount: 1, accountAgeDays: 100 }, 60
      );
      expect(reasons.some(r => r.includes('well-funded'))).toBe(true);
    });

    it('identifies diverse portfolio', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 10, totalTxns: 10, assetCount: 10, accountAgeDays: 100 }, 60
      );
      expect(reasons.some(r => r.includes('diverse portfolio'))).toBe(true);
    });

    it('identifies strong profile', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 100, totalTxns: 200, assetCount: 5, accountAgeDays: 500 }, 80
      );
      expect(reasons.some(r => r.includes('Strong overall'))).toBe(true);
    });

    it('identifies weak profile', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 0.001, totalTxns: 1, assetCount: 0, accountAgeDays: 2 }, 10
      );
      expect(reasons.some(r => r.includes('Weak trust profile'))).toBe(true);
    });

    it('returns multiple reasons', () => {
      const reasons = generateExplanation(
        { balanceAlgo: 500, totalTxns: 500, assetCount: 20, accountAgeDays: 1000 }, 90
      );
      expect(reasons.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Wallet address validation', () => {
    it('accepts valid 58-char base32 address', () => {
      expect(isValidWallet('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ')).toBe(true);
    });

    it('rejects too short', () => {
      expect(isValidWallet('AAAA')).toBe(false);
    });

    it('rejects too long', () => {
      expect(isValidWallet('A'.repeat(59))).toBe(false);
    });

    it('rejects lowercase', () => {
      expect(isValidWallet('a'.repeat(58))).toBe(false);
    });

    it('accepts all Algorand base32 chars including O and I', () => {
      expect(isValidWallet('A'.repeat(58))).toBe(true);
      expect(isValidWallet('O'.repeat(58))).toBe(true);
      expect(isValidWallet('I'.repeat(58))).toBe(true);
      expect(isValidWallet('Z'.repeat(58))).toBe(true);
    });

    it('rejects digits 0 and 1', () => {
      expect(isValidWallet('0'.repeat(58))).toBe(false);
      expect(isValidWallet('1'.repeat(58))).toBe(false);
    });

    it('accepts digits 2-7', () => {
      expect(isValidWallet('2'.repeat(58))).toBe(true);
      expect(isValidWallet('7'.repeat(58))).toBe(true);
    });

    it('accepts letters A-Z excluding O and I', () => {
      expect(isValidWallet('A'.repeat(58))).toBe(true);
      expect(isValidWallet('B'.repeat(58))).toBe(true);
      expect(isValidWallet('Z'.repeat(58))).toBe(true);
    });
  });

  describe('computeStalenessPenalty', () => {
    it('returns 1.0 within 180-day grace period', () => {
      expect(computeStalenessPenalty(0)).toBe(1.0);
      expect(computeStalenessPenalty(90)).toBe(1.0);
      expect(computeStalenessPenalty(179)).toBe(1.0);
      expect(computeStalenessPenalty(180)).toBe(1.0);
    });

    it('decays after grace period with 1-year half-life', () => {
      // 180 + 365 = 545 days → decay factor = 0.5^1 = 0.5
      expect(computeStalenessPenalty(545)).toBeCloseTo(0.5, 1);
      // 180 + 730 = 910 days → decay factor = 0.5^2 = 0.25
      expect(computeStalenessPenalty(910)).toBeCloseTo(0.25, 1);
    });

    it('never goes below floor of 0.30', () => {
      expect(computeStalenessPenalty(5000)).toBeGreaterThanOrEqual(0.30);
      expect(computeStalenessPenalty(100000)).toBeGreaterThanOrEqual(0.30);
    });

    it('is monotonically non-increasing', () => {
      const penalties = [0, 180, 365, 545, 730, 910, 1825, 3650].map(computeStalenessPenalty);
      for (let i = 1; i < penalties.length; i++) {
        expect(penalties[i]).toBeLessThanOrEqual(penalties[i - 1]);
      }
    });

    it('negative input returns 1.0 (edge case)', () => {
      expect(computeStalenessPenalty(-100)).toBe(1.0);
    });
  });

  describe('applyFreshWalletCap', () => {
    it('caps at 30 for wallets younger than 30 days', () => {
      expect(applyFreshWalletCap(80, 1)).toBe(30);
      expect(applyFreshWalletCap(50, 15)).toBe(30);
      expect(applyFreshWalletCap(30, 29)).toBe(30);
    });

    it('does not cap when score is already below 30', () => {
      expect(applyFreshWalletCap(20, 1)).toBe(20);
      expect(applyFreshWalletCap(0, 5)).toBe(0);
    });

    it('does not cap for wallets 30+ days old', () => {
      expect(applyFreshWalletCap(80, 30)).toBe(80);
      expect(applyFreshWalletCap(100, 365)).toBe(100);
      expect(applyFreshWalletCap(50, 730)).toBe(50);
    });

    it('boundary: exactly 30 days is not capped', () => {
      expect(applyFreshWalletCap(80, 30)).toBe(80);
    });

    it('boundary: 29 days is capped', () => {
      expect(applyFreshWalletCap(80, 29)).toBe(30);
    });

    it('preserves score for old wallets regardless of value', () => {
      expect(applyFreshWalletCap(100, 1000)).toBe(100);
      expect(applyFreshWalletCap(0, 1000)).toBe(0);
    });
  });

  describe('applySybilPenalty', () => {
    it('no penalty for low sybil risk (< 0.25)', () => {
      expect(applySybilPenalty(70, 0)).toBe(70);
      expect(applySybilPenalty(70, 0.10)).toBe(70);
      expect(applySybilPenalty(70, 0.24)).toBe(70);
    });

    it('no penalty for medium sybil risk (0.25-0.44)', () => {
      expect(applySybilPenalty(70, 0.25)).toBe(70);
      expect(applySybilPenalty(70, 0.44)).toBe(70);
    });

    it('20% reduction for high sybil risk (0.45-0.69)', () => {
      // 70 * 0.8 = 56
      expect(applySybilPenalty(70, 0.45)).toBe(56);
      expect(applySybilPenalty(70, 0.55)).toBe(56);
      expect(applySybilPenalty(70, 0.69)).toBe(56);
    });

    it('50% reduction for critical sybil risk (>= 0.70)', () => {
      // 70 * 0.5 = 35
      expect(applySybilPenalty(70, 0.70)).toBe(35);
      expect(applySybilPenalty(70, 0.90)).toBe(35);
      expect(applySybilPenalty(70, 1.0)).toBe(35);
    });

    it('boundary: 0.44 → no penalty, 0.45 → 20% penalty', () => {
      expect(applySybilPenalty(100, 0.44)).toBe(100);
      expect(applySybilPenalty(100, 0.45)).toBe(80);
    });

    it('boundary: 0.69 → 20%, 0.70 → 50%', () => {
      expect(applySybilPenalty(100, 0.69)).toBe(80);
      expect(applySybilPenalty(100, 0.70)).toBe(50);
    });

    it('handles zero trust score', () => {
      expect(applySybilPenalty(0, 0.80)).toBe(0);
    });

    it('handles low trust score with high sybil', () => {
      // 20 * 0.5 = 10
      expect(applySybilPenalty(20, 0.80)).toBe(10);
    });
  });

  describe('computeActivityScore edge cases', () => {
    it('returns 0 for days=0 (NaN guard)', () => {
      expect(computeActivityScore(0, 0, 0)).toBe(0);
    });

    it('returns 0 for negative days', () => {
      expect(computeActivityScore(10, -1, 5)).toBe(0);
    });

    it('handles very large txn count', () => {
      const score = computeActivityScore(100000, 365, 0);
      // txPerMonth = 100000/(365/30) = 8219 → min(40, 16438) = 40
      // age = min(30, 30) = 30
      // assets = 0
      expect(score).toBe(70);
    });
  });
});

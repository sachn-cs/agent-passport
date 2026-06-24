import { describe, it, expect } from 'vitest';
import {
  computeReputationScore,
  computeReputationEventMultiplier,
  classifyReputationRisk,
  computeReputationConfidence,
  generateReputationExplanation,
  computeWalletAgePenalty,
  computeEventHash,
  isDuplicateEvent,
  registerEventHash,
  computeTimeWeight,
  computeRecoveryFactor,
  EVENT_WEIGHTS,
} from '../reputation';
import type { ReputationBreakdown } from '../reputation';

function emptyBreakdown(): ReputationBreakdown {
  return {
    successfulPayments: 0,
    successfulPurchases: 0,
    disputes: 0,
    refunds: 0,
    sponsorEndorsements: 0,
    serviceInteractions: 0,
    totalEvents: 0,
    positiveEvents: 0,
    negativeEvents: 0,
  };
}

function makeBreakdown(overrides: Partial<ReputationBreakdown>): ReputationBreakdown {
  const b = emptyBreakdown();
  Object.assign(b, overrides);
  b.totalEvents = b.successfulPayments + b.successfulPurchases + b.disputes +
    b.refunds + b.sponsorEndorsements + b.serviceInteractions;
  b.positiveEvents = b.successfulPayments + b.successfulPurchases +
    b.sponsorEndorsements + b.serviceInteractions;
  b.negativeEvents = b.disputes + b.refunds;
  return b;
}

describe('Reputation Layer — Pure Math Functions', () => {
  describe('computeReputationScore', () => {
    it('returns 0 for empty breakdown', () => {
      expect(computeReputationScore(emptyBreakdown())).toBe(0);
    });

    it('returns 100 for all positive events', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      expect(computeReputationScore(b)).toBe(100);
    });

    it('returns 0 for all negative events', () => {
      const b = makeBreakdown({ disputes: 5 });
      expect(computeReputationScore(b)).toBe(0);
    });

    it('weights payments at 10x', () => {
      const b = makeBreakdown({ successfulPayments: 1, disputes: 1 });
      // positive = 10, negative = 20 → base = 33.3
      // event multiplier: 2 events → 0.50 → 16.7
      expect(computeReputationScore(b)).toBe(16.7);
    });

    it('weights purchases at 8x', () => {
      const b = makeBreakdown({ successfulPurchases: 1, disputes: 1 });
      // positive = 8, negative = 20 → base = 28.6
      // event multiplier: 2 events → 0.50 → 14.3
      expect(computeReputationScore(b)).toBe(14.3);
    });

    it('weights endorsements at 8x (F2: reduced from 15x)', () => {
      const b = makeBreakdown({ sponsorEndorsements: 1, disputes: 1 });
      // positive = 8, negative = 20 → base = 28.6
      // event multiplier: 2 events → 0.50 → 14.3
      expect(computeReputationScore(b)).toBe(14.3);
    });

    it('weights service at 5x', () => {
      const b = makeBreakdown({ serviceInteractions: 1, disputes: 1 });
      // positive = 5, negative = 20 → base = 20
      // event multiplier: 2 events → 0.50 → 10
      expect(computeReputationScore(b)).toBe(10);
    });

    it('weights refunds at 12x', () => {
      const b = makeBreakdown({ successfulPayments: 1, refunds: 1 });
      // positive = 10, negative = 12 → base = 45.5
      // event multiplier: 2 events → 0.50 → 22.8
      expect(computeReputationScore(b)).toBe(22.8);
    });

    it('caps at 100', () => {
      const b = makeBreakdown({ successfulPayments: 1000 });
      expect(computeReputationScore(b)).toBe(100);
    });

    it('handles mixed positive and negative', () => {
      const b = makeBreakdown({
        successfulPayments: 5,
        successfulPurchases: 3,
        disputes: 1,
        refunds: 1,
      });
      // positive = 5*10 + 3*8 = 74, negative = 20 + 12 = 32
      // base = 74/106 = 69.8
      // event mult: 10 events → 1.00 → 69.8
      // recovery factor: pos=8, neg=2, total=10 → 1.0 + 0.8 * 0.2 * 0.2 = 1.03
      // 69.8 * 1.03 = 71.9
      expect(computeReputationScore(b)).toBe(71.9);
    });
  });

  describe('classifyReputationRisk', () => {
    it('returns low for score >= 70', () => {
      expect(classifyReputationRisk(70)).toBe('low');
      expect(classifyReputationRisk(100)).toBe('low');
    });

    it('returns medium for score 45-69', () => {
      expect(classifyReputationRisk(45)).toBe('medium');
      expect(classifyReputationRisk(60)).toBe('medium');
    });

    it('returns high for score 20-44', () => {
      expect(classifyReputationRisk(20)).toBe('high');
      expect(classifyReputationRisk(35)).toBe('high');
    });

    it('returns critical for score < 20', () => {
      expect(classifyReputationRisk(0)).toBe('critical');
      expect(classifyReputationRisk(19)).toBe('critical');
    });
  });

  describe('computeReputationConfidence', () => {
    it('returns 0.40 for 0 events and no recent activity', () => {
      expect(computeReputationConfidence(0, false)).toBe(0.40);
    });

    it('increases with more events', () => {
      expect(computeReputationConfidence(5, false)).toBe(0.51);
      expect(computeReputationConfidence(10, false)).toBe(0.62);
      expect(computeReputationConfidence(20, false)).toBe(0.73);
    });

    it('increases with recent activity', () => {
      expect(computeReputationConfidence(0, true)).toBe(0.51);
    });

    it('caps at 0.95', () => {
      expect(computeReputationConfidence(20, true)).toBe(0.84);
      expect(computeReputationConfidence(100, true)).toBe(0.95);
    });

    it('never goes below 0.40', () => {
      expect(computeReputationConfidence(-5, false)).toBe(0.40);
    });
  });

  describe('generateReputationExplanation', () => {
    it('reports no events for empty breakdown', () => {
      const reasons = generateReputationExplanation(emptyBreakdown(), 0);
      expect(reasons.some(r => r.includes('No reputation events'))).toBe(true);
    });

    it('reports total event count', () => {
      const b = makeBreakdown({ successfulPayments: 3, disputes: 1 });
      const reasons = generateReputationExplanation(b, 50);
      expect(reasons.some(r => r.includes('4 total events'))).toBe(true);
    });

    it('reports successful payments', () => {
      const b = makeBreakdown({ successfulPayments: 5 });
      const reasons = generateReputationExplanation(b, 100);
      expect(reasons.some(r => r.includes('5 successful payments'))).toBe(true);
    });

    it('reports disputes', () => {
      const b = makeBreakdown({ disputes: 2 });
      const reasons = generateReputationExplanation(b, 0);
      expect(reasons.some(r => r.includes('2 disputes'))).toBe(true);
    });

    it('reports refunds', () => {
      const b = makeBreakdown({ refunds: 1 });
      const reasons = generateReputationExplanation(b, 0);
      expect(reasons.some(r => r.includes('1 refund'))).toBe(true);
    });

    it('reports endorsements', () => {
      const b = makeBreakdown({ sponsorEndorsements: 3 });
      const reasons = generateReputationExplanation(b, 100);
      expect(reasons.some(r => r.includes('3 sponsor endorsements'))).toBe(true);
    });

    it('reports strong reputation', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const reasons = generateReputationExplanation(b, 100);
      expect(reasons.some(r => r.includes('Strong reputation'))).toBe(true);
    });

    it('reports poor reputation', () => {
      const b = makeBreakdown({ disputes: 10 });
      const reasons = generateReputationExplanation(b, 0);
      expect(reasons.some(r => r.includes('Poor reputation'))).toBe(true);
    });
  });

  describe('computeReputationEventMultiplier', () => {
    it('returns 0.50 for 0 events', () => {
      expect(computeReputationEventMultiplier(0)).toBe(0.50);
    });

    it('returns 0.50 for 1-2 events', () => {
      expect(computeReputationEventMultiplier(1)).toBe(0.50);
      expect(computeReputationEventMultiplier(2)).toBe(0.50);
    });

    it('returns 0.75 for 3-4 events', () => {
      expect(computeReputationEventMultiplier(3)).toBe(0.75);
      expect(computeReputationEventMultiplier(4)).toBe(0.75);
    });

    it('returns 0.90 for 5-9 events', () => {
      expect(computeReputationEventMultiplier(5)).toBe(0.90);
      expect(computeReputationEventMultiplier(9)).toBe(0.90);
    });

    it('returns 1.00 for 10+ events', () => {
      expect(computeReputationEventMultiplier(10)).toBe(1.00);
      expect(computeReputationEventMultiplier(50)).toBe(1.00);
      expect(computeReputationEventMultiplier(1000)).toBe(1.00);
    });

    it('is monotonically non-decreasing', () => {
      const multipliers = [0, 1, 2, 3, 4, 5, 9, 10, 50].map(computeReputationEventMultiplier);
      for (let i = 1; i < multipliers.length; i++) {
        expect(multipliers[i]).toBeGreaterThanOrEqual(multipliers[i - 1]);
      }
    });

    it('boundary: 2→0.50, 3→0.75, 4→0.75, 5→0.90, 9→0.90, 10→1.00', () => {
      expect(computeReputationEventMultiplier(2)).toBe(0.50);
      expect(computeReputationEventMultiplier(3)).toBe(0.75);
      expect(computeReputationEventMultiplier(4)).toBe(0.75);
      expect(computeReputationEventMultiplier(5)).toBe(0.90);
      expect(computeReputationEventMultiplier(9)).toBe(0.90);
      expect(computeReputationEventMultiplier(10)).toBe(1.00);
    });
  });

  describe('Reputation anti-gaming defenses', () => {
    it('single event gets 50% multiplier (insufficient data)', () => {
      const b = makeBreakdown({ successfulPayments: 1 });
      // base = 100, event multiplier applied internally = 0.50 → score = 50
      const score = computeReputationScore(b);
      expect(score).toBe(50);
    });

    it('10+ events get full multiplier', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const multiplier = computeReputationEventMultiplier(b.totalEvents);
      expect(multiplier).toBe(1.0);
    });

    it('opts are backward-compatible: no opts = no decay/ratio penalty', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      // Without opts, only event multiplier applies
      const score = computeReputationScore(b);
      expect(score).toBe(100); // 10 events → multiplier 1.0
    });

    it('event-to-transaction ratio cap: 1000 events, 5 txns → severe penalty', () => {
      const b = makeBreakdown({ successfulPayments: 1000 });
      const score = computeReputationScore(b, { totalOnChainTxns: 5 });
      // event multiplier = 1.0 (1000 events), base = 100
      // ratio = 1000/5 = 200, penalty = max(0.2, 10/200) = 0.2
      // 100 * 1.0 * 0.2 = 20
      expect(score).toBe(20);
    });

    it('event-to-transaction ratio: 10 events, 10 txns → no ratio penalty', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score = computeReputationScore(b, { totalOnChainTxns: 10 });
      // ratio = 10/10 = 1.0, no penalty
      expect(score).toBe(100);
    });

    it('event-to-transaction ratio: borderline 10:1 → no penalty', () => {
      const b = makeBreakdown({ successfulPayments: 100 });
      const score = computeReputationScore(b, { totalOnChainTxns: 10 });
      // ratio = 100/10 = 10, not > 10, no penalty
      expect(score).toBe(100);
    });

    it('event-to-transaction ratio: 11:1 → penalty applied', () => {
      const b = makeBreakdown({ successfulPayments: 110 });
      const score = computeReputationScore(b, { totalOnChainTxns: 10 });
      // ratio = 110/10 = 11, penalty = max(0.2, 10/11) = 0.909
      // 100 * 1.0 * 0.909 = 90.9 → 90.9
      expect(score).toBe(90.9);
    });

    it('recency decay: active wallet (30 days) → no decay', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score = computeReputationScore(b, { daysSinceLastActivity: 30 });
      expect(score).toBe(100);
    });

    it('recency decay: 180-day boundary → no decay', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score = computeReputationScore(b, { daysSinceLastActivity: 180 });
      expect(score).toBe(100);
    });

    it('recency decay: 365 days inactive → ~25% decay', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      // 365 - 180 = 185 stale days, decay = 0.5^(185/365) ≈ 0.705
      // event mult = 1.0, score = 100 * 1.0 * 0.705 = 70.5
      const score = computeReputationScore(b, { daysSinceLastActivity: 365 });
      expect(score).toBeCloseTo(70.5, 0);
    });

    it('recency decay: 545 days inactive → ~50% decay', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      // 545 - 180 = 365 stale days, decay = 0.5^1 = 0.5
      const score = computeReputationScore(b, { daysSinceLastActivity: 545 });
      expect(score).toBe(50);
    });

    it('recency decay: floor of 10% prevents complete zeroing', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score = computeReputationScore(b, { daysSinceLastActivity: 10000 });
      expect(score).toBeGreaterThanOrEqual(10);
    });

    it('combined defenses: 1000 fake events, 5 txns, 365 days stale', () => {
      const b = makeBreakdown({ successfulPayments: 1000 });
      const score = computeReputationScore(b, {
        totalOnChainTxns: 5,
        daysSinceLastActivity: 365,
      });
      // event mult = 1.0 (1000 events)
      // ratio penalty = 0.2 (ratio=200)
      // recency decay = 0.705 (185 stale days)
      // 100 * 1.0 * 0.2 * 0.705 = 14.1
      expect(score).toBeCloseTo(14.1, 0);
    });

    it('combined defenses: legitimate wallet (10 events, 10 txns, 30 days)', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score = computeReputationScore(b, {
        totalOnChainTxns: 10,
        daysSinceLastActivity: 30,
      });
      // event mult = 1.0, no ratio penalty, no recency decay
      expect(score).toBe(100);
    });
  });

  describe('EVENT_WEIGHTS constant', () => {
    it('exports correct weights', () => {
      expect(EVENT_WEIGHTS).toEqual({
        payment: 10,
        purchase: 8,
        dispute: 20,
        refund: 12,
        endorsement: 8,
        service: 5,
      });
    });

    it('endorsement weight is 8 (not 15x — F2)', () => {
      expect(EVENT_WEIGHTS.endorsement).toBe(8);
    });

    it('dispute is the highest weight event type', () => {
      const weights = Object.values(EVENT_WEIGHTS);
      expect(EVENT_WEIGHTS.dispute).toBe(Math.max(...weights));
    });
  });

  describe('computeWalletAgePenalty (F3)', () => {
    it('returns 0.5 for 0-day-old wallet (minimum penalty)', () => {
      expect(computeWalletAgePenalty(0)).toBe(0.5);
    });

    it('returns 0.5 for 1-day-old wallet', () => {
      expect(computeWalletAgePenalty(1)).toBe(0.5);
    });

    it('returns 0.5 for all wallets under 30 days (step function)', () => {
      expect(computeWalletAgePenalty(0)).toBe(0.5);
      expect(computeWalletAgePenalty(1)).toBe(0.5);
      expect(computeWalletAgePenalty(15)).toBe(0.5);
      expect(computeWalletAgePenalty(29)).toBe(0.5);
    });

    it('returns 1.0 for 30-day-old wallet (no penalty)', () => {
      expect(computeWalletAgePenalty(30)).toBe(1.0);
    });

    it('returns 1.0 for 60-day-old wallet (no penalty)', () => {
      expect(computeWalletAgePenalty(60)).toBe(1.0);
    });

    it('returns 1.0 for 365-day-old wallet (no penalty)', () => {
      expect(computeWalletAgePenalty(365)).toBe(1.0);
    });

    it('monotonically increases from 0 to 30 days', () => {
      for (let days = 0; days <= 30; days++) {
        const penalty = computeWalletAgePenalty(days);
        expect(penalty).toBeGreaterThanOrEqual(0.5);
        expect(penalty).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('computeTimeWeight (F7)', () => {
    it('returns 1.0 for 0-day-old event (just occurred)', () => {
      expect(computeTimeWeight(0)).toBe(1.0);
    });

    it('returns ~0.69 for 182-day-old event (~half-year decay)', () => {
      // exp(-182 / 365 * ln2) = exp(-0.5 * 0.693) = exp(-0.347) ≈ 0.707
      const weight = computeTimeWeight(182);
      expect(weight).toBeGreaterThanOrEqual(0.70);
      expect(weight).toBeLessThanOrEqual(0.72);
    });

    it('returns ~0.5 for 365-day-old event (1-year half-life)', () => {
      // exp(-365 / 365 * ln2) = exp(-0.693) ≈ 0.5
      const weight = computeTimeWeight(365);
      expect(weight).toBeGreaterThanOrEqual(0.49);
      expect(weight).toBeLessThanOrEqual(0.51);
    });

    it('returns ~0.25 for 730-day-old event (2 years)', () => {
      // exp(-730 / 365 * ln2) = exp(-1.386) ≈ 0.25
      const weight = computeTimeWeight(730);
      expect(weight).toBeGreaterThanOrEqual(0.24);
      expect(weight).toBeLessThanOrEqual(0.26);
    });

    it('never goes below 0.10 floor', () => {
      expect(computeTimeWeight(3650)).toBeGreaterThanOrEqual(0.10);
      expect(computeTimeWeight(10000)).toBeGreaterThanOrEqual(0.10);
    });

    it('monotonically decreases over time', () => {
      let prev = computeTimeWeight(0);
      for (let days = 30; days <= 3650; days += 30) {
        const current = computeTimeWeight(days);
        expect(current).toBeLessThanOrEqual(prev);
        prev = current;
      }
    });
  });

  describe('computeRecoveryFactor (F8)', () => {
    it('returns 1.0 for zero total (no events)', () => {
      expect(computeRecoveryFactor(0, 0, 0)).toBe(1.0);
    });

    it('returns 1.0 for all-positive events (100% positive ratio)', () => {
      // 0.8 + 0.2 * 1.0 * 1.0 = 1.0
      expect(computeRecoveryFactor(50, 0, 50)).toBe(1.0);
    });

    it('returns 1.0 for no negative events', () => {
      expect(computeRecoveryFactor(10, 0, 10)).toBe(1.0);
    });

    it('returns 1.0 for all-negative events (positiveEvents=0 → early return)', () => {
      expect(computeRecoveryFactor(0, 50, 50)).toBe(1.0);
    });

    it('partial recovery with 70% positive ratio', () => {
      // 1.0 + 0.7 * 1.0 * 0.2 = 1.14
      const factor = computeRecoveryFactor(35, 15, 50);
      expect(factor).toBeCloseTo(1.14, 2);
    });

    it('partial recovery with 30% positive ratio', () => {
      // 1.0 + 0.3 * 1.0 * 0.2 = 1.06
      const factor = computeRecoveryFactor(15, 35, 50);
      expect(factor).toBeCloseTo(1.06, 2);
    });

    it('recovery factor is >= 1.0 when both positive and negative exist', () => {
      for (let pos = 1; pos <= 99; pos++) {
        const factor = computeRecoveryFactor(pos, 100 - pos, 100);
        expect(factor).toBeGreaterThanOrEqual(1.0);
      }
    });

    it('recovery factor max depends on positive ratio and event count', () => {
      // 100% positive → early return (negativeEvents === 0)
      const factor = computeRecoveryFactor(50, 0, 50);
      expect(factor).toBe(1.0);

      // 99% positive, 1 negative, 100 total
      const factor2 = computeRecoveryFactor(99, 1, 100);
      // = 1.0 + (99/100) * 1.0 * 0.2 = 1.198
      expect(factor2).toBeCloseTo(1.20, 1);
    });
  });

  describe('computeEventHash (F4)', () => {
    it('produces consistent hash for same inputs', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      const hash2 = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different wallet', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      const hash2 = computeEventHash('wallet999', 'payment', 'wallet2', 12345);
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash for different type', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      const hash2 = computeEventHash('wallet1', 'dispute', 'wallet2', 12345);
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash for different counterparty', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      const hash2 = computeEventHash('wallet1', 'payment', 'wallet3', 12345);
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash for different round', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      const hash2 = computeEventHash('wallet1', 'payment', 'wallet2', 12346);
      expect(hash1).not.toBe(hash2);
    });

    it('returns a string', () => {
      const hash = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('isDuplicateEvent (F4)', () => {
    it('returns false for event not seen before', () => {
      const hash = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      expect(isDuplicateEvent(hash)).toBe(false);
    });

    it('returns true after registering the same event', () => {
      const hash = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      registerEventHash(hash);
      expect(isDuplicateEvent(hash)).toBe(true);
    });

    it('returns false for different event parameters', () => {
      const hash = computeEventHash('wallet1', 'payment', 'wallet2', 12345);
      registerEventHash(hash);
      expect(isDuplicateEvent(computeEventHash('wallet1', 'payment', 'wallet2', 12346))).toBe(false);
      expect(isDuplicateEvent(computeEventHash('wallet1', 'dispute', 'wallet2', 12345))).toBe(false);
      expect(isDuplicateEvent(computeEventHash('wallet999', 'payment', 'wallet2', 12345))).toBe(false);
    });
  });
});

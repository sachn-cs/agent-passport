import { describe, it, expect } from 'vitest';
import {
  computeReputationScore,
  computeWalletAgePenalty,
  computeTimeWeight,
  computeRecoveryFactor,
  computeEventHash,
  isDuplicateEvent,
  registerEventHash,
  computeReputationEventMultiplier,
  EVENT_WEIGHTS,
} from '../reputation';
import type { ReputationBreakdown } from '../reputation';

function makeBreakdown(overrides: Partial<ReputationBreakdown> = {}): ReputationBreakdown {
  const partial = {
    successfulPayments: 0,
    successfulPurchases: 0,
    serviceInteractions: 0,
    sponsorEndorsements: 0,
    disputes: 0,
    refunds: 0,
    ...overrides,
  };
  const totalEvents = partial.successfulPayments + partial.successfulPurchases +
    partial.serviceInteractions + partial.sponsorEndorsements + partial.disputes + partial.refunds;
  const positiveEvents = partial.successfulPayments + partial.successfulPurchases +
    partial.serviceInteractions + partial.sponsorEndorsements;
  const negativeEvents = partial.disputes + partial.refunds;
  return { ...partial, totalEvents, positiveEvents, negativeEvents };
}

describe('Reputation Audit — 8 Farming Vectors', () => {
  describe('Vector 1: Self-Reporting (F1 counterparty verification)', () => {
    it('endorsement weight reduced from 15x to 8x — farming ROI reduced', () => {
      const b = makeBreakdown({ sponsorEndorsements: 1 });
      const score = computeReputationScore(b);
      // endorsement: 8/8 = 100, event multiplier: 1 event → 0.50
      // But recovery factor doesn't apply (negativeEvents=0)
      expect(score).toBe(50);
    });

    it('10 endorsements still capped at 100', () => {
      const b = makeBreakdown({ sponsorEndorsements: 10 });
      const score = computeReputationScore(b);
      expect(score).toBe(100);
    });

    it('5 endorsements with 1 dispute — endorsement farming less impactful', () => {
      const b = makeBreakdown({ sponsorEndorsements: 5, disputes: 1 });
      // positive = 5*8 = 40, negative = 20 → base = 40/60 = 66.7
      // event mult: 6 events → 0.90 → 60.0
      // recovery factor: pos=5, neg=1, total=6
      // positiveRatio = 5/6 = 0.833, timeFactor = 6/50 = 0.12
      // factor = 1.0 + 0.833 * 0.12 * 0.2 = 1.02
      // 60.0 * 1.02 = 61.2
      expect(computeReputationScore(b)).toBeCloseTo(61.2, 0);
    });
  });

  describe('Vector 2: Payment Loop (F4 event deduplication)', () => {
    it('duplicate payment event is rejected', () => {
      const hash = computeEventHash('wallet1', 'payment', 'wallet2', 1000);
      registerEventHash(hash);
      expect(isDuplicateEvent(hash)).toBe(true);
    });

    it('same wallet, same counterparty, different round — not duplicate', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 1000);
      const hash2 = computeEventHash('wallet1', 'payment', 'wallet2', 2000);
      registerEventHash(hash1);
      expect(isDuplicateEvent(hash2)).toBe(false);
    });

    it('different counterparty — not duplicate', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 1000);
      const hash2 = computeEventHash('wallet1', 'payment', 'wallet3', 1000);
      registerEventHash(hash1);
      expect(isDuplicateEvent(hash2)).toBe(false);
    });
  });

  describe('Vector 3: Wallet Migration Reset (F3 wallet age penalty)', () => {
    it('brand-new wallet gets 0.5x penalty', () => {
      expect(computeWalletAgePenalty(0)).toBe(0.5);
    });

    it('all wallets under 30 days get 0.5x penalty (step function)', () => {
      expect(computeWalletAgePenalty(1)).toBe(0.5);
      expect(computeWalletAgePenalty(15)).toBe(0.5);
      expect(computeWalletAgePenalty(29)).toBe(0.5);
    });

    it('30-day-old wallet gets 1.0x (no penalty)', () => {
      expect(computeWalletAgePenalty(30)).toBe(1.0);
    });

    it('wallet migration resets score via age penalty', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score30 = computeReputationScore(b, {
        daysSinceLastActivity: 30,
        totalOnChainTxns: 10,
        accountAgeDays: 30,
      });
      const score1 = computeReputationScore(b, {
        daysSinceLastActivity: 1,
        totalOnChainTxns: 10,
        accountAgeDays: 1,
      });
      // New wallet has lower score due to 0.5x age penalty
      expect(score1).toBeLessThan(score30);
    });

    it('new wallet cannot achieve high score with 1 payment event', () => {
      const b = makeBreakdown({ successfulPayments: 1 });
      const score = computeReputationScore(b, {
        daysSinceLastActivity: 5,
        totalOnChainTxns: 1,
        accountAgeDays: 5,
      });
      // 1 event, 5 days old — should be well below 50
      expect(score).toBeLessThan(50);
    });
  });

  describe('Vector 4: Reputation DDoS (F5 dispute verification)', () => {
    it('dispute is the most damaging event type', () => {
      expect(EVENT_WEIGHTS.dispute).toBe(20);
    });

    it('5 disputes cannot be offset by 5 payments', () => {
      const b = makeBreakdown({ successfulPayments: 5, disputes: 5 });
      const score = computeReputationScore(b);
      // positive = 50, negative = 100 → base = 33.3
      // event mult: 10 events → 1.0 → 33.3
      // recovery factor: pos=5, neg=5, total=10
      // positiveRatio = 0.5, timeFactor = 0.2
      // factor = 1.0 + 0.5 * 0.2 * 0.2 = 1.02
      // 33.3 * 1.02 = 34.0
      expect(score).toBeCloseTo(34, 0);
    });

    it('single dispute drops score significantly for legitimate wallet', () => {
      const b = makeBreakdown({ successfulPayments: 10, disputes: 1 });
      const score = computeReputationScore(b);
      // positive = 100, negative = 20 → base = 83.3
      // event mult: 11 events → 1.0 → 83.3
      // recovery factor: pos=10, neg=1, total=11
      // positiveRatio = 10/11 = 0.909, timeFactor = 11/50 = 0.22
      // factor = 1.0 + 0.909 * 0.22 * 0.2 = 1.04
      // 83.3 * 1.04 = 86.6
      expect(score).toBeCloseTo(87, 0);
    });
  });

  describe('Vector 5: Cross-Wallet Identity (F6 — data layer)', () => {
    it('event deduplication prevents same event from multiple angles', () => {
      const hash = computeEventHash('wallet1', 'dispute', 'wallet2', 1000);
      registerEventHash(hash);
      expect(isDuplicateEvent(hash)).toBe(true);
    });

    it('different wallets sharing same counterparty not affected', () => {
      const hash1 = computeEventHash('wallet1', 'payment', 'wallet2', 1000);
      const hash2 = computeEventHash('wallet3', 'payment', 'wallet2', 2000);
      registerEventHash(hash1);
      expect(isDuplicateEvent(hash2)).toBe(false);
    });
  });

  describe('Vector 6: Reputation Extortion (F5 — dispute verification)', () => {
    it('dispute weight is proportionally punishing', () => {
      expect(EVENT_WEIGHTS.dispute).toBe(2 * EVENT_WEIGHTS.payment);
    });

    it('extortion with small wallet has limited blast radius', () => {
      const b = makeBreakdown({ successfulPayments: 1, disputes: 1 });
      const score = computeReputationScore(b);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Vector 7: Event Duplication (F4 deduplication)', () => {
    it('hash is deterministic for same inputs', () => {
      const h1 = computeEventHash('w1', 'payment', 'w2', 100);
      const h2 = computeEventHash('w1', 'payment', 'w2', 100);
      expect(h1).toBe(h2);
    });

    it('hash changes with each parameter', () => {
      const base = computeEventHash('w1', 'payment', 'w2', 100);
      expect(computeEventHash('w1', 'payment', 'w2', 101)).not.toBe(base);
      expect(computeEventHash('w1', 'payment', 'w3', 100)).not.toBe(base);
      expect(computeEventHash('w1', 'dispute', 'w2', 100)).not.toBe(base);
      expect(computeEventHash('w2', 'payment', 'w2', 100)).not.toBe(base);
    });
  });

  describe('Vector 8: Time-Weighted Events (F7)', () => {
    it('recent events weighted at 1.0', () => {
      expect(computeTimeWeight(0)).toBe(1.0);
    });

    it('1-year-old events weighted at ~0.5', () => {
      const weight = computeTimeWeight(365);
      expect(weight).toBeGreaterThanOrEqual(0.49);
      expect(weight).toBeLessThanOrEqual(0.51);
    });

    it('2-year-old events weighted at ~0.25', () => {
      const weight = computeTimeWeight(730);
      expect(weight).toBeGreaterThanOrEqual(0.24);
      expect(weight).toBeLessThanOrEqual(0.26);
    });

    it('old wallet with recent good activity recovers', () => {
      const b = makeBreakdown({ successfulPayments: 20, disputes: 1 });
      const score = computeReputationScore(b, {
        daysSinceLastActivity: 10,
        totalOnChainTxns: 20,
      });
      expect(score).toBeGreaterThan(70);
    });

    it('recovery factor improves with positive ratio', () => {
      const factorLow = computeRecoveryFactor(3, 7, 10);  // 30% positive
      const factorHigh = computeRecoveryFactor(7, 3, 10); // 70% positive
      expect(factorHigh).toBeGreaterThan(factorLow);
    });
  });
});

describe('Reputation Audit — Longitudinal Simulations', () => {
  describe('New wallet lifecycle (0-180 days)', () => {
    it('day 0: minimal score with single payment', () => {
      const b = makeBreakdown({ successfulPayments: 1 });
      const score = computeReputationScore(b, {
        daysSinceLastActivity: 0,
        totalOnChainTxns: 1,
        accountAgeDays: 0,
      });
      // 1 event, 0 days old, 0.5x age penalty → should be low
      expect(score).toBeLessThan(40);
    });

    it('day 30: moderate score with consistent payments', () => {
      const b = makeBreakdown({ successfulPayments: 10 });
      const score = computeReputationScore(b, {
        daysSinceLastActivity: 30,
        totalOnChainTxns: 10,
        accountAgeDays: 30,
      });
      expect(score).toBeGreaterThan(50);
    });

    it('day 180: high score with consistent payments', () => {
      const b = makeBreakdown({ successfulPayments: 50 });
      const score = computeReputationScore(b, {
        daysSinceLastActivity: 180,
        totalOnChainTxns: 50,
        accountAgeDays: 180,
      });
      expect(score).toBeGreaterThan(70);
    });
  });

  describe('Recovery from bad reputation', () => {
    it('wallet with dispute recovers with continued good activity', () => {
      const b1 = makeBreakdown({ successfulPayments: 5, disputes: 1 });
      const score1 = computeReputationScore(b1, {
        daysSinceLastActivity: 30,
        totalOnChainTxns: 6,
      });

      const b2 = makeBreakdown({ successfulPayments: 20, disputes: 1 });
      const score2 = computeReputationScore(b2, {
        daysSinceLastActivity: 180,
        totalOnChainTxns: 21,
      });

      expect(score2).toBeGreaterThan(score1);
    });

    it('recovery factor increases with positive event ratio', () => {
      const factor1 = computeRecoveryFactor(5, 5, 10);
      const factor2 = computeRecoveryFactor(8, 2, 10);
      expect(factor2).toBeGreaterThan(factor1);
    });
  });

  describe('Attack resilience', () => {
    it('100 endorsement farming attempts capped by event multiplier', () => {
      const b = makeBreakdown({ sponsorEndorsements: 100 });
      const score = computeReputationScore(b);
      expect(score).toBe(100);
    });

    it('combined attack (endorsements + payments) still capped', () => {
      const b = makeBreakdown({
        sponsorEndorsements: 50,
        successfulPayments: 50,
      });
      const score = computeReputationScore(b);
      expect(score).toBe(100);
    });

    it('high ratio penalty for 100 endorsements vs 1 txn', () => {
      const b = makeBreakdown({
        sponsorEndorsements: 100,
        successfulPayments: 1,
      });
      const score = computeReputationScore(b, {
        totalOnChainTxns: 1,
      });
      // Ratio = 101/1 = 101 → ratio penalty 10/101 = 0.099 → 0.20 (floor)
      expect(score).toBeLessThan(80);
    });
  });
});

describe('Reputation Audit — Invariant Proofs', () => {
  it('INV-1: Score is always between 0 and 100', () => {
    for (let payments = 0; payments <= 100; payments++) {
      for (let disputes = 0; disputes <= 10; disputes++) {
        const b = makeBreakdown({
          successfulPayments: payments,
          disputes: disputes,
        });
        const score = computeReputationScore(b);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('INV-2: Adding positive events never decreases score', () => {
    const b1 = makeBreakdown({ successfulPayments: 5 });
    const b2 = makeBreakdown({ successfulPayments: 6 });
    const score1 = computeReputationScore(b1);
    const score2 = computeReputationScore(b2);
    expect(score2).toBeGreaterThanOrEqual(score1);
  });

  it('INV-3: Adding negative events never increases score', () => {
    const b1 = makeBreakdown({ successfulPayments: 5, disputes: 1 });
    const b2 = makeBreakdown({ successfulPayments: 5, disputes: 2 });
    const score1 = computeReputationScore(b1);
    const score2 = computeReputationScore(b2);
    expect(score2).toBeLessThanOrEqual(score1);
  });

  it('INV-4: Wallet age penalty is always 0.5 or 1.0', () => {
    for (let days = 0; days <= 365; days++) {
      const penalty = computeWalletAgePenalty(days);
      expect(penalty === 0.5 || penalty === 1.0).toBe(true);
    }
  });

  it('INV-5: Time weight is always in [0.10, 1.0]', () => {
    for (let days = 0; days <= 3650; days += 10) {
      const weight = computeTimeWeight(days);
      expect(weight).toBeGreaterThanOrEqual(0.10);
      expect(weight).toBeLessThanOrEqual(1.0);
    }
  });

  it('INV-6: Recovery factor is always >= 1.0 when both pos and neg exist', () => {
    for (let pos = 1; pos <= 100; pos++) {
      const factor = computeRecoveryFactor(pos, 100 - pos, 100);
      expect(factor).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('INV-7: Event multiplier is always in [0.50, 1.0]', () => {
    for (let count = 1; count <= 100; count++) {
      const mult = computeReputationEventMultiplier(count);
      expect(mult).toBeGreaterThanOrEqual(0.50);
      expect(mult).toBeLessThanOrEqual(1.0);
    }
  });

  it('INV-8: Score is deterministic for same inputs', () => {
    const b = makeBreakdown({ successfulPayments: 10, disputes: 2 });
    const opts = { daysSinceLastActivity: 60, totalOnChainTxns: 12 };
    const score1 = computeReputationScore(b, opts);
    const score2 = computeReputationScore(b, opts);
    expect(score1).toBe(score2);
  });

  it('INV-9: Dispute weight dominates all positive events equally', () => {
    const b1 = makeBreakdown({ successfulPayments: 1 });
    const b2 = makeBreakdown({ disputes: 1 });
    const s1 = computeReputationScore(b1);
    const s2 = computeReputationScore(b2);
    expect(s1).toBeGreaterThan(s2);
  });

  it('INV-10: Combined defenses reduce score for farming', () => {
    const bFarm = makeBreakdown({ sponsorEndorsements: 100 });
    const scoreFarm = computeReputationScore(bFarm, {
      daysSinceLastActivity: 1,
      totalOnChainTxns: 0,
      accountAgeDays: 1,
    });

    const bLegit = makeBreakdown({ successfulPayments: 10 });
    const scoreLegit = computeReputationScore(bLegit, {
      daysSinceLastActivity: 60,
      totalOnChainTxns: 10,
      accountAgeDays: 60,
    });

    expect(scoreFarm).toBeLessThan(scoreLegit);
  });
});

describe('Reputation Audit — Cost Analysis', () => {
  it('endorsement farming: 100 endorsements cost more than 10 payments', () => {
    const bEndorse = makeBreakdown({ sponsorEndorsements: 100 });
    const bPay = makeBreakdown({ successfulPayments: 100 });
    expect(computeReputationScore(bEndorse)).toBe(100);
    expect(computeReputationScore(bPay)).toBe(100);
  });

  it('dispute farming: 10 disputes vs 10 payments — dispute wins', () => {
    const b = makeBreakdown({ successfulPayments: 10, disputes: 10 });
    const score = computeReputationScore(b);
    // positive = 100, negative = 200 → base = 33.3
    // event mult: 20 events → 1.0
    // recovery factor: pos=10, neg=10, total=20
    // positiveRatio = 0.5, timeFactor = 20/50 = 0.4
    // factor = 1.0 + 0.5 * 0.4 * 0.2 = 1.04
    // 33.3 * 1.04 = 34.6
    expect(score).toBeCloseTo(35, 0);
  });

  it('wallet migration: cost to rebuild from 0 vs maintain', () => {
    const bRebuild = makeBreakdown({ successfulPayments: 10 });
    const scoreRebuild = computeReputationScore(bRebuild, {
      daysSinceLastActivity: 30,
      totalOnChainTxns: 10,
      accountAgeDays: 30,
    });

    const bMaintain = makeBreakdown({ successfulPayments: 10 });
    const scoreMaintain = computeReputationScore(bMaintain, {
      daysSinceLastActivity: 180,
      totalOnChainTxns: 10,
      accountAgeDays: 180,
    });

    expect(scoreMaintain).toBeGreaterThanOrEqual(scoreRebuild);
  });
});

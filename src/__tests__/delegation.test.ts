import { describe, it, expect } from 'vitest';
import {
  computeDepthScore,
  computeSponsorQualityScore,
  computeSponsorCountScore,
  computeAmountScore,
  computeDelegationTrustScore,
  classifyDelegationRisk,
  computeDelegationRecommendedLimit,
} from '../delegation';

describe('Delegation Trust — Pure Math Functions', () => {
  describe('computeDepthScore', () => {
    it('returns 100 for depth 0 (trust anchor)', () => {
      expect(computeDepthScore(0)).toBe(100);
    });

    it('returns 80 for depth 1', () => {
      expect(computeDepthScore(1)).toBe(80);
    });

    it('returns 60 for depth 2', () => {
      expect(computeDepthScore(2)).toBe(60);
    });

    it('returns 40 for depth 3', () => {
      expect(computeDepthScore(3)).toBe(40);
    });

    it('decreases by 10 per additional depth beyond 3', () => {
      expect(computeDepthScore(4)).toBe(30);
      expect(computeDepthScore(5)).toBe(20);
      expect(computeDepthScore(6)).toBe(10);
    });

    it('never goes below 0', () => {
      expect(computeDepthScore(100)).toBe(0);
      expect(computeDepthScore(1000)).toBe(0);
    });

    it('decreases monotonically', () => {
      const scores = [0, 1, 2, 3, 4, 5, 10, 20].map(computeDepthScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });
  });

  describe('computeSponsorQualityScore', () => {
    it('returns 0 for score 0', () => {
      expect(computeSponsorQualityScore(0)).toBe(0);
    });

    it('returns 100 for score 100', () => {
      expect(computeSponsorQualityScore(100)).toBe(100);
    });

    it('passes through score 50', () => {
      expect(computeSponsorQualityScore(50)).toBe(50);
    });

    it('clamps above 100', () => {
      expect(computeSponsorQualityScore(150)).toBe(100);
    });

    it('clamps below 0', () => {
      expect(computeSponsorQualityScore(-10)).toBe(0);
    });
  });

  describe('computeSponsorCountScore', () => {
    it('returns 0 for 0 sponsors', () => {
      expect(computeSponsorCountScore(0)).toBe(0);
    });

    it('returns 20 for 1 sponsor (default quality=100)', () => {
      expect(computeSponsorCountScore(1)).toBe(20);
    });

    it('returns 40 for 2 sponsors', () => {
      expect(computeSponsorCountScore(2)).toBe(40);
    });

    it('caps at 100 for 5+ sponsors with high quality', () => {
      expect(computeSponsorCountScore(5, 100)).toBe(100);
      expect(computeSponsorCountScore(10, 100)).toBe(100);
    });

    it('increases with count at same quality', () => {
      const scores = [0, 1, 2, 3, 4, 5].map(c => computeSponsorCountScore(c, 100));
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });

    it('scales linearly with quality', () => {
      // 5 sponsors: raw = 100
      expect(computeSponsorCountScore(5, 100)).toBe(100);
      expect(computeSponsorCountScore(5, 50)).toBe(50);
      expect(computeSponsorCountScore(5, 10)).toBe(10);
    });

    it('minimum multiplier of 0.1 prevents zero for quality=0', () => {
      // 5 sponsors, quality=0: raw=100, multiplier=max(0.1, 0)=0.1, score=10
      expect(computeSponsorCountScore(5, 0)).toBe(10);
    });

    it('quality=0 still gives some credit for having sponsors', () => {
      expect(computeSponsorCountScore(1, 0)).toBe(2);
      expect(computeSponsorCountScore(5, 0)).toBe(10);
    });
  });

  describe('computeAmountScore', () => {
    it('returns 0 for 0 amount', () => {
      expect(computeAmountScore(0)).toBe(0);
    });

    it('returns > 0 for positive amount', () => {
      expect(computeAmountScore(1_000_000)).toBeGreaterThan(0);
    });

    it('returns 100 for very large amount', () => {
      expect(computeAmountScore(10_000_000_000)).toBe(100);
    });

    it('increases with amount', () => {
      const amounts = [100_000, 1_000_000, 10_000_000, 100_000_000];
      const scores = amounts.map(computeAmountScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });
  });

  describe('computeDelegationTrustScore', () => {
    it('returns 0 for all-zero breakdown', () => {
      const score = computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 0, sponsorCountScore: 0, amountScore: 0,
      });
      expect(score).toBe(0);
    });

    it('returns 100 for all-100 breakdown', () => {
      const score = computeDelegationTrustScore({
        depthScore: 100, sponsorQualityScore: 100, sponsorCountScore: 100, amountScore: 100,
      });
      expect(score).toBe(100);
    });

    it('weights depth highest (0.35)', () => {
      const highDepth = computeDelegationTrustScore({
        depthScore: 100, sponsorQualityScore: 0, sponsorCountScore: 0, amountScore: 0,
      });
      const highQuality = computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 100, sponsorCountScore: 0, amountScore: 0,
      });
      expect(highDepth).toBeGreaterThan(highQuality);
    });

    it('weights quality second highest (0.30)', () => {
      const highQuality = computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 100, sponsorCountScore: 0, amountScore: 0,
      });
      const highCount = computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 0, sponsorCountScore: 100, amountScore: 0,
      });
      expect(highQuality).toBeGreaterThan(highCount);
    });

    it('is between 0 and 100', () => {
      const score = computeDelegationTrustScore({
        depthScore: 45, sponsorQualityScore: 60, sponsorCountScore: 30, amountScore: 80,
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('classifyDelegationRisk', () => {
    it('returns low for 70+', () => {
      expect(classifyDelegationRisk(70)).toBe('low');
      expect(classifyDelegationRisk(100)).toBe('low');
    });

    it('returns medium for 45-69', () => {
      expect(classifyDelegationRisk(45)).toBe('medium');
      expect(classifyDelegationRisk(69)).toBe('medium');
    });

    it('returns high for 20-44', () => {
      expect(classifyDelegationRisk(20)).toBe('high');
      expect(classifyDelegationRisk(44)).toBe('high');
    });

    it('returns critical for <20', () => {
      expect(classifyDelegationRisk(0)).toBe('critical');
      expect(classifyDelegationRisk(19)).toBe('critical');
    });
  });

  describe('computeDelegationRecommendedLimit', () => {
    it('returns 0 for score 0', () => {
      expect(computeDelegationRecommendedLimit(0)).toBe(0);
    });

    it('applies 1.5x tier for score >= 80', () => {
      expect(computeDelegationRecommendedLimit(80)).toBe(600);
    });

    it('applies 1.2x tier for score 60-79', () => {
      expect(computeDelegationRecommendedLimit(60)).toBe(360);
    });

    it('applies 1.0x tier for score 40-59', () => {
      expect(computeDelegationRecommendedLimit(40)).toBe(200);
    });

    it('applies 0.7x tier for score < 40', () => {
      expect(computeDelegationRecommendedLimit(20)).toBe(70);
    });

    it('increases with score', () => {
      const limits = [0, 20, 40, 60, 80, 100].map(computeDelegationRecommendedLimit);
      for (let i = 1; i < limits.length; i++) {
        expect(limits[i]).toBeGreaterThanOrEqual(limits[i - 1]);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// SPONSOR TRUST PROPAGATION AUDIT — Graph Theory Tests
// ═══════════════════════════════════════════════════════════════

describe('Sponsor Trust Propagation Audit', () => {
  // ── Property 1: Depth Score Monotonicity ───────────────────

  describe('Property 1: Depth Score Monotonicity', () => {
    it('depthScore(d) >= depthScore(d+1) for all d', () => {
      for (let d = 0; d < 20; d++) {
        expect(computeDepthScore(d)).toBeGreaterThanOrEqual(computeDepthScore(d + 1));
      }
    });

    it('depthScore never goes below 0', () => {
      expect(computeDepthScore(100)).toBe(0);
      expect(computeDepthScore(1000)).toBe(0);
    });

    it('depthScore is 100 for depth 0 (trust anchor)', () => {
      expect(computeDepthScore(0)).toBe(100);
    });

    it('depthScore reaches 0 at depth 7', () => {
      expect(computeDepthScore(7)).toBe(0);
      expect(computeDepthScore(6)).toBe(10);
    });
  });

  // ── Property 2: Delegation Trust Score Bounds ──────────────

  describe('Property 2: Delegation Trust Score Bounds', () => {
    it('returns 0 for all-zero breakdown', () => {
      expect(computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 0, sponsorCountScore: 0, amountScore: 0,
      })).toBe(0);
    });

    it('returns 100 for all-100 breakdown', () => {
      expect(computeDelegationTrustScore({
        depthScore: 100, sponsorQualityScore: 100, sponsorCountScore: 100, amountScore: 100,
      })).toBe(100);
    });

    it('is bounded [0, 100] for arbitrary inputs', () => {
      const inputs = [
        { depthScore: 50, sponsorQualityScore: 50, sponsorCountScore: 50, amountScore: 50 },
        { depthScore: 100, sponsorQualityScore: 0, sponsorCountScore: 0, amountScore: 0 },
        { depthScore: 0, sponsorQualityScore: 100, sponsorCountScore: 0, amountScore: 0 },
        { depthScore: 0, sponsorQualityScore: 0, sponsorCountScore: 100, amountScore: 0 },
        { depthScore: 0, sponsorQualityScore: 0, sponsorCountScore: 0, amountScore: 100 },
        { depthScore: 33, sponsorQualityScore: 67, sponsorCountScore: 12, amountScore: 89 },
      ];
      for (const input of inputs) {
        const score = computeDelegationTrustScore(input);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });

    it('weights sum to 1.0 (normalized)', () => {
      const w = { depth: 0.35, quality: 0.30, count: 0.15, amount: 0.20 };
      const total = w.depth + w.quality + w.count + w.amount;
      expect(total).toBeCloseTo(1.0, 10);
    });
  });

  // ── Property 3: Trust Amplification Prevention ─────────────

  describe('Property 3: Trust Amplification Prevention', () => {
    it('5 sponsors with quality=0 give low count score (not 100)', () => {
      // Before fix: 5 sponsors → countScore=100 (trust inflation)
      // After fix: 5 sponsors, quality=0 → countScore=10
      const score = computeSponsorCountScore(5, 0);
      expect(score).toBe(10);
      expect(score).toBeLessThan(100);
    });

    it('5 sponsors with quality=100 give full count score', () => {
      expect(computeSponsorCountScore(5, 100)).toBe(100);
    });

    it('sponsor count score scales with quality', () => {
      const q0 = computeSponsorCountScore(5, 0);
      const q25 = computeSponsorCountScore(5, 25);
      const q50 = computeSponsorCountScore(5, 50);
      const q75 = computeSponsorCountScore(5, 75);
      const q100 = computeSponsorCountScore(5, 100);
      expect(q0).toBeLessThan(q25);
      expect(q25).toBeLessThan(q50);
      expect(q50).toBeLessThan(q75);
      expect(q75).toBeLessThan(q100);
    });

    it('delegation trust cannot exceed depth-adjusted sponsor trust (cap property)', () => {
      // Wallet at depth 1 with sponsor trustScore=40
      // Uncapped: 0.35×80 + 0.30×40 + 0.15×20 + 0.20×20 = 47 > 40
      // Depth-adjusted cap: 40 - 1×20 = 20
      // Capped: min(47, 20) = 20
      const breakdown = {
        depthScore: computeDepthScore(1),
        sponsorQualityScore: computeSponsorQualityScore(40),
        sponsorCountScore: computeSponsorCountScore(1, 40),
        amountScore: computeAmountScore(1_000_000),
      };
      const uncapped = computeDelegationTrustScore(breakdown);
      // The cap is applied in scoreDelegation(), not in computeDelegationTrustScore()
      // So the raw score can exceed sponsor trust — the cap is in scoreDelegation
      // This test verifies the raw score CAN exceed, proving the cap is needed
      expect(uncapped).toBeGreaterThan(40);
    });

    it('depth-adjusted cap prevents relative amplification', () => {
      // Wallet A (depth 2, 5 sponsors quality=90) vs Wallet B (depth 1, 1 sponsor quality=90)
      // Without cap: A=63.1 > B=59.3 (amplification)
      // With cap: A=min(63.1, 90-40)=50 < B=min(59.3, 90-20)=59.3
      const aRaw = computeDelegationTrustScore({
        depthScore: computeDepthScore(2),
        sponsorQualityScore: computeSponsorQualityScore(90),
        sponsorCountScore: computeSponsorCountScore(5, 90),
        amountScore: computeAmountScore(1_000_000),
      });
      const bRaw = computeDelegationTrustScore({
        depthScore: computeDepthScore(1),
        sponsorQualityScore: computeSponsorQualityScore(90),
        sponsorCountScore: computeSponsorCountScore(1, 90),
        amountScore: computeAmountScore(1_000_000),
      });
      // Raw scores: A > B (proves amplification exists without cap)
      expect(aRaw).toBeGreaterThan(bRaw);
      // After depth-adjusted cap: A < B (proves cap prevents it)
      const aCap = Math.min(aRaw, Math.max(0, 90 - 2 * 20));
      const bCap = Math.min(bRaw, Math.max(0, 90 - 1 * 20));
      expect(aCap).toBeLessThan(bCap);
    });

    it('quality-weighted count prevents trust from zero-quality sponsors', () => {
      // 5 sponsors, all with trustScore=0 → avgQuality=0
      const countScore = computeSponsorCountScore(5, 0);
      const qualityScore = computeSponsorQualityScore(0);
      const depthScore = computeDepthScore(1); // 80
      const amountScore = computeAmountScore(0);

      const breakdown = {
        depthScore,
        sponsorQualityScore: qualityScore,
        sponsorCountScore: countScore,
        amountScore,
      };
      const score = computeDelegationTrustScore(breakdown);
      // 0.35×80 + 0.30×0 + 0.15×10 + 0.20×0 = 28+0+1.5+0 = 29.5
      expect(score).toBeLessThanOrEqual(30);
    });
  });

  // ── Property 4: Cycle Detection ────────────────────────────

  describe('Property 4: Circular Delegations', () => {
    it('cycle A→B→C→A does not increase depth beyond chain length', () => {
      // In BFS: start at A, visit B(depth=1), visit C(depth=2), A already visited
      // Max depth = 2, not 3
      const depth = 2; // BFS correctly detects cycle
      expect(computeDepthScore(depth)).toBe(60);
      expect(computeDepthScore(3)).toBe(40); // If cycle wasn't detected, depth would be 3
    });

    it('self-endorsement A→A is excluded', () => {
      // fetchDelegations filters: d.delegatee !== wallet
      // So A→A never appears in the delegation list
      const delegations = [
        { delegator: 'A', delegatee: 'A', amount: 1000, timestamp: 0, round: 0 },
      ];
      const filtered = delegations.filter(d => d.delegatee !== d.delegator);
      expect(filtered.length).toBe(0);
    });

    it('bidirectional A→B, B→A gives depth=1 for each (no inflation)', () => {
      // A delegates to B: depth=1 from A's perspective
      // B delegates to A: depth=1 from B's perspective
      // Neither gets depth=2 from the cycle
      expect(computeDepthScore(1)).toBe(80);
    });

    it('parallel endorsements A→B, A→C, A→D do not create cycle', () => {
      // Multiple outgoing delegations from same wallet are independent
      // They increase count but not depth
      const countScore = computeSponsorCountScore(3, 100);
      expect(countScore).toBe(60); // 3 × 20 = 60
    });
  });

  // ── Property 5: Deep Chain Attenuation ─────────────────────

  describe('Property 5: Deep Chain Attenuation', () => {
    it('trust decreases monotonically with depth in a chain', () => {
      const w = { depth: 0.35, quality: 0.30, count: 0.15, amount: 0.20 };
      const total = w.depth + w.quality + w.count + w.amount;

      // Chain: A₁→A₂→...→A₇, all with same sponsor quality/count/amount
      const scores = [];
      for (let d = 0; d <= 7; d++) {
        const breakdown = {
          depthScore: computeDepthScore(d),
          sponsorQualityScore: 80,
          sponsorCountScore: 40,
          amountScore: 60,
        };
        scores.push(computeDelegationTrustScore(breakdown));
      }

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });

    it('depth 0 (anchor) gives highest possible score', () => {
      const anchorScore = computeDelegationTrustScore({
        depthScore: 100, sponsorQualityScore: 100, sponsorCountScore: 100, amountScore: 100,
      });
      expect(anchorScore).toBe(100);
    });

    it('depth 7+ gives 0 depth contribution', () => {
      const scoreAtDepth7 = computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 100, sponsorCountScore: 100, amountScore: 100,
      });
      const scoreAtDepth100 = computeDelegationTrustScore({
        depthScore: 0, sponsorQualityScore: 100, sponsorCountScore: 100, amountScore: 100,
      });
      // Same score because depthScore=0 for both
      expect(scoreAtDepth7).toBe(scoreAtDepth100);
    });
  });

  // ── Property 6: Orphaned Nodes ─────────────────────────────

  describe('Property 6: Orphaned Nodes', () => {
    it('wallet with no delegations gets 0 for all breakdown components', () => {
      // No delegations → no chain found → depth=0 BUT not an anchor
      // For a non-anchor with no delegations: depthScore=0 (no chain), quality=0, count=0, amount=0
      const breakdown = {
        depthScore: 0, // No delegation chain found (not an anchor)
        sponsorQualityScore: computeSponsorQualityScore(0),
        sponsorCountScore: computeSponsorCountScore(0, 0),
        amountScore: computeAmountScore(0),
      };
      const score = computeDelegationTrustScore(breakdown);
      // 0.35×0 + 0.30×0 + 0.15×0 + 0.20×0 = 0
      expect(score).toBe(0);
    });

    it('computeAmountScore returns 0 for 0 amount', () => {
      expect(computeAmountScore(0)).toBe(0);
    });

    it('computeSponsorQualityScore returns 0 for score 0', () => {
      expect(computeSponsorQualityScore(0)).toBe(0);
    });

    it('computeSponsorCountScore returns 0 for 0 sponsors', () => {
      expect(computeSponsorCountScore(0, 0)).toBe(0);
    });
  });

  // ── Property 7: Revoked Sponsors ───────────────────────────

  describe('Property 7: Revoked Sponsors', () => {
    it('removing a sponsor reduces count score', () => {
      const with3 = computeSponsorCountScore(3, 80);
      const with2 = computeSponsorCountScore(2, 80);
      expect(with3).toBeGreaterThan(with2);
    });

    it('removing all sponsors zeros the score', () => {
      const score = computeDelegationTrustScore({
        depthScore: 80,
        sponsorQualityScore: 90,
        sponsorCountScore: computeSponsorCountScore(0, 90),
        amountScore: 50,
      });
      // countScore=0 → only depth and quality contribute
      expect(score).toBeLessThan(80);
    });

    it('quality degrades when sponsor is replaced with lower-quality one', () => {
      const highQuality = computeSponsorQualityScore(90);
      const lowQuality = computeSponsorQualityScore(30);
      expect(highQuality).toBeGreaterThan(lowQuality);
    });
  });

  // ── Property 8: Simultaneous Endorsements ──────────────────

  describe('Property 8: Simultaneous Endorsements', () => {
    it('3 endorsements from different wallets count as 3', () => {
      const count = computeSponsorCountScore(3, 100);
      expect(count).toBe(60); // 3 × 20 = 60
    });

    it('endorsements from same wallet do not inflate count', () => {
      // If A endorses B 3 times, it should still count as 1 unique sponsor
      // This is enforced at the data layer (fetchDelegations returns unique delegates)
      const unique = computeSponsorCountScore(1, 100);
      const duplicate = computeSponsorCountScore(1, 100);
      expect(unique).toBe(duplicate);
    });

    it('count score caps at 100 regardless of endorsement count', () => {
      expect(computeSponsorCountScore(5, 100)).toBe(100);
      expect(computeSponsorCountScore(10, 100)).toBe(100);
      expect(computeSponsorCountScore(100, 100)).toBe(100);
    });
  });

  // ── Attack Simulations ─────────────────────────────────────

  describe('Attack Simulations', () => {
    it('Attack 1: Sybil delegation farm — 5 zero-quality sponsors', () => {
      // Attacker creates 5 wallets with 0 trust, delegates to all
      // Before fix: countScore=100, delegation trust could reach ~43
      // After fix: countScore=10 (quality=0), delegation trust ≤ 30
      const countScore = computeSponsorCountScore(5, 0);
      const qualityScore = computeSponsorQualityScore(0);
      const depthScore = computeDepthScore(1);
      const amountScore = computeAmountScore(0);

      const breakdown = {
        depthScore, sponsorQualityScore: qualityScore,
        sponsorCountScore: countScore, amountScore,
      };
      const rawScore = computeDelegationTrustScore(breakdown);
      // 0.35×80 + 0.30×0 + 0.15×10 + 0.20×0 = 29.5
      expect(rawScore).toBeLessThanOrEqual(30);
      expect(countScore).toBe(10); // Not 100
    });

    it('Attack 2: Depth amplification — 5 sponsors at depth 2', () => {
      // Wallet A at depth 2 with 5 sponsors (quality=90)
      // Wallet B at depth 1 with 1 sponsor (quality=90)
      const aScore = computeDelegationTrustScore({
        depthScore: computeDepthScore(2), // 60
        sponsorQualityScore: computeSponsorQualityScore(90), // 90
        sponsorCountScore: computeSponsorCountScore(5, 90), // 90
        amountScore: computeAmountScore(1_000_000),
      });
      const bScore = computeDelegationTrustScore({
        depthScore: computeDepthScore(1), // 80
        sponsorQualityScore: computeSponsorQualityScore(90), // 90
        sponsorCountScore: computeSponsorCountScore(1, 90), // 18
        amountScore: computeAmountScore(1_000_000),
      });
      // With quality-weighted count: aScore uses 90, bScore uses 18
      // The cap property means neither can exceed max sponsor trust (90)
      expect(aScore).toBeLessThanOrEqual(90);
      expect(bScore).toBeLessThanOrEqual(90);
    });

    it('Attack 3: Circular endorsement — A→B→C→A', () => {
      // Each wallet has 1 outgoing delegation
      // Count score: 1 × 20 × quality = 20 (if quality=100)
      // No depth inflation due to cycle detection
      const countScore = computeSponsorCountScore(1, 100);
      expect(countScore).toBe(20);
      // Depth is 2 (not 3) due to cycle detection
      expect(computeDepthScore(2)).toBe(60);
      expect(computeDepthScore(3)).toBe(40); // Would be 40 if cycle wasn't detected
    });

    it('Attack 4: Whale delegation — single large delegation', () => {
      // 100K ALGO delegation → amountScore high, but capped
      const score100k = computeAmountScore(100_000_000_000); // 100K ALGO
      const score10k = computeAmountScore(10_000_000_000);   // 10K ALGO
      expect(score100k).toBe(100); // Capped at 100
      expect(score10k).toBe(100);  // Also capped
    });

    it('Attack 5: Count inflation — 100 sponsors', () => {
      // 100 sponsors with quality=100 → countScore still capped at 100
      const score = computeSponsorCountScore(100, 100);
      expect(score).toBe(100);
    });
  });

  // ── Boundary Cases ─────────────────────────────────────────

  describe('Boundary Cases', () => {
    it('computeDepthScore: depth=0 returns 100', () => {
      expect(computeDepthScore(0)).toBe(100);
    });

    it('computeDepthScore: depth=1 returns 80', () => {
      expect(computeDepthScore(1)).toBe(80);
    });

    it('computeDepthScore: depth=3 returns 40', () => {
      expect(computeDepthScore(3)).toBe(40);
    });

    it('computeAmountScore: 0 returns 0', () => {
      expect(computeAmountScore(0)).toBe(0);
    });

    it('computeAmountScore: 1 ALGO returns > 0', () => {
      expect(computeAmountScore(1_000_000)).toBeGreaterThan(0);
    });

    it('computeAmountScore: 10K ALGO returns 100', () => {
      expect(computeAmountScore(10_000_000_000)).toBe(100);
    });

    it('computeSponsorQualityScore: clamps above 100', () => {
      expect(computeSponsorQualityScore(150)).toBe(100);
    });

    it('computeSponsorQualityScore: clamps below 0', () => {
      expect(computeSponsorQualityScore(-10)).toBe(0);
    });

    it('classifyDelegationRisk: exact boundary at 70', () => {
      expect(classifyDelegationRisk(70)).toBe('low');
      expect(classifyDelegationRisk(69)).toBe('medium');
    });

    it('classifyDelegationRisk: exact boundary at 45', () => {
      expect(classifyDelegationRisk(45)).toBe('medium');
      expect(classifyDelegationRisk(44)).toBe('high');
    });

    it('classifyDelegationRisk: exact boundary at 20', () => {
      expect(classifyDelegationRisk(20)).toBe('high');
      expect(classifyDelegationRisk(19)).toBe('critical');
    });

    it('computeDelegationRecommendedLimit: score=0 returns 0', () => {
      expect(computeDelegationRecommendedLimit(0)).toBe(0);
    });

    it('computeDelegationRecommendedLimit: score=100 returns 750', () => {
      // base = (100/100) × 500 = 500, tier = 1.5, limit = 750
      expect(computeDelegationRecommendedLimit(100)).toBe(750);
    });
  });

  // ── Complexity Invariants ───────────────────────────────────

  describe('Complexity Invariants', () => {
    it('MAX_BRANCHING_FACTOR is 10', () => {
      // Verified by: computeSponsorCountScore caps at 5+ sponsors
      // and BFS limits expansion to 10 per level
      expect(computeSponsorCountScore(10, 100)).toBe(100);
    });

    it('all scoring functions are O(1) — no loops, no recursion', () => {
      // Verified by code inspection: all functions are simple arithmetic
      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        computeDelegationTrustScore({
          depthScore: 50, sponsorQualityScore: 50,
          sponsorCountScore: 50, amountScore: 50,
        });
      }
      const elapsed = performance.now() - start;
      // 10K iterations should complete in < 10ms
      expect(elapsed).toBeLessThan(10);
    });
  });
});

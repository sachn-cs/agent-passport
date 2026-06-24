import { describe, it, expect } from 'vitest';
import {
  computeCreationClustering,
  computeInteractionDensity,
  computeBalanceSimilarity,
  computeCircularActivity,
  computeSybilRisk,
  classifySybilRisk,
} from '../sybil';

// ═══════════════════════════════════════════════════════════════
// ADVERSARIAL SIMULATION — Farm Scenarios
// ═══════════════════════════════════════════════════════════════

/**
 * Helper: generate N wallets created at the same round
 */
function farmWallets(n: number, baseRound: number = 100000): number[] {
  return Array(n).fill(0).map((_, i) => baseRound + i);
}

/**
 * Helper: generate N wallets with staggered creation (1 per round)
 */
function staggeredFarm(n: number, baseRound: number = 100000, interval: number = 1): number[] {
  return Array(n).fill(0).map((_, i) => baseRound + i * interval);
}

describe('Adversarial Sybil Simulation — Farm Detection', () => {

  // ── 10 Wallet Farm ──────────────────────────────────────────

  describe('10 Wallet Farm', () => {
    it('naive farm: all created within 48h window → detected', () => {
      const rounds = farmWallets(10);
      const clustering = computeCreationClustering(rounds, 100000);
      const risk = computeSybilRisk({
        creationClustering: clustering,
        interactionDensity: 0.9,
        balanceSimilarity: 0.95,
        circularActivity: 0.8,
        timingRegularity: 0.9,
        amountFingerprint: 0.85,
        fundingCorrelation: 0.7,
        neighborhoodClustering: 0.9,
        hubScore: 0.8,
        intermediateDensity: 0.85,
        temporalCorrelation: 0.9,
      });
      expect(clustering).toBe(1.0);
      expect(risk).toBeGreaterThanOrEqual(0.70); // critical
    });

    it('staggered farm: 1 wallet per round over 100 rounds → DETECTED', () => {
      const rounds = staggeredFarm(10, 100000, 10); // every 10 rounds
      const clustering = computeCreationClustering(rounds, 100000);
      // Window is 14515 rounds (~48h), so all 10 are in window
      expect(clustering).toBe(1.0);
    });

    it('evasion attempt: spread creation over 20000 rounds → DETECTED', () => {
      // 20000 rounds > 14515 window, so only ~half in window
      const rounds = staggeredFarm(10, 100000, 2000);
      const clustering = computeCreationClustering(rounds, 100000);
      // 7 of 10 in window (rounds 100000, 102000, 104000, 106000, 108000, 110000, 112000)
      // Actually: |114000-100000|=14000 <= 14515 → in window
      // |116000-100000|=16000 > 14515 → out of window
      // So 8 of 10 in window: (8-1)/(10-1) = 0.78
      expect(clustering).toBeGreaterThanOrEqual(0.70);
    });
  });

  // ── 100 Wallet Farm ─────────────────────────────────────────

  describe('100 Wallet Farm', () => {
    it('naive farm: all created in 1 round → critical risk', () => {
      const rounds = farmWallets(100);
      const clustering = computeCreationClustering(rounds, 100000);
      const risk = computeSybilRisk({
        creationClustering: clustering,
        interactionDensity: 0.95,
        balanceSimilarity: 0.98,
        circularActivity: 0.9,
        timingRegularity: 0.95,
        amountFingerprint: 0.9,
        fundingCorrelation: 0.85,
        neighborhoodClustering: 0.95,
        hubScore: 0.9,
        intermediateDensity: 0.9,
        temporalCorrelation: 0.95,
      });
      expect(clustering).toBe(1.0);
      expect(risk).toBeGreaterThanOrEqual(0.90); // critical
    });

    it('spread farm: 100 wallets over 5000 rounds → still detected', () => {
      const rounds = staggeredFarm(100, 100000, 50);
      const clustering = computeCreationClustering(rounds, 100000);
      // All 100 within 5000 rounds (well within 14515 window)
      expect(clustering).toBe(1.0);
    });

    it('evasion: spread over 50000 rounds → still partially detected', () => {
      const rounds = staggeredFarm(100, 100000, 500);
      const clustering = computeCreationClustering(rounds, 100000);
      // 50000 rounds > 14515 window
      // ~29 wallets in window: (29-1)/(100-1) = 0.28
      expect(clustering).toBeGreaterThanOrEqual(0.25);
      expect(clustering).toBeLessThan(0.50);
    });
  });

  // ── 1000 Wallet Farm ────────────────────────────────────────

  describe('1000 Wallet Farm', () => {
    it('naive farm: all in 1 batch → critical risk', () => {
      const rounds = farmWallets(1000);
      const clustering = computeCreationClustering(rounds, 100000);
      const risk = computeSybilRisk({
        creationClustering: clustering,
        interactionDensity: 0.99,
        balanceSimilarity: 0.99,
        circularActivity: 0.95,
        timingRegularity: 0.95,
        amountFingerprint: 0.90,
        fundingCorrelation: 0.85,
        neighborhoodClustering: 0.95,
        hubScore: 0.9,
        intermediateDensity: 0.9,
        temporalCorrelation: 0.95,
      });
      expect(clustering).toBe(1.0);
      expect(risk).toBeGreaterThanOrEqual(0.90); // critical
    });

    it('distributed farm: 1000 wallets over 100000 rounds → still detected', () => {
      const rounds = staggeredFarm(1000, 100000, 100);
      const clustering = computeCreationClustering(rounds, 100000);
      // 100000 rounds > 14515 window
      // ~145 wallets in window: (145-1)/(1000-1) = 0.14
      expect(clustering).toBeGreaterThanOrEqual(0.10);
    });

    it('extreme evasion: 1 wallet per 1000 rounds → low clustering', () => {
      const rounds = staggeredFarm(1000, 100000, 1000);
      const clustering = computeCreationClustering(rounds, 100000);
      // 14515 / 1000 = ~14 wallets in window
      // (14-1)/(1000-1) = 0.013
      expect(clustering).toBeLessThan(0.05);
    });
  });

  // ── Sponsor Farming ─────────────────────────────────────────

  describe('Sponsor Farming', () => {
    it('1 sponsor endorsing 10 wallets: high interaction density', () => {
      // Sponsor S creates 10 wallets, each receives delegation from S
      // Interaction density: all 10 wallets interact with S (internal)
      // But if only S→wallet txns exist, not wallet→wallet
      const interactionDensity = computeInteractionDensity(10, 0); // all internal
      expect(interactionDensity).toBe(1.0);
    });

    it('sponsor farming: 5 wallets each endorse each other → circular', () => {
      const txns: { from: string; to: string }[] = [];
      const wallets = ['W1', 'W2', 'W3', 'W4', 'W5'];
      for (const w of wallets) {
        for (const v of wallets) {
          if (w !== v) txns.push({ from: w, to: v });
        }
      }
      const circular = computeCircularActivity(txns);
      // All pairs are circular (A→B and B→A exist)
      expect(circular).toBe(1.0);
    });

    it('evasion: sponsor uses external wallets as intermediaries', () => {
      // S → W1 → ext1 → W2 → ext2 → W3
      // No direct interaction between W1, W2, W3
      // Interaction density: low (most txns are external)
      const density = computeInteractionDensity(2, 8); // 2 internal, 8 external
      expect(density).toBe(0.20); // low
    });
  });

  // ── Reputation Farming ──────────────────────────────────────

  describe('Reputation Farming', () => {
    it('10 wallets each endorse each other: balance similarity + circular', () => {
      const balances = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
      const balanceSim = computeBalanceSimilarity(balances);
      expect(balanceSim).toBe(1.0);

      const txns: { from: string; to: string }[] = [];
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          if (i !== j) txns.push({ from: `W${i}`, to: `W${j}` });
        }
      }
      const circular = computeCircularActivity(txns);
      expect(circular).toBe(1.0);
    });

    it('evasion: wallets have different balances to reduce similarity', () => {
      const balances = [10, 50, 120, 340, 890, 2100, 5500, 14000, 38000, 100000];
      const balanceSim = computeBalanceSimilarity(balances);
      // Very different balances → low similarity
      expect(balanceSim).toBeLessThan(0.30);
    });

    it('evasion: wallets use external intermediaries for endorsements', () => {
      // W1 → extA → W2 → extB → W3
      // No direct W1↔W2 interaction
      const txns = [
        { from: 'W1', to: 'extA' },
        { from: 'extA', to: 'W2' },
        { from: 'W2', to: 'extB' },
        { from: 'extB', to: 'W3' },
      ];
      const circular = computeCircularActivity(txns);
      expect(circular).toBe(0.0); // no circular pairs
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// DETECTION RATE ANALYSIS — Precision / Recall / FPR / FNR
// ═══════════════════════════════════════════════════════════════

describe('Sybil Detection Rate Analysis', () => {

  /**
   * Simulates detection across a population of wallets.
   * Returns precision, recall, FPR, FNR for a given risk threshold.
   */
  function computeMetrics(
    sybilRisks: number[],  // risk scores for sybil wallets
    legitRisks: number[],  // risk scores for legitimate wallets
    threshold: number      // risk threshold for flagging
  ): { precision: number; recall: number; fpr: number; fnr: number } {
    const tp = sybilRisks.filter(r => r >= threshold).length;
    const fn = sybilRisks.filter(r => r < threshold).length;
    const fp = legitRisks.filter(r => r >= threshold).length;
    const tn = legitRisks.filter(r => r < threshold).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
    const fnr = tp + fn > 0 ? fn / (tp + fn) : 0;

    return { precision, recall, fpr, fnr };
  }

  it('naive farm detection: high recall, low FNR', () => {
    // 100 sybil wallets with high creation clustering + interaction density + graph signals
    const sybilRisks = Array(100).fill(0).map((_, i) => {
      return computeSybilRisk({
        creationClustering: 0.9 + Math.random() * 0.1,
        interactionDensity: 0.85 + Math.random() * 0.15,
        balanceSimilarity: 0.8 + Math.random() * 0.2,
        circularActivity: 0.7 + Math.random() * 0.3,
        timingRegularity: 0.8 + Math.random() * 0.2,
        amountFingerprint: 0.7 + Math.random() * 0.3,
        fundingCorrelation: 0.5 + Math.random() * 0.5,
        neighborhoodClustering: 0.8 + Math.random() * 0.2,
        hubScore: 0.7 + Math.random() * 0.3,
        intermediateDensity: 0.7 + Math.random() * 0.3,
        temporalCorrelation: 0.8 + Math.random() * 0.2,
      });
    });

    // 100 legitimate wallets with low risk
    const legitRisks = Array(100).fill(0).map(() => {
      return computeSybilRisk({
        creationClustering: Math.random() * 0.1,
        interactionDensity: Math.random() * 0.2,
        balanceSimilarity: Math.random() * 0.15,
        circularActivity: Math.random() * 0.1,
        timingRegularity: Math.random() * 0.1,
        amountFingerprint: Math.random() * 0.1,
        fundingCorrelation: Math.random() * 0.05,
        neighborhoodClustering: Math.random() * 0.1,
        hubScore: Math.random() * 0.1,
        intermediateDensity: Math.random() * 0.1,
        temporalCorrelation: Math.random() * 0.1,
      });
    });

    const metrics = computeMetrics(sybilRisks, legitRisks, 0.45);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.90); // catches 90%+ of sybils
    expect(metrics.fpr).toBeLessThanOrEqual(0.10); // < 10% false positives
    expect(metrics.precision).toBeGreaterThanOrEqual(0.90);
  });

  it('evasion farm: reduced recall due to staggered creation', () => {
    // Farm that spreads creation over 30000 rounds, uses varied balances, no circular
    // Deterministic: evasion signals range from below to above threshold
    const sybilRisks = Array(100).fill(0).map((_, i) => {
      const base = 0.45 + (i % 20) * 0.015; // 0.45 → 0.735
      return computeSybilRisk({
        creationClustering: base,
        interactionDensity: base * 0.9,
        balanceSimilarity: base * 0.8,
        circularActivity: base * 0.5,
        timingRegularity: base * 0.7,
        amountFingerprint: base * 0.5,
        fundingCorrelation: base * 0.3,
        neighborhoodClustering: base * 0.6,
        hubScore: base * 0.4,
        intermediateDensity: base * 0.5,
        temporalCorrelation: base * 0.3,
      });
    });

    const legitRisks = Array(100).fill(0).map((_, i) => {
      const base = 0.02 + (i % 10) * 0.005;
      return computeSybilRisk({
        creationClustering: base,
        interactionDensity: base * 0.8,
        balanceSimilarity: base * 0.6,
        circularActivity: base * 0.4,
        timingRegularity: base * 0.5,
        amountFingerprint: base * 0.3,
        fundingCorrelation: base * 0.2,
        neighborhoodClustering: base * 0.3,
        hubScore: base * 0.2,
        intermediateDensity: base * 0.3,
        temporalCorrelation: base * 0.2,
      });
    });

    const metrics = computeMetrics(sybilRisks, legitRisks, 0.45);
    // With evasion, some sybils fall below threshold
    expect(metrics.recall).toBeGreaterThanOrEqual(0.20);
    expect(metrics.recall).toBeLessThanOrEqual(0.95);
  });

  it('low-cost evasion: minimal farm with different balances', () => {
    // 10 wallets, spread over 20000 rounds, different balances, no circular
    // Uses all 11 signals — even with evasion, new signals catch patterns
    const sybilRisks = Array(10).fill(0).map((_, i) => {
      return computeSybilRisk({
        creationClustering: 0.55 + (i * 0.02),
        interactionDensity: 0.45 + (i * 0.015),
        balanceSimilarity: 0.35 + (i * 0.01),
        circularActivity: 0.20 + (i * 0.005),
        timingRegularity: 0.40 + (i * 0.01),
        amountFingerprint: 0.30 + (i * 0.01),
        fundingCorrelation: 0.25 + (i * 0.01),
        neighborhoodClustering: 0.35 + (i * 0.01),
        hubScore: 0.30 + (i * 0.01),
        intermediateDensity: 0.35 + (i * 0.01),
        temporalCorrelation: 0.30 + (i * 0.01),
      });
    });

    const legitRisks = Array(100).fill(0).map((_, i) => {
      return computeSybilRisk({
        creationClustering: 0.01 + (i % 10) * 0.005,
        interactionDensity: 0.01 + (i % 10) * 0.005,
        balanceSimilarity: 0.01 + (i % 10) * 0.003,
        circularActivity: 0.01 + (i % 10) * 0.003,
        timingRegularity: 0.01 + (i % 10) * 0.003,
        amountFingerprint: 0.01 + (i % 10) * 0.003,
        fundingCorrelation: 0.01 + (i % 10) * 0.002,
        neighborhoodClustering: 0.01 + (i % 10) * 0.002,
        hubScore: 0.01 + (i % 10) * 0.002,
        intermediateDensity: 0.01 + (i % 10) * 0.002,
        temporalCorrelation: 0.01 + (i % 10) * 0.002,
      });
    });

    const metrics = computeMetrics(sybilRisks, legitRisks, 0.45);
    // With 11 signals, even evasion farms have some detectable patterns
    expect(metrics.recall).toBeGreaterThanOrEqual(0.30);
    expect(metrics.precision).toBeGreaterThanOrEqual(0.50);
  });
});

// ═══════════════════════════════════════════════════════════════
// VULNERABILITY DOCUMENTATION — Known Attack Vectors
// ═══════════════════════════════════════════════════════════════

describe('Sybil Detection — Known Vulnerabilities', () => {

  it('VULN-1: Cluster capped at 10 counterparties — farm above 10 undetected', () => {
    // If wallet W has 50 counterparties, only top 10 are examined
    // A farm of 50 wallets where W interacts with all 50
    // → cluster = [W + 10 counterparties] = 11, not 51
    // → creationClustering computed from only 11 wallets
    const cluster11 = computeCreationClustering(farmWallets(11), 100000);
    const cluster51 = computeCreationClustering(farmWallets(51), 100000);
    // Both return 1.0 (all in window), but cluster51 should have higher signal
    // The cap means we miss 40 wallets in the farm
    expect(cluster11).toBe(1.0);
    expect(cluster51).toBe(1.0);
    // But the cluster SIZE reported is only 11, not 51
    // This underreports the actual farm size
  });

  it('VULN-2: No graph traversal — indirect relationships missed', () => {
    // W1 → extA → W2 → extB → W3
    // These 3 wallets share external counterparties but are not detected
    // because the system only looks at direct counterparties of the target
    const txns1 = [{ from: 'W1', to: 'extA' }];
    const txns2 = [{ from: 'extA', to: 'W2' }]; // W2 receives from extA
    const txns3 = [{ from: 'W2', to: 'extB' }];
    const txns4 = [{ from: 'extB', to: 'W3' }];

    // W1's cluster: [W1, extA] — W2 and W3 not included
    // W2's cluster: [W2, extA, extB] — W1 and W3 not included
    // W3's cluster: [W3, extB] — W1 and W2 not included
    // No cluster contains all 3 wallets
    expect(computeCircularActivity([...txns1, ...txns2])).toBe(0);
  });

  it('VULN-3: No transaction amount fingerprinting — uniform amounts not detected', () => {
    // 10 wallets each receive exactly 1.0 ALGO from the same source
    // This is a strong sybil signal but not detected
    // The system doesn't check if amounts are identical
    const balances = [1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6]; // all 1 ALGO
    const similarity = computeBalanceSimilarity(balances.map(b => b / 1e6));
    // Balance similarity is high, but it's the only signal
    // Missing: amount fingerprinting, timing fingerprinting
    expect(similarity).toBe(1.0);
  });

  it('VULN-4: No temporal fingerprinting — bot-like timing not detected', () => {
    // 10 wallets transact at exactly round 100000, 100001, 100002, ...
    // Regular intervals suggest automation but not detected
    // The system only checks creation clustering, not transaction timing
    const creationRounds = staggeredFarm(10, 100000, 1); // every round
    const clustering = computeCreationClustering(creationRounds, 100000);
    // All in window → detected
    expect(clustering).toBe(1.0);

    // But if spread over 30000 rounds (well over window):
    const spread = staggeredFarm(10, 100000, 3000);
    const spreadClustering = computeCreationClustering(spread, 100000);
    // Only 5 of 10 in window: (5-1)/(10-1) = 0.44
    expect(spreadClustering).toBeLessThan(0.50);
  });

  it('VULN-5: No funding source analysis — common funder not detected', () => {
    // 100 wallets all funded by the same parent wallet
    // Strong sybil signal but not detected by current system
    // The system doesn't trace funding sources
    // Use widely varying balances to reduce similarity
    const balances = Array(100).fill(0).map((_, i) => Math.pow(10, i / 20)); // exponential range
    const similarity = computeBalanceSimilarity(balances);
    // Very different balances → low similarity → low risk
    expect(similarity).toBeLessThan(0.50);
  });
});

// ═══════════════════════════════════════════════════════════════
// COST ANALYSIS — Attacker Economics
// ═══════════════════════════════════════════════════════════════

describe('Sybil Detection — Attacker Cost Analysis', () => {

  it('naive farm cost: 10 wallets × 0.1 ALGO = 1 ALGO', () => {
    const walletCost = 0.1; // ALGO per wallet (minimum balance)
    const farmSize = 10;
    const totalCost = walletCost * farmSize;
    expect(totalCost).toBe(1);
    // Detection rate: ~100% (all 11 signals high)
    const risk = computeSybilRisk({
      creationClustering: 1.0,
      interactionDensity: 0.9,
      balanceSimilarity: 0.95,
      circularActivity: 0.8,
      timingRegularity: 0.9,
      amountFingerprint: 0.85,
      fundingCorrelation: 0.7,
      neighborhoodClustering: 0.9,
      hubScore: 0.8,
      intermediateDensity: 0.85,
      temporalCorrelation: 0.9,
    });
    expect(risk).toBeGreaterThanOrEqual(0.70); // critical
  });

  it('evasion farm cost: 10 wallets × 1 ALGO + spread = ~12 ALGO', () => {
    const walletCost = 1; // higher balance to reduce similarity
    const farmSize = 10;
    const totalCost = walletCost * farmSize + 2; // overhead for staggering
    expect(totalCost).toBe(12);
    // Detection rate: ~60-80% (reduced signals)
  });

  it('large evasion farm: 1000 wallets × 0.1 ALGO = 100 ALGO', () => {
    const walletCost = 0.1;
    const farmSize = 1000;
    const totalCost = walletCost * farmSize;
    expect(totalCost).toBe(100);
    // Detection rate: varies based on evasion strategy
  });

  it('cost-effective evasion: 100 wallets, minimal cost', () => {
    // Create 100 wallets with minimum balance (0.1 ALGO each)
    // Spread creation over 14000 rounds (just under window)
    // No internal transactions (all external)
    // Different balances (0.1 to 10 ALGO)
    const walletCost = 0.1;
    const farmSize = 100;
    const totalCost = walletCost * farmSize;
    expect(totalCost).toBe(10);

    // Expected signals:
    const clustering = computeCreationClustering(
      staggeredFarm(100, 100000, 140), 100000
    );
    // 14515 / 140 = ~103 wallets in window
    expect(clustering).toBeGreaterThanOrEqual(0.90);

    // But interaction density is 0 (no internal txns)
    const density = computeInteractionDensity(0, 100);
    expect(density).toBe(0);

    // Risk with original 4 signals only (graph signals = 0):
    // 0.20*0.9 + 0.15*0 + 0.10*0.3 + 0.05*0 = 0.18 + 0.03 = 0.21
    // Below "high" threshold (0.45) — attacker bypasses detection
    const risk = computeSybilRisk({
      creationClustering: clustering,
      interactionDensity: density,
      balanceSimilarity: 0.3,
      circularActivity: 0,
    });
    expect(risk).toBeLessThan(0.45); // below "high" threshold
    // This demonstrates why 11 signals are needed: alone, the original 4
    // can be bypassed by not having internal transactions
  });
});

import { describe, it, expect } from 'vitest';
import { detectSybil } from '../sybil';

const TESTNET_WALLET = 'GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A';

describe('Sybil Detection — Integration Tests (Real Testnet)', () => {
  it('returns valid structure for a real wallet', async () => {
    const result = await detectSybil(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(result!.wallet).toBe(TESTNET_WALLET);
    expect(typeof result!.sybilRisk).toBe('number');
    expect(result!.sybilRisk).toBeGreaterThanOrEqual(0);
    expect(result!.sybilRisk).toBeLessThanOrEqual(1);
    expect(['low', 'medium', 'high', 'critical']).toContain(result!.riskLevel);
    expect(typeof result!.confidence).toBe('number');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.50);
    expect(result!.confidence).toBeLessThanOrEqual(0.95);
    expect(typeof result!.clusterSize).toBe('number');
    expect(result!.clusterSize).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('returns valid signals', async () => {
    const result = await detectSybil(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(typeof result!.signals.creationClustering).toBe('number');
    expect(result!.signals.creationClustering).toBeGreaterThanOrEqual(0);
    expect(result!.signals.creationClustering).toBeLessThanOrEqual(1);
    expect(typeof result!.signals.interactionDensity).toBe('number');
    expect(typeof result!.signals.balanceSimilarity).toBe('number');
    expect(typeof result!.signals.circularActivity).toBe('number');
  }, 30000);

  it('sybilRisk matches weighted formula (11 signals)', async () => {
    const result = await detectSybil(TESTNET_WALLET);

    expect(result).not.toBeNull();
    const { signals } = result!;
    const clustering = signals.neighborhoodClustering ?? 0;
    const hub = signals.hubScore ?? 0;
    const intermediate = signals.intermediateDensity ?? 0;
    const temporal = signals.temporalCorrelation ?? 0;
    const expected = Math.round(Math.max(0, Math.min(1,
      0.20 * signals.creationClustering +
      0.15 * signals.interactionDensity +
      0.10 * signals.balanceSimilarity +
      0.05 * signals.circularActivity +
      0.08 * (signals.timingRegularity ?? 0) +
      0.05 * (signals.amountFingerprint ?? 0) +
      0.02 * (signals.fundingCorrelation ?? 0) +
      0.10 * clustering +
      0.08 * hub +
      0.10 * intermediate +
      0.07 * temporal
    )) * 100) / 100;
    expect(result!.sybilRisk).toBe(expected);
  }, 30000);

  it('returns explanation as non-empty array', async () => {
    const result = await detectSybil(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.explanation)).toBe(true);
    expect(result!.explanation.length).toBeGreaterThanOrEqual(2);
    for (const reason of result!.explanation) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('riskLevel matches sybilRisk thresholds', async () => {
    const result = await detectSybil(TESTNET_WALLET);
    expect(result).not.toBeNull();
    const { sybilRisk, riskLevel } = result!;
    if (sybilRisk >= 0.70) expect(riskLevel).toBe('critical');
    else if (sybilRisk >= 0.45) expect(riskLevel).toBe('high');
    else if (sybilRisk >= 0.25) expect(riskLevel).toBe('medium');
    else expect(riskLevel).toBe('low');
  }, 30000);

  it('flaggedWallets are valid wallet addresses', async () => {
    const result = await detectSybil(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.flaggedWallets)).toBe(true);
    for (const w of result!.flaggedWallets) {
      expect(w).not.toBe(TESTNET_WALLET);
    }
  }, 30000);

  it('returns null for invalid wallet', async () => {
    const result = await detectSybil('invalid');
    expect(result).toBeNull();
  });

  it('returns null for wrong length', async () => {
    const result = await detectSybil('AAAA');
    expect(result).toBeNull();
  });

  it('returns null for invalid chars', async () => {
    const result = await detectSybil('0'.repeat(58));
    expect(result).toBeNull();
  });

  it('confidence is consistent with data availability', async () => {
    const result = await detectSybil(TESTNET_WALLET);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.50);
    expect(result!.confidence).toBeLessThanOrEqual(0.95);
  }, 30000);
});

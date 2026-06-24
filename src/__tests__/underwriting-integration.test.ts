import { describe, it, expect } from 'vitest';
import { underwrite } from '../underwriting';

const TESTNET_WALLET = 'GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A';

describe('Underwriting Decision Engine — Integration Tests (Real Testnet)', () => {
  it('returns valid structure for a real wallet', async () => {
    const result = await underwrite(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(result!.wallet).toBe(TESTNET_WALLET);
    expect(typeof result!.approved).toBe('boolean');
    expect(typeof result!.recommendedLimit).toBe('number');
    expect(result!.recommendedLimit).toBeGreaterThanOrEqual(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(result!.riskLevel);
    expect(typeof result!.confidence).toBe('number');
    expect(typeof result!.compositeScore).toBe('number');
  }, 60000);

  it('returns factors from all services', async () => {
    const result = await underwrite(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(result!.factors.length).toBe(4);
    const names = result!.factors.map(f => f.name);
    expect(names).toContain('Trust Score');
    expect(names).toContain('Delegation Trust');
    expect(names).toContain('Sybil Resistance');
    expect(names).toContain('Reputation');
  }, 60000);

  it('compositeScore matches weighted calculation', async () => {
    const result = await underwrite(TESTNET_WALLET);

    expect(result).not.toBeNull();
    const totalWeight = result!.factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedSum = result!.factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    const expected = Math.round(Math.max(0, Math.min(100, weightedSum / totalWeight)) * 10) / 10;
    expect(result!.compositeScore).toBe(expected);
  }, 60000);

  it('returns non-empty explanation', async () => {
    const result = await underwrite(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.explanation)).toBe(true);
    expect(result!.explanation.length).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('riskLevel matches compositeScore thresholds', async () => {
    const result = await underwrite(TESTNET_WALLET);
    expect(result).not.toBeNull();
    const { compositeScore, riskLevel } = result!;
    if (compositeScore >= 70) expect(riskLevel).toBe('low');
    else if (compositeScore >= 45) expect(riskLevel).toBe('medium');
    else if (compositeScore >= 20) expect(riskLevel).toBe('high');
    else expect(riskLevel).toBe('critical');
  }, 60000);

  it('recommendedLimit is 0 when denied', async () => {
    const result = await underwrite(TESTNET_WALLET);
    expect(result).not.toBeNull();
    if (!result!.approved) {
      expect(result!.recommendedLimit).toBe(0);
    }
  }, 60000);

  it('returns null for invalid wallet', async () => {
    const result = await underwrite('invalid');
    expect(result).toBeNull();
  });

  it('returns null for wrong length', async () => {
    const result = await underwrite('AAAA');
    expect(result).toBeNull();
  });

  it('returns null for invalid chars', async () => {
    const result = await underwrite('0'.repeat(58));
    expect(result).toBeNull();
  });

  it('confidence is within valid range', async () => {
    const result = await underwrite(TESTNET_WALLET);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.40);
    expect(result!.confidence).toBeLessThanOrEqual(0.95);
  }, 60000);
});

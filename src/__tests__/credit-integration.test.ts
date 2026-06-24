import { describe, it, expect } from 'vitest';
import { estimateCredit } from '../credit';

const TESTNET_WALLET = 'GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A';

describe('Credit Capacity Estimation — Integration Tests (Real Testnet)', () => {
  it('returns valid structure for a real wallet', async () => {
    const result = await estimateCredit(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(result!.wallet).toBe(TESTNET_WALLET);
    expect(typeof result!.estimatedLimit).toBe('number');
    expect(result!.estimatedLimit).toBeGreaterThanOrEqual(0);
    expect(result!.estimatedLimit).toBeLessThanOrEqual(1350);
    expect(['low', 'medium', 'high', 'critical']).toContain(result!.risk);
    expect(typeof result!.confidence).toBe('number');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.40);
    expect(result!.confidence).toBeLessThanOrEqual(0.95);
    expect(typeof result!.approved).toBe('boolean');
  }, 30000);

  it('returns valid breakdown', async () => {
    const result = await estimateCredit(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(typeof result!.breakdown.balanceCapacity).toBe('number');
    expect(result!.breakdown.balanceCapacity).toBeGreaterThanOrEqual(0);
    expect(typeof result!.breakdown.activityBonus).toBe('number');
    expect(typeof result!.breakdown.ageBonus).toBe('number');
    expect(typeof result!.breakdown.riskPenalty).toBe('number');
  }, 30000);

  it('estimatedLimit matches breakdown calculation', async () => {
    const result = await estimateCredit(TESTNET_WALLET);

    expect(result).not.toBeNull();
    const b = result!.breakdown;
    const raw = b.balanceCapacity + b.activityBonus + b.ageBonus - b.riskPenalty;
    const expected = Math.round(Math.max(0, Math.min(1350, raw)) * 100) / 100;
    expect(result!.estimatedLimit).toBe(expected);
  }, 30000);

  it('returns non-empty explanation', async () => {
    const result = await estimateCredit(TESTNET_WALLET);

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.explanation)).toBe(true);
    expect(result!.explanation.length).toBeGreaterThanOrEqual(2);
    for (const reason of result!.explanation) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('assesses requested amount correctly', async () => {
    const result = await estimateCredit(TESTNET_WALLET, 100);

    expect(result).not.toBeNull();
    expect(typeof result!.approved).toBe('boolean');
    if (result!.estimatedLimit >= 100) {
      expect(result!.approved).toBe(true);
    } else {
      expect(result!.approved).toBe(false);
    }
  }, 30000);

  it('returns null for invalid wallet', async () => {
    const result = await estimateCredit('invalid');
    expect(result).toBeNull();
  });

  it('returns null for wrong length', async () => {
    const result = await estimateCredit('AAAA');
    expect(result).toBeNull();
  });

  it('returns null for invalid chars', async () => {
    const result = await estimateCredit('0'.repeat(58));
    expect(result).toBeNull();
  });

  it('risk matches limit thresholds without requested amount', async () => {
    const result = await estimateCredit(TESTNET_WALLET);
    expect(result).not.toBeNull();
    const { estimatedLimit, risk } = result!;
    if (estimatedLimit >= 500) expect(risk).toBe('low');
    else if (estimatedLimit >= 200) expect(risk).toBe('medium');
    else if (estimatedLimit >= 50) expect(risk).toBe('high');
    else expect(risk).toBe('critical');
  }, 30000);

  it('confidence is consistent with data availability', async () => {
    const result = await estimateCredit(TESTNET_WALLET);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.40);
    expect(result!.confidence).toBeLessThanOrEqual(0.95);
  }, 30000);
});

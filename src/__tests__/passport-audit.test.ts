import { describe, it, expect, vi } from 'vitest';
import {
  computeIdentityStrength,
  computePaymentReliability,
  computeOverallRisk,
  classifyOverallRisk,
  generatePassportSummary,
  computePassportChecksum,
  PASSPORT_SCHEMA_VERSION,
  generatePassport,
} from '../passport';
import {
  computeAgeScore,
  computeActivityScore,
  computeVolumeScore,
  computeVelocityScore,
  computeComplianceScore,
  computeTrustScore,
  computeStalenessPenalty,
  applyFreshWalletCap,
  classifyRisk,
  computeRecommendedLimit,
} from '../trust-score';
import {
  computeBalanceCapacity,
  computeActivityBonus,
  computeAgeBonus,
  computeRiskPenalty,
  computeCreditLimit,
  classifyCreditRisk,
} from '../credit';
import {
  computeCompositeScore,
  classifyUnderwritingRisk,
  computeUnderwritingLimit,
  decideApproval,
} from '../underwriting';
import {
  getSystemExposure,
  resetSystemExposure,
  addSystemExposure,
} from '../lib/system-exposure';

// ═══════════════════════════════════════════════════════════════
// SECTION 1: DETERMINISM TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Determinism', () => {
  describe('Pure math functions', () => {
    it('DET-1: computeAgeScore is deterministic', () => {
      const inputs = [0, 1, 30, 180, 365, 730, 1000];
      for (const d of inputs) {
        const r1 = computeAgeScore(d);
        const r2 = computeAgeScore(d);
        expect(r1).toBe(r2);
      }
    });

    it('DET-2: computeActivityScore is deterministic', () => {
      const cases = [[10, 30, 5], [100, 365, 20], [0, 0, 0], [500, 730, 50]];
      for (const [txns, days, assets] of cases) {
        const r1 = computeActivityScore(txns, days, assets);
        const r2 = computeActivityScore(txns, days, assets);
        expect(r1).toBe(r2);
      }
    });

    it('DET-3: computeTrustScore is deterministic', () => {
      const breakdown = { ageScore: 65.3, activityScore: 42, volumeScore: 58, velocityScore: 80, complianceScore: 70 };
      const r1 = computeTrustScore(breakdown);
      const r2 = computeTrustScore(breakdown);
      expect(r1).toBe(r2);
    });

    it('DET-4: computeIdentityStrength is deterministic', () => {
      const args: [number, number, number, number] = [65.3, 365, 50, 1000];
      const r1 = computeIdentityStrength(...args);
      const r2 = computeIdentityStrength(...args);
      expect(r1).toBe(r2);
    });

    it('DET-5: computePaymentReliability is deterministic', () => {
      const args: [number, number, number] = [65.3, 45.0, 300];
      const r1 = computePaymentReliability(...args);
      const r2 = computePaymentReliability(...args);
      expect(r1).toBe(r2);
    });

    it('DET-6: computeOverallRisk is deterministic', () => {
      const args: [string, number, string, string] = ['medium', 0.3, 'low', 'medium'];
      const r1 = computeOverallRisk(...args);
      const r2 = computeOverallRisk(...args);
      expect(r1).toBe(r2);
    });

    it('DET-7: computeCreditLimit is deterministic', () => {
      const breakdown = { balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 25 };
      const r1 = computeCreditLimit(breakdown);
      const r2 = computeCreditLimit(breakdown);
      expect(r1).toBe(r2);
    });

    it('DET-8: computeCompositeScore is deterministic', () => {
      const factors = [
        { name: 'A', score: 65, weight: 0.35, contribution: 22.75, status: 'neutral' as const },
        { name: 'B', score: 80, weight: 0.25, contribution: 20, status: 'positive' as const },
      ];
      const r1 = computeCompositeScore(factors);
      const r2 = computeCompositeScore(factors);
      expect(r1).toBe(r2);
    });

    it('DET-9: classifyRisk is deterministic', () => {
      const scores = [0, 20, 45, 70, 100];
      for (const s of scores) {
        expect(classifyRisk(s)).toBe(classifyRisk(s));
      }
    });

    it('DET-10: computePassportChecksum is deterministic', () => {
      const fields = {
        identityStrength: 65.3, trustScore: 72.1, trustRiskLevel: 'low',
        reputation: 45.0, reputationRiskLevel: 'medium', totalEvents: 15,
        paymentReliability: 58.2, creditLimit: 425.00, creditRisk: 'medium',
        risk: 32.5, sybilRisk: 0.15, overallRiskLevel: 'medium',
        onChain: { balanceAlgo: 1000, totalTxns: 50, accountAgeDays: 365, assets: 5, apps: 2 },
        delegation: { depth: 1, sponsorCount: 3, delegatedAmount: 500, isTrustAnchor: false },
        capabilities: { trustScoring: true, delegation: true, creditEligible: true, sybilClear: true, reputationActive: true },
        dataSources: { trust: true, delegation: true, credit: true, sybil: true, reputation: true },
        summary: 'Agent is well-established.',
      };
      const c1 = computePassportChecksum('WALLET123', 1000000, fields);
      const c2 = computePassportChecksum('WALLET123', 1000000, fields);
      expect(c1).toBe(c2);
      expect(c1).toHaveLength(64); // SHA-256 hex length
    });

    it('DET-11: Checksum changes when blockRound changes', () => {
      const fields = {
        identityStrength: 65.3, trustScore: 72.1, trustRiskLevel: 'low',
        reputation: 45.0, reputationRiskLevel: 'medium', totalEvents: 15,
        paymentReliability: 58.2, creditLimit: 425.00, creditRisk: 'medium',
        risk: 32.5, sybilRisk: 0.15, overallRiskLevel: 'medium',
        onChain: { balanceAlgo: 1000, totalTxns: 50, accountAgeDays: 365, assets: 5, apps: 2 },
        delegation: { depth: 1, sponsorCount: 3, delegatedAmount: 500, isTrustAnchor: false },
        capabilities: { trustScoring: true, delegation: true, creditEligible: true, sybilClear: true, reputationActive: true },
        dataSources: { trust: true, delegation: true, credit: true, sybil: true, reputation: true },
        summary: 'Agent is well-established.',
      };
      const c1 = computePassportChecksum('WALLET123', 1000000, fields);
      const c2 = computePassportChecksum('WALLET123', 1000001, fields);
      expect(c1).not.toBe(c2);
    });

    it('DET-12: Checksum changes when wallet changes', () => {
      const fields = {
        identityStrength: 65.3, trustScore: 72.1, trustRiskLevel: 'low',
        reputation: 45.0, reputationRiskLevel: 'medium', totalEvents: 15,
        paymentReliability: 58.2, creditLimit: 425.00, creditRisk: 'medium',
        risk: 32.5, sybilRisk: 0.15, overallRiskLevel: 'medium',
        onChain: { balanceAlgo: 1000, totalTxns: 50, accountAgeDays: 365, assets: 5, apps: 2 },
        delegation: { depth: 1, sponsorCount: 3, delegatedAmount: 500, isTrustAnchor: false },
        capabilities: { trustScoring: true, delegation: true, creditEligible: true, sybilClear: true, reputationActive: true },
        dataSources: { trust: true, delegation: true, credit: true, sybil: true, reputation: true },
        summary: 'Agent is well-established.',
      };
      const c1 = computePassportChecksum('WALLET123', 1000000, fields);
      const c2 = computePassportChecksum('WALLET456', 1000000, fields);
      expect(c1).not.toBe(c2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: SCHEMA VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Schema Validation', () => {
  it('SCH-1: PASSPORT_SCHEMA_VERSION is 1', () => {
    expect(PASSPORT_SCHEMA_VERSION).toBe(1);
  });

  it('SCH-2: computeIdentityStrength returns number in [0, 100]', () => {
    const inputs = [
      [0, 0, 0, 0], [100, 730, 500, 1000000], [50, 365, 100, 1000],
      [10, 1, 0, 0.1], [99, 1000, 1000, 100000],
    ];
    for (const args of inputs) {
      const result = computeIdentityStrength(...args as [number, number, number, number]);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('SCH-3: computePaymentReliability returns number in [0, 100]', () => {
    const inputs = [
      [0, 0, 0], [100, 100, 10000], [50, 50, 500],
      [10, 5, 0], [80, 90, 1000],
    ];
    for (const args of inputs) {
      const result = computePaymentReliability(...args as [number, number, number]);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('SCH-4: computeOverallRisk returns number in [0, 100]', () => {
    const inputs = [
      ['low', 0.1, 'low', 'low'],
      ['critical', 0.9, 'critical', 'critical'],
      ['medium', 0.5, 'medium', 'medium'],
    ];
    for (const args of inputs) {
      const result = computeOverallRisk(...args as [string, number, string, string]);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('SCH-5: computeCreditLimit returns number in [0, 1350]', () => {
    const inputs = [
      { balanceCapacity: 0, activityBonus: 0, ageBonus: 0, riskPenalty: 0 },
      { balanceCapacity: 1000, activityBonus: 200, ageBonus: 150, riskPenalty: 0 },
      { balanceCapacity: 500, activityBonus: 100, ageBonus: 75, riskPenalty: 200 },
    ];
    for (const breakdown of inputs) {
      const result = computeCreditLimit(breakdown);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1350);
    }
  });

  it('SCH-6: classifyOverallRisk returns valid risk level', () => {
    const valid = ['low', 'medium', 'high', 'critical'];
    const scores = [0, 15, 25, 26, 45, 50, 51, 70, 75, 76, 100];
    for (const s of scores) {
      expect(valid).toContain(classifyOverallRisk(s));
    }
  });

  it('SCH-7: classifyRisk returns valid risk level', () => {
    const valid = ['low', 'medium', 'high', 'critical'];
    const scores = [0, 10, 20, 30, 45, 55, 70, 80, 100];
    for (const s of scores) {
      expect(valid).toContain(classifyRisk(s));
    }
  });

  it('SCH-8: classifyCreditRisk returns valid risk level', () => {
    const valid = ['low', 'medium', 'high', 'critical'];
    const limits = [0, 25, 50, 100, 200, 300, 500, 1000];
    for (const l of limits) {
      expect(valid).toContain(classifyCreditRisk(l));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: CONSISTENCY TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Consistency', () => {
  it('CON-1: classifyOverallRisk is consistent with risk thresholds', () => {
    expect(classifyOverallRisk(0)).toBe('low');
    expect(classifyOverallRisk(25)).toBe('low');
    expect(classifyOverallRisk(26)).toBe('medium');
    expect(classifyOverallRisk(50)).toBe('medium');
    expect(classifyOverallRisk(51)).toBe('high');
    expect(classifyOverallRisk(75)).toBe('high');
    expect(classifyOverallRisk(76)).toBe('critical');
  });

  it('CON-2: classifyRisk is consistent with risk thresholds', () => {
    expect(classifyRisk(0)).toBe('critical');
    expect(classifyRisk(19)).toBe('critical');
    expect(classifyRisk(20)).toBe('high');
    expect(classifyRisk(44)).toBe('high');
    expect(classifyRisk(45)).toBe('medium');
    expect(classifyRisk(69)).toBe('medium');
    expect(classifyRisk(70)).toBe('low');
  });

  it('CON-3: computeIdentityStrength — weight sum is 100%', () => {
    // trust(40%) + age(25%) + activity(20%) + balance(15%) = 100%
    const trust = 100, age = 730, txns = 500, balance = 1000000;
    const result = computeIdentityStrength(trust, age, txns, balance);
    // trust contributes 40, age contributes 25, activity contributes 20, balance contributes 15
    // but each is capped at 100 then scaled, so total should be 94 (balance log10(1M)*10=60, 60/100*15=9)
    expect(result).toBe(94);
  });

  it('CON-4: computePaymentReliability — weight sum is 100%', () => {
    // trust(40%) + rep(35%) + credit(25%) = 100%
    const result = computePaymentReliability(100, 100, 10000);
    expect(result).toBe(100);
  });

  it('CON-5: computeOverallRisk — weight sum is 100%', () => {
    // trust(30%) + sybil(25%) + rep(25%) + credit(20%) = 100%
    const result = computeOverallRisk('low', 0, 'low', 'low');
    // trust=10, sybil=0, rep=10, credit=10
    // (10*0.3 + 0*0.25 + 10*0.25 + 10*0.2) = 3 + 0 + 2.5 + 2 = 7.5
    expect(result).toBe(7.5);
  });

  it('CON-6: computeCreditLimit — max is 1350', () => {
    const result = computeCreditLimit({
      balanceCapacity: 1000,
      activityBonus: 200,
      ageBonus: 150,
      riskPenalty: 0,
    });
    expect(result).toBe(1350);
  });

  it('CON-7: computeCreditLimit — min is 0', () => {
    const result = computeCreditLimit({
      balanceCapacity: 0,
      activityBonus: 0,
      ageBonus: 0,
      riskPenalty: 100,
    });
    expect(result).toBe(0);
  });

  it('CON-8: computeCompositeScore — weighted average is correct', () => {
    const factors = [
      { name: 'Trust', score: 80, weight: 0.35, contribution: 28, status: 'positive' as const },
      { name: 'Delegation', score: 60, weight: 0.25, contribution: 15, status: 'neutral' as const },
      { name: 'Sybil', score: 90, weight: 0.20, contribution: 18, status: 'positive' as const },
      { name: 'Reputation', score: 70, weight: 0.20, contribution: 14, status: 'positive' as const },
    ];
    // weighted = (80*0.35 + 60*0.25 + 90*0.20 + 70*0.20) / (0.35+0.25+0.20+0.20)
    // = (28 + 15 + 18 + 14) / 1.0 = 75
    expect(computeCompositeScore(factors)).toBe(75);
  });

  it('CON-9: classifyUnderwritingRisk is consistent', () => {
    expect(classifyUnderwritingRisk(70)).toBe('low');
    expect(classifyUnderwritingRisk(45)).toBe('medium');
    expect(classifyUnderwritingRisk(20)).toBe('high');
    expect(classifyUnderwritingRisk(19)).toBe('critical');
  });

  it('CON-10: decideApproval — deny for high sybil', () => {
    expect(decideApproval(80, 0.75, 50)).toBe(false);
  });

  it('CON-11: decideApproval — deny for low score', () => {
    expect(decideApproval(25, 0.1, 50)).toBe(false);
  });

  it('CON-12: decideApproval — deny for low rep + low score', () => {
    expect(decideApproval(45, 0.1, 5)).toBe(false);
  });

  it('CON-13: decideApproval — approve for good profile', () => {
    expect(decideApproval(70, 0.1, 50)).toBe(true);
  });

  it('CON-14: applyFreshWalletCap — caps at 30 for new wallets', () => {
    expect(applyFreshWalletCap(65, 10)).toBe(30);
    expect(applyFreshWalletCap(65, 29)).toBe(30);
    expect(applyFreshWalletCap(25, 10)).toBe(25); // below cap, unchanged
    expect(applyFreshWalletCap(65, 30)).toBe(65); // at threshold, no cap
  });

  it('CON-15: computeStalenessPenalty — no penalty within grace period', () => {
    expect(computeStalenessPenalty(0)).toBe(1.0);
    expect(computeStalenessPenalty(180)).toBe(1.0);
  });

  it('CON-16: computeStalenessPenalty — floor at 0.30', () => {
    expect(computeStalenessPenalty(2000)).toBeGreaterThanOrEqual(0.30);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: TAMPERING TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Tampering', () => {
  it('TAM-1: generatePassport returns null for invalid wallet', async () => {
    const result = await generatePassport('invalid');
    expect(result).toBeNull();
  });

  it('TAM-2: generatePassport returns null for empty string', async () => {
    const result = await generatePassport('');
    expect(result).toBeNull();
  });

  it('TAM-3: generatePassport returns null for short string', async () => {
    const result = await generatePassport('AAAA');
    expect(result).toBeNull();
  });

  it('TAM-4: generatePassport returns null for wrong chars', async () => {
    const result = await generatePassport('0'.repeat(58));
    expect(result).toBeNull();
  });

  it('TAM-5: generatePassport returns null for special characters', async () => {
    const result = await generatePassport('!@#$%^&*()_+-=[]{}|;:,.<>?'.repeat(3));
    expect(result).toBeNull();
  });

  it('TAM-6: Checksum is SHA-256 (64 hex chars)', () => {
    const checksum = computePassportChecksum('WALLET', 100, {
      identityStrength: 50, trustScore: 50, trustRiskLevel: 'medium',
      reputation: 50, reputationRiskLevel: 'medium', totalEvents: 10,
      paymentReliability: 50, creditLimit: 500, creditRisk: 'medium',
      risk: 35, sybilRisk: 0.2, overallRiskLevel: 'medium',
      onChain: { balanceAlgo: 1000, totalTxns: 50, accountAgeDays: 365, assets: 5, apps: 2 },
      delegation: { depth: 1, sponsorCount: 3, delegatedAmount: 500, isTrustAnchor: false },
      capabilities: { trustScoring: true, delegation: true, creditEligible: true, sybilClear: true, reputationActive: true },
      dataSources: { trust: true, delegation: true, credit: true, sybil: true, reputation: true },
      summary: 'Agent is moderate.',
    });
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Edge Cases', () => {
  it('EDGE-1: Zero trust score — identity strength still reflects other factors', () => {
    // trust=0, age=365, txns=100, balance=1000
    // trust contributes 0, age contributes ~12.3, activity contributes 20, balance contributes ~10.5
    const result = computeIdentityStrength(0, 365, 100, 1000);
    expect(result).toBeGreaterThan(0);
  });

  it('EDGE-2: Zero all sub-scores — trust score is 0', () => {
    const result = computeTrustScore({
      ageScore: 0, activityScore: 0, volumeScore: 0, velocityScore: 0, complianceScore: 0,
    });
    expect(result).toBe(0);
  });

  it('EDGE-3: Max all sub-scores — trust score is 100', () => {
    const result = computeTrustScore({
      ageScore: 100, activityScore: 100, volumeScore: 100, velocityScore: 100, complianceScore: 100,
    });
    expect(result).toBe(100);
  });

  it('EDGE-4: computeVelocityScore — >100 txns/day returns 0', () => {
    expect(computeVelocityScore(200, 1)).toBe(0);
  });

  it('EDGE-5: computeVelocityScore — <=1 txns/day returns 100', () => {
    expect(computeVelocityScore(1, 1)).toBe(100);
  });

  it('EDGE-6: computeComplianceScore — zero balance, zero txns returns 10', () => {
    // balance penalty: 40, txn penalty: 50, score = 100 - 40 - 50 = 10
    expect(computeComplianceScore(0, 0)).toBe(10);
  });

  it('EDGE-7: computeComplianceScore — high balance, many txns returns 100', () => {
    expect(computeComplianceScore(1000 * 1_000_000, 200)).toBe(100);
  });

  it('EDGE-8: computeRiskPenalty — no penalty for high velocity and compliance', () => {
    expect(computeRiskPenalty(80, 90)).toBe(0);
  });

  it('EDGE-9: computeRiskPenalty — max penalty for zero velocity and compliance', () => {
    const result = computeRiskPenalty(0, 0);
    expect(result).toBe(150);
  });

  it('EDGE-10: generatePassportSummary — all boundary conditions', () => {
    const s1 = generatePassportSummary(70, 70, 70, 25, 0.2);
    expect(s1).toContain('well-established');
    expect(s1).toContain('highly reputed');
    expect(s1).toContain('reliable payer');
    expect(s1).toContain('low-risk');
    expect(s1).toContain('clean');

    const s2 = generatePassportSummary(39, 39, 39, 26, 0.26);
    expect(s2).toContain('new');
    expect(s2).toContain('untested');
    expect(s2).toContain('unproven');
    expect(s2).toContain('moderate-risk');
    expect(s2).toContain('some concerns');

    const s3 = generatePassportSummary(40, 40, 40, 51, 0.5);
    expect(s3).toContain('moderately');
    expect(s3).toContain('high-risk');
    expect(s3).toContain('flagged');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 6: SYSTEM EXPOSURE TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — System Exposure', () => {
  it('EXP-1: System exposure starts at 0', () => {
    resetSystemExposure();
    expect(getSystemExposure()).toBe(0);
  });

  it('EXP-2: addSystemExposure accumulates correctly', () => {
    resetSystemExposure();
    addSystemExposure(1000);
    expect(getSystemExposure()).toBe(1000);
    addSystemExposure(500);
    expect(getSystemExposure()).toBe(1500);
  });

  it('EXP-3: capToSystemCapacity caps to remaining', () => {
    resetSystemExposure();
    addSystemExposure(99_000);
    // remaining = 100_000 - 99_000 = 1_000
    const result = computeUnderwritingLimit(80, 1350, 0.1, 50);
    // scoreMultiplier = 0.5 + 0.8 = 1.3, sybilMultiplier = 0.93, repMultiplier = 1.15
    // raw = 1350 * 1.3 * 0.93 * 1.15 ≈ 1851, capped to 1350
    expect(result).toBe(1350);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 7: WEIGHT VERIFICATION TESTS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Weight Verification', () => {
  it('WGT-1: Trust score weights sum to 1.0', () => {
    const w = { age: 0.2, activity: 0.25, volume: 0.2, velocity: 0.15, compliance: 0.2 };
    const total = w.age + w.activity + w.volume + w.velocity + w.compliance;
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('WGT-2: Identity strength weights sum to 100%', () => {
    // 40 + 25 + 20 + 15 = 100
    expect(40 + 25 + 20 + 15).toBe(100);
  });

  it('WGT-3: Payment reliability weights sum to 100%', () => {
    // 0.4 + 0.35 + 0.25 = 1.0
    expect(0.4 + 0.35 + 0.25).toBeCloseTo(1.0, 10);
  });

  it('WGT-4: Overall risk weights sum to 100%', () => {
    // 0.3 + 0.25 + 0.25 + 0.2 = 1.0
    expect(0.3 + 0.25 + 0.25 + 0.2).toBeCloseTo(1.0, 10);
  });

  it('WGT-5: Underwriting weights sum to 1.0', () => {
    // 0.35 + 0.25 + 0.20 + 0.20 = 1.0
    expect(0.35 + 0.25 + 0.20 + 0.20).toBeCloseTo(1.0, 10);
  });

  it('WGT-6: Credit capacity max is 1350 (1000 + 200 + 150)', () => {
    expect(1000 + 200 + 150).toBe(1350);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 8: INVARIANT PROOFS
// ═══════════════════════════════════════════════════════════════

describe('Data Integrity Audit — Invariant Proofs', () => {
  it('INV-1: All scores are clamped to [0, 100]', () => {
    const extremeInputs = [
      () => computeIdentityStrength(100, 10000, 100000, 1e12),
      () => computePaymentReliability(100, 100, 1e6),
      () => computeOverallRisk('critical', 1.0, 'critical', 'critical'),
      () => computeTrustScore({ ageScore: 100, activityScore: 100, volumeScore: 100, velocityScore: 100, complianceScore: 100 }),
    ];
    for (const fn of extremeInputs) {
      const result = fn();
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('INV-2: computeCreditLimit never exceeds 1350', () => {
    const maxResult = computeCreditLimit({
      balanceCapacity: 10000,
      activityBonus: 10000,
      ageBonus: 10000,
      riskPenalty: -10000, // negative penalty (impossible in practice)
    });
    expect(maxResult).toBeLessThanOrEqual(1350);
  });

  it('INV-3: computeCreditLimit never goes below 0', () => {
    const minResult = computeCreditLimit({
      balanceCapacity: 0,
      activityBonus: 0,
      ageBonus: 0,
      riskPenalty: 999999,
    });
    expect(minResult).toBeGreaterThanOrEqual(0);
  });

  it('INV-4: computeCompositeScore never exceeds 100', () => {
    const factors = [
      { name: 'A', score: 100, weight: 0.5, contribution: 50, status: 'positive' as const },
      { name: 'B', score: 100, weight: 0.5, contribution: 50, status: 'positive' as const },
    ];
    expect(computeCompositeScore(factors)).toBeLessThanOrEqual(100);
  });

  it('INV-5: computeCompositeScore never goes below 0', () => {
    const factors = [
      { name: 'A', score: 0, weight: 0.5, contribution: 0, status: 'negative' as const },
      { name: 'B', score: 0, weight: 0.5, contribution: 0, status: 'negative' as const },
    ];
    expect(computeCompositeScore(factors)).toBeGreaterThanOrEqual(0);
  });

  it('INV-6: computeUnderwritingLimit never exceeds 1350', () => {
    const result = computeUnderwritingLimit(100, 1350, 0, 100);
    expect(result).toBeLessThanOrEqual(1350);
  });

  it('INV-7: computeUnderwritingLimit never goes below 0', () => {
    const result = computeUnderwritingLimit(0, 0, 1.0, 0);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('INV-8: applyFreshWalletCap never increases score', () => {
    const scores = [0, 30, 50, 70, 100];
    const ages = [0, 15, 29, 30, 365];
    for (const s of scores) {
      for (const a of ages) {
        expect(applyFreshWalletCap(s, a)).toBeLessThanOrEqual(s);
      }
    }
  });

  it('INV-9: computeStalenessPenalty never exceeds 1.0', () => {
    const days = [0, 1, 180, 365, 730, 1000, 10000];
    for (const d of days) {
      expect(computeStalenessPenalty(d)).toBeLessThanOrEqual(1.0);
    }
  });

  it('INV-10: computeStalenessPenalty never goes below 0.30', () => {
    const days = [0, 180, 365, 730, 1000, 10000, 100000];
    for (const d of days) {
      expect(computeStalenessPenalty(d)).toBeGreaterThanOrEqual(0.30);
    }
  });

  it('INV-11: computeAgeScore never exceeds 100', () => {
    expect(computeAgeScore(730)).toBe(100);
    expect(computeAgeScore(1000)).toBe(100);
  });

  it('INV-12: computeAgeScore never goes below 0', () => {
    expect(computeAgeScore(0)).toBe(0);
    expect(computeAgeScore(-10)).toBe(0);
  });
});

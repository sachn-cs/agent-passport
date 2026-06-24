import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { scoreWallet } from '../trust-score';
import { scoreDelegation } from '../delegation';
import { checkCounterparty } from '../counterparty';
import { estimateCredit } from '../credit';
import { detectSybil } from '../sybil';
import { recordEvent, computeReputation } from '../reputation';

vi.mock('../trust-score', () => ({
  scoreWallet: vi.fn(),
}));

vi.mock('../delegation', () => ({
  scoreDelegation: vi.fn(),
}));

vi.mock('../counterparty', () => ({
  checkCounterparty: vi.fn(),
}));

vi.mock('../credit', () => ({
  estimateCredit: vi.fn(),
}));

vi.mock('../sybil', () => ({
  detectSybil: vi.fn(),
}));

vi.mock('../reputation', () => ({
  recordEvent: vi.fn(),
  computeReputation: vi.fn(),
}));

const mockScoreWallet = vi.mocked(scoreWallet);
const mockScoreDelegation = vi.mocked(scoreDelegation);
const mockCheckCounterparty = vi.mocked(checkCounterparty);
const mockEstimateCredit = vi.mocked(estimateCredit);
const mockDetectSybil = vi.mocked(detectSybil);
const mockRecordEvent = vi.mocked(recordEvent);
const mockComputeReputation = vi.mocked(computeReputation);

function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/score', async (req, res) => {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: 'Missing required query parameter: wallet' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    try {
      const result = await scoreWallet(wallet);
      if (!result) {
        res.status(404).json({ error: 'Wallet not found on testnet' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/delegation', async (req, res) => {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: 'Missing required query parameter: wallet' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    try {
      const result = await scoreDelegation(wallet);
      if (!result) {
        res.status(404).json({ error: 'Wallet not found on testnet' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/counterparty-check', async (req, res) => {
    const { buyer } = req.body;
    if (!buyer) {
      res.status(400).json({ error: 'Missing required field: buyer' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(buyer)) {
      res.status(400).json({ error: 'Invalid buyer wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    try {
      const result = await checkCounterparty(buyer);
      if (!result) {
        res.status(404).json({ error: 'Wallet not found on testnet' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/credit-estimate', async (req, res) => {
    const { wallet, amount } = req.body;
    if (!wallet) {
      res.status(400).json({ error: 'Missing required field: wallet' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    if (amount !== undefined && (typeof amount !== 'number' || amount <= 0)) {
      res.status(400).json({ error: 'Amount must be a positive number.' });
      return;
    }
    try {
      const result = await estimateCredit(wallet, amount);
      if (!result) {
        res.status(404).json({ error: 'Wallet not found on testnet' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/sybil-check', async (req, res) => {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: 'Missing required query parameter: wallet' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    try {
      const result = await detectSybil(wallet);
      if (!result) {
        res.status(404).json({ error: 'Wallet not found on testnet' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/reputation', async (req, res) => {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: 'Missing required query parameter: wallet' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    try {
      const result = await computeReputation(wallet);
      if (!result) {
        res.status(404).json({ error: 'Wallet not found on testnet' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/reputation/record', async (req, res) => {
    const { wallet, eventType, amount, counterparty } = req.body;
    if (!wallet) {
      res.status(400).json({ error: 'Missing required field: wallet' });
      return;
    }
    if (!/^[A-Z2-7]{58}$/.test(wallet)) {
      res.status(400).json({ error: 'Invalid wallet address. Must be 58-character base32 (A-Z, 2-7).' });
      return;
    }
    if (!eventType) {
      res.status(400).json({ error: 'Missing required field: eventType' });
      return;
    }
    const validTypes = ['payment', 'purchase', 'dispute', 'refund', 'endorsement', 'service'];
    if (!validTypes.includes(eventType)) {
      res.status(400).json({ error: `Invalid eventType. Must be one of: ${validTypes.join(', ')}` });
      return;
    }
    if (amount !== undefined && (typeof amount !== 'number' || amount < 0)) {
      res.status(400).json({ error: 'Amount must be a non-negative number.' });
      return;
    }
    try {
      const result = await recordEvent(wallet, eventType, amount || 0, counterparty);
      if (!result) {
        res.status(400).json({ error: 'Failed to record event' });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Agent Passport',
      version: '0.1.0',
      network: process.env.ALGO_NETWORK || 'testnet',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

describe('API Endpoints', () => {
  const app = createApp();
  const VALID_WALLET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

  describe('GET /score', () => {
    it('returns 400 when wallet param is missing', async () => {
      const res = await request(app).get('/score');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid wallet format', async () => {
      const res = await request(app).get('/score?wallet=not-a-wallet');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 400 for wallet with wrong length', async () => {
      const res = await request(app).get('/score?wallet=AAAA');
      expect(res.status).toBe(400);
    });

    it('returns 404 when scoreWallet returns null', async () => {
      mockScoreWallet.mockResolvedValueOnce(null);
      const res = await request(app).get(`/score?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 200 with score data', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        trustScore: 75,
        riskLevel: 'low',
        approved: true,
        recommendedLimit: 450,
        breakdown: { ageScore: 80, activityScore: 70, volumeScore: 60, velocityScore: 80, complianceScore: 100 },
        onChain: { balanceAlgo: 100, totalTxns: 50, assetCount: 3, appCount: 1, accountAgeDays: 365, firstSeenRound: 1000, lastSeenRound: 2000 },
        explanation: ['Test'],
      };
      mockScoreWallet.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).get(`/score?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(200);
      expect(res.body.trustScore).toBe(75);
      expect(res.body.wallet).toBe(VALID_WALLET);
    });

    it('returns 500 when scoreWallet throws', async () => {
      mockScoreWallet.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).get(`/score?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('GET /delegation', () => {
    it('returns 400 when wallet param is missing', async () => {
      const res = await request(app).get('/delegation');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid wallet format', async () => {
      const res = await request(app).get('/delegation?wallet=not-a-wallet');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 404 when scoreDelegation returns null', async () => {
      mockScoreDelegation.mockResolvedValueOnce(null);
      const res = await request(app).get(`/delegation?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 200 with delegation data', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        trustScore: 65,
        riskLevel: 'medium',
        approved: true,
        recommendedLimit: 390,
        breakdown: { depthScore: 60, sponsorQualityScore: 70, sponsorCountScore: 40, amountScore: 80 },
        delegation: { depth: 2, sponsorCount: 3, sponsorQuality: 65, delegationPath: [VALID_WALLET], totalDelegatedAmount: 5000000, isTrustAnchor: false, trustedAncestors: 1 },
        explanation: ['Test delegation'],
      };
      mockScoreDelegation.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).get(`/delegation?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(200);
      expect(res.body.trustScore).toBe(65);
      expect(res.body.delegation.depth).toBe(2);
    });

    it('returns 500 when scoreDelegation throws', async () => {
      mockScoreDelegation.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).get(`/delegation?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('POST /counterparty-check', () => {
    it('returns 400 when buyer is missing', async () => {
      const res = await request(app).post('/counterparty-check').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid buyer format', async () => {
      const res = await request(app).post('/counterparty-check').send({ buyer: 'not-a-wallet' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 404 when checkCounterparty returns null', async () => {
      mockCheckCounterparty.mockResolvedValueOnce(null);
      const res = await request(app).post('/counterparty-check').send({ buyer: VALID_WALLET });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 200 with counterparty result', async () => {
      const mockResult = {
        allow: true,
        confidence: 0.85,
        riskLevel: 'low',
        trustScore: 72,
        onChainScore: 75,
        delegationScore: 65,
        explanation: ['Strong on-chain history', 'Well-sponsored', 'Approved with 85% confidence'],
      };
      mockCheckCounterparty.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).post('/counterparty-check').send({ buyer: VALID_WALLET });
      expect(res.status).toBe(200);
      expect(res.body.allow).toBe(true);
      expect(res.body.confidence).toBe(0.85);
      expect(res.body.trustScore).toBe(72);
    });

    it('returns 500 when checkCounterparty throws', async () => {
      mockCheckCounterparty.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).post('/counterparty-check').send({ buyer: VALID_WALLET });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('POST /credit-estimate', () => {
    it('returns 400 when wallet is missing', async () => {
      const res = await request(app).post('/credit-estimate').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid wallet format', async () => {
      const res = await request(app).post('/credit-estimate').send({ wallet: 'not-a-wallet' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 400 for invalid amount', async () => {
      const res = await request(app).post('/credit-estimate').send({ wallet: VALID_WALLET, amount: -100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('positive');
    });

    it('returns 400 for non-numeric amount', async () => {
      const res = await request(app).post('/credit-estimate').send({ wallet: VALID_WALLET, amount: 'not-a-number' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('positive');
    });

    it('returns 404 when estimateCredit returns null', async () => {
      mockEstimateCredit.mockResolvedValueOnce(null);
      const res = await request(app).post('/credit-estimate').send({ wallet: VALID_WALLET });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 200 with credit estimate', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        estimatedLimit: 342.50,
        risk: 'low',
        confidence: 0.78,
        approved: true,
        breakdown: { balanceCapacity: 250, activityBonus: 45, ageBonus: 30, riskPenalty: 0 },
        explanation: ['Strong collateral'],
      };
      mockEstimateCredit.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).post('/credit-estimate').send({ wallet: VALID_WALLET });
      expect(res.status).toBe(200);
      expect(res.body.estimatedLimit).toBe(342.50);
      expect(res.body.risk).toBe('low');
    });

    it('returns 200 with optional amount', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        estimatedLimit: 342.50,
        risk: 'low',
        confidence: 0.78,
        approved: true,
        breakdown: { balanceCapacity: 250, activityBonus: 45, ageBonus: 30, riskPenalty: 0 },
        explanation: ['Within capacity'],
      };
      mockEstimateCredit.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).post('/credit-estimate').send({ wallet: VALID_WALLET, amount: 200 });
      expect(res.status).toBe(200);
      expect(res.body.estimatedLimit).toBe(342.50);
    });

    it('returns 500 when estimateCredit throws', async () => {
      mockEstimateCredit.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).post('/credit-estimate').send({ wallet: VALID_WALLET });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('GET /sybil-check', () => {
    it('returns 400 when wallet param is missing', async () => {
      const res = await request(app).get('/sybil-check');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid wallet format', async () => {
      const res = await request(app).get('/sybil-check?wallet=not-a-wallet');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 404 when detectSybil returns null', async () => {
      mockDetectSybil.mockResolvedValueOnce(null);
      const res = await request(app).get(`/sybil-check?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 200 with sybil result', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        sybilRisk: 0.91,
        riskLevel: 'critical',
        confidence: 0.82,
        clusterSize: 4,
        signals: { creationClustering: 0.95, interactionDensity: 0.98, balanceSimilarity: 0.85, circularActivity: 0.72 },
        flaggedWallets: ['BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
        explanation: ['4 wallets created within 48 hours', 'High sybil risk'],
      };
      mockDetectSybil.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).get(`/sybil-check?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(200);
      expect(res.body.sybilRisk).toBe(0.91);
      expect(res.body.riskLevel).toBe('critical');
      expect(res.body.clusterSize).toBe(4);
    });

    it('returns 500 when detectSybil throws', async () => {
      mockDetectSybil.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).get(`/sybil-check?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('GET /reputation', () => {
    it('returns 400 when wallet param is missing', async () => {
      const res = await request(app).get('/reputation');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid wallet format', async () => {
      const res = await request(app).get('/reputation?wallet=not-a-wallet');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 404 when computeReputation returns null', async () => {
      mockComputeReputation.mockResolvedValueOnce(null);
      const res = await request(app).get(`/reputation?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 200 with reputation result', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        reputation: 75,
        riskLevel: 'low',
        confidence: 0.88,
        breakdown: { successfulPayments: 5, successfulPurchases: 3, disputes: 0, refunds: 0, sponsorEndorsements: 2, serviceInteractions: 1, totalEvents: 11, positiveEvents: 11, negativeEvents: 0 },
        explanation: ['Strong reputation'],
      };
      mockComputeReputation.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).get(`/reputation?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(200);
      expect(res.body.reputation).toBe(75);
      expect(res.body.riskLevel).toBe('low');
    });

    it('returns 500 when computeReputation throws', async () => {
      mockComputeReputation.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).get(`/reputation?wallet=${VALID_WALLET}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('POST /reputation/record', () => {
    it('returns 400 when wallet is missing', async () => {
      const res = await request(app).post('/reputation/record').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid wallet format', async () => {
      const res = await request(app).post('/reputation/record').send({ wallet: 'not-a-wallet', eventType: 'payment' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 400 when eventType is missing', async () => {
      const res = await request(app).post('/reputation/record').send({ wallet: VALID_WALLET });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('returns 400 for invalid eventType', async () => {
      const res = await request(app).post('/reputation/record').send({ wallet: VALID_WALLET, eventType: 'invalid' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 400 for negative amount', async () => {
      const res = await request(app).post('/reputation/record').send({ wallet: VALID_WALLET, eventType: 'payment', amount: -100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('non-negative');
    });

    it('returns 400 when recordEvent returns null', async () => {
      mockRecordEvent.mockResolvedValueOnce(null);
      const res = await request(app).post('/reputation/record').send({ wallet: VALID_WALLET, eventType: 'payment' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Failed');
    });

    it('returns 200 with recorded event', async () => {
      const mockResult = {
        wallet: VALID_WALLET,
        eventType: 'payment',
        amount: 1000000,
        round: 42000000,
        timestamp: 1700000000,
      };
      mockRecordEvent.mockResolvedValueOnce(mockResult as any);
      const res = await request(app).post('/reputation/record').send({ wallet: VALID_WALLET, eventType: 'payment', amount: 1000000 });
      expect(res.status).toBe(200);
      expect(res.body.eventType).toBe('payment');
      expect(res.body.amount).toBe(1000000);
    });

    it('returns 500 when recordEvent throws', async () => {
      mockRecordEvent.mockRejectedValueOnce(new Error('Network error'));
      const res = await request(app).post('/reputation/record').send({ wallet: VALID_WALLET, eventType: 'payment' });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Internal server error');
    });
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('Agent Passport');
      expect(res.body.version).toBe('0.1.0');
      expect(res.body.timestamp).toBeDefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimiter, corsMiddleware } from '../security';

describe('rateLimiter', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.useFakeTimers();
    app = express();
    app.use(rateLimiter({ windowMs: 1000, max: 3 }));
    app.get('/test', (_req, res) => res.json({ ok: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under limit', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('3');
    expect(res.headers['x-ratelimit-remaining']).toBe('2');
  });

  it('blocks requests over limit', async () => {
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many requests');
  });

  it('resets after window expires', async () => {
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');
    vi.advanceTimersByTime(1001);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

describe('corsMiddleware', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(corsMiddleware());
    app.get('/test', (_req, res) => res.json({ ok: true }));
    app.post('/test', (_req, res) => res.json({ ok: true }));
  });

  it('sets CORS headers', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });

  it('handles OPTIONS preflight', async () => {
    const res = await request(app).options('/test');
    expect(res.status).toBe(204);
  });
});

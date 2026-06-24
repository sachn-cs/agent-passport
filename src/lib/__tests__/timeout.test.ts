import { describe, it, expect, vi } from 'vitest';
import { withTimeout, fetchWithTimeout } from '../timeout';

describe('withTimeout', () => {
  it('resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('rejects on timeout', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200));
    await expect(withTimeout(slow, 50)).rejects.toThrow('Timeout after 50ms');
  });

  it('includes label in error message', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200));
    await expect(withTimeout(slow, 50, 'myCall')).rejects.toThrow('Timeout after 50ms: myCall');
  });

  it('clears timeout on success', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 1000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('fetchWithTimeout', () => {
  it('calls fetch with abort signal', async () => {
    let capturedSignal: AbortSignal | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: string, opts?: RequestInit) => {
      capturedSignal = opts?.signal;
      return new Response('ok');
    }) as any;

    await fetchWithTimeout('http://example.com', { timeoutMs: 1000 });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it('rejects when fetch throws', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as any;

    await expect(fetchWithTimeout('http://example.com')).rejects.toThrow('Failed to fetch');

    globalThis.fetch = originalFetch;
  });
});

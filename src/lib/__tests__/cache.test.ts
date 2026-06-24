import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LRUCache } from '../cache';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves values', () => {
    const cache = new LRUCache<string>(10, 60_000);
    cache.set('a', 'hello');
    expect(cache.get('a')).toBe('hello');
  });

  it('returns undefined for missing keys', () => {
    const cache = new LRUCache<string>(10, 60_000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts oldest entry when full', () => {
    const cache = new LRUCache<string>(2, 60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3'); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(10, 1000);
    cache.set('a', 'hello');
    expect(cache.get('a')).toBe('hello');
    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('moves accessed entries to end (LRU)', () => {
    const cache = new LRUCache<string>(2, 60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a'); // access 'a', moves to end
    cache.set('c', '3'); // evicts 'b' (oldest)
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });

  it('updates existing key without growing', () => {
    const cache = new LRUCache<string>(2, 60_000);
    cache.set('a', '1');
    cache.set('a', '2');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('2');
  });

  it('clears all entries', () => {
    const cache = new LRUCache<string>(10, 60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import type { GraphTransaction, GraphSignals } from '../lib/graph';
import {
  buildAdjacencyList,
  getNeighbors,
  computeClusteringCoefficient,
  computeAllClusteringCoefficients,
  computeAverageClustering,
  computeHubScore,
  computeMaxHubScore,
  computeIntermediateDensity,
  computeAverageIntermediateDensity,
  bfs,
  findConnectedComponents,
  computeComponentRatio,
  computeTemporalCorrelation,
  computeGraphSignals,
} from '../lib/graph';

// ── Helper functions ────────────────────────────────────────────

function buildRandomAdjacencyList(V: number, E: number): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (let i = 0; i < V; i++) adj.set(`W${i}`, new Set());
  for (let i = 0; i < E; i++) {
    const a = `W${Math.floor(Math.random() * V)}`;
    const b = `W${Math.floor(Math.random() * V)}`;
    if (a !== b) {
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  return adj;
}

function buildChain(V: number): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (let i = 0; i < V; i++) adj.set(`W${i}`, new Set());
  for (let i = 0; i < V - 1; i++) {
    adj.get(`W${i}`)!.add(`W${i + 1}`);
    adj.get(`W${i + 1}`)!.add(`W${i}`);
  }
  return adj;
}

function edge(a: string, b: string): GraphTransaction {
  return { from: a, to: b };
}

// ── Section 1: BFS Correctness (12 tests) ──────────────────────

describe('BFS Correctness', () => {
  it('bfs on empty graph returns only start node', () => {
    const adj = new Map<string, Set<string>>();
    adj.set('A', new Set());
    const result = bfs(adj, 'A');
    expect(result).toEqual(['A']);
  });

  it('bfs on chain A→B→C→D returns all 4', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('bfs on clique K5 returns all 5', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'];
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) {
      adj.set(n, new Set(nodes.filter(m => m !== n)));
    }
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(nodes);
  });

  it('bfs from A in {A-B, C-D} returns only {A,B}', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
      ['C', new Set(['D'])],
      ['D', new Set(['C'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B']);
  });

  it('bfs on cycle A→B→C→A visits all 3 once', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.length).toBe(3);
    expect(result.sort()).toEqual(['A', 'B', 'C']);
  });

  it('bfs with duplicate edges returns unique nodes', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'B', 'B'])],
      ['B', new Set(['A', 'A'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B']);
  });

  it('bfs on diamond A→B,C; B→D; C→D visits all 4', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'D'])],
      ['C', new Set(['A', 'D'])],
      ['D', new Set(['B', 'C'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('bfs with nodeSet parameter restricts to subset (A→B→C→D, nodeSet=[A,B,D], start=A → result [A,B])', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C'])],
    ]);
    const nodeSet = new Set(['A', 'B', 'D']);
    const result = bfs(adj, 'A', nodeSet);
    expect(result.sort()).toEqual(['A', 'B']);
  });

  it('bfs with nodeSet skips nodes not in set (A→B→C→D, nodeSet=[A,D], start=A → result [A])', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C'])],
    ]);
    const nodeSet = new Set(['A', 'D']);
    const result = bfs(adj, 'A', nodeSet);
    expect(result).toEqual(['A']);
  });

  it('bfs on graph with node having 50 neighbors', () => {
    const adj = new Map<string, Set<string>>();
    adj.set('hub', new Set());
    for (let i = 0; i < 50; i++) {
      const n = `n${i}`;
      adj.set(n, new Set(['hub']));
      adj.get('hub')!.add(n);
    }
    const result = bfs(adj, 'hub');
    expect(result.length).toBe(51);
  });

  it('bfs terminates in <100ms for V=1000, E=5000', () => {
    const adj = buildRandomAdjacencyList(1000, 5000);
    const start = performance.now();
    bfs(adj, 'W0');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('bfs visited set size never exceeds node count', () => {
    const adj = buildRandomAdjacencyList(200, 1000);
    for (let i = 0; i < 5; i++) {
      const result = bfs(adj, `W${i}`);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(new Set(result).size).toBe(result.length);
    }
  });
});

// ── Section 2: Cycle Handling (8 tests) ────────────────────────

describe('Cycle Handling', () => {
  it('triangle cycle: BFS visits 3 nodes, no infinite loop', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.length).toBe(3);
  });

  it('square cycle: BFS visits 4 nodes', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'D'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['A', 'C'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('square with chord: BFS visits 4', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'D'])],
      ['B', new Set(['A', 'C', 'D'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['A', 'B', 'C'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('nested cycles: A→B→C→D→B, C→E→C: BFS visits all 5', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C', 'D'])],
      ['C', new Set(['B', 'D', 'E'])],
      ['D', new Set(['B', 'C'])],
      ['E', new Set(['C'])],
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('self-loop: buildAdjacencyList skips A→A', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'A' },
      { from: 'A', to: 'B' },
    ]);
    expect(adj.get('A')!.has('A')).toBe(false);
    expect(adj.get('A')!.has('B')).toBe(true);
  });

  it('complete graph K10: BFS visits 10 nodes exactly once', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => `N${i}`);
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) {
      adj.set(n, new Set(nodes.filter(m => m !== n)));
    }
    const result = bfs(adj, 'N0');
    expect(result.sort()).toEqual(nodes);
  });

  it('bipartite graph K3,3: BFS visits 6 nodes', () => {
    const adj = new Map<string, Set<string>>([
      ['U1', new Set(['V1', 'V2', 'V3'])],
      ['U2', new Set(['V1', 'V2', 'V3'])],
      ['U3', new Set(['V1', 'V2', 'V3'])],
      ['V1', new Set(['U1', 'U2', 'U3'])],
      ['V2', new Set(['U1', 'U2', 'U3'])],
      ['V3', new Set(['U1', 'U2', 'U3'])],
    ]);
    const result = bfs(adj, 'U1');
    expect(result.sort()).toEqual(['U1', 'U2', 'U3', 'V1', 'V2', 'V3']);
  });

  it('long chain with back-edge: 100 nodes in chain + edge from last to first → BFS visits 100', () => {
    const adj = buildChain(100);
    adj.get('W99')!.add('W0');
    adj.get('W0')!.add('W99');
    const result = bfs(adj, 'W0');
    expect(result.length).toBe(100);
  });
});

// ── Section 3: Connected Components (10 tests) ─────────────────

describe('Connected Components', () => {
  it('empty nodes → 0 components', () => {
    const adj = new Map<string, Set<string>>();
    const result = findConnectedComponents(adj, []);
    expect(result).toEqual([]);
  });

  it('single node → 1 component of size 1', () => {
    const adj = new Map<string, Set<string>>([['A', new Set()]]);
    const result = findConnectedComponents(adj, ['A']);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(['A']);
  });

  it('two connected nodes → 1 component', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const result = findConnectedComponents(adj, ['A', 'B']);
    expect(result.length).toBe(1);
    expect(result[0].sort()).toEqual(['A', 'B']);
  });

  it('two disconnected pairs → 2 components', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
      ['C', new Set(['D'])],
      ['D', new Set(['C'])],
    ]);
    const result = findConnectedComponents(adj, ['A', 'B', 'C', 'D']);
    expect(result.length).toBe(2);
  });

  it('5 isolated nodes → 5 components', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set()],
      ['B', new Set()],
      ['C', new Set()],
      ['D', new Set()],
      ['E', new Set()],
    ]);
    const result = findConnectedComponents(adj, ['A', 'B', 'C', 'D', 'E']);
    expect(result.length).toBe(5);
  });

  it('chain A-B-C-D-E: 1 component', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C', 'E'])],
      ['E', new Set(['D'])],
    ]);
    const result = findConnectedComponents(adj, ['A', 'B', 'C', 'D', 'E']);
    expect(result.length).toBe(1);
    expect(result[0].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('subgraph: nodes=[A,D], full graph A-B-C-D → 2 components (constrained to nodeSet)', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C'])],
    ]);
    const result = findConnectedComponents(adj, ['A', 'D']);
    expect(result.length).toBe(2);
  });

  it('subgraph: nodes=[A,D], full graph A-B, C-D → 2 components', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
      ['C', new Set(['D'])],
      ['D', new Set(['C'])],
    ]);
    const result = findConnectedComponents(adj, ['A', 'D']);
    expect(result.length).toBe(2);
  });

  it('star with hub: nodes=[spokes], full graph has hub connecting them → 4 components (constrained to nodeSet)', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['s1', 's2', 's3', 's4'])],
      ['s1', new Set(['hub'])],
      ['s2', new Set(['hub'])],
      ['s3', new Set(['hub'])],
      ['s4', new Set(['hub'])],
    ]);
    const result = findConnectedComponents(adj, ['s1', 's2', 's3', 's4']);
    expect(result.length).toBe(4);
  });

  it('component sizes sum to total nodes (partition invariant)', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
      ['C', new Set(['D'])],
      ['D', new Set(['C'])],
      ['E', new Set()],
    ]);
    const result = findConnectedComponents(adj, ['A', 'B', 'C', 'D', 'E']);
    const totalNodes = result.reduce((sum, comp) => sum + comp.length, 0);
    expect(totalNodes).toBe(5);
  });
});

// ── Section 4: Clustering Coefficient (12 tests) ───────────────

describe('Clustering Coefficient', () => {
  it('node with 0 neighbors → 0', () => {
    const adj = new Map<string, Set<string>>([['A', new Set()]]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(0);
  });

  it('node with 1 neighbor → 0', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(0);
  });

  it('triangle: cc=1.0 for all', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(1);
    expect(computeClusteringCoefficient(adj, 'B')).toBe(1);
    expect(computeClusteringCoefficient(adj, 'C')).toBe(1);
  });

  it('star: hub cc=0.0', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['s1', 's2', 's3'])],
      ['s1', new Set(['hub'])],
      ['s2', new Set(['hub'])],
      ['s3', new Set(['hub'])],
    ]);
    expect(computeClusteringCoefficient(adj, 'hub')).toBe(0);
  });

  it('4-clique minus 1 edge: specific cc values', () => {
    // A-B, A-C, A-D, B-C, C-D (missing B-D)
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C', 'D'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B', 'D'])],
      ['D', new Set(['A', 'C'])],
    ]);
    // A's neighbors: B,C,D → 3 possible pairs, 2 edges (B-C, C-D) → 2/3 ≈ 0.67
    expect(computeClusteringCoefficient(adj, 'A')).toBe(0.67);
    // B's neighbors: A,C → 1 possible pair, 1 edge (A-C) → 1.0
    expect(computeClusteringCoefficient(adj, 'B')).toBe(1);
    // C's neighbors: A,B,D → 3 possible pairs, 2 edges (A-B, A-D) → 2/3 ≈ 0.67
    expect(computeClusteringCoefficient(adj, 'C')).toBe(0.67);
    // D's neighbors: A,C → 1 possible pair, 1 edge (A-C) → 1.0
    expect(computeClusteringCoefficient(adj, 'D')).toBe(1);
  });

  it('5-clique: cc=1.0 for all', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'];
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) {
      adj.set(n, new Set(nodes.filter(m => m !== n)));
    }
    for (const n of nodes) {
      expect(computeClusteringCoefficient(adj, n)).toBe(1);
    }
  });

  it('chain A-B-C-D: B has cc=0 (neighbors A,C not connected), C has cc=0', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C'])],
    ]);
    expect(computeClusteringCoefficient(adj, 'B')).toBe(0);
    expect(computeClusteringCoefficient(adj, 'C')).toBe(0);
  });

  it('average clustering for triangle = 1.0', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    const avg = computeAverageClustering(adj, ['A', 'B', 'C']);
    expect(avg).toBe(1);
  });

  it('average clustering for star = 0.0', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['s1', 's2', 's3'])],
      ['s1', new Set(['hub'])],
      ['s2', new Set(['hub'])],
      ['s3', new Set(['hub'])],
    ]);
    const avg = computeAverageClustering(adj, ['hub', 's1', 's2', 's3']);
    expect(avg).toBe(0);
  });

  it('clustering coefficient ∈ [0, 1] for all inputs (test with random graphs)', () => {
    const adj = buildRandomAdjacencyList(30, 60);
    for (const [node] of adj) {
      const cc = computeClusteringCoefficient(adj, node);
      expect(cc).toBeGreaterThanOrEqual(0);
      expect(cc).toBeLessThanOrEqual(1);
    }
  });

  it('computeAllClusteringCoefficients matches per-node computeClusteringCoefficient', () => {
    const adj = buildRandomAdjacencyList(20, 50);
    const allCoeffs = computeAllClusteringCoefficients(adj);
    for (const [node] of adj) {
      const perNode = computeClusteringCoefficient(adj, node);
      const batch = allCoeffs.get(node)!;
      expect(batch).toBeCloseTo(perNode, 2);
    }
  });

  it('edge-iteration produces same results as pair-enumeration', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C', 'D'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B', 'D'])],
      ['D', new Set(['A', 'C'])],
    ]);
    const allCoeffs = computeAllClusteringCoefficients(adj);
    for (const [node] of adj) {
      const perNode = computeClusteringCoefficient(adj, node);
      const edgeIter = allCoeffs.get(node)!;
      expect(edgeIter).toBeCloseTo(perNode, 2);
    }
  });
});

// ── Section 5: Hub Score (6 tests) ─────────────────────────────

describe('Hub Score', () => {
  it('single node → 0', () => {
    const adj = new Map<string, Set<string>>([['A', new Set()]]);
    expect(computeHubScore(adj, 'A', 1)).toBe(0);
  });

  it('hub connected to all 4 in 5-cluster → 1.0', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['s1', 's2', 's3', 's4'])],
      ['s1', new Set(['hub'])],
      ['s2', new Set(['hub'])],
      ['s3', new Set(['hub'])],
      ['s4', new Set(['hub'])],
    ]);
    expect(computeHubScore(adj, 'hub', 5)).toBe(1);
  });

  it('spoke with 1/4 connections → 0.25', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['s1', 's2', 's3', 's4'])],
      ['s1', new Set(['hub'])],
      ['s2', new Set(['hub'])],
      ['s3', new Set(['hub'])],
      ['s4', new Set(['hub'])],
    ]);
    expect(computeHubScore(adj, 's1', 5)).toBe(0.25);
  });

  it('clique K5: all hub=1.0', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E'];
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) {
      adj.set(n, new Set(nodes.filter(m => m !== n)));
    }
    for (const n of nodes) {
      expect(computeHubScore(adj, n, 5)).toBe(1);
    }
  });

  it('maxHubScore returns max, not average', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['s1', 's2', 's3', 's4'])],
      ['s1', new Set(['hub'])],
      ['s2', new Set(['hub'])],
      ['s3', new Set(['hub'])],
      ['s4', new Set(['hub'])],
    ]);
    expect(computeMaxHubScore(adj, ['hub', 's1', 's2', 's3', 's4'])).toBe(1);
  });

  it('hub score ∈ [0, 1]', () => {
    const adj = buildRandomAdjacencyList(25, 100);
    const nodes = Array.from(adj.keys());
    const maxHub = computeMaxHubScore(adj, nodes);
    expect(maxHub).toBeGreaterThanOrEqual(0);
    expect(maxHub).toBeLessThanOrEqual(1);
  });
});

// ── Section 6: Intermediate Density — 2-Hop (10 tests) ─────────

describe('Intermediate Density', () => {
  it('< 2 neighbors → 0', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('all neighbors interact directly → 0 (direct ≠ intermediate)', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('no direct, but 2-hop through intermediary → > 0', () => {
    // A→B, A→C, B→D, D→C: B and C interact through D
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'D'])],
      ['C', new Set(['A', 'D'])],
      ['D', new Set(['B', 'C'])],
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBeGreaterThan(0);
  });

  it('A→B, A→C, B→D, D→C: B and C interact through D → 1.0', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'D'])],
      ['C', new Set(['A', 'D'])],
      ['D', new Set(['B', 'C'])],
    ]);
    // A's neighbors: B, C. No direct B-C edge. D is intermediary: B-D, D-C. → 1.0
    expect(computeIntermediateDensity(adj, 'A')).toBe(1);
  });

  it('A→B, A→C, B and C completely isolated → 0', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A'])],
      ['C', new Set(['A'])],
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('mixed: some direct, some 2-hop, some none → proportional', () => {
    // A connected to B, C, D
    // B-C: direct edge
    // B-D: no direct, but through E (B-E, E-D)
    // C-D: no direct, no intermediary
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C', 'D'])],
      ['B', new Set(['A', 'C', 'E'])],
      ['C', new Set(['A', 'B'])],
      ['D', new Set(['A', 'E'])],
      ['E', new Set(['B', 'D'])],
    ]);
    // Pairs: B-C (direct → skip), B-D (non-direct, E intermediary → 1), C-D (non-direct, no intermediary → 0)
    // nonDirectPairs = 2, intermediatePairs = 1 → 0.5
    expect(computeIntermediateDensity(adj, 'A')).toBe(0.5);
  });

  it('intermediate density ∈ [0, 1]', () => {
    const adj = buildRandomAdjacencyList(30, 80);
    for (const [node] of adj) {
      const density = computeIntermediateDensity(adj, node);
      expect(density).toBeGreaterThanOrEqual(0);
      expect(density).toBeLessThanOrEqual(1);
    }
  });

  it('averaged across all cluster nodes (computeAverageIntermediateDensity)', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C', 'D'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B', 'D'])],
      ['D', new Set(['A', 'C'])],
    ]);
    const avg = computeAverageIntermediateDensity(adj, ['A', 'B', 'C', 'D']);
    expect(avg).toBeGreaterThanOrEqual(0);
    expect(avg).toBeLessThanOrEqual(1);
  });

  it('verify different from clustering coefficient (triangle: clustering=1.0, intermediate=0)', () => {
    const adj = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(1);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('complex graph: hub with intermediaries', () => {
    const adj = new Map<string, Set<string>>([
      ['hub', new Set(['a', 'b', 'c', 'd'])],
      ['a', new Set(['hub', 'x'])],
      ['b', new Set(['hub', 'x'])],
      ['c', new Set(['hub', 'y'])],
      ['d', new Set(['hub', 'y'])],
      ['x', new Set(['a', 'b'])],
      ['y', new Set(['c', 'd'])],
    ]);
    // hub's neighbors: a,b,c,d
    // a-b: no direct, x intermediary → intermediate
    // a-c: no direct, no intermediary → none
    // a-d: no direct, no intermediary → none
    // b-c: no direct, no intermediary → none
    // b-d: no direct, no intermediary → none
    // c-d: no direct, y intermediary → intermediate
    // nonDirectPairs = 6, intermediatePairs = 2 → 2/6 ≈ 0.33
    const density = computeIntermediateDensity(adj, 'hub');
    expect(density).toBeCloseTo(0.33, 1);
  });
});

// ── Section 7: Temporal Correlation (6 tests) ───────────────────

describe('Temporal Correlation', () => {
  it('< 2 nodes → 0', () => {
    const txns = [{ from: 'A', to: 'B', round: 1 }];
    expect(computeTemporalCorrelation(txns, ['A'])).toBe(0);
  });

  it('no shared rounds → 0', () => {
    const txns = [
      { from: 'A', to: 'B', round: 1 },
      { from: 'C', to: 'D', round: 10 },
    ];
    expect(computeTemporalCorrelation(txns, ['A', 'C'])).toBe(0);
  });

  it('always active together → 1.0', () => {
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'A', to: 'X', round: 2 },
      { from: 'A', to: 'X', round: 3 },
      { from: 'B', to: 'Y', round: 1 },
      { from: 'B', to: 'Y', round: 2 },
      { from: 'B', to: 'Y', round: 3 },
    ];
    expect(computeTemporalCorrelation(txns, ['A', 'B'])).toBe(1);
  });

  it('partial overlap → Jaccard correlation (A active [1,2,3], B active [2,3,4] → intersection=2, union=3 → 0.67)', () => {
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'A', to: 'X', round: 2 },
      { from: 'A', to: 'X', round: 3 },
      { from: 'B', to: 'Y', round: 2 },
      { from: 'B', to: 'Y', round: 3 },
      { from: 'B', to: 'Y', round: 4 },
    ];
    // intersection = {2,3} = 2, union = {1,2,3,4} = 4, Jaccard = 2/4 = 0.5
    expect(computeTemporalCorrelation(txns, ['A', 'B'])).toBe(0.5);
  });

  it('Jaccard similarity is symmetric', () => {
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'A', to: 'X', round: 2 },
      { from: 'A', to: 'X', round: 3 },
      { from: 'B', to: 'Y', round: 2 },
      { from: 'B', to: 'Y', round: 3 },
      { from: 'B', to: 'Y', round: 4 },
    ];
    const corrAB = computeTemporalCorrelation(txns, ['A', 'B']);
    const corrBA = computeTemporalCorrelation(txns, ['B', 'A']);
    expect(corrAB).toBe(corrBA);
  });

  it('correlation ∈ [0, 1]', () => {
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'A', to: 'X', round: 5 },
      { from: 'B', to: 'Y', round: 3 },
      { from: 'B', to: 'Y', round: 7 },
      { from: 'C', to: 'Z', round: 2 },
      { from: 'C', to: 'Z', round: 9 },
    ];
    const corr = computeTemporalCorrelation(txns, ['A', 'B', 'C']);
    expect(corr).toBeGreaterThanOrEqual(0);
    expect(corr).toBeLessThanOrEqual(1);
  });
});

// ── Section 8: Scalability / Performance (7 tests) ──────────────

describe('Scalability / Performance', () => {
  it('production cluster: V=25, E=200 → < 5ms', () => {
    const adj = buildRandomAdjacencyList(25, 200);
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeAverageClustering(adj, nodes);
    computeMaxHubScore(adj, nodes);
    computeAverageIntermediateDensity(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it('medium cluster: V=100, E=2000 → < 50ms', () => {
    const adj = buildRandomAdjacencyList(100, 2000);
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeAverageClustering(adj, nodes);
    computeMaxHubScore(adj, nodes);
    computeAverageIntermediateDensity(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('large cluster: V=1000, E=20000 → < 2s', () => {
    const adj = buildRandomAdjacencyList(1000, 20000);
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeAverageClustering(adj, nodes);
    computeMaxHubScore(adj, nodes);
    computeAverageIntermediateDensity(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('stress sparse: V=10000, E=20000 → < 2s', () => {
    const adj = new Map<string, Set<string>>();
    for (let i = 0; i < 10000; i++) adj.set(`W${i}`, new Set());
    for (let i = 0; i < 20000; i++) {
      const a = `W${Math.floor(Math.random() * 10000)}`;
      const b = `W${Math.floor(Math.random() * 10000)}`;
      if (a !== b) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeMaxHubScore(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('stress dense: V=10000, E=100000 → < 5s', () => {
    const adj = new Map<string, Set<string>>();
    for (let i = 0; i < 10000; i++) adj.set(`W${i}`, new Set());
    for (let i = 0; i < 100000; i++) {
      const a = `W${Math.floor(Math.random() * 10000)}`;
      const b = `W${Math.floor(Math.random() * 10000)}`;
      if (a !== b) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeMaxHubScore(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it('extreme sparse: V=100000, E=1000000 → < 15s', () => {
    const adj = new Map<string, Set<string>>();
    for (let i = 0; i < 100000; i++) adj.set(`W${i}`, new Set());
    for (let i = 0; i < 1000000; i++) {
      const a = `W${Math.floor(Math.random() * 100000)}`;
      const b = `W${Math.floor(Math.random() * 100000)}`;
      if (a !== b) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeMaxHubScore(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(15000);
  });

  it('complete K_100: V=100, E=4950 → < 2s', () => {
    const adj = new Map<string, Set<string>>();
    for (let i = 0; i < 100; i++) {
      const neighbors = new Set<string>();
      for (let j = 0; j < 100; j++) {
        if (i !== j) neighbors.add(`W${j}`);
      }
      adj.set(`W${i}`, neighbors);
    }
    const nodes = Array.from(adj.keys());
    const start = performance.now();
    bfs(adj, nodes[0]);
    computeAverageClustering(adj, nodes);
    computeMaxHubScore(adj, nodes);
    computeAverageIntermediateDensity(adj, nodes);
    findConnectedComponents(adj, nodes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

// ── Section 9: Invariant Proofs (6 tests) ───────────────────────

describe('Invariant Proofs', () => {
  it('BFS visited set size ≤ V for all graph sizes (test with V=10,50,100)', () => {
    for (const V of [10, 50, 100]) {
      const adj = buildRandomAdjacencyList(V, V * 5);
      for (let i = 0; i < Math.min(5, V); i++) {
        const result = bfs(adj, `W${i}`);
        expect(result.length).toBeLessThanOrEqual(V);
        expect(new Set(result).size).toBe(result.length);
      }
    }
  });

  it('BFS terminates for all cyclic graphs (test with various cycle structures)', () => {
    // Triangle
    const triangle = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
    ]);
    expect(bfs(triangle, 'A').length).toBe(3);

    // Square
    const square = new Map<string, Set<string>>([
      ['A', new Set(['B', 'D'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['A', 'C'])],
    ]);
    expect(bfs(square, 'A').length).toBe(4);

    // Pentagon
    const pentagon = new Map<string, Set<string>>([
      ['A', new Set(['B', 'E'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B', 'D'])],
      ['D', new Set(['C', 'E'])],
      ['E', new Set(['D', 'A'])],
    ]);
    expect(bfs(pentagon, 'A').length).toBe(5);

    // Complete K6
    const nodes6 = ['A', 'B', 'C', 'D', 'E', 'F'];
    const k6 = new Map<string, Set<string>>();
    for (const n of nodes6) {
      k6.set(n, new Set(nodes6.filter(m => m !== n)));
    }
    expect(bfs(k6, 'A').length).toBe(6);

    // Self-loop cycle
    const selfLoop = new Map<string, Set<string>>([
      ['A', new Set(['A', 'B'])],
      ['B', new Set(['A'])],
    ]);
    expect(bfs(selfLoop, 'A').length).toBe(2);
  });

  it('clustering coefficient ∈ [0, 1] for random graphs (test with V=20, random edges)', () => {
    for (let trial = 0; trial < 10; trial++) {
      const V = 20;
      const E = Math.floor(Math.random() * 60) + 10;
      const adj = buildRandomAdjacencyList(V, E);
      const allCoeffs = computeAllClusteringCoefficients(adj);
      for (const [, coeff] of allCoeffs) {
        expect(coeff).toBeGreaterThanOrEqual(0);
        expect(coeff).toBeLessThanOrEqual(1);
      }
    }
  });

  it('component sizes sum = total nodes (test with multiple configurations)', () => {
    const configs = [
      { nodes: ['A'], edges: [] },
      { nodes: ['A', 'B', 'C'], edges: [['A', 'B'], ['B', 'C']] },
      { nodes: ['A', 'B', 'C', 'D'], edges: [['A', 'B'], ['C', 'D']] },
      { nodes: ['A', 'B', 'C', 'D', 'E'], edges: [['A', 'B'], ['C', 'D']] },
    ];
    for (const cfg of configs) {
      const adj = new Map<string, Set<string>>();
      for (const n of cfg.nodes) adj.set(n, new Set());
      for (const [a, b] of cfg.edges) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
      const components = findConnectedComponents(adj, cfg.nodes);
      const totalNodes = components.reduce((sum, comp) => sum + comp.length, 0);
      expect(totalNodes).toBe(cfg.nodes.length);
    }
  });

  it('all nodes appear in exactly one component (test with multiple configurations)', () => {
    const configs = [
      { nodes: ['A'], edges: [] },
      { nodes: ['A', 'B', 'C'], edges: [['A', 'B'], ['B', 'C']] },
      { nodes: ['A', 'B', 'C', 'D'], edges: [['A', 'B'], ['C', 'D']] },
      { nodes: ['A', 'B', 'C', 'D', 'E'], edges: [['A', 'B'], ['C', 'D']] },
    ];
    for (const cfg of configs) {
      const adj = new Map<string, Set<string>>();
      for (const n of cfg.nodes) adj.set(n, new Set());
      for (const [a, b] of cfg.edges) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
      const components = findConnectedComponents(adj, cfg.nodes);
      const allNodes = components.flat();
      const nodeSet = new Set(allNodes);
      expect(nodeSet.size).toBe(cfg.nodes.length);
      expect(allNodes.length).toBe(cfg.nodes.length);
    }
  });

  it('computeGraphSignals output ∈ [0, 1] for all signals (test with random graphs)', () => {
    const txns: GraphTransaction[] = [];
    const nodeCount = 25;
    const nodes = Array.from({ length: nodeCount }, (_, i) => `W${i}`);
    for (let i = 0; i < 200; i++) {
      const a = nodes[Math.floor(Math.random() * nodeCount)];
      const b = nodes[Math.floor(Math.random() * nodeCount)];
      if (a !== b) txns.push({ from: a, to: b });
    }
    const signals = computeGraphSignals(txns, nodes);
    expect(signals.neighborhoodClustering).toBeGreaterThanOrEqual(0);
    expect(signals.neighborhoodClustering).toBeLessThanOrEqual(1);
    expect(signals.hubScore).toBeGreaterThanOrEqual(0);
    expect(signals.hubScore).toBeLessThanOrEqual(1);
    expect(signals.intermediateDensity).toBeGreaterThanOrEqual(0);
    expect(signals.intermediateDensity).toBeLessThanOrEqual(1);
    expect(signals.componentRatio).toBeGreaterThanOrEqual(0);
    expect(signals.componentRatio).toBeLessThanOrEqual(1);
    expect(signals.temporalCorrelation).toBeGreaterThanOrEqual(0);
    expect(signals.temporalCorrelation).toBeLessThanOrEqual(1);
    expect(signals.subGroupCount).toBeGreaterThanOrEqual(0);
  });
});

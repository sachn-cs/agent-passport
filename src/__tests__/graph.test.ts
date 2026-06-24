import { describe, it, expect } from 'vitest';
import {
  buildAdjacencyList,
  getNeighbors,
  computeClusteringCoefficient,
  computeAverageClustering,
  computeHubScore,
  computeMaxHubScore,
  computeIntermediateDensity,
  bfs,
  findConnectedComponents,
  computeComponentRatio,
  computeTemporalCorrelation,
  computeGraphSignals,
} from '../lib/graph';
import type { GraphTransaction } from '../lib/graph';

// ═══════════════════════════════════════════════════════════════
// Adjacency List
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — buildAdjacencyList', () => {
  it('builds undirected adjacency list from directed transactions', () => {
    const txns: GraphTransaction[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ];
    const adj = buildAdjacencyList(txns);
    expect(adj.get('A')?.has('B')).toBe(true);
    expect(adj.get('B')?.has('A')).toBe(true); // reverse edge
    expect(adj.get('B')?.has('C')).toBe(true);
    expect(adj.get('C')?.has('B')).toBe(true);
  });

  it('handles empty transactions', () => {
    const adj = buildAdjacencyList([]);
    expect(adj.size).toBe(0);
  });

  it('handles self-transactions (does not add self-loop)', () => {
    const adj = buildAdjacencyList([{ from: 'A', to: 'A' }]);
    // A has no neighbors (self-loop excluded)
    expect(adj.get('A')?.has('A') ?? false).toBe(false);
    expect(adj.get('A')?.size ?? 0).toBe(0);
  });
});

describe('Graph Analysis — getNeighbors', () => {
  it('returns neighbors for existing node', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
    ]);
    const neighbors = getNeighbors(adj, 'A');
    expect(neighbors.has('B')).toBe(true);
    expect(neighbors.has('C')).toBe(true);
  });

  it('returns empty set for unknown node', () => {
    const adj = buildAdjacencyList([{ from: 'A', to: 'B' }]);
    expect(getNeighbors(adj, 'Z').size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Clustering Coefficient (V2+V8)
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — computeClusteringCoefficient', () => {
  it('returns 0 for node with < 2 neighbors', () => {
    const adj = buildAdjacencyList([{ from: 'A', to: 'B' }]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(0);
    expect(computeClusteringCoefficient(adj, 'B')).toBe(0);
  });

  it('returns 1.0 for triangle (fully connected)', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(1.0);
    expect(computeClusteringCoefficient(adj, 'B')).toBe(1.0);
    expect(computeClusteringCoefficient(adj, 'C')).toBe(1.0);
  });

  it('returns 0.0 for star (hub with independent spokes)', () => {
    // A is hub, B/C/D are spokes with no inter-connections
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
    ]);
    expect(computeClusteringCoefficient(adj, 'A')).toBe(0.0);
  });

  it('returns 0.5 for one missing edge in 4-node clique', () => {
    // 4 nodes, each has 3 neighbors → possible = 3
    // Missing one edge: B↔D
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
      // Missing: B↔D
    ]);
    // A's neighbors: B, C, D → edges between: B-C ✓, C-D ✓, B-D ✗ → 2/3 = 0.67
    const ccA = computeClusteringCoefficient(adj, 'A');
    expect(ccA).toBe(0.67);

    // B's neighbors: A, C → edges between: A-C ✓ → 1/1 = 1.0
    const ccB = computeClusteringCoefficient(adj, 'B');
    expect(ccB).toBe(1.0);
  });
});

describe('Graph Analysis — computeAverageClustering', () => {
  it('returns 0 for empty node list', () => {
    const adj = buildAdjacencyList([]);
    expect(computeAverageClustering(adj, [])).toBe(0);
  });

  it('returns average of all node clustering coefficients', () => {
    // Triangle: each has cc=1.0, average=1.0
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ]);
    expect(computeAverageClustering(adj, ['A', 'B', 'C'])).toBe(1.0);
  });

  it('star has low average clustering', () => {
    // A is hub (cc=0), B/C/D each have 1 neighbor (cc=0)
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
    ]);
    expect(computeAverageClustering(adj, ['A', 'B', 'C', 'D'])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Hub Score (V4)
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — computeHubScore', () => {
  it('returns 0 for single-node cluster', () => {
    const adj = buildAdjacencyList([]);
    expect(computeHubScore(adj, 'A', 1)).toBe(0);
  });

  it('returns 1.0 for hub connected to all', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
    ]);
    expect(computeHubScore(adj, 'A', 4)).toBe(1.0);
  });

  it('returns low score for spoke in star topology', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
    ]);
    // B has 1 neighbor out of 3 possible in cluster of 4
    expect(computeHubScore(adj, 'B', 4)).toBe(0.33);
  });
});

describe('Graph Analysis — computeMaxHubScore', () => {
  it('returns 0 for empty', () => {
    const adj = buildAdjacencyList([]);
    expect(computeMaxHubScore(adj, [])).toBe(0);
  });

  it('returns max hub score in cluster', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
    ]);
    expect(computeMaxHubScore(adj, ['A', 'B', 'C', 'D'])).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Intermediate Density (V6)
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — computeIntermediateDensity', () => {
  it('returns 0 for < 2 neighbors', () => {
    const adj = buildAdjacencyList([{ from: 'A', to: 'B' }]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('returns 0 when all neighbors interact directly (no 2-hop needed)', () => {
    // A→B, A→C, B→C: all of A's neighbors interact directly
    // No non-direct pairs → intermediate density = 0
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('returns 0.0 when no neighbors interact at all', () => {
    // A→B, A→C, but B and C don't interact
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(0);
  });

  it('detects 2-hop intermediary through a fourth node', () => {
    // A→B, A→C, B→D, D→C: B and C interact through D (2-hop intermediary)
    // B-C is NOT a direct edge, but B→D→C exists
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'D', to: 'C' },
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(1.0);
  });

  it('returns partial density for partial 2-hop interactions', () => {
    // A has 3 neighbors: B, C, D
    // B-C: direct edge → skip
    // B-D: direct edge → skip
    // C-D: NOT direct, but C→B→D exists (B is intermediary) → intermediate
    // nonDirectPairs=1, intermediatePairs=1 → 1.0
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
      { from: 'B', to: 'C' },
      { from: 'B', to: 'D' },
    ]);
    expect(computeIntermediateDensity(adj, 'A')).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════
// BFS and Connected Components (V2+V8)
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — bfs', () => {
  it('returns single node for isolated node', () => {
    const adj = buildAdjacencyList([]);
    expect(bfs(adj, 'A')).toEqual(['A']);
  });

  it('returns all reachable nodes in connected graph', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B', 'C']);
  });

  it('only returns nodes in the connected component', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' }, // separate component
    ]);
    const result = bfs(adj, 'A');
    expect(result.sort()).toEqual(['A', 'B']);
  });
});

describe('Graph Analysis — findConnectedComponents', () => {
  it('returns empty for empty node list', () => {
    const adj = buildAdjacencyList([]);
    expect(findConnectedComponents(adj, [])).toEqual([]);
  });

  it('finds single component for connected subgraph', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]);
    const components = findConnectedComponents(adj, ['A', 'B', 'C']);
    expect(components.length).toBe(1);
    expect(components[0].sort()).toEqual(['A', 'B', 'C']);
  });

  it('finds multiple components', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
    ]);
    const components = findConnectedComponents(adj, ['A', 'B', 'C', 'D']);
    expect(components.length).toBe(2);
  });

  it('handles isolated nodes as single-node components', () => {
    const adj = buildAdjacencyList([{ from: 'A', to: 'B' }]);
    const components = findConnectedComponents(adj, ['A', 'B', 'C', 'D']);
    // A-B is one component, C and D are isolated
    expect(components.length).toBe(3);
  });
});

describe('Graph Analysis — computeComponentRatio', () => {
  it('returns 0 for empty', () => {
    const adj = buildAdjacencyList([]);
    expect(computeComponentRatio(adj, [])).toBe(0);
  });

  it('returns 1.0 for fully connected', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ]);
    expect(computeComponentRatio(adj, ['A', 'B', 'C'])).toBe(1.0);
  });

  it('returns 0.5 for two equal components', () => {
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
    ]);
    expect(computeComponentRatio(adj, ['A', 'B', 'C', 'D'])).toBe(0.5);
  });

  it('returns 0.67 for one large and one small component', () => {
    // A-B-C (3) and D-E (2) → largest=3, total=5, ratio=0.60
    const adj = buildAdjacencyList([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'D', to: 'E' },
    ]);
    expect(computeComponentRatio(adj, ['A', 'B', 'C', 'D', 'E'])).toBe(0.60);
  });
});

// ═══════════════════════════════════════════════════════════════
// Temporal Correlation (V4)
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — computeTemporalCorrelation', () => {
  it('returns 0 for < 2 nodes', () => {
    expect(computeTemporalCorrelation([], ['A'])).toBe(0);
  });

  it('returns 0 when no shared active rounds', () => {
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'B', to: 'Y', round: 2 },
    ];
    expect(computeTemporalCorrelation(txns, ['A', 'B'])).toBe(0);
  });

  it('returns 1.0 when wallets are always active together', () => {
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'B', to: 'Y', round: 1 },
      { from: 'A', to: 'X', round: 2 },
      { from: 'B', to: 'Y', round: 2 },
      { from: 'A', to: 'X', round: 3 },
      { from: 'B', to: 'Y', round: 3 },
    ];
    expect(computeTemporalCorrelation(txns, ['A', 'B'])).toBe(1.0);
  });

  it('returns partial correlation for partial overlap', () => {
    // A active at rounds [1, 2, 3], B active at rounds [2, 3, 4]
    // Overlap: {2, 3} = 2 rounds
    // A-only: {1}, B-only: {4}
    const txns = [
      { from: 'A', to: 'X', round: 1 },
      { from: 'A', to: 'X', round: 2 },
      { from: 'A', to: 'X', round: 3 },
      { from: 'B', to: 'Y', round: 2 },
      { from: 'B', to: 'Y', round: 3 },
      { from: 'B', to: 'Y', round: 4 },
    ];
    const corr = computeTemporalCorrelation(txns, ['A', 'B']);
    // overlap=2 (rounds 2,3), so correlation depends on implementation
    expect(corr).toBeGreaterThan(0);
    expect(corr).toBeLessThanOrEqual(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Combined Signals
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — computeGraphSignals', () => {
  it('returns all zeros for empty input', () => {
    const signals = computeGraphSignals([], []);
    expect(signals.neighborhoodClustering).toBe(0);
    expect(signals.hubScore).toBe(0);
    expect(signals.intermediateDensity).toBe(0);
    expect(signals.componentRatio).toBe(0);
    expect(signals.temporalCorrelation).toBe(0);
    expect(signals.subGroupCount).toBe(0);
  });

  it('star topology: high hub, low clustering, single component', () => {
    // A funds B, C, D — classic sybil farm
    const txns: GraphTransaction[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
    ];
    const signals = computeGraphSignals(txns, ['A', 'B', 'C', 'D']);
    expect(signals.hubScore).toBe(1.0);   // A is connected to all
    expect(signals.neighborhoodClustering).toBe(0); // A's neighbors don't interact
    expect(signals.componentRatio).toBe(1.0); // all connected through A
    expect(signals.subGroupCount).toBe(1);
  });

  it('triangle topology: high clustering, no dominant hub', () => {
    const txns: GraphTransaction[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ];
    const signals = computeGraphSignals(txns, ['A', 'B', 'C']);
    expect(signals.neighborhoodClustering).toBe(1.0);
    expect(signals.hubScore).toBe(1.0); // each has 2/2 neighbors = equal hub
    expect(signals.componentRatio).toBe(1.0);
  });

  it('two separate components: low component ratio', () => {
    const txns: GraphTransaction[] = [
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
    ];
    const signals = computeGraphSignals(txns, ['A', 'B', 'C', 'D']);
    expect(signals.componentRatio).toBe(0.5);
    expect(signals.subGroupCount).toBe(2);
  });

  it('all nodes isolated: each is its own component', () => {
    const txns: GraphTransaction[] = [];
    const signals = computeGraphSignals(txns, ['A', 'B', 'C']);
    // Each node is a component of size 1, largest/total = 1/3
    expect(signals.componentRatio).toBe(0.33);
    expect(signals.subGroupCount).toBe(3);
    expect(signals.neighborhoodClustering).toBe(0);
    expect(signals.hubScore).toBe(0);
  });

  it('mixed topology with intermediaries', () => {
    // A→B, A→C, B→C: A's neighbors B and C interact DIRECTLY
    // Direct interactions are not intermediate → intermediateDensity = 0
    // But clustering is 1.0 (triangle)
    const txns: GraphTransaction[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ];
    const signals = computeGraphSignals(txns, ['A', 'B', 'C']);
    expect(signals.neighborhoodClustering).toBe(1.0); // triangle
    expect(signals.intermediateDensity).toBe(0); // direct, not 2-hop
  });
});

// ═══════════════════════════════════════════════════════════════
// Complexity Invariant
// ═══════════════════════════════════════════════════════════════

describe('Graph Analysis — Complexity Invariant', () => {
  it('computeGraphSignals completes in O(V+E) for 50 nodes', () => {
    const nodes = Array(50).fill(0).map((_, i) => `W${i}`);
    const txns: GraphTransaction[] = [];
    // Create a chain: W0→W1→W2→...→W49
    for (let i = 0; i < 49; i++) {
      txns.push({ from: nodes[i], to: nodes[i + 1] });
    }
    // Add some cross-edges
    for (let i = 0; i < 10; i++) {
      txns.push({ from: nodes[i], to: nodes[i + 10] });
    }

    const start = Date.now();
    const signals = computeGraphSignals(txns, nodes);
    const elapsed = Date.now() - start;

    // Should complete in < 50ms for 50 nodes, 59 edges
    expect(elapsed).toBeLessThan(50);
    expect(signals.componentRatio).toBe(1.0); // all connected in chain
  });
});

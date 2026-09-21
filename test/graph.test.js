import test from 'node:test';
import assert from 'node:assert/strict';
import { detectClusters } from '../src/lib/cluster.js';
import { ForceLayout } from '../src/lib/forceLayout.js';
import { sanitizeGraph } from '../src/lib/sanitizeGraph.js';
import { generateGraph } from '../src/lib/generateGraph.js';
import { buildClusterHulls } from '../src/lib/hulls.js';

function blockGraph() {
  const edges = [];

  for (let block = 0; block < 2; block += 1) {
    const offset = block * 8;

    for (let index = 0; index < 8; index += 1) {
      edges.push(offset + index, offset + ((index + 1) % 8));
      edges.push(offset + index, offset + ((index + 2) % 8));
    }
  }

  edges.push(0, 8);
  return Int32Array.from(edges);
}

test('detects two densely connected clusters', () => {
  const links = blockGraph();
  const clusters = detectClusters(links.length / 2, links, 16);

  assert.equal(new Set(clusters).size, 2);
  const first = clusters[0];

  for (let index = 1; index < 8; index += 1) {
    assert.equal(clusters[index], first);
  }

  for (let index = 8; index < 16; index += 1) {
    assert.notEqual(clusters[index], first);
  }
});

test('force simulation cools to a stable layout', () => {
  const links = blockGraph();
  const clusters = detectClusters(links.length / 2, links, 16);
  const layout = new ForceLayout(16, links.length / 2, links, clusters, {
    seed: 42,
    clusterCount: 2,
    radii: new Float64Array(16).fill(7)
  });

  for (let index = 0; index < 420; index += 1) {
    layout.step();
  }

  assert.ok(layout.alpha < 0.02);
  assert.ok(layout.stable);
});

test('empty graph remains stable without throwing', () => {
  const layout = new ForceLayout(0, 0, new Int32Array(0), new Int32Array(0), {
    clusterCount: 0
  });

  layout.step();

  assert.equal(layout.tick, 1);
  assert.equal(layout.alpha, 0);
  assert.equal(layout.stable, true);
});

test('weighted Louvain prefers strongly connected groups', () => {
  const links = Int32Array.of(0, 1, 1, 2, 2, 3, 3, 0, 1, 4, 4, 5);
  const weights = Float64Array.of(1, 1, 1, 1, 8, 8);
  const clusters = detectClusters(links.length / 2, links, 6, weights);

  assert.equal(clusters[1], clusters[4]);
  assert.equal(clusters[4], clusters[5]);
});

test('pinned drag nodes remain fixed and dragging reheats the layout', () => {
  const links = blockGraph();
  const clusters = new Int32Array(16);
  clusters.fill(1, 8);
  const layout = new ForceLayout(16, links.length / 2, links, clusters, {
    alpha: 0.01,
    clusterCount: 2
  });

  layout.pin(0, 123, 456);
  layout.step();

  assert.equal(layout.positions[0], 123);
  assert.equal(layout.positions[1], 456);
  assert.equal(layout.velocities[0], 0);
  assert.equal(layout.velocities[1], 0);
  assert.ok(layout.alpha > 0.3);
});

test('sanitizes malformed nodes, duplicates and self loops', () => {
  const result = sanitizeGraph({
    nodes: [{ id: 1 }, null, { id: 2 }, { id: 1 }],
    edges: [
      { source: 1, target: 2 },
      { source: 2, target: 1 },
      { source: 3, target: 3 },
      null,
      { source: 4, target: 5 }
    ]
  });

  assert.deepEqual(result.nodes.map(node => node.id), ['1', '2', '4', '5']);
  assert.deepEqual(result.edges, [
    { source: '1', target: '2', weight: 1 },
    { source: '4', target: '5', weight: 1 }
  ]);
  assert.ok(result.warnings.length >= 3);
});

test('builds a closed hull per cluster', () => {
  const positions = Float64Array.of(0, 0, 20, 0, 100, 0, 120, 0);
  const clusters = Int32Array.of(0, 0, 1, 1);
  const radii = new Float64Array(4).fill(6);
  const hulls = buildClusterHulls(4, positions, clusters, radii);

  assert.equal(hulls.length, 2);
  assert.ok(hulls.every(hull => hull.points.length >= 8));
  assert.deepEqual(hulls.map(hull => hull.cluster), [0, 1]);
});

test('generated graph has clustered internal density', () => {
  const graph = generateGraph(300, 42);
  assert.equal(graph.nodes.length, 300);
  assert.ok(graph.edges.length > 300);
  assert.ok(graph.nodes.every(node => Number.isInteger(node.cluster)));
});

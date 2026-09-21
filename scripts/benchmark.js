import { generateGraph } from '../src/lib/generateGraph.js';
import { detectClusters } from '../src/lib/cluster.js';
import { ForceLayout } from '../src/lib/forceLayout.js';

const count = Number(process.argv[2] ?? 1000);
const graph = generateGraph(count, 42);
const links = new Int32Array(graph.edges.length * 2);

graph.edges.forEach((edge, index) => {
  links[index * 2] = Number(edge.source);
  links[index * 2 + 1] = Number(edge.target);
});

let started = performance.now();
const clusters = detectClusters(graph.edges.length, links, graph.nodes.length);
const clusterMs = performance.now() - started;
const clusterCount = new Set(clusters).size;
const radii = Float64Array.from(graph.nodes, node => node.size + 3);
const layout = new ForceLayout(graph.nodes.length, graph.edges.length, links, clusters, {
  radii,
  clusterCount
});

started = performance.now();
for (let index = 0; index < 100; index += 1) {
  layout.step();
}

const tickMs = performance.now() - started;
console.log(JSON.stringify({
  nodes: count,
  edges: graph.edges.length,
  clusters: clusterCount,
  clusterMs: Number(clusterMs.toFixed(2)),
  tick100Ms: Number(tickMs.toFixed(2)),
  avgTickMs: Number((tickMs / 100).toFixed(2)),
  alpha: Number(layout.alpha.toFixed(4))
}, null, 2));

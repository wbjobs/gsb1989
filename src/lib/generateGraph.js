import { createRandom } from './random.js';

export function generateGraph(nodeCount = 1000, seed = Date.now()) {
  const random = createRandom(seed);
  const clusterCount = Math.max(3, Math.min(10, Math.round(Math.sqrt(nodeCount / 55))));
  const nodes = [];
  const edges = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const cluster = index % clusterCount;
    nodes.push({
      id: `n${index}`,
      label: `节点 ${index}`,
      cluster,
      size: 4 + random() * 5
    });
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const ownCluster = nodes[index].cluster;
    const internalDegree = 5 + Math.floor(random() * 6);
    const clusterSize = Math.ceil(nodes.length / clusterCount);

    for (let degree = 0; degree < internalDegree; degree += 1) {
      const position = Math.floor(random() * clusterSize);
      const target = ownCluster + clusterCount * position;

      if (target < nodes.length && target !== index && nodes[target].cluster === ownCluster) {
        edges.push({ source: index, target, weight: 1 + random() * 1.5 });
      }
    }
  }

  const bridgeCount = Math.ceil(nodes.length * 0.035);

  for (let index = 0; index < bridgeCount; index += 1) {
    const source = Math.floor(random() * nodes.length);
    const targetCluster = (nodes[source].cluster + 1 + Math.floor(random() * (clusterCount - 1))) % clusterCount;
    const clusterSize = Math.ceil(nodes.length / clusterCount);
    const target = targetCluster + clusterCount * Math.floor(random() * clusterSize);

    if (target < nodes.length) {
      edges.push({ source, target, weight: 0.5 + random() * 0.8 });
    }
  }

  return { nodes, edges };
}

export function detectClusters(edgeCount, links, nodeCount, weights = null) {
  if (!edgeCount || nodeCount <= 1) {
    return new Int32Array(nodeCount);
  }

  let levelNodeCount = nodeCount;
  let adjacency = Array.from({ length: nodeCount }, () => new Map());
  let strengths = new Float64Array(nodeCount);
  let partitions = Array.from({ length: nodeCount }, (_, index) => Int32Array.of(index));

  for (let index = 0; index < edgeCount; index += 1) {
    const source = links[index * 2];
    const target = links[index * 2 + 1];
    const weight = weights ? weights[index] : 1;
    const sourcePrevious = adjacency[source].get(target) ?? 0;
    const targetPrevious = adjacency[target].get(source) ?? 0;
    adjacency[source].set(target, sourcePrevious + weight);
    adjacency[target].set(source, targetPrevious + weight);
    strengths[source] += weight;
    strengths[target] += weight;
  }

  for (let pass = 0; pass < 30; pass += 1) {
    const communityOf = Int32Array.from({ length: levelNodeCount }, (_, index) => index);
    const communityStrength = Float64Array.from(strengths);
    let totalStrength = 0;

    for (let index = 0; index < levelNodeCount; index += 1) {
      totalStrength += strengths[index];
    }

    let moved = true;

    while (moved) {
      moved = false;
      const queue = Array.from({ length: levelNodeCount }, (_, index) => index);
      const queued = new Uint8Array(levelNodeCount).fill(1);

      while (queue.length) {
        const node = queue.shift();
        queued[node] = 0;
        const oldCommunity = communityOf[node];
        const nodeStrength = strengths[node];
        const linksByCommunity = new Map();

        for (const [neighbor, weight] of adjacency[node]) {
          const community = communityOf[neighbor];
          linksByCommunity.set(community, (linksByCommunity.get(community) ?? 0) + weight);
        }

        communityOf[node] = -1;
        communityStrength[oldCommunity] -= nodeStrength;

        let bestCommunity = oldCommunity;
        let bestGain = 0;

        for (const [community, weightToCommunity] of linksByCommunity) {
          if (community < 0) {
            continue;
          }

          const gain = weightToCommunity - nodeStrength * communityStrength[community] / totalStrength;

          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && community < bestCommunity)) {
            bestGain = gain;
            bestCommunity = community;
          }
        }

        communityOf[node] = bestCommunity;
        communityStrength[bestCommunity] += nodeStrength;

        if (bestCommunity !== oldCommunity) {
          moved = true;

          for (const neighbor of adjacency[node].keys()) {
            if (neighbor !== node && communityOf[neighbor] === oldCommunity && !queued[neighbor]) {
              queued[neighbor] = 1;
              queue.push(neighbor);
            }
          }
        }
      }
    }

    const compressed = new Map();
    let nextCount = 0;

    for (let index = 0; index < levelNodeCount; index += 1) {
      const community = communityOf[index];

      if (!compressed.has(community)) {
        compressed.set(community, nextCount);
        nextCount += 1;
      }
    }

    if (nextCount >= levelNodeCount) {
      break;
    }

    const nextAdjacency = Array.from({ length: nextCount }, () => new Map());
    const nextStrengths = new Float64Array(nextCount);
    const nextPartitions = Array.from({ length: nextCount }, () => []);

    for (let index = 0; index < levelNodeCount; index += 1) {
      nextPartitions[compressed.get(communityOf[index])].push(...partitions[index]);
    }

    for (let source = 0; source < levelNodeCount; source += 1) {
      const sourceCommunity = compressed.get(communityOf[source]);

      for (const [target, weight] of adjacency[source]) {
        const targetCommunity = compressed.get(communityOf[target]);
        nextAdjacency[sourceCommunity].set(
          targetCommunity,
          (nextAdjacency[sourceCommunity].get(targetCommunity) ?? 0) + weight
        );
        nextStrengths[sourceCommunity] += weight;
      }
    }

    adjacency = nextAdjacency;
    strengths = nextStrengths;
    partitions = nextPartitions.map(group => Int32Array.from(group));
    levelNodeCount = nextCount;

    if (levelNodeCount === 1) {
      break;
    }
  }

  const result = new Int32Array(nodeCount);
  partitions.forEach((group, community) => {
    for (const node of group) {
      result[node] = community;
    }
  });

  return result;
}

export function resolveClusters(graph, detectedClusters, options = {}) {
  const validPreset = graph.nodes.length > 0 && graph.nodes.every(
    node => Number.isInteger(node.cluster) && node.cluster >= 0
  );

  if (!validPreset || options.forceDetected) {
    return detectedClusters;
  }

  const remap = new Map();
  let nextCluster = 0;

  return Int32Array.from(graph.nodes, node => {
    if (!remap.has(node.cluster)) {
      remap.set(node.cluster, nextCluster);
      nextCluster += 1;
    }

    return remap.get(node.cluster);
  });
}

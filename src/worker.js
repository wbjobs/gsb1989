import { sanitizeGraph } from './lib/sanitizeGraph.js';
import { detectClusters, resolveClusters } from './lib/cluster.js';
import { ForceLayout } from './lib/forceLayout.js';
import { buildClusterHulls } from './lib/hulls.js';

let layout = null;
let graph = null;
let timer = 0;
let lastFrame = 0;
let clusterCount = 0;
let edgeWeights = null;

self.onmessage = event => {
  try {
    const message = event.data;

    if (message.type === 'init') {
      initialize(message.graph, message.options ?? {});
      return;
    }

    if (!layout) {
      throw new Error('布局尚未初始化');
    }

    if (message.type === 'pin') {
      layout.pin(message.index, message.x, message.y);
      startLoop();
    } else if (message.type === 'move') {
      layout.movePinned(message.index, message.x, message.y);
    } else if (message.type === 'release') {
      layout.release(message.index, message.x, message.y);
      startLoop();
    } else if (message.type === 'reheat') {
      layout.reheat();
      startLoop();
    } else if (message.type === 'recluster') {
      const detected = detectClusters(graph.edges.length, layout.links, graph.nodes.length, edgeWeights);
      const clusters = resolveClusters(graph, detected, { forceDetected: true });
      clusterCount = new Set(clusters).size;
      layout.updateClusters(clusters, clusterCount);
      sendState(true);
      startLoop();
    } else if (message.type === 'setGraph') {
      initialize(message.graph, message.options ?? {});
    }
  } catch (error) {
    const fatal = message.type === 'init' || message.type === 'setGraph';
    self.postMessage({
      type: 'error',
      fatal,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

function initialize(inputGraph, options) {
  stopLoop();
  graph = sanitizeGraph(inputGraph);
  const nodeById = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const validEdges = [];
  const invalidEdges = [];

  graph.edges.forEach((edge, index) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);

    if (!Number.isInteger(source) || !Number.isInteger(target)) {
      invalidEdges.push(index);
      return;
    }

    validEdges.push(edge);
  });

  graph.edges = validEdges;
  const links = new Int32Array(graph.edges.length * 2);
  edgeWeights = new Float64Array(graph.edges.length);

  graph.edges.forEach((edge, index) => {
    links[index * 2] = nodeById.get(edge.source);
    links[index * 2 + 1] = nodeById.get(edge.target);
    edgeWeights[index] = edge.weight;
  });

  if (invalidEdges.length) {
    graph.warnings.push(`${invalidEdges.length} 条边引用了不存在的节点，已忽略`);
  }

  const detected = detectClusters(graph.edges.length, links, graph.nodes.length, edgeWeights);
  const clusters = resolveClusters(graph, detected);
  clusterCount = new Set(clusters).size;
  const initialPositions = options.positions && options.positions.length === graph.nodes.length * 2
    ? Float64Array.from(options.positions)
    : null;
  const radii = Float64Array.from(graph.nodes, node => Number(node.size) + 3);

  layout = new ForceLayout(graph.nodes.length, graph.edges.length, links, clusters, {
    ...options,
    radii,
    initialPositions,
    clusterCount
  });

  sendState(true);
  startLoop();
}

function startLoop() {
  if (timer) {
    return;
  }

  lastFrame = performance.now();
  timer = setInterval(frame, 1000 / 60);
}

function stopLoop() {
  if (timer) {
    clearInterval(timer);
    timer = 0;
  }
}

function frame() {
  if (!layout) {
    return;
  }

  const now = performance.now();
  const elapsed = Math.min(48, now - lastFrame);
  lastFrame = now;
  const steps = elapsed > 32 ? 2 : 1;

  for (let count = 0; count < steps; count += 1) {
    layout.step();
  }

  sendState(false);

  if (layout.stable) {
    stopLoop();
    sendState(true);
  }
}

function sendState(forceHulls) {
  const positions = layout.snapshotPositions();
  const includeHulls = forceHulls || layout.tick % 20 === 0;
  const hulls = includeHulls
    ? buildClusterHulls(layout.nodeCount, layout.positions, layout.clusters, layout.radii)
    : null;
  const meta = forceHulls
    ? {
        links: layout.links,
        clusters: layout.clusters,
        clusterCount,
        hulls,
        radii: layout.radii,
        nodes: graph.nodes,
        warnings: graph.warnings
      }
    : { hulls };

  self.postMessage(
    {
      type: 'state',
      positions,
      ...meta,
      alpha: layout.alpha,
      tick: layout.tick,
      stable: layout.stable,
    },
    [positions.buffer]
  );
}

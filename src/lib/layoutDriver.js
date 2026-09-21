import { sanitizeGraph } from './sanitizeGraph.js';
import { detectClusters, resolveClusters } from './cluster.js';
import { ForceLayout } from './forceLayout.js';
import { buildClusterHulls } from './hulls.js';

export class LayoutDriver extends EventTarget {
  constructor() {
    super();
    this.mode = 'worker';
    this.worker = null;
    this.fallback = null;
    this.fallbackTimer = 0;
    this.lastGraph = null;
    this.lastOptions = {};
  }

  start(graph, options = {}) {
    this.lastGraph = graph;
    this.lastOptions = options;
    try {
      if (typeof Worker !== 'function') {
        throw new Error('Web Worker 不可用');
      }

      this.worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => this.handleWorkerMessage(event.data);
      this.worker.onerror = event => {
        event.preventDefault();
        this.useFallback(new Error(event.message || 'Worker 运行失败'), graph, options);
      };
      this.worker.onmessageerror = () => this.useFallback(new Error('Worker 消息无法反序列化'), graph, options);
      this.worker.postMessage({ type: 'init', graph, options });
    } catch (error) {
      this.useFallback(error, graph, options);
    }
  }

  useFallback(error, graph, options) {
    if (this.fallback) {
      return;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    try {
      this.mode = 'main-thread';
      this.fallback = createFallbackEngine();
      this.fallback.initialize(graph, options);
      this.dispatchEvent(new CustomEvent('degraded', { detail: { message: error.message } }));
      this.dispatchEvent(new CustomEvent('state', { detail: this.fallback.getState(true) }));
      this.startFallbackLoop();
    } catch (fallbackError) {
      this.fallback = null;
      this.dispatchEvent(new CustomEvent('fatal', {
        detail: { message: `${error.message}；主线程降级也失败：${fallbackError.message}` }
      }));
    }
  }

  handleWorkerMessage(message) {
    if (message.type === 'state') {
      this.dispatchEvent(new CustomEvent('state', { detail: message }));
    } else if (message.type === 'error') {
      if (message.fatal) {
        this.useFallback(new Error(message.message), this.lastGraph, this.lastOptions);
      } else {
        this.dispatchEvent(new CustomEvent('error', { detail: { message: message.message } }));
      }
    }
  }

  send(message) {
    if (message.type === 'setGraph') {
      this.lastGraph = message.graph;
      this.lastOptions = message.options ?? {};
    }

    if (this.worker) {
      this.worker.postMessage(message);
      return;
    }

    if (this.fallback) {
      this.fallback.handle(message);

      if (message.type === 'setGraph') {
        this.restartFallback();
      } else if (message.type === 'recluster') {
        this.dispatchEvent(new CustomEvent('state', { detail: this.fallback.getState(true) }));
        this.startFallbackLoop();
      } else {
        this.startFallbackLoop();
      }
    }
  }

  startFallbackLoop() {
    if (this.fallbackTimer || !this.fallback) {
      return;
    }

    this.fallbackTimer = setInterval(() => {
      this.fallback.frame();
      this.dispatchEvent(new CustomEvent('state', { detail: this.fallback.getState(false) }));

      if (this.fallback.layout.stable) {
        clearInterval(this.fallbackTimer);
        this.fallbackTimer = 0;
        this.dispatchEvent(new CustomEvent('state', { detail: this.fallback.getState(true) }));
      }
    }, 1000 / 60);
  }

  restartFallback() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = 0;
    }

    this.dispatchEvent(new CustomEvent('state', { detail: this.fallback.getState(true) }));
    this.startFallbackLoop();
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
    }

    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
    }
  }
}

function createFallbackEngine() {
  let graph = null;
  let layout = null;
  let clusterCount = 0;
  let edgeWeights = null;

  function initialize(inputGraph, options) {
    graph = sanitizeGraph(inputGraph);
    const nodeById = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const validEdges = [];

    graph.edges.forEach(edge => {
      if (nodeById.has(edge.source) && nodeById.has(edge.target)) {
        validEdges.push(edge);
      }
    });

    graph.edges = validEdges;
    const links = new Int32Array(graph.edges.length * 2);
    edgeWeights = new Float64Array(graph.edges.length);

    graph.edges.forEach((edge, index) => {
      links[index * 2] = nodeById.get(edge.source);
      links[index * 2 + 1] = nodeById.get(edge.target);
      edgeWeights[index] = edge.weight;
    });

    const detected = detectClusters(graph.edges.length, links, graph.nodes.length, edgeWeights);
    const clusters = resolveClusters(graph, detected);
    clusterCount = new Set(clusters).size;
    const radii = Float64Array.from(graph.nodes, node => Number(node.size) + 3);
    const initialPositions = options.positions && options.positions.length === graph.nodes.length * 2
      ? Float64Array.from(options.positions)
      : null;

    layout = new ForceLayout(graph.nodes.length, graph.edges.length, links, clusters, {
      ...options,
      radii,
      initialPositions,
      clusterCount
    });
  }

  return {
    initialize,

    get layout() {
      return layout;
    },

    handle(message) {
      if (message.type === 'pin') {
        layout.pin(message.index, message.x, message.y);
      } else if (message.type === 'move') {
        layout.movePinned(message.index, message.x, message.y);
      } else if (message.type === 'release') {
        layout.release(message.index, message.x, message.y);
      } else if (message.type === 'reheat') {
        layout.reheat();
      } else if (message.type === 'recluster') {
        const detected = detectClusters(graph.edges.length, layout.links, graph.nodes.length, edgeWeights);
        const clusters = resolveClusters(graph, detected, { forceDetected: true });
        clusterCount = new Set(clusters).size;
        layout.updateClusters(clusters, clusterCount);
      } else if (message.type === 'setGraph') {
        initialize(message.graph, message.options ?? {});
      }
    },

    frame() {
      layout.step();
    },

    getState(forceHulls) {
      const meta = forceHulls
        ? {
            links: layout.links,
            clusters: layout.clusters,
            clusterCount,
            radii: layout.radii,
            nodes: graph.nodes,
            warnings: graph.warnings,
            hulls: buildClusterHulls(layout.nodeCount, layout.positions, layout.clusters, layout.radii)
          }
        : {
            hulls: forceHulls || layout.tick % 20 === 0
              ? buildClusterHulls(layout.nodeCount, layout.positions, layout.clusters, layout.radii)
              : null
          };

      return {
        positions: layout.snapshotPositions(),
        ...meta,
        alpha: layout.alpha,
        tick: layout.tick,
        stable: layout.stable,
      };
    }
  };
}

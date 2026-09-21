import { GraphRenderer } from './lib/renderer.js';
import { LayoutDriver } from './lib/layoutDriver.js';
import { GraphStore } from './lib/storage.js';
import { generateGraph } from './lib/generateGraph.js';

const canvas = document.querySelector('#graphCanvas');
const statusElement = document.querySelector('#status');
const warningsElement = document.querySelector('#warnings');
const fallbackElement = document.querySelector('#fallbackMessage');
const nodeCountElement = document.querySelector('#nodeCount');
const regenerateElement = document.querySelector('#regenerate');
const reheatElement = document.querySelector('#reheat');
const reclusterElement = document.querySelector('#recluster');
const showClustersElement = document.querySelector('#showClusters');
const STORE_KEY = 'current-graph';
const SNAPSHOT_KEY = 'current-snapshot';

let renderer;
let driver;
let store = new GraphStore();
let graph;
let state;
let options = {};
let hovered = -1;
let dragging = -1;
let dragOffset = { x: 0, y: 0 };
let panning = null;
let hasFit = false;
let saveTimer = 0;
let snapshotReady = false;
let renderQueued = false;
let dirty = true;

bootstrap();

async function bootstrap() {
  try {
    renderer = new GraphRenderer(canvas);
  } catch (error) {
    showFatal(`Canvas 不可用：${error.message}`);
    return;
  }

  const storageWarning = await openStore();

  try {
    const savedGraph = await store.get('graphs', STORE_KEY);
    const snapshot = await store.get('snapshots', SNAPSHOT_KEY);
    graph = savedGraph;

    if (snapshot?.positions?.length) {
      options.positions = snapshot.positions;
    }
  } catch (error) {
    appendWarning(`读取缓存失败：${error.message}`);
  }

  if (!graph) {
    graph = generateGraph(Number(nodeCountElement.value), 20260921);
    saveGraph();
  } else {
    nodeCountElement.value = String(graph.nodes?.length ?? 1000);
  }

  if (storageWarning) {
    appendWarning(storageWarning);
  }

  driver = new LayoutDriver();
  driver.addEventListener('state', event => updateState(event.detail));
  driver.addEventListener('degraded', event => appendWarning(`Worker 异常，已降级到主线程：${event.detail.message}`));
  driver.addEventListener('error', event => appendWarning(event.detail.message));
  driver.addEventListener('fatal', event => showFatal(event.detail.message));
  driver.start(graph, options);

  bindEvents();
  requestRender();
}

async function openStore() {
  try {
    await store.open();
    return null;
  } catch (error) {
    store = new GraphStore();
    return `IndexedDB 不可用，使用内存存储：${error.message}`;
  }
}

function bindEvents() {
  window.addEventListener('resize', () => {
    renderer.resize();
    requestRender();
  });

  regenerateElement.addEventListener('click', () => {
    const count = Number(nodeCountElement.value);
    graph = generateGraph(count, Date.now());
    options = {};
    hasFit = false;
    snapshotReady = false;
    hovered = -1;
    dragging = -1;
    saveGraph();
    driver.send({ type: 'setGraph', graph, options });
    requestRender();
  });

  reheatElement.addEventListener('click', () => driver.send({ type: 'reheat' }));
  reclusterElement.addEventListener('click', () => driver.send({ type: 'recluster' }));
  showClustersElement.addEventListener('change', requestRender);

  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    const world = renderer.screenToWorld(event.offsetX, event.offsetY);
    const hit = state
      ? renderer.findNode(world.x, world.y, state.positions, state.radii, dragging)
      : -1;

    if (hit >= 0) {
      dragging = hit;
      canvas.style.cursor = 'grabbing';
      dragOffset = {
        x: state.positions[hit * 2] - world.x,
        y: state.positions[hit * 2 + 1] - world.y
      };
      driver.send({
        type: 'pin',
        index: hit,
        x: world.x + dragOffset.x,
        y: world.y + dragOffset.y
      });
      requestRender();
    } else {
      panning = { x: event.offsetX, y: event.offsetY, view: { ...renderer.view } };
    }
  });

  canvas.addEventListener('pointermove', event => {
    const world = renderer.screenToWorld(event.offsetX, event.offsetY);

    if (dragging >= 0) {
      const nextX = world.x + dragOffset.x;
      const nextY = world.y + dragOffset.y;
      state.positions[dragging * 2] = nextX;
      state.positions[dragging * 2 + 1] = nextY;
      canvas.style.cursor = 'grabbing';
      driver.send({
        type: 'move',
        index: dragging,
        x: nextX,
        y: nextY
      });
      return;
    }

    if (panning) {
      const dx = (event.offsetX - panning.x) / renderer.view.scale;
      const dy = (event.offsetY - panning.y) / renderer.view.scale;
      renderer.view.x = panning.view.x - dx;
      renderer.view.y = panning.view.y - dy;
      requestRender();
      return;
    }

    hovered = state
      ? renderer.findNode(world.x, world.y, state.positions, state.radii)
      : -1;
    canvas.style.cursor = hovered >= 0 ? 'grab' : 'default';
    requestRender();
  });

  const finishPointer = event => {
    const world = renderer.screenToWorld(event.offsetX, event.offsetY);

    if (dragging >= 0) {
      driver.send({
        type: 'release',
        index: dragging,
        x: world.x + dragOffset.x,
        y: world.y + dragOffset.y
      });
      dragging = -1;
    }

    panning = null;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    renderer.zoom(renderer.view.scale * factor, event.offsetX, event.offsetY);
    requestRender();
  }, { passive: false });

  window.addEventListener('pagehide', () => {
    if (snapshotReady) {
      saveSnapshot();
    }
  });
}

function updateState(nextState) {
  if (state && nextState !== state) {
    for (const key of ['nodes', 'links', 'clusters', 'clusterCount', 'radii']) {
      if (nextState[key] === undefined) {
        nextState[key] = state[key];
      }
    }
  }

  state = nextState;
  requestRender();

  if (!hasFit && nextState.positions?.length) {
    renderer.fit(nextState.positions);
    hasFit = true;
  }

  if (nextState.warnings?.length) {
    appendWarning(nextState.warnings.join('；'));
  }

  const clusterWord = nextState.clusterCount
    ? `${nextState.clusterCount} 个聚类`
    : '0 个聚类';
  const stableWord = nextState.stable ? '已稳定' : `迭代 ${nextState.tick}，α ${nextState.alpha.toFixed(3)}`;
  statusElement.textContent = `${nextState.nodes?.length ?? 0} 节点 / ${(nextState.links?.length ?? 0) / 2} 边 · ${clusterWord} · ${stableWord} · ${driver.mode === 'worker' ? 'Worker' : '主线程降级'}`;

  if (nextState.stable) {
    snapshotReady = true;
    scheduleSnapshot();
  }
}

function render() {
  renderQueued = false;

  if (state) {
    renderer.draw(state, {
      hovered,
      dragging,
      showClusters: showClustersElement.checked,
      clusterCount: state.clusterCount,
      nodes: state.nodes
    });
  }

  if (dirty) {
    requestAnimationFrame(render);
  } else {
    renderQueued = false;
  }
}

function requestRender() {
  dirty = true;

  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      dirty = false;
      render();
    });
  }
}

function saveGraph() {
  store.put('graphs', STORE_KEY, graph).catch(appendWarning);
  store.put('metadata', `${STORE_KEY}-updated-at`, Date.now()).catch(() => {});
}

function scheduleSnapshot() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSnapshot, 800);
}

function saveSnapshot() {
  if (!state?.positions) {
    return;
  }

  const positions = Array.from(new Float32Array(state.positions));
  store.put('snapshots', SNAPSHOT_KEY, {
    positions,
    tick: state.tick,
    savedAt: Date.now()
  }).catch(appendWarning);
}

function appendWarning(message) {
  if (!message) {
    return;
  }

  warningsElement.textContent = message;
}

function showFatal(message) {
  fallbackElement.hidden = false;
  fallbackElement.textContent = message;
  statusElement.textContent = '初始化失败';
}

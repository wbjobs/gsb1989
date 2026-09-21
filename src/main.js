import { createStore } from './db.js';
import { generateGraph } from './graph.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const CLUSTER_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#469990', '#9a6324',
];

const state = {
  graph: null,
  x: null, y: null, labels: null, clusterCount: 0,
  cam: { x: 0, y: 0, k: 1 },
  dragNode: -1, panning: false, lastPointer: null,
  alpha: 1, usedBH: true, mode: 'worker',
  fps: 0, frames: 0, fpsTime: 0,
  worker: null, store: createStore(),
  dirty: true,
};

function layoutKey() {
  const g = state.graph;
  return `layout-n${g.n}-c${g.clusters}-s${g.seed}`;
}

/* ---------- worker with main-thread fallback ---------- */

async function createLocalWorkerShim() {
  const src = await (await fetch('src/worker.js')).text();
  const factory = new Function(
    'postMessage',
    `'use strict';\nlet onmessage;\n${src}\nreturn { send: (m) => onmessage({ data: m }) };`
  );
  const shim = { onmessage: null };
  const api = factory((msg) => shim.onmessage && shim.onmessage({ data: msg }));
  return {
    postMessage: (m) => api.send(m),
    set onmessage(cb) { shim.onmessage = cb; },
    get onmessage() { return shim.onmessage; },
    terminate() {},
  };
}

async function createEngine() {
  try {
    const w = new Worker('src/worker.js');
    w.onerror = (e) => {
      console.warn('[engine] worker error, switching to main thread', e.message);
      fallbackToMainThread();
    };
    state.mode = 'worker';
    return w;
  } catch (err) {
    console.warn('[engine] Worker unavailable, using main thread:', err.message);
    state.mode = 'main-thread';
    return createLocalWorkerShim();
  }
}

let fallingBack = false;
async function fallbackToMainThread() {
  if (fallingBack || state.mode === 'main-thread') return;
  fallingBack = true;
  try { state.worker && state.worker.terminate(); } catch (_) {}
  state.mode = 'main-thread';
  state.worker = await createLocalWorkerShim();
  wireWorker(state.worker);
  startSimulation(null);
  toast('Web Worker 不可用，已降级到主线程模拟（性能会下降）');
  fallingBack = false;
}

function wireWorker(w) {
  w.onmessage = (e) => {
    const msg = e.data;
    switch (msg.type) {
      case 'tick':
        state.x = new Float64Array(msg.x);
        state.y = new Float64Array(msg.y);
        state.alpha = msg.alpha;
        state.usedBH = msg.usedBH;
        if (msg.labels) { state.labels = msg.labels; state.clusterCount = msg.clusterCount; }
        state.dirty = true;
        break;
      case 'clusters':
        state.labels = msg.labels;
        state.clusterCount = msg.count;
        updateLegend();
        break;
      case 'stable':
        state.alpha = 0;
        persistLayout();
        break;
      case 'error':
        console.error('[engine]', msg.message);
        if (state.mode === 'worker') fallbackToMainThread();
        else toast('模拟出错: ' + msg.message);
        break;
    }
  };
}

async function startSimulation(savedPositions) {
  const g = state.graph;
  state.worker.postMessage({
    type: 'init',
    n: g.n,
    links: g.links,
    opts: { repulsion: 900, spring: 0.08, linkDist: 30 },
    positions: savedPositions,
  });
}

/* ---------- persistence ---------- */

async function persistLayout() {
  if (!state.x) return;
  const ok = await state.store.saveLayout(layoutKey(), state.x, state.y);
  if (!ok) console.warn('[persist] layout not saved (degraded)');
}

async function restoreLayout() {
  const saved = await state.store.loadLayout(layoutKey());
  if (saved && saved.x.length === state.graph.n) {
    toast('已从 IndexedDB 恢复上次布局');
    return { x: saved.x.buffer, y: saved.y.buffer };
  }
  return null;
}

/* ---------- rendering ---------- */

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  state.dirty = true;
}
window.addEventListener('resize', resize);

function toWorld(px, py) {
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (px * dpr - state.cam.x) / state.cam.k,
    y: (py * dpr - state.cam.y) / state.cam.k,
  };
}

function pickNode(px, py) {
  if (!state.x) return -1;
  const w = toWorld(px, py);
  const r = 8 / state.cam.k + 4;
  let best = -1, bestD = r * r;
  for (let i = 0; i < state.graph.n; i++) {
    const dx = state.x[i] - w.x, dy = state.y[i] - w.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.x) return;
  ctx.setTransform(state.cam.k, 0, 0, state.cam.k, state.cam.x, state.cam.y);
  const g = state.graph;
  // links
  ctx.strokeStyle = 'rgba(139,148,158,0.25)';
  ctx.lineWidth = 1 / state.cam.k;
  ctx.beginPath();
  for (const [s, t] of g.links) {
    ctx.moveTo(state.x[s], state.y[s]);
    ctx.lineTo(state.x[t], state.y[t]);
  }
  ctx.stroke();
  // nodes
  const r = Math.max(2.5 / state.cam.k, 1.2);
  for (let i = 0; i < g.n; i++) {
    const c = state.labels ? state.labels[i] % CLUSTER_COLORS.length : 2;
    ctx.fillStyle = CLUSTER_COLORS[c];
    ctx.beginPath();
    ctx.arc(state.x[i], state.y[i], i === state.dragNode ? r * 1.8 : r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function frame(t) {
  // fps
  state.frames++;
  if (t - state.fpsTime >= 500) {
    state.fps = Math.round((state.frames * 1000) / (t - state.fpsTime));
    state.frames = 0; state.fpsTime = t;
    updateStats();
  }
  if (state.dirty || state.alpha > 0) {
    render();
    state.dirty = state.alpha > 0;
  }
  requestAnimationFrame(frame);
}

/* ---------- input ---------- */

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const i = pickNode(e.offsetX, e.offsetY);
  state.lastPointer = { x: e.offsetX, y: e.offsetY };
  if (i >= 0) {
    state.dragNode = i;
    const w = toWorld(e.offsetX, e.offsetY);
    state.worker.postMessage({ type: 'drag', i, x: w.x, y: w.y });
  } else {
    state.panning = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.lastPointer) return;
  const dpr = window.devicePixelRatio || 1;
  if (state.dragNode >= 0) {
    const w = toWorld(e.offsetX, e.offsetY);
    state.x[state.dragNode] = w.x;   // optimistic local update for smoothness
    state.y[state.dragNode] = w.y;
    state.worker.postMessage({ type: 'dragmove', i: state.dragNode, x: w.x, y: w.y });
    state.dirty = true;
  } else if (state.panning) {
    state.cam.x += (e.offsetX - state.lastPointer.x) * dpr;
    state.cam.y += (e.offsetY - state.lastPointer.y) * dpr;
    state.dirty = true;
  }
  state.lastPointer = { x: e.offsetX, y: e.offsetY };
});

canvas.addEventListener('pointerup', () => {
  if (state.dragNode >= 0) {
    state.worker.postMessage({ type: 'drop', i: state.dragNode });
    state.dragNode = -1;
  }
  state.panning = false;
  state.lastPointer = null;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dpr = window.devicePixelRatio || 1;
  const factor = Math.exp(-e.deltaY * 0.001);
  const k2 = Math.min(8, Math.max(0.05, state.cam.k * factor));
  const px = e.offsetX * dpr, py = e.offsetY * dpr;
  state.cam.x = px - (px - state.cam.x) * (k2 / state.cam.k);
  state.cam.y = py - (py - state.cam.y) * (k2 / state.cam.k);
  state.cam.k = k2;
  state.dirty = true;
}, { passive: false });

/* ---------- UI ---------- */

function updateStats() {
  $('stats').textContent =
    `FPS ${state.fps} | 节点 ${state.graph ? state.graph.n : 0} | 边 ${state.graph ? state.graph.links.length : 0}` +
    ` | α ${state.alpha.toFixed(3)} | ${state.usedBH ? 'Barnes-Hut' : 'O(n²)'}` +
    ` | ${state.mode === 'worker' ? 'Web Worker' : '主线程(降级)'}`;
}

function updateLegend() {
  const el = $('legend');
  el.innerHTML = '';
  for (let c = 0; c < Math.min(state.clusterCount, CLUSTER_COLORS.length); c++) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i style="background:${CLUSTER_COLORS[c]}"></i>簇 ${c + 1}`;
    el.appendChild(item);
  }
  if (state.clusterCount > CLUSTER_COLORS.length) {
    const more = document.createElement('span');
    more.textContent = `…共 ${state.clusterCount} 簇`;
    el.appendChild(more);
  }
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

async function regenerate() {
  const n = parseInt($('nodeCount').value, 10);
  const clusters = parseInt($('clusterCount').value, 10);
  const seed = (Math.random() * 1e9) | 0;
  state.graph = { ...generateGraph(n, clusters, seed), clusters, seed };
  state.x = state.y = state.labels = null;
  state.dragNode = -1;
  const saved = await restoreLayout();
  startSimulation(saved);
  updateStats();
}

async function boot() {
  window.addEventListener('error', (e) => toast('运行时错误: ' + e.message));
  resize();
  state.worker = await createEngine();
  wireWorker(state.worker);

  $('regenerate').addEventListener('click', regenerate);
  $('reheat').addEventListener('click', () => state.worker.postMessage({ type: 'reheat', alpha: 0.6 }));
  $('clearLayout').addEventListener('click', async () => {
    await state.store.clear(layoutKey());
    toast('已清除缓存布局');
  });

  await regenerate();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  toast('初始化失败: ' + err.message);
});

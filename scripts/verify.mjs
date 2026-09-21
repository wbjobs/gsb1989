/* Headless verification of the simulation worker logic (run: npm run verify). */
import { readFileSync } from 'node:fs';
import { generateGraph } from '../src/graph.js';

const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

function createEngine(onMessage) {
  const factory = new Function(
    'postMessage',
    `'use strict';\nlet onmessage;\n${src}\nreturn { send: (m) => onmessage({ data: m }) };`
  );
  return factory(onMessage);
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok:', msg);
}

const N = 1000, CLUSTERS = 5;
const graph = generateGraph(N, CLUSTERS, 42);

let lastTick = null, stable = false, clustersMsg = null, tickCount = 0;
const t0 = performance.now();
const engine = createEngine((msg) => {
  if (msg.type === 'tick') { lastTick = msg; tickCount++; }
  if (msg.type === 'clusters') clustersMsg = msg;
  if (msg.type === 'stable') stable = true;
  if (msg.type === 'error') { console.error('worker error:', msg.message); process.exit(1); }
});

engine.send({ type: 'init', n: graph.n, links: graph.links,
  opts: { repulsion: 900, spring: 0.08, linkDist: 30 }, positions: null });

// wait for stable
await new Promise((resolve) => {
  const iv = setInterval(() => { if (stable) { clearInterval(iv); clearTimeout(to); resolve(); } }, 10);
  const to = setTimeout(() => { clearInterval(iv); resolve(); }, 60000);
});
const elapsed = performance.now() - t0;

assert(stable, `布局收敛（alpha < alphaMin），用时 ${elapsed.toFixed(0)}ms，${tickCount} 帧`);
assert(lastTick && lastTick.usedBH, '使用 Barnes-Hut 加速');

const x = new Float64Array(lastTick.x), y = new Float64Array(lastTick.y);
let finite = true;
for (let i = 0; i < N; i++) if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) finite = false;
assert(finite, '所有坐标有限（无 NaN/Infinity）');

// clustering accuracy vs ground truth (best per-cluster match)
assert(clustersMsg && clustersMsg.count > 1, `检测到 ${clustersMsg.count} 个簇`);
const labels = clustersMsg.labels;
const match = new Map();
for (let c = 0; c < clustersMsg.count; c++) {
  const counts = new Map();
  for (let i = 0; i < N; i++) if (labels[i] === c)
    counts.set(graph.groupOf[i], (counts.get(graph.groupOf[i]) || 0) + 1);
  let best = 0, bestG = -1;
  for (const [g, cnt] of counts) if (cnt > best) { best = cnt; bestG = g; }
  match.set(c, bestG);
}
let correct = 0;
for (let i = 0; i < N; i++) if (match.get(labels[i]) === graph.groupOf[i]) correct++;
const acc = correct / N;
assert(acc > 0.8, `聚类准确率 ${(acc * 100).toFixed(1)}%（> 80%）`);

// drag: fix node 0 at (123, 456); it must stay pinned while dragged
engine.send({ type: 'drag', i: 0, x: 123, y: 456 });
await new Promise((r) => setTimeout(r, 300));
const dx = Math.abs(new Float64Array(lastTick.x)[0] - 123);
const dy = Math.abs(new Float64Array(lastTick.y)[0] - 456);
assert(dx < 1e-6 && dy < 1e-6, '拖拽期间节点固定在目标位置');
engine.send({ type: 'drop', i: 0 });
await new Promise((r) => setTimeout(r, 100));

// performance: time a single reheat burst at N=5000
const big = generateGraph(5000, 5, 7);
let bigTicks = 0, bigStable = false;
const engine2 = createEngine((msg) => {
  if (msg.type === 'tick') bigTicks++;
  if (msg.type === 'stable') bigStable = true;
});
const t1 = performance.now();
engine2.send({ type: 'init', n: big.n, links: big.links,
  opts: { repulsion: 900, spring: 0.08, linkDist: 30 }, positions: null });
await new Promise((resolve) => {
  const iv = setInterval(() => { if (bigStable) { clearInterval(iv); clearTimeout(to); resolve(); } }, 20);
  const to = setTimeout(() => { clearInterval(iv); resolve(); }, 120000);
});
const bigElapsed = performance.now() - t1;
assert(bigStable, `5000 节点收敛，用时 ${(bigElapsed / 1000).toFixed(1)}s，${bigTicks} 帧`);

console.log(process.exitCode ? '\n存在失败项' : '\n全部通过');

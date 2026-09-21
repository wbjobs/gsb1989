/* Force simulation worker: Barnes-Hut repulsion + spring links + label-propagation clustering.
   Degrades to O(n^2) when quadtree construction fails. */

let sim = null;

class QuadTree {
  constructor(xs, ys, n) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < x0) x0 = xs[i];
      if (xs[i] > x1) x1 = xs[i];
      if (ys[i] < y0) y0 = ys[i];
      if (ys[i] > y1) y1 = ys[i];
    }
    const size = Math.max(x1 - x0, y1 - y0, 1e-6);
    this.x0 = (x0 + x1) / 2 - size / 2;
    this.y0 = (y0 + y1) / 2 - size / 2;
    this.size = size;
    this.xs = xs; this.ys = ys; this.n = n;
    // iterative insertion, flat node arrays: cx, cy, mass, child0..3 (index into nodes, -1 empty, -2 leaf)
    this.cx = [0]; this.cy = [0]; this.mass = [0];
    this.children = [[-1, -1, -1, -1]];
    this.leafIdx = [-1]; // node index -> point index if leaf
    for (let i = 0; i < n; i++) this.insert(i);
  }
  insert(i) {
    let node = 0;
    let x0 = this.x0, y0 = this.y0, size = this.size;
    const px = this.xs[i], py = this.ys[i];
    for (let depth = 0; depth < 64; depth++) {
      this.cx[node] = (this.cx[node] * this.mass[node] + px) / (this.mass[node] + 1);
      this.cy[node] = (this.cy[node] * this.mass[node] + py) / (this.mass[node] + 1);
      this.mass[node]++;
      const q = (px >= x0 + size / 2 ? 1 : 0) + (py >= y0 + size / 2 ? 2 : 0);
      const child = this.children[node][q];
      if (child === -1) {
        const ni = this.cx.length;
        this.cx.push(px); this.cy.push(py); this.mass.push(1);
        this.children.push([-1, -1, -1, -1]);
        this.leafIdx.push(i);
        this.children[node][q] = ni;
        return;
      }
      if (this.leafIdx[child] >= 0) {
        // split: reinsert existing leaf point
        const j = this.leafIdx[child];
        this.leafIdx[child] = -1;
        const half = size / 4;
        const cx0 = x0 + (q & 1 ? size / 2 : 0), cy0 = y0 + (q & 2 ? size / 2 : 0);
        // descend into child region manually
        node = child; x0 = cx0; y0 = cy0; size = size / 2;
        // reinsert j below this node
        this.reinsert(node, x0, y0, size, j);
        // continue loop to insert i into same subtree
        continue;
      }
      node = child;
      x0 = x0 + (q & 1 ? size / 2 : 0);
      y0 = y0 + (q & 2 ? size / 2 : 0);
      size = size / 2;
    }
  }
  reinsert(node, x0, y0, size, j) {
    const px = this.xs[j], py = this.ys[j];
    for (let depth = 0; depth < 64; depth++) {
      const q = (px >= x0 + size / 2 ? 1 : 0) + (py >= y0 + size / 2 ? 2 : 0);
      const child = this.children[node][q];
      if (child === -1) {
        const ni = this.cx.length;
        this.cx.push(px); this.cy.push(py); this.mass.push(1);
        this.children.push([-1, -1, -1, -1]);
        this.leafIdx.push(j);
        this.children[node][q] = ni;
        return;
      }
      node = child;
      x0 = x0 + (q & 1 ? size / 2 : 0);
      y0 = y0 + (q & 2 ? size / 2 : 0);
      size = size / 2;
    }
  }
  // apply Barnes-Hut repulsion to point i, writing into fx, fy
  apply(i, theta, strength, fx, fy) {
    const px = this.xs[i], py = this.ys[i];
    const stack = [0];
    let sx = this.x0, sy = this.y0, ss = this.size;
    const sizes = [ss];
    while (stack.length) {
      const node = stack.pop();
      const size = sizes.pop();
      const dx = this.cx[node] - px, dy = this.cy[node] - py;
      const d2 = dx * dx + dy * dy + 1e-6;
      if (this.leafIdx[node] >= 0 || size * size / d2 < theta * theta) {
        if (this.leafIdx[node] === i) continue;
        const f = strength * this.mass[node] / d2;
        const d = Math.sqrt(d2);
        fx[i] += f * dx / d; fy[i] += f * dy / d;
        continue;
      }
      const half = size / 2;
      for (let q = 0; q < 4; q++) {
        const c = this.children[node][q];
        if (c !== -1) { stack.push(c); sizes.push(half); }
      }
    }
  }
}

function labelPropagation(n, links, iterations) {
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) labels[i] = i;
  const adj = Array.from({ length: n }, () => []);
  for (const [s, t] of links) { adj[s].push(t); adj[t].push(s); }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let iter = 0; iter < iterations; iter++) {
    // shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    let changed = 0;
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi];
      if (!adj[i].length) continue;
      const counts = new Map();
      for (const nb of adj[i]) counts.set(labels[nb], (counts.get(labels[nb]) || 0) + 1);
      let best = labels[i], bestCount = counts.get(labels[i]) || 0;
      for (const [lab, c] of counts) {
        if (c > bestCount || (c === bestCount && lab < best)) { best = lab; bestCount = c; }
      }
      if (best !== labels[i]) { labels[i] = best; changed++; }
    }
    if (!changed) break;
  }
  // remap to dense 0..k-1
  const map = new Map();
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!map.has(labels[i])) map.set(labels[i], k++);
    labels[i] = map.get(labels[i]);
  }
  return { labels, count: k };
}

function createSim(n, links, opts) {
  const xs = new Float64Array(n), ys = new Float64Array(n);
  const vx = new Float64Array(n), vy = new Float64Array(n);
  const fx = new Float64Array(n), fy = new Float64Array(n);
  const fixed = new Uint8Array(n);
  const radius = Math.sqrt(n) * 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    xs[i] = Math.cos(a) * radius + (Math.random() - 0.5) * 40;
    ys[i] = Math.sin(a) * radius + (Math.random() - 0.5) * 40;
  }
  const src = new Int32Array(links.length), tgt = new Int32Array(links.length);
  links.forEach(([s, t], i) => { src[i] = s; tgt[i] = t; });
  return {
    n, xs, ys, vx, vy, fx, fy, fixed, src, tgt,
    alpha: 1, alphaMin: 0.001, alphaDecay: 0.0228, alphaTarget: 0,
    repulsion: opts.repulsion, spring: opts.spring, linkDist: opts.linkDist,
    theta: 0.85, labels: null, clusterCount: 0,
  };
}

function tick(sim) {
  const { n, xs, ys, vx, vy, fx, fy, fixed, src, tgt } = sim;
  fx.fill(0); fy.fill(0);
  const a = sim.alpha;
  // repulsion (Barnes-Hut, fallback O(n^2))
  let usedBH = true;
  try {
    const tree = new QuadTree(xs, ys, n);
    for (let i = 0; i < n; i++) tree.apply(i, sim.theta, -sim.repulsion * a, fx, fy);
  } catch (e) {
    usedBH = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
        const d2 = dx * dx + dy * dy + 1e-6;
        const f = -sim.repulsion * a / d2;
        const d = Math.sqrt(d2);
        fx[i] += f * dx / d; fy[i] += f * dy / d;
        fx[j] -= f * dx / d; fy[j] -= f * dy / d;
      }
    }
  }
  // springs
  for (let e = 0; e < src.length; e++) {
    const s = src[e], t = tgt[e];
    const dx = xs[t] - xs[s], dy = ys[t] - ys[s];
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const f = sim.spring * a * (d - sim.linkDist) / d;
    fx[s] += f * dx; fy[s] += f * dy;
    fx[t] -= f * dx; fy[t] -= f * dy;
  }
  // centering
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  // integrate
  const damping = 0.6;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) { vx[i] = 0; vy[i] = 0; continue; }
    vx[i] = (vx[i] + fx[i] - mx * 0.02 * a) * damping;
    vy[i] = (vy[i] + fy[i] - my * 0.02 * a) * damping;
    xs[i] += vx[i]; ys[i] += vy[i];
  }
  sim.alpha += (sim.alphaTarget - sim.alpha) * sim.alphaDecay;
  return usedBH;
}

let loopRunning = false;

function runLoop() {
  if (loopRunning) return;
  loopRunning = true;
  stepLoop();
}

function stepLoop() {
  if (!sim) return;
  let usedBH = true;
  const steps = sim.alpha > 0.1 ? 3 : 1; // fast-forward while hot
  for (let s = 0; s < steps; s++) {
    if (sim.alpha < sim.alphaMin) break;
    usedBH = tick(sim);
  }
  // transfer copies
  const px = sim.xs.slice(), py = sim.ys.slice();
  postMessage({
    type: 'tick', x: px.buffer, y: py.buffer, alpha: sim.alpha,
    usedBH, labels: sim.labels ? sim.labels.slice() : null,
    clusterCount: sim.clusterCount,
  }, [px.buffer, py.buffer]);
  if (sim.alpha >= sim.alphaMin) {
    setTimeout(stepLoop, 0);
  } else {
    loopRunning = false;
    postMessage({ type: 'stable' });
  }
}

onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        sim = createSim(msg.n, msg.links, msg.opts);
        if (msg.positions) {
          const px = new Float64Array(msg.positions.x), py = new Float64Array(msg.positions.y);
          if (px.length === sim.n) { sim.xs.set(px); sim.ys.set(py); sim.alpha = 0.3; }
        }
        const { labels, count } = labelPropagation(sim.n, msg.links, 30);
        sim.labels = labels; sim.clusterCount = count;
        postMessage({ type: 'clusters', labels: labels.slice(), count });
        runLoop();
        break;
      }
      case 'reheat':
        if (sim) { sim.alpha = Math.max(sim.alpha, msg.alpha || 0.5); runLoop(); }
        break;
      case 'drag':
        if (sim && msg.i >= 0 && msg.i < sim.n) {
          sim.fixed[msg.i] = 1;
          sim.xs[msg.i] = msg.x; sim.ys[msg.i] = msg.y;
          sim.alpha = Math.max(sim.alpha, 0.15);
          runLoop();
        }
        break;
      case 'dragmove':
        if (sim && msg.i >= 0 && msg.i < sim.n) { sim.xs[msg.i] = msg.x; sim.ys[msg.i] = msg.y; }
        break;
      case 'drop':
        if (sim && msg.i >= 0 && msg.i < sim.n) sim.fixed[msg.i] = 0;
        break;
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};

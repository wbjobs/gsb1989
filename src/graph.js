/* Random clustered graph generation (deterministic via seeded PRNG). */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Generates n nodes in `clusters` latent groups; intra-cluster edges are
   denser than inter-cluster edges so clustering has ground truth to find. */
export function generateGraph(n, clusters, seed = 42) {
  const rand = mulberry32(seed);
  const groupOf = new Int32Array(n);
  for (let i = 0; i < n; i++) groupOf[i] = i % clusters;
  // shuffle groups
  for (let i = n - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = groupOf[i]; groupOf[i] = groupOf[j]; groupOf[j] = t;
  }
  const links = [];
  const seen = new Set();
  const addEdge = (s, t) => {
    if (s === t) return;
    const key = s < t ? s * n + t : t * n + s;
    if (seen.has(key)) return;
    seen.add(key);
    links.push([s, t]);
  };
  // spanning tree per cluster for connectivity
  const byGroup = Array.from({ length: clusters }, () => []);
  for (let i = 0; i < n; i++) byGroup[groupOf[i]].push(i);
  for (const members of byGroup) {
    for (let k = 1; k < members.length; k++) {
      addEdge(members[k], members[(rand() * k) | 0]);
    }
  }
  // extra intra-cluster edges
  const intraExtra = Math.floor(n * 0.8);
  for (let e = 0; e < intraExtra; e++) {
    const g = (rand() * clusters) | 0;
    const members = byGroup[g];
    if (members.length < 2) continue;
    addEdge(members[(rand() * members.length) | 0], members[(rand() * members.length) | 0]);
  }
  // sparse inter-cluster bridges
  const bridges = Math.max(clusters * 2, Math.floor(n * 0.02));
  for (let e = 0; e < bridges; e++) {
    addEdge((rand() * n) | 0, (rand() * n) | 0);
  }
  return { n, links, groupOf };
}

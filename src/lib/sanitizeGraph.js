export function sanitizeGraph(input) {
  const warnings = [];
  const rawNodes = Array.isArray(input?.nodes) ? input.nodes : [];
  const rawEdges = Array.isArray(input?.edges) ? input.edges : [];
  const nodeById = new Map();
  const nodes = [];

  function addNode(id, attributes = {}) {
    const key = String(id);

    if (!nodeById.has(key)) {
      const node = {
        id: key,
        label: attributes.label ?? key,
        cluster: Number.isInteger(attributes.cluster) ? attributes.cluster : null,
        x: Number.isFinite(attributes.x) ? attributes.x : null,
        y: Number.isFinite(attributes.y) ? attributes.y : null,
        size: Number.isFinite(attributes.size) ? Math.max(2, attributes.size) : 5
      };
      nodeById.set(key, node);
      nodes.push(node);
    }

    return nodeById.get(key);
  }

  rawNodes.forEach((item, index) => {
    if (item === null || typeof item !== 'object') {
      warnings.push(`节点 ${index} 不是对象，已忽略`);
      return;
    }

    if (!Number.isFinite(item.id) && !item.id) {
      warnings.push(`节点 ${index} 缺少 id，已忽略`);
      return;
    }

    addNode(item.id, item);
  });

  const edges = [];
  const seenEdges = new Set();

  rawEdges.forEach((item, index) => {
    if (item === null || typeof item !== 'object') {
      warnings.push(`边 ${index} 不是对象，已忽略`);
      return;
    }

    const source = item.source ?? item.from;
    const target = item.target ?? item.to;
    const hasSource = Number.isFinite(source) || Boolean(source);
    const hasTarget = Number.isFinite(target) || Boolean(target);

    if (!hasSource || !hasTarget) {
      warnings.push(`边 ${index} 缺少端点，已忽略`);
      return;
    }

    const sourceKey = String(source);
    const targetKey = String(target);

    if (sourceKey === targetKey) {
      warnings.push(`边 ${index} 是自环，已忽略`);
      return;
    }

    const edgeKey = sourceKey < targetKey ? `${sourceKey} ${targetKey}` : `${targetKey} ${sourceKey}`;

    if (seenEdges.has(edgeKey)) {
      warnings.push(`边 ${edgeKey} 重复，已忽略`);
      return;
    }

    seenEdges.add(edgeKey);
    addNode(sourceKey);
    addNode(targetKey);

    const weight = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    edges.push({ source: sourceKey, target: targetKey, weight });
  });

  return {
    nodes: nodes.map(({ id, label, cluster, x, y, size }) => ({ id, label, cluster, x, y, size })),
    edges,
    warnings
  };
}

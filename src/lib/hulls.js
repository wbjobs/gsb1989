export function buildClusterHulls(nodeCount, positions, clusters, radii) {
  const membersByCluster = new Map();

  for (let index = 0; index < nodeCount; index += 1) {
    const cluster = clusters[index] ?? 0;

    if (!membersByCluster.has(cluster)) {
      membersByCluster.set(cluster, []);
    }

    membersByCluster.get(cluster).push(index);
  }

  const hulls = [];

  for (const [cluster, members] of membersByCluster) {
    const points = members.map(index => [positions[index * 2], positions[index * 2 + 1], radii[index] ?? 6]);

    if (points.length === 1) {
      hulls.push({ cluster, points: expandPoint(points[0][0], points[0][1], points[0][2]) });
      continue;
    }

    if (points.length === 2) {
      hulls.push({ cluster, points: capsule(points[0], points[1]) });
      continue;
    }

    points.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
    const lower = [];

    for (const point of points) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper = [];

    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    lower.pop();
    upper.pop();
    const hull = lower.concat(upper);

    if (hull.length < 3) {
      hulls.push({ cluster, points: capsule(points[0], points[1] ?? points[0]) });
      continue;
    }

    hulls.push({ cluster, points: expandHull(hull) });
  }

  hulls.sort((first, second) => first.cluster - second.cluster);
  return hulls;
}

function cross(first, second, third) {
  return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
}

function expandPoint(x, y, radius) {
  const padding = radius + 10;
  return Array.from({ length: 12 }, (_, index) => {
    const angle = Math.PI * 2 * index / 12;
    return [x + Math.cos(angle) * padding, y + Math.sin(angle) * padding];
  });
}

function capsule(first, second) {
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const angle = Math.atan2(dy, dx);
  const padding = Math.max(first[2], second[2]) + 10;
  const points = [];

  for (let index = 0; index <= 8; index += 1) {
    const current = angle - Math.PI / 2 + Math.PI * index / 8;
    points.push([second[0] + Math.cos(current) * padding, second[1] + Math.sin(current) * padding]);
  }

  for (let index = 0; index <= 8; index += 1) {
    const current = angle + Math.PI / 2 + Math.PI * index / 8;
    points.push([first[0] + Math.cos(current) * padding, first[1] + Math.sin(current) * padding]);
  }

  return points;
}

function expandHull(hull) {
  let centerX = 0;
  let centerY = 0;
  let maxRadius = 12;

  for (const [x, y, radius] of hull) {
    centerX += x;
    centerY += y;
    maxRadius = Math.max(maxRadius, radius + 10);
  }

  centerX /= hull.length;
  centerY /= hull.length;

  return hull.map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    return [x + dx / length * maxRadius, y + dy / length * maxRadius];
  });
}

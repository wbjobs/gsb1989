export class QuadTree {
  constructor(nodes, x, y, width, height) {
    this.nodes = nodes;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    this.midX = x + this.halfWidth;
    this.midY = y + this.halfHeight;
    this.nodeIndexes = [];
    this.children = null;
    this.mass = 0;
    this.cx = 0;
    this.cy = 0;
    this.maxRadius = 0;
  }

  static from(nodes, radii) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < nodes.length / 2; index += 1) {
      const x = nodes[index * 2];
      const y = nodes[index * 2 + 1];
      minX = Math.min(minX, x - radii[index]);
      minY = Math.min(minY, y - radii[index]);
      maxX = Math.max(maxX, x + radii[index]);
      maxY = Math.max(maxY, y + radii[index]);
    }

    if (!Number.isFinite(minX)) {
      minX = -1;
      minY = -1;
      maxX = 1;
      maxY = 1;
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const size = Math.max(width, height) * 1.05;
    const tree = new QuadTree(nodes, minX - (size - width) / 2, minY - (size - height) / 2, size, size);

    for (let index = 0; index < nodes.length / 2; index += 1) {
      tree.insert(index, radii[index] ?? 1);
    }

    tree.accumulate(radii);
    return tree;
  }

  quadrant(index) {
    const x = this.nodes[index * 2];
    const y = this.nodes[index * 2 + 1];
    const right = x >= this.midX;
    const bottom = y >= this.midY;
    return (bottom ? 2 : 0) + (right ? 1 : 0);
  }

  ensureChildren() {
    if (this.children) {
      return;
    }

    const childWidth = this.halfWidth;
    const childHeight = this.halfHeight;
    this.children = [
      new QuadTree(this.nodes, this.x, this.y, childWidth, childHeight),
      new QuadTree(this.nodes, this.midX, this.y, childWidth, childHeight),
      new QuadTree(this.nodes, this.x, this.midY, childWidth, childHeight),
      new QuadTree(this.nodes, this.midX, this.midY, childWidth, childHeight)
    ];
  }

  insert(index, radius, depth = 0) {
    if (this.nodeIndexes.length === 1 && !this.children && depth < 48) {
      const existing = this.nodeIndexes[0];
      this.nodeIndexes.length = 0;
      this.ensureChildren();

      if (this.quadrant(existing) === this.quadrant(index) && this.coincident(existing, index)) {
        this.nodeIndexes.push(existing, index);
      } else {
        this.children[this.quadrant(existing)].insert(existing, radius, depth + 1);
        this.children[this.quadrant(index)].insert(index, radius, depth + 1);
      }

      return;
    }

    if ((this.nodeIndexes.length > 1 || this.children) && depth < 48) {
      this.ensureChildren();
      const queuedIndexes = this.nodeIndexes;
      this.nodeIndexes = [];

      for (const queuedIndex of queuedIndexes) {
        this.children[this.quadrant(queuedIndex)].insert(queuedIndex, 1, depth + 1);
      }

      this.children[this.quadrant(index)].insert(index, radius, depth + 1);
      return;
    }

    this.nodeIndexes.push(index);
  }

  coincident(first, second) {
    return this.nodes[first * 2] === this.nodes[second * 2]
      && this.nodes[first * 2 + 1] === this.nodes[second * 2 + 1];
  }

  accumulate(radii) {
    if (this.children) {
      for (const child of this.children) {
        child.accumulate(radii);

        if (child.mass > 0) {
          const total = this.mass + child.mass;
          this.cx = (this.cx * this.mass + child.cx * child.mass) / total;
          this.cy = (this.cy * this.mass + child.cy * child.mass) / total;
          this.mass = total;
          this.maxRadius = Math.max(this.maxRadius, child.maxRadius);
        }
      }
    }

    for (const index of this.nodeIndexes) {
      const x = this.nodes[index * 2];
      const y = this.nodes[index * 2 + 1];
      const radius = radii[index] ?? 1;
      const total = this.mass + 1;
      this.cx = (this.cx * this.mass + x) / total;
      this.cy = (this.cy * this.mass + y) / total;
      this.mass = total;
      this.maxRadius = Math.max(this.maxRadius, radius);
    }
  }

  applyCharge(index, x, y, forces, theta2, strength) {
    if (!this.mass) {
      return;
    }

    const direct = this.nodeIndexes.length === 1 && this.nodeIndexes[0] === index && !this.children;

    if (direct) {
      return;
    }

    const dx = this.cx - x;
    const dy = this.cy - y;
    let distance2 = dx * dx + dy * dy;
    const far = (this.width * this.width) / Math.max(distance2, 1e-8) < theta2;

    if ((this.children && far) || (!this.children && this.nodeIndexes.length > 0)) {
      if (distance2 < 0.01) {
        distance2 = 0.01 + (index % 17) * 0.001;
      }

      const value = strength * this.mass / distance2;
      forces[0] += dx * value;
      forces[1] += dy * value;
      return;
    }

    if (this.children) {
      for (const child of this.children) {
        child.applyCharge(index, x, y, forces, theta2, strength);
      }
    }
  }

  applyCollision(index, x, y, radius, nodes, radii, positions) {
    if (!this.mass) {
      return;
    }

    const boundsDistance = radius + this.maxRadius;

    if (
      x < this.x - boundsDistance
      || x > this.x + this.width + boundsDistance
      || y < this.y - boundsDistance
      || y > this.y + this.height + boundsDistance
    ) {
      return;
    }

    if (this.children) {
      for (const child of this.children) {
        child.applyCollision(index, x, y, radius, nodes, radii, positions);
      }
    }

    for (const other of this.nodeIndexes) {
      if (other === index) {
        continue;
      }

      let dx = nodes[other * 2] - x;
      let dy = nodes[other * 2 + 1] - y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      const minimumDistance = radius + (radii[other] ?? radius);

      if (distance >= minimumDistance) {
        continue;
      }

      if (distance === 0) {
        dx = other % 2 ? 0.5 : -0.5;
        dy = other % 3 ? 0.5 : -0.5;
        distance = Math.sqrt(dx * dx + dy * dy);
      }

      const overlap = (minimumDistance - distance) / distance * 0.5;
      const adjustmentX = dx * overlap;
      const adjustmentY = dy * overlap;
      positions[index * 2] -= adjustmentX;
      positions[index * 2 + 1] -= adjustmentY;
      nodes[other * 2] += adjustmentX;
      nodes[other * 2 + 1] += adjustmentY;
    }
  }
}

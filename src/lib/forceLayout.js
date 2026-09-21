import { QuadTree } from './quadTree.js';
import { createRandom } from './random.js';

export class ForceLayout {
  constructor(nodeCount, edgeCount, links, clusters, options = {}) {
    this.nodeCount = nodeCount;
    this.edgeCount = edgeCount;
    this.links = links;
    this.clusters = clusters;
    this.positions = new Float64Array(nodeCount * 2);
    this.velocities = new Float64Array(nodeCount * 2);
    this.forces = new Float64Array(nodeCount * 2);
    this.radii = Float64Array.from({ length: nodeCount }, (_, index) => options.radii?.[index] ?? 7);
    this.pinned = new Uint8Array(nodeCount);
    this.alpha = options.alpha ?? 1;
    this.alphaTarget = options.alphaTarget ?? 0;
    this.alphaDecay = options.alphaDecay ?? 0.018;
    this.velocityDecay = options.velocityDecay ?? 0.28;
    this.chargeStrength = options.chargeStrength ?? -620;
    this.linkDistance = options.linkDistance ?? 34;
    this.linkStrength = options.linkStrength ?? 0.42;
    this.clusterStrength = options.clusterStrength ?? 0.12;
    this.collisionStrength = options.collisionStrength ?? 0.35;
    this.collisionMask = Math.max(7, 2 ** Math.ceil(Math.log2(Math.max(8, this.nodeCount * 2))) - 1);
    this.collisionHeads = new Int32Array(this.collisionMask + 1);
    this.collisionNext = new Int32Array(this.nodeCount);
    this.theta2 = options.theta2 ?? 0.81;
    this.tick = 0;
    this.random = createRandom(options.seed ?? 1);
    this.clusterCenters = new Float64Array((options.clusterCount ?? 1) * 2);
    this.clusterMasses = new Float64Array(options.clusterCount ?? 1);
    this.initializePositions(options.initialPositions);
  }

  initializePositions(initialPositions) {
    if (initialPositions && initialPositions.length === this.nodeCount * 2) {
      this.positions.set(initialPositions);
      return;
    }

    const columns = Math.ceil(Math.sqrt(this.nodeCount));
    const spacing = Math.max(28, this.linkDistance * 1.35);

    for (let index = 0; index < this.nodeCount; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      this.positions[index * 2] = (column - columns / 2) * spacing + (this.random() - 0.5) * spacing;
      this.positions[index * 2 + 1] = (row - columns / 2) * spacing + (this.random() - 0.5) * spacing;
    }
  }

  pin(index, x, y) {
    if (index < 0 || index >= this.nodeCount) {
      return;
    }

    this.pinned[index] = 1;
    this.positions[index * 2] = x;
    this.positions[index * 2 + 1] = y;
    this.velocities[index * 2] = 0;
    this.velocities[index * 2 + 1] = 0;
    this.alphaTarget = 0.32;
    this.alpha = Math.max(this.alpha, 0.38);
  }

  movePinned(index, x, y) {
    if (!this.pinned[index]) {
      return;
    }

    this.positions[index * 2] = x;
    this.positions[index * 2 + 1] = y;
  }

  release(index, x, y) {
    if (index < 0 || index >= this.nodeCount) {
      return;
    }

    this.pinned[index] = 0;

    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.positions[index * 2] = x;
      this.positions[index * 2 + 1] = y;
    }

    this.alphaTarget = 0;
    this.alpha = Math.max(this.alpha, 0.22);
  }

  reheat() {
    this.alpha = 1;
    this.alphaTarget = 0;
    this.tick = 0;
    this.velocities.fill(0);
  }

  updateClusters(clusters, clusterCount) {
    this.clusters = clusters;
    this.clusterCenters = new Float64Array(clusterCount * 2);
    this.clusterMasses = new Float64Array(clusterCount);
    this.reheat();
  }

  applyLinks() {
    for (let edge = 0; edge < this.edgeCount; edge += 1) {
      const source = this.links[edge * 2];
      const target = this.links[edge * 2 + 1];
      let dx = this.positions[target * 2] - this.positions[source * 2];
      let dy = this.positions[target * 2 + 1] - this.positions[source * 2 + 1];
      let distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 0.01) {
        dx = (this.random() - 0.5) * 2;
        dy = (this.random() - 0.5) * 2;
        distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      }

      const targetDistance = this.linkDistance * (this.radii[source] + this.radii[target]) / 14;
      const strength = this.linkStrength * this.alpha;
      const difference = (distance - targetDistance) / distance * strength * 0.5;
      const adjustmentX = dx * difference;
      const adjustmentY = dy * difference;
      this.forces[source * 2] += adjustmentX;
      this.forces[source * 2 + 1] += adjustmentY;
      this.forces[target * 2] -= adjustmentX;
      this.forces[target * 2 + 1] -= adjustmentY;
    }
  }

  updateClusterCenters() {
    this.clusterCenters.fill(0);
    this.clusterMasses.fill(0);

    for (let index = 0; index < this.nodeCount; index += 1) {
      const cluster = this.clusters[index] ?? 0;
      const weight = 1;
      this.clusterMasses[cluster] += weight;
      this.clusterCenters[cluster * 2] += this.positions[index * 2] * weight;
      this.clusterCenters[cluster * 2 + 1] += this.positions[index * 2 + 1] * weight;
    }

    for (let cluster = 0; cluster < this.clusterMasses.length; cluster += 1) {
      if (this.clusterMasses[cluster] > 0) {
        this.clusterCenters[cluster * 2] /= this.clusterMasses[cluster];
        this.clusterCenters[cluster * 2 + 1] /= this.clusterMasses[cluster];
      }
    }
  }

  applyClusterForce() {
    this.updateClusterCenters();
    const strength = this.clusterStrength * this.alpha;

    for (let index = 0; index < this.nodeCount; index += 1) {
      const cluster = this.clusters[index] ?? 0;
      this.forces[index * 2] += (this.clusterCenters[cluster * 2] - this.positions[index * 2]) * strength;
      this.forces[index * 2 + 1] += (this.clusterCenters[cluster * 2 + 1] - this.positions[index * 2 + 1]) * strength;
    }
  }

  applyCenter() {
    if (!this.nodeCount) {
      return;
    }

    let centerX = 0;
    let centerY = 0;

    for (let index = 0; index < this.nodeCount; index += 1) {
      centerX += this.positions[index * 2];
      centerY += this.positions[index * 2 + 1];
    }

    centerX /= this.nodeCount;
    centerY /= this.nodeCount;
    const strength = 0.025 + this.alpha * 0.04;

    for (let index = 0; index < this.nodeCount; index += 1) {
      this.forces[index * 2] += -centerX * strength;
      this.forces[index * 2 + 1] += -centerY * strength;
    }
  }

  step() {
    this.forces.fill(0);

    if (!this.nodeCount) {
      this.alpha = 0;
      this.alphaTarget = 0;
      this.tick += 1;
      return;
    }

    this.applyLinks();

    const tree = QuadTree.from(this.positions, this.radii);
    const chargeBuffer = new Float64Array(2);

    for (let index = 0; index < this.nodeCount; index += 1) {
      chargeBuffer[0] = 0;
      chargeBuffer[1] = 0;
      tree.applyCharge(
        index,
        this.positions[index * 2],
        this.positions[index * 2 + 1],
        chargeBuffer,
        this.theta2,
        this.chargeStrength
      );
      this.forces[index * 2] += chargeBuffer[0] * this.alpha;
      this.forces[index * 2 + 1] += chargeBuffer[1] * this.alpha;
    }

    this.applyClusterForce();
    this.applyCenter();

    const damping = 1 - this.velocityDecay;

    for (let index = 0; index < this.nodeCount; index += 1) {
      if (this.pinned[index]) {
        this.velocities[index * 2] = 0;
        this.velocities[index * 2 + 1] = 0;
        continue;
      }

      this.velocities[index * 2] = (this.velocities[index * 2] + this.forces[index * 2]) * damping;
      this.velocities[index * 2 + 1] = (this.velocities[index * 2 + 1] + this.forces[index * 2 + 1]) * damping;

      const speed2 = this.velocities[index * 2] ** 2 + this.velocities[index * 2 + 1] ** 2;
      if (speed2 > 14400) {
        const scale = 120 / Math.sqrt(speed2);
        this.velocities[index * 2] *= scale;
        this.velocities[index * 2 + 1] *= scale;
      }

      this.positions[index * 2] += this.velocities[index * 2];
      this.positions[index * 2 + 1] += this.velocities[index * 2 + 1];
    }

    this.applyCollisions();

    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    this.tick += 1;
  }

  applyCollisions() {
    this.collisionHeads.fill(-1);
    let maximumRadius = this.radii[0] ?? 8;
    for (let index = 1; index < this.nodeCount; index += 1) {
      maximumRadius = Math.max(maximumRadius, this.radii[index]);
    }
    const cellSize = Math.max(20, maximumRadius * 2 + 2);

    for (let index = 0; index < this.nodeCount; index += 1) {
      const cellX = Math.floor(this.positions[index * 2] / cellSize);
      const cellY = Math.floor(this.positions[index * 2 + 1] / cellSize);
      const key = (cellX * 73856093 ^ cellY * 19349663) & this.collisionMask;
      this.collisionNext[index] = this.collisionHeads[key];
      this.collisionHeads[key] = index;
    }

    for (let index = 0; index < this.nodeCount; index += 1) {
      if (this.pinned[index]) {
        continue;
      }

      const cellX = Math.floor(this.positions[index * 2] / cellSize);
      const cellY = Math.floor(this.positions[index * 2 + 1] / cellSize);

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const key = ((cellX + offsetX) * 73856093 ^ (cellY + offsetY) * 19349663) & this.collisionMask;
          let other = this.collisionHeads[key];

          while (other !== -1) {
            if (other !== index) {
              let dx = this.positions[other * 2] - this.positions[index * 2];
              let dy = this.positions[other * 2 + 1] - this.positions[index * 2 + 1];
              let distance = Math.sqrt(dx * dx + dy * dy);
              const minimumDistance = this.radii[index] + this.radii[other];

              if (distance < minimumDistance) {
                if (distance === 0) {
                  dx = (other % 2 ? 1 : -1) * 0.5;
                  dy = (other % 3 ? 1 : -1) * 0.5;
                  distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
                }

                const ratio = this.pinned[other] ? 1 : 0.5;
                const overlap = (minimumDistance - distance) / distance * ratio * this.collisionStrength;
                const adjustmentX = dx * overlap;
                const adjustmentY = dy * overlap;
                this.positions[index * 2] -= adjustmentX;
                this.positions[index * 2 + 1] -= adjustmentY;

                if (!this.pinned[other]) {
                  this.positions[other * 2] += adjustmentX;
                  this.positions[other * 2 + 1] += adjustmentY;
                }
              }
            }

            other = this.collisionNext[other];
          }
        }
      }
    }
  }

  get stable() {
    if (this.alpha > 0.025 || this.alphaTarget > 0.01) {
      return false;
    }

    for (let index = 0; index < this.nodeCount; index += 1) {
      const speed2 = this.velocities[index * 2] ** 2 + this.velocities[index * 2 + 1] ** 2;
      if (speed2 > 0.02) {
        return false;
      }
    }

    return true;
  }

  snapshotPositions() {
    return Float32Array.from(this.positions);
  }
}

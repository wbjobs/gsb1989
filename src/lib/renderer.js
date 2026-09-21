const PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'
];

export class GraphRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    if (!this.context) {
      throw new Error('当前浏览器不支持 Canvas 2D');
    }
    this.view = { x: 0, y: 0, scale: 1 };
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.width = rect.width;
    this.height = rect.height;
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.width / 2) / this.view.scale + this.view.x,
      y: (y - this.height / 2) / this.view.scale + this.view.y
    };
  }

  fit(positions, padding = 90) {
    if (!positions.length) {
      this.view = { x: 0, y: 0, scale: 1 };
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < positions.length / 2; index += 1) {
      minX = Math.min(minX, positions[index * 2]);
      minY = Math.min(minY, positions[index * 2 + 1]);
      maxX = Math.max(maxX, positions[index * 2]);
      maxY = Math.max(maxY, positions[index * 2 + 1]);
    }

    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    this.view.x = (minX + maxX) / 2;
    this.view.y = (minY + maxY) / 2;
    this.view.scale = Math.min(
      2,
      Math.max(0.08, Math.min((this.width - padding * 2) / graphWidth, (this.height - padding * 2) / graphHeight))
    );
  }

  zoom(nextZoom, centerX = this.width / 2, centerY = this.height / 2) {
    const before = this.screenToWorld(centerX, centerY);
    this.view.scale = Math.min(3, Math.max(0.06, nextZoom));
    const after = this.screenToWorld(centerX, centerY);
    this.view.x += before.x - after.x;
    this.view.y += before.y - after.y;
  }

  findNode(worldX, worldY, positions, radii, hovered = -1) {
    let best = -1;
    let bestDistance = Infinity;

    for (let index = positions.length / 2 - 1; index >= 0; index -= 1) {
      const dx = positions[index * 2] - worldX;
      const dy = positions[index * 2 + 1] - worldY;
      const radius = (radii?.[index] ?? 7) + 4;
      const distance2 = dx * dx + dy * dy;

      if (distance2 <= radius * radius && distance2 < bestDistance) {
        best = index;
        bestDistance = distance2;
      }
    }

    return hovered >= 0 && best === -1 ? hovered : best;
  }

  draw(state, options = {}) {
    if (!this.context || !state?.positions) {
      return;
    }

    const ctx = this.context;
    const positions = state.positions;
    const links = state.links;
    const clusters = state.clusters;
    const radii = state.radii;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid(ctx);
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.translate(-this.view.x, -this.view.y);

    if (options.showClusters !== false && state.hulls) {
      this.drawHulls(ctx, state.hulls);
    }

    this.drawEdges(ctx, positions, links);
    this.drawNodes(ctx, positions, clusters, radii, options);
    ctx.restore();
  }

  drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgb(100 116 139 / 10%)';
    ctx.lineWidth = 1;
    const size = 24;

    for (let x = 0; x < this.width; x += size) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    for (let y = 0; y < this.height; y += size) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawHulls(ctx, hulls) {
    ctx.save();

    for (const hull of hulls) {
      const color = clusterColor(hull.cluster);
      ctx.beginPath();
      hull.points.forEach(([x, y], index) => {
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = `${color}14`;
      ctx.strokeStyle = `${color}55`;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  drawEdges(ctx, positions, links) {
    if (!links?.length) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = 'rgb(71 85 105 / 24%)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();

    for (let edge = 0; edge < links.length / 2; edge += 1) {
      const source = links[edge * 2];
      const target = links[edge * 2 + 1];
      ctx.moveTo(positions[source * 2], positions[source * 2 + 1]);
      ctx.lineTo(positions[target * 2], positions[target * 2 + 1]);
    }

    ctx.stroke();
    ctx.restore();
  }

  drawNodes(ctx, positions, clusters, radii, options) {
    const count = positions.length / 2;
    const showLabels = this.view.scale > 0.82 || count <= 250;
    const labelsById = new Map();

    if (showLabels) {
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.textBaseline = 'middle';
    }

    for (let cluster = 0; cluster < (options.clusterCount ?? 10); cluster += 1) {
      ctx.save();
      ctx.fillStyle = clusterColor(cluster);
      ctx.beginPath();

      for (let index = 0; index < count; index += 1) {
        if ((clusters?.[index] ?? 0) !== cluster) {
          continue;
        }

        const radius = radii?.[index] ?? 6;
        ctx.moveTo(positions[index * 2] + radius, positions[index * 2 + 1]);
        ctx.arc(positions[index * 2], positions[index * 2 + 1], radius, 0, Math.PI * 2);
      }

      ctx.fill();
      ctx.restore();
    }

    if (options.hovered >= 0 || options.dragging >= 0) {
      const index = options.dragging >= 0 ? options.dragging : options.hovered;
      ctx.save();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(positions[index * 2], positions[index * 2 + 1], (radii?.[index] ?? 6) + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (showLabels) {
      for (let index = 0; index < count; index += 1) {
        const label = options.nodes?.[index]?.label ?? String(index + 1);
        if (index === options.hovered || index === options.dragging || count <= 250) {
          labelsById.set(index, label);
        }
      }

      ctx.save();
      ctx.fillStyle = '#334155';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 3;

      for (const [index, label] of labelsById) {
        ctx.fillText(label, positions[index * 2] + (radii?.[index] ?? 6) + 4, positions[index * 2 + 1]);
      }

      ctx.restore();
    }
  }
}

export function clusterColor(cluster) {
  return PALETTE[cluster % PALETTE.length];
}

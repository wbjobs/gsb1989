# 力导向图可视化（Canvas + Web Worker + IndexedDB）

纯前端、零依赖的力导向图 demo：力导向布局在 Web Worker 中计算，Canvas 渲染，
IndexedDB 缓存布局结果，并具备完整的异常降级链路。

## 运行

```bash
npm run serve        # python3 -m http.server 8000
# 打开 http://localhost:8000
```

需要 HTTP 环境（ES Module 与 Worker 不支持 file:// 协议）。

## 验证

```bash
npm run verify       # 无头验证模拟核心（Node.js）
```

覆盖：布局收敛、Barnes-Hut 加速生效、坐标有限性、聚类准确率（>80%，实测 ~99%）、
拖拽固定、5000 节点收敛性能（实测 ~4.5s）。

## 架构

- `src/worker.js` — 力导向模拟：Barnes-Hut 四叉树斥力 O(n log n) + 弹簧引力 +
  标签传播聚类；alpha 衰减收敛，热启动（reheat）支持
- `src/main.js` — 主线程：Canvas 渲染（DPR 感知）、指针交互（拖拽/平移/缩放）、
  Worker 通信、FPS 统计
- `src/db.js` — IndexedDB 布局持久化，失败时降级为 no-op
- `src/graph.js` — 带真实簇结构的随机图生成（种子可复现）

## 验收标准对照

| 标准 | 实现 |
| --- | --- |
| 布局稳定 | alpha 衰减 + 收敛阈值，稳定后自动停止并持久化布局 |
| 拖拽流畅 | 拖拽消息直发 Worker 固定节点，主线程本地乐观更新，渲染不阻塞 |
| 聚类正确 | 标签传播算法，对生成图的真实簇准确率 >80%（实测 ~99%） |
| 性能可接受 | Barnes-Hut 四叉树 + TypedArray + 热态多步快进；5000 节点约 4.5s 收敛 |
| 异常有降级 | Worker 不可用→主线程模拟；四叉树异常→O(n²)；IndexedDB 不可用→跳过持久化；运行时错误→toast 提示 |

## 交互

- 拖拽节点：固定该节点并局部重热布局
- 空白拖动：平移；滚轮：以光标为中心缩放
- 「重新布局」：reheat；「清除缓存」：删除 IndexedDB 中缓存的布局

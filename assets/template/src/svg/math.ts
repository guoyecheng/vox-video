/**
 * SVG 动效的几何层：全是纯函数，没有 React、没有 remotion、没有浏览器 API。
 *
 * 抽出来的理由有两个：一是这些形状（毛边、撕裂接缝、折角、墨迹）决定成片里
 * 是否露底、是否留缝，静态代码看不出来，必须有断言盯着；二是 node 套件要能
 * 直接 bundle 这一个文件跑，所以这里连 `hash01` 都是从 paper.tsx 搬过来的
 * 单一实现，而不是两处各写一份。
 *
 * 所有随机量走 `hash01`，同 seed 同帧可复现；进度全部经 `clamp01`，
 * 空词流 / 缺字段时最坏退化成 0，不会让属性变成 `NaN` 把整块内容渲染没。
 */

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** 确定性的伪随机：[0,1)。公式与 paper.tsx 原实现逐位一致，改它等于换底纸纹理。 */
export const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** 夹到 [0,1]。`NaN` 也归 0——属性里出现 NaN 会让整块 SVG 不渲染。 */
export const clamp01 = (v: number) => (v > 0 ? (v > 1 ? 1 : v) : 0);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const pathFromPoints = (pts: Pt[], close = false) => {
  const d = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  return close ? `${d} Z` : d;
};

export const bezierPoint = (p0: Pt, p1: Pt, p2: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
};

/** 未归一化的切线（导数）。调用方自己 `atan2` 取角度。 */
export const bezierTangent = (p0: Pt, p1: Pt, p2: Pt, t: number): Pt => ({
  x: 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
  y: 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
});

/** 同点数多边形插值。点数不等是调用方的错——组形状时就得对齐点数。 */
export const morphPolygon = (a: Pt[], b: Pt[], t: number): Pt[] => {
  if (a.length !== b.length) {
    throw new Error(`morphPolygon 点数不一致：${a.length} vs ${b.length}`);
  }
  return a.map((p, i) => ({ x: lerp(p.x, b[i]!.x, t), y: lerp(p.y, b[i]!.y, t) }));
};

/** 沿四条边按步长采样，只沿法线抖动，顺时针闭合。与 `roughEdge` 的观感同源。 */
export const roughRect = (box: Box, seed: number, amp = 2.4, step = 8): Pt[] => {
  const s = Math.max(1, step);
  const nx = Math.max(2, Math.round(box.w / s));
  const ny = Math.max(2, Math.round(box.h / s));
  const out: Pt[] = [];
  let k = 0;
  const jit = () => ((hash01(seed + k++ * 7.13) - 0.5) * 2 * amp);
  for (let i = 0; i <= nx; i++) out.push({ x: box.x + (box.w * i) / nx, y: box.y + jit() });
  for (let i = 1; i <= ny; i++) {
    out.push({ x: box.x + box.w + jit(), y: box.y + (box.h * i) / ny });
  }
  for (let i = 1; i <= nx; i++) {
    out.push({ x: box.x + box.w - (box.w * i) / nx, y: box.y + box.h + jit() });
  }
  for (let i = 1; i < ny; i++) out.push({ x: box.x + jit(), y: box.y + box.h - (box.h * i) / ny });
  return out;
};

/**
 * 撕纸接缝：一条横贯画面的锯齿线，把盒子切成互补的两块。
 *
 * 两块**共用同一组接缝点**，所以面积和恒等于盒面积——这是"不重叠、不留缝"
 * 的充要条件，也是套件里唯一可靠的判据（拿 y 区间比会误判，锯齿本来就相交）。
 * 起伏幅度乘 `sin(πp)`，两端退化成直线：p=0/p=1 时被撕开的那一侧面积精确为 0，
 * 不会在画幅边上留一条锯齿毛刺。
 */
export const tearSplit = (
  box: Box,
  seed: number,
  p: number,
  opts: { from?: "bottom" | "left"; amp?: number; step?: number } = {},
): { revealed: Pt[]; covered: Pt[] } => {
  const { from = "bottom", amp = 18, step = 26 } = opts;
  const c = clamp01(p);
  const ampEff = amp * Math.sin(Math.PI * c);
  const s = Math.max(2, step);

  if (from === "left") {
    const seamX = box.x + box.w * c;
    const n = Math.max(2, Math.round(box.h / s));
    const seam: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const x = seamX + (hash01(seed + i * 5.37) - 0.5) * 2 * ampEff;
      seam.push({ x: Math.min(box.x + box.w, Math.max(box.x, x)), y: box.y + (box.h * i) / n });
    }
    return {
      revealed: [...seam, { x: box.x + box.w, y: box.y + box.h }, { x: box.x + box.w, y: box.y }],
      covered: [
        { x: box.x, y: box.y },
        { x: box.x, y: box.y + box.h },
        ...seam.slice().reverse(),
      ],
    };
  }

  const seamY = box.y + box.h * (1 - c);
  const n = Math.max(2, Math.round(box.w / s));
  const seam: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const y = seamY + (hash01(seed + i * 5.37) - 0.5) * 2 * ampEff;
    seam.push({ x: box.x + (box.w * i) / n, y: Math.min(box.y + box.h, Math.max(box.y, y)) });
  }
  return {
    revealed: [...seam, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }],
    covered: [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      ...seam.slice().reverse(),
    ],
  };
};

/** 保留半平面 `x - y <= c` 的部分（Sutherland–Hodgman，单条边）。 */
const clipHalfPlane = (poly: Pt[], c: number): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = a.x - a.y - c;
    const db = b.x - b.y - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
};

/**
 * 掀纸：一条 45° 折线从右上角推进到左下角，切掉已经翻过去的部分。
 *
 * 行程必须是 `w + h` 而不是对角线长度：折线是 `x - y = cutX`，只有走到
 * `cutX = box.x - box.h` 时它才穿过左下角，p=1 时剩余面积精确为 0。
 * 少走一截会在末帧留下一块永远盖着底层内容的三角形——这是 demo 里真实
 * 踩过的 bug。
 *
 * 返回的是**裁到盒内**的多边形，不是原始的大三角形：原始多边形会伸出画外
 * 几千 px，面积没法和进度对应，也不适合直接当 clipPath。
 */
export const peelPolygon = (
  box: Box,
  p: number,
  opts: { corner?: "tr" } = {},
): { remain: Pt[]; crease: [Pt, Pt] } => {
  void opts.corner;
  const travel = clamp01(p) * (box.w + box.h);
  const cutX = box.x + box.w - travel;
  const rect: Pt[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  const remain = clipHalfPlane(rect, cutX - box.y);

  // 折痕 = 折线与盒边的交点。p→0 / p→1 时只剩一个交点，退化成一个点。
  const c = cutX - box.y;
  const hits: Pt[] = [];
  const inX = (x: number) => x >= box.x - 1e-9 && x <= box.x + box.w + 1e-9;
  const inY = (y: number) => y >= box.y - 1e-9 && y <= box.y + box.h + 1e-9;
  const atTop = { x: c + box.y, y: box.y };
  const atBottom = { x: c + box.y + box.h, y: box.y + box.h };
  const atLeft = { x: box.x, y: box.x - c };
  const atRight = { x: box.x + box.w, y: box.x + box.w - c };
  if (inX(atTop.x)) hits.push(atTop);
  if (inX(atBottom.x)) hits.push(atBottom);
  if (inY(atLeft.y)) hits.push(atLeft);
  if (inY(atRight.y)) hits.push(atRight);
  const first = hits[0] ?? { x: cutX + box.y, y: box.y };
  const second = hits[1] ?? atTop;
  return { remain, crease: [first, second] };
};

/** 墨迹：极坐标等分，半径随进度线性涨、按 seed 抖动，边缘才像洇出来的。 */
export const inkBlob = (
  cx: number,
  cy: number,
  r: number,
  seed: number,
  p: number,
  points = 28,
): Pt[] => {
  const radius = r * clamp01(p);
  const out: Pt[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = radius * (0.78 + 0.44 * hash01(seed * 13 + i));
    out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return out;
};

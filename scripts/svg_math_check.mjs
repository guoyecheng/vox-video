/**
 * svg/math.ts 的 node 套件（无第三方依赖）。
 *
 * 由 selftest.py 调用：先 esbuild bundle math.ts，再把 bundle 路径传进来。
 * 盯的是几何语义，不是实现写法——这些函数决定撕纸接缝是否露底、掀起是否
 * 真的掀完、墨迹是否随进度单调扩散。任何一条错了，成片里是肉眼可见的破绽，
 * 但在静态代码里看不出来。
 *
 *   node scripts/svg_math_check.mjs <math.bundle.mjs>
 */

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("用法: node scripts/svg_math_check.mjs <math.bundle.mjs>");
  process.exit(2);
}

const M = await import(pathToFileURL(path.resolve(bundlePath)).href);

let n = 0;
const ok = (name, fn) => {
  fn();
  n += 1;
  console.log(`  ✓ ${name}`);
};

const box = { x: 100, y: 200, w: 800, h: 400 };

const area = (pts) =>
  Math.abs(
    pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + (p.x * q.y - q.x * p.y);
    }, 0),
  ) / 2;

const near = (a, b, eps) => Math.abs(a - b) <= eps;

ok("hash01 落在 [0,1) 且可复现", () => {
  for (const i of [0, 1, 7, 1e6, -3]) {
    const v = M.hash01(i);
    assert.ok(v >= 0 && v < 1, `hash01(${i})=${v}`);
    assert.equal(v, M.hash01(i));
  }
});

ok("roughRect 点数固定，且每个点都贴着盒边", () => {
  const a = M.roughRect(box, 3, 3);
  const b = M.roughRect(box, 3, 3);
  assert.deepEqual(a, b, "同 seed 必须同结果");
  assert.ok(a.length >= 12);
  for (const p of a) {
    const onX =
      Math.abs(p.x - box.x) <= 3.001 || Math.abs(p.x - (box.x + box.w)) <= 3.001;
    const onY =
      Math.abs(p.y - box.y) <= 3.001 || Math.abs(p.y - (box.y + box.h)) <= 3.001;
    assert.ok(onX || onY, `点 ${JSON.stringify(p)} 不在边上`);
  }
});

ok("morphPolygon 两端精确、长度不等抛错", () => {
  const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const b = [{ x: 5, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 20 }];
  assert.deepEqual(M.morphPolygon(a, b, 0), a);
  assert.deepEqual(M.morphPolygon(a, b, 1), b);
  assert.deepEqual(M.morphPolygon(a, b, 0.5)[1], { x: 15, y: 2.5 });
  assert.throws(() => M.morphPolygon(a, b.slice(1), 0.5));
});

ok("bezierPoint 端点与中点正确，切线在顶点水平", () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 50, y: 100 };
  const p2 = { x: 100, y: 0 };
  assert.deepEqual(M.bezierPoint(p0, p1, p2, 0), { x: 0, y: 0 });
  assert.deepEqual(M.bezierPoint(p0, p1, p2, 1), { x: 100, y: 0 });
  assert.deepEqual(M.bezierPoint(p0, p1, p2, 0.5), { x: 50, y: 50 });
  // 抛物线顶点切线是水平的：y 分量为 0，x 分量为正（向右）
  const t = M.bezierTangent(p0, p1, p2, 0.5);
  assert.ok(Math.abs(t.y) < 1e-9, `切线 y 应为 0，实得 ${t.y}`);
  assert.ok(t.x > 0, `切线 x 应为正，实得 ${t.x}`);
});

ok("tearSplit: 两半互补，任意 p 都不重叠不留缝", () => {
  const A = box.w * box.h;
  for (const p of [0, 0.13, 0.5, 0.77, 1]) {
    const { revealed, covered } = M.tearSplit(box, 11, p);
    const sum = area(revealed) + area(covered);
    // 接缝共享同一组点时，两块面积之和恒等于盒面积：重叠会偏小，留缝也会偏小，
    // 只有严丝合缝才精确相等。比"y 区间不交"更严——锯齿接缝的 y 区间本来就相交。
    assert.ok(near(sum, A, A * 1e-9), `p=${p} 面积和 ${sum} ≠ ${A}`);
    // 所有接缝点必须留在盒内，否则撕口会戳出画幅
    for (const q of [...revealed, ...covered]) {
      assert.ok(
        q.x >= box.x - 1e-6 && q.x <= box.x + box.w + 1e-6 &&
          q.y >= box.y - 1e-6 && q.y <= box.y + box.h + 1e-6,
        `p=${p} 点 ${JSON.stringify(q)} 出框`,
      );
    }
  }
  assert.ok(area(M.tearSplit(box, 11, 0).revealed) < 1e-6, "p=0 时下半区面积应为 0");
  assert.ok(area(M.tearSplit(box, 11, 1).covered) < 1e-6, "p=1 时上半区面积应为 0");
  // 接缝在中间必须真的锯起来，否则"撕裂"读作"擦除"
  const seamY = (p) => {
    const { revealed } = M.tearSplit(box, 11, p);
    const ys = revealed.map((q) => q.y).filter((y) => y < box.y + box.h - 1);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(seamY(0.5) > 6, `p=0.5 接缝起伏 ${seamY(0.5)}px，太小`);
});

ok("peelPolygon: p=1 剩余面积为 0，p=0 完整，折痕在对角上", () => {
  assert.ok(area(M.peelPolygon(box, 1).remain) < 1, "p=1 应完全掀起");
  assert.ok(area(M.peelPolygon(box, 0).remain) > box.w * box.h * 0.99, "p=0 应完整");
  const { remain, crease } = M.peelPolygon(box, 0.5);
  assert.equal(crease.length, 2);
  assert.ok(remain.length >= 4);
  // 折痕两端必须落在盒边上（哪条边取决于进度），否则会画出一条悬空的线
  const [a, b] = crease;
  const onEdge = (p) =>
    near(p.y, box.y, 1e-6) ||
    near(p.y, box.y + box.h, 1e-6) ||
    near(p.x, box.x, 1e-6) ||
    near(p.x, box.x + box.w, 1e-6);
  assert.ok(onEdge(a) && onEdge(b), `折痕端点不在边上：${JSON.stringify(crease)}`);
});

ok("inkBlob: 半径随 p 单调、同 seed 可复现", () => {
  const r = (p) =>
    Math.max(
      ...M.inkBlob(500, 500, 200, 7, p).map((q) => Math.hypot(q.x - 500, q.y - 500)),
    );
  assert.ok(r(0.2) < r(0.6) && r(0.6) < r(1));
  assert.deepEqual(M.inkBlob(500, 500, 200, 7, 0.5), M.inkBlob(500, 500, 200, 7, 0.5));
  assert.ok(r(0) < 1e-6, "p=0 时墨迹应为空");
});

ok("pathFromPoints 生成合法 d", () => {
  assert.equal(M.pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 5 }]), "M 0 0 L 10 5");
  assert.equal(
    M.pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 5 }], true),
    "M 0 0 L 10 5 Z",
  );
});

console.log(`svg math: ${n} 条通过`);

/**
 * resolveWordTimings 的 node 套件（无第三方依赖）。
 *
 * 由 selftest.py 调用：先 esbuild bundle words.ts，再把 bundle 路径传进来。
 * 盯的是那条最隐蔽的契约——上屏词按旁白的标点切，词流里却没有标点，
 * 两侧必须都剥掉标点再比，否则整句退回"均匀铺开"，每个镜头开头空半秒。
 *
 *   node scripts/words_check.mjs <words.bundle.mjs>
 */

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("用法: node scripts/words_check.mjs <words.bundle.mjs>");
  process.exit(2);
}

const mod = await import(pathToFileURL(path.resolve(bundlePath)).href);
const { resolveWordTimings, splitByEmphasis } = mod;

let n = 0;
const ok = (name, fn) => {
  fn();
  n += 1;
  console.log(`  ✓ ${name}`);
};

/* 1. 真实 edge-tts 词流：词不带标点，上屏词带标点 */
ok("带标点的从句落在首词上", () => {
  const words = [
    { t: 3, d: 5, text: "有" },
    { t: 8, d: 8, text: "一种" },
    { t: 17, d: 19, text: "三角形" },
    { t: 44, d: 13, text: "宽度" },
    { t: 58, d: 11, text: "处处" },
    { t: 69, d: 10, text: "相等" },
    { t: 95, d: 12, text: "做成" },
    { t: 107, d: 7, text: "井" },
    { t: 114, d: 6, text: "盖" },
    { t: 132, d: 5, text: "也" },
    { t: 137, d: 6, text: "掉" },
    { t: 143, d: 2, text: "不" },
    { t: 145, d: 12, text: "下去" },
  ];
  const t = resolveWordTimings(
    ["有一种三角形，", "宽度处处相等。", "做成井盖，", "也掉不下去。"],
    words,
  );
  assert.deepEqual(
    t.map((x) => Math.round(x.t)),
    [3, 44, 95, 132],
    `从句起点必须等于首词时间戳，实际 ${t.map((x) => x.t)}`,
  );
});

/* 2. 亚词级：上屏词跨两个 boundary 时取第一个 boundary 内部的比例 */
ok("跨 boundary 的上屏词取内部分数", () => {
  const words = [
    { t: 0, d: 10, text: "47" },
    { t: 10, d: 10, text: "年" },
  ];
  const [a] = resolveWordTimings(["47年"], words);
  assert.equal(Math.round(a.t), 0);
  assert.ok(a.d > 0, "时长不能是 0");
});

/* 3. 数字的中文写法要能匹配上（StatCard 的卡点靠它） */
ok("阿拉伯数字匹配中文读法", () => {
  const words = [
    { t: 0, d: 8, text: "全世界" },
    { t: 8, d: 8, text: "只有" },
    { t: 16, d: 10, text: "两百" },
    { t: 26, d: 8, text: "户" },
  ];
  const [probe] = resolveWordTimings(["200"], words);
  assert.equal(Math.round(probe.t), 16, "200 应落在「两百」上");
});

/* 4. 旁白里真没有的项：在 fallbackSpan 上均匀铺开，且不早于 0 */
ok("未匹配项按区间铺开", () => {
  const words = [
    { t: 0, d: 10, text: "旁白" },
    { t: 20, d: 10, text: "只有这些" },
  ];
  const t = resolveWordTimings(["卡片标题", "另一个标题"], words, 120);
  assert.equal(t.length, 2);
  assert.ok(t[0].t > 0 && t[1].t > t[0].t, "铺开应递增且不压在 0 帧");
  assert.ok(t[1].t < 120, "不能铺到 beat 外");
});

/* 5. 没有词级时间戳：按固定节奏铺，供无声拍兜底 */
ok("无声拍按 13.5 帧铺开", () => {
  const t = resolveWordTimings(["一", "二", "三"], []);
  assert.deepEqual(t.map((x) => x.t), [0, 14, 27]);
});

/* 6. 纯标点项不吃匹配游标，后面的项仍能对上 */
ok("纯标点项不破坏后续匹配", () => {
  const words = [
    { t: 0, d: 10, text: "第一" },
    { t: 30, d: 10, text: "第二" },
  ];
  const t = resolveWordTimings(["。", "第二"], words);
  assert.equal(Math.round(t[1].t), 30);
});

/* 7. 纸片字只贴强调短语本身，"是几何"里只有"几何"该变成纸片 */
ok("强调短语从从句里切出来", () => {
  const parts = splitByEmphasis("是几何", ["几何"]);
  assert.deepEqual(parts, [
    { text: "是", hot: false },
    { text: "几何", hot: true },
  ]);
});

/* 8. 整段没命中任何强调词：交回普通片段，由组件决定退回"整段强调" */
ok("没命中时整段为普通片段", () => {
  const parts = splitByEmphasis("成本最低", ["几何"]);
  assert.deepEqual(parts, [{ text: "成本最低", hot: false }]);
});

/* 9. 强调词互相包含时按长的切："最便宜"不能被切成"最"+"便宜" */
ok("最长优先，不会被短词切开", () => {
  const parts = splitByEmphasis("只是最便宜", ["最", "最便宜"]);
  assert.deepEqual(parts, [
    { text: "只是", hot: false },
    { text: "最便宜", hot: true },
  ]);
});

/* 10. 多个强调词 + 标点：标点必须留在普通片段里，不能被贴到纸上 */
ok("多个强调词之间保留标点", () => {
  const parts = splitByEmphasis("只是最便宜、最省事。", ["最便宜", "最省事"]);
  assert.deepEqual(parts, [
    { text: "只是", hot: false },
    { text: "最便宜", hot: true },
    { text: "、", hot: false },
    { text: "最省事", hot: true },
    { text: "。", hot: false },
  ]);
});

/* 11. 没配强调词时零成本直通 */
ok("无强调词直通", () => {
  assert.deepEqual(splitByEmphasis("随便一段话"), [{ text: "随便一段话", hot: false }]);
});

console.log(`[words] ${n} 组断言通过`);

/**
 * computeShots 的 node 测试套件（无第三方依赖，跑在 node:assert 上）。
 *
 * 由 selftest.py 的子套件调用：先 esbuild bundle shots.ts，再传 bundle 路径进来。
 * 这里只动态 import bundle 的导出，其余全是纯断言。
 *
 *   node scripts/shots_check.mjs <shots.bundle.mjs>
 */

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("用法: node scripts/shots_check.mjs <shots.bundle.mjs>");
  process.exit(2);
}

const mod = await import(pathToFileURL(path.resolve(bundlePath)).href);
const { computeShots } = mod;

// 与 recipes.ts 的 ORDER 一致——bundle 里若换了表，这里的期望值会立刻对不上。
const ORDER = ["stamp", "build", "wipe", "rise", "drift"];

const beat = (visual, words, narration, durationInFrames = 120) => ({
  id: "b",
  from: 0,
  durationInFrames,
  audioFrom: 6,
  transition: "none",
  transitionFrames: 0,
  narration,
  words,
  visual,
});

const kinetic = (extra = {}) => ({ kind: "kinetic", ...extra });

let n = 0;
const ok = (name, fn) => {
  fn();
  n += 1;
  console.log(`  ✓ ${name}`);
};

/* 1. 空 words → 单镜头兜底 */
ok("空 words 单镜头兜底", () => {
  const shots = computeShots(beat(kinetic(), [], ""), 0, 30);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[0].durationInFrames, 120);
  assert.deepEqual(shots[0].words, []);
  assert.equal(shots[0].transition, "cut");
});

/* 2. 无标点单句 → 1 shot */
ok("无标点单句不拆", () => {
  const words = [
    { t: 0, d: 15, text: "圆形井盖" },
    { t: 20, d: 15, text: "为什么不会掉" },
  ];
  const shots = computeShots(beat(kinetic(), words, "圆形井盖为什么不会掉"), 0, 30);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[0].durationInFrames, 120);
});

/* 3. 两句各 ≥1.5s → 2 shots，边界在第二句首词 */
ok("两句按从句边界拆", () => {
  const words = [
    { t: 0, d: 15, text: "第一句" },
    { t: 20, d: 15, text: "说完了。" },
    { t: 60, d: 15, text: "第二句" },
    { t: 75, d:15, text: "再几个字。" },
  ];
  const shots = computeShots(beat(kinetic(), words, "第一句说完了。第二句再几个字。"), 0, 30);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[1].from, 60);
  assert.equal(shots[0].words.length, 2);
  assert.equal(shots[1].words.length, 2);
  assert.equal(shots[1].from + shots[1].durationInFrames, 120);
});

/* 4. 短句（<1.5s）并入下一句 */
ok("短句并入下一句", () => {
  const words = [
    { t: 0, d: 9, text: "第一句" },
    { t: 15, d: 9, text: "甲。" },
    { t: 30, d: 9, text: "第二句" },
    { t: 45, d: 9, text: "乙。" },
    { t: 75, d: 9, text: "第三句" },
    { t: 90, d: 9, text: "丙。" },
  ];
  const shots = computeShots(beat(kinetic(), words, "第一句甲。第二句乙。第三句丙。"), 0, 30);
  assert.equal(shots.length, 2, "30 帧的第一句应并入第二句");
  assert.equal(shots[0].from, 0);
  assert.equal(shots[1].from, 75);
});

/* 5. 每个 shot 的词时间戳归零 */
ok("词时间戳归零到 shot 起点", () => {
  const words = [
    { t: 0, d: 15, text: "第一句" },
    { t: 20, d: 15, text: "说完了。" },
    { t: 60, d: 15, text: "第二句" },
    { t: 75, d: 15, text: "再几个字。" },
  ];
  const shots = computeShots(beat(kinetic(), words, "第一句说完了。第二句再几个字。"), 0, 30);
  for (const s of shots) {
    if (s.words.length) assert.equal(s.words[0].t, 0);
  }
});

/* 6. 显式路径：from/to 秒转帧、逐字段透传 */
ok("显式 shots 逐字段", () => {
  const words = [
    { t: 0, d: 15, text: "第一句" },
    { t: 30, d: 15, text: "一" },
    { t: 60, d: 15, text: "第二句" },
    { t: 90, d: 15, text: "二" },
  ];
  const shots = computeShots(
    beat(
      kinetic({
        shots: [
          { to: 2, transition: "crossfade" },
          { from: 2, motion: "rise", layout: "left-edge", words: ["第二句"] },
        ],
      }),
      words,
      "第一句一第二句二",
    ),
    0,
    30,
  );
  assert.equal(shots.length, 2);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[0].durationInFrames, 60);
  assert.equal(shots[0].transition, "crossfade");
  assert.equal(shots[0].motion, ORDER[0]);
  assert.equal(shots[0].layout, undefined);
  assert.equal(shots[0].shown, undefined);
  assert.equal(shots[1].from, 60);
  assert.equal(shots[1].durationInFrames, 60);
  assert.equal(shots[1].transition, "cut");
  assert.equal(shots[1].motion, "rise");
  assert.equal(shots[1].layout, "left-edge");
  assert.deepEqual(shots[1].shown, ["第二句"]);
  assert.deepEqual(shots[1].words.map((w) => w.text), ["第二句", "二"]);
});

/* 7. 全缺省 → 均分拍长 */
ok("from/to 全缺省均分", () => {
  const shots = computeShots(
    beat(kinetic({ shots: [{}, {}] }), [{ t: 0, d: 10, text: "词" }], "词", 100),
    0,
    30,
  );
  assert.equal(shots.length, 2);
  assert.equal(shots[0].from, 0);
  assert.equal(shots[0].durationInFrames, 50);
  assert.equal(shots[1].from, 50);
  assert.equal(shots[1].durationInFrames, 50);
});

/* 8. 防呆：非 kinetic 回退单镜头；to≤from clamp 成 ≥1 帧且不越界 */
ok("非 kinetic 与坏 from/to 防呆", () => {
  const image = beat({ kind: "image", shots: [{ to: 2 }] }, [], "", 120);
  const a = computeShots(image, 0, 30);
  assert.equal(a.length, 1);
  assert.equal(a[0].from, 0);
  assert.equal(a[0].durationInFrames, 120);

  const bad = beat(kinetic({ shots: [{ from: 3, to: 2 }] }), [], "", 150);
  const b = computeShots(bad, 0, 30);
  assert.equal(b.length, 1);
  assert.ok(b[0].durationInFrames >= 1, "clamp 后至少 1 帧");
  assert.ok(b[0].from + b[0].durationInFrames <= 150, "不越拍长");
});

/* 9. 配方轮换：全局 shot 序号下相邻（含跨批）不重复 */
ok("全局序号轮换相邻不重复", () => {
  const mk = (shots) =>
    beat(kinetic({ shots }), [{ t: 0, d: 10, text: "词" }], "词", 200);
  let prev = null;
  for (let first = 0; first <= 9; first++) {
    // 每个 count 独立成批：批内轮换值与相邻性都查
    for (let count = 1; count <= 4; count++) {
      const specs = Array.from({ length: count }, () => ({}));
      const shots = computeShots(mk(specs), first, 30);
      assert.equal(shots.length, count);
      shots.forEach((s, i) => {
        assert.equal(s.motion, ORDER[(first + i) % ORDER.length], `first=${first} 轮换错位`);
      });
      for (let i = 0; i + 1 < shots.length; i++) {
        assert.notEqual(shots[i].motion, shots[i + 1].motion, `first=${first} 批内撞配方`);
      }
    }
    // 跨批：上一 first 的末镜（取 4 镜批）与本 first 的首镜不重复
    const four = computeShots(mk(Array.from({ length: 4 }, () => ({}))), first, 30);
    const head = computeShots(mk([{}]), first, 30)[0];
    if (prev !== null) assert.notEqual(head.motion, prev, `跨批 first=${first} 撞配方 ${head.motion}`);
    prev = four[3].motion;
    // 单镜头拍退化为 autoMotion(first, canBuild)
    const single = computeShots(
      beat(kinetic(), [{ t: 0, d: 10, text: "词" }], "词"),
      first,
      30,
    );
    assert.equal(single.length, 1);
    assert.equal(single[0].motion, ORDER[first % ORDER.length]);
  }
});

/* 10. 真实 TTS 词流：词文本不带标点，断句信息只在 narration 里 */
ok("真实词流按 narration 标点拆镜", () => {
  // edge-tts 的 WordBoundary.text 不含标点；旁白里的句读是唯一的从句线索
  const words = [
    { t: 0, d: 15, text: "第一句" },
    { t: 20, d: 15, text: "说完了" },
    { t: 60, d: 15, text: "第二句" },
    { t: 75, d: 15, text: "再几个字" },
  ];
  const shots = computeShots(beat(kinetic(), words, "第一句，说完了。第二句，再几个字。"), 0, 30);
  assert.equal(shots.length, 2, "两句旁白应拆成两镜");
  assert.equal(shots[0].from, 0);
  assert.equal(shots[1].from, 60);
  assert.deepEqual(shots[0].words.map((w) => w.text), ["第一句", "说完了"]);
  assert.deepEqual(shots[1].words.map((w) => w.text), ["第二句", "再几个字"]);
  assert.equal(shots[1].words[0].t, 0, "第二镜的词时间戳要归零");
});

/* 11. 末句没有收尾标点时不能被吞掉；短尾句并进前一镜 */
ok("末句无收尾标点仍独立成镜", () => {
  const words = [
    { t: 0, d: 10, text: "甲" },
    { t: 80, d: 10, text: "乙" },
    { t: 160, d: 10, text: "丙" },
    { t: 240, d: 10, text: "丁" },
  ];
  const shots = computeShots(beat(kinetic(), words, "甲，乙，丙，丁", 320), 0, 30);
  assert.equal(shots.length, 4, "四个 ≥1.5s 的从句应该四镜，末句不能被并进前一镜");
  assert.equal(shots[3].from, 240);
  assert.equal(shots[3].durationInFrames, 80);
});

ok("短尾句并进前一镜", () => {
  const words = [
    { t: 0, d: 10, text: "甲" },
    { t: 80, d: 10, text: "乙" },
    { t: 160, d: 10, text: "丙" },
    { t: 240, d: 10, text: "丁" },
  ];
  const shots = computeShots(beat(kinetic(), words, "甲，乙，丙，丁", 275), 0, 30);
  assert.equal(shots.length, 3, "35 帧的末句（<45）应并进前一镜");
  assert.equal(shots[2].from, 160);
  assert.equal(shots[2].durationInFrames, 115);
});

/* 12. 显式镜窗口里没有词时回退拍级旁白，不能空屏 */
ok("显式镜空词窗口回退拍级旁白", () => {
  const words = [{ t: 0, d: 10, text: "只有一句" }];
  const shots = computeShots(
    beat(kinetic({ shots: [{ to: 1 }, { from: 1 }] }), words, "只有一句", 120),
    0,
    30,
  );
  assert.equal(shots.length, 2);
  assert.equal(shots[1].words.length, 0);
  assert.equal(shots[1].narration, "只有一句", "空窗口的 narration 不能是空串");
});

/* 13. 显式镜先按 from 排序，再补缺省边界 */
ok("显式镜乱序先排序再补缺省", () => {
  const shots = computeShots(
    beat(kinetic({ shots: [{ from: 3 }, { from: 0.5, to: 1 }] }), [], "", 200),
    0,
    30,
  );
  assert.deepEqual(
    shots.map((s) => [s.from, s.durationInFrames]),
    [[15, 15], [90, 110]],
    "排序后第二镜应补到拍尾，而不是把前一镜压成一帧",
  );
});

/* 14. 自动分镜的 narration 保留标点：KineticText 靠标点断句 */
ok("自动分镜保留旁白标点", () => {
  const words = [
    { t: 0, d: 15, text: "有一种三角形" },
    { t: 20, d: 15, text: "宽度处处相等" },
    { t: 60, d: 15, text: "做成井盖" },
    { t: 75, d: 15, text: "也掉不下去" },
  ];
  const shots = computeShots(
    beat(kinetic(), words, "有一种三角形，宽度处处相等。做成井盖，也掉不下去。"),
    0,
    30,
  );
  assert.equal(shots.length, 2);
  assert.equal(shots[0].narration, "有一种三角形，宽度处处相等。");
  assert.equal(shots[1].narration, "做成井盖，也掉不下去。");
});

/* 15. 显式分镜同样保留标点 */
ok("显式分镜保留旁白标点", () => {
  const words = [
    { t: 0, d: 15, text: "第一句" },
    { t: 20, d: 15, text: "说完了" },
    { t: 60, d: 15, text: "第二句" },
    { t: 75, d: 15, text: "再几个字" },
  ];
  const shots = computeShots(
    beat(kinetic({ shots: [{ to: 2 }, { from: 2 }] }), words, "第一句，说完了。第二句，再几个字。"),
    0,
    30,
  );
  assert.equal(shots.length, 2);
  assert.equal(shots[0].narration, "第一句，说完了。");
  assert.equal(shots[1].narration, "第二句，再几个字。");
});

console.log(`[shots] ${n} 组断言通过`);

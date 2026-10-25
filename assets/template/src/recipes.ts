/**
 * 动效配方（motion recipes）的单一真相。
 *
 * 抽出来是因为配方轮换被三处消费：BeatPresence（运行时）、
 * shots.ts（镜头级轮换）、check_rhythm.py（脚本侧静态检查）。
 * 这里只用 `import type` 引 timeline.ts 的类型——保证 Node 直跑
 * 本模块时不会执行 timeline.ts（它的 JSON import 会炸）。
 */

import type { MotionRecipe, VisualSpec } from "./timeline";

/**
 * 自动轮换表。相邻必不同（含首尾相接），所以轮换出的动效天然反单调。
 *
 * 单一表 + 一个替换规则，而不是"可 build / 不可 build 两套表"：两套表各按
 * 拍序取模时，kinetic / image 交替的片子里相邻拍会撞出同一种配方。
 * 这里换成"build 落在不可 build 的拍上时用 drift 顶替"——枚举过所有相邻
 * 组合（同类相邻 / 跨类相邻 / 首尾 wrap），任意相邻都不同。
 */
export const ORDER: MotionRecipe[] = ["stamp", "build", "wipe", "rise", "drift"];

/** 内容逐项出现的 kind，配 build 配方；其余整幅成型的 kind 把 build 顶成 drift。 */
export const BUILDABLE_KINDS = new Set<VisualSpec["kind"]>([
  "kinetic", "stat", "odometer", "cards", "stack", "compare",
  "split", "timeline", "chart", "callout", "route",
]);

export const canBuildVisual = (v: VisualSpec) => BUILDABLE_KINDS.has(v.kind);

/** 无显式 motion 时的轮换值。相邻拍（含 wrap、含跨类切换）保证不同。 */
export const autoMotion = (index: number, canBuild: boolean): MotionRecipe => {
  const recipe = ORDER[index % ORDER.length];
  return !canBuild && recipe === "build" ? "drift" : recipe;
};

/**
 * 转场查表：script.json 里写的名字 → Remotion 的 presentation。
 *
 * 挑选的原则不是"哪个最炫"，而是**这一对拍子之间适合哪种**：
 *   fade / dissolve     —— 同类内容的软切换，最不惹眼，默认选它
 *   slide / pushCut     —— 话题往前推进，"下一段"
 *   wipe / iris / clockWipe —— 换一个维度、换一个时代、换一个地方
 *   flip / bookFlip     —— 像翻书页，做"翻到下一章"用
 *   zoomInOut / crossZoom / dreamyZoom —— 冲击性的强调，别连用
 *   filmBurn / ripple   —— 烧灼感，只适合灾难、战乱这类拍子
 *   none                —— 硬切。连续同类型内容反而比淡入淡出更利落
 *
 * @remotion/transitions 一共 20 种，这里只暴露用得上的。
 */

import type { TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { dissolve } from "@remotion/transitions/dissolve";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { iris } from "@remotion/transitions/iris";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { flip } from "@remotion/transitions/flip";
import { bookFlip } from "@remotion/transitions/book-flip";
import { crossZoom } from "@remotion/transitions/cross-zoom";
import { zoomInOut } from "@remotion/transitions/zoom-in-out";
import { dreamyZoom } from "@remotion/transitions/dreamy-zoom";
import { pushCut } from "@remotion/transitions/push-cut";
import { blurSlide } from "@remotion/transitions/blur-slide";
import { filmBurn } from "@remotion/transitions/film-burn";
import { ripple } from "@remotion/transitions/ripple";
import { none } from "@remotion/transitions/none";
import { paperCover } from "./paperfx";

/** 以 fade 的返回类型为基准。各 presentation 的 props 类型互不相同，
 *  统一收敛到这一个需要调用处无差别接受，故此处做一次 cast。 */
type Presentation = ReturnType<typeof fade>;

const REGISTRY = {
  none,
  fade,
  dissolve,
  wipe,
  iris,
  clockWipe,
  slide,
  pushCut,
  blurSlide,
  flip,
  bookFlip,
  crossZoom,
  zoomInOut,
  dreamyZoom,
  filmBurn,
  ripple,
  /** 纸片盖屏：纸片掉下来盖满、换内容、再掉走。需要 18 帧左右才不赶 */
  paperCover,
} as unknown as Record<string, () => Presentation>;

/** 常用别名，省得背 Remotion 的原始命名 */
const ALIASES: Record<string, string> = {
  default: "fade",
  push: "slide",
  cut: "none",
  hard: "none",
  book: "bookFlip",
  burn: "filmBurn",
  paper: "paperCover",
};

/**
 * 只有 clockWipe 和 iris 需要画幅尺寸，其余 14 个都能无参调用。
 *
 * 这两个如果不给尺寸，Remotion 4.0.535 内部会算出
 * `Math.sqrt(undefined ** 2 + undefined ** 2) / 2` = NaN，
 * makePie 生成出 "M NaN…" 这样的路径数据，translatePath 直接抛
 * "Malformed path data" —— 而且是在渲染到那一帧时才炸，预览阶段看不出来。
 * 所以必须把尺寸喂进去。
 */
const NEEDS_SIZE = new Set(["clockWipe", "iris"]);

export const transitionFor = (
  name: string | undefined,
  size?: { width: number; height: number },
): Presentation => {
  const key = ALIASES[name ?? ""] ?? name ?? "fade";
  const factory = REGISTRY[key] ?? REGISTRY.fade;
  if (!NEEDS_SIZE.has(key)) {
    return factory();
  }
  if (!size) {
    throw new Error(
      `[transitions] "${key}" 需要画幅尺寸。VoxVideo 里用 useVideoConfig() 取到后传进来。`,
    );
  }
  // 各 presentation 的 props 形状互不相同（fade 无参、clockWipe 要 width/height），
  // 统一到这个基准类型时只能对调用点放宽
  return (factory as (s?: unknown) => Presentation)(size);
};

export const TRANSITION_NAMES = [...Object.keys(ALIASES), ...Object.keys(REGISTRY)];

export type { TransitionPresentation };
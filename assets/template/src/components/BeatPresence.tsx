/**
 * beat 生命周期与词级时间戳的工具。
 *
 * 组件都跑在 `<Sequence>` 里，所以 `useCurrentFrame()` 拿到的已经是
 * beat 内相对帧，与 timeline.json 里 `words[].t` 同一坐标系。
 * 这个一致性是整个动态排版能对齐旁白的前提。
 */

import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { MotionRecipe, WordTiming } from "../timeline";
import { safe } from "../words";

/** 词级时间戳的纯函数住在 words.ts（可被 node 套件直测）；这里只留 React hook */
export { makeEmphasisMatcher, resolveWordTimings } from "../words";

export const POP = 9; // 词入场的默认跨度（帧），约 0.3s

/* ---------------- 入场配方（motion recipes） ---------------- */

/** 各配方的进场透明度曲线。位移/裁剪由 useEntrance 的 wrapper 负责，这里只出透明度。 */
const entranceOpacity = (recipe: MotionRecipe, f: number): number => {
  const clamp = (from: number, to: number) =>
    interpolate(f, [from, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  switch (recipe) {
    case "stamp":
    case "seal":
      return clamp(0, 4) * 0.15 + 0.85; // 0.85 → 1，4 帧，主看缩放过冲
    case "rise":
      return clamp(0, 12) * 0.8 + 0.2; // 升入配淡入，留 0.2 底防空帧
    case "drift":
      return clamp(0, 8) * 0.8 + 0.2;
    case "wipe":
    case "flip":
    case "build":
    // 这几个只有 SVG 外壳能表达，整拍不额外淡入（arc 自己的透明度在外壳里算）
    case "arc":
    case "tear":
    case "morph":
    case "peel":
    case "draw":
      return 1; // 完全不做整体淡入：揭开/翻页/搭积木自带入场
  }
};

export const EntranceContext = createContext<{ recipe: MotionRecipe | null; holdExit?: boolean }>({
  recipe: null,
  holdExit: false,
});

export type EntranceSpec = {
  transform?: string;
  clipPath?: string;
  transformOrigin?: string;
};

/**
 * 内容层入场动画（由 visuals.tsx 的入场层调用）。
 *
 * 配方只塑形"进场"：退场统一走 useBeatPresence 的 outP 淡出，
 * 避免进/退两套机制打架。透明度部分在 useBeatPresence 里出，
 * 这里只管位移 / 裁剪 / 变形原点。
 */
export const useEntrance = (recipe: MotionRecipe): EntranceSpec => {
  const frame = safe(useCurrentFrame());
  const { fps } = useVideoConfig();
  const rate = safe(fps, 30);

  const easeOut = (to: number) =>
    interpolate(frame, [0, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

  switch (recipe) {
    case "stamp": {
      // 阻尼压到 11，让 1.18 → 1 的缩放略微过冲再落定，才有"盖下去"的劲
      const s = spring({
        frame,
        fps: rate,
        config: { damping: 11, stiffness: 180, mass: 0.8 },
        durationInFrames: Math.round(rate * 0.55),
      });
      return { transform: `scale(${1.18 - 0.18 * s})`, transformOrigin: "50% 60%" };
    }
    case "seal": {
      // 旧 DOM 路径没有墨环，只保留 stamp 的压印动作
      const s = spring({
        frame,
        fps: rate,
        config: { damping: 11, stiffness: 180, mass: 0.8 },
        durationInFrames: Math.round(rate * 0.55),
      });
      return { transform: `scale(${1.18 - 0.18 * s})`, transformOrigin: "50% 60%" };
    }
    case "wipe":
      // inset(top) 从 100% 收到 0：可见区从下往上揭开
      return { clipPath: `inset(${(1 - easeOut(14)) * 100}% 0 0 0)` };
    case "rise": {
      const p = spring({
        frame,
        fps: rate,
        config: { damping: 200 },
        durationInFrames: Math.round(rate * 0.4),
      });
      return { transform: `translateY(${(1 - p) * 56}px)` };
    }
    case "flip": {
      const p = spring({
        frame,
        fps: rate,
        config: { damping: 200 },
        durationInFrames: Math.round(rate * 0.45),
      });
      return {
        transform: `perspective(1000px) rotateY(${-(1 - p) * 16}deg)`,
        transformOrigin: "50% 50%",
      };
    }
    case "drift":
      return { transform: `translateX(${-(1 - easeOut(8)) * 36}px)` };
    case "build":
      return {}; // 整幅不进厂，元素逐项按词卡点
    // 弧线/撕裂/褶皱/掀纸/描线只有 SVG 外壳能表达。旧的 DOM 路径若被别处调用，
    // 退化成"不进场"比抛错好——类型是穷尽的，这里必须给返回值。
    case "arc":
    case "tear":
    case "morph":
    case "peel":
    case "draw":
      return {};
  }
};

/** beat 的进场/退场包络。所有视觉组件都用它做整体淡入淡出。 */
export const useBeatPresence = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const f = safe(frame);
  const rate = safe(fps, 30);
  const { recipe, holdExit } = useContext(EntranceContext);

  let inP: number;
  if (recipe) {
    inP = entranceOpacity(recipe, f - safe(delayFrames));
  } else {
    const raw = spring({
      frame: f - safe(delayFrames),
      fps: rate,
      config: { damping: 200 },
      durationInFrames: Math.round(rate * 0.45),
    });
    // 进场不完全从 0 开始。每一拍都是硬切（没有转场），若从 0 起，第 0 帧
    // 就是一张只有背景的空画面，片头那一下尤其明显。抬一个底既消掉了闪烁，
    // 又几乎看不出入场被削弱了。
    inP = 0.35 + 0.65 * raw;
  }

  // 退场留 0.35s，和 script.json 的 padAfter 呼应，画面在旁白说完后才撤。
  // holdExit 给 beat 内的非末镜头：镜头的"出"是硬切，只有整拍最后一镜负责拍级退场。
  const lead = Math.round(rate * 0.3);
  const outP = holdExit
    ? 0
    : spring({
        frame: f - (durationInFrames - lead),
        fps: rate,
        config: { damping: 200 },
        durationInFrames: Math.round(rate * 0.35),
      });

  return {
    frame: f,
    fps: rate,
    inP,
    outP,
    presence: inP * (1 - outP),
  };
};

export type WordState = {
  /** 入场进度 0→1，超出范围被夹住 */
  p: number;
  start: number;
  end: number;
  /** 该词是否已经念到（用于"念到才高亮"） */
  spoken: boolean;
};

/**
 * 按词索引查时间戳。视觉组件靠它把动画卡在旁白上。
 */
export const useBeatWords = (words: WordTiming[] | undefined) => {
  const frame = useCurrentFrame();
  const list = words ?? [];

  const at = (i: number, span = POP): WordState => {
    const w = list[i];
    if (!w) return { p: 1, start: 0, end: 0, spoken: true };
    const start = safe(w.t);
    const end = start + Math.max(1, safe(w.d, 1));
    return {
      p: interpolate(safe(frame), [start, start + span], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
      start,
      end,
      spoken: safe(frame) >= start,
    };
  };

  /** 找到包含指定文本的第一个词下标，找不到返回 -1 */
  const indexOf = (needle: string) =>
    list.findIndex((w) => w.text.includes(needle) || needle.includes(w.text));

  /** 所有词念完的时刻，用于"念完再补一刀"的下一步动画 */
  const settledAt = list.length
    ? safe(list[list.length - 1].t) + safe(list[list.length - 1].d)
    : 0;

  /** 某个帧号之后的进度，用于驱动"念到 X 之后才出现的第二层信息" */
  const after = (atFrame: number, span = POP) =>
    interpolate(safe(frame), [safe(atFrame), safe(atFrame) + span], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return { at, indexOf, after, settledAt, words: list };
};

/** 统一的内容安全区（1080p 下约 8.5% 边距） */
export const useStage = () => {
  const { width, height } = useVideoConfig();
  return {
    width,
    height,
    pad: Math.round(width * 0.085),
    maxWidth: Math.round(width * 0.86),
  };
};

export const clampInterp = (frame: number, range: [number, number], out: [number, number]) =>
  interpolate(frame, range, out, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export type PresenceProps = {
  children: ReactNode;
  delayFrames?: number;
  style?: React.CSSProperties;
};
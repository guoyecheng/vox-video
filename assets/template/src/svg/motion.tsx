/**
 * 入场动效：把"配方"翻译成 `<g>` 上的 transform / clipPath / opacity。
 *
 * 和旧的 `useEntrance` 的区别只有一层：旧版出 CSS 字符串给 div，这里出同样语义的
 * SVG 值。之所以要换，是因为位移/遮罩之外，只有 SVG 能表达"顺着弧线飞进来"
 * "纸从接缝撕开""纸角掀起"这类**形状本身在变**的运动。
 *
 * 三条纪律：
 *   - 不用 SMIL、不用 CSS `animation` / `transition`：一切由 `useCurrentFrame()` 算，
 *     逐帧渲染才可复现（同一帧渲两次像素一致）。
 *   - 遮罩 id 必须过 `useId()`：一个画面里可能同时挂两个镜头（premount + crossfade），
 *     写死 id 会被前一个吃掉，后一个内容整块消失。
 *   - 所有进度过 `clamp01`：空词流 / 缺字段时最坏退化成 0，不会让属性变 `NaN`。
 */

import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { MotionRecipe } from "../timeline";
import { bezierPoint, bezierTangent, clamp01, inkBlob, pathFromPoints, peelPolygon, tearSplit } from "./math";
import { useStageBox } from "./stage";
import type { Box, Pt } from "./math";

/** `amp` 只有 `morph` 会传：v1 的变形是"幅度减半的撕裂"，起伏太大就不像褶皱。 */
export type SvgMask = { kind: "wipe" | "tear" | "peel" | "ink"; p: number; seed: number; amp?: number };

export type SvgEntrance = {
  /** SVG transform 字符串（translate / rotate / scale），空串表示不动 */
  transform: string;
  opacity: number;
  /** CSS transform-origin，百分比按整个 viewBox 解析 */
  origin?: string;
  mask?: SvgMask;
  /** draw 配方给组件读的进度；不是 draw 时恒为 1 */
  draw: number;
  /** seal 的墨环进度，由外壳画，组件不用管 */
  seal?: number;
  /** seal 的墨环颜色，取这一拍的主色 */
  accent?: string;
};

/** 组件读它来决定自己的描边画到哪（route / chart / timeline / highlight）。 */
export const SvgDrawContext = React.createContext(1);

/** 1 = 不参与 draw（默认）；0→1 是 draw 配方给的真实进度。 */
export const useSvgDraw = () => React.useContext(SvgDrawContext);

/** 各配方的整体透明度曲线（与旧 DOM 版逐帧一致，改它等于改动所有已出片段的观感）。 */
const entranceOpacity = (recipe: MotionRecipe, f: number): number => {
  const clamp = (from: number, to: number) =>
    interpolate(f, [from, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  switch (recipe) {
    case "stamp":
    case "seal":
      return clamp(0, 4) * 0.15 + 0.85;
    case "rise":
    case "drift":
      return clamp(0, 12) * 0.8 + 0.2;
    default:
      return 1;
  }
};

/** 遮罩多边形。`wipe` 从下往上揭开；其余三种由数学层出形状。 */
const maskPath = (mask: SvgMask, box: Box): string => {
  const p = clamp01(mask.p);
  switch (mask.kind) {
    case "wipe": {
      const top = box.y + box.h * (1 - p);
      return pathFromPoints(
        [
          { x: box.x, y: top },
          { x: box.x + box.w, y: top },
          { x: box.x + box.w, y: box.y + box.h },
          { x: box.x, y: box.y + box.h },
        ],
        true,
      );
    }
    case "tear":
      return pathFromPoints(
        tearSplit(box, mask.seed, p, mask.amp === undefined ? {} : { amp: mask.amp }).revealed,
        true,
      );
    case "peel":
      return pathFromPoints(peelPolygon(box, p).remain, true);
    case "ink":
      return pathFromPoints(
        inkBlob(box.x + box.w / 2, box.y + box.h / 2, Math.hypot(box.w, box.h) / 2, mask.seed, p),
        true,
      );
  }
};

export const useSvgEntrance = (
  recipe: MotionRecipe,
  opts: { seed?: number; canDraw?: boolean; accent?: string } = {},
): SvgEntrance => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rate = fps > 0 ? fps : 30;
  const seed = opts.seed ?? 1;
  const box: Box = useStageBox();

  const easeOut = (to: number) =>
    interpolate(frame, [0, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

  const opacity = entranceOpacity(recipe, frame);

  switch (recipe) {
    case "stamp": {
      const s = spring({
        frame,
        fps: rate,
        config: { damping: 11, stiffness: 180, mass: 0.8 },
        durationInFrames: Math.round(rate * 0.55),
      });
      return { transform: `scale(${1.18 - 0.18 * s})`, opacity, origin: "50% 60%", draw: 1 };
    }
    case "wipe":
      return { transform: "", opacity, mask: { kind: "wipe", p: easeOut(14), seed }, draw: 1 };
    case "rise": {
      const p = spring({
        frame,
        fps: rate,
        config: { damping: 200 },
        durationInFrames: Math.round(rate * 0.4),
      });
      return { transform: `translateY(${(1 - p) * 56}px)`, opacity, draw: 1 };
    }
    case "flip": {
      const p = spring({
        frame,
        fps: rate,
        config: { damping: 200 },
        durationInFrames: Math.round(rate * 0.45),
      });
      // SVG 里的 3D `rotateY` 在部分渲染路径上会被降级成没有透视的平面压缩，
      // 观感反而像"横向被压扁"。这里改成等效的横向滑入 + 轻微压扁。
      return {
        transform: `translateX(${(1 - p) * -28}px) scale(${0.94 + 0.06 * p}, 1)`,
        opacity,
        origin: "0% 50%",
        draw: 1,
      };
    }
    case "drift":
      return { transform: `translateX(${-(1 - easeOut(8)) * 36}px)`, opacity, draw: 1 };
    case "build":
      return { transform: "", opacity, draw: 1 };

    // —— 以下六个是 SVG 内容层才有的动作 ——

    case "arc": {
      // 从画面左下角外飞入，控制点抬到画面上方，落点就是画幅原点
      // （`<g>` 已经在画幅原点，所以 to 用 0,0 而不是宽高）。
      const t = easeOut(30);
      const pos = bezierPoint({ x: -380, y: 820 }, { x: 460, y: 60 }, { x: 0, y: 0 }, t);
      const rot = 8 * (1 - t);
      return {
        transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg)`,
        opacity: clamp01(frame / 6),
        draw: 1,
      };
    }
    case "tear":
      return {
        transform: "",
        opacity,
        origin: "50% 100%",
        mask: { kind: "tear", p: easeOut(26), seed },
        draw: 1,
      };
    case "morph":
      // v1 退化成撕裂：纸片"摊平"需要组件内部的多边形自己能插值，
      // 现在内容还在 foreignObject 里，只有外壳能变。等 PaperTile 迁进 SVG 再补真 morph。
      return {
        transform: "",
        opacity,
        origin: "50% 100%",
        mask: { kind: "tear", p: easeOut(30), seed, amp: 9 },
        draw: 1,
      };
    case "peel":
      return { transform: "", opacity, mask: { kind: "peel", p: easeOut(28), seed }, draw: 1 };
    case "seal": {
      const s = spring({
        frame,
        fps: rate,
        config: { damping: 11, stiffness: 180, mass: 0.8 },
        durationInFrames: Math.round(rate * 0.55),
      });
      return {
        transform: `scale(${1.18 - 0.18 * s})`,
        opacity,
        origin: "50% 60%",
        draw: 1,
        seal: easeOut(20),
        accent: opts.accent,
      };
    }
    case "draw": {
      const p = easeOut(28);
      // 没有主描边的 kind 不会消费 SvgDrawContext，硬给进度等于整块静止；
      // 退化成 wipe，至少"出现"这件事还在。
      return opts.canDraw
        ? { transform: "", opacity: 1, draw: p }
        : { transform: "", opacity: 1, mask: { kind: "wipe", p, seed }, draw: 1 };
    }
    default:
      return { transform: "", opacity, draw: 1 };
  }
};

/** 8 条 6px 短刻度，跟着墨环一起向外扩散。 */
const SEAL_TICKS = [0, 45, 90, 135, 180, 225, 270, 315];

const SealRing: React.FC<{ p: number; cx: number; cy: number; accent?: string }> = ({
  p,
  cx,
  cy,
  accent,
}) => {
  const q = clamp01(p);
  const r = 70 + 130 * q;
  const o = 0.55 * (1 - q);
  return (
    <g opacity={o} fill="none" stroke={accent ?? "currentColor"} strokeLinecap="round">
      <circle cx={cx} cy={cy} r={r} strokeWidth={6} />
      {SEAL_TICKS.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        return (
          <line
            key={deg}
            x1={cx + cos * (r + 4)}
            y1={cy + sin * (r + 4)}
            x2={cx + cos * (r + 10)}
            y2={cy + sin * (r + 10)}
            strokeWidth={6}
          />
        );
      })}
    </g>
  );
};

export const SvgEntranceGroup: React.FC<{
  entrance: SvgEntrance;
  children?: React.ReactNode;
}> = ({ entrance, children }) => {
  const box: Box = useStageBox();
  // useId 的产物形如 ":r1:"，冒号在 url(#...) 里会把引用截断，必须清掉
  const id = `sm-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const d = entrance.mask ? maskPath(entrance.mask, box) : null;

  return (
    <>
      {d ? (
        <defs>
          <clipPath id={id}>
            <path d={d} />
          </clipPath>
        </defs>
      ) : null}
      <g
        clipPath={d ? `url(#${id})` : undefined}
        opacity={entrance.opacity}
        style={{
          transform: entrance.transform || undefined,
          transformOrigin: entrance.origin,
          transformBox: "view-box",
        }}
      >
        {children}
      </g>
      {entrance.seal !== undefined ? (
        <SealRing
          p={entrance.seal}
          cx={box.x + box.w / 2}
          cy={box.y + box.h * 0.46}
          accent={entrance.accent}
        />
      ) : null}
    </>
  );
};

/** arc 用：沿二次贝塞尔取点和角度。导出给转场复用。 */
export const arcAt = (from: Pt, ctrl: Pt, to: Pt, t: number) => {
  const p = clamp01(t);
  const pos = bezierPoint(from, ctrl, to, p);
  const tan = bezierTangent(from, ctrl, to, p);
  return { pos, deg: (Math.atan2(tan.y, tan.x) * 180) / Math.PI };
};
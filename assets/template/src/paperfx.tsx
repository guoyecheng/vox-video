/**
 * 纸片动效：掉落进场（PaperDrop）与纸片盖屏转场（paperCover）。
 *
 * 和 paper.tsx 的关系：那边管"一张纸长什么样"（毛边、投影、胶带），
 * 这边管"纸怎么飞进来、怎么盖住画面"。几何全部由帧号决定，逐帧可复现。
 */

import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";
import { COLORS } from "./theme";
import { PAPER, hash01, roughEdge } from "./paper";

/** 落地回弹的幅度：1.2 比默认 1.7 收敛，纸片不会弹得太"卡通" */
const LAND = Easing.out(Easing.back(1.2));
const LEAVE = Easing.in(Easing.cubic);

/**
 * 一张纸掉下来，落地时回正；可选再掉出画面。
 *
 * 一组纸片拼标题时，`at` 一个比一个晚 3-4 帧（0.1s 左右）。
 * 纸片是撕边的（`roughEdge`），投影单独垫在下面一层，不用 `drop-shadow`
 * —— clip-path 会把 filter 一起裁掉。
 */
export const PaperDrop: React.FC<{
  /** 开始下落的帧 */
  at: number;
  /** 落定位置的**中心点**（px） */
  x?: number;
  y?: number;
  width: number;
  height: number;
  color?: string;
  seed?: number;
  /** 下落帧数，默认 14（30fps 下约 0.47s） */
  duration?: number;
  /** 起始高度（px），默认 700 */
  dropFrom?: number;
  /** 起始倾斜（度），落地回正 */
  rotate?: number;
  /** 从这一帧开始掉出画面 */
  outAt?: number;
  outDuration?: number;
  /** 毛边幅度（px） */
  tear?: number;
  children?: React.ReactNode;
}> = ({
  at,
  x = 960,
  y = 540,
  width,
  height,
  color = PAPER.sheet,
  seed = 1,
  duration = 14,
  dropFrom = 700,
  rotate = 8,
  outAt,
  outDuration = 10,
  tear = 3.5,
  children,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: LAND,
  });
  const q =
    outAt === undefined
      ? 0
      : interpolate(frame, [outAt, outAt + outDuration], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: LEAVE,
        });

  if (frame < at || q >= 1) return null;

  const dy = -dropFrom * (1 - p) + (dropFrom + 200) * q;
  const rot = rotate * (1 - p) + 25 * q;
  const clip = roughEdge(seed, tear, 7);

  return (
    <div
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y - height / 2,
        width,
        height,
        transform: `translateY(${dy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`,
        transformOrigin: "50% 50%",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: PAPER.shade,
          clipPath: clip,
          transform: "translate(7px, 10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: color,
          clipPath: clip,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export type PaperCoverProps = {
  /** 纸片网格，默认 4 × 3 */
  cols?: number;
  rows?: number;
  /** 循环取色，默认取纸色 + 一块芥末黄 */
  colors?: string[];
  seed?: number;
};

const TILE_PAD = 60;
const MAX_DELAY = 0.15;
const DEFAULT_COVER_COLORS = [
  PAPER.sheet,
  PAPER.sheetWarm,
  COLORS.paperAlt,
  COLORS.stage,
  COLORS.paperAlt,
  COLORS.gold,
];

const PaperCoverTransition: React.FC<
  TransitionPresentationComponentProps<PaperCoverProps>
> = ({ children, presentationProgress, presentationDirection, passedProps }) => {
  const { width, height } = useVideoConfig();
  const { cols = 4, rows = 3, seed = 1 } = passedProps;
  const colors = passedProps.colors ?? DEFAULT_COVER_COLORS;
  const isEntering = presentationDirection === "entering";

  const tiles = useMemo(() => {
    const out: {
      k: number;
      cx: number;
      cy: number;
      delay: number;
      r0: number;
      dir: number;
      color: string;
      w: number;
      h: number;
    }[] = [];
    const w = width / cols + TILE_PAD;
    const h = height / rows + TILE_PAD;
    for (let k = 0; k < cols * rows; k++) {
      const i = k % cols;
      const j = Math.floor(k / cols);
      out.push({
        k,
        cx: (i + 0.5) * (width / cols) + (hash01(k * 5.1 + seed) - 0.5) * 40,
        cy: (j + 0.5) * (height / rows),
        delay: hash01(k * 3.3 + seed) * MAX_DELAY,
        r0: (hash01(k * 1.9 + seed) - 0.5) * 8,
        dir: hash01(k + 0.5) > 0.5 ? 1 : -1,
        color: colors[(k * 7 + j) % colors.length],
        w,
        h,
      });
    }
    return out;
  }, [cols, rows, seed, width, height, colors]);

  // 切点落在 progress = 0.5：此前一片片盖满，此后一片片掉走。
  // 每片最多晚 0.15 起步，但到 0.5 时必须全部落定，否则切点会露出底下的画面。
  const span = 0.5 - MAX_DELAY;

  return (
    <AbsoluteFill>
      {/* 新场景在盖满之前必须藏住：TransitionSeries 里进入场景默认压在上面，
          不藏的话纸片还没落下，观众已经看到下一拍了 */}
      <AbsoluteFill
        style={{ opacity: isEntering && presentationProgress < 0.5 ? 0 : 1 }}
      >
        {children}
      </AbsoluteFill>
      {isEntering ? (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {tiles.map((t) => {
            const p = Math.max(0, Math.min(1, (presentationProgress - t.delay) / span));
            const q = Math.max(
              0,
              Math.min(1, (presentationProgress - 0.5 - t.delay) / span),
            );
            if (p <= 0 || q >= 1) return null;

            const easedP = LAND(p);
            const easedQ = LEAVE(q);
            const y =
              t.cy - (height + 300) * (1 - easedP) + (height + 400) * easedQ;
            const rot = t.r0 + t.dir * ((1 - p) * 11 + q * 26);
            const clip = roughEdge(seed + t.k * 13, 5, 7);

            return (
              <div
                key={t.k}
                style={{
                  position: "absolute",
                  left: t.cx - t.w / 2,
                  top: y - t.h / 2,
                  width: t.w,
                  height: t.h,
                  transform: `rotate(${rot.toFixed(2)}deg)`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: PAPER.shade,
                    clipPath: clip,
                    transform: "translate(7px, 10px)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: t.color,
                    clipPath: clip,
                  }}
                />
              </div>
            );
          })}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * 纸片盖屏转场：出场前纸片一片片掉下来盖满画面，切点换内容，
 * 之后一片片掉走露出新一拍。
 *
 * 需要给足时长：默认 10 帧（0.33s）太赶，建议 `transitionFrames: 18`
 * （0.6s）左右。progress 0.5 处必须完全盖住，所以不要把它做成"半透明叠化"。
 */
export const paperCover = (props: PaperCoverProps = {}): TransitionPresentation<PaperCoverProps> => ({
  component: PaperCoverTransition,
  props,
});

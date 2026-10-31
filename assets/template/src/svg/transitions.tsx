/**
 * 四个纸艺转场：撕开、掀起、洇墨、切缝。
 *
 * 和 `@remotion/transitions` 自带转场的区别：自带那 20 种都是**对整块画面做
 * 透视/位移/蒙版**，纸张只是被"搬来搬去"。这里要的是纸本身在破裂、在翻起，
 * 所以裁切形状是算出来的多边形，而不是矩形/圆形。
 *
 * 三条约束：
 *   - `@remotion/transitions` 会按 entering / exiting **各渲染一次**，每次只给
 *     一个 `children`。所以两块内容不在这里拼，只决定"这一侧露出多少"。
 *   - 颜色一律从 `passedProps.tone` 推：深色拍（quote）接缝用暖墨黑，纸色拍
 *     用米棕。写死纸色会在明暗切换的接缝上闪一条白边。
 *   - 坐标用**画幅**（0..width / 0..height），不是 `PaperStage` 那圈放大的盒子：
 *     转场在拍级，盖的是整个画面，不跟着内容层的 14px 内缩走。
 */

import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";
import { COLORS } from "../theme";
import { hash01, inkBlob, pathFromPoints, peelPolygon, tearSplit } from "./math";
import type { Box, Pt } from "./math";

export type SvgTransitionProps = {
  /** 进入拍的底色：决定接缝、折角、墨迹的颜色 */
  tone?: "paper" | "night";
  /** 这一拍的主色，只用于一条窄带 */
  accent?: string;
  /** 撕口/墨迹的种子：同一接缝逐帧稳定 */
  seed?: number;
};

/** 纸色：深色拍用夜色，其余用纸面。不要写死，否则 quote 的接缝会闪米白。 */
const paperOf = (tone?: "paper" | "night") => (tone === "night" ? COLORS.night : COLORS.paper);

/** 裁剪 id 必须唯一：entering / exiting 同帧各挂一份，写死会互相吃掉。 */
const useClipId = (prefix: string) =>
  `${prefix}-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

/**
 * 把一段 `clipPath` 里的 `<path>` 套到 children 上。
 *
 * 用 `url(#id)` 而不是 CSS `clip-path: path()`：后者在部分 Chromium < 88 的
 * 渲染路径里不支持，Remotion 的 headless shell 版本是跟着升级的，但没必要赌。
 */
const Clipped: React.FC<{ id: string; d: string; evenOdd?: boolean; children?: React.ReactNode }> = ({
  id,
  d,
  evenOdd,
  children,
}) => (
  <AbsoluteFill>
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden>
      <defs>
        <clipPath id={id} clipPathUnits="userSpaceOnUse">
          <path d={d} clipRule={evenOdd ? "evenodd" : "nonzero"} />
        </clipPath>
      </defs>
    </svg>
    <AbsoluteFill style={{ clipPath: `url(#${id})` }}>{children}</AbsoluteFill>
  </AbsoluteFill>
);

const boxOf = (width: number, height: number): Box => ({ x: 0, y: 0, w: width, h: height });

/** 撕纸接缝的点列（`revealed` 去掉底下两个角点就是接缝本身）。 */
const seamOf = (split: { revealed: Pt[] }): Pt[] => split.revealed.slice(0, -2);

const TearWipe: React.FC<TransitionPresentationComponentProps<SvgTransitionProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps,
}) => {
  const { width, height } = useVideoConfig();
  const box = boxOf(width, height);
  const entering = presentationDirection === "entering";
  const split = tearSplit(box, passedProps.seed ?? 1, presentationProgress);
  const id = useClipId("tw");
  const seam = seamOf(split);
  const paper = paperOf(passedProps.tone);

  return (
    <AbsoluteFill>
      <Clipped id={id} d={pathFromPoints(entering ? split.revealed : split.covered, true)}>
        {children}
      </Clipped>
      {/* 接缝上压一条细墨线：没有它，两块纸之间只是"齐边",像蒙版不像撕口 */}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden
      >
        <path
          d={pathFromPoints(seam)}
          fill="none"
          stroke={paper}
          strokeOpacity={0.55}
          strokeWidth={2}
        />
      </svg>
    </AbsoluteFill>
  );
};

const PaperPeel: React.FC<TransitionPresentationComponentProps<SvgTransitionProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps,
}) => {
  const { width, height } = useVideoConfig();
  const box = boxOf(width, height);
  const entering = presentationDirection === "entering";
  const { remain, crease } = peelPolygon(box, presentationProgress);
  const id = useClipId("pp");
  const paper = paperOf(passedProps.tone);

  // 新内容出现在**已经掀开**的那一半：外框 + remain 用 evenodd 取补集
  const clip = entering
    ? `${pathFromPoints(
        [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ],
        true,
      )} ${pathFromPoints(remain, true)}`
    : pathFromPoints(remain, true);

  const [ca, cb] = crease;

  return (
    <AbsoluteFill>
      <Clipped id={id} d={clip} evenOdd={entering}>
        {children}
      </Clipped>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden
      >
        {/* 折痕：一条 10px 的半透明宽带，暗示纸在这里被弯过 */}
        <line
          x1={ca.x}
          y1={ca.y}
          x2={cb.x}
          y2={cb.y}
          stroke={paper}
          strokeOpacity={0.35}
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* 折角本身：三角填成纸色，压住旧内容的斜边 */}
        <path
          d={pathFromPoints(
            [
              { x: width, y: 0 },
              { x: width, y: Math.max(0, height * (1 - presentationProgress)) },
              { x: Math.max(0, width * (1 - presentationProgress)), y: 0 },
            ],
            true,
          )}
          fill={paper}
          fillOpacity={0.92}
        />
      </svg>
    </AbsoluteFill>
  );
};

const InkBleed: React.FC<TransitionPresentationComponentProps<SvgTransitionProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps,
}) => {
  const { width, height } = useVideoConfig();
  const entering = presentationDirection === "entering";
  const id = useClipId("ib");

  if (!entering) {
    // 旧内容不裁：新墨迹盖在上面，硬给旧内容加形状会露出两层边
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const blob = inkBlob(
    width * 0.42,
    height * 0.5,
    // 半径必须刚好在 p=1 时够到最远的那个角：用 hypot(w,h) 会大 1.8 倍，
    // p≈0.55 就把整幅盖满，后半段变成静止画面。
    Math.hypot(width * 0.58, height * 0.5),
    passedProps.seed ?? 1,
    presentationProgress,
  );

  return (
    <AbsoluteFill>
      <Clipped id={id} d={pathFromPoints(blob, true)}>
        {children}
      </Clipped>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden
      >
        <path
          d={pathFromPoints(blob, true)}
          fill="none"
          stroke={passedProps.accent ?? COLORS.ink}
          strokeOpacity={0.32}
          strokeWidth={6}
        />
      </svg>
    </AbsoluteFill>
  );
};

const PATH_CUT_AMP = 22;
const PATH_CUT_STEP = 40;

const PathCut: React.FC<TransitionPresentationComponentProps<SvgTransitionProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps,
}) => {
  const { width, height } = useVideoConfig();
  const entering = presentationDirection === "entering";
  const id = useClipId("pc");
  const seamX = width * presentationProgress;
  const paper = paperOf(passedProps.tone);

  // 竖直接缝，左右各锯齿一次：模拟刀口，不是直尺切的
  const seam: Pt[] = [];
  const n = Math.max(2, Math.round(height / PATH_CUT_STEP));
  for (let i = 0; i <= n; i++) {
    const jitter = (hash01((passedProps.seed ?? 1) * 7.3 + i) - 0.5) * 2 * PATH_CUT_AMP;
    seam.push({ x: Math.min(width, Math.max(0, seamX + jitter)), y: (height * i) / n });
  }

  // 刀口从画面左缘走到右缘：新的一拍在**左边**先露出来（刀过去的地方），
  // 右边仍是旧内容。反过来写会让 p=0 时新内容就占满全屏——探针量到的就是
  // 这个方向反了的症状（entering 在 p=0 处 99.8%）。
  const pts = entering
    ? [{ x: 0, y: 0 }, { x: 0, y: height }, ...seam.slice().reverse()]
    : [...seam, { x: width, y: height }, { x: width, y: 0 }];

  return (
    <AbsoluteFill>
      <Clipped id={id} d={pathFromPoints(pts, true)}>
        {children}
      </Clipped>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden
      >
        <path
          d={pathFromPoints(seam)}
          fill="none"
          stroke={paper}
          strokeOpacity={0.6}
          strokeWidth={2}
        />
      </svg>
    </AbsoluteFill>
  );
};

export const tearWipe = (
  props: SvgTransitionProps = {},
): TransitionPresentation<SvgTransitionProps> => ({ component: TearWipe, props });

export const paperPeel = (
  props: SvgTransitionProps = {},
): TransitionPresentation<SvgTransitionProps> => ({ component: PaperPeel, props });

export const inkBleed = (
  props: SvgTransitionProps = {},
): TransitionPresentation<SvgTransitionProps> => ({ component: InkBleed, props });

export const pathCut = (
  props: SvgTransitionProps = {},
): TransitionPresentation<SvgTransitionProps> => ({ component: PathCut, props });

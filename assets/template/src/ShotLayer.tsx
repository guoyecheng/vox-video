/**
 * 一个镜头的内容层。
 *
 * 跑在嵌套 <Sequence> 里，useCurrentFrame() 是 shot 相对帧；computeShots 已把
 * 词级时间戳归零到镜头起点，所以"念到哪个词"的坐标系天然对齐。
 *
 * 纸台 / 运镜 / 特效层都留在 beat 级（visuals.tsx），这里只接管内容层：
 * 入场配方、词级冲击、以及"非末镜不淡出"的退场策略。
 */

import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { FC } from "react";
import type { Beat, VisualSpec } from "./timeline";
import type { Shot } from "./shots";
import { EntranceContext, useEntrance } from "./components/BeatPresence";
import { useImpact } from "./effects";

type VisualComponent = FC<{
  beat: Beat;
  visual: VisualSpec;
  accent: string;
  tone?: "paper" | "night";
}>;

export const ShotLayer: React.FC<{
  shot: Shot;
  beat: Beat;
  accent: string;
  tone?: "paper" | "night";
  ambientTransform: string;
  holdExit: boolean;
  fadeIn: number;
  /** 这一拍被拆成了多镜：拍级 text 不能每镜重复上屏 */
  multiShot: boolean;
  /** 整画面冲击按拍计预算：只有首镜开火 */
  fireImpact: boolean;
  component: VisualComponent;
}> = ({
  shot,
  beat,
  accent,
  tone,
  ambientTransform,
  holdExit,
  fadeIn,
  multiShot,
  fireImpact,
  component: Component,
}) => {
  const frame = useCurrentFrame();

  // 冲击落在本镜头第一个词上——词级锚点的核心：切镜和第一个字同时发生。
  // 拍内后续镜头不再开火（impact 是整画面级，check_rhythm 按拍计预算）。
  const impact = useImpact(
    fireImpact ? Math.max(0, (shot.words[0]?.t ?? 0) - 3) : -1e6,
    beat.visual.impact ?? "soft",
  );
  const entrance = useEntrance(shot.motion);

  const shotVisual: VisualSpec = {
    ...beat.visual,
    // 多镜拍里 beat 级 text 会被每一镜重复上屏；没有 shot 级 words 时
    // 让 KineticText 回落到 shot.narration
    text: multiShot && shot.shown === undefined ? undefined : beat.visual.text,
    words: shot.shown,
    layout: shot.layout ?? beat.visual.layout,
  };
  const shotBeat: Beat = {
    ...beat,
    from: shot.from,
    durationInFrames: shot.durationInFrames,
    narration: shot.narration,
    words: shot.words,
  };

  const contentTransform = [ambientTransform, beat.visual.impact ? impact.transform : ""]
    .filter(Boolean)
    .join(" ");

  // crossfade 的前 8 帧从透明升上来，和前一镜多挂的尾巴交叠
  const fade =
    fadeIn > 0
      ? interpolate(frame, [0, fadeIn], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <EntranceContext.Provider value={{ recipe: shot.motion, holdExit }}>
      <div style={{ position: "absolute", inset: 0, clipPath: entrance.clipPath }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: [entrance.transform, contentTransform].filter(Boolean).join(" ") || undefined,
            transformOrigin: entrance.transformOrigin,
            opacity: fade,
          }}
        >
          <Component beat={shotBeat} visual={shotVisual} accent={accent} tone={tone} />
        </div>
      </div>
    </EntranceContext.Provider>
  );
};

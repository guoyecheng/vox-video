/**
 * 全片常驻的小件：左上角报头、底部章节进度。
 *
 * 这里**没有页码**。页码是文档/幻灯片的语法：它告诉观众"你正在看第几页"，
 * 而视频的观众不需要知道进度——他们只需要知道"这是哪条片"。所以左上角
 * 只留一条红笔 + 片名，像报纸的报名，不像 PPT 的页眉。
 */

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY } from "../fonts";
import { useBeatPresence } from "./BeatPresence";

/** 左上角报头：一条红笔 + 片名。不参与运镜，也不随拍切换内容 */
export const RunningHead: React.FC<{
  title: string;
  accent: string;
  tone?: "paper" | "night";
}> = ({ title, accent, tone = "paper" }) => {
  const { presence } = useBeatPresence();
  const ink = tone === "night" ? COLORS.nightInk : COLORS.ink;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 15, opacity: presence * 0.9 }}>
      <div
        style={{
          width: 36,
          height: 6,
          background: COLORS.accent,
          transform: "rotate(-1.4deg)",
          borderRadius: 1,
        }}
      />
      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: 5,
          color: ink,
          opacity: 0.5,
        }}
      >
        {title}
      </div>
    </div>
  );
};

/** 底部细进度条 + 每拍的分隔刻度。做成一条印刷裁切线，而不是 UI 进度条 */
export const ChapterProgress: React.FC<{ durationInFrames: number; beatStarts: number[] }> = ({
  durationInFrames,
  beatStarts,
}) => {
  const frame = useCurrentFrame();

  const p = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });

  const opacity = interpolate(
    frame,
    [0, 12, durationInFrames - 12, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 4,
          background: `${COLORS.ink}14`,
        }}
      >
        <div style={{ height: "100%", width: `${p * 100}%`, background: COLORS.accent }} />
      </div>

      {beatStarts.slice(1).map((from) => (
        <div
          key={from}
          style={{
            position: "absolute",
            bottom: 0,
            left: `${(from / Math.max(1, durationInFrames)) * 100}%`,
            width: 2,
            height: 11,
            background: `${COLORS.ink}33`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

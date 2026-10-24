/**
 * 全片常驻的小件：左上角角标、底部章节进度。
 *
 * 它们不参与叙事，但缺了会让片子看起来像"少了包装"——VOX 的成片几乎
 * 永远有这两样，观众的潜意识会默认它们存在。
 *
 * 布局分区是固定的，改组件位置时先看这张表：
 *   左上 (pad, 64)  角标：首拍显示片名，其余拍显示「序号 / 总数」
 *   左下 (pad, 96)  出处：由 StatCard / KineticText 各自渲染
 *   底边 (0, 0)     章节进度条 + 每拍的分隔刻度
 */

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY } from "../fonts";
import { useStage } from "./BeatPresence";

/** 首拍用的片名角标 */
export const TitleMark: React.FC<{ title: string; accent: string }> = ({ title, accent }) => {
  const { pad } = useStage();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 44, height: 6, borderRadius: 3, background: accent }} />
      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 3,
          color: COLORS.nightInk,
          opacity: 0.6,
        }}
      >
        {title}
      </div>
    </div>
  );
};

/** 底部细进度条 + 每拍的分隔刻度 */
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
          height: 6,
          background: `${COLORS.ink}1A`,
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
            width: 3,
            height: 14,
            background: `${COLORS.ink}44`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

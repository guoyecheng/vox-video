/**
 * 圈注：在画面上指东道西。箭头 + 圈 + 标签。
 *
 * 这是"特效感"最强的一个组件——它让静态图变成一张被讲解的图。
 * 配 `image` 用最好，但任何底图（纯色块也行）都能圈。
 *
 * 标注的坐标是画布百分比；`dx`/`dy` 控制标签相对目标点的偏移。
 */

import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import {
  useBeatPresence,
  useBeatWords,
  useStage,
  resolveWordTimings,
} from "./BeatPresence";

type Note = {
  /** 目标点，画布百分比 */
  x: number;
  y: number;
  text: string;
  /** 标签相对目标点的偏移（百分比） */
  dx?: number;
  dy?: number;
  /** 圈的大小（百分比） */
  r?: number;
};

export const Callout: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence, frame } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();

  const notes = (visual.notes ?? []) as Note[];
  const timings = resolveWordTimings(
    notes.map((n) => n.text),
    beat.words,
    beat.durationInFrames,
  );
  const progressOf = (i: number) => after(timings[i]?.t ?? 0, 14);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `150px ${pad}px 140px`,
        opacity: presence,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 16,
          overflow: "hidden",
          background: visual.src ? COLORS.paperAlt : "#FFFFFFAA",
          border: `3px solid ${COLORS.rule}`,
        }}
      >
        {visual.src ? (
          <Img
            src={staticFile(visual.src)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `repeating-linear-gradient(45deg, ${COLORS.paperAlt} 0 26px, ${COLORS.paper} 26px 52px)`,
            }}
          />
        )}

        {/* ---- 圈注 ---- */}
        {notes.map((n, i) => {
          const p = progressOf(i);
          if (p <= 0.001) return null;

          const r = n.r ?? 7;
          const dx = n.dx ?? 16;
          const dy = n.dy ?? -14;

          // 圈是"画"上去的：半径从 1.6 倍收到 1 倍
          const ringScale = interpolate(p, [0, 0.7, 1], [1.6, 1, 1.02], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div key={`${n.text}-${i}`} style={{ position: "absolute", inset: 0 }}>
              {/* 高亮圈 */}
              <div
                style={{
                  position: "absolute",
                  left: `${n.x}%`,
                  top: `${n.y}%`,
                  width: `${r * 2}%`,
                  aspectRatio: "1",
                  transform: `translate(-50%, -50%) scale(${ringScale})`,
                  border: `5px solid ${accent}`,
                  borderRadius: "50%",
                  opacity: p * 0.95,
                }}
              />

              {/* 箭头：从标签指向目标 */}
              <svg
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
              >
                <line
                  x1={`${n.x + dx * 0.4}%`}
                  y1={`${n.y + dy * 0.4}%`}
                  x2={`${n.x}%`}
                  y2={`${n.y}%`}
                  stroke={accent}
                  strokeWidth={4}
                  strokeDasharray={400}
                  strokeDashoffset={400 * (1 - p)}
                  strokeLinecap="round"
                />
                <circle cx={`${n.x + dx * 0.4}%`} cy={`${n.y + dy * 0.4}%`} r={5} fill={accent} opacity={p} />
              </svg>

              {/* 标签 */}
              <div
                style={{
                  position: "absolute",
                  left: `${n.x + dx}%`,
                  top: `${n.y + dy}%`,
                  transform: "translate(-50%, -50%)",
                  padding: "12px 22px",
                  background: COLORS.ink,
                  color: COLORS.paper,
                  borderRadius: 10,
                  fontFamily: FONT_BODY,
                  fontSize: 32,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  opacity: p,
                  boxShadow: `6px 6px 0 ${accent}`,
                }}
              >
                {n.text}
              </div>
            </div>
          );
        })}
      </div>

      {visual.caption ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            bottom: 150,
            fontFamily: FONT_BODY,
            fontSize: 34,
            fontWeight: 700,
            color: COLORS.ink,
          }}
        >
          {visual.caption}
        </div>
      ) : null}
    </div>
  );
};
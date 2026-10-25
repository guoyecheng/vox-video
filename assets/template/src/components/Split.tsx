/**
 * 分屏。2-4 格并置，同时呈现几件事。
 *
 * 和 `CompareSplit` 的分工：Compare 是**两个有立场的东西**（A vs B，讲究
 * 谁赢谁输、左右要有先后关系）；Split 是**并列的清单**（几个并列的事实、
 * 几个阶段、几种方案），不预设对立。选错了语义会读作"打架"而不是"陈列"。
 *
 * 格数自适应：2 格横排，3 格横排（更窄），4 格用 2×2。
 * 每一格的标题跟着旁白依次进场。
 */

import React from "react";
import { Img, staticFile } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";
import { PAPER, PaperSheet, sway } from "../paper";

export type SplitPanel = {
  title: string;
  detail?: string;
  value?: string;
  src?: string;
};

export const Split: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence, frame } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, width, height } = useStage();

  const panels = (visual.panels ?? []) as SplitPanel[];
  if (!panels.length) return null;

  const timings = resolveWordTimings(
    panels.map((p) => p.title),
    beat.words,
    beat.durationInFrames,
  );

  const n = panels.length;
  // 3 格以内横排（更宽、更好读）；4 格以上转 2×2
  const cols = n <= 3 ? n : 2;
  const rows = Math.ceil(n / cols);
  const gap = Math.round(width * 0.016);
  const cellW = (width - pad * 2 - gap * (cols - 1)) / cols;
  const hasImage = panels.some((p) => p.src);
  // 单行时不要把格子撑满整列——内容只有几行字，780px 高的卡片会空得发慌。
  // 带图的可以高一点（画面本身占空间），纯文字的压矮。
  const cellH = Math.min(hasImage ? 560 : 420, (height - 400 - gap * (rows - 1)) / rows);

  const palette = [accent, COLORS.ink, COLORS.gold, COLORS.halftone, COLORS.stageDeep];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellH}px)`,
        gap,
        alignContent: "center",
        justifyContent: "center",
        // 底部留够字幕轨的位置，别让两者叠在一起
        padding: `150px ${pad}px 200px`,
        opacity: presence,
      }}
    >
      {panels.map((p, i) => {
        const pr = after(timings[i]?.t ?? 0, 18);
        const tint = palette[i % palette.length];

        return (
          <PaperSheet
            key={`${p.title}-${i}`}
            seed={i + 3}
            color={PAPER.sheet}
            style={{
              position: "relative",
              opacity: pr,
              transform: `translate(${sway(frame, i + 3).x}px, ${
                sway(frame, i + 3).y
              }px) translateY(${(1 - pr) * 40}px) scale(${0.92 + pr * 0.08})`,
            }}
            contentStyle={{
              height: "100%",
              overflow: "hidden",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              // 有图时文字贴底（图注）；纯文字卡垂直居中，否则顶部空一大块
              justifyContent: p.src ? "flex-end" : "center",
              padding: 34,
              gap: 10,
              boxSizing: "border-box",
            }}
          >
            {p.src ? (
              <Img
                src={staticFile(p.src)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : null}

            <div
              style={{
                position: "absolute",
                inset: 0,
                background: p.src
                  ? "linear-gradient(180deg, transparent 30%, #0B1020DD 100%)"
                  : `linear-gradient(160deg, ${tint}18 0%, transparent 60%)`,
              }}
            />

            <div style={{ position: "relative" }}>
              <div
                style={{
                  fontFamily: FONT_NUMERAL,
                  fontSize: 34,
                  letterSpacing: 3,
                  color: tint,
                  marginBottom: 8,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              {p.value ? (
                <div
                  style={{
                    fontFamily: FONT_NUMERAL,
                    fontSize: 62,
                    lineHeight: 1,
                    color: p.src ? COLORS.paper : COLORS.ink,
                    marginBottom: 10,
                  }}
                >
                  {p.value}
                </div>
              ) : null}
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 900,
                  fontSize: 44,
                  lineHeight: 1.2,
                  color: p.src ? COLORS.paper : COLORS.ink,
                }}
              >
                {p.title}
              </div>
              {p.detail ? (
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: FONT_BODY,
                    fontSize: 34,
                    lineHeight: 1.4,
                    color: p.src ? `${COLORS.paper}CC` : COLORS.inkSoft,
                  }}
                >
                  {p.detail}
                </div>
              ) : null}
            </div>
          </PaperSheet>
        );
      })}
    </div>
  );
};

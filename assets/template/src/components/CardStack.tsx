/**
 * 并列要点卡。"三个原因"这类结构的标准解法。
 *
 * 卡片依次上浮，每个卡片的起点卡在旁白念到它的那一刻——所以观众听到
 * 第 2 个原因时，第 2 张卡刚好落到位，而不是三张卡一起出现。
 */

import React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";
import { floatAt } from "../effects";
import { PAPER, PaperSheet, Tape, sway, tiltFor } from "../paper";

export const CardStack: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();
  const frame = useCurrentFrame();

  const items = visual.items ?? [];
  if (!items.length) return null;

  const timings = resolveWordTimings(
    items.map((i) => i.title),
    beat.words,
    beat.durationInFrames,
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 34,
        // 卡片不铺满整个画面：拉满宽度会让内容挤在左侧，右边一大片空白
        width: "100%",
        padding: `150px ${pad}px 130px`,
        opacity: presence,
      }}
    >
      {items.map((item, i) => {
        const p = after(timings[i]?.t ?? 0, 16);
        const j = sway(frame, i + 2);

        return (
          <PaperSheet
            key={`${item.title}-${i}`}
            seed={i + 2}
            color={PAPER.sheet}
            style={{
              width: "100%",
              maxWidth: 1400,
              opacity: p,
              // 落位后继续轻微浮动。三张卡的相位和周期都错开，
              // 同步上下会读成"整个列表在抖"。
              transform: `translate(${j.x}px, ${j.y}px) translateY(${(1 - p) * 46 + floatAt(
                frame,
                7,
                92 + i * 11,
                i + 1,
              )}px) rotate(${tiltFor(i + 2, 0.55)}deg)`,
            }}
          >
            {i === 0 ? (
              <Tape
                seed={11}
                width={168}
                height={50}
                angle={-9}
                style={{ left: 54, top: -26 }}
              />
            ) : null}

            <div style={{ display: "flex", alignItems: "center", gap: 44, padding: "38px 52px" }}>
              {/* 当前这条用一条斜贴的色纸做标记。整张卡都不染色——染色后
                  和背景纸屑混成一片，纸的边界就没了 */}
              {i === 0 ? (
                <div
                  style={{
                    flex: "0 0 auto",
                    width: 14,
                    height: 104,
                    background: accent,
                    borderRadius: 2,
                    transform: "rotate(-2.5deg)",
                  }}
                />
              ) : null}
              <div
                style={{
                  flex: "0 0 auto",
                  fontFamily: FONT_NUMERAL,
                  fontSize: 96,
                  lineHeight: 1,
                  color: i === 0 ? accent : COLORS.inkFaint,
                  opacity: i === 0 ? 1 : 0.55,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 900,
                    fontSize: 58,
                    color: COLORS.ink,
                    lineHeight: 1.2,
                  }}
                >
                  {item.title}
                </div>
                {item.detail ? (
                  <div
                    style={{
                      fontFamily: FONT_BODY,
                      fontSize: 36,
                      color: COLORS.inkSoft,
                      lineHeight: 1.45,
                    }}
                  >
                    {item.detail}
                  </div>
                ) : null}
              </div>
            </div>
          </PaperSheet>
        );
      })}
    </div>
  );
};

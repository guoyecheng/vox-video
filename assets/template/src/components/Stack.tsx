/**
 * 累积墙。旁白每说到一条，就往上叠一块。
 *
 * 和 `CardStack` 的分工：CardStack 是**同时陈列**（三张并排的卡片，
 * 观众一眼看全）；累积墙是**边说边堆**（念一条冒一条），适合
 * "三个原因""四个阶段""五年里发生了……"这种有累积感的罗列。
 *
 * 堆到一定高度会整体上移并压缩，保证永远不超出画面——
 * 这一点比看起来重要：堆到第 8 条时如果还往下堆就出画了。
 */

import React from "react";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";
import { PAPER, PaperSheet, sway } from "../paper";

export const Stack: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence, frame } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, width, height } = useStage();

  const items = (visual.items ?? []) as { title: string; detail?: string; tag?: string }[];
  if (!items.length) return null;

  const timings = resolveWordTimings(
    items.map((i) => i.title),
    beat.words,
    beat.durationInFrames,
  );

  const available = height - 340;
  const slot = available / items.length;
  // 每多一项就往上推一格；超过可用高度后整体压缩
  const itemH = Math.min(150, Math.max(60, slot * 0.86));
  const gap = Math.max(8, Math.min(20, slot - itemH));

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: `150px ${pad}px 170px`,
        opacity: presence,
      }}
    >
      <div
        style={{
          position: "relative",
          width: Math.min(width - pad * 2, 1180),
          height: available,
        }}
      >
        {items.map((it, i) => {
          const pr = after(timings[i]?.t ?? 0, 16);
          // 已出的项整体上移：新项从底部滑入
          const shownFromBottom = i;
          const y =
            available - (items.length - i) * (itemH + gap) + (1 - pr) * (itemH + gap);

          return (
            <PaperSheet
              key={`${it.title}-${i}`}
              seed={i + 6}
              color={i === 0 ? `${accent}1A` : PAPER.sheet}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: available - (items.length - i) * (itemH + gap),
                height: itemH,
                opacity: pr,
                transform: `translate(${sway(frame, i + 6).x}px, ${
                  sway(frame, i + 6).y
                }px) translateY(${(1 - pr) * itemH}px)`,
                zIndex: shownFromBottom,
              }}
              contentStyle={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "0 26px",
                height: itemH,
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_NUMERAL,
                  fontSize: itemH * 0.44,
                  lineHeight: 1,
                  color: i === 0 ? accent : COLORS.inkFaint,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>

              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 900,
                  fontSize: Math.min(48, itemH * 0.42),
                  color: COLORS.ink,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                }}
              >
                {it.title}
              </div>

              {it.detail ? (
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: Math.min(32, itemH * 0.3),
                    color: COLORS.inkSoft,
                    whiteSpace: "nowrap",
                    opacity: 0.9,
                  }}
                >
                  {it.detail}
                </div>
              ) : null}

              {it.tag ? (
                <div
                  style={{
                    padding: "6px 16px",
                    borderRadius: 999,
                    background: accent,
                    color: COLORS.paper,
                    fontFamily: FONT_BODY,
                    fontSize: 34,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.tag}
                </div>
              ) : null}
            </PaperSheet>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 逐词弹出的大字。这是 VOX 系最标志性的一个动作，也是默认首选组件。
 *
 * 关键在于每个词的入场起点不是均匀铺开的，而是来自 TTS 的词级时间戳——
 * 画面上字出现的时刻就是旁白念到这个词的时刻，两者天然对齐。
 */

import React from "react";
import { interpolate } from "remotion";
import { COLORS } from "../theme";
import { FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useStage, resolveWordTimings, makeEmphasisMatcher } from "./BeatPresence";
import { floatAt } from "../effects";

const LATIN_ONLY = /^[0-9A-Za-z\s.,:%$€£+\-–—/()'"&]+$/;

export const KineticText: React.FC<{
  beat: Beat;
  visual: VisualSpec;
  accent: string;
  tone?: "paper" | "night";
}> = ({
  beat,
  visual,
  accent,
  tone = "paper",
}) => {
  const { presence, frame } = useBeatPresence();
  const { pad, maxWidth, height } = useStage();

  const shown = visual.words?.length
    ? visual.words
    : visual.text
      ? [visual.text]
      : beat.narration.split(/(?<=[，。！？；、,.!?;])/).filter(Boolean);

  const timings = resolveWordTimings(shown, beat.words);
  const isEmphasis = makeEmphasisMatcher(visual.emphasis);
  const alignLeft = visual.align === "left";
  const toneNight = tone === "night";
  const ink = toneNight ? COLORS.nightInk : COLORS.ink;

  /**
   * 字号要同时满足两个约束，只按词数缩放是不够的：
   *   宽 —— 每行一个词组，最长那条不能超出 maxWidth（一个 20 字的词组会直接冲出画幅）
   *   高 —— 行数 × 行高不能超出上下留白后的可用高度（词组很多时要整体缩）
   * 两边取小的，再夹进 [56, 104]。
   */
  const longest = Math.max(1, ...shown.map((w) => w.replace(/\s/g, "").length));
  const fitWidth = Math.floor(maxWidth / longest);
  const lineHeight = 1.12;
  const rowGapRatio = 0.14;
  const fitHeight = Math.floor(
    (height - 270) / Math.max(1, shown.length * lineHeight + (shown.length - 1) * rowGapRatio),
  );
  const size = Math.max(56, Math.min(104, fitWidth, fitHeight));

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: alignLeft ? "flex-start" : "center",
        // 上下留出角标和出处条的位置，内容再大也不会压到它们
        padding: `140px ${pad}px 130px`,
      }}
    >
      <div
        style={{
          maxWidth,
          display: "flex",
          flexDirection: "column",
          alignItems: alignLeft ? "flex-start" : "center",
          // 每个词组独占一行，行间留出行距的一半——VOX 的顿挫感来自这里。
          // 如果词组挤在一行，读者分不清断句在哪，整段就糊成一句。
          rowGap: size * 0.14,
          opacity: presence,
        }}
      >
        {shown.map((word, i) => {
          const t = timings[i]?.t ?? i * 12;
          const d = timings[i]?.d ?? 9;

          // 入场：上移 + 缩放，6 帧内完成（太快看不清，太慢拖节奏）
          const pop = interpolate(frame, [t, t + 6], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          // 念到之后短暂高亮再回落，给"刚刚说了这句"一个视觉回声
          const echo = interpolate(
            frame,
            [t, t + Math.max(4, d * 0.35), t + Math.max(6, d)],
            [1, 1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          const hot = isEmphasis(word);
          const latin = LATIN_ONLY.test(word) && /\d/.test(word);

          // 落地之后接着慢慢浮。每个词的相位错开，否则整段字一起上下，
          // 看起来像画布在抖而不是字在呼吸。乘 pop 是为了入场前不预位移。
          const bob = floatAt(frame, 8, 88, i) * pop;

          return (
            <span
              key={`${word}-${i}`}
              style={{
                display: "inline-block",
                // 强调词的回声框用 position:absolute + inset:0 贴住这个词。
                // 这里必须显式 relative：否则框会去找更外层的定位祖先，
                // 一不小心就撑满整个画幅（现在只是因为父级恰好有 transform 才碰巧正确）。
                position: "relative",
                fontFamily: latin ? FONT_NUMERAL : FONT_DISPLAY,
                fontWeight: latin ? 400 : 900,
                fontSize: hot ? size * 1.16 : size,
                lineHeight: 1.12,
                letterSpacing: 1,
                color: hot ? accent : ink,
                opacity: pop,
                transform: `translateY(${(1 - pop) * size * 0.3 + bob}px) scale(${0.82 + pop * 0.18})`,
                transformOrigin: "left bottom",
                // 字号已经按最长词组算过了，正常情况下每组都独占一行不换行。
                // 这里仍然允许换行——万一有超长内容，宁可折行也不要冲出画幅。
                whiteSpace: "pre-wrap",
                maxWidth: "100%",
              }}
            >
              {word}
              {hot && echo > 0.01 ? (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 10,
                    boxShadow: `0 0 0 ${Math.round(echo * 10)}px ${accent}55`,
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>

      {visual.source ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            bottom: 96,
            fontSize: 32,
            color: toneNight ? COLORS.nightInk : COLORS.inkFaint,
            letterSpacing: 1,
            opacity: presence * 0.9,
          }}
        >
          来源：{visual.source}
        </div>
      ) : null}
    </div>
  );
};

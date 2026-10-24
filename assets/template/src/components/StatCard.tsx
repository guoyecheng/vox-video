/**
 * 巨大数字卡片。VOX 最常用的"记忆点"——观众记不住论证，但记得住那个数。
 *
 * 数字的滚动起点卡在旁白念到数字的那一刻，所以观众是"边听边看到它长出来"。
 */

import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import {
  useBeatPresence,
  useBeatWords,
  useStage,
  resolveWordTimings,
} from "./BeatPresence";

const format = (n: number, decimals: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const StatCard: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const decimals = visual.decimals ?? 0;
  const target = visual.value ?? 0;

  // 旁白里那个数字被念到的时刻。resolveWordTimings 会自动尝试
  // "3" / "三" 两种写法，所以旁白写"三个"也能对上。
  const speechEnd = beat.words.length
    ? beat.words[beat.words.length - 1].t + beat.words[beat.words.length - 1].d
    : beat.durationInFrames;

  const probe = resolveWordTimings([String(target)], beat.words)[0];
  // 旁白根本没提这个数（常见于年份、总量类），那就按前 22% 起滚，
  // 保证数字在观众听到它之前就已经长到位了
  const startAt =
    beat.words.length && probe
      ? Math.min(probe.t, Math.round(speechEnd * 0.85))
      : Math.round(speechEnd * 0.22);

  const countP = after(startAt, Math.round(fps * 0.9));
  // 计数 0 → target，用 easeOut 让它"冲"到位然后稳住
  const eased = 1 - Math.pow(1 - Math.min(1, countP), 3);
  const shown = format(target * eased, decimals);

  // 单位与标签在数字快到位时才跟上来，避免和数字抢注意力
  const unitP = interpolate(frame, [startAt + 8, startAt + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
        padding: `0 ${pad}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 20,
          opacity: presence,
          transform: `scale(${0.9 + presence * 0.1})`,
        }}
      >
        {visual.prefix ? (
          <span style={{ fontFamily: FONT_NUMERAL, fontSize: 96, color: accent, fontWeight: 900 }}>
            {visual.prefix}
          </span>
        ) : null}

        <span
          style={{
            fontFamily: FONT_NUMERAL,
            fontSize: 320,
            lineHeight: 0.92,
            fontWeight: 900,
            color: COLORS.ink,
            letterSpacing: -8,
            // 数字刷新时轻微抖动一下，强化"在长"的感受
            filter: `drop-shadow(0 10px 40px ${accent}33)`,
          }}
        >
          {shown}
        </span>

        {visual.unit ? (
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 900,
              fontSize: 128,
              color: accent,
              opacity: unitP,
              transform: `translateX(${(1 - unitP) * 24}px)`,
            }}
          >
            {visual.unit}
          </span>
        ) : null}
      </div>

      {visual.label ? (
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 54,
            fontWeight: 700,
            color: COLORS.inkSoft,
            letterSpacing: 2,
            opacity: unitP,
            transform: `translateY(${(1 - unitP) * 20}px)`,
          }}
        >
          {visual.label}
        </div>
      ) : null}

      {visual.suffix ? (
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 32,
            color: COLORS.inkSoft,
            maxWidth: 1000,
            textAlign: "center",
            lineHeight: 1.5,
            opacity: unitP * 0.9,
          }}
        >
          {visual.suffix}
        </div>
      ) : null}

      {visual.source ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            bottom: 96,
            fontSize: 32,
            color: COLORS.inkFaint,
            letterSpacing: 1,
            opacity: presence * 0.85,
          }}
        >
          来源：{visual.source}
        </div>
      ) : null}
    </div>
  );
};

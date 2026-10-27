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
  // 起滚必须早于拍前 18%：数字迟迟不动时，卡片上只剩一个 0.00，
  // 那既不是事实，也不像仪表。值念得早时仍然卡词，念得晚时最多空转一秒多。
  const latestStart = Math.round(beat.durationInFrames * 0.18);
  const startAt =
    beat.words.length && probe
      ? Math.min(probe.t, latestStart)
      : Math.min(Math.round(speechEnd * 0.22), latestStart);

  const countP = after(startAt, Math.round(fps * 0.9));
  // 计数 0 → target，用 easeOut 让它"冲"到位然后稳住
  const eased = 1 - Math.pow(1 - Math.min(1, countP), 3);
  const shown = format(target * eased, decimals);

  // 单位与标签在数字快到位时才跟上来，避免和数字抢注意力
  const unitP = interpolate(frame, [startAt + 8, startAt + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const layout = visual.layout ?? "center";
  const isLeft = layout === "left-edge";
  const isSplit = layout === "split";
  const isBottom = layout === "bottom-third";
  const isBleed = layout === "full-bleed";

  // split 是"数字一半、说明一半"的版式：320px 的六位数会把说明列挤成一条
  // 竖排窄柱（"单价""美元" 还会各自折行）。分栏时整体降一档，并给数字组
  // 加 flexShrink: 0，让说明列拿到固定可读宽度。
  const numeralSize = isSplit ? 200 : 320;
  const unitSize = isSplit ? 96 : 128;
  const prefixSize = isSplit ? 64 : 96;
  const metaWidth = Math.round(560);

  const numberGroup = (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: isSplit ? 18 : 20,
        flexShrink: 0,
        opacity: presence,
        transform: `scale(${0.9 + presence * 0.1})`,
      }}
    >
      {visual.prefix ? (
        <span
          style={{
            fontFamily: FONT_NUMERAL,
            fontSize: prefixSize,
            color: accent,
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          {visual.prefix}
        </span>
      ) : null}

      <span
        style={{
          fontFamily: FONT_NUMERAL,
          fontSize: numeralSize,
          lineHeight: 0.92,
          fontWeight: 900,
          color: COLORS.ink,
          letterSpacing: -8,
          whiteSpace: "nowrap",
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
            fontSize: unitSize,
            color: accent,
            whiteSpace: "nowrap",
            opacity: unitP,
            transform: `translateX(${(1 - unitP) * 24}px)`,
          }}
        >
          {visual.unit}
        </span>
      ) : null}
    </div>
  );

  const meta = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        alignItems: isLeft || isSplit ? "flex-start" : "center",
        ...(isSplit ? { flex: "0 0 auto", width: metaWidth, maxWidth: metaWidth } : {}),
      }}
    >
      {visual.label ? (
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: isSplit ? 46 : 54,
            fontWeight: 700,
            color: COLORS.inkSoft,
            letterSpacing: isSplit ? 1 : 2,
            lineHeight: 1.35,
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
            maxWidth: isSplit ? 700 : 1000,
            textAlign: isLeft || isSplit ? "left" : "center",
            lineHeight: 1.5,
            opacity: unitP * 0.9,
          }}
        >
          {visual.suffix}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: isSplit ? "row" : "column",
        alignItems: isLeft ? "flex-start" : "center",
        justifyContent: isBottom ? "flex-end" : "center",
        gap: isSplit ? 60 : 26,
        padding: isBleed
          ? `80px ${pad}px 90px`
          : isBottom
            ? `0 ${pad}px 190px`
            : isSplit
              ? `0 ${Math.round(pad * 0.72)}px 120px`
              : `0 ${pad}px`,
      }}
    >
      {numberGroup}
      {meta}

      {visual.source ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            // 字幕轨占底部约 210px，出处压在 96 会被整条盖住
            bottom: 228,
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

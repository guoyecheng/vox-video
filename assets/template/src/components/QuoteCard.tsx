/**
 * 引述卡。深色底 + 巨大的引号，和前面的纸面场景形成明暗跳变——
 * VOX 用这个告诉观众"这段不一样，是别人说的话"。
 */

import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useStage, resolveWordTimings } from "./BeatPresence";
import { splitByEmphasis } from "../words";
import { PaperTile } from "./PaperTile";

export const QuoteCard: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { pad, maxWidth } = useStage();
  const frame = useCurrentFrame();

  const text = visual.text ?? beat.narration;

  // 引述不整段一起淡入（那是最像 PPT 的一种出场）：按旁白的词级时间戳分段进场，
  // 强调短语单独贴成纸片。分段只按强调词切，标点留在相邻段里，版面不会碎。
  const parts = splitByEmphasis(text, visual.emphasis);
  const timings = resolveWordTimings(
    parts.map((p) => p.text),
    beat.words,
  );
  const isPurePunct = (s: string) => !/[A-Za-z0-9\u4e00-\u9fa5]/.test(s);
  const at = (i: number) => {
    const raw = timings[i]?.t ?? 0;
    // 单独成段的标点没有自己的发音：跟着前一段一起出现，别让句号晚半拍
    return i > 0 && isPurePunct(parts[i].text) ? (timings[i - 1]?.t ?? raw) : raw;
  };
  const hotParts = parts.map((p, i) => (p.hot ? i : -1)).filter((i) => i >= 0);
  const firstHot = hotParts.length ? hotParts[0] : -1;
  // 和 KineticText 同一条规则：每拍最多两张纸片
  const tiled = new Set(hotParts.slice(0, 2));
  const hasTile = firstHot >= 0;
  const size = text.length > 40 ? 60 : text.length > 22 ? 76 : 92;
  // 出处跟着最后一段走，不跟着整段文字的第一句
  const tailT = at(parts.length - 1) + 7;
  const attrP = interpolate(frame, [tailT, tailT + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 引号先砸进来，比文字早 6 帧，像一个"啪"的标点
  const markP = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const layout = visual.layout ?? "center";
  const isLeft = layout === "left-edge";
  const isBottom = layout === "bottom-third";
  const isBleed = layout === "full-bleed";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: isLeft ? "flex-start" : "center",
        justifyContent: isBottom ? "flex-end" : "center",
        padding: isBleed
          ? `80px ${pad}px 90px`
          : isBottom
            ? `140px ${pad}px 190px`
            : `140px ${pad}px 130px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: pad - 24,
          top: "50%",
          transform: `translateY(-62%) scale(${0.6 + markP * 0.4})`,
          fontFamily: FONT_DISPLAY,
          fontWeight: 900,
          fontSize: 420,
          lineHeight: 1,
          color: accent,
          opacity: markP * 0.22,
        }}
      >
        “
      </div>

      <div
        style={{
          position: "relative",
          maxWidth,
          fontFamily: FONT_DISPLAY,
          fontWeight: 900,
          fontSize: size,
          // 有纸片时行距要抬高：纸片的 padding 和投影会伸出行高
          lineHeight: hasTile ? 1.5 : 1.35,
          color: COLORS.nightInk,
          opacity: presence,
        }}
      >
        {parts.map((p, i) => {
          const t = at(i);
          const pIn = interpolate(frame, [t, t + 7], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          if (!p.hot || !tiled.has(i)) {
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: pIn,
                  transform: `translateY(${(1 - pIn) * 22}px)`,
                }}
              >
                {p.text}
              </span>
            );
          }

          const draw = interpolate(frame, [t + 2, t + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <PaperTile
              key={i}
              text={p.text}
              at={t}
              seed={i * 7 + 3}
              size={size * 1.02}
              variant={visual.tile ?? "auto"}
              order={hotParts.indexOf(i)}
              underline={draw}
              tape={i === firstHot}
            />
          );
        })}
      </div>

      {visual.attribution ? (
        <div
          style={{
            marginTop: 44,
            paddingLeft: 28,
            borderLeft: `6px solid ${accent}`,
            fontFamily: FONT_BODY,
            fontSize: 32,
            fontWeight: 500,
            color: COLORS.nightInk,
            transform: `translateX(${(1 - attrP) * -18}px)`,
            opacity: attrP * 0.68,
          }}
        >
          {visual.attribution}
        </div>
      ) : null}
    </div>
  );
};
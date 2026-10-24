/**
 * 引述卡。深色底 + 巨大的引号，和前面的纸面场景形成明暗跳变——
 * VOX 用这个告诉观众"这段不一样，是别人说的话"。
 */

import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";

export const QuoteCard: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, maxWidth } = useStage();
  const frame = useCurrentFrame();

  const text = visual.text ?? beat.narration;
  const probe = resolveWordTimings([text.slice(0, 6)], beat.words)[0];
  const textP = after(probe?.t ?? 0, 14);

  // 引号先砸进来，比文字早 6 帧，像一个"啪"的标点
  const markP = interpolate(frame, [0, 10], [0, 1], {
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
        justifyContent: "center",
        padding: `140px ${pad}px 130px`,
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
          fontSize: text.length > 40 ? 60 : text.length > 22 ? 76 : 92,
          lineHeight: 1.35,
          color: COLORS.nightInk,
          opacity: textP * presence,
          transform: `translateY(${(1 - textP) * 26}px)`,
        }}
      >
        {text}
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
            transform: `translateX(${(1 - textP) * -18}px)`,
            opacity: textP * 0.68,
          }}
        >
          {visual.attribution}
        </div>
      ) : null}
    </div>
  );
};
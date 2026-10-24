/**
 * 对比双栏。用于 A vs B、过去 vs 现在、方案一 vs 方案二。
 *
 * 两栏不是同时出现的：左栏在旁白第一个分句时进，右栏等到旁白说到对比词
 * 才进。这个错位是"对比"这个语义的主要来源——同进同出就只是并排而已。
 */

import React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL, fontFor } from "../fonts";
import type { Beat, SideSpec, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";
import { floatAt } from "../effects";
import { PaperSheet, PAPER, sway } from "../paper";

const fallback: SideSpec = { title: "", detail: "" };

export const CompareSplit: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();
  const frame = useCurrentFrame();

  const left = visual.left ?? fallback;
  const right = visual.right ?? fallback;

  // 右栏起点：旁白里第一次出现右栏标题的词
  const probe = resolveWordTimings([(right.title ?? "").slice(0, 4)], beat.words)[0];
  const rightAt = probe?.t ?? Math.round(beat.durationInFrames * 0.45);

  const leftP = after(0, 16);
  const rightP = after(rightAt, 16);
  const vsP = after(rightAt - 6, 10);

  const panel = (
    side: SideSpec,
    p: number,
    dir: 1 | -1,
  ) => (
    <PaperSheet
      seed={dir > 0 ? 4 : 9}
      color={PAPER.sheet}
      style={{
        flex: 1,
        display: "flex",
        opacity: p,
        // 两栏反向浮动：一边升一边降，对比关系在一呼一吸里被强化
        transform: `translate(${sway(frame, dir > 0 ? 4 : 9).x}px, ${
          sway(frame, dir > 0 ? 4 : 9).y
        }px) translateX(${(1 - p) * 80 * dir}px) translateY(${
          floatAt(frame, 8, 90, dir > 0 ? 2 : 1) * -dir
        }px) rotate(${dir * 0.5}deg)`,
      }}
      contentStyle={{ display: "flex", height: "100%" }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          // 三等分竖着排：标题顶、大字中、解释底。整幅高度都用上，
          // 否则两栏只有 360px 高，剩下 500px 是空纸（帧差直接被摊平）
          justifyContent: "space-between",
          gap: 24,
          padding: `64px ${Math.round(pad * 0.5)}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            alignItems: dir > 0 ? "flex-end" : "flex-start",
          }}
        >
          {/* 一小条色纸压在栏目标题上，代替原来的彩色描边 */}
          <div
            style={{
              width: 76,
              height: 10,
              background: accent,
              transform: `rotate(${dir * -1.4}deg)`,
            }}
          />
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: 4,
              color: COLORS.inkSoft,
              textTransform: "uppercase",
              opacity: 0.8,
            }}
          >
            {side.title}
          </div>
        </div>
        {side.value ? (
          <div
            style={{
              fontFamily: fontFor(side.value),
              // 4 个字在 140px 会撑破栏宽折成两行（"一直在烂"），按字数收一档
              fontSize: Math.min(140, Math.floor(470 / Math.max(2, side.value.length))),
              fontWeight: fontFor(side.value) === FONT_NUMERAL ? 400 : 900,
              lineHeight: 1.05,
              color: COLORS.ink,
              letterSpacing: -2,
              whiteSpace: "nowrap",
            }}
          >
            {side.value}
          </div>
        ) : null}
        {side.detail ? (
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 38,
              lineHeight: 1.5,
              color: COLORS.inkSoft,
            }}
          >
            {side.detail}
          </div>
        ) : null}
      </div>
    </PaperSheet>
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "stretch",
        gap: Math.round(pad * 0.4),
        padding: `140px ${pad}px 120px`,
        opacity: presence,
      }}
    >
      {panel(left, leftP, -1)}

      <div
        style={{
          flex: "0 0 auto",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 10px",
        }}
      >
        {/* 贯穿两栏的分界线：让"对比"读完不是两块漂浮的方块 */}
        <div
          style={{
            position: "absolute",
            top: 70,
            bottom: 70,
            left: "50%",
            width: 3,
            marginLeft: -1,
            background: COLORS.rule,
          }}
        />
        <div
          style={{
            position: "relative",
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            fontSize: 56,
            lineHeight: 1.2,
            textAlign: "center",
            color: COLORS.ink,
            background: COLORS.paper,
            padding: "20px 0",
            opacity: vsP,
            transform: `scale(${(0.6 + vsP * 0.4) * (1 + 0.035 * Math.sin(frame / 9.2))})`,
          }}
        >
          {visual.vsLabel ?? "VS"}
        </div>
      </div>

      {panel(right, rightP, 1)}
    </div>
  );
};

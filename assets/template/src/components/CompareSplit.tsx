/**
 * 对比双栏。用于 A vs B、过去 vs 现在、方案一 vs 方案二。
 *
 * 两栏不是同时出现的：左栏在旁白第一个分句时进，右栏等到旁白说到对比词
 * 才进。这个错位是"对比"这个语义的主要来源——同进同出就只是并排而已。
 *
 * 版式按风格板的剪贴逻辑：
 *   · 每栏是一张有毛边、带网点、顶端贴胶带的纸，不是圆角卡片；
 *   · 栏内除了标题/说明，还可以放一个**剪出来的形状**（`mark`）——
 *     中间那块最大的空纸，不该空着；
 *   · 标题下面一条红笔划过去，和 KineticText 的强调是同一个手势。
 */

import React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL, fontFor } from "../fonts";
import type { Beat, SideSpec, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";
import { floatAt } from "../effects";
import { BrushUnderline, PaperSheet, PAPER, sway, Tape } from "../paper";

const fallback: SideSpec = { title: "", detail: "" };

type MarkKind = NonNullable<SideSpec["mark"]>;

const MARK_PATHS: Record<MarkKind, string> = {
  square: "M 10 12 H 92 V 88 H 10 Z",
  circle: "M 50 6 A 44 44 0 1 0 50 94 A 44 44 0 1 0 50 6 Z",
  triangle: "M 50 8 L 94 92 L 6 92 Z",
  // 勒洛三角：三段以对顶点为圆心的弧。弧会略微鼓出三角的外接框，所以 svg 不裁切
  reuleaux: "M 6 88 A 93 93 0 0 1 94 88 A 93 93 0 0 1 50 6 A 93 93 0 0 1 6 88 Z",
  hex: "M 26 8 H 74 L 94 50 L 74 92 H 26 L 6 50 Z",
};

/** 一栏里的图形。网点填充 + 黑描边 + 红色偏移剪影，是风格板的组件语法。
 *  批注层（NoteLayer）也用同一个图形，保证"剪出来的形状"只有一种画法。 */
export const ShapeMark: React.FC<{
  kind: MarkKind;
  accent: string;
  p: number;
  rotate: number;
  size: number;
}> = ({ kind, accent, p, rotate, size }) => {
  const uid = React.useId().replace(/:/g, "");
  const path = MARK_PATHS[kind];
  const pop = Math.min(1, Math.max(0, p));

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      style={{
        width: size,
        height: size,
        overflow: "visible",
        opacity: pop,
        transform: `rotate(${rotate + (1 - pop) * 6}deg) scale(${0.84 + 0.16 * pop})`,
      }}
    >
      <defs>
        <pattern id={`ht-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={PAPER.sheet} />
          <circle cx="3" cy="3" r="1.9" fill={COLORS.ink} opacity="0.62" />
        </pattern>
      </defs>
      {/* 红色偏移剪影：先画在下面，错开一点，读作"剪下来贴在红纸上" */}
      <path d={path} fill={accent} transform="translate(6 8)" opacity="0.92" />
      <path d={path} fill={`url(#ht-${uid})`} stroke={COLORS.ink} strokeWidth="4.5" strokeLinejoin="round" />
    </svg>
  );
};

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

  const panel = (side: SideSpec, p: number, dir: 1 | -1) => (
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
      {/* 顶端胶带：贴上去的纸才会用胶带，卡片不会 */}
      <div style={{ position: "absolute", left: "50%", top: -20, marginLeft: -76 }}>
        <Tape seed={dir > 0 ? 12 : 18} width={152} height={40} angle={dir * 2.6} />
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: `58px ${Math.round(pad * 0.5)}px 52px`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
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
              position: "relative",
              display: "inline-block",
              fontFamily: FONT_BODY,
              fontSize: 46,
              fontWeight: 900,
              letterSpacing: 3,
              color: COLORS.ink,
            }}
          >
            {side.title}
            <BrushUnderline
              p={Math.max(0, (p - 0.45) / 0.55)}
              color={COLORS.accent}
              seed={dir > 0 ? 21 : 27}
              thickness={8}
            />
          </div>
        </div>

        {/* 中间：放大字 / 图形 / 留白。图形是这一栏的论点，不是插图 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          {side.value ? (
            <div
              style={{
                fontFamily: fontFor(side.value),
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
          ) : side.mark ? (
            <ShapeMark
              kind={side.mark}
              accent={accent}
              p={Math.max(0, (p - 0.3) / 0.7)}
              rotate={dir * 3}
              size={380}
            />
          ) : null}
        </div>

        {side.detail ? (
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            <div style={{ width: 6, background: accent, transform: "rotate(-1.2deg)" }} />
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 37,
                lineHeight: 1.45,
                color: COLORS.inkSoft,
              }}
            >
              {side.detail}
            </div>
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
        // 底部让出字幕带：两栏的 detail 贴栏底，压到 120 会被字幕整行盖住
        padding: `140px ${pad}px 250px`,
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
        {/* 贯穿两栏的分界线：做成虚线裁切线，而不是 PPT 的实线分隔 */}
        <div
          style={{
            position: "absolute",
            top: 70,
            bottom: 70,
            left: "50%",
            width: 0,
            marginLeft: -1,
            borderLeft: `3px dashed ${COLORS.ink}2E`,
          }}
        />
        <div
          style={{
            position: "relative",
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            fontSize: 54,
            lineHeight: 1.2,
            textAlign: "center",
            whiteSpace: "nowrap",
            color: COLORS.ink,
            background: PAPER.sheetWarm,
            padding: "16px 26px",
            opacity: vsP,
            transform: `rotate(-3deg) scale(${(0.7 + vsP * 0.3) * (1 + 0.03 * Math.sin(frame / 9.2))})`,
            clipPath: "polygon(1% 3%, 99% 0%, 100% 96%, 2% 100%)",
            boxShadow: "6px 7px 0 rgba(214,46,31,0.85), 0 14px 24px rgba(46,34,18,0.24)",
          }}
        >
          {visual.vsLabel ?? "VS"}
        </div>
      </div>

      {panel(right, rightP, 1)}
    </div>
  );
};

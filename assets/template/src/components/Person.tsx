/**
 * 人物卡。历史/传记类片子的主力组件。
 *
 * 一张卡讲清"这是谁"：肖像、姓名、身份年代、一句关键台词。
 * 肖像入场带一记镜头冲击——人物出现在画面上应该有重量。
 * 没给 src 时用姓氏字做占位，抽象剪影也是能用的表现手法。
 */

import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import {
  useBeatPresence,
  useBeatWords,
  useStage,
  resolveWordTimings,
} from "./BeatPresence";
import { floatAt, LightSweep, useImpact } from "../effects";
import { sway, PaperSheet } from "../paper";

export const Person: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence, frame } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();

  const name = visual.name ?? "";
  const timings = resolveWordTimings([name], beat.words, beat.durationInFrames);
  const at = timings[0]?.t ?? 0;

  // 肖像在人物名被念到的那一帧弹入
  const impact = useImpact(at, "heavy");
  const portraitP = interpolate(frame, [at, at + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const detailP = after(at + 8, 12);
  const quoteP = after(at + 18, 14);

  const flip = visual.side === "right";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: flip ? "row-reverse" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: Math.round(pad * 0.9),
        padding: `150px ${pad}px 140px`,
        opacity: presence,
      }}
    >
      {/* ---- 肖像 ---- */}
      <div style={{ ...impact, position: "relative", flex: "0 0 auto" }}>
        <div
          style={{
            width: 330,
            height: 330,
            borderRadius: 165,
            overflow: "hidden",
            background: `${accent}1F`,
            border: `8px solid ${COLORS.ink}`,
            boxShadow: `16px 16px 0 ${accent}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // 肖像入场后继续缓慢起伏，像照片被举在手里而不是钉在墙上
            transform: `translate(${sway(frame, 3).x}px, ${sway(frame, 3).y}px) scale(${
              0.55 + portraitP * 0.45
            }) translateY(${floatAt(frame, 8, 94, 3)}px)`,
          }}
        >
          {visual.src ? (
            <Img
              src={staticFile(visual.src)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            // 没有照片时用姓氏字。抽象但明确，不会让人误以为有图
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 900,
                fontSize: 168,
                color: COLORS.ink,
                lineHeight: 1,
              }}
            >
              {name.slice(0, 1) || "？"}
            </span>
          )}
        </div>

        {visual.tag ? (
          <div
            style={{
              position: "absolute",
              bottom: -14,
              [flip ? "left" : "right"]: -22,
              padding: "10px 24px",
              background: accent,
              color: COLORS.paper,
              borderRadius: 999,
              fontFamily: FONT_BODY,
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 2,
              opacity: detailP,
              transform: `translateY(${(1 - detailP) * 16}px)`,
            }}
          >
            {visual.tag}
          </div>
        ) : null}
      </div>

      {/* ---- 姓名 / 身份 / 台词 ---- */}
      {/* 姓名不是直接浮在底纸上，而是印在一张纸上：人物拍只有两三个元素，
          不给它们一张纸，右半边就是一大片空的牛皮底 */}
      <PaperSheet
        seed={12}
        frame={frame}
        style={{ flex: 1, minWidth: 0, maxWidth: 900 }}
        contentStyle={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          alignItems: flip ? "flex-end" : "flex-start",
          textAlign: flip ? "right" : "left",
          padding: "44px 52px",
        }}
      >
        {/* 姓名逐字落位，而不是整块淡入。人名的三四个字是这一拍最大的
            一块墨色，逐字下落才有"被念出来"的节奏；整块淡入等于一帧之内
            画面就静止了 */}
        <div
          style={{
            display: "flex",
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            fontSize: 116,
            lineHeight: 1.05,
            color: COLORS.ink,
            letterSpacing: 2,
            transform: `translateY(${floatAt(frame, 7, 104, 4)}px)`,
          }}
        >
          {[...name].map((ch, i) => {
            const cp = after(at + 4 + i * 3, 10);
            return (
              <span
                key={`${ch}-${i}`}
                style={{
                  display: "inline-block",
                  opacity: cp,
                  transform: `translateY(${(1 - cp) * 42}px)`,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>

        {visual.role ? (
          <div
            style={{
              fontFamily: FONT_NUMERAL,
              fontSize: 34,
              letterSpacing: 2,
              color: accent,
              opacity: detailP,
              transform: `translateY(${(1 - detailP) * 20}px)`,
            }}
          >
            {visual.role}
          </div>
        ) : null}

        {visual.quote ? (
          <div
            style={{
              marginTop: 14,
              paddingLeft: flip ? 0 : 26,
              paddingRight: flip ? 26 : 0,
              borderLeft: flip ? "none" : `6px solid ${COLORS.rule}`,
              borderRight: flip ? `6px solid ${COLORS.rule}` : "none",
              fontFamily: FONT_BODY,
              fontSize: 38,
              lineHeight: 1.5,
              color: COLORS.inkSoft,
              opacity: quoteP,
              transform: `translateY(${(1 - quoteP) * 20}px)`,
            }}
          >
            {visual.quote}
          </div>
        ) : null}
      </PaperSheet>

      {/* 人物拍通常是"一张照片 + 两行字"，信息极薄；给它一道缓慢扫过的光，
          画面才有"被拍摄"的实感 */}
      <LightSweep duration={Math.round(beat.durationInFrames * 1.1)} color="#FFF3DC" width={55} />
    </div>
  );
};

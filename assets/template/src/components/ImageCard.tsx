/**
 * 配图卡。图片放 `public/img/`，script.json 里写 `src: "img/foo.jpg"`。
 *
 * 没有图片时退化成一块带图标感的占位板，这样 script.json 里的 `kind:"image"`
 * 不会因为忘记放图而整拍空掉——占位板本身也能用，是抽象配图的合理选择。
 */

import React from "react";
import { Img, interpolate, staticFile } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { TIMELINE, type Beat, type VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";
import { PAPER, PaperSheet, Tape, sway, roughEdge } from "../paper";

export const ImageCard: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence, frame } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, height, width } = useStage();

  const probe = resolveWordTimings([(visual.caption ?? "").slice(0, 4)], beat.words, beat.durationInFrames)[0];
  const captionP = after(probe?.t ?? 0, 14);

  // 字幕轨开着时，底部 96px 内边距 + 单行 60px 字幕是禁入区。
  // 图不能按 78% 宽度硬撑——16:9 撑满 78% 有 842px 高，加上上边距就顶穿字幕。
  // 所以同时受可用宽度和可用高度约束，谁更紧听谁的。
  const TOP = 140;
  const bottomReserve = TIMELINE.captions ? 220 : 120;
  const maxW = Math.round(width * 0.78);
  const maxH = height - TOP - bottomReserve;
  const imgH = Math.round(Math.min(maxH, (maxW * 9) / 16));
  const imgW = Math.round((imgH * 16) / 9);

  // 图内推近：1.02 → 1.14 全程推进，并带一点横向游移。
  // 原来是 1.06 → 1 的缓慢回缩，幅度太小、方向又是"退"，测出来几乎是静止画面。
  const zoomP = interpolate(frame, [0, beat.durationInFrames], [1.02, 1.14], {
    extrapolateRight: "clamp",
  });
  const panP = interpolate(frame, [0, beat.durationInFrames], [-1.6, 1.6], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${TOP}px ${pad}px ${bottomReserve}px`,
        opacity: presence,
      }}
    >
      <PaperSheet
        seed={5}
        radius={3}
        rough={1.6}
        style={{
          width: imgW + 36,
          height: imgH + 36,
          transform: `translate(${sway(frame, 5).x}px, ${sway(frame, 5).y}px) scale(${
            0.94 + presence * 0.06
          }) rotate(-0.7deg)`,
        }}
        contentStyle={{ width: "100%", height: "100%", padding: 18, boxSizing: "border-box" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            background: COLORS.paperAlt,
          }}
        >
        {visual.src ? (
          <Img
            src={staticFile(visual.src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${zoomP}) translateX(${panP}%)`,
            }}
          />
        ) : (
          // 占位板：抽象色块 + 十字准星，看起来像"这里本来就有张图"
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `repeating-linear-gradient(45deg, ${COLORS.paperAlt} 0 22px, ${COLORS.paper} 22px 44px)`,
            }}
          >
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 900,
                fontSize: 40,
                color: COLORS.inkFaint,
                letterSpacing: 6,
              }}
            >
              IMG · {visual.src ?? "未指定"}
            </div>
          </div>
        )}

        {/* 说明文字压在图里左下角，像图注。做成一张小纸条贴在照片上，
            比半透明黑底更符合拼贴的语言，也更容易在亮图上读清 */}
        {visual.caption ? (
          <div
            style={{
              position: "absolute",
              left: 26,
              bottom: 26,
              maxWidth: "72%",
              padding: "10px 24px",
              background: PAPER.sheet,
              clipPath: roughEdge(23, 1.6, 7),
              boxShadow: "0 8px 16px rgba(40,28,12,0.28)",
              fontFamily: FONT_BODY,
              fontSize: 34,
              fontWeight: 700,
              lineHeight: 1.35,
              color: COLORS.ink,
              opacity: captionP,
              transform: `translateY(${(1 - captionP) * 12}px) rotate(-0.9deg)`,
            }}
          >
            {visual.caption}
          </div>
        ) : null}
        </div>

        {/* 胶带只贴两个角：四角全贴会变成"信封"，两角才像随手钉在纸上 */}
        <Tape seed={31} width={150} height={46} angle={-38} style={{ left: -34, top: -16, opacity: 0.9 }} />
        <Tape seed={37} width={150} height={46} angle={38} style={{ right: -34, top: -16, opacity: 0.9 }} />
      </PaperSheet>
    </div>
  );
};
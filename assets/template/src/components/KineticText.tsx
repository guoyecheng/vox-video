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
import { hash01, BrushUnderline } from "../paper";
import { splitByEmphasis } from "../words";
import { PaperTile } from "./PaperTile";

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
  const layout = visual.layout ?? "center";
  const alignLeft = visual.align === "left" || layout === "left-edge";
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
  // 底部字幕条常驻：56px 字号 + 上下 padding + 96px 底距 ≈ 210px，
  // 再留 30px 呼吸。运镜会整幅放大（push_in ×1.035、whip ×1.2），
  // 放大会把内容继续往下推，所以留白要按缩放后的底边算，不能只看未缩放的排版。
  // bottom-third 锚在下缘，被放大的幅度最大，单独多让 40px。
  const bottomPad = layout === "bottom-third" ? 280 : 240;
  // 强调词比正文高 16%，算总高度时不能漏——漏了就会行数一多就溢出。
  const emphasisLift = 0.16 * lineHeight;
  const rowUnits =
    shown.length * lineHeight +
    (shown.length - 1) * rowGapRatio +
    shown.filter(isEmphasis).length * emphasisLift;
  const fitHeight = Math.floor((height - 140 - bottomPad) / Math.max(1, rowUnits));
  const size = Math.max(56, Math.min(104, fitWidth, fitHeight));

  // 胶带只贴第一张纸片：每拍两张都贴会读成"手工作业"，而不是"编辑挑了一句"
  const heroIdx = shown.map((w, i) => (isEmphasis(w) ? i : -1)).filter((i) => i >= 0);
  const tapeOn = heroIdx.length ? heroIdx[0] : -1;
  // 每拍最多两张纸片。三张以上字就碎了，强调也不再是强调——
  // 多出来的强调词退回"放大 + 红线"，语气还在，体量不再膨胀。
  const tiled = new Set(heroIdx.slice(0, 2));

  // 每词的随机量按"全片帧号 + 词序"取，切镜后同一个词不会突然换个角度
  const safeFrom = Math.max(0, Math.round(Number.isFinite(beat.from) ? beat.from : 0));

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: layout === "bottom-third" ? "flex-end" : "center",
        alignItems: alignLeft ? "flex-start" : "center",
        // 上留角标、下留字幕条，内容再大也不会压到它们；
        // bottom-third 锚在下缘、full-bleed 贴边（配图用），其余居中
        padding:
          layout === "full-bleed"
            ? `80px ${pad}px 90px`
            : `140px ${pad}px ${bottomPad}px`,
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

          // 每词的入场在同一个语法里留一点差异：旋转、落定速度、偶尔的侧贴。
          // 全片同一个 pop 会让整段字读成"模板在播放"，而不是"一张张摆上去"。
          const seed = i * 37 + 11 + (safeFrom % 97);
          const popSpan = 6 + Math.round(hash01(seed + 9) * 3);
          const pop = interpolate(frame, [t, t + popSpan], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const rot0 = (hash01(seed + 5) - 0.5) * 3.4;
          const side =
            hash01(seed + 3) > 0.66 ? (hash01(seed + 11) > 0.5 ? 1 : -1) * size * 0.12 : 0;

          // 强调词不再套一圈发光框（那是 UI 的语法）：去掉纸底下那一条红笔线，
          // 换成一张贴上去的纸片——划线仍然保留在纸片上，和旁白落在同一个词上。
          const draw = interpolate(frame, [t + 1, t + 9], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          const hot = isEmphasis(word);
          const latin = LATIN_ONLY.test(word) && /\d/.test(word);

          // 落地之后接着慢慢浮。每个词的相位错开，否则整段字一起上下，
          // 看起来像画布在抖而不是字在呼吸。乘 pop 是为了入场前不预位移。
          const bob = floatAt(frame, 8, 88, i) * pop;

          if (hot && tiled.has(i)) {
            // 强调只贴短语本身："是几何"里应该是"几何"这张纸片，"是"还是正文
            const raw = splitByEmphasis(word, visual.emphasis);
            const parts = raw.some((p) => p.hot) ? raw : [{ text: word, hot: true }];
            return (
              <span
                key={`${word}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  justifyContent: alignLeft ? "flex-start" : "center",
                  flexWrap: "wrap",
                  maxWidth: "100%",
                }}
              >
                {parts.map((p, k) =>
                  p.hot ? (
                    <PaperTile
                      key={k}
                      text={p.text}
                      at={t}
                      seed={seed + k * 7}
                      size={size * 1.08}
                      variant={visual.tile ?? "auto"}
                      order={heroIdx.indexOf(i)}
                      underline={draw}
                      tape={tapeOn === i}
                    />
                  ) : (
                    <span
                      key={k}
                      style={{
                        display: "inline-block",
                        fontFamily: latin ? FONT_NUMERAL : FONT_DISPLAY,
                        fontWeight: latin ? 400 : 900,
                        fontSize: size,
                        lineHeight: 1.12,
                        letterSpacing: 1,
                        color: ink,
                        opacity: pop,
                        transform: `translateY(${(1 - pop) * size * 0.24}px)`,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {p.text}
                    </span>
                  ),
                )}
              </span>
            );
          }

          return (
            <span
              key={`${word}-${i}`}
              style={{
                display: "inline-block",
                // 红线用 position:absolute 贴住词底，所以这里必须显式 relative：
                // 否则线会去找更外层的定位祖先，一不留神就撑满整个画幅。
                position: "relative",
                fontFamily: latin ? FONT_NUMERAL : FONT_DISPLAY,
                fontWeight: latin ? 400 : 900,
                fontSize: hot ? size * 1.16 : size,
                lineHeight: 1.12,
                letterSpacing: 1,
                color: ink,
                opacity: pop,
                transform: `translate(${(side * (1 - pop)).toFixed(1)}px, ${
                  (1 - pop) * size * 0.26 + bob
                }px) rotate(${(rot0 * (1 - pop)).toFixed(2)}deg) scale(${(0.86 + pop * 0.14).toFixed(3)})`,
                transformOrigin: "left bottom",
                // 字号已经按最长词组算过了，正常情况下每组都独占一行不换行。
                // 这里仍然允许换行——万一有超长内容，宁可折行也不要冲出画幅。
                whiteSpace: "pre-wrap",
                maxWidth: "100%",
              }}
            >
              {word}
              {hot ? (
                // 超过两张纸片的强调词退回"红笔线"：语气还在，版面不碎
                <BrushUnderline
                  p={draw}
                  color={COLORS.accent}
                  seed={i + 5}
                  thickness={Math.max(6, Math.round(size * 0.085))}
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

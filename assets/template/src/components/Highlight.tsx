/**
 * 荧光笔划线 + 圈注高亮。VOX 系最标志性的两个"手写感"动作。
 *
 *   highlight —— 荧光笔条从左往右扫过，把重点词衬在色带底下
 *   circle    —— 手绘感的椭圆圈住重点，边画边成形
 *
 * 两者都是"画"出来的，不是淡入：色带用 scaleX 生长，椭圆用
 * stroke-dashoffset 描边。给静态文字一点手工感，画面立刻不像模板。
 *
 * 和 `Callout` 的区别：Callout 是在**图片**上圈注，这个是在**文字**上。
 */

import React from "react";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";

export const Highlight: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, maxWidth } = useStage();

  const text = visual.text ?? beat.narration;
  const marks = visual.marks ?? [];
  const circled = visual.circled?.[0];

  // 划线/圈注的时机：念到第一个重点词的那一帧
  const probe = resolveWordTimings(
    marks[0] ? [marks[0]] : circled ? [circled] : [text.slice(0, 4)],
    beat.words,
    beat.durationInFrames,
  )[0];
  const at = probe?.t ?? 0;

  // 划线段和圈注段各按自己的节奏进场：划线先起，圈注稍晚追上
  const markOn = after(at, 22);
  const ring = after(at + 10, 20);

  const fontSize = text.length > 34 ? 60 : text.length > 20 ? 76 : 92;

  /**
   * 把整句按标记位置切成段。
   *
   * 关键：必须渲染**整句**，标记段只是其中被套了样式的一部分。
   * 只渲染标记片段的话，屏幕上就只剩那几个词，观众读不到任何上下文——
   * 一句话里的高亮，语义来自它在句子中的位置。
   */
  type Seg = { text: string; mark: boolean; circle: boolean };
  const segments: Seg[] = [];
  let cursor = 0;
  const claimed: { s: number; e: number; circle: boolean }[] = [];

  for (const m of marks) {
    const at2 = text.indexOf(m, cursor);
    if (at2 >= 0) claimed.push({ s: at2, e: at2 + m.length, circle: false });
  }
  // circled 是**一个短语**（visual.circled[0]），不是短语数组。
  // 直接 for...of 会逐字符迭代，把"不是没钱"拆成四个片段、画四个框。
  for (const c of circled ? [circled] : []) {
    const at2 = text.indexOf(c, 0);
    if (at2 >= 0) claimed.push({ s: at2, e: at2 + c.length, circle: true });
  }
  claimed.sort((a, b) => a.s - b.s);

  for (const r of claimed) {
    if (r.s < cursor) continue; // 与前一段重叠，跳过
    if (r.s > cursor) {
      segments.push({ text: text.slice(cursor, r.s), mark: false, circle: false });
    }
    segments.push({ text: text.slice(r.s, r.e), mark: true, circle: r.circle });
    cursor = r.e;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), mark: false, circle: false });
  }

  let markIndex = 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: visual.align === "left" ? "flex-start" : "center",
        padding: `150px ${pad}px 170px`,
        opacity: presence,
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth,
          fontFamily: FONT_DISPLAY,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.5,
          color: COLORS.ink,
          textAlign: visual.align === "left" ? "left" : "center",
        }}
      >
        {segments.map((seg, i) => {
          if (!seg.mark) {
            return <span key={`t-${i}`}>{seg.text}</span>;
          }

          // 划线段和圈注段各自按自己的节奏进场
          const mi = markIndex++;
          const on = seg.circle
            ? ring
            : after(at + mi * 10, 20);
          if (on <= 0.001) {
            return (
              <span key={`m-${i}`} style={{ opacity: 0 }}>
                {seg.text}
              </span>
            );
          }

          return (
            <span
              key={`m-${i}`}
              style={{
                position: "relative",
                display: "inline-block",
                padding: "0 0.08em",
                // 圈注/划线要包住完整短语，不能让浏览器在词中间折行
                whiteSpace: "nowrap",
              }}
            >
              {/* 荧光笔条：从左往右扫，略歪，底边比顶边厚一点点，模仿马克笔 */}
              <span
                style={{
                  position: "absolute",
                  left: "-0.06em",
                  right: "-0.06em",
                  top: "0.12em",
                  bottom: "0.02em",
                  background: accent,
                  opacity: 0.42,
                  borderRadius: 4,
                  transformOrigin: "left center",
                  transform: `scaleX(${seg.circle ? 1 : markOn}) rotate(-0.35deg)`,
                }}
              />
              <span style={{ position: "relative" }}>{seg.text}</span>

              {seg.circle ? (
                // 手绘感圈注：用 CSS 圆角框而不是 SVG 椭圆。
                // 椭圆方案要 preserveAspectRatio="none" 才能贴合非等比的行内块，
                // 再叠上 non-scaling-stroke，描边会被拉成一串交叠的环。
                // 圆角框 + 一点旋转更稳，"手画感"主要来自不规则的角度和边距。
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: "-0.1em",
                    right: "-0.1em",
                    top: "-0.16em",
                    bottom: "-0.1em",
                    border: `5px solid ${accent}`,
                    // 四个角的半径故意不等，模拟手画。
                    // 用 px 不用 %：短语宽度会变（圈 2 个字还是 8 个字），
                    // 百分比会让同一组值在窄框上变成圆角、宽框上几乎变成直角。
                    borderRadius: "42px 34px 46px 38px / 60px 52px 62px 54px",
                    transform: `rotate(-2.2deg) scale(${0.6 + on * 0.4})`,
                    transformOrigin: "center",
                    opacity: on,
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </span>
          );
        })}

        {visual.caption ? (
          <div
            style={{
              marginTop: 44,
              fontFamily: FONT_BODY,
              fontSize: 34,
              fontWeight: 400,
              color: COLORS.inkSoft,
              lineHeight: 1.5,
            }}
          >
            {visual.caption}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * 字幕轨。跟随旁白逐句显示，全片常驻。
 *
 * 为什么单独做而不是当某一拍的组件：字幕是**旁白的投影**，不是画面内容。
 * 旁白说了什么，屏幕上就该出现什么；它跟着音频走，不跟视觉走。
 * 所以它挂在最外层，读全部 beats，自己算当前该显示哪一句。
 *
 * 句子怎么切：edge-tts 返回的词级时间戳里，中文标点是**独立的 boundary**
 * （"。" "，" 各自占一个词）。所以遇到纯标点就断句，顺带天然对齐
 * 停顿——不用自己猜该在哪切。
 */

import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY } from "../fonts";
import { BEATS, type WordTiming } from "../timeline";
import { useStage } from "./BeatPresence";
import { PAPER, roughEdge } from "../paper";

type Sentence = {
  text: string;
  /** 全片绝对帧 */
  from: number;
  to: number;
};

/** 句末标点。断句只认这些。 */
const HARD_BREAK = /[。！？!?；;…]/;
/** 可选的软断点：句太长时用它切，避免字幕一行拉太宽 */
const SOFT_BREAK = /[，,、]/;
const IS_PUNCT = /[，。！？；、,.!?;:：…—\s]/;
/** 软断点前最多能攒多少字 */
const SOFT_MAX = 16;

type CharRef = { t: number; d: number };

/**
 * 从 idx 往回找第一个有时间的字符（跳过标点）。
 * 句末标点自己不带时间，所以一句话的「结束时刻」要落在它前一个实词上。
 */
const lastTimedAt = (refs: (CharRef | null)[], idx: number): CharRef | null => {
  for (let i = Math.min(idx, refs.length - 1); i >= 0; i--) {
    if (refs[i]) return refs[i];
  }
  return null;
};

/**
 * 把旁白原文的每个字符映射到词级时间戳。
 *
 * 为什么不能直接用 word boundary 断句：edge-tts **不把标点作为独立
 * boundary 输出**（实测 words 拼起来 = narration 去掉所有标点），
 * 偶尔还会把「是」「的」这类常用单字单独切出来。所以词边界和标点
 * 对不上，必须走原文的标点，再把字符位置反查回词级时间。
 *
 * 关键：**下标必须和 narration 严格对齐**，标点位置留 null。
 * 早先版本跳过标点后返回紧凑数组，再用含标点的下标去查，
 * 第一句之后就整体错位——字幕会提前或滞后显示。
 */
const buildCharMap = (narration: string, words: WordTiming[]): (CharRef | null)[] => {
  const refs: (CharRef | null)[] = new Array(narration.length).fill(null);
  let w = 0;
  let k = 0;

  for (let i = 0; i < narration.length; i++) {
    const ch = narration[i];
    if (IS_PUNCT.test(ch)) continue; // 标点不消耗 word 字符
    // 跳过已被前面的词消耗的字符（防御性：万一有词边界重叠）
    while (w < words.length && k >= words[w].text.length) {
      w += 1;
      k = 0;
    }
    if (w >= words.length) break;
    refs[i] = { t: words[w].t, d: words[w].d };
    k += 1;
  }
  return refs;
};

const splitSentences = (
  narration: string,
  words: WordTiming[],
  beatFrom: number,
  fallbackDuration: number,
): Sentence[] => {
  const refs = buildCharMap(narration, words);
  const out: Sentence[] = [];
  if (!refs.some(Boolean)) {
    if (narration.trim()) {
      out.push({ text: narration.trim(), from: beatFrom, to: beatFrom + fallbackDuration });
    }
    return out;
  }

  let start = 0;
  /** 最近一个软断点（句内逗号）的下标。只是**候选**，不代表本句到此为止 */
  let softPending = -1;

  const push = (from: number, to: number) => {
    const text = narration.slice(from, to).trim();
    if (!text) return;
    // 句首可能落在标点上（比如引号），回溯到最近的有时间字符
    const startRef = lastTimedAt(refs, from);
    const endRef = lastTimedAt(refs, to - 1);
    if (!startRef || !endRef) return;
    out.push({
      text,
      from: beatFrom + startRef.t,
      to: beatFrom + endRef.t + Math.max(6, endRef.d),
    });
  };

  /**
   * 断句。
   *
   * 关键：**软断点不能写进 `end`**。早先版本让 `end` 同时充当
   * "本句终点"和"软断点"，于是第一个逗号就把 end 定死在 3；
   * 真正的句号到来时 `if (end < 0)` 已经不成立，整句被截成
   * 第一个逗号前的那几个字——表现为字幕只剩半句、大段无字幕。
   *
   * 现在软断点只记在 softPending 上；句子没超长就一直等到句末，
   * 真的太长（超过 SOFT_MAX 且已攒够长度）才在最近的逗号处断开。
   */
  for (let i = 0; i < narration.length; i++) {
    const ch = narration[i];
    if (HARD_BREAK.test(ch)) {
      // 长到连一个软断点都找不到（整句没逗号），只能整句上屏
      const tooLong = i - start > SOFT_MAX * 2 && softPending > start;
      const cut = tooLong ? softPending + 1 : i + 1;
      push(start, cut);
      start = cut;
      softPending = -1;
      continue;
    }
    if (SOFT_BREAK.test(ch)) {
      if (i - start >= SOFT_MAX && softPending > start) {
        push(start, softPending + 1);
        start = softPending + 1;
      }
      softPending = i;
    }
  }
  push(start, narration.length);

  return out;
};

export const CaptionTrack: React.FC<{
  /** 全片总帧数，用于片尾淡出 */
  totalFrames: number;
}> = ({ totalFrames }) => {
  const frame = useCurrentFrame();
  const { pad } = useStage();

  const sentences = useMemo(
    () =>
      BEATS.flatMap((b) =>
        b.words.length && b.narration
          ? splitSentences(b.narration, b.words, b.from, b.durationInFrames)
          : [],
      ),
    [],
  );

  const active = sentences.find((s) => frame >= s.from && frame < s.to);
  if (!active) return null;

  // 进出各 4 帧，够软但不拖
  const appear = interpolate(
    frame,
    [active.from, active.from + 4, active.to - 4, active.to],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const isLast = sentences[sentences.length - 1] === active;
  const outroFade = isLast
    ? interpolate(frame, [totalFrames - 18, totalFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const o = appear * outroFade;
  if (o <= 0.01) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 96,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          padding: "16px 40px",
          // 字幕不再是深色圆角块（那是全片最像 PPT 的一处）：
          // 一张浅色纸贴在画面底部，字用墨色，和拼贴的语言一致
          backgroundColor: PAPER.sheet,
          // 字幕条也是一张撕下来的纸：网点 + 更明显的毛边。
          // 纯白圆角块是全片最像 UI 的地方，毛边一给就跟底纸接上了。
          backgroundImage: `radial-gradient(rgba(58,46,28,0.26) 0.8px, transparent 0.95px)`,
          backgroundSize: "6px 6px",
          backgroundPosition: "1px 2px",
          clipPath: roughEdge(5, 4.2, 8),
          boxShadow: "0 2px 0 rgba(52,39,22,0.16), 0 14px 26px rgba(46,34,18,0.26)",
          fontFamily: FONT_BODY,
          // 1080p 字幕下限 60px（见 references/readability.md）。手机竖看时
          // 画面缩到约 480 宽，60px 只剩约 15px，再小就吃力
          fontSize: 60,
          fontWeight: 700,
          lineHeight: 1.45,
          textAlign: "center",
          color: COLORS.ink,
          letterSpacing: 1,
          opacity: o,
          transform: `translateY(${(1 - o) * 14}px) rotate(-0.35deg)`,
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};

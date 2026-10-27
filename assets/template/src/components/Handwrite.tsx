/**
 * 手写拍：一只手拿笔在纸上写字，笔尖走到哪，字显到哪。
 *
 * 中文没法在不解析字体轮廓的前提下按笔顺一撇一捺地画，所以这里不做逐笔绘制，
 * 而是"逐字显影 + 笔尖跟随"：字在笔尖下一个个落下来，观众读到的就是手写。
 * 三个关键点缺一不可：
 *
 *   1. 字是逐字出现的，不是整行淡入——整行淡入立刻变回 PPT；
 *   2. 笔尖位置和字的显影由**同一条时间轴**推出来，笔永远压在正在出现的字上；
 *   3. 手从画外进、写完抬笔出，不能凭空出现或停住不动。
 *
 * 节奏默认 3.2 字/秒（真人写字约 2-5 字/秒）。拍短写不完时会自动加速，
 * 但不会超过 `write.speed` 的两倍，宁可最后几个字快一点也不拖出拍尾。
 */

import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { FONT_DISPLAY } from "../fonts";
import { hash01 } from "../paper";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useStage } from "./BeatPresence";

type CharBox = {
  ch: string;
  /** 字格中心 */
  x: number;
  y: number;
  /** 字格宽度 */
  w: number;
  line: number;
  /** 强调词里包含这个字：红笔写 */
  hot: boolean;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 字格宽度：中文一字一格，拉丁按大致比例分档，保证布局和笔尖位置可预测 */
const charWidth = (ch: string, size: number) => {
  if (ch === " ") return size * 0.4;
  if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch)) return size;
  if (/[il.,'!|:;]/.test(ch)) return size * 0.32;
  if (/[MW@%]/.test(ch)) return size * 0.84;
  return size * 0.58;
};

/** 强调词在原句里的字符区间：命中的字用强调色写 */
const hotIndices = (lines: string[], emphasis: string[] | undefined) => {
  const set = new Set<number>();
  if (!emphasis?.length) return set;
  let offset = 0;
  for (const line of lines) {
    for (const word of emphasis) {
      let from = line.indexOf(word);
      while (from >= 0) {
        for (let k = 0; k < word.length; k++) set.add(offset + from + k);
        from = line.indexOf(word, from + 1);
      }
    }
    offset += line.length;
  }
  return set;
};

export const Handwrite: React.FC<{
  beat: Beat;
  visual: VisualSpec;
  accent: string;
  tone?: "paper" | "night";
}> = ({ beat, visual, accent, tone = "paper" }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const { presence } = useBeatPresence();
  const { pad } = useStage();

  const raw = (visual.text ?? "").trim();
  if (!raw) return null;

  const lines = raw.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
  if (!lines.length) return null;

  const write = visual.write ?? {};
  const baseSize = Math.round(write.size ?? 150);
  const red = write.color === "red";
  const ink = red ? COLORS.accent : tone === "night" ? COLORS.nightInk : COLORS.ink;
  const layout = visual.layout ?? "center";
  const alignLeft = visual.align === "left" || layout === "left-edge";

  // 先把字排出来：字号从 write.size 往下缩，直到最宽一行和高都放得下
  const maxW = width - pad * 2;
  const areaTop = 150;
  const areaBottom = height - 240;
  const lineHeight = 1.3;
  let size = baseSize;
  const lineWidth = (line: string, s: number) =>
    [...line].reduce((sum, ch) => sum + charWidth(ch, s), 0) +
    Math.max(0, line.length - 1) * s * 0.04;
  while (size > 64) {
    const widest = Math.max(...lines.map((l) => lineWidth(l, size)));
    const blockH = lines.length * size * lineHeight;
    if (widest <= maxW && blockH <= areaBottom - areaTop) break;
    size -= 2;
  }

  const blockW = Math.max(...lines.map((l) => lineWidth(l, size)));
  const blockH = lines.length * size * lineHeight;
  const left = alignLeft ? pad : (width - blockW) / 2;
  const top = layout === "bottom-third" ? areaBottom - blockH : (areaTop + areaBottom) / 2 - blockH / 2;

  const hot = hotIndices(lines, visual.emphasis);
  const chars: CharBox[] = [];
  let offset = 0;
  lines.forEach((line, li) => {
    const lineLeft = alignLeft ? left : left + (blockW - lineWidth(line, size)) / 2;
    let x = lineLeft;
    [...line].forEach((ch, ci) => {
      const w = charWidth(ch, size);
      chars.push({
        ch,
        x: x + w / 2,
        y: top + li * size * lineHeight + size * 0.65,
        w,
        line: li,
        hot: hot.has(offset + ci),
      });
      x += w + size * 0.04;
    });
    offset += line.length;
  });

  const n = chars.length;
  if (!n) return null;

  // 起笔：旁白开口后 2 帧。拍尾留 12 帧给抬笔退出。
  const firstWord = beat.words[0];
  const writeStart = Math.max(4, Math.min(durationInFrames - 14, (firstWord?.t ?? 10) + 2));
  const endLimit = durationInFrames - 14;
  const wanted = fps / Math.max(0.8, write.speed ?? 3.2);
  // 写不完就加速，但最多加到 2 倍速；再长就靠 preflight 拦字数
  const perChar = Math.max(wanted / 2, Math.min(wanted, (endLimit - writeStart) / n));
  const writeEnd = writeStart + n * perChar;

  const idx = (frame - writeStart) / perChar;
  // 笔走在"当前字格"里：i0 是正在写的字，frac 是笔在这个字格里的进度
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(idx)));
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = clamp01(idx - i0);
  const a = chars[i0];
  const b = chars[i1];

  // 换行时抬一下笔：字格不连续，直接平移会读成"划过去"
  const cross = a.line !== b.line;
  const arc = cross ? Math.sin(Math.PI * frac) : 0;

  let penX = a.x - a.w / 2 + a.w * frac;
  let penY = a.y + (b.y - a.y) * (cross ? frac : 0) - arc * size * 0.42;
  if (cross) penX = a.x + a.w / 2 + (b.x - b.w / 2 - (a.x + a.w / 2)) * frac;

  // 写完停笔：手不再抖，直接抬笔
  const done = frame >= writeEnd;
  if (done) {
    penX = chars[n - 1].x + chars[n - 1].w / 2;
    penY = chars[n - 1].y;
  }

  // 写字时的手部微动：两三帧一档的小起伏，幅度很小，只是别像贴图
  const jitterX = done ? 0 : (hash01(i0 * 7 + 3) - 0.5) * size * 0.012;
  const jitterY = done ? 0 : Math.sin(frame * 0.55) * size * 0.006;

  const enterP = interpolate(frame, [writeStart - 12, writeStart], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitP = interpolate(frame, [writeEnd + 2, writeEnd + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const handIn = 1 - enterP;
  const handOut = exitP;
  const handOpacity = presence * enterP * (1 - exitP);

  const handRot = -2.5 + handIn * 8 + Math.sin(frame * 0.4) * 0.7 - handOut * 12;

  // 手是一张纸片，没有手臂：起笔时淡入就位，写完抬笔向右上退场
  const penPx = penX + jitterX + handOut * size * 0.12;
  const penPy = penY + jitterY - handIn * size * 0.06 - handOut * size * 0.35;

  return (
    <div style={{ position: "absolute", inset: 0, opacity: presence }}>
      {chars.map((c, i) => {
        if (c.ch === " ") return null;
        const local = clamp01((idx - i) / 0.7);
        const p = Easing.out(Easing.cubic)(local);
        if (p <= 0) return null;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: c.x - c.w / 2,
              top: c.y - size * 0.56,
              width: c.w,
              height: size * 1.12,
              lineHeight: `${size * 1.12}px`,
              textAlign: "center",
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: size,
              letterSpacing: 0,
              color: c.hot ? accent : ink,
              whiteSpace: "pre",
              opacity: p,
              filter: p < 1 ? `blur(${((1 - p) * 3).toFixed(2)}px)` : undefined,
              transform: `translateY(${(1 - p) * size * 0.06}px) scale(${(0.96 + p * 0.04).toFixed(3)})`,
            }}
          >
            {c.ch}
          </span>
        );
      })}

      {handOpacity > 0.001 ? (
        <div
          style={{
            position: "absolute",
            left: penPx,
            top: penPy,
            width: 0,
            height: 0,
            opacity: handOpacity,
            transform: `rotate(${handRot.toFixed(2)}deg) scale(${(1 + (1 - enterP) * 0.04 - exitP * 0.03).toFixed(3)})`,
          }}
        >
          <PaperHand size={size} />
        </div>
      ) : null}
    </div>
  );
};

/**
 * 纸艺手 + 笔：一张剪纸手部素材（蓝杆钢笔、金箍、银色笔尖）。
 * 素材 710×1072，笔尖像素在 (7, 774)——img 锚定在笔尖上，笔尖永远压住正在写的字。
 * 右手写字：手掌在笔尖右上方、笔杆朝右上翘、手腕朝右下伸出。
 * **不画手臂**——手臂要从画面中间伸到画外，太长，会横穿半张纸、盖住字幕带；
 * 剪纸风格里手本来就是一张剪下来的纸片，手腕末端就是剪口。
 */
const PaperHand: React.FC<{ size: number }> = ({ size }) => {
  // 笔尖到手掌约 2 个字高：手太小会像玩具，太大会挡字
  const s = (size * 2.0) / 360;
  const IW = 710;
  const IH = 1072;
  const NX = 7;
  const NY = 774;

  return (
    <Img
      src={staticFile("handwrite/hand.png")}
      style={{
        position: "absolute",
        left: -NX * s,
        top: -NY * s,
        width: IW * s,
        height: IH * s,
        filter: `drop-shadow(0 ${Math.round(12 * s)}px ${Math.round(18 * s)}px rgba(46,34,18,0.3))`,
      }}
    />
  );
};

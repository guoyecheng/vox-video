/**
 * 配乐床（music bed）。
 *
 * 一条人声讲解片**必须**有配乐，否则观众听到的是"念稿"而不是"片子"。
 * 但配乐最容易犯的错是**盖过人声**——人声是主旋律，配乐是底。
 *
 * 做法：让配乐在**有人说话的时候自动让路**（ducking），
 * 说话结束再慢慢回来。用的是**旁白词级时间戳**，
 * 所以让路的位置跟嘴型是帧级对齐的，不靠猜。
 *
 * 音量曲线是**解析式**的（每帧独立算，不依赖上一帧），
 * 这样逐帧渲染可复现——随机渲染或跳帧渲染不会得到不同的混音。
 *
 * 音乐文件由使用者提供（放进 public/），我们没有本地音乐模型。
 * 见 SKILL.md「配乐」一节。
 */

import React, { useMemo } from "react";
import { Audio, staticFile, useCurrentFrame } from "remotion";
import { BEATS } from "./timeline";

export type MusicSpec = {
  /** public/ 下的路径，例如 "audio/bed.mp3" */
  src: string;
  /** 底音量，0-1。配乐整体有多响 */
  gain?: number;
  /** 有人说话时压低多少，0-1。0.6 = 说话时只剩 40% */
  duck?: number;
  /** 开头淡入帧数 */
  fadeIn?: number;
  /** 结尾淡出帧数 */
  fadeOut?: number;
  /** 让路边缘的软化帧数 */
  ramp?: number;
};

/** 旁白说话窗口（绝对帧）。用词级时间戳，不用整拍——拍与拍之间的空白不该让路 */
const speechWindows = (ramp: number) => {
  const raw: [number, number][] = [];
  for (const b of BEATS) {
    if (!b.words.length) continue;
    const first = b.words[0];
    const last = b.words[b.words.length - 1];
    raw.push([b.from + first.t, b.from + last.t + last.d]);
  }
  // 合并重叠窗口，避免两拍连着说话时中间出现"抬起来又压下去"
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of raw) {
    const prev = merged[merged.length - 1];
    if (prev && s <= prev[1] + ramp) {
      prev[1] = Math.max(prev[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
};

/** 某一帧的"让路量"：窗口内为 1，窗口外按 ramp 帧软化到 0 */
const duckAmount = (frame: number, windows: [number, number][], ramp: number) => {
  let v = 0;
  for (const [s, e] of windows) {
    if (frame >= s && frame <= e) {
      v = 1;
      break;
    }
    if (frame < s && frame > s - ramp) {
      v = Math.max(v, (s - frame) / ramp);
    } else if (frame > e && frame < e + ramp) {
      v = Math.max(v, 1 - (frame - e) / ramp);
    }
  }
  return v;
};

export const MusicBed: React.FC<{
  music: MusicSpec;
  totalFrames: number;
}> = ({ music, totalFrames }) => {
  const frame = useCurrentFrame();
  const gain = music.gain ?? 0.2;
  const duck = music.duck ?? 0.6;
  const fadeIn = music.fadeIn ?? 18;
  const fadeOut = music.fadeOut ?? 30;
  const ramp = music.ramp ?? 8;

  const windows = useMemo(() => speechWindows(ramp), [ramp]);

  const volume = (f: number) => {
    const d = duckAmount(f, windows, ramp);
    const head = fadeIn > 0 ? Math.min(1, f / fadeIn) : 1;
    const tail =
      fadeOut > 0 ? Math.min(1, Math.max(0, (totalFrames - f) / fadeOut)) : 1;
    return Math.max(0, gain * (1 - duck * d) * head * tail);
  };

  if (!music.src) return null;

  return (
    <Audio
      src={staticFile(music.src)}
      volume={(f) => volume(f)}
    />
  );
};

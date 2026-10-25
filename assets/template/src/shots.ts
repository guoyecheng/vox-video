/**
 * beat 内镜头拆分（shots）：把一拍按词级时间戳切成 1.5s+ 的镜头。
 *
 * 纯 TS、无 React/Remotion 依赖——可以 bundle 后在 Node 里直跑（selftest
 * 的 node 子套件就是这么测的）。时间单位：显式 shots 的 from/to 是秒
 * （script.json 作者写秒），运行时 ×fps 转帧；词时间戳是帧。
 */

import type {
  Beat,
  LayoutMode,
  MotionRecipe,
  ShotSpec,
  ShotTransition,
  WordTiming,
} from "./timeline";
import { autoMotion, canBuildVisual } from "./recipes";

/** 镜头时长下限（秒）——短于这个的从句会被并进下一句 */
export const MIN_SHOT_SECONDS = 1.5;

/** crossfade 的交叠帧数 */
export const SHOT_FADE = 8;

/** 断句标点，与 KineticText 的从句拆分正则逐字一致 */
const PUNCT_CLASS = "[，。！？；、,.!?;]";
export const SHOT_PUNCT = new RegExp(`(?<=${PUNCT_CLASS})`);
const PUNCT_AT_END = new RegExp(`${PUNCT_CLASS}$`);
const PUNCT_ALL = new RegExp(PUNCT_CLASS, "g");

const plainText = (s: string) => s.replace(/\s+/g, "").replace(PUNCT_ALL, "");

export type Shot = {
  /** 相对 beat 起点，帧 */
  from: number;
  durationInFrames: number;
  /** 该窗口的词，t 已归零到 shot 起点 */
  words: WordTiming[];
  /** shot 内旁白（words 文本拼接，供 KineticText 断句兜底） */
  narration: string;
  /** 上屏词覆盖（shotSpec.words 或拍级 visual.words） */
  shown?: string[];
  /** 已解析的入场配方 */
  motion: MotionRecipe;
  layout?: LayoutMode;
  transition: ShotTransition;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * 单镜头兜底：整拍一个镜头。narration 保留全量旁白、motion 尊重拍级
 * 显式值——这样它和 shots 架构之前的 A+B 行为逐帧一致。
 */
const singleShot = (beat: Beat, index: number): Shot => ({
  from: 0,
  durationInFrames: beat.durationInFrames,
  words: beat.words,
  narration: beat.narration,
  shown: beat.visual.words,
  motion: beat.visual.motion ?? autoMotion(index, canBuildVisual(beat.visual)),
  layout: beat.visual.layout,
  transition: "cut",
});

/**
 * 每个词之后是不是从句边界。
 *
 * edge-tts 的 WordBoundary.text **不含标点**（实测：所有拍的词文本都收在汉字上），
 * 所以只看词文本永远拆不开。真正的句读在 `narration` 里：narration 去掉空白和
 * 标点后与词文本逐字拼成的串完全一致，可以据此把"标点后的下一个词"认成边界。
 * 词文本自带标点（手写测试、别的 TTS）仍作兜底。
 */
const clauseEnds = (narration: string, words: WordTiming[]): boolean[] => {
  const ends = words.map((w) => PUNCT_AT_END.test(w.text));
  const narr = narration ?? "";
  if (plainText(narr) !== words.map((w) => plainText(w.text)).join("")) return ends;

  // punctAfter[k]：旁白第 k 个净字符之后紧跟着句读
  const punctAfter: boolean[] = [];
  let last = -1;
  for (const ch of narr) {
    if (/\s/.test(ch)) continue;
    if (PUNCT_AT_END.test(ch)) {
      if (last >= 0) punctAfter[last] = true;
      continue;
    }
    punctAfter.push(false);
    last = punctAfter.length - 1;
  }

  let pos = 0;
  words.forEach((w, i) => {
    const len = plainText(w.text).length;
    if (len > 0 && punctAfter[pos + len - 1]) ends[i] = true;
    pos += len;
  });
  return ends;
};

/**
 * 取某一镜覆盖的旁白原文（含收尾标点）。
 *
 * 不能直接拼词文本：edge-tts 的 WordBoundary.text 不含标点，拼出来是
 * "有一种三角形宽度处处相等"，KineticText 就断不开句，整句挤成一行。
 * 这里把词流映射回 narration 的字符区间，末尾连同标点一起切走。
 * 旁白与词流对不上（手写稿、别的 TTS）时返回 null，调用方退回拼词文本。
 */
const shotNarration = (
  narration: string,
  words: WordTiming[],
  fromIdx: number,
  toIdx: number,
): string | null => {
  const chars: number[] = [];
  for (let i = 0; i < narration.length; i++) {
    const ch = narration[i]!;
    if (/\s/.test(ch) || PUNCT_AT_END.test(ch)) continue;
    chars.push(i);
  }
  const plainNarr = chars.map((i) => narration[i]!).join("");
  if (!plainNarr || plainNarr !== words.map((w) => plainText(w.text)).join("")) return null;

  const lens = words.map((w) => plainText(w.text).length);
  const before = lens.slice(0, fromIdx).reduce((a, b) => a + b, 0);
  const span = lens.slice(fromIdx, toIdx + 1).reduce((a, b) => a + b, 0);
  if (span <= 0) return null;

  const start = chars[before]!;
  let end = chars[before + span - 1]! + 1;
  while (end < narration.length && /[\s，。！？；、,.!?;]/.test(narration[end]!)) end++;
  return narration.slice(start, end);
};

/** 自动路径：按词流上的从句边界拆，短句连续并进相邻句 */
const autoShots = (
  beat: Beat,
  firstShotIndex: number,
  fps: number,
  canBuild: boolean,
): Shot[] => {
  const words = beat.words ?? [];
  if (!words.length) return [singleShot(beat, firstShotIndex)];

  const min = Math.round(MIN_SHOT_SECONDS * fps);
  const ends = clauseEnds(beat.narration, words);
  const starts = [0];
  words.forEach((_, i) => {
    if (ends[i] && i + 1 < words.length) starts.push(i + 1);
  });

  // 从句边界转帧；末尾补拍尾——末句没有收尾标点时也要占满到拍尾
  const boundaries = [0];
  for (const s of starts.slice(1)) {
    const t = words[s]?.t;
    boundaries.push(t == null ? beat.durationInFrames : clamp(t, 0, beat.durationInFrames));
  }
  boundaries.push(beat.durationInFrames);

  // 短句（< 下限）并进下一句；末句没有下一句，并进前一句
  while (boundaries.length > 2) {
    let merged = false;
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (boundaries[i + 1]! - boundaries[i]! >= min) continue;
      boundaries.splice(i < boundaries.length - 2 ? i + 1 : i, 1);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  if (boundaries.length <= 2) return [singleShot(beat, firstShotIndex)];

  return boundaries.slice(0, -1).map((from, i) => {
    const to = boundaries[i + 1]!;
    const idx = words
      .map((_, k) => k)
      .filter((k) => words[k]!.t >= from && words[k]!.t < to);
    const windowWords = idx.map((k) => ({ ...words[k]!, t: words[k]!.t - from }));
    const joined = windowWords.map((w) => w.text).join("");
    return {
      from,
      durationInFrames: to - from,
      words: windowWords,
      narration:
        (idx.length
          ? shotNarration(beat.narration, words, idx[0]!, idx[idx.length - 1]!)
          : null) ?? joined,
      // 多镜头下 beat 级 words 失效，词由 shot 级接管
      shown: undefined,
      motion: autoMotion(firstShotIndex + i, canBuild),
      layout: beat.visual.layout,
      transition: "cut" as ShotTransition,
    };
  });
};

/** 显式路径：visual.shots 逐条解析，from/to 缺省按前后邻补、全缺均分 */
const explicitShots = (
  beat: Beat,
  specs: ShotSpec[],
  firstShotIndex: number,
  fps: number,
  canBuild: boolean,
): Shot[] => {
  const duration = beat.durationInFrames;
  const toFrames = (s: number) => Math.round(s * fps);
  const allEmpty = specs.every((s) => s.from == null && s.to == null);
  // 先按 from 排序再补缺省：乱序时按数组序补会把后一镜压成一帧。
  // 首条缺 from 按 0 算，其余缺 from 排到最后（preflight 已要求第 2 镜起写 from）。
  const orderKey = (spec: ShotSpec, i: number) =>
    spec.from ?? (i === 0 ? 0 : Infinity);
  const ordered = specs
    .map((spec, i) => ({ spec, i }))
    .sort((a, b) => orderKey(a.spec, a.i) - orderKey(b.spec, b.i) || a.i - b.i)
    .map((x) => x.spec);

  let prevEnd = 0;
  const bounds = ordered.map((s, i) => {
    let from: number;
    let to: number;
    if (allEmpty) {
      from = Math.round((i * duration) / ordered.length);
      to = Math.round(((i + 1) * duration) / ordered.length);
    } else {
      from = s.from != null ? toFrames(s.from) : prevEnd;
      if (s.to != null) {
        to = toFrames(s.to);
      } else {
        const nextFrom = ordered.slice(i + 1).find((x) => x.from != null)?.from;
        to = nextFrom != null ? toFrames(nextFrom) : duration;
      }
    }
    // clamp 进拍长，坏条目（to≤from、越界）也保证至少 1 帧
    from = clamp(from, 0, Math.max(0, duration - 1));
    to = clamp(to, 1, duration);
    if (to <= from) to = from + 1;
    prevEnd = to;
    return { from, to, spec: s };
  });

  return bounds.map(({ from, to, spec }, i) => {
    const words = beat.words ?? [];
    const idx = words
      .map((_, k) => k)
      .filter((k) => words[k]!.t >= from && words[k]!.t < to);
    const windowWords = idx.map((k) => ({ ...words[k]!, t: words[k]!.t - from }));
    return {
      from,
      durationInFrames: to - from,
      words: windowWords,
      // 窗口里没有词时回退拍级旁白：空 narration 会让镜头整段空屏
      narration: windowWords.length
        ? (shotNarration(beat.narration, words, idx[0]!, idx[idx.length - 1]!) ??
          windowWords.map((w) => w.text).join(""))
        : beat.narration,
      shown: spec.words,
      motion: spec.motion ?? autoMotion(firstShotIndex + i, canBuild),
      layout: spec.layout ?? beat.visual.layout,
      transition: spec.transition ?? "cut",
    };
  });
};

export const computeShots = (beat: Beat, firstShotIndex: number, fps: number): Shot[] => {
  const { visual } = beat;
  // shots 只对 kinetic 生效（v1），其余回退单镜头防呆
  if (visual.kind !== "kinetic") return [singleShot(beat, firstShotIndex)];
  const specs = visual.shots;
  if (!specs || !specs.length) {
    return autoShots(beat, firstShotIndex, fps, canBuildVisual(visual));
  }
  return explicitShots(beat, specs, firstShotIndex, fps, canBuildVisual(visual));
};

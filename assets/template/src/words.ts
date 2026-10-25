/**
 * 上屏词 ↔ TTS 词级时间戳的对齐（纯函数，无 React/Remotion 依赖）。
 *
 * 这是"配音和画面逐词对齐"的唯一入口：所有组件的卡点都经过
 * `resolveWordTimings`。抽成独立模块一是为了让 node 子套件能直接测，
 * 二是让这套规则只存在一处——散在各组件里时，每加一个组件就多一份漂移。
 */

import type { WordTiming } from "./timeline";

/** spring 收到 NaN 会直接抛 RangeError，统一兜一层 */
export const safe = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

/**
 * 对齐时两侧都剥掉的字符。
 *
 * 上屏词是按旁白标点切出来的（"有一种三角形，"），词流却没有标点
 * （edge-tts 的 boundary.text 只含实字）。只去空白的话每一句都匹配不上，
 * 只能退回"均匀铺开"——表现为每个镜头开头半秒空屏、字比旁白晚一拍。
 */
const PUNCT_ALL = /[\s，。！？；、,.!?;:：…—（）()《》〈〉「」『』“”‘’]/g;

const CN_DIGITS = "零一二三四五六七八九";
const CN_UNITS = ["", "十", "百", "千"];

/**
 * 阿拉伯数字 → 中文读法，用于在旁白里找数字。
 *
 * script.json 写 `value: 3`，旁白却通常写"三个"——不做这个转换，
 * StatCard 的计数动画就会因为匹配不上而整拍漂移。
 *
 * 覆盖 1-9999，够用："一百"、"一千六百"、"两百" 这类旁白里真实会出现的写法。
 * 上百亿这种带"亿"的量级不覆盖，那些数字本来就该用卡片标题而不是精确卡词。
 */
const toChineseNumeral = (s: string): string | null => {
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  if (n === 0) return "零";
  if (n < 10) return CN_DIGITS[n];

  const digits = String(n).split("").map(Number);
  let out = "";
  let zeroPending = false;

  digits.forEach((d, i) => {
    const unit = CN_UNITS[digits.length - 1 - i];
    if (d === 0) {
      zeroPending = true;
      return;
    }
    if (zeroPending && out) out += "零";
    zeroPending = false;
    // 10-19 的"一十"口语里说成"十"
    const digit = unit === "十" && d === 1 && !out ? "十" : CN_DIGITS[d];
    out += digit + unit;
  });

  const alts = [out];
  // 口语常把 200/2000 说成"两百/两千"
  if (digits[0] === 2 && out.startsWith("二")) alts.push("两" + out.slice(1));
  return alts.join(" "); // 用空格分隔多个候选，aliasesFor 会拆开
};

/** 一项在旁白里可能的几种写法，按优先级排列 */
const aliasesFor = (needle: string): string[] => {
  const out = [needle];
  const cn = toChineseNumeral(needle);
  if (cn) {
    for (const form of cn.split(" ")) {
      if (form && !out.includes(form)) out.push(form);
    }
  }
  return out;
};

/**
 * 把 `visual.words`（要上屏的词）对齐到 TTS 的词级时间戳上。
 *
 * 直接按下标对齐是不够的：旁白会把"47年"切成"47"+"年"两个 boundary，
 * 而上屏时我们想让它作为一个整体一起弹出。这里把所有 boundary 拼成
 * 一条带字符区间的字符串，按字符偏移反查时间，于是能拿到词内部的
 * 亚词级时间点——上屏词落在哪个音节上，就在哪一帧弹。
 *
 * 找不到匹配时按顺序推进兜底，保证最差情况也只是"大致对齐"而不是崩掉。
 */
export const resolveWordTimings = (
  shown: string[],
  spoken: WordTiming[] | undefined,
  /** 旁白里找不到的项在多长的区间内铺开。传 beat 时长可避免画面过早静止 */
  fallbackSpan?: number,
): WordTiming[] => {
  const list = spoken ?? [];
  if (!shown.length) return [];
  if (!list.length) {
    // 没有时间戳（无声 beat 或纯视觉 beat）：按每词 0.45s 均匀铺开
    return shown.map((text, i) => ({ t: Math.round(i * 13.5), d: 9, text }));
  }

  // 字符区间必须建在去标点后的串上，否则和 needle 的偏移对不上
  const norm = (s: string) => s.replace(PUNCT_ALL, "");
  const spans: { start: number; end: number; w: WordTiming }[] = [];
  let flat = "";
  for (const w of list) {
    const start = flat.length;
    flat += norm(w.text);
    spans.push({ start, end: flat.length, w });
  }
  const hay = flat;
  const spanEnd = safe(list[list.length - 1].t) + Math.max(1, safe(list[list.length - 1].d));

  const result: (WordTiming | null)[] = shown.map(() => null);
  let cursor = 0;
  const unmatched: number[] = [];

  shown.forEach((text, i) => {
    const needle = norm(text) || text;
    let at = -1;
    for (const alias of aliasesFor(needle)) {
      at = hay.indexOf(alias, cursor);
      if (at === -1) at = hay.indexOf(alias);
      if (at !== -1) break;
    }
    if (at === -1) {
      // 这一项根本没出现在旁白里（卡片标题、里程碑名通常如此）
      unmatched.push(i);
      return;
    }

    // 落在哪个 boundary 的区间内
    let host = spans[spans.length - 1];
    for (const sp of spans) {
      if (at < sp.end && at + needle.length > sp.start) {
        host = sp;
        break;
      }
    }

    const ratio = (at - host.start) / Math.max(1, host.end - host.start);
    const t = host.w.t + host.w.d * Math.min(1, Math.max(0, ratio));
    const spanChars = Math.max(1, host.end - host.start);
    const d = Math.max(4, (host.w.d * needle.length) / spanChars);

    cursor = at + needle.length;
    result[i] = { t, d, text };
  });

  // 旁白里找不到的项，在给定区间上均匀铺开——这正是"三个原因"
  // 这类并列结构想要的效果：每张卡在念到对应位置时落下。
  // 区间默认取旁白时长；若只铺旁白那一段，画面会在尾段早早静止。
  if (unmatched.length) {
    const total = Math.max(1, safe(fallbackSpan ?? spanEnd, spanEnd));
    const slice = total / (unmatched.length + 1);
    unmatched.forEach((idx, k) => {
      result[idx] = {
        t: Math.round(slice * (k + 1) - 4),
        d: Math.round(slice * 0.5),
        text: shown[idx],
      };
    });
  }

  return result.map((r, i) => r ?? { t: i * 12, d: 8, text: shown[i] });
};

export type EmphasisPart = { text: string; hot: boolean };

/**
 * 把一段上屏文字按强调词切开，只让强调短语本身变成"纸片字"。
 *
 * 强调是按片段匹配的（"是几何"命中了"几何"），但纸片只该贴"几何"两个字。
 * 这里按最长优先做一次扫描：命中就切出来，没命中的字符归到相邻的普通片段。
 * 整段都没命中时返回单个普通片段——组件据此退回"整段强调"。
 */
export const splitByEmphasis = (text: string, emphasis?: string[]): EmphasisPart[] => {
  if (!text) return [];
  const keys = [...new Set((emphasis ?? []).map((e) => e.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!keys.length) return [{ text, hot: false }];

  const parts: EmphasisPart[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const hit = keys.find((k) => text.startsWith(k, i));
    if (!hit) {
      plain += text[i];
      i += 1;
      continue;
    }
    if (plain) {
      parts.push({ text: plain, hot: false });
      plain = "";
    }
    parts.push({ text: hit, hot: true });
    i += hit.length;
  }
  if (plain) parts.push({ text: plain, hot: false });
  return parts;
};

/** 判断某个词是否在强调列表里 */
export const makeEmphasisMatcher = (emphasis?: string[]) => {
  const set = new Set((emphasis ?? []).map((e) => e.replace(/\s+/g, "")));
  return (word: string) => {
    const n = word.replace(/\s+/g, "");
    if (!n) return false;
    for (const e of set) if (e.includes(n) || n.includes(e)) return true;
    return false;
  };
};

/**
 * 纸片字（hero word tile）。
 *
 * 强调词不再只是"更大的字 + 红线"，而是一张单独剪下来贴上去的小纸片：
 * 毛边、双层纸、投影、微微歪一个角度，落下来有重量（弹簧过冲再落定）。
 * 和逐词弹出的区别不是装饰，而是**材质语言**——观众读到的是"编辑把这张词
 * 贴到了纸上"，不是"字从屏幕里弹出来"。
 *
 * 纸片有几种版式，按字数自动选（也可用 script.json 的 `tile` 指定）：
 *
 *   label   ≤2 字        金色价签，胶带、歪得更多；短词用它才跳得出来
 *   cut     3-5 字       干净的一刀，米白双层纸
 *   note    3-5 字       便签纸，暖黄、折角、留白大
 *   clip    3-5 字       剪报条，旧灰纸、上下栏线、网点更重
 *   banner  ≥6 字        长条，左侧一道红边，允许两行
 *   red     手动指定      红纸白字，整片最多用一次
 *
 * 3-5 字按 seed 在 cut / note / clip 里挑；同一拍的第二张纸片会换一种版式。
 *
 * 用量必须克制：每拍 1–2 张。整句都贴纸片会碎，强调也就不再是强调。
 * 随机量都走 `hash01`（同 seed 每帧一致），渲染可复现；没有图片资源。
 */

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { FONT_DISPLAY } from "../fonts";
import { PAPER, BrushUnderline, Tape, hash01, roughEdge, sheetTexture, tiltFor } from "../paper";
import { safe } from "../words";

export type TileVariant = "cut" | "note" | "clip" | "label" | "banner" | "red";

type Look = {
  bg: string;
  backing: string;
  /** 文字在红纸上要用纸色，其余都是油墨黑 */
  ink: string;
  /** 纸边毛刺幅度（px） */
  rough: number;
  pad: string;
  /** 静止时的倾斜幅度（度） */
  tilt: number;
  /** 下落时额外歪多少度 */
  lift: number;
  /** 下落距离，单位是字高 */
  drop: number;
  wrap: boolean;
  /** 红纸上的下划线要用纸色，否则红压红看不见 */
  underline: string;
  extra?: "fold" | "rule" | "border" | "rail";
  tape: boolean;
};

const LOOKS: Record<TileVariant, Look> = {
  cut: {
    bg: PAPER.sheet,
    backing: PAPER.sheetWarm,
    ink: COLORS.ink,
    rough: 2.2,
    pad: "0.04em 0.2em 0.07em",
    tilt: 1.1,
    lift: 7,
    drop: 0.55,
    wrap: false,
    underline: COLORS.accent,
    tape: true,
  },
  label: {
    // 金色是五色板里唯一没被字用到的强调色：短词贴上它才真的跳出来，
    // 也让全片的纸片不至于全是同一种米白。
    bg: COLORS.gold,
    backing: "#B3812B",
    ink: COLORS.ink,
    rough: 2.8,
    pad: "0.06em 0.3em 0.09em",
    // 小标签是手写的价签，歪得比大纸片更多，落得也更快
    tilt: 2.4,
    lift: 10,
    drop: 0.45,
    wrap: false,
    underline: COLORS.accent,
    extra: "border",
    tape: true,
  },
  note: {
    bg: "#F3D98E",
    backing: "#DFC070",
    ink: COLORS.ink,
    rough: 2.4,
    pad: "0.1em 0.34em 0.16em 0.3em",
    tilt: 1.6,
    lift: 8,
    drop: 0.6,
    wrap: false,
    underline: COLORS.accent,
    extra: "fold",
    tape: true,
  },
  clip: {
    bg: "#D9D0B6",
    backing: "#C6BB9C",
    ink: COLORS.ink,
    rough: 1.4,
    pad: "0.08em 0.3em 0.1em",
    tilt: 0.8,
    lift: 5,
    drop: 0.5,
    wrap: false,
    underline: COLORS.accent,
    extra: "rule",
    tape: false,
  },
  banner: {
    bg: PAPER.sheet,
    backing: PAPER.sheetWarm,
    ink: COLORS.ink,
    rough: 1.8,
    pad: "0.1em 0.4em 0.14em 0.62em",
    tilt: 0.5,
    lift: 3,
    drop: 0.4,
    wrap: true,
    underline: COLORS.accent,
    extra: "rail",
    tape: false,
  },
  red: {
    bg: COLORS.accent,
    backing: "#B22317",
    ink: PAPER.sheet,
    rough: 2.3,
    pad: "0.05em 0.26em 0.09em",
    tilt: 1.4,
    lift: 7,
    drop: 0.55,
    wrap: false,
    underline: PAPER.sheet,
    tape: false,
  },
};

/**
 * 按字数挑版式。长度是第一信号（短词贴价签、长句贴长条），
 * order 是同一拍里的第几张——第二张强制换一种，免得两片一模一样的纸并排。
 */
export const autoTileVariant = (chars: number, seed: number, order = 0): TileVariant => {
  if (chars >= 6) return "banner";
  if (chars <= 2) return order === 0 ? "label" : "note";
  const r = hash01(seed * 2.3);
  if (order > 0) return r < 0.6 ? "note" : "clip";
  return r < 0.4 ? "cut" : r < 0.7 ? "note" : "clip";
};

export const PaperTile: React.FC<{
  /** 纸片上的字。长度决定自动版式，所以这里要文本本身而不是 ReactNode */
  text: string;
  /** 词级起点（当前镜头的相对帧） */
  at: number;
  seed?: number;
  /** 字号（px）。纸片自带 padding 和投影，通常和正文字号相当或略大即可 */
  size: number;
  /** 默认 auto：按字数与种子挑；也可以指定版式 */
  variant?: TileVariant | "auto";
  /** auto 时是同一拍里的第几张（0 起）。第二张会换一种版式 */
  order?: number;
  /** 贴一条胶带。一拍照 1 张就够，两张都贴会像手工作业 */
  tape?: boolean;
  /** 红线绘制进度 0→1；直接由词级时间戳驱动 */
  underline?: number;
}> = ({ text, at, seed = 1, size, variant = "auto", order = 0, tape = false, underline = 0 }) => {
  const frame = safe(useCurrentFrame());
  const { fps } = useVideoConfig();
  const rate = safe(fps, 30);

  const chars = text.replace(/\s/g, "").length;
  const v: TileVariant = variant === "auto" ? autoTileVariant(chars, seed, order) : variant;
  const look = LOOKS[v];

  const local = frame - safe(at);

  // 落纸：从上方一个字高掉下来，弹簧过冲到 1 以上再落定——
  // 这一下过冲就是"纸有重量"的全部来源。小标签落得更急（短、轻），长条最慢。
  const land = spring({
    frame: local,
    fps: rate,
    config: { damping: v === "label" ? 10 : 13, stiffness: v === "label" ? 230 : 190, mass: 0.85 },
    durationInFrames: Math.round(rate * 0.55),
  });
  const fall = Math.min(1, Math.max(0, land)); // 1 = 已落在纸上
  const air = 1 - fall;

  const drop = (1 - land) * -size * look.drop;
  const dir = hash01(seed * 13.3) > 0.5 ? 1 : -1;
  const rot = tiltFor(seed, look.tilt) + air * look.lift * dir;
  // 长条不是"掉"，是从左往右贴上来；其余是整张落下
  const scaleX = v === "banner" ? 0.74 + 0.26 * land : 1;
  const scale = v === "banner" ? 1 : 1 + air * 0.06;

  // 纸片是实体：不做 6 帧淡入，2 帧内就"出现"（再从空中落下）。
  const opacity = interpolate(local, [0, 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 影子随高度变化：在空中时偏、散、淡，落定后收紧——这是"离桌面多高"的读数
  const cast = `drop-shadow(0 ${1 + 3 * air}px 0 ${PAPER.edge}) drop-shadow(${
    (3 + 11 * air).toFixed(1)
  }px ${(5 + 14 * air).toFixed(1)}px ${(8 + 18 * air).toFixed(1)}px rgba(46,34,18,${
    0.16 + 0.14 * air
  }))`;

  // 网点：剪报是旧纸，网点压得比别的纸片重
  const dots = v === "clip" ? 0.3 : 0.13;

  return (
    <span
      style={{
        display: "inline-block",
        position: "relative",
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.18,
        letterSpacing: 1,
        color: look.ink,
        padding: look.pad,
        whiteSpace: look.wrap ? "normal" : "nowrap",
        maxWidth: look.wrap ? "11em" : undefined,
        textAlign: "left",
        opacity,
        transform: `translateY(${drop.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scaleX(${scaleX.toFixed(
          3,
        )}) scale(${scale.toFixed(3)})`,
        // 长条从左缘贴上来，其余绕下缘偏中旋转（底边先碰到纸面）
        transformOrigin: v === "banner" ? "0% 60%" : "50% 75%",
      }}
    >
      {/* 垫在下面的第二张纸。手贴不可能严丝合缝，露一点边才是"叠" */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: "-0.02em -0.12em -0.06em -0.03em",
          background: look.backing,
          clipPath: roughEdge(seed + 17, 2.6, 7),
          transform: "rotate(-0.7deg)",
          filter: cast,
        }}
      />
      {/* 主纸片 */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: look.bg,
          clipPath: roughEdge(seed, look.rough, 7),
          filter: cast,
        }}
      />
      {/* 纸片自己的网点：不加的话浅色纸片压在带纹理的底纸上像一块纯色面板 */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          clipPath: roughEdge(seed, look.rough, 7),
          ...sheetTexture,
          opacity: dots,
        }}
      />

      {/* 版式细节：折角 / 栏线 / 细边框 / 红边 */}
      {look.extra === "fold" ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: size * 0.46,
            height: size * 0.46,
            background: `linear-gradient(225deg, rgba(46,34,18,0.20) 0 50%, transparent 50%)`,
            clipPath: roughEdge(seed + 9, 1.4, 12),
          }}
        />
      ) : null}
      {look.extra === "rule" ? (
        <>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: "7%",
              right: "7%",
              top: "9%",
              height: 1.5,
              background: "rgba(26,26,26,0.30)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: "7%",
              right: "7%",
              bottom: "7%",
              height: 1.5,
              background: "rgba(26,26,26,0.30)",
            }}
          />
        </>
      ) : null}
      {look.extra === "border" ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: "0.05em",
            border: "2px solid rgba(26,26,26,0.32)",
            clipPath: roughEdge(seed + 3, 1.6, 9),
          }}
        />
      ) : null}
      {look.extra === "rail" ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "0.2em",
            top: "16%",
            bottom: "16%",
            width: 5,
            background: COLORS.accent,
            opacity: 0.92,
          }}
        />
      ) : null}

      <span style={{ position: "relative", display: "inline-block" }}>
        {text}
        {underline > 0 ? (
          <BrushUnderline
            p={underline}
            color={look.underline}
            seed={seed + 31}
            thickness={Math.max(5, Math.round(size * 0.07))}
            style={{ bottom: "-0.02em" }}
          />
        ) : null}
      </span>
      {tape && look.tape ? (
        <Tape
          seed={seed + 5}
          width={Math.round(size * 0.78)}
          height={Math.round(size * 0.24)}
          angle={-26}
          opacity={0.85}
          style={{ left: -Math.round(size * 0.18), top: -Math.round(size * 0.16) }}
        />
      ) : null}
    </span>
  );
};

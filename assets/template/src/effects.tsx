/**
 * 特效层：让画面"动起来"的东西。
 *
 * 都遵守 Remotion 的铁律——一切由 useCurrentFrame() 驱动，
 * 绝不用 CSS transition / animation / @keyframes。
 *
 * 这些不是 beat 组件（不能单独占一拍），是塞进任何 beat 里用的装饰层。
 */

import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { CameraMove } from "./timeline";

/** 确定性伪随机：同一个 frame 永远得到同一串数，保证逐帧渲染可复现 */
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/**
 * 胶片颗粒。极淡（默认 3.5%），只是为了让大面积纯色背景不那么"数字化"。
 *
 * 用伪随机点阵而不是 SVG feTurbulence——后者每帧要在全画幅重算一遍噪声，
 * 渲染会明显变慢，而这个强度下根本看不出两者区别。
 */
export const Grain: React.FC<{ opacity?: number }> = ({
  opacity = 0.035,
}) => {
  const frame = useCurrentFrame();
  const dots = useMemo(() => {
    const out: { x: number; y: number; r: number; o: number }[] = [];
    const n = 640;
    for (let i = 0; i < n; i++) {
      const a = hash(i * 7919 + frame * 131);
      const b = hash(i * 6271 + frame * 977);
      const c = hash(i + frame * 37);
      out.push({ x: a * 100, y: b * 100, r: c, o: 0.35 + c * 0.65 });
    }
    return out;
  }, [frame]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "overlay" }}>
      {/* viewBox 是 0-100，1920px 宽的画布上 1 个单位 ≈ 19px。
          所以半径必须给到 0.02-0.06 这种亚像素级才是"颗粒"，而不是"灰尘"。 */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={0.02 + d.r * 0.05}
            fill={hash(i + frame * 13) > 0.5 ? "#fff" : "#000"}
            opacity={d.o * opacity}
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
};

type ImpactStrength = "soft" | "medium" | "heavy";

const IMPACT: Record<ImpactStrength, { shake: number; zoom: number; frames: number }> = {
  soft: { shake: 4, zoom: 0.045, frames: 9 },
  medium: { shake: 9, zoom: 0.085, frames: 13 },
  heavy: { shake: 16, zoom: 0.13, frames: 18 },
};

/**
 * 冲击：镜头一记短促的推近 + 抖动，然后弹回。
 *
 * 用在**一个具体时刻**上——数字出现的瞬间、金句落下、转折点。
 * 全片用两三次就够，处处都用反而廉价。
 */
export const useImpact = (
  atFrame: number,
  strength: ImpactStrength = "medium",
): React.CSSProperties => {
  const frame = useCurrentFrame();
  const cfg = IMPACT[strength];
  const d = Math.max(1, frame - atFrame);

  const kick = interpolate(d, [0, cfg.frames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 抖动用两个不同频率的正弦叠加，比纯随机更像真实镜头
  const sx = Math.sin(d * 2.3) * cfg.shake * kick;
  const sy = Math.cos(d * 3.1) * cfg.shake * 0.7 * kick;
  const rot = Math.sin(d * 1.7) * cfg.shake * 0.08 * kick;
  const scale = 1 + cfg.zoom * kick;

  return { transform: `translate(${sx}px, ${sy}px) rotate(${rot}deg) scale(${scale})` };
};

/** useImpact 的容器版，直接包住内容 */
export const Impact: React.FC<{
  at: number;
  strength?: ImpactStrength;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, strength, children, style }) => {
  const t = useImpact(at, strength);
  return (
    <AbsoluteFill style={{ ...t, ...style }}>{children}</AbsoluteFill>
  );
};

/**
 * 闪白。用来给"啪"的一下——揭示、爆点。
 * 默认 3 帧（约 0.1s），再多就刺眼。
 */
export const Flash: React.FC<{
  at: number;
  duration?: number;
  color?: string;
  max?: number;
}> = ({ at, duration = 3, color = "#ffffff", max = 0.75 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [at, at + duration], [max, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (o <= 0.001) return null;
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: "none" }} />;
};

/** 一道斜向光带扫过画面。配合 accent 色做"聚光灯"效果 */
export const LightSweep: React.FC<{
  duration?: number;
  color?: string;
  delay?: number;
  width?: number;
}> = ({ duration = 26, color = "#ffffff", delay = 0, width = 46 }) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [delay, delay + duration], [-width, 100 + width], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const o = interpolate(
    frame,
    [delay, delay + duration * 0.25, delay + duration * 0.75, delay + duration],
    [0, 0.16, 0.16, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (o <= 0.001) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: "-20%",
          bottom: "-20%",
          left: `${x}%`,
          width: `${width}%`,
          background: `linear-gradient(100deg, transparent 0%, ${color} 45%, ${color} 55%, transparent 100%)`,
          opacity: o,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * 缓慢推拉（Ken Burns）。给 `image` 这类静态内容一点呼吸感。
 * `from`/`to` 是缩放区间，`pan` 是位移方向。
 */
export const KenBurns: React.FC<{
  from?: number;
  to?: number;
  pan?: "in" | "out" | "left" | "right" | "up";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ from = 1.0, to = 1.08, pan = "in", children, style }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 10 ** 6], [from, to], { extrapolateRight: "clamp" });
  const shift = interpolate(frame, [0, 10 ** 6], [0, 1], { extrapolateRight: "clamp" });
  const t: Record<string, string> = {
    in: `scale(${scale})`,
    out: `scale(${scale})`,
    left: `scale(${scale}) translateX(${shift * 4}%)`,
    right: `scale(${scale}) translateX(${-shift * 4}%)`,
    up: `scale(${scale}) translateY(${shift * 3}%)`,
  };
  return <AbsoluteFill style={{ ...style, transform: t[pan] }}>{children}</AbsoluteFill>;
};

/* ---------------------------------------------------------------- 元素级持续动作 */

/**
 * 元素浮动的位移量（px）。纯函数，不是 hook——列表里逐项调用是合法的。
 *
 * 为什么需要它：组件都是"入场动画跑完就定格"，而旁白往往还要说两三句，
 * 那几秒画面是死的（`check_motion.py` 里均差 <1.5 的死拍就是这么来的）。
 *
 * 为什么它比常驻运动层有用得多：帧均差主要吃**高对比、密边缘**的内容。
 * 一个超大柔光移动 30px 几乎测不出来，而一整块文字浮 2px 就有上万个像素在变。
 * 所以补动效要动文字和卡片的**位置**，不要去动背景。
 *
 * @param amp 振幅（px）。3-5 即可，超过 6 会读成"在漂"而不是"在呼吸"
 * @param period 周期（帧）。60-90（2-3 秒）最自然，太快会晕
 * @param seed 相位种子。同一画面里的多个元素必须错开，否则一起上下会像整块抖
 */
export const floatAt = (
  frame: number,
  amp = 4,
  period = 64,
  seed = 0,
): number => Math.sin(seed * 2.399 + (frame / period) * Math.PI * 2) * amp;

/* ---------------------------------------------------------------- 常驻运动层 */

export type AmbientStrength = "off" | "soft" | "normal" | "strong";

/**
 * 三档常驻运动的幅度。
 *
 * 为什么要有这一层：组件用 spring 入场、进场后归位静止，于是一拍里的大半段时间
 * 画面是死的。实测成片的静止帧占比 83%，而纸艺/实拍类参考片只有 2-9%。
 * 观众说不出哪里不对，只会觉得"像 PPT"。
 *
 * 四个量各管一件事：
 *   zoom   整帧缓慢推近 —— 画面边缘一直在动，这是"镜头在那里"的最低保证
 *   drift  低频漂移     —— 内容相对背景位移，产生视差，静止感就散了
 *   kick   入场动量     —— 转场后 0.3s 内从偏位收到正位，硬切才立得住
 *   light  漂移光       —— 大面积明暗流动，平涂底色靠它才不"数字化"
 *
 * 注意这不是"整体运镜就够了"。元素级动画（组件自己的词级入场、计数、画线）
 * 仍然是主力，这一层只负责把拍子之间的空档填上。
 *
 * **zoom 有硬上限**：满宽排版（KineticText 的一行 11 个字、Highlight 的圈注框）
 * 已经吃掉画面 90%+ 的宽度，推近超过 4% 就会在左右两边切字。0.08 实测直接把
 * "没有一个死在敌人手里"的末二字切掉。所以 strong 也只到 4.8%，需要更强的
 * 镜头感请改布局（给画面留出血），而不是继续调这个数。
 */
const AMBIENT: Record<
  AmbientStrength,
  { zoom: number; drift: number; kick: number; light: number }
> = {
  off: { zoom: 0, drift: 0, kick: 0, light: 0 },
  soft: { zoom: 0.018, drift: 8, kick: 12, light: 0.06 },
  normal: { zoom: 0.032, drift: 13, kick: 18, light: 0.09 },
  strong: { zoom: 0.048, drift: 20, kick: 26, light: 0.12 },
};

/**
 * 返回可以直接塞进 transform 的字符串；`off` 返回空串（不能返回 "none"，
 * 否则和 impact 拼起来变成 `none translate(...)`，整条声明会被浏览器丢弃）。
 *
 * `seed` 用 beat 序号：相邻两拍的漂移相位错开，否则连着三拍同向漂，
 * 会看出"整片在慢慢平移"。
 */
export const useAmbient = (
  frames: number,
  seed = 0,
  strength: AmbientStrength = "normal",
  /** 整幅已经有运镜时关掉这里的 zoom：两个缩放叠起来会切掉边缘的字 */
  withZoom = true,
): string => {
  const frame = useCurrentFrame();
  const cfg = AMBIENT[strength];
  if (!cfg.zoom && !cfg.drift && !cfg.kick) return "";

  const span = Math.max(1, frames);
  const p = Math.min(1, Math.max(0, frame / span));

  // 匀速推近。别给 ease-in-out——那会在中段"停一下"，正好把节奏懈掉
  const zoom = withZoom ? 1 + cfg.zoom * p : 1;

  // 两个周期不同的慢正弦叠加。单频看起来像机器往复，叠一层才像手持
  const ph = seed * 1.618;
  const dx = Math.sin(ph + frame / 78) * cfg.drift;
  const dy = Math.cos(ph * 1.31 + frame / 104) * cfg.drift * 0.72;
  const rot = Math.sin(ph + frame / 150) * 0.12;

  // 入场动量：10 帧收完，比常见转场略长一点，切点处才不会"顿"一下
  const k = interpolate(frame, [0, 10], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const kz = 1 + (cfg.kick / 1000) * k;
  const ky = cfg.kick * 0.55 * k;

  return `translate(${dx.toFixed(2)}px, ${(dy + ky).toFixed(2)}px) rotate(${rot.toFixed(
    3,
  )}deg) scale(${(zoom * kz).toFixed(4)})`;
};

/**
 * 漂移光。两块极大的柔光在画面上反向游走，soft-light 混合。
 *
 * 这是纯平涂配色最缺的一层：没有它，背景在帧与帧之间完全一致，
 * 压缩器甚至会把连续几十帧压成一帧，回放时更"死"。
 * 亮度极低（5-13%），只在潜意识层面起作用。
 */
export const AmbientLight: React.FC<{
  seed?: number;
  strength?: AmbientStrength;
}> = ({ seed = 0, strength = "normal" }) => {
  const frame = useCurrentFrame();
  const cfg = AMBIENT[strength];
  if (!cfg.light) return null;

  const ph = seed * 1.618;
  const x1 = 34 + Math.sin(ph + frame / 125) * 14;
  const y1 = 26 + Math.cos(ph * 1.2 + frame / 165) * 10;
  const x2 = 70 + Math.cos(ph * 0.8 + frame / 145) * 12;
  const y2 = 76 + Math.sin(ph * 1.1 + frame / 185) * 9;

  return (
    // 不用 mix-blend-mode：和祖先的 transform（定格微抖）一起会触发 Chromium
    // 的合成层缓存 bug——画面留下前几帧的残影。普通 alpha 叠加视觉效果一样。
    // 盒子要比画幅大一圈：运镜（pan/whip）会平移这一层，
    // 渐变块和画幅一样大的话，平移后它的边缘会被甩进画里，
    // 右侧露出一条竖直的色带（实测）。
    <AbsoluteFill style={{ pointerEvents: "none", opacity: cfg.light * 0.8, inset: "-30%" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(920px 640px at ${x1}% ${y1}%, #ffffff 0%, transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(780px 560px at ${x2}% ${y2}%, #000000 0%, transparent 58%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * 运镜（轴一）。
 *
 * 返回整幅的 transform。**幅度必须小**：排版已经吃掉画面 90% 的宽度，
 * 推近超过 4% 就会把末两个字切掉（实测："没有一个死在敌人手里"被切）。
 *
 * 平移类（pan/tilt/parallax/whip）靠**放大留出血**实现：先把画面放大到 1.06-1.12，
 * 再在出血范围内平移，这样平移时不会露出画布外的黑边。
 * 这是从别人的踩坑记录里抄来的规矩：**平移绝不能靠仿射位移硬凑**，
 * 一定是从 overscan 画布上取样。
 */
export const useCamera = (
  frames: number,
  move: CameraMove,
  seed = 0,
): { transform: string; blur: number } => {
  const frame = useCurrentFrame();
  const span = Math.max(1, frames);
  const p = Math.min(1, Math.max(0, frame / span));
  const ph = seed * 1.618;

  switch (move) {
    case "static":
      return { transform: "", blur: 0 };

    case "pull_out": {
      // 从略大拉回原位，读作"退开一点"
      const s = 1.035 - 0.035 * p;
      return { transform: `scale(${s.toFixed(4)})`, blur: 0 };
    }

    case "pan": {
      // 匀速横移 + 一点点呼吸，避免机械感
      const s = 1.06;
      const x = (0.025 - 0.05 * p) * 100;
      const wob = Math.sin(ph + frame / 90) * 0.25;
      return { transform: `scale(${s}) translateX(${(x + wob).toFixed(2)}%)`, blur: 0 };
    }

    case "tilt": {
      const s = 1.06;
      const y = (0.02 - 0.04 * p) * 100;
      return { transform: `scale(${s}) translateY(${y.toFixed(2)}%)`, blur: 0 };
    }

    case "parallax": {
      // 位移比 pan 大、带一点旋转：层差感来自背景自己在漂移（PaperStage 的 sway），
      // 这里只负责镜头横移
      const s = 1.08;
      const x = (0.04 - 0.08 * p) * 100;
      const r = Math.sin(ph + frame / 120) * 0.12;
      return { transform: `scale(${s}) translateX(${x.toFixed(2)}%) rotate(${r.toFixed(3)}deg)`, blur: 0 };
    }

    case "whip": {
      // 前 8 帧甩完：位移用 easeOut（五次方），同时叠一层方向性模糊当甩动残影。
      // 慎用：位移量比 pan 大，会切到画幅边缘的内容。
      const DUR = 8;
      const q = Math.min(1, frame / DUR);
      const e = 1 - Math.pow(1 - q, 5);
      // 1.2 的放大是给平移留出血：放大 20% 才容得下 9% 的横移
      const s = 1.2;
      const x = (0.09 - 0.18 * e) * 100;
      const blur = frame < DUR ? (1 - q) * 9 : 0;
      return { transform: `scale(${s}) translateX(${x.toFixed(2)}%)`, blur };
    }

    case "push_in":
    default: {
      // 匀速推近。别用 ease-in-out——中段"停一下"正好把节奏懈掉
      const s = 1 + 0.035 * p;
      return { transform: `scale(${s.toFixed(4)})`, blur: 0 };
    }
  }
};

/**
 * 纸屑雨（程序化特效）。
 *
 * 剪下来的小纸片从画面上方飘落，边翻边转。位置/速度/初始相位全部由
 * seed 决定，逐帧渲染可复现。
 *
 * 强度别调太满：这是"庆祝"信号，一拍给一次就够，连着几拍都在下会吵。
 */
export const Confetti: React.FC<{
  /** 下雨持续的帧数 */
  duration?: number;
  /** 纸屑数量 */
  count?: number;
  color?: string;
  seed?: number;
  /** 起始延迟帧数 */
  delay?: number;
}> = ({ duration = 70, count = 46, color = "#E2603C", seed = 0, delay = 0 }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;

  // hook 必须无条件调用：早退要放在 useMemo 之后。
  // 放前面的话，纸屑从"没出现"到"出现"的那一帧 hook 数量会变，
  // React 直接抛 #310（Rendered more hooks than during the previous render）。
  const pieces = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; v: number; rot: number; sway: number; c: string }[] = [];
    for (let i = 0; i < count; i++) {
      const a = hash(i * 7919 + seed * 131);
      const b = hash(i * 6271 + seed * 977);
      const c = hash(i + seed * 37);
      const d = hash(i * 104729 + seed * 17);
      out.push({
        x: a * 100,
        y: b * 100,
        w: 0.5 + c * 0.7,
        h: 0.9 + d * 1.4,
        v: 0.9 + a * 1.6,           // 下落速度
        rot: (d - 0.5) * 360,       // 初始朝向
        sway: 0.6 + c * 1.8,        // 左右摆幅
        c: c > 0.72 ? "#F2C14E" : c > 0.4 ? color : "#E8E2D2",
      });
    }
    return out;
  }, [count, seed, color]);

  if (t < 0 || t > duration) return null;

  // 整场从 0 到 1 淡入淡出，尾巴淡出比突然消失干净
  const alpha = Math.min(1, t / 8) * Math.min(1, (duration - t) / 14);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: Math.max(0, alpha) }}>
      {pieces.map((p, i) => {
        // 从画面上方落到画面下方，循环两轮
        const fall = ((p.y + (t * p.v) / duration * 130) % 130) - 15;
        const x = p.x + Math.sin(t / 26 + i) * p.sway;
        const rot = p.rot + t * (1.2 + p.v) * 6;
        // 翻面：用 scaleX 在 1 和 -1 之间摆，做出纸片翻面的效果
        const flip = Math.abs(Math.cos(t / 18 + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${fall}%`,
              width: `${p.w}%`,
              height: `${p.h}%`,
              background: p.c,
              transform: `rotate(${rot.toFixed(1)}deg) scaleX(${flip.toFixed(3)})`,
              boxShadow: "0 2px 5px rgba(46,34,18,0.22)",
              borderRadius: 1,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * 冲击放射（程序化特效）。
 *
 * 放射状线条从一点炸开，配合 impact 拍用。纯 SVG，参数都定死 → 可复现。
 */
export const Starburst: React.FC<{
  /** 炸开的中心（0-1） */
  cx?: number;
  cy?: number;
  /** 持续帧数 */
  duration?: number;
  rays?: number;
  color?: string;
  /** 延迟帧数 */
  delay?: number;
  /** 半径（占画幅短边的比例） */
  radius?: number;
  /** 射线分布的种子，不同拍炸开的形状不一样 */
  seed?: number;
}> = ({ cx = 0.5, cy = 0.5, duration = 26, rays = 22, color = "#E8B33C", delay = 0, radius = 0.46, seed = 0 }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  if (t < 0 || t > duration) return null;

  const q = t / duration;
  const grow = 1 - Math.pow(1 - q, 3);        // easeOutCubic
  // 透明度要低：这是"背景里炸开"，不是盖在画面上的一层黄。
  // 调到 0.85 时放射线会压住大字，观众先看到线、后看到字（实测）。
  const alpha = (1 - q) * 0.42;

  const lines = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + hash(i * 131 + seed * 7) * 0.12;
    const inner = 0.1 + hash(i * 37 + seed * 3) * 0.12;
    const outer = inner + 0.35 + hash(i * 91 + seed * 11) * 0.4;
    const len = (outer - inner) * grow;
    lines.push(
      <line
        key={i}
        x1={50 + Math.cos(a) * inner * 50 * grow}
        y1={50 + Math.sin(a) * inner * 50 * grow}
        x2={50 + Math.cos(a) * (inner + len) * 50}
        y2={50 + Math.sin(a) * (inner + len) * 50}
        stroke={color}
        strokeWidth={0.35 + hash(i * 17 + seed) * 0.7}
        strokeLinecap="round"
      />,
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: alpha }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        <g transform={`translate(${cx * 100} ${cy * 100}) scale(${radius * 2}) translate(-50 -50)`}>
          {lines}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

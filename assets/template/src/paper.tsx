/**
 * 纸艺拼贴（MG-VOXSTAGE）视觉层。
 *
 * 扁平矢量读起来像 PPT，很大一部分原因不是"没动"，而是所有元素都长得
 * 像屏幕上的矩形：直角圆角、纯色、无投影、端正对齐。真实的纸是**切出来**的：
 * 边缘不平、会压到别的纸上留一道影、贴的时候手一歪就是个角度。
 *
 * 这里的三个工具就是这三件事：
 *   - `roughEdge`  边缘抖动（剪刀裁出来的毛边）
 *   - `PaperSheet` 一张带投影和轻微旋转的纸，替代原来的圆角卡片
 *   - `Tape`       半透明胶带，贴在纸角上
 *
 * 全部用 CSS 实现，不依赖图片资源，也没有 SVG 滤镜（feTurbulence 在逐帧
 * 渲染里太慢）。随机量走 `hash01`，同一 seed 每帧结果一致，渲染可复现。
 */

import React from "react";

/** 底纸容器向外多铺出来的边（px）。
 *  纸张漂移/旋转时不能露出画幅边缘，所以整层比画幅大一圈。
 *  代价：写在纸上的元素如果是按画幅百分比定位的，会跟着放大一点。
 *  需要"严格按画幅坐标"的层（比如碎片拼贴的取景窗）必须把这个量减回去。 */
export const STAGE_INFLATE = 14;

export const PAPER = {
  /** 纸片：比底纸亮一档，纸才是"叠"上去的。
   *  不用纯白——纯白在米棕底纸上会读成"屏幕上的白色面板"，是 PPT 感的来源之一。 */
  sheet: "#F8F1E0",
  sheetWarm: "#F0E5CE",
  /** 纸的侧边：模拟一层厚度的暗线 */
  edge: "rgba(52,39,22,0.22)",
  /** 投影：偏暖，不能用纯黑，纯黑会显脏 */
  shade: "rgba(46,34,18,0.32)",
  tape: "rgba(219,186,124,0.70)",
  tapeEdge: "rgba(186,150,80,0.45)",
} as const;

/** 确定性伪随机：同一 seed 永远同一结果，渲染才能逐帧复现 */
export const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** 纸片该歪多少度。±amp 以内，太小看不出，超过 1.2° 会读成"放歪了" */
export const tiltFor = (seed: number, amp = 0.6) => (hash01(seed) - 0.5) * 2 * amp;

/**
 * 定格抖动（stop-motion jitter）。
 *
 * 拼贴动画是逐格摆拍的：每一格手放的位置都有 1-2px 的误差。这个误差不是瑕疵，
 * 它是"这是实物"的核心信号——真实纸张被逐帧拍摄时，边缘一直在微微呼吸。
 *
 * `hold` 是保持帧数：每 3 帧换一次位置，读起来像 12fps 的定格，而不是视频抖动。
 * `rotAmp` 是旋转振幅（度）。单独抖位置时纸片像在"跳"，带一点旋转才像被手碰过。
 */
export const jitter = (frame: number, seed: number, amp = 1.6, hold = 3, rotAmp = 0.6) => {
  const k = Math.floor(frame / hold) + seed * 17;
  return {
    x: (hash01(k) - 0.5) * 2 * amp,
    y: (hash01(k + 91) - 0.5) * 2 * amp,
    rot: (hash01(k + 173) - 0.5) * 2 * rotAmp,
  };
};

/**
 * 缓慢漂移（smooth sway）。
 *
 * 这是定格抖动的**默认替代**：同样是"纸在动"，但用两个频率略不同的低频正弦，
 * 位移是连续的，读起来是"纸张/镜头在缓慢呼吸"；而 `jitter` 是每 3 帧跳一次位置，
 * 大范围用（整幅、每张卡片、每个标签同时跳）就会变成"画面一直在抖"。
 *
 * 规则：整幅/大面积 → 用 `sway`；单个小标签偶尔可以用 `jitter` 保留一点手工感。
 * 周期越短越像在动，150-260 帧读作"几乎静止但活着"。
 */
export const sway = (frame: number, seed: number, amp = 3, period = 160) => {
  const p = hash01(seed) * Math.PI * 2;
  return {
    x: Math.sin((frame / period) * Math.PI * 2 + p) * amp,
    y: Math.cos((frame / (period * 1.27)) * Math.PI * 2 + p * 1.7) * amp * 0.65,
  };
};

/**
 * 毛边多边形。用 `clip-path` 而不是 SVG 滤镜：多边形只是几何裁剪，
 * 每帧几乎零成本；滤镜要重算整块纹理，逐帧渲染会慢好几倍。
 *
 * 抖动幅度单位是 px（不是百分比）——百分比抖动在大元素上会变成明显的缺口。
 */
export const roughEdge = (seed: number, amp = 2.4, step = 8) => {
  const pts: string[] = [];
  const j = (i: number) => (hash01(seed * 9.13 + i) * amp).toFixed(1);
  for (let x = 0; x <= 100; x += step) pts.push(`${x}% ${j(x)}px`);
  for (let y = step; y <= 100; y += step) pts.push(`calc(100% - ${j(y + 101)}px) ${y}%`);
  for (let x = 100 - step; x >= 0; x -= step) pts.push(`${x}% calc(100% - ${j(x + 202)}px)`);
  for (let y = 100 - step; y >= step; y -= step) pts.push(`${j(y + 303)}px ${y}%`);
  return `polygon(${pts.join(", ")})`;
};

/**
 * 分层背景板的裁切带：只保留画面纵向 top% → bottom% 这一条，其余裁掉，
 * 顶边做成撕开的纸边，读起来就是"一张纸垫在另一张纸上"。
 * top / bottom 是百分比（0-100）。
 */
export const bandEdge = (seed: number, top: number, bottom: number, amp = 0.9, step = 5) => {
  const t = Math.min(98, Math.max(0, top));
  const b = Math.min(100, Math.max(t + 1, bottom));
  const pts: string[] = [];
  for (let x = 0; x <= 100; x += step) {
    const y = t + (hash01(seed * 7.7 + x) - 0.5) * amp;
    pts.push(`${x}% ${y.toFixed(2)}%`);
  }
  pts.push(`100% ${b}%`, `0% ${b}%`);
  return `polygon(${pts.join(", ")})`;
};

/**
 * 一张纸。
 *
 * 投影必须放在**背景层**的 `filter: drop-shadow` 上，不能用 box-shadow：
 * box-shadow 会被 clip-path 一起裁掉；也不能放在外层容器上——那样卡片里
 * 的每个字都会投一道 16px 的影，读起来全是重影。
 */
export const PaperSheet: React.FC<{
  seed?: number;
  /** 覆盖自动倾斜角（度） */
  rotate?: number;
  tiltAmp?: number;
  radius?: number;
  color?: string;
  /** 毛边幅度；0 = 干净裁切（硬质材料才用干净边） */
  rough?: number;
  shadow?: boolean;
  /** 传当前帧就自动加一层缓慢漂移；组件自己写 transform 时需自行调用 `sway` */
  frame?: number;
  driftAmp?: number;
  style?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({
  seed = 1,
  rotate,
  tiltAmp = 0.6,
  radius = 10,
  color = PAPER.sheet,
  rough = 2.4,
  shadow = true,
  frame,
  driftAmp = 1.2,
  style,
  contentStyle,
  children,
}) => {
  const rot = rotate ?? tiltFor(seed, tiltAmp);
  const j = frame === undefined ? { x: 0, y: 0 } : sway(frame, seed, driftAmp, 170);
  return (
    <div
      style={{
        position: "relative",
        transform: `translate(${j.x}px, ${j.y}px) rotate(${rot}deg)`,
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: color,
          borderRadius: radius,
          clipPath: rough > 0 ? roughEdge(seed, rough) : undefined,
          filter: shadow
            ? // 三层影：贴边一道硬线（剪口）、一层硬偏移（纸叠纸）、一层软影（离桌面）
              `drop-shadow(0 1px 0 ${PAPER.edge}) drop-shadow(9px 11px 0 rgba(46,34,18,0.09)) drop-shadow(0 16px 20px ${PAPER.shade})`
            : undefined,
        }}
      />
      {/* 纸片自己也有印刷纹理。纯色纸压在带纹理的底纸上，读起来是
          "屏幕里的一张白卡片"——网点只加 3% 的脏，却把两层的材质接上了。 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          clipPath: rough > 0 ? roughEdge(seed, rough) : undefined,
          ...sheetTexture,
        }}
      />
      <div style={{ position: "relative", ...contentStyle }}>{children}</div>
    </div>
  );
};

/** 胶带。贴在纸角上，是"手工贴的"最便宜的信号 */
export const Tape: React.FC<{
  seed?: number;
  width?: number;
  height?: number;
  angle?: number;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({ seed = 7, width = 200, height = 56, angle = -7, opacity = 1, style }) => (
  <div
    style={{
      position: "absolute",
      width,
      height,
      background: PAPER.tape,
      boxShadow: "0 3px 10px rgba(52,38,18,0.14)",
      clipPath: roughEdge(seed, 1.8, 6),
      transform: `rotate(${angle}deg)`,
      opacity,
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.30) 0 5px, transparent 5px 13px)`,
        opacity: 0.55,
      }}
    />
  </div>
);

/**
 * 纸片上的半调网点。极淡，只负责把"纯色块"变成"印出来的纸"。
 * 加在 `filter`/`clipPath` 之外的面层上，投影仍然只跟背景块走。
 */
export const sheetTexture: React.CSSProperties = {
  backgroundImage: `radial-gradient(rgba(58,46,28,0.26) 0.8px, transparent 0.95px)`,
  backgroundSize: "6px 6px",
  backgroundPosition: "1px 2px",
  opacity: 0.13,
  pointerEvents: "none",
};

/**
 * 红笔划线。风格板里"标题下划线"是整片最便宜也最有效的强调：
 * 手画的线不可能完全水平，所以用三条粗细不同、微微起伏的路径叠出来，
 * 出场时按裁剪区从左往右"划"过去，跟旁白落在同一个词上。
 *
 * 揭示用 `clipPath` 而不是 `stroke-dashoffset`：线宽用了
 * `vectorEffect="non-scaling-stroke"`，此时 `pathLength` 归一化会失效，
 * dash 长度按 viewBox 单位算（1 ≈ 19px），一条线会被拆成一串碎段（实测）。
 */
export const BrushUnderline: React.FC<{
  /** 0-1 的绘制进度 */
  p: number;
  color?: string;
  seed?: number;
  /** 线宽（px，non-scaling-stroke 保证在任何宽度下都一致） */
  thickness?: number;
  style?: React.CSSProperties;
}> = ({ p, color = "#D62E1F", seed = 1, thickness = 7, style }) => {
  const uid = React.useId().replace(/:/g, "");
  const paths = [0, 1, 2].map((i) => {
    const y = 5 + (hash01(seed * 13 + i) - 0.5) * 1.6;
    const amp = 0.9 + hash01(seed * 7 + i) * 0.8;
    let d = `M 0.5 ${y.toFixed(2)}`;
    for (let x = 8; x <= 100; x += 8) {
      const wob = (hash01(seed * 31 + i * 17 + x) - 0.5) * amp;
      d += ` Q ${x - 4} ${(y + wob).toFixed(2)} ${x} ${(y + wob * 0.4).toFixed(2)}`;
    }
    return d;
  });

  const clip = Math.min(1, Math.max(0, p)) * 102;

  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden
      style={{
        position: "absolute",
        left: "-1.5%",
        width: "103%",
        bottom: "-0.02em",
        height: "0.2em",
        overflow: "visible",
        pointerEvents: "none",
        ...style,
      }}
    >
      <defs>
        <clipPath id={`bu-${uid}`}>
          <rect x="-1" y="-2" width={clip} height="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#bu-${uid})`}>
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={thickness * (i === 0 ? 1 : i === 1 ? 0.65 : 0.4)}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={i === 0 ? 0.95 : 0.8}
          />
        ))}
      </g>
    </svg>
  );
};

/**
 * 纸纤维。两层不同周期的点阵叠在一起，避免出现可见的网格——
 * 单一尺寸的点阵在 1080p 下会读成扫描线。
 *
 * 幅度必须压得很低：满屏高频噪点会让编码器把码率全花在静态纹理上，
 * 运动边缘反而被压糊——实测整片帧间均差因此掉了 13%。
 */
export const fiberStyle: React.CSSProperties = {
  backgroundImage: `
    radial-gradient(rgba(96,74,42,0.030) 1px, transparent 1.5px),
    radial-gradient(rgba(96,74,42,0.022) 1px, transparent 1.5px),
    radial-gradient(rgba(255,255,255,0.16) 1.5px, transparent 2px)
  `,
  backgroundSize: "7px 7px, 12px 12px, 17px 17px",
  backgroundPosition: "0 0, 4px 6px, 9px 3px",
};

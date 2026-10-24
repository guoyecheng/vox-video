/**
 * 碎片拼贴（元素级动效）。
 *
 * 把**一张**纸艺拼贴图切成若干矩形块，每块按关键帧飞入/落位，最后拼回原图。
 *
 * 为什么不用 AI 抠图
 * ------------------
 * 抠图模型（BiRefNet / RMBG）是在真实照片上训的。我们这种平涂纸艺图的前景背景
 * 对比不"自然"，抠出来边缘会带一片纸底色，还会把撕边吃掉。
 * 而"从同一张图上切矩形"是**精确**的：拼回去就是原图，一个像素不差。
 * 想要自由形状的部件，再上抠图模型（见 references/comfyui.md）。
 *
 * 四个关键点（都是踩过的坑）
 * ------------------------
 * 1. **底图要挖洞**。如果底图是完整的，飞进来的块会跟它重影（"鬼影"）。
 *    所以底图用 mask 把每块的位置挖空，块飞进去正好填上。
 *    洞用**方角**，块也用方角 → 严丝合缝。用毛边的话两边形状对不上，会留缝。
 * 2. **缩放不要过冲**。带过冲的缓动（back）用在 scale 上会短暂小于 1.0，
 *    底下会露出底图的残影。位移可以用过冲（甩进来的感觉），缩放不行。
 * 3. **底图和块必须共用同一层滤镜/纸浆**。分别调 `filter` 会让接缝处色差跳出来；
 *    正确的做法是把滤镜加在**整个层**上、纸浆盖在**两者之上**，
 *    这样组装完成时看起来就是一张完整的图（不会看到矩形拼缝）。
 * 4. **呼吸缩放要加在整层上**。只缩底图不缩块 = 缝会开。
 * 5. **块必须互相叠一点**。四块精确拼满时，浏览器按小数像素裁切，接缝会漏出
 *    底下一像素的纸色 —— 一条从上到下的浅色直线（实测）。每块向外扩 0.4%，
 *    重叠区取的是同一片源像素，所以叠了也看不出来；投影要在落位时**淡掉**，
 *    否则上层的投影会横过邻居的边。
 */

import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";
import { STAGE_INFLATE } from "../paper";
import type { PieceSpec } from "../timeline";

/** 缓动：位移用（带过冲），缩放用（无过冲） */
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** 每块向外扩的量（占画幅比例）。0.4% ≈ 1920 宽下的 7.7px 重叠 */
const PAD = 0.004;

/**
 * 生成底图的遮罩：整张白（= 保留），每块的位置挖透明（= 洞）。
 * 用 alpha 遮罩：白色 alpha=1 保留，`fill-opacity=0` 的黑矩形 alpha=0 → 挖洞。
 */
/** 一块的入场变换。返回 transform 字符串 + 透明度。 */
const enterTransform = (p: number, spec: PieceSpec) => {
  const spin = spec.spin ?? 0;
  const depth = spec.depth ?? 0.6;
  switch (spec.enter) {
    case "fly_left": {
      const e = easeOutBack(p);
      return {
        transform:
          `translateX(${((1 - e) * -120).toFixed(2)}%) ` +
          `rotate(${((1 - e) * spin).toFixed(2)}deg)`,
        opacity: Math.min(1, p / 0.25),
      };
    }
    case "fly_right": {
      const e = easeOutBack(p);
      return {
        transform:
          `translateX(${((1 - e) * 120).toFixed(2)}%) ` +
          `rotate(${((1 - e) * spin).toFixed(2)}deg)`,
        opacity: Math.min(1, p / 0.25),
      };
    }
    case "fly_up": {
      const e = easeOutBack(p);
      return {
        transform:
          `translateY(${((1 - e) * -120).toFixed(2)}%) ` +
          `rotate(${((1 - e) * spin).toFixed(2)}deg)`,
        opacity: Math.min(1, p / 0.25),
      };
    }
    case "drop": {
      // 下落 → 落地压扁 → 回弹。两段：0-68% 下落，68-100% 回弹
      const fall = Math.min(1, p / 0.68);
      const e = easeOutCubic(fall);
      let squash = 1;
      if (p > 0.68) {
        const q = (p - 0.68) / 0.32;
        squash = 1 - Math.sin(q * Math.PI) * 0.09;
      }
      return {
        transform:
          `translateY(${((1 - e) * -140).toFixed(2)}%) ` +
          `scaleY(${squash.toFixed(3)}) scaleX(${(2 - squash).toFixed(3)})`,
        opacity: Math.min(1, p / 0.18),
      };
    }
    case "slap": {
      // 从大到小"啪"地贴上来
      const e = easeOutCubic(p);
      const s = 1 + (1 - e) * 0.75;
      return {
        transform: `scale(${s.toFixed(3)}) rotate(${(spin * (1 - e) * 1.6).toFixed(2)}deg)`,
        opacity: Math.min(1, p / 0.15),
      };
    }
    case "pop":
    default: {
      // 原地放大归位。缩放**不**带过冲（见文件头的坑 2）
      const e = easeOutCubic(p);
      const s = 1 + (1 - e) * 0.35;
      return {
        transform: `scale(${s.toFixed(3)}) rotate(${(spin * (1 - e)).toFixed(2)}deg)`,
        opacity: Math.min(1, p / 0.2),
      };
    }
  }
};

export const PieceLayer: React.FC<{
  /** 底图（相对 public/），必须和画幅同比例（16:9），否则会拉伸变形 */
  base: string;
  pieces: PieceSpec[];
  /** 本拍在全片中的起始帧：让呼吸缩放和 PaperStage 底纸同步 */
  phaseOffset?: number;
  /** 纸浆覆盖强度，0-1。和同片其他整幅图拍保持一致（浅色 0.42 / 深色 0.55） */
  wash?: number;
  tone?: "paper" | "night";
  /** 每块的投影相位，让投影不完全一样（避免一眼看出是复制的） */
  seed?: number;
}> = ({ base, pieces, phaseOffset = 0, wash, tone = "paper", seed = 0 }) => {
  const frame = useCurrentFrame();
  const t = frame + phaseOffset;
  const night = tone === "night";

  const { width, height } = useVideoConfig();
  const src = useMemo(() => staticFile(base), [base]);

  // 挖洞路径：外层矩形顺时针 + 每个洞一个子路径，evenodd 决定谁被掏空。
  // 用画幅 px 坐标，所以这一层必须严格等于画幅（见下面的 STAGE_INFLATE）。
  const holeClip = useMemo(() => {
    const outer = `M0 0 H${width} V${height} H0 Z`;
    const holes = pieces
      .map((p) => {
        const x0 = p.x * width;
        const y0 = p.y * height;
        const x1 = (p.x + p.w) * width;
        const y1 = (p.y + p.h) * height;
        return `M${x0} ${y0} H${x1} V${y1} H${x0} Z`;
      })
      .join(" ");
    return `path(evenodd, "${outer} ${holes}")`;
  }, [pieces, width, height]);

  // 远的先画（depth 小 → z-index 小）
  const ordered = useMemo(
    () => [...pieces].sort((a, b) => (a.depth ?? 0.6) - (b.depth ?? 0.6)),
    [pieces],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", inset: STAGE_INFLATE }}>
      {/* 表现为"一整张图"的容器：呼吸缩放 + 统一滤镜。
          filter 放在这一层，底图和块同时吃到，接缝才不会跳色。
          这一层被 PaperStage 的底纸容器（inset: -STAGE_INFLATE）包着，
          所以要用 inset: +STAGE_INFLATE 把尺寸/原点减回画幅，否则整层
          会放大 1.5%、右下角偏出十几个像素（实测接缝对不齐）。 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${(1.01 + 0.012 * Math.sin(t / 200)).toFixed(5)})`,
          filter: "saturate(0.9) contrast(0.96) brightness(1.02)",
        }}
      >
        {/* 底图：把每块的位置挖掉，等着块飞进来填。
            这里用 clip-path: path(evenodd, ...)，不要用 CSS mask-image 塞
            data-URI、也不要用内联 SVG <mask>：实测两种在本机的 Remotion
            Chromium 里都**静默失效**（不报错、也不遮），底图整张留在那，
            飞进来的块就成了重影，而且看不出哪里错。
            evenodd 下外层矩形 + 若干内层矩形 = 挖洞，不需要操心路径方向。 */}
        <AbsoluteFill>
          <img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "fill",
              clipPath: holeClip,
            }}
          />
        </AbsoluteFill>

        {ordered.map((p, i) => {
          const at = p.at ?? i * 8;
          const dur = p.enter === "pop" || p.enter === "slap" ? 14 : 22;
          const raw = interpolate(frame - at, [0, dur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const { transform, opacity } = enterTransform(raw, p);
          const depth = p.depth ?? 0.6;
          // 向外扩 PAD，让相邻块重叠约 2*PAD（见文件头坑 5）。
          // 采样区域仍然是 (x,y,w,h)：扩的是画出来的盒子，源坐标不变。
          const rx = p.x - PAD;
          const ry = p.y - PAD;
          const rw = p.w + PAD * 2;
          const rh = p.h + PAD * 2;
          // 关键：底图**始终钉在画幅左上角**（画幅大小铺满），每块只是它的一个取景窗。
          // background-position 的百分比是按"盒子和图之间的空档"算的：
          //   offset = p% × (盒宽 − 图宽) = p% × F(1 − rw)
          // 要让图钉在 0 处（offset = −盒左边 −rx·F），于是
          //   p = −rx / (1 − rw)
          // **不要**写 (x − rx)/(1 − rw)：只有当 x = 0 时才和这个式子相等，
          // 右边那几块会整块显示错位置（实测：右半幅变成一片空白纸）。
          const posX = Math.abs(rw - 1) < 1e-9 ? 0 : (rx / (rw - 1)) * 100;
          const posY = Math.abs(rh - 1) < 1e-9 ? 0 : (ry / (rh - 1)) * 100;
          const jitterSeed = ((seed + i * 7) % 5) - 2;
          // 投影只在飞行时存在：落位后淡到 0，不然会横过邻居的边
          const shadowFade = 1 - easeOutCubic(raw);

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${rx * 100}%`,
                top: `${ry * 100}%`,
                width: `${rw * 100}%`,
                height: `${rh * 100}%`,
                backgroundImage: `url("${src}")`,
                backgroundSize: `${(100 / rw).toFixed(4)}% ${(100 / rh).toFixed(4)}%`,
                backgroundPosition: `${posX.toFixed(4)}% ${posY.toFixed(4)}%`,
                backgroundRepeat: "no-repeat",
                transform,
                opacity,
                zIndex: 10 + Math.round(depth * 10),
                boxShadow:
                  `0 ${(2 + depth * 6 + jitterSeed * 0.6).toFixed(1)}px ` +
                  `${(8 + depth * 20).toFixed(1)}px ` +
                  `rgba(46,34,18,${((0.08 + depth * 0.18) * shadowFade).toFixed(3)})`,
                willChange: "transform",
              }}
            />
          );
        })}

        {/* 纸浆：盖在底图和块**之上**，两边同强度 → 组装后看不出接缝。
            单独调底图或单独调块都会让缝隙跳色（见文件头坑 3）。 */}
        <AbsoluteFill
          style={{
            background: night ? COLORS.night : COLORS.stage,
            opacity: wash ?? (night ? 0.55 : 0.42),
            zIndex: 40,
          }}
        />
        {/* 四周压纸色：和 PaperStage 的整幅图一致，让图读成"贴在纸上" */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(125% 95% at 50% 46%, transparent 34%, ${
              night ? COLORS.night : COLORS.stage
            }B0 100%)`,
            zIndex: 41,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

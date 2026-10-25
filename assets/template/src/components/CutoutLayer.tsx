/**
 * 抠图元素层（beat 级）。
 *
 * 每个元素都是一张独立生成的平底图，被 `cutout.py` 抠成透明 PNG。
 * 相比"一张合成图 + 分块拼贴"，这条路允许：
 *   · 元素之间真正的前后遮挡（方盖可以盖住洞，再掉进洞里）；
 *   · 每个元素独立的入场、悬浮、坠落，而不是整幅一起动；
 *   · 素材重出时只换一张图，不用重切整幅。
 *
 * 三个约束：
 *   1. 坐标用**中心点**。元素大小按 w（画幅比例）算，高度跟图走。
 *   2. 入场锚在词上（`at`），坠落也锚在词上（`fall`）——旁白念到哪，动作到哪。
 *   3. 投影加在 `<img>` 自己的 `filter` 上。素材自带的烘焙阴影要在
 *      `shadow: 0` 里关掉程序投影，两层影子会脏。
 */

import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Beat, CutoutSpec } from "../timeline";
import { resolveWordTimings } from "./BeatPresence";

const anchorAt = (word: string | undefined, beat: Beat): number => {
  if (!word) return 0;
  const hit = resolveWordTimings([word], beat.words, beat.durationInFrames)[0];
  return hit ? Math.max(0, hit.t - 2) : 0;
};

const Cutout: React.FC<{ spec: CutoutSpec; beat: Beat; index: number }> = ({ spec, beat, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const start = anchorAt(spec.at, beat);
  const fallAt = spec.fall ? anchorAt(spec.fall, beat) : null;
  const local = frame - start;
  const enter = spec.enter ?? "pop";
  const depth = Math.min(1, Math.max(0, spec.depth ?? 0.5));
  const baseRotate = spec.rotate ?? 0;

  /* ---- 入场 ---- */
  const springIn = (damping: number, seconds: number) =>
    spring({
      frame: local,
      fps,
      config: { damping, stiffness: 180, mass: 0.8 },
      durationInFrames: Math.round(fps * seconds),
    });

  let dx = 0;
  let dy = 0;
  let scale = 1;
  let rotate = 0;
  let opacity = interpolate(local, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  switch (enter) {
    case "pop": {
      scale = 0.72 + 0.28 * springIn(12, 0.5);
      break;
    }
    case "drop": {
      const p = springIn(9, 0.7);
      dy = (1 - p) * -180;
      rotate = (spec.spin ?? 10) * (1 - p);
      break;
    }
    case "rise": {
      const p = springIn(200, 0.45);
      dy = (1 - p) * 120;
      break;
    }
    case "fly_left": {
      const p = springIn(11, 0.6);
      dx = (1 - p) * -300;
      rotate = (spec.spin ?? -8) * (1 - p);
      break;
    }
    case "fly_right": {
      const p = springIn(11, 0.6);
      dx = (1 - p) * 300;
      rotate = (spec.spin ?? 8) * (1 - p);
      break;
    }
    case "stamp": {
      scale = 1.35 - 0.35 * springIn(11, 0.5);
      break;
    }
  }

  /* ---- 悬浮：按深度给不同的漂移速度，形成层差 ---- */
  const drift = Math.sin(frame / 34 + index * 1.7) * 6;
  dx += (depth - 0.5) * 2 * drift;

  /* ---- 坠落：念到 fall 词后往下掉、缩小、转一点 ---- */
  if (fallAt !== null) {
    const p = interpolate(frame, [fallAt, fallAt + 22], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const e = p * p;
    // 下沉幅度必须小于洞的开口：位移一大，元素就滑到纸面上，
    // 半透明地压着纸读起来像穿帮，不像掉进去。
    // 真正的"进去"由缩小和提前淡出承担。
    dy += e * 90;
    scale *= 1 - 0.62 * e;
    rotate += 40 * e;
    opacity *= interpolate(p, [0.55, 0.9], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }

  /* ---- 拍级退场：和别的组件一起收 ---- */
  const outP = interpolate(frame, [beat.durationInFrames - 10, beat.durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  opacity *= outP * (spec.opacity ?? 1);

  const shadowPx = spec.shadow ?? 20;
  const lift = 8 + Math.round(depth * 14);

  /**
   * 印刷化（`print: true`）：素材多半是写实渲染，灰阶 + 反向投影会把它
   * 变成"剪下来贴在纸上的一张印刷品"——风格板里所有元素都走这套语法：
   * 半调网点、黑描边、红色偏移剪影。不这样做，一张彩色 3D 图压在米色纸
   * 上，整幅立刻露馅成"贴图 PPT"。
   *
   * 红色偏移剪影只给 CompareSplit 的几何形状用——写实素材的 alpha 边缘
   * 带烘焙阴影，剪影会沿着半透明区域糊成一圈红斑。这里只做去色，
   * 让素材读成"印在纸上的灰阶照片"。
   */
  const filters: string[] = [];
  if (spec.print) filters.push("grayscale(1) contrast(1.08) brightness(1.02)");
  if (shadowPx > 0) {
    filters.push(
      `drop-shadow(0 ${lift}px ${shadowPx}px rgba(20, 22, 26, ${(0.22 + depth * 0.16).toFixed(2)}))`,
    );
  }
  const filter = filters.length ? filters.join(" ") : undefined;

  return (
    <div
      style={{
        position: "absolute",
        left: `${spec.x * 100}%`,
        top: `${spec.y * 100}%`,
        width: `${spec.w * 100}%`,
        transform: `translate(-50%, -50%) translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${(baseRotate + rotate).toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        opacity,
      }}
    >
      <Img
        src={staticFile(spec.src)}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          mixBlendMode: spec.print ? "multiply" : (spec.blend ?? "normal"),
          filter,
        }}
      />
    </div>
  );
};

export const CutoutLayer: React.FC<{ beat: Beat; items: CutoutSpec[] }> = ({ beat, items }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {items.map((spec, i) => (
      <Cutout key={`${spec.src}-${i}`} spec={spec} beat={beat} index={i} />
    ))}
  </AbsoluteFill>
);

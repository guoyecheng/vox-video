/**
 * 底纸上的旧地图纹。
 *
 * 风格板的底子不是"米色"，是**一张印过地图的旧纸**：街区、道路、等高线、
 * 河流、比例尺，全部压到 10%-30% 的不透明度，读起来只是纸的肌理。
 * 平涂底色之所以像 PPT，是因为大面积像素在帧与帧之间完全一致；
 * 有这层以后每一帧的纸面都有可辨认的细节，镜头一动就看得出"这是实物"。
 *
 * 全静态、无滤镜：所有线在挂载时算好，之后只跟着底纸漂移。
 * 随机量走 hash01（同 seed 永远同结果），逐帧渲染可复现。
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { hash01 } from "../paper";

type Rect = { x: number; y: number; w: number; h: number; r: number };

/** 街区：规整网格里随机跳过、随机伸缩，读起来才像城市而不是 Excel */
const blocks = (): Rect[] => {
  const out: Rect[] = [];
  let k = 0;
  for (let gy = 0; gy < 9; gy++) {
    for (let gx = 0; gx < 15; gx++) {
      k += 1;
      if (hash01(k * 3.13 + 5) < 0.5) continue;
      const x = gx * 132 + 10 + hash01(k * 1.71) * 12;
      const y = gy * 122 + 8 + hash01(k * 2.37) * 10;
      const long = hash01(k * 4.19) > 0.78;
      const w = (long ? 96 : 34) + hash01(k * 5.71) * (long ? 78 : 62);
      const h = (long ? 26 : 32) + hash01(k * 9.31) * 58;
      out.push({ x, y, w, h, r: 1 + hash01(k * 7.7) * 3 });
    }
  }
  return out;
};

/** 干道：几条横穿全幅的长弧线，双线走（偏移一条当对侧路沿） */
const ROADS = [
  "M -40 196 C 320 138, 560 330, 900 296 S 1520 128, 1960 238",
  "M -40 618 C 360 690, 620 548, 990 584 S 1540 754, 1960 676",
  "M 268 -40 C 306 292, 176 512, 342 764 S 258 1010, 266 1120",
  "M 1298 -40 C 1242 274, 1416 424, 1306 700 S 1382 986, 1392 1120",
  "M -40 936 C 480 892, 902 986, 1322 928 S 1762 856, 1960 900",
];

/** 河流：一条比干道更宽的实线 + 两侧岸线 */
const RIVER = "M -60 780 C 300 760, 430 640, 700 662 S 1120 800, 1430 726 S 1800 640, 1980 660";

/** 等高线：三组同心椭圆，虚线；给纸面一点"地形"的错觉 */
const CONTOURS = [
  { cx: 1512, cy: 196, rx: 150, ry: 96, n: 4, gap: 46 },
  { cx: 208, cy: 470, rx: 116, ry: 150, n: 3, gap: 52 },
  { cx: 1042, cy: 1000, rx: 210, ry: 84, n: 3, gap: 44 },
];

export const MapTexture: React.FC<{ night?: boolean; opacity?: number }> = ({
  night = false,
  opacity = 0.5,
}) => {
  const ink = night ? "#F6EFDD" : "#3A2E1C";
  const rects = blocks();

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%" }}
        aria-hidden
      >
        {/* 街区 */}
        {/* 整张地图斜一点：城市街区本身就不是正对镜头的，轴对齐会读成表格 */}
        <g fill="none" stroke={ink} strokeWidth={1.5} opacity={0.36}
           transform="translate(960 540) rotate(-6.5) scale(1.16) translate(-960 -540)">
          {rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.r} />
          ))}
        </g>

        {/* 等高线 */}
        <g fill="none" stroke={ink} opacity={0.3}
           transform="translate(960 540) rotate(-6.5) scale(1.16) translate(-960 -540)">
          {CONTOURS.map((c, gi) =>
            Array.from({ length: c.n }, (_, i) => (
              <ellipse
                key={`${gi}-${i}`}
                cx={c.cx}
                cy={c.cy}
                rx={c.rx + i * c.gap}
                ry={c.ry + i * c.gap * 0.62}
                strokeWidth={1.2}
                strokeDasharray="7 6"
              />
            )),
          )}
        </g>

        {/* 河流 */}
        <g fill="none" stroke={ink} opacity={0.46}
           transform="translate(960 540) rotate(-6.5) scale(1.16) translate(-960 -540)">
          <path d={RIVER} strokeWidth={13} strokeLinecap="round" />
          <path d={RIVER} strokeWidth={2.2} transform="translate(0 -9)" />
          <path d={RIVER} strokeWidth={2.2} transform="translate(0 9)" />
        </g>

        {/* 干道：双线 */}
        <g fill="none" stroke={ink} opacity={0.5}
           transform="translate(960 540) rotate(-6.5) scale(1.16) translate(-960 -540)">
          {ROADS.map((d, i) => (
            <g key={i}>
              <path d={d} strokeWidth={2.4} />
              <path d={d} strokeWidth={1.4} transform="translate(8 8)" opacity={0.7} />
            </g>
          ))}
        </g>

        {/* 比例尺 + 指北针：旧地图的"印刷物"信号，缩到很小只当肌理 */}
        <g stroke={ink} fill="none" opacity={0.5}>
          <path d="M 96 1006 H 276" strokeWidth={2} />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M ${96 + i * 60} 1000 V 1012`} strokeWidth={1.6} />
          ))}
          <circle cx={1810} cy={140} r={34} strokeWidth={1.6} />
          <path d="M 1810 112 L 1820 156 L 1810 148 L 1800 156 Z" strokeWidth={1.6} />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

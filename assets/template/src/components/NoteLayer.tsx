/**
 * 红笔批注层（visual.notes）。
 *
 * 一帧画面里如果只有"大字 + 底纹"，再好的排版也像一页幻灯片；
 * 让它变成"有人研究过的一页纸"的，是那些**手写上去的记号**：
 * 圈住关键数字、箭头指过去、量线标出宽度、橡皮章压一句结论。
 *
 * 所有笔画都是程序化手绘：路径带确定性抖动，进场用 12-14 帧"画"完，
 * 不是淡入。坐标用画幅百分比，尺寸用像素，见 `timeline.ts` 的 NoteSpec。
 */

import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { PAPER, PaperSheet, hash01, roughEdge, sway } from "../paper";
import type { NoteSpec } from "../timeline";
import { useBeatPresence } from "./BeatPresence";
import { ShapeMark } from "./CompareSplit";

/** 一段手画的线：把直线切成 8 段，每段在垂直方向抖 1-3px。 */
const roughLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amp = 3,
) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let d = `M ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const w = i === 8 ? 0 : (hash01(seed * 7.3 + i) - 0.5) * 2 * amp;
    d += ` L ${(x1 + dx * t + nx * w).toFixed(1)} ${(y1 + dy * t + ny * w).toFixed(1)}`;
  }
  return d;
};

/** 手画的椭圆：径向抖 2-4px，首尾闭合。 */
const roughEllipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  seed: number,
  amp = 4,
) => {
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const n = 48;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + ((hash01(seed * 11.7 + i) - 0.5) * 2 * amp) / Math.max(rx, ry);
    const x0 = Math.cos(a) * rx * j;
    const y0 = Math.sin(a) * ry * j;
    pts.push(`${(cx + x0 * cos - y0 * sin).toFixed(1)} ${(cy + x0 * sin + y0 * cos).toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
};

const colorOf = (n: NoteSpec) => (n.color === "ink" ? COLORS.ink : COLORS.accent);

export const NoteLayer: React.FC<{ notes: NoteSpec[] }> = ({ notes }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const { presence } = useBeatPresence();

  const px = (n: NoteSpec) => ({
    x: (n.x / 100) * width,
    y: (n.y / 100) * height,
  });

  // 出现时间：默认 0.6s，多个批注自动错开 0.18s，避免同时"啪啪"弹出
  const progress = (n: NoteSpec, i: number) => {
    const start = (n.at ?? 0.6 + i * 0.18) * fps;
    return Math.min(1, Math.max(0, (frame - start) / 14));
  };

  const drawProps = (p: number) => ({
    pathLength: 1,
    strokeDasharray: 1,
    strokeDashoffset: 1 - Easing.out(Easing.cubic)(p),
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: presence }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {notes.map((n, i) => {
          const p = progress(n, i);
          const { x, y } = px(n);
          const drift = sway(frame, 91 + i * 7, 2.4, 150);
          const stroke = colorOf(n);
          const common = {
            stroke,
            strokeWidth: 6,
            opacity: 0.92,
            transform: `translate(${drift.x.toFixed(2)} ${drift.y.toFixed(2)})`,
          };
          const seed = i * 13 + 5;

          if (n.kind === "circle") {
            const rx = (n.w ?? 520) / 2;
            const ry = (n.h ?? 380) / 2;
            const d1 = roughEllipse(x, y, rx, ry, n.rot ?? -3, seed);
            const d2 = roughEllipse(x + 5, y - 4, rx * 0.985, ry * 0.985, (n.rot ?? -3) + 1.8, seed + 1);
            return (
              <g key={i}>
                <path d={d1} {...common} {...drawProps(p)} />
                <path d={d2} {...common} strokeWidth={3.4} opacity={0.45} {...drawProps(Math.max(0, (p - 0.18) / 0.82))} />
              </g>
            );
          }

          if (n.kind === "arrow") {
            const ex = x + (n.w ?? 170);
            const ey = y + (n.h ?? -130);
            const ang = Math.atan2(ey - y, ex - x);
            const head = (dir: 1 | -1) =>
              roughLine(
                ex,
                ey,
                ex - 40 * Math.cos(ang + dir * 0.42),
                ey - 40 * Math.sin(ang + dir * 0.42),
                seed + dir * 3,
                1.2,
              );
            const hp = Math.max(0, (p - 0.62) / 0.38);
            return (
              <g key={i}>
                <path d={roughLine(x, y, ex, ey, seed, 3.2)} {...common} {...drawProps(p)} />
                <path d={head(1)} {...common} strokeWidth={5.5} {...drawProps(hp)} />
                <path d={head(-1)} {...common} strokeWidth={5.5} {...drawProps(hp)} />
              </g>
            );
          }

          if (n.kind === "measure") {
            const ex = x + (n.w ?? 460);
            const ey = y + (n.h ?? 0);
            const dx = ex - x;
            const dy = ey - y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const tick = (tx: number, ty: number, s: number) =>
              roughLine(tx - nx * 15, ty - ny * 15, tx + nx * 15, ty + ny * 15, s, 1.2);
            const tp = Math.max(0, (p - 0.7) / 0.3);
            return (
              <g key={i}>
                <path d={roughLine(x, y, ex, ey, seed, 2.4)} {...common} {...drawProps(p)} />
                <path d={tick(x, y, seed + 1)} {...common} strokeWidth={5} {...drawProps(tp)} />
                <path d={tick(ex, ey, seed + 2)} {...common} strokeWidth={5} {...drawProps(tp)} />
              </g>
            );
          }

          return null;
        })}
      </svg>

      {notes.map((n, i) => {
        if (n.kind !== "tag" && n.kind !== "stamp" && n.kind !== "measure" && n.kind !== "shape") {
          return null;
        }
        const p = progress(n, i);
        const rot = n.rot ?? (n.kind === "stamp" ? -7 : -2.4);
        const drift = sway(frame, 121 + i * 5, 2, 170);

        if (n.kind === "shape") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${n.x}%`,
                top: `${n.y}%`,
                transform: `translate(-50%, -50%) translate(${drift.x}px, ${drift.y}px)`,
              }}
            >
              <ShapeMark
                kind={n.shape ?? "reuleaux"}
                accent={COLORS.accent}
                p={p}
                rotate={rot}
                size={n.w ?? 340}
              />
            </div>
          );
        }

        // 量线没有标签就到此为止——否则会掉进下面的 tag 分支，
        // 在现场多出一张空白小纸片（实测）。
        if (n.kind === "measure" && !n.text) {
          return null;
        }

        if (n.kind === "measure" && n.text) {
          // 标签落在量线中点上方：x 用百分比，y 用像素偏移
          const midX = n.x + (((n.w ?? 460) / width) * 100) / 2;
          const midY = n.y + (((n.h ?? 0) / height) * 100) / 2;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${midX}%`,
                top: `${midY}%`,
                transform: `translate(-50%, -50%) translateY(-34px)`,
                opacity: p,
              }}
            >
              <div
                style={{
                  background: PAPER.sheet,
                  clipPath: roughEdge(seedFor(i), 2, 7),
                  padding: "7px 16px",
                  fontFamily: FONT_BODY,
                  fontWeight: 700,
                  fontSize: 27,
                  letterSpacing: 2,
                  color: colorOf(n),
                  whiteSpace: "nowrap",
                  boxShadow: "0 6px 14px rgba(46,34,18,0.16)",
                }}
              >
                {n.text}
              </div>
            </div>
          );
        }

        if (n.kind === "stamp") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${n.x}%`,
                top: `${n.y}%`,
                transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${1.5 - 0.5 * p}) translate(${drift.x}px, ${drift.y}px)`,
                opacity: p * 0.92,
              }}
            >
              <div
                style={{
                  border: `6px solid ${COLORS.accent}`,
                  padding: "8px 24px",
                  clipPath: roughEdge(seedFor(i), 3, 6),
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 900,
                    fontSize: 56,
                    letterSpacing: 6,
                    color: COLORS.accent,
                    whiteSpace: "nowrap",
                  }}
                >
                  {n.text}
                </span>
              </div>
            </div>
          );
        }

        // tag：一张小纸片，左边压一条红记号
        const pop = spring({ frame: frame - (n.at ?? 0.6 + i * 0.18) * fps, fps, config: { damping: 12, stiffness: 150 } });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${n.x}%`,
              top: `${n.y}%`,
              transform: `translate(-50%, -50%) translateY(${(1 - pop) * 16}px) translate(${drift.x}px, ${drift.y}px)`,
              opacity: Math.min(1, pop),
            }}
          >
            <PaperSheet
              seed={seedFor(i)}
              rotate={rot}
              rough={3}
              radius={0}
              style={{ transform: `rotate(${rot}deg)` }}
              contentStyle={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px" }}
            >
              <div style={{ width: 9, height: 32, background: COLORS.accent, transform: "rotate(-3deg)" }} />
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontWeight: 900,
                  fontSize: 31,
                  letterSpacing: 2,
                  color: COLORS.ink,
                  whiteSpace: "nowrap",
                }}
              >
                {n.text}
              </div>
            </PaperSheet>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const seedFor = (i: number) => i * 17 + 23;

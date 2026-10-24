/**
 * 图表。解释类视频的硬需求：讲"对比"和"趋势"时，大字说不清楚。
 *
 * 三种形态共用一份数据：
 *   bar    —— 分类对比（几个量级谁大谁小）
 *   line   —— 随时间变化（趋势、拐点）
 *   donut  —— 构成占比
 *
 * 柱子/折线的节点跟着旁白依次点亮，所以"念到哪个，哪个就长出来"。
 * 强调项用 accent 色 + 更高的柱子，其余压低对比度——观众的眼睛自然落在对的地方。
 */

import React from "react";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";

export type ChartDatum = {
  label: string;
  value: number;
  /** 可选：显示用的文字。不给就用 value（自动加千分位） */
  display?: string;
};

const fmt = (n: number) => {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
};

export const Chart: React.FC<{ beat: Beat; visual: VisualSpec; accent: string; tone?: "paper" | "night" }> = ({
  beat,
  visual,
  accent,
  tone = "paper",
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, width, height } = useStage();

  // 图表必须跟着这一拍的明暗走。第 0 拍是深色底，用纸色系（深墨+浅描边）
  // 去画柱子会得到"只有轮廓、没有填充"的结果——这是深色底专属的坑。
  const night = tone === "night";
  const ink = night ? COLORS.nightInk : COLORS.ink;
  const inkSoft = night ? `${COLORS.nightInk}AA` : COLORS.inkSoft;
  const rule = night ? `${COLORS.nightInk}55` : COLORS.rule;
  const surface = night ? `${COLORS.nightInk}12` : "#FFFFFFCC";

  const data = (visual.data ?? []) as ChartDatum[];
  const type = visual.chartType ?? "bar";
  if (!data.length) return null;

  // 每个数据项在旁白念到它的那一刻出现
  const timings = resolveWordTimings(
    data.map((d) => d.display ?? String(d.value)),
    beat.words,
    beat.durationInFrames,
  );
  const p = (i: number) => after(timings[i]?.t ?? 0, 18);

  const max = Math.max(...data.map((d) => d.value), 1);
  const plotH = Math.round(height * 0.44);

  const emphasis = visual.emphasis;
  const isHot = (d: ChartDatum) => {
    if (!emphasis?.length) return false;
    const txt = d.display ?? String(d.value);
    return emphasis.some((e) => e.includes(txt) || txt.includes(e));
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 40,
        padding: `150px ${pad}px 170px`,
        opacity: presence,
      }}
    >
      {visual.label ? (
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            fontSize: 52,
            color: ink,
            textAlign: "center",
            opacity: presence,
          }}
        >
          {visual.label}
        </div>
      ) : null}

      {type === "bar" ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: Math.round(width * 0.03),
            height: plotH,
          }}
        >
          {data.map((d, i) => {
            const pr = p(i);
            const hot = isHot(d);
            return (
              <div
                key={`${d.label}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 14,
                  flex: 1,
                  maxWidth: 260,
                  height: "100%",
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_NUMERAL,
                    fontSize: 38,
                    color: hot ? accent : inkSoft,
                    opacity: pr,
                  }}
                >
                  {d.display ?? fmt(d.value)}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: `${(d.value / max) * 100 * pr}%`,
                    minHeight: 4,
                    background: hot ? accent : ink,
                    opacity: hot ? 1 : 0.26,
                    borderRadius: "10px 10px 0 0",
                    border: `3px solid ${hot ? accent : rule}`,
                    borderBottom: "none",
                  }}
                />
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: 32,
                    color: hot ? ink : inkSoft,
                    textAlign: "center",
                    opacity: pr,
                    lineHeight: 1.3,
                  }}
                >
                  {d.label}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {type === "line" ? (
        <LineChart data={data} p={p} accent={accent} height={plotH} emphasis={emphasis} ink={ink} inkSoft={inkSoft} rule={rule} />
      ) : null}

      {type === "donut" ? (
        <Donut data={data} p={p} accent={accent} size={plotH} emphasis={emphasis} ink={ink} inkSoft={inkSoft} rule={rule} surface={surface} />
      ) : null}
    </div>
  );
};

const LineChart: React.FC<{
  data: ChartDatum[];
  p: (i: number) => number;
  accent: string;
  height: number;
  emphasis?: string[];
  ink: string;
  inkSoft: string;
  rule: string;
}> = ({ data, p, accent, height, emphasis, ink, inkSoft, rule }) => {
  const { pad, width } = useStage();
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = Math.max(1, max - min);
  const W = width - pad * 2;
  const H = height;

  const x = (i: number) => (i / Math.max(1, data.length - 1)) * (W - 80) + 40;
  const y = (v: number) => H - 60 - ((v - min) / span) * (H - 120);

  // 折线按"已点亮的点数"逐段画出来
  const drawn = data.reduce((m, _, i) => Math.max(m, p(i)), 0);
  const activeCount = Math.round(drawn * (data.length - 1));
  const segs: string[] = [];
  for (let i = 0; i <= activeCount && i < data.length; i++) {
    segs.push(`${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(data[i].value).toFixed(1)}`);
  }

  return (
    <div style={{ position: "relative", height: H }}>
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <line x1={40} y1={H - 60} x2={W - 40} y2={H - 60} stroke={rule} strokeWidth={3} />
        {segs.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={accent}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {data.map((d, i) => {
          const pr = p(i);
          const hot = emphasis?.some((e) => d.label.includes(e) || e.includes(d.label));
          return (
            <g key={`${d.label}-${i}`} opacity={pr}>
              <circle cx={x(i)} cy={y(d.value)} r={hot ? 16 : 11} fill={hot ? accent : ink} />
              <text
                x={x(i)}
                y={y(d.value) - 28}
                textAnchor="middle"
                fontFamily={FONT_NUMERAL}
                fontSize={30}
                fill={hot ? accent : inkSoft}
              >
                {d.display ?? fmt(d.value)}
              </text>
              <text
                x={x(i)}
                y={H - 20}
                textAnchor="middle"
                fontFamily={FONT_BODY}
                fontSize={30}
                fill={ink}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const Donut: React.FC<{
  data: ChartDatum[];
  p: (i: number) => number;
  accent: string;
  size: number;
  emphasis?: string[];
  ink: string;
  inkSoft: string;
  rule: string;
  surface?: string;
}> = ({ data, p, accent, size, emphasis, ink, inkSoft, rule }) => {
  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0) || 1;
  const R = size / 2;
  const r = R * 0.58;
  const C = 2 * Math.PI * r;

  // 调色板要把 accent 放在第一位，但**必须跳过与 accent 重复的颜色**——
  // 否则某一拍的 accent 正好是 blue 时，palette[0] 和 palette[1] 会撞成同一个色，
  // 饼图上相邻两段分不出来。
  const base = [COLORS.blue, COLORS.gold, COLORS.teal, COLORS.magenta, COLORS.accent];
  const palette = [accent, ...base.filter((c) => c !== accent)];
  const colorAt = (i: number) => palette[i % palette.length];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 60 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={R} cy={R} r={r} fill="none" stroke={rule} strokeWidth={R * 0.3} />
          {data.map((d, i) => {
            const frac = Math.max(0, d.value) / total;
            const pr = p(i);
            const hot = emphasis?.some((e) => d.label.includes(e) || e.includes(d.label));
            return (
              <circle
                key={`${d.label}-${i}`}
                cx={R}
                cy={R}
                r={r}
                fill="none"
                stroke={hot ? accent : colorAt(i)}
                strokeWidth={R * (hot ? 0.36 : 0.28)}
                strokeDasharray={`${C * frac * pr} ${C}`}
                strokeDashoffset={0}
                opacity={pr}
              />
            );
          })}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontFamily: FONT_NUMERAL, fontSize: 58, color: ink }}>
            {fmt(total)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {data.map((d, i) => {
          const pr = p(i);
          const hot = emphasis?.some((e) => d.label.includes(e) || e.includes(d.label));
          return (
            <div key={`${d.label}-${i}`} style={{ display: "flex", alignItems: "center", gap: 16, opacity: pr }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: hot ? accent : colorAt(i),
                }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 34, color: ink, minWidth: 180 }}>
                {d.label}
              </div>
              <div style={{ fontFamily: FONT_NUMERAL, fontSize: 34, color: inkSoft }}>
                {Math.round((Math.max(0, d.value) / total) * 100)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
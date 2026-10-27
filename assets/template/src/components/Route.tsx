/**
 * 路线图 / 地理。历史题材绕不开的一拍——行军、迁移、势力范围。
 *
 * 坐标是画布百分比（0-100, 0-100），你只要有一张底图（`src`，放 public/img/），
 * 就能把点位对到图上。连线用 stroke-dashoffset 画出来，节点跟着旁白依次点亮。
 *
 * 没有底图时组件画一套抽象网格，此时点位坐标是你自己定的抽象位置。
 */

import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import {
  useBeatPresence,
  useBeatWords,
  useStage,
  resolveWordTimings,
} from "./BeatPresence";
import { LightSweep, floatAt } from "../effects";
import { PAPER, sway } from "../paper";

type Point = { x: number; y: number; label: string; detail?: string };

const toPts = (points: Point[] = []) => points.map((p) => `${p.x},${p.y}`).join(" ");

export const Route: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad, width, height } = useStage();
  const frame = useCurrentFrame();

  const points = (visual.points ?? []) as Point[];
  if (!points.length) return null;

  // 每个点位在旁白念到它的那一刻点亮
  const timings = resolveWordTimings(
    points.map((p) => p.label),
    beat.words,
    beat.durationInFrames,
  );
  const progressOf = (i: number) => after(timings[i]?.t ?? 0, 14);

  // 连线总长用节点数估算即可——只用于 dashoffset 的归一化
  const segCount = Math.max(1, points.length - 1);
  const segP = points.reduce((m, _, i) => Math.max(m, (Math.max(0, i - 1) + progressOf(i)) / segCount), 0);
  const dash = 1000;
  const drawn = interpolate(segP, [0, 1], [0, dash], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 铺满整幅：地图只占中间一块时，四周空纸会把运动摊平，整拍看起来是死的
  const w = width;
  const h = height;

  // 右侧贴了照片（imageLayout: "inset"）时，地图让出一半画幅——
  // 点位按比例压到左侧，否则标签会压到照片上。这不是缩小地图，是"这张地图
  // 只画在纸的左半边"。压缩后还要留 6% 左边界：纯乘系数会把最左边的
  // 点位（起点）推到画幅外，圆点被裁成半个。
  const inset = visual.imageLayout === "inset";
  const placed = points.map((p) => ({
    ...p,
    x: inset ? 6 + p.x * 0.4 : p.x,
  }));

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: presence,
      }}
    >
      <div style={{ position: "relative", width: w, height: h }}>
        {/* ---- 底图 ---- */}
        {visual.src ? (
          <Img
            src={staticFile(visual.src)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `linear-gradient(${COLORS.rule}88 1px, transparent 1px),
                                linear-gradient(90deg, ${COLORS.rule}88 1px, transparent 1px)`,
              backgroundSize: "96px 96px",
            }}
          />
        )}

        <LightSweep duration={Math.round(beat.durationInFrames * 0.8)} color={accent} />

        {/* ---- 连线 ---- */}
        {visual.connect !== false && points.length > 1 ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          >
            <polyline
              points={toPts(placed)}
              fill="none"
              stroke={accent}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={dash}
              strokeDashoffset={dash - drawn}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        {/* ---- 点位 ---- */}
        {placed.map((p, i) => {
          const pr = progressOf(i);
          const prev = i > 0 ? placed[i - 1] : null;
          // 标签默认放在点的右上方，挤了就翻到左下
          const flip = prev ? p.x - prev.x < -12 : false;

          // 每个点一圈向外扩散的雷达波。点位亮完之后整拍就靠它和标签浮动撑着，
          // 否则路线画完、节点点完，画面就彻底停住。
          const ping = ((frame + i * 24) % 84) / 84;

          return (
            <div
              key={`${p.label}-${i}`}
              style={{
                position: "absolute",
                left: `${p.x}%`,
                top: `${p.y}%`,
                transform: `translate(${sway(frame, i + 3).x}px, ${sway(frame, i + 3).y}px) translate(-50%, -50%) scale(${
                  0.4 + pr * 0.6
                }) translateY(${floatAt(frame, 8, 88, i)}px)`,
                opacity: pr,
                display: "flex",
                flexDirection: flip ? "row-reverse" : "row",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: flip ? undefined : -28,
                  top: -28,
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  background: accent,
                  border: `6px solid ${PAPER.sheet}`,
                  boxShadow: `0 0 0 3px ${accent}66, 0 14px 22px rgba(46,34,18,0.32)`,
                }}
              />

              {pr > 0.9 ? (
                <div
                  style={{
                    position: "absolute",
                    left: flip ? undefined : -28,
                    top: -28,
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    border: `3px solid ${accent}`,
                    transform: `scale(${1 + ping * 1.1})`,
                    opacity: 0.45 * (1 - ping),
                    pointerEvents: "none",
                  }}
                />
              ) : null}

              <div
                style={{
                  position: "absolute",
                  left: flip ? undefined : 44,
                  right: flip ? 44 : undefined,
                  top: -44,
                  width: 260,
                  textAlign: flip ? "right" : "left",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 900,
                    fontSize: 42,
                    color: COLORS.ink,
                    lineHeight: 1.2,
                  }}
                >
                  {p.label}
                </div>
                {p.detail ? (
                  <div
                    style={{
                      // 中文别走 numeral：Archivo 没有汉字，会掉到雅黑常规体，字重对不上
                      fontFamily: FONT_BODY,
                      fontWeight: 700,
                      fontSize: 36,
                      color: accent,
                      marginTop: 4,
                    }}
                  >
                    {p.detail}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* ---- 标题 ---- */}
        {visual.caption ? (
          <div
            style={{
              position: "absolute",
            // 放右上：左上角被章节进度（03 / 13）占着
            right: pad,
            top: 56,
            fontFamily: FONT_BODY,
            fontSize: 46,
            fontWeight: 700,
            letterSpacing: 1,
            textAlign: "right",
            color: COLORS.ink,
            borderRight: `10px solid ${accent}`,
            paddingRight: 20,
            lineHeight: 1.2,
            opacity: presence,
            }}
          >
            {visual.caption}
          </div>
        ) : null}
      </div>
    </div>
  );
};

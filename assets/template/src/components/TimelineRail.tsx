/**
 * 横向时间轴。里程碑跟着旁白一个个亮起，导轨随进度生长。
 *
 * 生长方式是从左往右的插值，所以导轨的末端**就是**旁白进度——观众看着
 * 线往前爬，同时听着旁白往前走，两者是同一条时间轴。
 *
 * 布局上节点严格落在导轨上，文字在节点的上方或下方交替（column-reverse
 * 翻转 flex 方向来换边），这样密集的年份不会互相压字。
 */

import React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { useBeatPresence, useBeatWords, useStage } from "./BeatPresence";
import { floatAt, LightSweep } from "../effects";
import { PAPER, PaperSheet, sway } from "../paper";

const INSET = 0.1; // 导轨两端各留 10%，给首尾节点的文字留出空间
const NODE = 24; // 节点直径

export const TimelineRail: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
  accent,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();
  const frame = useCurrentFrame();

  const items = visual.milestones ?? [];
  if (!items.length) return null;

  // 里程碑必须按年代顺序亮。旁白常常只报其中一个年份（"两年后的 1969 年"），
  // 交给词级匹配会让没被念到的年份按"未匹配"均匀铺到整拍末尾——1967 反而
  // 最后出现。这一拍是账本式回顾，时间顺序本身就是信息，所以固定按索引错开。
  const stagger = Math.round(
    Math.min(90, beat.durationInFrames * 0.35) / Math.max(1, items.length - 1),
  );
  const timings = items.map((m, i) => ({ t: i * stagger, d: 12, text: m.year }));

  // 导轨画到多远？把节点编号换算成"第几格"：节点 i 的位置是 i/(n-1) 格，
// 导轨头从节点 i-1 走到节点 i，所以格数 = (i-1) + p，最后除以 (n-1)。
//
// 这里踩过两个坑：
//   - 直接用各节点进度的最大值 → 第一个节点一出现就是 1，导轨立刻画满；
//   - 用 (i+p)/(n-1) → 最后一个节点 p=1 时算出 n/(n-1) > 1，导轨冲出画幅。
// 未亮起的节点必须跳过，否则最后一个节点的 (i+0)/(n-1) 也恒等于 1。
const POP_SPAN = 14;
const progressOf = (i: number) => after(timings[i]?.t ?? 0, POP_SPAN);
const lastIdx = Math.max(1, items.length - 1);
const railP = Math.min(
  1,
  items.reduce((m, _, i) => {
    const p = progressOf(i);
    if (p <= 0) return m;
    return Math.max(m, Math.max(0, i - 1 + p));
  }, 0) / lastIdx,
);
  const at = (i: number) => INSET * 100 + (i / Math.max(1, items.length - 1)) * (1 - INSET * 2) * 100;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        // 底部留出字幕高度，否则下半排年份会被字幕框压住；顶部让出报头
        padding: `150px ${pad}px 250px`,
        opacity: presence,
      }}
    >
      {/* 高度按"画面要被时间轴占满"来定：560 时上下各空 260px，读起来像浮在中间的一条小线 */}
      <div style={{ position: "relative", width: "100%", height: 680 }}>
        {/* 一道窗光扫过整条轴。时间轴是纵向信息很薄的一拍，所有里程碑亮完之后
            就只剩一个小光点在跑；整幅的光要一直在动，画面才不会"停" */}
        <LightSweep duration={Math.round(beat.durationInFrames * 1.15)} color="#FFF6E2" width={60} />
        {/* 导轨：底轨 + 已走过的部分 */}
        <div
          style={{
            position: "absolute",
            left: `${INSET * 100}%`,
            right: `${INSET * 100}%`,
            top: "50%",
            height: 22,
            marginTop: -11,
            background: PAPER.sheetWarm,
            borderRadius: 3,
            boxShadow: `0 3px 0 ${PAPER.edge}, 0 10px 16px ${PAPER.shade}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${INSET * 100}%`,
            width: `${(1 - INSET * 2) * 100 * railP}%`,
            top: "50%",
            height: 22,
            marginTop: -11,
            background: accent,
            borderRadius: 3,
            boxShadow: `0 3px 0 ${PAPER.edge}, 0 10px 16px ${PAPER.shade}`,
          }}
        />

        {/* 巡游光点：沿已画出的轨道循环走。
            没有它，最后一个节点亮起后整拍就彻底静止——而旁白往往还要说两句。 */}
        {railP > 0.02 ? (
          <div
            style={{
              position: "absolute",
              left: `${INSET * 100 + (1 - INSET * 2) * 100 * railP * ((frame % 84) / 84)}%`,
              top: "50%",
              width: 22,
              height: 22,
              marginTop: -11,
              marginLeft: -11,
              borderRadius: 11,
              background: accent,
              boxShadow: `0 0 26px 8px ${accent}66`,
            }}
          />
        ) : null}

        {items.map((m, i) => {
          const p = progressOf(i);
          const above = i % 2 === 0;
          // 年份滚动到位：从比目标小 80 的位置冲上来。六个节点各滚一次，
          // 是这一拍里唯一"会变"的大字（纯 pop-in 只在头几帧有变化）
          const yearNum = Number(m.year);
          const yearText =
            Number.isFinite(yearNum) && p > 0 && p < 1
              ? String(Math.round(yearNum - 80 * (1 - (1 - Math.pow(1 - p, 2)))))
              : m.year;
          const label = (
            // 里程碑做成一张小纸片，而不是直接浮在背景上：
            // 纸片有边、有影、会跟着定格呼吸，画面才不是"一行字挂在空纸上"
            <PaperSheet
              seed={i + 20}
              frame={frame}
              color={PAPER.sheet}
              tiltAmp={0.5}
              style={{ marginBottom: above ? 26 : 0, marginTop: above ? 0 : 26 }}
              contentStyle={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                width: 360,
                padding: "18px 20px",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_NUMERAL,
                  fontSize: 76,
                  lineHeight: 1,
                  color: accent,
                  letterSpacing: -1,
                }}
              >
                {yearText}
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 900,
                  fontSize: 36,
                  color: COLORS.ink,
                  textAlign: "center",
                  lineHeight: 1.25,
                }}
              >
                {m.label}
              </div>
              {m.detail ? (
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: 32,
                    color: COLORS.inkSoft,
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}
                >
                  {m.detail}
                </div>
              ) : null}
            </PaperSheet>
          );

          const dot = (
            <div
              style={{
                width: NODE,
                height: NODE,
                borderRadius: NODE / 2,
                background: accent,
                border: `6px solid ${PAPER.sheet}`,
                boxShadow: `0 0 0 3px ${accent}66, 0 12px 20px rgba(46,34,18,0.28)`,
                transform: `scale(${0.3 + p * 0.7})`,
              }}
            />
          );

          return (
            <div
              key={`${m.year}-${i}`}
              style={{
                position: "absolute",
                left: `${at(i)}%`,
                // column / column-reverse 决定文字在节点上方还是下方
                display: "flex",
                flexDirection: above ? "column" : "column-reverse",
                alignItems: "center",
                // 入场位移 + 常驻浮动：错开相位，几个年份不会同步上下
                ...(above
                  ? {
                      bottom: "50%",
                      transform: `translateX(-50%) translate(${sway(frame, i + 11).x}px, ${
                        sway(frame, i + 11).y
                      }px) translateY(${(1 - p) * 30 + floatAt(frame, 7, 92, i)}px)`,
                    }
                  : {
                      top: "50%",
                      transform: `translateX(-50%) translate(${sway(frame, i + 11).x}px, ${
                        sway(frame, i + 11).y
                      }px) translateY(${-(1 - p) * 30 + floatAt(frame, 7, 98, i)}px)`,
                    }),
                opacity: p,
              }}
            >
              {label}
              {dot}
            </div>
          );
        })}
      </div>
    </div>
  );
};

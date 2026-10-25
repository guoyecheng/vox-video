/**
 * 机械翻滚数字（odometer）。StatCard 的仪表盘变体。
 *
 * 和 StatCard 的分工：StatCard 是**平滑计数**（0 → 47 冲到位然后稳住），
 * 读作"这个数有多大"；odometer 是**逐位翻滚**（像老式计价器），
 * 读作"这个数在跳"。用在逐年增长、计数累加这类场景更有张力。
 *
 * 每一位是一个独立格子，列位置固定，只有在变的那几列在跳。
 *
 * 说明：这是**步进**计数，不是连续滚动。34 帧数到几百万，逐位连续滚动
 * 只会糊成一团；真正有辨识度的是"格子 + 固定列位"的机械感，
 * 所以这里保证列不跳、字不裁、数字稳得住。
 */

import React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY, FONT_NUMERAL } from "../fonts";
import type { Beat, VisualSpec } from "../timeline";
import { PAPER, PaperSheet, Tape, sway } from "../paper";
import { useBeatPresence, useBeatWords, useStage, resolveWordTimings } from "./BeatPresence";

const DIGITS = "0123456789";

/** 数位格子尺寸。行高必须等于格高，否则字会被 overflow 裁成半截。 */
const CELL_W = 108;
const CELL_H = 150;
const DIGIT_FONT = 112;

export const Odometer: React.FC<{ beat: Beat; visual: VisualSpec; accent: string }> = ({
  beat,
  visual,
}) => {
  const { presence } = useBeatPresence();
  const { after } = useBeatWords(beat.words);
  const { pad } = useStage();
  const frame = useCurrentFrame();

  const target = Math.max(0, Math.round(visual.value ?? 0));
  const label = visual.label ?? "";
  const unit = visual.unit ?? "";

  const probe = resolveWordTimings([String(target)], beat.words, beat.durationInFrames)[0];
  const at = probe?.t ?? 0;
  const countP = after(at, 34);

  const shown = target * Math.min(1, countP);

  /**
   * 列宽必须固定。
   *
   * 早先版本直接 `Math.floor(shown).toLocaleString()`，计数过程中位数会变
   * （"2,000" → "200,000"），整排数字跟着往左挤，像镜头在推。
   * 真实计价器不会这样——它每一位的位置永远不变，只是那一位在转。
   *
   * 做法：先用**最终值**的格式化串确定列数和分隔符位置，
   * 再把当前值补零到同样的位数，逐位填进去。
   */
  const finalStr = target.toLocaleString("en-US");
  const digitCount = finalStr.replace(/[^0-9]/g, "").length;
  const padded = Math.floor(shown).toString().padStart(digitCount, "0");

  const cells: { sep: string; digit: number }[] = [];
  let di = 0;
  for (const c of finalStr) {
    if (c === "," || c === ".") cells.push({ sep: c, digit: 0 });
    else cells.push({ sep: "", digit: Number(padded[di++] ?? 0) });
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 34,
        padding: `150px ${pad}px 170px`,
        opacity: presence,
      }}
    >
      {/* 一块墨色厚纸：不是仪表盘 UI，是从印厂样张上剪下来的一块黑版。
          墨块保持平直硬边 + 毛边裁剪，圆角和内阴影都属于屏幕控件，不用。 */}
      <div style={{ position: "relative", transform: `translate(${sway(frame, 61, 3).x}px, ${sway(frame, 61, 3).y}px)` }}>
        <PaperSheet
          seed={17}
          rotate={-0.7}
          radius={0}
          rough={3.2}
          color={COLORS.ink}
          frame={frame}
          driftAmp={1.4}
          contentStyle={{ padding: "54px 52px 46px" }}
        >
          <Tape
            seed={24}
            width={168}
            height={44}
            angle={-3.4}
            style={{ left: "50%", top: -22, marginLeft: -84 }}
          />
          {/* 红色记号条：左上角压一小段，读作"这一条被标过" */}
          <div
            style={{
              position: "absolute",
              left: 44,
              top: 30,
              width: 76,
              height: 9,
              background: COLORS.accent,
              transform: "rotate(-2.1deg)",
            }}
          />

          <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
            {cells.map((c, i) =>
              c.sep ? (
                // 分隔符不是数位：给它格高并靠底对齐，才不会掉出格子和数字错位
                <span
                  key={`sep-${i}`}
                  style={{
                    width: 44,
                    height: CELL_H,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    paddingBottom: 20,
                    fontFamily: FONT_NUMERAL,
                    fontSize: DIGIT_FONT,
                    lineHeight: 1,
                    color: PAPER.sheetWarm,
                    opacity: 0.55,
                  }}
                >
                  {c.sep}
                </span>
              ) : (
                <RollingDigit key={`d-${i}`} value={c.digit} />
              ),
            )}

            {unit ? (
              <span
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 54,
                  fontWeight: 700,
                  color: COLORS.gold,
                  marginLeft: 14,
                  paddingBottom: 30,
                }}
              >
                {unit}
              </span>
            ) : null}
          </div>
        </PaperSheet>
      </div>

      {label ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div style={{ width: 68, height: 8, background: COLORS.accent, transform: "rotate(-1.6deg)" }} />
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 44,
              fontWeight: 700,
              color: COLORS.inkSoft,
              letterSpacing: 2,
            }}
          >
            {label}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * 单个数位：一张竖排的 0-9，按进度滚到目标数字。
 *
 * 行高固定 = 格高，整条 strip 用 translateY(-值 × 格高) 位移。
 * 末尾补一整圈 0-9，滚过 9 回到 0 时不会露出空白。
 */
const RollingDigit: React.FC<{ value: number }> = ({ value }) => {
  const rows = DIGITS.split("").map(Number);

  return (
    <div
      style={{
        width: CELL_W,
        height: CELL_H,
        overflow: "hidden",
        position: "relative",
        // 数位窗：只在左右压一道极淡的墨线，读作"印版上的格位"，
        // 不用深色格子——深色小方块是仪表盘 UI 的语言。
        borderLeft: `1px solid rgba(248,241,224,0.16)`,
        borderRight: `1px solid rgba(248,241,224,0.16)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          // 末尾补一整圈，滚到 9→0 时不会看到空白
          transform: `translateY(${-value * CELL_H}px)`,
        }}
      >
        {rows.map((d, i) => (
          <div
            key={i}
            style={{
              height: CELL_H,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT_NUMERAL,
              fontSize: DIGIT_FONT,
              lineHeight: 1,
              color: COLORS.paper,
            }}
          >
            {d}
          </div>
        ))}
        {rows.map((d, i) => (
          <div
            key={`wrap-${i}`}
            style={{
              height: CELL_H,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT_NUMERAL,
              fontSize: DIGIT_FONT,
              lineHeight: 1,
              color: COLORS.paper,
            }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
};

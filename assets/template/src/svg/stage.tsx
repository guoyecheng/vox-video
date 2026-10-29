/**
 * 内容层的画布：一面和底纸同大的 `<svg>`。
 *
 * 为什么不是"整块背景转 SVG"：`PaperStage` 的纹理层和特效层（碎片、抠图、
 * 纸屑、柔光）都是 DOM 或独立 SVG 组件，整块转过去等于把特效层一起重写，
 * 和"换运动语言"不是同一件事。这里只接管**每一镜的内容层**。
 *
 * 坐标要特别小心：`PaperStage` 的内容区是 `inset: -STAGE_INFLATE`（比画幅
 * 大一圈），组件里的 `pad` / `maxWidth` 都是相对这个放大后的盒子算的。
 * 所以这张 svg 用 `inset: 0` 铺满同一个盒子、`viewBox` 也用放大后的尺寸——
 * 1 用户单位 = 1px，且现有内容的位置一个像素都不用挪。
 * 如果按画幅尺寸再补 14px 偏移，整层内容会集体右下移 14px。
 */

import React from "react";
import { useVideoConfig } from "remotion";
import { STAGE_INFLATE } from "../paper";

export type StageBox = { x: number; y: number; w: number; h: number };

/** 内容层的坐标系尺寸。遮罩、转场都按这个盒子算，才能盖到画幅边缘。 */
export const useStageBox = (): StageBox => {
  const { width, height } = useVideoConfig();
  return { x: 0, y: 0, w: width + STAGE_INFLATE * 2, h: height + STAGE_INFLATE * 2 };
};

export const SvgStage: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const box = useStageBox();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={box.w}
      height={box.h}
      viewBox={`0 0 ${box.w} ${box.h}`}
      style={{ position: "absolute", inset: 0, overflow: "visible" }}
    >
      {children}
    </svg>
  );
};
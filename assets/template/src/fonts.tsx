/**
 * 字体。两套，各司其职：
 *  - display（思源黑体 900）：中文标题、要点。靠字重而不是靠花体造层级——
 *    站酷庆科黄油体那类展示体在 40-60px 时会糊成一团，中文笔画密度扛不住。
 *  - body（思源黑体 400/700）：正文、说明、字幕
 *  - numeral（Archivo Black）：数字、stat 计数
 *
 * 用**本地字体文件**（public/fonts），不用 @remotion/google-fonts：
 * 中文字体在 Google Fonts 上是按 unicode-range 切成 120 个分片的，只请求
 * `subsets: ["latin"]` 时拉丁字形正常、中文会**静默回落**到系统雅黑——日志里
 * 只有一句 "font loaded"，完全看不出问题，但屏幕上所有中文标题都变细黑体，
 * 整片立刻像 PPT。真要把中文分片全拉下来则是几千个请求，渲染前会卡很久。
 * 所以自带两份 ttf，离线、确定性、一次加载。
 */

import React, { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

export const FONT_BODY = `"Noto Sans SC Local", "Microsoft YaHei", "PingFang SC", sans-serif`;
export const FONT_DISPLAY = FONT_BODY;
export const FONT_NUMERAL = `"Archivo Black Local", Impact, "Microsoft YaHei", sans-serif`;

/** 数字/百分比用 numeral，中文用 display：Archivo 没有汉字，混排会掉字重 */
export const fontFor = (text: string) =>
  /^[0-9.,%+\-×x/\s]+$/.test(text) ? FONT_NUMERAL : FONT_DISPLAY;

const FACES = [
  {
    family: "Noto Sans SC Local",
    file: "fonts/NotoSansSC-VF.ttf",
    weight: "100 900",
    probe: ['400 40px "Noto Sans SC Local"', '900 40px "Noto Sans SC Local"'],
  },
  {
    family: "Archivo Black Local",
    file: "fonts/ArchivoBlack-Regular.ttf",
    weight: "400",
    probe: ['400 40px "Archivo Black Local"'],
  },
];

const PROBE_TEXT = "汉字Aa1368";

/**
 * 挂一次就够：注入 @font-face 并用 delayRender 挡住首帧，等字体真正解码完。
 * 不等的话首帧会掉字（Remotion 截图早于字体加载）。
 */
export const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender("loading local fonts"));

  useEffect(() => {
    const loads = FACES.flatMap((f) =>
      f.probe.map((probe) => document.fonts.load(probe, PROBE_TEXT).catch(() => [] as FontFace[])),
    );
    Promise.all(loads)
      .then(() => document.fonts.ready)
      .finally(() => continueRender(handle));
  }, [handle]);

  const css = FACES.map(
    (f) =>
      `@font-face{font-family:"${f.family}";src:url("${staticFile(f.file)}") format("truetype");font-weight:${f.weight};font-display:block;}`,
  ).join("");

  return (
    <>
      <style>{css}</style>
      {children}
    </>
  );
};

/** 兼容旧调用：字体已经由 FontGate 阻塞加载，这里只是等浏览器解码完。 */
export const waitForFonts = () => document.fonts.ready;

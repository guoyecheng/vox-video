/**
 * 配色：复古老报纸 / 档案地图纸（MG-VOXSTAGE）。
 *
 * 规范来自 assets 里的风格板，只有五支颜色：
 *   存档米棕 #C9B89C   底纸、纸片（深浅两档拉出层次）
 *   油墨纯黑 #1A1A1A   标题、正文、地图线
 *   半调网点灰 #8C8C8C 次要信息、网点
 *   醒目正红 #D62E1F   描边、下划线、箭头——**只做强调**，不做大面积底色
 *   芥末黄 #D9A441     次级强调，用量比红少一半
 *
 * 所以这里不再有蓝/青/品红这类"扁平 UI 色"。之前每拍轮一个高饱和色，
 * 五拍之后观众读到的是一套演示模板；现在整片只有红/黄两根记号笔，
 * 颜色越少，红色落下的地方越像"编辑圈出来的"。
 */

export const COLORS = {
  // 纸面：底纸比纸片深一档，纸片才是"叠"上去的
  paper: "#F6EFDD",
  stage: "#D3C2A4",
  stageDeep: "#BFA984",
  paperAlt: "#E7DAC1",
  ink: "#1A1A1A",
  inkSoft: "#574B3B",
  inkFaint: "#8C8C8C",
  rule: "#B3A084",

  // 强调（只允许这两支）
  accent: "#D62E1F",
  accentSoft: "#E4573F",
  gold: "#D9A441",
  /** 半调网点灰：需要第三支"强调色"时用它，保持印刷品的中性 */
  halftone: "#8C8C8C",

  // 深色场景（只有 quote 用）：暖墨黑，不是冷灰黑
  night: "#1C1915",
  nightInk: "#F6EFDD",
} as const;

/**
 * 强调色轮转：红为主、芥末黄做间隔、网点灰兜底。
 * 相邻拍仍然不同色，但整片不会跑出风格板的五色范围。
 */
export const ACCENT_CYCLE = [
  COLORS.accent,
  COLORS.gold,
  COLORS.accent,
  COLORS.halftone,
  COLORS.accent,
] as const;

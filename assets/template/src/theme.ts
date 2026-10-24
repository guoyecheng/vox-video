/**
 * VOX 风格的配色。
 *
 * 浅色纸面 + 高饱和强调色，是这套视觉能读起来"像解说片"的关键：
 * 大片留白让动态文字有地方站，暖橙承担"看这里"的注意力。
 */

export const COLORS = {
  // 纸面
  paper: "#F4F1EA",
  /** 拼贴的底纸。比 paper 深一档：纸片是亮白，底纸是旧牛皮/米色，
   *  两者反差太小时整幅会糊成一片米白（实测帧间差直接掉 15%）。 */
  stage: "#E9E2D2",
  paperAlt: "#EAE5DA",
  ink: "#14161A",
  inkSoft: "#4A5058",
  inkFaint: "#9AA0A8",
  rule: "#D5CFC2",

  // 强调
  accent: "#FF5B35",
  accentSoft: "#FF8A6B",
  gold: "#F2B705",
  teal: "#0E9C8A",
  blue: "#2B6CE8",
  magenta: "#C8367E",

  // 深色场景（hook / quote 用）
  night: "#12141A",
  nightInk: "#F4F1EA",
} as const;

/** 强调色轮转：相邻 beat 用不同颜色，避免整片一个色调 */
export const ACCENT_CYCLE = [
  COLORS.accent,
  COLORS.blue,
  COLORS.gold,
  COLORS.teal,
  COLORS.magenta,
] as const;
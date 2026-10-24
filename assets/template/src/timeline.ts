/**
 * timeline.json 的类型定义与加载。
 *
 * 这个文件由 scripts/vox_tts.py 生成，**不要手写**。
 * 它是"音频测量结果"落到帧上的唯一真相来源。
 */

import timelineJson from "./timeline.json";

export type WordTiming = {
  /** 该词起始帧，相对所属 beat 的开头 */
  t: number;
  /** 该词持续帧数 */
  d: number;
  text: string;
};

export type VisualKind =
  | "kinetic"
  | "stat"
  | "odometer"
  | "quote"
  | "highlight"
  | "compare"
  | "split"
  | "timeline"
  | "cards"
  | "stack"
  | "image"
  | "person"
  | "route"
  | "callout"
  | "chart";

/**
 * 运镜（轴一：整幅怎么动）。
 *
 * 跟 elementMotion（轴二：画面里什么在动）是两根独立的轴——
 * 只做运镜画面还是死的，只做元素运动镜头是死的。
 *
 * 幅度都刻意压得很小：排版已经吃掉画面 90% 的宽度，
 * 推近超过 4% 就会把末两个字切掉（实测过）。
 */
export type CameraMove =
  | "push_in"    // 缓慢推近（默认）
  | "pull_out"   // 缓慢拉远
  | "pan"        // 横移
  | "tilt"       // 纵移
  | "parallax"   // 带层差的横移
  | "whip"       // 快速甩镜（慎用，会切边缘）
  | "static";    // 不动（点题段用）

/** 程序化特效（叠在最上层） */
export type VfxKind = "none" | "confetti" | "starburst";

/** 碎片的入场动作 */
export type PieceIn =
  | "fly_left"   // 从左边甩进来（有过冲）
  | "fly_right"  // 从右边甩进来
  | "fly_up"     // 从上面飞下来
  | "drop"       // 落下 + 落地压扁回弹
  | "slap"       // 从大到小"啪"地贴上
  | "pop";       // 原地放大归位

/**
 * 碎片：底图上的一个矩形块（坐标相对整幅画面，0-1）。
 *
 * 拼贴海报切成几块，逐块飞入，最后拼回原图——不需要抠图模型。
 */
export type PieceSpec = {
  /** 左 / 上 / 宽 / 高，相对整幅画面 0-1 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 入场动作 */
  enter: PieceIn;
  /** 延迟帧 */
  at?: number;
  /** 深度 0-1：影响投影强度和叠放顺序 */
  depth?: number;
  /** 落位后的旋转角度（度） */
  spin?: number;
};

export type RoutePoint = { x: number; y: number; label: string; detail?: string };export type CalloutNote = {
  x: number;
  y: number;
  text: string;
  dx?: number;
  dy?: number;
  r?: number;
};
export type ChartDatum = { label: string; value: number; display?: string };
export type SplitPanel = {
  title: string;
  detail?: string;
  value?: string;
  src?: string;
};

export type StageLayer = {
  /** `img/xxx.png`（相对 public/） */
  src: string;
  /** 0 = 最远（几乎跟整幅一起走），1 = 最近（视差最大）。默认按数组顺序均分 */
  depth?: number;
  /** 这层内容在原图里占据底部的比例 0-1；省略 = 用满幅（天空/底色层） */
  band?: number;
  /** 这层在画面上的垂直位置（0-1，从上到下）。给了 band 时用它决定落在哪 */
  y?: number;
};

export type VisualSpec = {
  kind: VisualKind;
  /** kinetic：要上屏的词，必须与 narration 词序一致 */
  words?: string[];
  /** kinetic / chart：这些词用强调色处理 */
  emphasis?: string[];
  /** stat / odometer / chart */
  value?: number;
  unit?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  source?: string;
  /** quote / highlight */
  text?: string;
  attribution?: string;
  /** highlight：被荧光笔划过的词；circled：被圈住的词 */
  marks?: string[];
  circled?: string[];
  /** compare */
  left?: SideSpec;
  right?: SideSpec;
  vsLabel?: string;
  /** split */
  panels?: SplitPanel[];
  /** timeline */
  milestones?: { year: string; label: string; detail?: string }[];
  /** cards / stack */
  items?: { title: string; detail?: string; tag?: string }[];
  /** chart */
  chartType?: "bar" | "line" | "donut";
  data?: ChartDatum[];
  /** image / person / callout / route */
  src?: string;
  caption?: string;
  /** person */
  name?: string;
  role?: string;
  quote?: string;
  tag?: string;
  side?: "left" | "right";
  /** route */
  points?: RoutePoint[];
  connect?: boolean;
  /** callout */
  notes?: CalloutNote[];
  /** 所有 kind 通用 */
  align?: "left" | "center";
  /** 所有 kind 通用的配图层：`img/xxx.png`（相对 public/）。内容照常压在图上 */
  image?: string;
  /** 配图的纸浆覆盖强度 0-1，越小白图越清楚，默认浅色拍 0.42 / 深色拍 0.55 */
  imageWash?: number;
  /** 配图的放置：full（默认，整幅压在纸下）| inset（角贴照片，占右侧） */
  imageLayout?: "full" | "inset";
  /**
   * 分层背景板：远 → 近排。每层按 `depth`（0 远 / 1 近）走不同的视差。
   * 给了 layers 就忽略 `image`；`band` 是这层占据画面底部的比例（0-1），
   * 顶边会裁成毛边，形成"纸片一层层垫上去"的景深。
   */
  layers?: StageLayer[];
  /** 特效：这一拍入场时的镜头冲击 */
  impact?: "soft" | "medium" | "heavy";
  /** 特效：闪白 */
  flash?: boolean;
  /** 特效：光带扫过 */
  sweep?: boolean;
  /** 特效：常驻运动强度，默认 normal。文案密集或需要"定住"看的拍可调 soft */
  ambient?: "off" | "soft" | "normal" | "strong";
  /** 轴一：这一拍整幅怎么动，默认 push_in */
  camera?: CameraMove;
  /** 轴二：这一拍画面里什么在动（写给实现看的，也是反单调的检查项） */
  elementMotion?: string;
  /** 程序化特效：纸屑雨 / 冲击放射 */
  vfx?: VfxKind;
  /**
   * 碎片拼贴：底图（相对 public/）切成的几块，逐块飞入组装。
   * 底图会被挖洞，块飞进去正好填上，最后拼回原图。
   */
  pieceBase?: string;
  pieces?: PieceSpec[];
};

export type SideSpec = {
  title: string;
  value?: string;
  detail?: string;
  accent?: string;
};

export type Beat = {
  id: string;
  /** 在整片中的起始帧（音频时钟，实测值） */
  from: number;
  /** 音频实长 + padAfter，已取整到帧 */
  durationInFrames: number;
  /** 音频相对本拍的偏移帧（padBefore）；无声 beat 为 null */
  audioFrom: number | null;
  /** 进入这一拍的转场；第 0 拍为 none */
  transition: string;
  /** 该转场的交叠帧数，0 表示硬切 */
  transitionFrames: number;
  narration: string;
  words: WordTiming[];
  visual: VisualSpec;
};

export type Timeline = {
  title: string;
  voice: string;
  rate: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  /** 是否显示跟随旁白的字幕轨 */
  captions: boolean;
  /** 配乐床（没有音乐文件就不带这个字段） */
  music?: {
    /** public/ 下的路径，例如 "audio/bed.mp3" */
    src: string;
    /** 底音量 0-1 */
    gain?: number;
    /** 有人说话时压低多少 0-1 */
    duck?: number;
    fadeIn?: number;
    fadeOut?: number;
    ramp?: number;
  };
  beats: Beat[];
};

export const TIMELINE = timelineJson as unknown as Timeline;

export const BEATS: Beat[] = TIMELINE.beats;
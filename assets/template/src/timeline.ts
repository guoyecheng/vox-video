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
  | "chart"
  | "handwrite";

/**
 * 运镜（轴一：整幅怎么动）。
 *
 * 跟 motion（轴二：内容怎么进场）是两根独立的轴——
 * 只做运镜画面还是死的，只做内容运动镜头是死的。
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

/* ---------------- 3D 纸艺舞台（可选） ---------------- */

/** 3D 舞台只支持这四种运镜；其余 CameraMove 会回落到 push_in */
export type Stage3DCamera = "push_in" | "pull_out" | "pan" | "static";

export type Stage3DMarkSpec = {
  /** 纸片局部坐标，默认 0 / 0 */
  x?: number;
  y?: number;
  z?: number;
  w: number;
  h?: number;
  rot?: number;
  color?: string;
  /** 念到这个词开始从左端画出来；省略 = 常驻 */
  at?: string;
  drawDur?: number;
};

/**
 * 一张 3D 纸片。动画锚在旁白的词上——写词，不写帧。
 * 锚点命中词首后提前 2 帧起手。
 */
export type Stage3DPieceSpec = {
  /** 透明抠图（相对 public/） */
  src: string;
  /** 世界坐标中心；16:9 画幅约 7.2 × 4.05 */
  x: number;
  y: number;
  /** 世界单位宽度；高度按图片比例推出来 */
  w: number;
  z?: number;
  rot?: number;
  /** 程序投影强度（世界单位），默认 0 */
  shadow?: number;
  /** 常驻微漂移幅度（世界单位），默认 0.018 */
  drift?: number;
  /** 纸浆覆盖强度：把照片色调拉回纸艺色系 */
  wash?: number;
  /** 去色强度：让金属/照片变成"印在纸上的灰阶图" */
  gray?: number;
  /** 洞感 0-1：按纹理亮度把中间压成墨色，白边不动 */
  hole?: number;
  /**
   * alpha 裁切阈值，默认 0.35。素材把烘焙投影做进 alpha 时，普通混合会把
   * 那圈灰影画成实体；抬到 0.9 只留实体，投影交给程序阴影。
   */
  alphaCut?: number;
  /** 素材带白底 + 烘焙投影时用 multiply，白底乘回背景纸 */
  blend?: "normal" | "multiply";
  enter?: "drop" | "rise" | "pop";
  /** 念到这个词才入场；省略 = 拍开头 */
  at?: string;
  /** 整拍内累计旋转角度；配 spinAt 就是等词再转 */
  spin?: number;
  spinAt?: string;
  spinDur?: number;
  /** 念到这个词开始坠出画（方盖掉进洞里） */
  fall?: string;
  /** 下坠世界单位，默认 1.35 */
  fallDistance?: number;
  /** 画在这张纸上的笔迹，跟着纸片一起漂移和旋转 */
  marks?: Stage3DMarkSpec[];
};

export type Stage3DTapeSpec = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rot: number;
};

/**
 * 一拍的 3D 纸艺舞台。启用后这一拍不再渲染 2D `PaperStage` 和 `cutouts`，
 * 但 `kind` 组件、批注、字幕、特效层照常压在 3D 画面上。
 */
export type Stage3DSpec = {
  /** 省略时跟随 visual.camera */
  camera?: Stage3DCamera;
  /** 开场镜头顿挫（世界单位） */
  punch?: number;
  /** 背景纸暗度，1 = 原色 */
  backdrop?: number;
  /** 底部撕纸带（前景遮挡），默认关 */
  foreground?: boolean;
  /** 空气尘埃，默认开 */
  motes?: boolean;
  /** 手持微漂移强度，默认 1；点题段可以给 0 */
  sway?: number;
  /** 可选地图纹理（相对 public/），铺在底纸上做旧 */
  mapSrc?: string;
  pieces: Stage3DPieceSpec[];
  tapes?: Stage3DTapeSpec[];
};

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

/** 镜头间的转场。只支持硬切与交叠淡入淡出，默认 cut */
export type ShotTransition = "cut" | "crossfade";

/**
 * 一个镜头（beat 内的子段落）。时间单位是秒，相对本拍开头；运行时 ×fps 转帧。
 *
 * 镜头边界锚在词级时间戳上：旁白念到哪句，画面就切到哪个镜头。
 * 只有 kinetic 支持（v1），其余 kind 写 shots 会被 preflight 挡掉。
 */
export type ShotSpec = {
  /** 镜头起点（秒，相对拍开头）。省略 = 接上一镜结尾（首镜 = 0） */
  from?: number;
  /** 镜头终点（秒，相对拍开头）。省略 = 下一镜开头（末镜 = 拍尾） */
  to?: number;
  /** 本镜头单独上屏的词（kinetic）；省略 = 该窗口内的旁白从句 */
  words?: string[];
  /** 入场配方。省略 = 按全局 shot 序号轮换 */
  motion?: MotionRecipe;
  /** 版式变体。省略 = 继承拍级 layout */
  layout?: LayoutMode;
  /** 本镜头怎么进，默认 "cut" */
  transition?: ShotTransition;
};

/**
 * 入场配方（轴二：画面内容怎么进场）。
 *
 * 不写 `motion` 时按拍序自动轮换（见 BeatPresence.tsx 的 ORDER），
 * 相邻拍保证不同；要精确控制就显式指定。`flip` 不在轮换表里，
 * 想用必须手写——它最适合"翻到下一章"式的拍。
 */
export type MotionRecipe =
  | "stamp"   // 盖章：从 1.18 倍缩放压下来，spring 过冲归位，配 4 帧淡入
  | "wipe"    // 揭开：clip-path 从下往上卷开，全程不淡入
  | "rise"    // 升起：从下方 56px 升入，配 12 帧淡入
  | "flip"    // 翻页：绕 Y 轴 -16° 转正，不淡入（仅手动）
  | "build"   // 搭积木：整幅不进厂，元素按词卡点逐项出现
  | "drift";  // 漂入：从右往左平移归位，配 8 帧淡入

/**
 * 版式变体（同一组件换一种摆法）。
 *
 * 不写 `layout` 用组件默认（大多是居中卡片）。不做自动轮换：
 * full-bleed / bottom-third 需要 image，自动切版式会破坏构图。
 */
export type LayoutMode =
  | "center"        // 组件默认：居中卡片
  | "left-edge"     // 靠左缘排版，打破每页居中
  | "full-bleed"    // 图片铺满整幅，文字压在图上（需要 image）
  | "split"         // 左右分栏（stat / compare 类）
  | "bottom-third"; // 内容落在画面下三分之一，上方留给图

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

export type RoutePoint = { x: number; y: number; label: string; detail?: string };

/**
 * 手写拍的可调项。文字本身用 `visual.text`，用 `\n` 换行。
 *
 * 默认值按 1080p 的观看距离定：字号 150 是该拍的主视觉，速度 3.2 字/秒
 * 接近真人写字（2-5 字/秒）。拍短写不完时组件会自动加速，不会拖出拍尾。
 */
export type WriteSpec = {
  /** 字号 px，默认 150；放不下会自动缩，不会小于 64 */
  size?: number;
  /** 墨水色：ink 普通钢笔，red 红笔（和批注同一支） */
  color?: "ink" | "red";
  /** 写字速度，字/秒，默认 3.2 */
  speed?: number;
};

/* ---------------- 抠图元素（cutouts） ---------------- */

/** 抠图元素的入场动作。比 MotionRecipe 多一个 drop：纸片元素适合"落下来"。 */
export type CutoutEnter =
  | "pop"        // 原地放大归位
  | "drop"       // 从上方落下，落地压扁回弹
  | "rise"       // 从下方升入
  | "fly_left"   // 从左边甩进来
  | "fly_right"  // 从右边甩进来
  | "stamp";     // 从大到小"啪"地贴上

/**
 * 平底元素图（`img/xxx-cut.png`）的一份摆位。
 *
 * 和 pieces 的区别：pieces 是把**一张**合成图切块拼回去；cutouts 是
 * **分别生成**的独立元素，各自入场、各自运动——元素之间可以遮挡，
 * 也可以一个掉下去露出后面的另一个。
 *
 * 坐标是**中心点**（0-1），w 是宽度占画幅的比例；高度按图片比例自动。
 */
export type CutoutSpec = {
  /** `img/xxx-cut.png`（相对 public/） */
  src: string;
  /** 中心点，0-1 */
  x: number;
  y: number;
  /** 宽度占画幅比例 0-1 */
  w: number;
  /** 0 = 远（漂移小），1 = 近（漂移大）。默认 0.5 */
  depth?: number;
  /** 入场动作，默认 pop */
  enter?: CutoutEnter;
  /** 念到这个词才入场。省略 = 拍开头；旁白里找不到则回落到拍开头 */
  at?: string;
  /** 念到这个词开始坠落出画（方盖掉进洞里用这个） */
  fall?: string;
  /** 常态旋转角度（度） */
  rotate?: number;
  /** 入场时的额外旋转，默认按 enter 给一点 */
  spin?: number;
  /** 压在内文之上。默认 false：元素在内容层下面 */
  front?: boolean;
  /** 不透明度，默认 1 */
  opacity?: number;
  /**
   * 程序投影的模糊半径（px）。默认 20；素材自带烘焙阴影时写 0，
   * 否则会有两层影子。
   */
  shadow?: number;
  /**
   * 与背景的混合方式。素材自带浅色投影、压在浅色纸面上会发亮，
   * 用 "multiply" 让浅色融回纸面（深色部分基本不变）。默认 normal。
   */
  blend?: "normal" | "multiply";
  /**
   * 印刷化处理：去色 + 提高对比 + 红色偏移剪影 + multiply 融入纸面。
   * 写实渲染的素材在"档案纸拼贴"的风格里必须过这一道，否则一眼是贴图。
   * 默认 false（兼容旧项目；风格板规范的新项目应打开）。
   */
  print?: boolean;
};

export type CalloutNote = {
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

/* ---------------- 批注（notes） ---------------- */export type NoteKind = "arrow" | "circle" | "measure" | "tag" | "stamp" | "shape";

/**
 * 画在纸上的批注。不是装饰贴纸，是"编辑用红笔标过"的那一层：
 * 箭头指向论点、圈住数字、量线标出宽度、印章压一句结论。
 *
 * 坐标是**画幅百分比**（0-100）：x/y 是锚点（圈=圆心、箭头/量线=起点、
 * 标签/印章/图形=中心）。w/h 是像素：圈=直径、箭头/量线=位移、图形=边长。
 * 时间 `at` 是拍内秒数，到点后 12-14 帧"画"进去。
 */
export type NoteSpec = {
  kind: NoteKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  rot?: number;
  /** tag / stamp / measure 上的字。tag 建议 ≤ 6 字，stamp ≤ 4 字 */
  text?: string;
  /** kind=shape 时的形状 */
  shape?: "square" | "circle" | "triangle" | "reuleaux" | "hex";
  /** 拍内出现时间（秒），默认 0.6 */
  at?: number;
  /** 默认正红（记号色）；ink 用于不想抢戏的补充说明 */
  color?: "red" | "ink";
};

/** 纸片字的版式。auto = 按字数与种子自动挑（短词标签 / 中长便签 / 长句长条） */
export type TileVariant = "cut" | "note" | "clip" | "label" | "banner" | "red";

export type VisualSpec = {
  kind: VisualKind;
  /** kinetic：要上屏的词，必须与 narration 词序一致 */
  words?: string[];
  /** kinetic / chart：这些词用强调色处理 */
  emphasis?: string[];
  /** 强调词的纸片版式。默认 auto；写死某种只适合'全片唯一一句'的场合 */
  tile?: TileVariant | "auto";
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
  /** handwrite：字号 / 墨水色 / 写字速度 */
  write?: WriteSpec;
  /** 入场配方。不写按拍序自动轮换，见 MotionRecipe */
  motion?: MotionRecipe;
  /** 版式变体。不写用组件默认，见 LayoutMode */
  layout?: LayoutMode;
  /** beat 内镜头拆分（仅 kinetic），见 references/components.md */
  shots?: ShotSpec[];
  /** 程序化特效：纸屑雨 / 冲击放射 */
  vfx?: VfxKind;
  /**
   * 碎片拼贴：底图（相对 public/）切成的几块，逐块飞入组装。
   * 底图会被挖洞，块飞进去正好填上，最后拼回原图。
   */
  pieceBase?: string;
  pieces?: PieceSpec[];
  /**
   * 独立抠图元素：分别生成、分别入场，可以互相遮挡。
   * 与 `pieces`（一张底图切块）是两条路，同一拍不要混用。
   */
  cutouts?: CutoutSpec[];
  /** 红笔批注层。见 NoteSpec；画在内容之上、字幕之下。
   *  字段名避开 `notes`——callout 拍的 notes 是图上的圈注，语义不同。 */
  annotations?: NoteSpec[];
  /** 3D 纸艺舞台（可选）。给了它这一拍就用真 Z 轴，忽略 2D cutouts。 */
  stage3d?: Stage3DSpec;
};

export type SideSpec = {
  title: string;
  value?: string;
  detail?: string;
  accent?: string;
  /**
   * 栏内的图形符号（程序化，不用素材）。对比拍的两栏经常只有标题和一句说明，
   * 中间会空掉一大块纸——补一个"剪出来的形状"既填了版面，也直接是论点本身
   * （方盖 vs 圆盖、勒洛三角 vs 圆形）。
   */
  mark?: "square" | "circle" | "triangle" | "reuleaux" | "hex";
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
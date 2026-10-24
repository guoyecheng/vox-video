# 组件参考

15 个视觉组件 + 常驻字幕轨 + 特效层 + 转场。每个组件接收 `{beat, visual, accent, tone}`，
`beat` 里带词级时间戳，所以组件内部天然能把动画卡在旁白上。

## 目录
- [KineticText](#kinetictext) · [StatCard](#statcard) · [Odometer](#odometer)
- [Chart](#chart) · [Highlight](#highlight) · [Split](#split) · [Stack](#stack)
- [Person](#person) · [Route](#route) · [Callout](#callout) · [QuoteCard](#quotecard)
- [CompareSplit](#comparesplit) · [TimelineRail](#timelinerail) · [CardStack](#cardstack) · [ImageCard](#imagecard)
- [CaptionTrack](#captiontrack) — 常驻字幕轨，不由 `kind` 控制
- [背景与常驻件](#背景与常驻件) · [特效层](#特效层) · [运镜层](#运镜层camera) · [配乐床](#配乐床musictsx)
- [共用工具](#共用工具) · [加新组件](#加一个新组件四个文件缺一不可)

---

## KineticText

`kind: "kinetic"` —— 逐词弹出的大字。**别用超过 4 拍**，整片一个节奏就单调了。

```jsonc
{
  "kind": "kinetic",
  "words": ["二百七十六年", "没有一个死在敌人手里"],  // 每个元素独占一行
  "emphasis": ["没有一个死在敌人手里"],           // 这些用强调色并放大 16%
  "align": "center"                      // 或 "left"
}
```

**`words` 与 `narration` 的关系**（重要）

`words` 应当是 `narration` 里**原样出现的词序**，组件靠字符偏移把它们对到
TTS 的词级时间戳上。可以：

- 和旁白完全一致 —— 逐词卡点，最理想
- 比旁白短（只挑关键词上屏）—— 多出来的音节只是继续念，不影响对齐
- 比旁白长或词序不同 —— 会退化成"按旁白时长均匀铺开"，大致对齐但不精确

**数字会自动尝试中文读法**：`value: 3` 能在旁白写"三个"的地方对上，
`47` 对"四十七"（覆盖 1-9999）。年份（2009）不适用。

省略 `words` 时组件会按标点切分旁白当作词组，可以应急用，但不精确。

**字号是算出来的，不是写死的**：同时满足宽（`maxWidth / 最长词组`）和
高（`可用高度 / 总行高`）两个约束，夹在 56-104px。所以写一个 28 字的长句
也不会冲出画幅——会自动缩到合适大小。

## StatCard

`kind: "stat"` —— 巨大数字 + 计数动画 + 单位 + 出处。

```jsonc
{
  "kind": "stat",
  "value": 3,
  "unit": "个",
  "label": "2.4G 全部不重叠信道",
  "prefix": "约 ",        // 可选，数字左侧
  "suffix": "……",        // 可选，标签下方的补充说明
  "decimals": 0,
  "source": "IEEE 802.11" // 可选，左下角出处
}
```

计数起点：优先找旁白里念到这个数的时刻（数字/中文两种写法都试）；
旁白根本没提这个数时，按旁白时长前 22% 起滚。

**所以 stat 拍的旁白要把数字放在句子里靠前的位置。** 旁白说"…用了五年还没换"
而数字在句尾，滚动就只剩半秒，观众来不及看。示例脚本里写成
"五年，很多家庭的路由器就没换过了。"

数字用 `Archivo Black`，比中文字体渲染的数字更有印刷感。

## Person

`kind: "person"` —— 人物卡。历史/传记题材的主力。

```jsonc
{
  "kind": "person",
  "name": "朱元璋",
  "role": "明太祖 · 1328—1398",
  "quote": "驱逐胡儿，恢复中华",   // 可选，一句关键台词
  "tag": "开国",                   // 可选，肖像右下角的小角标
  "src": "img/zhu.jpg",            // 可选，肖像照片（放 public/img/）
  "side": "left"                   // 或 "right"，肖像在左还是在右
}
```

肖像入场带一记镜头冲击（`useImpact` 的 heavy）——人物出现在画面上应该有重量。
没给 `src` 时用姓氏字做圆形占位，抽象剪影也是能用的表现手法。

姓名、身份、台词依次揭示，都卡在旁白念到它们的时刻。

⚠️ `quote` 只写**真实存在**的台词或描述。拿不准就删掉——观众看到的是事实陈述，
没有任何"大概"的空间。

## Route

`kind: "route"` —— 地图/路线。行军、迁移、势力范围这类拍子绕不开。

```jsonc
{
  "kind": "route",
  "src": "img/map.png",            // 可选底图，不给就画抽象网格
  "caption": "朱元璋北伐路线",
  "connect": true,                 // 是否连线，默认 true
  "points": [
    { "x": 74, "y": 74, "label": "濠州", "detail": "起兵" },
    { "x": 58, "y": 52, "label": "应天", "detail": "定都" },
    { "x": 47, "y": 36, "label": "临安", "detail": "逐元" }
  ]
}
```

坐标是**画布百分比**（0-100, 0-100），底图用 `objectFit: contain`，
所以对坐标时按显示出来的实际画面算，别按原图像素算。

连线用 `stroke-dashoffset` 画出来，节点跟着旁白依次点亮；标签在点的右上、
挤到边界时自动翻到左下。位次靠后的会覆盖靠前的——想要更严谨的排布就把
点位错开更多。

## Callout

`kind: "callout"` —— 画面圈注。箭头 + 圈 + 标签，让静态图变成被讲解的图。

```jsonc
{
  "kind": "callout",
  "src": "img/xxx.jpg",            // 可选，不给就用斜纹占位板
  "caption": "典型的家用路由器",
  "notes": [
    { "x": 30, "y": 40, "text": "散热孔", "dx": 18, "dy": -14, "r": 7 }
  ]
}
```

- `x`/`y`：目标点的画布百分比
- `dx`/`dy`：标签相对目标点的偏移（百分比），默认右上方
- `r`：圈的大小（百分比）

圈是"画"上去的（半径从 1.6 倍收到 1 倍），箭头随进度延伸。

## QuoteCard

`kind: "quote"` —— 深色底的引述卡。**自动使用深色底**，与前后的纸面场景
形成明暗跳变，这是它告诉观众"这段是别人说的话"的信号。

```jsonc
{
  "kind": "quote",
  "text": "在一个住了两百户的公寓楼里，Wi-Fi 其实不是你的，是所有人的。",
  "attribution": "无线网络工程师，访谈"
}
```

`text` 省略时用 `narration`。字号随长度自适应（>40 字 60px / >22 字 76px / 否则 92px）。
深色底上不要再放强调色小字，`accent` 只用于巨大的引号底纹。

⚠️ `attribution` 只写真实来源。示例脚本里那条是**编的**，别照抄。

## CompareSplit

`kind: "compare"` —— 双栏对比。

```jsonc
{
  "kind": "compare",
  "vsLabel": "VS",
  "left":  { "title": "敌人", "value": "一直在", "detail": "北有瓦剌，南有倭寇" },
  "right": { "title": "自己", "value": "一直在烂", "detail": "制度、财政、人心" }
}
```

**右栏不是同时出现的**：它等旁白第一次念到右栏标题里的字才进场。
这个错位是"对比"语义的主要来源——同进同出就只是并排而已。
所以右栏标题尽量用旁白里的原词。

## TimelineRail

`kind: "timeline"` —— 横向时间轴，节点上下交替。

```jsonc
{
  "kind": "timeline",
  "milestones": [
    { "year": "1368", "label": "朱元璋登基", "detail": "大明建立" },
    { "year": "1449", "label": "土木堡", "detail": "皇帝被俘" }
  ]
}
```

年份通常**不在旁白里**（旁白说"从 802.11n 到现在"），这时节点会均匀铺在
整拍时长上，观众看到的是"节点跟着叙述推进"。想让某个节点精确卡词，
把年份写进旁白即可。

导轨的生长长度取"已亮起且位置最靠前的节点"——所以线会一截一截往前爬，
而不是第一个节点一出现就画满。最多 5 个节点比较舒服，再多会挤。

## CardStack

`kind: "cards"` —— 并列要点卡，"三个原因"这类结构的默认解法。

```jsonc
{
  "kind": "cards",
  "items": [
    { "title": "宗室膨胀", "detail": "朱姓皇族吃掉大量财政" },
    { "title": "官员冗余", "detail": "层层加派，人浮于事" }
  ]
}
```

卡片标题通常不在旁白里（旁白念的是"有三场慢性病"），
所以卡片会在整拍时长上均匀铺开依次落下。第一张卡片高亮。
卡片最大宽度 1320px，不铺满画面——铺满会让内容挤在左侧。

## ImageCard

`kind: "image"` —— 配图 + 说明。图片放 `public/img/`。

```jsonc
{ "kind": "image", "src": "img/router.jpg", "caption": "典型的家用路由器" }
```

`src` 省略时会退化成斜纹占位板，看起来像"这里本来就有张图"——
抽象配图的合理选择，也让忘记放图不会整拍空掉。
图片有 1.02→1.14 的持续推近 + 横向游移（Ken Burns），叠在常驻运动之上。
原本是 1.06→1 的缓慢回缩，方向是"退"、幅度又小，实测几乎是静止画面。

图不按固定 78% 宽度铺：同时受画面宽度和可用高度约束，取更紧的那个。
理由——16:9 的图铺满 78% 宽有 842px 高，加上上边距会顶穿底部字幕。
字幕轨开着时底部额外预留 210px 禁入区。

`caption` 是**压在图片内部的左下图注**，不是图下方的一行字。
放图外面会被全局字幕盖住（字幕永远在最上层），所以图注做成深色小胶囊。
一句话概括：`caption` 只放"这是什么"，不要重复旁白——重复的活儿字幕已经在干了。

---

## Odometer

`kind: "odometer"` —— 机械逐位计数。深色格子 + 固定列位，只有在变的那几列在跳。

```jsonc
{
  "kind": "odometer",
  "value": 1600000,
  "unit": "人",
  "label": "两京十三边卫名义兵力"
}
```

`label` 是格子下方的小字说明，`unit` 紧贴数字右侧。

**什么时候用它而不是 `StatCard`：** `StatCard` 是平滑计数（0 → 47 冲到位然后稳住），
读作"这个数有多大"；`Odometer` 是逐位步进，读作"这个数在跳"。
逐年增长、累加到某个数这类场景更有张力。

列位固定：位数和千分位分隔符由**最终值**决定，计数过程中数字不会左右挤。
34 帧数到几百万，逐位连续翻滚只会糊成一团，所以这里是步进而非滚动。

---

## Chart

`kind: "chart"` —— 柱状 / 折线 / 环形。`chartType` 选形态。

```jsonc
{
  "kind": "chart",
  "chartType": "bar",
  "label": "三次远征的兵力对比",
  "data": [
    { "label": "第一次", "value": 255000 },
    { "label": "第二次", "value": 500000 },
    { "label": "第三次", "value": 550000 }
  ],
  "emphasis": ["第三次"]
}
```

- `data` 每项 `{ label, value }`，可选 `display` 覆盖轴上显示的文本
- `emphasis` 里的项用强调色 + 加粗，用来把视线钉在一根上
- 环形图**每个 `data` 项各占一段**，不会自动把长尾合成"其余"——
  想少画几段就自己在 `data` 里合并好

配色按 `tone` 自动选，**不要在 `data` 里写死颜色**——同一组数据放浅色底和深色底
要能都读得清（`night` 底上的柱状图用浅色描边 + 深色填充，否则只剩空轮廓）。
环形图的调色板会把 `accent` 放在首位，并跳过与 `accent` 重复的颜色，
否则某一拍 accent 正好是 blue 时相邻两段会撞成同一个色。

---

## Highlight

`kind: "highlight"` —— 荧光笔划线 + 手绘圈注。VOX 系最标志性的两个"手写感"动作。

```jsonc
{
  "kind": "highlight",
  "text": "不是没钱，是钱花不出去。",
  "marks": ["钱花不出去"],
  "circled": ["不是没钱"],
  "caption": "—— 崇祯朝的财政困局"
}
```

**必须给完整 `text`。** 组件只给其中的词套样式，整句照常渲染——
一句话里的高亮，语义来自它在句子中的位置。只把标记词本身当正文渲染，
屏幕上就只剩那几个词，观众读不到任何上下文。

- `marks` 划线（黄色色带从左往右扫过）
- `circled` 圈注（圆角框，带一点旋转模拟手画）
- `caption` 句子下方的小字说明

`marks` / `circled` 里的词必须**原样出现在 `text` 里**，否则匹配不上、静默不画。
`circled` 是短语列表，但每项按整体匹配——不是逐字。

---

## Split

`kind: "split"` —— 2–4 格并排。同层级的并列信息，每格一个短标题。

```jsonc
{
  "kind": "split",
  "panels": [
    { "title": "田赋", "detail": "收不上来", "value": "42%" },
    { "title": "盐税", "detail": "被私盐冲垮", "value": "28%" }
  ]
}
```

`panels` 支持 `title` / `detail` / `value` / `src`（有 `src` 时该格显示图片）。

排布：2–3 格排成一排，4 格排成 2×2（`cols = n <= 3 ? n : 2`）。
格子高度按内容撑开而不是写死——写死高度会出现"三格时空卡浮在半空"。

---

## Stack

`kind: "stack"` —— 累积墙。逐项叠加增长的量。

```jsonc
{
  "kind": "stack",
  "items": [
    { "title": "洪武年间", "tag": "起点" },
    { "title": "永乐", "tag": "+" },
    { "title": "正统", "tag": "++" }
  ]
}
```

和 `CardStack` 的分工：`CardStack` 是并列要点（"三个原因"），彼此独立；
`Stack` 是**累加**关系——条目从底部往上堆，后面的比前面的更高，视觉上在往上垒。

---

## CaptionTrack

常驻字幕轨，**不由 `kind` 控制**。`script.json` 顶层：

```jsonc
{ "captions": true, "beats": [ ... ] }
```

`vox_tts.py` 默认写 `true`。挂在 `VoxVideo` 最外层，读全部 beats，
自己算当前该显示哪一句——字幕是**旁白的投影**，不是画面内容，
所以它跟音频走、不跟视觉走，不参与转场交叠。

断句规则：句末标点（`。！？；…`）硬断；句内逗号只是**候选**断点，
只有句子超过 16 字才在最近的逗号处断开，避免字幕一行拉太宽。

字幕底色是深色半透明块 + 56px 粗体：中文笔画密，压在浅色纸面上不描边根本读不清。

---

## 背景与常驻件

这些由 `visuals.tsx` 自动装配，通常不需要在 `script.json` 里配置。

| 组件 | 作用 | 位置 |
|---|---|---|
| `PaperStage` | 底纸 + 纸屑 + 纸纤维 + 账册格线 + **缓慢漂移/纸屑尘埃/曝光呼吸** + 可选配图 | 全屏 |
| `BeatLabel` | `07 / 10` 序号角标 | 左上 |
| `TitleMark` | 片名角标（只在第 0 拍出现） | 左上 |
| `ChapterProgress` | 底边进度条 + 每拍刻度 | 底边 |

**纸艺基元在 `src/paper.tsx`**，所有卡片/人物/时间轴都由它们拼出来：

```tsx
import { PaperSheet, Tape, sway, roughEdge, PAPER } from "../paper";

<PaperSheet seed={5} rotate={-0.6} frame={frame}>…</PaperSheet>
```

| 导出 | 说明 |
|---|---|
| `PaperSheet` | 一张带毛边和投影的纸。props：`seed`（漂移/旋转的确定性种子）、`tone`（`sheet` / `sheetWarm` / `night`）、`rotate`、`pad`、`maxWidth`、`frame` + `driftAmp`（传了就缓慢漂移，默认 1.2px / 170 帧） |
| `Tape` | 胶带。`width` / `height` / `angle`，贴两角即可 |
| `roughEdge(seed, amp, step)` | 生成 `clip-path` 多边形。`amp` 是 **px** |
| `bandEdge(seed, top, bottom, amp)` | 分层背景板的裁切带多边形：保留纵向 top%→bottom%，顶边是撕纸毛边 |
| `sway(frame, seed, amp, period)` | **缓慢漂移**，返回 `{x, y}`。整幅/大面积一律用它 |
| `jitter(frame, seed, amp, hold)` | 定格抖动（每 `hold` 帧换位），返回 `{x, y}`。只给小标签用 |
| `hash01(n)` | 确定性伪随机，写新动效时取相位用 |
| `fiberStyle` | 纸纤维点阵背景 |
| `PAPER` | `sheet` / `sheetWarm` / `edge` / `shade` / `tape` / `ink` 色板 |

三条约束（踩过坑，别绕）：

- 影必须挂在内层背景 `div` 上（`clip-path` + `drop-shadow`）；`box-shadow` 会被裁掉，
  挂在外层则卡内每个字都有重影。
- 不要给这些元素加 `mix-blend-mode`，祖先有 `transform` 时会出合成残影。
- 底纸（`COLORS.stage`）必须比纸片（`PAPER.sheet`）深一档，否则边界和帧间差一起消失。

**明暗规则**：第 0 拍和 `quote` 拍自动压深色底，其余纸面底。这个跳变
本身就是节奏，不必手工指定。想改就改 `visuals.tsx` 里的 `tone` 判断。

**背景相位连续**：`PaperStage` 接收 `phaseOffset={beat.from}`，让色块漂移
和定格呼吸按全片绝对帧计算。否则每拍都从相位 0 重启，切点会有 5-6px 的跳动。

**三层"整幅运动"，各有分工**：

| 层 | 参数 | 干什么 |
|---|---|---|
| 缓慢漂移 | `sway()` 6px / 240 帧（另加 0.06° / 300 帧） | 整张底纸（格线、纸屑、纤维、内容）像实物一样缓慢移动 |
| 纸屑尘埃 | 34 粒，上浮 0.008-0.03 %/帧，明暗起伏 | 画面上唯一有独立运动的实物；运动是真的、观感是静的 |
| 曝光呼吸 | 0.4%-2.0% 黑（深色拍为白）/ 3 帧 | 整幅 ±2 个灰阶，模拟每格快门误差 |

**不要再用整幅 `jitter()`**：它每 2-3 帧重摆 2.5px，单张纸片像定格动画，
整幅一起跳就是"画面一直在抖"。`jitter` 只留给个别小标签（幅度 1-2px）。
宽度大的内容（标题卡、大数字）不需要额外动作，靠这三层就够。

**配图层**（`script.json` 的 `visual.image`，所有 kind 通用）：

```jsonc
{ "kind": "cards", "image": "img/shot-chronic.png", "imageWash": 0.42, "items": [...] }
{ "kind": "route", "image": "img/shot-road.png", "imageLayout": "inset", "points": [...] }
```

两种放置方式：

| `imageLayout` | 效果 | 用在哪 |
|---|---|---|
| `full`（默认） | 铺满全幅、盖纸浆（`imageWash`），只剩轮廓和明暗 | 注解类拍：`cards`、`kinetic`、`person` |
| `inset` | 白边照片角贴右侧（41% 宽 / 47% 高，-1.7°），两段胶带 + 投影 | 符号类拍：`route`、`chart`、`timeline`、`split` |

`full` 的渲染顺序在 `PaperStage` 内：底纸 → 格线 → 纤维 → **图** → 纸浆 → 四周压深 → 内容，
所以图读起来是"压在纸下面的一张印刷品"。`inset` 不盖纸浆（照片是实物，不该被洗白），
并且放在内容层**下面**——卡片、路线可以压到它的边上，那本来就是剪贴簿的样子。

`inset` 时 `Route` 会自动把点位横向压到左侧 46%（`zoneW`），否则标签会压到照片上。
别的符号组件（`chart`、`timeline`）没有这个自动让位，用 `inset` 时自己把内容收进左半幅。

- `imageWash` 0-1：纸浆覆盖强度。0.35 图最清楚，0.55 只剩轮廓。浅色拍默认 0.42、深色拍 0.55。
- `full` 的图跟着漂移层走，并自己做一个 1.01-1.022 的极慢缩放；`inset` 的照片另有
  3px / 210 帧的独立滑移（图是独立的一件东西，只跟着底纸走会像印上去的）。
  两种都不要在外面再包 transform。
- 有图时 `visuals.tsx` 会跳过 `AmbientLight`：accent 色斑在照片上就是一层品红。

**分层背景板**（`visual.layers`，给了它就忽略 `visual.image`）：

```jsonc
"layers": [
  { "src": "img/far.png",  "depth": 0.05 },
  { "src": "img/mid.png",  "depth": 0.55, "band": 0.62, "y": 0.38 },
  { "src": "img/near.png", "depth": 1,    "band": 0.24, "y": 0.76 }
]
```

| 字段 | 含义 |
|---|---|
| `src` | `img/xxx.png`（相对 `public/`），按数组顺序从远到近叠 |
| `depth` | 0-1 视差。远层位移系数 0.14，近层 1.04（都跟着底纸的漂移走） |
| `band` | 只露出原图底部这条带（0-1），顶边裁成撕纸毛边（`bandEdge`） |
| `y` | 这条带落在画面的位置（0-1，从上到下）。**必须给**，否则所有带堆在底部 |

`image` 和 `layers` 可以同时给：`image`（`full`）当最底一张铺满，层叠在它上面；
`imageLayout: "inset"` 的角贴照片画在层之上、内容层之下，天然压在背景上面。

层内图片是 `objectFit: cover` + 缩放 1.1（留视差余量），再按 `y + band - 1.05`
下移，使原图底边对齐裁切带底边。三层各自再叠一个 1.1 ± 0.012 的慢呼吸（相位错开）。

出图要求：**主体落在原图底部那条带里**（提示词写"下方 X%，上方是空白米色纸"），
否则旗帜、人物头会被水平切断。三层的 `light` / `color` 必须一致。

**布局分区是固定的**，新组件请避开这三条：

| 区域 | 留给 |
|---|---|
| 左上 `pad, 64` | 角标 |
| 左下 `pad, 96` | 出处（StatCard / KineticText 自己渲染） |
| 底边 | 章节进度条 |

模板里各组件的上下 padding 是 `140px / 130px`，就是为了不压到角标。

---

## 特效层

`src/effects.tsx`。这些不是 beat 组件（不能单独占一拍），是套在任意 beat
上的装饰层，在 `visuals.tsx` 里统一注入。

### 每拍可挂的开关

```jsonc
"visual": {
  "kind": "kinetic",
  "impact": "heavy",   // 镜头推近 + 抖动
  "flash": true,       // 闪白 3 帧
  "sweep": true,       // 光带扫过
  "ambient": "normal"  // 常驻运动：off | soft | normal(默认) | strong
}
```

### `ambient` —— 常驻运动

每拍自动套一层不停的运动：匀速推近（1.8% / 3.2% / 4.8%）+ 低频漂移 +
入场动量 + 两块反向游走的柔光。`seed` 用 beat 序号，相邻拍的相位错开。

**推近上限 4.8%**：满宽排版（11 个字的 kinetic 行、highlight 圈注框）已经占了
90% 以上画幅，再大就切字。想要更强的运镜感要先改布局。

它只能消掉"整段完全不动"的死帧，**不能**让画面变活泼——那是组件自己的事。
用 `check_motion.py` 的逐拍均差判断效果。

### `impact` —— 镜头冲击

落在这一拍第一个词被念到的那一帧（旁白一开口，画面就"顶"一下）。
三档：`soft`（默认）/ `medium` / `heavy`。

**全片 ≤3 处，且相邻两处间隔 ≥3 拍。** 这是"整画面级冲击"的预算——
逐词的小反应（字弹一下、卡片落一下）是元素层，可以密集；整层震屏会让
观众疲劳。`check_rhythm.py` 会替你数。

### `Flash` —— 闪白

3 帧（约 0.1s）白色覆盖。再多就刺眼。

### `LightSweep` —— 光带

一道斜向光带扫过画面，用普通 alpha 白色渐变（0.16）。

> 曾经是 `mix-blend-mode: soft-light`，视觉更"光"，但纸艺层的定格抖动是
> `transform` 祖先，两者一起会让 Chromium 留下**合成残影**（文字叠成三四个），
> 且只在成片里看得见。`AmbientLight` 也是同理改成 alpha 叠加。**别改回去。**

### `AmbientLight` —— 漂移柔光

两块大面积色斑缓慢反向游走，`opacity` 按 `ambient` 档位缩放。它是背景的呼吸，
不是动效主力——大面积柔光对帧间差的贡献接近 0（实测位移从 18px 加到 58px 只涨 0.02）。

### `KenBurns` —— 缓慢推拉

给静态内容呼吸感。`from`/`to` 是缩放区间，`pan` 是方向。

### `floatAt()` —— 元素级持续浮动

```ts
floatAt(frame, amp = 4, period = 64, seed = 0): number   // 返回 px 位移
```

纯函数（不是 hook），所以可以在 `.map()` 里逐项调用。给"入场动画跑完之后"
的元素一点位移，免得整拍定格：

- 振幅 3-8px、周期 60-100 帧最自然；再大就读成"在漂"。
- **同一个画面里多个元素必须用不同 `seed`**，否则一起上下像整块画布在抖。
- 只动位置，别动透明度——透明度变化在帧均差里几乎测不出来，位置变化才有效。

已用在 `KineticText`（逐词）、`TimelineRail`（年份标签）、`Route`（点位标签）、
`CardStack`（卡片）、`CompareSplit`（双栏反向）、`Person`（肖像与姓名）。

### `Grain` —— 胶片颗粒

全片铺一层，默认 3.5% 透明度。用确定性伪随机点阵（不是 SVG `feTurbulence`——
后者每帧要全画幅重算噪声，渲染会明显变慢，而这个强度下看不出区别）。
已挂在 `VoxVideo` 里，不用在 script.json 里开。

---

## 运镜层（`camera`）

`useCamera(frames, move, seed)` 在 `src/effects.tsx`，作用是给**整幅**（背景 +
内容）套一个 transform。角标和章节进度条在它外面，不受影响。

| move | 做法 | 幅度 |
|---|---|---|
| `push_in` | 匀速推近 | 3.5% |
| `pull_out` | 从 1.035 拉回原位 | 3.5% |
| `pan` | 放大 1.06 后横移 | 行程 5% |
| `tilt` | 放大 1.06 后纵移 | 行程 4% |
| `parallax` | 放大 1.08 后横移 + 微旋 | 行程 8% |
| `whip` | 放大 1.2，8 帧甩完 + 模糊残影 | 行程 18% |
| `static` | 不动 | — |

三条硬规矩：

1. **幅度不能大**。排版吃掉 90% 画幅宽度，推近超 4% 就切字。
2. **平移必须留出血**（先放大再平移）。直接仿射位移会露出画布外的黑边。
3. **背景的渐变盒要比画幅大**（`AmbientLight` 用 `inset: -30%`）。
   渐变块和画幅一样大时，运镜一平移，它的边缘就被甩进画里，右侧出现一条竖直色带。

> 这三条是从别人的踩坑记录里抄的：平移从 overscan 画布取样、元素落位前
> 原位只做模糊不改亮度（改亮度会留色块）、`back` 缓动不能用在 scale 上
> （会冲过 1.0 露出重影，scale 用 `out`）。

## 碎片拼贴层（`Pieces.tsx`）

`PieceLayer` 在 `src/components/Pieces.tsx`。把**一张**纸艺图切成若干矩形块，
每块按关键帧飞入，最后拼回原图。

```jsonc
"visual": {
  "kind": "compare",
  "pieceBase": "img/shot-knife.png",   // 底图（和 image 互斥）
  "pieces": [
    { "x": 0,     "y": 0,     "w": 0.551, "h": 0.509,
      "enter": "fly_left", "at": 12, "spin": -1.2, "depth": 0.62 },
    { "x": 0.551, "y": 0,     "w": 0.449, "h": 0.509, "enter": "fly_right", "at": 17 },
    { "x": 0,     "y": 0.509, "w": 0.551, "h": 0.491, "enter": "fly_up",    "at": 22 },
    { "x": 0.551, "y": 0.509, "w": 0.449, "h": 0.491, "enter": "pop",       "at": 27 }
  ]
}
```

`x/y/w/h` 是**画幅比例**（0-1）。`at` 是"这一拍第几帧开始飞"（拍内帧，不是全片帧）。

| enter | 动作 | 缓动 |
|---|---|---|
| `fly_left` / `fly_right` / `fly_up` | 从画外甩进来 | `easeOutBack`（过冲） |
| `drop` | 上方落下 + 落地压扁回弹 | `easeOutCubic` + squash |
| `slap` | 从大到小"啪"一下贴住 | `easeOutCubic` |
| `pop` | 原地放大归位（最保守） | `easeOutCubic` |

**为什么不用 AI 抠图**：BiRefNet / RMBG 是在真实照片上训的，平涂纸艺图的
撕边、纸底色会被吃掉或带出一圈。而从同一张图切矩形是**精确**的——拼回去一个
像素不差。要自由形状的部件再上抠图（见 `comfyui.md`）。

四条实现上的硬规矩（每一条都对应一次实测翻车）：

1. **底图必须挖洞**，否则飞进来的块和底图重影。挖洞用
   `clip-path: path(evenodd, ...)`：外层矩形 + 每块一个子路径。
   **不要用 CSS `mask-image` 塞 data-URI**，也不要内联 SVG `<mask>`——在本机的
   Remotion Chromium 里两者都**静默失效**（不报错、也不遮），表现为"底图整张
   还在，块飞过去像重影"，而且控制台什么都没有。
2. **块必须互相叠一点**（`PAD = 0.004`）。四块精确拼满时浏览器按小数像素裁切，
   接缝会漏出一像素纸色——一条从上到下的浅色直线。重叠区取的是同一片源像素，
   叠了看不出来。投影要在落位时淡到 0，否则上层投影会横过邻居的边。
3. **底图始终钉在画幅左上角**，每块只是它的取景窗。`background-position` 的
   百分比按"盒子和图之间的空档"算：`p = −rx / (1 − rw)`。
   写成 `(x − rx)/(1 − rw)` 只有 `x = 0` 时才对——右边两块会整块显示错位置
   （实测：右半幅变成一片空白纸）。
4. **这一层要比 `PaperStage` 的底纸容器缩回 `STAGE_INFLATE`**。底纸为了漂移
   是 `inset: -14` 的，直接在里面按画幅百分比定位会整体放大 1.5%、右下角偏出
   十几个像素。所以 `PieceLayer` 的根节点用 `inset: STAGE_INFLATE`。

底图和块共用**同一层** `filter` 和纸浆覆盖（`wash`），所以拼回之后接缝不跳色。
`wash` 要和同片其它整幅图拍保持一致（浅色 0.42 / 深色 0.55）。

> 图必须是 **16:9**（和画幅同比例），否则会被拉伸变形——底图是 `objectFit: fill`，
> 块是按画幅比例取样，两边一致但整体会歪。

**拼贴要跟内容层抢画幅。** `compare` / `split` / `cards` 这类组件会铺满整个画幅
（实测 `compare` 两栏各占半边、纸片不透明），拼装动作就只剩画面上没被卡片压住的
那部分看得见。所以：

- 想在拼贴上演"撕开 → 拼回"，**优先放在内容占幅小的拍**（`kinetic`、`stat`、
  `quote`、`image`），或者
- 接受它只是背景纹理——那就要把 `at` 排得早一点（转场一结束就开始飞），
  让拼装在卡片还没盖满时先演一段。

## 配乐床（`music.tsx`）

`MusicBed` 在 `src/music.tsx`。音量曲线是**解析式**的：

```
volume(f) = gain × (1 − duck × 让路量(f)) × 淡入(f) × 淡出(f)
```

让路量由旁白**词级时间戳**算出来：说话窗口内为 1，窗口外按 `ramp` 帧软化到 0，
相邻窗口自动合并（避免两拍连着说话时中间"抬起来又压下去"）。

每帧独立算、不依赖上一帧 → 逐帧渲染可复现，跳帧渲染不会得到不同的混音。

实测（恒定包络测试音床 + 差分渲染）：说话段音乐电平 600，间隙段 1390，
比值 2.18（期望 1/(1−duck) = 2.63，差的那点来自 ramp 边缘和编码噪声）。

## 转场

核心一条：**视觉走 `TransitionSeries` 做交叠，音频按实测位置绝对摆放、完全不参与。**
所以转场纯属视觉决策，改它不会让旁白错位；但视觉时钟必须扣掉交叠帧
（`cursor += dur - next_te`）。选型原则见 `SKILL.md` 的「转场与特效」。

`transitions.ts` 暴露 16 种（Remotion 原生 20 种，未接入另外 4 种）：

`none`（硬切）、`fade`、`dissolve`、`slide`、`pushCut`、`blurSlide`、`wipe`、
`iris`、`clockWipe`、`flip`、`bookFlip`、`crossZoom`、`zoomInOut`、`dreamyZoom`、
`filmBurn`、`ripple`。

别名：`default` → `fade`、`push` → `slide`、`cut` / `hard` → `none`、
`book` → `bookFlip`、`burn` → `filmBurn`。

`clockWipe` / `iris` 必须传画幅尺寸，否则 Remotion 4.0.535 会算出 `NaN` 半径并抛
`Malformed path data`。模板的 `transitionFor()` 已统一从 `useVideoConfig()` 喂入。

---

## 共用工具

`src/components/BeatPresence.tsx`，写新组件时从这里取。

### 加一个新组件：四个文件，缺一不可

| # | 文件 | 改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `src/components/YourThing.tsx` | 组件本体，签名 `({beat, visual, accent, tone})` | — |
| 2 | `src/components/index.ts` | 加一行 export | 别的文件 import 不到 |
| 3 | `src/timeline.ts` | `VisualKind` 加类型名 **+ `VisualSpec` 加字段** | **tsc 报类型不兼容** |
| 4 | `src/visuals.tsx` | import + `REGISTRY` 加一行 | `script.json` 里写这个 kind 时静默回落到 `KineticText` |

**`VisualKind` 和 `VisualSpec` 是封闭联合类型**，不是开放结构。这是最容易漏的一步——
只往 `REGISTRY` 里塞组件而不扩 `VisualSpec`，编译直接过不去。

改完跑一次 `npx tsc --noEmit` 确认。

### 写新组件的三条硬规矩

1. **只用 `useCurrentFrame()`（或 `useBeatPresence` / `useBeatWords`，它们内部就调它）取帧。**
   不要用 CSS `transition` / `animation` / `@keyframes`，也不要依赖 `setTimeout`。
   渲染是逐帧截图的，浏览器里没有时间推进，CSS 动画根本不会动。
2. **动画要挂在旁白时间戳上**，用下面的 `resolveWordTimings` / `useBeatWords`。
   按固定帧数排动画，这一拍就和声音脱节了。
3. **避开固定布局分区**（左上角标 / 左下出处 / 底边进度条），
   沿用其它组件的 `padding: 140px … 130px`。

### `useBeatPresence(delayFrames?)`

返回 `{frame, fps, inP, outP, presence}`。`presence` 是整体进出场包络，
乘到容器的 `opacity` 上就不用自己算退场。

### `useBeatWords(words)`

```tsx
const { at, indexOf, after, settledAt } = useBeatWords(beat.words);

at(i, span)              // 第 i 个词的入场进度 0→1（默认 6~14 帧跨度）
after(frame, span)       // 从某一帧开始的进度，用于"念到 X 之后才出现第二层信息"
indexOf(text)            // 找到包含该文本的词下标，找不到返回 -1
settledAt                // 最后一个词念完的时刻
```

### `resolveWordTimings(shown, spoken, fallbackSpan?)`

把上屏词对齐到旁白的词级时间戳。**写任何"逐项依次出现"的组件都该用这个**，
否则你得自己处理"上屏的词比旁白切得粗"这种问题。找不到的项会在
`fallbackSpan` 上均匀铺开。

### `makeEmphasisMatcher(emphasis?)`

返回一个 `(word) => boolean`，支持包含匹配。

### `useStage()`

返回 `{width, height, pad, maxWidth}`。`pad` 是 8.5% 的安全边距。
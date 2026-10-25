# 组件参考

15 个视觉组件 + 常驻字幕轨 + 特效层 + 转场。每个组件接收 `{beat, visual, accent, tone}`，
`beat` 里带词级时间戳，所以组件内部天然能把动画卡在旁白上。

## 目录
- [KineticText](#kinetictext) · [StatCard](#statcard) · [Odometer](#odometer)
- [Chart](#chart) · [Highlight](#highlight) · [Split](#split) · [Stack](#stack)
- [Person](#person) · [Route](#route) · [Callout](#callout) · [QuoteCard](#quotecard)
- [CompareSplit](#comparesplit) · [TimelineRail](#timelinerail) · [CardStack](#cardstack) · [ImageCard](#imagecard)
- [CaptionTrack](#captiontrack) — 常驻字幕轨，不由 `kind` 控制
- [背景与常驻件](#背景与常驻件) · [特效层](#特效层) · [运镜层](#运镜层camera) · [入场配方层](#入场配方层motion) · [版式变体](#版式变体layout) · [配乐床](#配乐床musictsx)
- [3D 纸艺舞台](#3d-纸艺舞台stage3dtsx) · [碎片拼贴层](#碎片拼贴层piecestsx) · [抠图元素层](#抠图元素层cutoutlayertsx) · [红笔批注层](#红笔批注层notelayertsx)
- [共用工具](#共用工具) · [加新组件](#加一个新组件四个文件缺一不可)

---

## KineticText

`kind: "kinetic"` —— 逐词弹出的大字。**别用超过 4 拍**，整片一个节奏就单调了。

```jsonc
{
  "kind": "kinetic",
  "words": ["二百七十六年", "没有一个死在敌人手里"],  // 每个元素独占一行
  "emphasis": ["没有一个死在敌人手里"],           // 这些贴成纸片字（每拍最多 2 张）
  "align": "center"                      // 或 "left"
}
```

**`emphasis` 是纸片字，不是"换颜色"**：命中的短语会从从句里切出来，单独贴成
一张毛边小纸片（双层纸 + 投影 + 微旋转 + 落纸回弹），红线仍然画在纸上。
每拍最多 2 张——超出的强调词退回"放大 16% + 红线"，否则整段字会碎。
纸片只贴短语本身："是几何"里只有"几何"是纸片，"是"仍留在正文层。

**纸片有六种版式**，默认按字数挑；同一拍的第二张会自动换一种，免得两片一模一样：

| 版式 | 字数 | 样子 | 适合 |
| --- | --- | --- | --- |
| `label` | ≤2 | 金色价签 + 细边框 + 胶带 | 单个字的强调（"圆"），全片别超过 3 次 |
| `cut` | 3-5 | 米白剪纸，双层纸最干净 | 默认，语义中最普通的强调 |
| `note` | 3-5 | 暖黄便签 + 折角 | 一句里的补充、括号感 |
| `clip` | 3-5 | 旧灰剪报 + 上下栏线 + 重网点 | 引述、资料、旧报纸口吻 |
| `banner` | ≥6 | 白色长条 + 左侧红边，超长可折两行 | 半句到一句的强调（"宽度处处相等"） |
| `red` | 手动 | 红纸白字 | 全片只留一次，给最重的那句 |

```jsonc
{ "kind": "kinetic", "words": ["方的井盖", "会掉进自己的洞里"], "emphasis": ["洞里"],
  "tile": "red" }        // 写死版式；不写 = auto，按上表选
```

颜色都取自五色板：`note` 的黄、`label` 的金、`red` 的红是画面里仅有的暖色跳点，
其余纸片保持米白/旧灰。字数到 3-5 时 `cut / note / clip` 由种子决定，
想固定就用 `tile` 写死——但只建议对"全片唯一一句"这么做。
`tile` 只对 `kinetic` / `quote` 生效，且必须和 `emphasis` 一起写。

普通词也不是同一个 pop 了：每词的落定速度（6-9 帧）、起手旋转（±1.7°）、
偶发的侧贴（±12% 字宽）都由 `hash01(词序 + beat.from)` 决定，同一次渲染可复现。
这是"不单调"的主要来源——不要让所有词走同一条曲线，但也别加随机抖动。

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
  "emphasis": ["不是你的"],           // 可选，贴成纸片字（同上，最多 2 张）
  "attribution": "无线网络工程师，访谈"
}
```

`text` 省略时用 `narration`。字号随长度自适应（>40 字 60px / >22 字 76px / 否则 92px）。
深色底上不要再放强调色小字，`accent` 只用于巨大的引号底纹。

引述**不是整段一起淡入**：按强调词切成若干段，每段按旁白的词级时间戳依次进场，
强调短语贴成纸片。标点单独成段时跟着前一段出现，不会晚半拍。
所以 `text` 尽量用旁白原话，改写成旁白里没有的说法会让某一段只能按兜底节奏铺开。
纸片版式与 KineticText 同一套（见上面的表），也可用 `"tile"` 写死。

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

两栏中间那块最大的空纸可以放一个**程序化图形**（不用素材）：

```jsonc
"left":  { "title": "方盖", "detail": "对角线 1.41 倍边长", "mark": "square" },
"right": { "title": "圆盖", "detail": "宽度处处等于直径", "mark": "circle" }
```

`mark` 可选 `square` / `circle` / `triangle` / `reuleaux` / `hex`。
图形是网点填充 + 黑描边 + 红色偏移剪影，与风格板的组件语法一致。
只有标题+说明的对比拍一定要给 `mark`——否则两栏中间会空出 400px 白纸，
整拍立刻变成两页并排的幻灯片。

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

`kind: "odometer"` —— 机械逐位计数。一块**墨色厚纸**（毛边 + 胶带）上开三个数位窗，
列位固定，只有变的那几位在跳。不是深色圆角卡片——那是仪表盘 UI，不是纸。

```jsonc
{
  "kind": "odometer",
  "value": 1600000,
  "unit": "人",
  "label": "两京十三边卫名义兵力"
}
```

`label` 是纸块下方的小字说明（上面压一道红记号），`unit` 紧贴数字右侧、固定芥末黄。

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

`kind: "highlight"` —— 红色马克笔条 + 红笔划线 + 手绘圈注。档案纸上最自然的三个"有人读过"的手势。

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

- `marks` 划线（**红色**马克笔条从左往右扫过，词下再压一道红笔线）
- `circled` 圈注（红色圆角框，带一点旋转模拟手画）
- `caption` 句子下方的小字说明

记号颜色**固定正红**，不跟每拍的 `accent` 走——灰/黄的记号会读成"选中状态"，
那是 UI 语言。红只做记号，所以面积很小。

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

字幕是**一张撕下来的纸**（`PAPER.sheet` + 毛边 + 网点），墨色 56px 粗体。
不是深色圆角块——那是全片最像 PPT 的地方。

---

## 背景与常驻件

这些由 `visuals.tsx` 自动装配，通常不需要在 `script.json` 里配置。

| 组件 | 作用 | 位置 |
|---|---|---|
| `PaperStage` | 做旧色层 + **旧地图纹** + 半调网点 + 霉斑 + 纸纤维 + 账册格线 + 缓慢漂移 / 纸屑尘埃 / 曝光呼吸 + 可选配图 | 全屏 |
| `RunningHead` | 红笔 + 片名。**没有页码**（页码是文档语法，不是视频语法） | 左上 |
| `ChapterProgress` | 底边 4px 章节线 + 每拍刻度 | 底边 |

底纸的三层材质和五支颜色见 **`references/style.md`**——加新组件前先过一遍，
里面写了哪些东西是禁止出现的（纯色背景、圆角面板、彩色描边、页码……）。

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
| `BrushUnderline` | 红笔划线。`p` 是 0-1 的绘制进度，用 `clipPath` 揭示（不要用 dashoffset，`non-scaling-stroke` 会让它碎成虚线） |
| `sheetTexture` | 纸片上的半调网点（3% 脏）。铺在卡片背景层，字压在它上面 |
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
| 左上 `pad, 64` | 报头（红笔 + 片名，**无页码**） |
| 左下 `pad, 96` | 出处（StatCard / KineticText 自己渲染） |
| 底边 | 章节进度条 |

模板里各组件的上下 padding 是 `140px / 130px`，就是为了不压到报头。

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

## 入场配方层（`motion`）

`visual.motion` 控制内容层**怎么进场**。实现分两半：`useEntrance` 出位移/裁剪
（`src/components/BeatPresence.tsx`），`useBeatPresence` 按同一配方出进场透明度——
组件代码不用改，退场仍统一走 `outP` 淡出。

| 配方 | 做法 | 透明度 |
|---|---|---|
| `stamp` | scale 1.18 → 1，spring 阻尼 11 过冲回弹 | 0.85 → 1（4 帧） |
| `wipe` | `clip-path: inset(top)` 从下往上揭开（14 帧） | 不淡入 |
| `rise` | translateY 56px → 0，spring | 12 帧淡入（底 0.2） |
| `flip` | `perspective` + rotateY −16° → 0 | 不淡入 |
| `build` | 整幅不做进场，元素按词卡点逐项出现 | 不淡入 |
| `drift` | translateX −36px → 0 | 8 帧淡入（底 0.2） |

- **不写 `motion` 按拍序自动轮换**：`stamp → build → wipe → rise → drift` 循环，
  相邻拍（含首尾、含跨 kind）保证不同。`build` 落在不可 build 的 kind
  （image/person/quote/highlight）上时自动换成 `drift`。
- `flip` 不在轮换表里，想用必须手写。
- `build` 依赖组件自己的逐项动画（词弹出、卡片落下、里程碑画线），
  kinetic/cards/timeline/route/chart 这些 kind 天然成立。

## 版式变体（`layout`）

`visual.layout` 让同一组件换一种摆法，打破"每页居中卡片"。**不自动轮换**。

| 值 | 做法 | 适用 |
|---|---|---|
| `center` | 组件默认 | 全部 |
| `left-edge` | 内容靠左缘排版 | kinetic / stat / quote / cards |
| `bottom-third` | 内容锚在画面下三分之一 | kinetic / stat / quote / cards |
| `split` | 左右分栏：数字在左，标签在右 | 仅 stat |
| `full-bleed` | 贴边排版，文字压图上（需要 `image`/`layers`） | kinetic / stat / quote |

`full-bleed` 只是省掉卡片留白，纸浆覆盖（`imageWash`）仍然生效——它不改变
PaperStage 对配图的处理。连续多拍不写 layout 时 `check_rhythm` 会提示。

## 镜头拆分（`visual.shots`）

一拍内部再切镜头。`ShotLayer`（`src/ShotLayer.tsx`）在 beat 的 `<Sequence>` 里
为每个镜头建嵌套 `<Sequence>`：**内容层切，纸台 / 运镜 / 特效留在拍级**。
拆分规则在 `src/shots.ts` 的 `computeShots`（纯函数，node 套件覆盖）。

| 字段 | 单位 | 说明 |
|---|---|---|
| `from` | 秒，相对拍开头 | 省略 = 接上一镜结尾（首镜 = 0）；第 2 镜起必须写，且不能倒序 |
| `to` | 秒 | 省略 = 下一镜开头（末镜 = 拍尾） |
| `words` | 字符串数组 | 本镜单独上屏的词；省略 = 窗口内旁白按句断 |
| `motion` | 配方 | 省略 = 按全局镜头序号轮换（跨拍相邻也不重复） |
| `layout` | 版式 | 省略 = 继承拍级 `layout` |
| `transition` | `cut` / `crossfade` | 本镜怎么进，默认 `cut` |

- **只对 `kinetic` 生效**：items 类组件的词级时间戳不在词流里，按项锚点是另一套机制。
  `preflight.py` 会报错挡掉其它 kind 的 `shots`，运行时兜底回退单镜头。
- **自动拆分**（不写 `shots`）：`clauseEnds()` 把 `narration`（去空白/标点）和词文本
  逐字对齐，句读后的下一个词即新镜头起点——**edge-tts 的词文本不带标点，只看词文本
  永远拆不开**。短于 `MIN_SHOT_SECONDS = 1.5` 秒的句子并入相邻句（末句并进前一镜），
  合并后只剩一句就是单镜头。末句没有收尾标点时同样占满到拍尾。
- **写了 `shots` 之后**拍级 `visual.words` / `visual.motion` 失效，分别由镜头级
  `words` / `motion` 接管；自动拆分的拍同样不认拍级 `motion`（要指定就写显式 shots）。
  `camera` 仍是拍级。多镜拍里拍级 `visual.text` 不上屏——否则每一镜都会重复整句；
  镜头窗口里没有词时回退拍级 `narration`，不会空屏。
- **`impact` / `flash` 是拍级**：`ShotLayer` 只在拍内首镜开火，`check_rhythm` 的
  全画面冲击预算仍按拍计（拆镜不会凭空多出预算）。
- **crossfade**：前一镜 `<Sequence>` 向后多挂 `SHOT_FADE = 8` 帧、后一镜前 8 帧
  透明度 0→1，两个 Sequence 自然交叠。它不进 `TransitionSeries`——镜头级转场
  绝不能进"视觉时钟"，音频时钟是拍级的。末镜不延长。
- 非末镜 `holdExit`：镜头的"出"是硬切，只有整拍最后一镜负责拍级退场淡出。
- 结构错误由 `check_shots` 挡在体检阶段：非 kinetic、`to ≤ from`、镜头重叠、
  第 2 镜起缺 `from` 或 `from` 倒序、坏枚举。跑过 TTS 之后（`src/timeline.json`
  存在）`check_shot_fit` 还会核对 `from`/`to` 没有越出这一拍的实测拍长——越界
  运行时会被 clamp，整镜静默消失。配方相邻重复由 `check_rhythm.check_shot_rhythm`
  跨拍检查；自动拆分的镜头数在脚本阶段未知，涉及自动值的接缝只提示不判失败。

## 3D 纸艺舞台（`stage3d.tsx`）

按拍的**可选**舞台：把 `PaperStage` 那层换成真的 Z 轴（React Three Fiber +
`@remotion/three`），运镜时前后纸片有真正的位移和遮挡。文字排版仍留在 DOM——
中文字形和可读性在 3D 里没有胜算，3D 只出底纸、纸片、胶带和尘埃。

```jsonc
"visual": {
  "kind": "kinetic",
  "stage3d": {
    "camera": "push_in",          // 省略时跟随 visual.camera
    "punch": 0.7,                 // 开场顿挫（世界单位）
    "mapSrc": "img/map.png",      // 可选，底纸上的旧地图纹理
    "pieces": [
      { "src": "img/hole-cut.png", "x": 1.3, "y": -0.05, "z": -0.45,
        "w": 2.65, "wash": 0.78, "hole": 1, "shadow": 0.13, "drift": 0.008 },
      { "src": "img/lid-cut.png", "x": 1.22, "y": 0.56, "z": 0.42,
        "w": 1.0, "enter": "drop", "at": "井盖", "fall": "掉进",
        "alphaCut": 0.9, "spin": -14, "marks": [
          { "w": 1.5, "h": 0.03, "rot": 44, "at": "对角" }
        ] }
    ],
    "tapes": [ { "x": 0.16, "y": 1.24, "z": -0.435, "w": 0.56, "h": 0.18, "rot": 34 } ]
  }
}
```

**坐标是世界观单位，不是 0-1 比例。** 16:9 画幅约 **7.2 × 4.05**，`x/y` 是纸片
**中心**，`w` 是宽度。直接抄 `cutouts` 的 0-1 坐标，纸片会全缩在画面正中一小团——
`preflight.py` 会在 `w < 1` 或坐标明显越界时提醒。高度由图片比例推出来，不用写。

| 字段 | 含义 |
|---|---|
| `camera` | `push_in`（默认）/ `pull_out` / `pan` / `static`。2D 的 `tilt`/`parallax`/`whip` 不支持，会回落 `push_in` |
| `punch` | 开场镜头往前一顿的幅度（世界单位），默认 0 |
| `backdrop` | 背景纸暗度，1 = 原色；想压暗给 0.9-0.96 |
| `foreground` | 底部撕纸带（近景遮挡），默认关 |
| `motes` | 空气尘埃，默认开 |
| `sway` | 手持微漂移强度，默认 1；点题段给 0 |
| `mapSrc` | 底纸上的旧地图纹理（相对 `public/`） |

纸片字段：`src` / `x` / `y` / `w` 必填，其余可选。

| 字段 | 含义 |
|---|---|
| `z` | 深度，**0 是纸面，负值向后**。小于 -2.9 会被背景纸完全挡住 |
| `rot` | 静态倾角（度） |
| `drift` | 常驻微漂移幅度（世界单位），默认 0.018 |
| `shadow` | 程序投影强度（世界单位），默认 0 |
| `wash` / `gray` / `hole` | 纸浆覆盖 / 去色 / 洞感，各 0-1 |
| `alphaCut` | alpha 裁切阈值，默认 0.35；素材自带烘焙投影时抬到 0.9 |
| `blend` | `normal` / `multiply`；素材带白底时用 multiply |
| `enter` | `drop` / `rise` / `pop`，省略 = 拍开头就在 |
| `at` | 念到这个词才入场（写旁白里的原词） |
| `spin` / `spinAt` / `spinDur` | 整拍累计转角；给了 `spinAt` 就等念到那个词再转 |
| `fall` / `fallDistance` | 念到这个词开始坠出画；默认坠 1.35 |
| `marks` | 画在这张纸上的红笔（纸片局部坐标），跟着纸片一起漂移与旋转 |

`marks` 每项：`w` 必填，`x/y/z` 默认 0 / 0 / 0.03，`h` 默认 0.03、`rot` 默认 0、
`color` 默认正红；`at` 是"念到这个词开始从左端画出来"，`drawDur` 默认 10 帧，
不给 `at` 就常驻。

**和 2D 层的关系**：`stage3d` 只替换 `PaperStage` 与 `cutouts`。`kind` 组件、字幕、
`annotations`、`impact`/`flash`/`sweep`、转场都照常压在 3D 画面上。同一拍写了
`cutouts` / `pieceBase`+`pieces` / `image` / `layers` 不会报错，但**都不会渲染**。
`quote` 拍是深色纸台，3D 目前只有浅色底，别混用。

依赖：`three`、`@react-three/fiber`（^9）、`@remotion/three`（版本必须和
`remotion` 一致）。模板 `package.json` 已经带上；**老项目要自己补**
`npm install three @react-three/fiber @remotion/three@4.0.535`，否则 `preflight`
直接报错。

四条实现上的硬坑：

1. **shader 的 uniform 不能原地改 `uniforms.x.value`。** 逐帧视频渲染是多实例
   并行截图，原地改的值会冻结在第一帧；每帧新建 uniforms 对象
   （`{ ...base, uProgress: { value } }`）才会更新。
2. **动画只读 `useCurrentFrame()`**，不要用 `useFrame` 的 delta 或 `performance.now()`
   ——同一帧在不同 worker 上会长得不一样。
3. **纸片边缘一圈灰影**：素材把烘焙投影做进了 alpha，普通混合会把它画成实体。
   抬 `alphaCut`（0.9）把灰影裁掉，阴影交给 `shadow` 程序投影。
4. **词锚点和 2D 是同一套规则**（`resolveWordTimings`）。旁白会按 boundary 把
   "井盖"切成"井"+"盖"，直接 `includes("井盖")` 永远不命中，会退回拍开头——
   纸片就变成"一开场就掉下来"。

**什么时候值得上 3D**：需要真前后遮挡（东西掉进洞里、纸片从别的纸背后转出来、
镜头穿过一层纸）。纯粹"想让画面更高级"不值得——3D 渲染不慢，但慢镜头下画面
反而更"静"，PPT 感要靠在拍内安排词级动作和切镜，不在 Z 轴。

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

## 抠图元素层（`CutoutLayer.tsx`）

把**分别生成**的平底元素图抠成透明 PNG，各自入场、各自运动。与 `pieces`
（一张图切块）是两条路，同一拍不要混用。

```jsonc
"visual": {
  "kind": "kinetic",
  "cutouts": [
    { "src": "img/roll-cut.png", "x": 0.575, "y": 0.43, "w": 0.14,
      "enter": "fly_left", "at": "滚", "depth": 0.6, "print": true }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `x` / `y` | **中心点**（画幅比例 0-1），不是左上角 |
| `w` | 宽度占画幅比例；高度按图片比例自动 |
| `at` / `fall` | 念到这个词才入场 / 开始坠落。写旁白里的原词，找不到就回落到拍开头 |
| `enter` | `pop` / `drop` / `rise` / `fly_left` / `fly_right` / `stamp` |
| `depth` | 0 远 / 1 近：影响漂移幅度和投影浓度 |
| `shadow` | 程序投影的模糊半径（px）。素材自带烘焙阴影时写 `0`，否则两层影子 |
| `blend` | `normal` / `multiply`。素材自带浅色底时用 multiply 融回纸面 |
| `print` | **印刷化**：去色 + 提高对比 + multiply。写实渲染的素材必须打开，否则一眼是贴图 |
| `front` | 压在内文之上（做"盖住/挡住"的叙事） |

素材准备（`images.json` 里给 `"cutout": true`，跑 `cutout.py`）：

- 平底生成，主体四边留白 ≥8%，不要贴边；
- `card: N` 给元素保留 N px 的纸边（洞、缺口这类"纸片本身"必须给）；
- 抠图用 flood fill 从画布四边泛洪，再腐蚀 + 羽化 alpha，最后按投影留 pad 裁切。

坠落曲线（`fall`）的两个硬约束：下沉位移必须**小于洞的开口**（否则元素滑到纸面上，
半透明压着纸读起来像穿帮），"进去"由缩小（-62%）和提前淡出（55%-90%）承担。

## 红笔批注层（`NoteLayer.tsx`）

画面只剩"大字 + 底纹"时，看着还是像一页幻灯片。让它变成"有人研究过的一页纸"的，
是**手写上去的记号**：圈关键数字、箭头指过去、量线标宽度、橡皮章压结论。

```jsonc
"visual": {
  "kind": "stat",
  "annotations": [
    { "kind": "circle", "x": 33, "y": 48, "w": 620, "h": 360, "rot": -4, "at": 1.0 }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `kind` | `arrow` / `circle` / `measure` / `tag` / `stamp` / `shape` |
| `x` / `y` | **画幅百分比**（0-100）。圈=圆心、箭头/量线=起点、标签/印章/图形=中心 |
| `w` / `h` | 像素。圈=直径、箭头/量线=位移、`shape`=边长；`tag`/`stamp` 不用 |
| `rot` | 度数，±60 以内；圈和印章给 -2 到 -8 度最像手画 |
| `text` | `tag`（≤6 字）/ `stamp`（≤4 字）/ 量线标签 |
| `shape` | `shape` 用：`square` / `circle` / `triangle` / `reuleaux` / `hex` |
| `at` | 拍内出现秒数，默认 0.6；多个批注不写会按 0.18s 自动错开 |
| `color` | `red`（默认）/ `ink`。ink 用于不想抢戏的补充线 |

规则：

- **笔画是画出来的，不是淡入**：12-14 帧从起点长出去，和旁白落在同一个词上。
- **红线只在空旷处**。批注压在主字上，读者会先看线不看字；圈要把目标整个包进去，
  圈边从字和字之间穿过去（`x/y/w/h` 自己量一下）。
- `y > 78%` 会落进字幕带，preflight 会提醒。
- `shape` 用的是 `CompareSplit` 里同一个 `ShapeMark`（网点 + 黑描边 + 红色偏移剪影），
  保证"剪出来的形状"全片只有一种画法。
- **别用批注当装饰撒满每一拍**。它解决的是"这块版面空得不像话"，
  信息本来就满的拍（compare / cards）不加。

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

React 侧（hook）在 `src/components/BeatPresence.tsx`；纯函数（对齐、强调匹配）
在 `src/words.ts`——它不依赖 React，`scripts/selftest.py` 的 node 套件直接测这一份。
写新组件时按需从这两处取。

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

两侧都会先剥掉标点再匹配：上屏词按旁白拆分（`"有一种三角形，"`），
而 edge-tts 的词流只有实字。全片每个镜头开头的文字卡点都吃这条规则，
改动它等于改全片的对位。

### `makeEmphasisMatcher(emphasis?)`

返回一个 `(word) => boolean`，支持包含匹配。

### `useStage()`

返回 `{width, height, pad, maxWidth}`。`pad` 是 8.5% 的安全边距。
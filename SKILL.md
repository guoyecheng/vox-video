---
name: vox-video
description: 用 Remotion + Edge TTS 把中文旁白稿做成 VOX 风格的解说视频（fast-paced explainer：大字动态排版、数字卡片、时间轴、金句卡、配音与画面逐词对齐）。只要用户提到做解说视频/科普视频/动画视频/口播视频/解释型短视频、或提到 Remotion 配旁白、把文稿变成视频、给视频加配音和字幕、用 ComfyUI 给视频生成配图/素材图，就使用这个 skill —— 即使用户没说"VOX"或"Remotion"这几个字也要用。它同时负责从选题到成片的全流程：写稿→切 beat→TTS 配音→按音频真实时长生成时间轴→生成场景代码→渲染 MP4。**配音和渲染前会先停下来等用户确认，不会自己一路出片。**
---

# VOX 风格解说视频生产线

把一段中文旁白稿变成一条 VOX 风格的解说视频：画面跟着旁白逐词跳动，节奏紧凑，60-90 秒讲清一件事。

## 最重要的一条：以音频为时钟

**永远不要手写 `durationInFrames`。**

一个模型在没被告知这件事时，最自然的做法是打开 `Root.tsx` 填 `durationInFrames={120}`，然后给每个场景编一个时长。结果一定是坏的——画面和配音会逐渐错位，到片尾已经差了两三秒，而且这种错误在预览单帧时完全看不出来。

所以本 skill 的所有工作都倒过来做：

```
旁白稿  →  逐 beat 合成 mp3  →  用 ffprobe 量真实时长  →  timeline.json  →  场景代码
                ↑                                        ↑
         你唯一真正写的东西                    帧数从这里自动长出来
```

`durationInFrames` 是**测量结果**，不是**设计决策**。时间轴由音频推导，你只负责决定"这一句配什么画面"。

推论：想调整节奏时，改的是 `script.json` 里的 `rate`（语速）和 `padAfter`（每个 beat 后留多少气口），然后重跑 TTS。**不要去代码里改帧数**——那会立刻让音频和画面对不上。

## 两条确认闸门（不可跳过）

这个 skill **不会自己一路跑到成片**。有两处必须停下来，等用户明确点头。

| 闸门 | 停在哪 | 用户要确认什么 |
|---|---|---|
| **A 稿子** | `script.json` 写完、事实核完，**跑 TTS 之前** | 选题角度、beat 切分、旁白措辞、每个数字和出处 |
| **B 画面** | `timeline.json` 生成后，**整片渲染之前** | 抽帧画面、字幕、转场、节奏 |

### 闸门 A：先给分镜和事实，再配音

写完 `script.json` 就停。给用户看这四样：

- 一句话题目 + 时长预估（各 beat 旁白字数 ÷ 语速）
- beat 表：`id` / 画面类型 `kind` / 旁白第一句
- **所有具体数字、年份、人名、引述的出处**；拿不准的单独列出来问
- 打算用的镜头类型分布（避免全片 `kinetic`）
- 需要配图时，`images.json` 的**提示词清单**（见[素材图](#素材图comfyui)）

然后等回复。用户明确说可以，才跑 `npm run tts`。

**为什么必须停：** TTS 一跑完，旁白就固化成音频了。改一句话要重跑整条时间轴，
所有依赖词级时间戳的动画都会跟着变。稿子阶段改一个字是几秒钟的事。

### 闸门 B：先看静帧，再渲染整片

`timeline.json` 出来后，**按 beat 抽一帧**，逐张看过再决定。用脚本抽，别手数帧号：

```bash
python "<skill>/scripts/stills.py" --project "<项目>" --sheet
```

它按 `beat.from + 30`（默认）给每拍抽一张，存到 `out/stills/seq/`，再拼一张
HTML 联络表（`out/stills/sheet.html`，浏览器直接开，每格下面标着拍号/帧号/类型）。
想看每拍出场那一刻加 `--tail`；只想看某几拍用 `--beat tumu,gate`；
先看计划不渲染用 `--list`。

逐张看过再决定：

- 有没有文字溢出、重叠、被裁
- 字幕是否压住主体
- 转场是否落在正确的接缝上
- 数字、单位、标签有没有错
- 配图是否切题、风格是否一致、**画面里有没有冒出文字或错字**

把这几张静帧（或联络表的路径）给用户看，等确认后再跑整片渲染。

整片渲染是几分钟到几十分钟的机器时间，抽一帧是几秒钟。
**先抽帧再渲染，永远比渲完发现错字再重来快。**

注意三个自检脚本的时机：`check_rhythm.py` 和 `preflight.py` 只读脚本和源码，
**在闸门 B 之前跑**；`verify_sync.py` 要读成片音轨，**只能在渲染之后跑**，
不要为了它提前渲染。

### 什么才算"用户确定"

- 只有用户**明确表态**才算：`可以`、`继续`、`开始配音`、`渲染吧`、`没问题`
- 用户沉默、只回答了别的细节、说"先这样"——**都不算**
- 用户说"你自己看着办""不用问我了"——算**一次性豁免**，只对这一次生效，下次照旧要问

| 借口 | 现实 |
|---|---|
| "稿子明显没问题，先配音省一步" | 用户要的是他的判断，不是你的。等他一句话成本是零 |
| "用户已经说了想做成视频" | 想做 ≠ 认可这一版稿子。选题授权不等于分镜授权 |
| "我先渲一版给他看效果" | 渲染几分钟，改稿几秒钟。顺序反了 |
| "抽帧太麻烦，渲完再检查" | 渲完发现错字要整条重来；抽帧 5 秒就能看出来 |
| "上次他没提意见，这次也一样" | 每次都是独立的一次确认 |

**红色信号——出现任意一条就停下：**

- 你正准备跑 `npm run tts`，但还没把 beat 表发给用户
- 你正准备跑 `remotion render`，但还没抽帧给用户看
- 你在想"先渲出来再一起说"
- 用户只回了一个"嗯"，或只回答了你问的别的细节

## 目录

- [确认闸门](#两条确认闸门不可跳过) — **配音和渲染前必须停下**
- [五个阶段](#五个阶段) — 完整流程
- [写 script.json](#写-scriptjson) — 你唯一要手写的文件
- [分镜节奏](#分镜节奏-vox-的命门) — 多长一个 beat、什么时候换画面（弧库见 `references/arcs.md`）
- [选视觉组件](#选视觉组件) — 15 个组件覆盖 90% 场景
- [素材图（ComfyUI）](#素材图comfyui) — 可选，自动出配图；风格预设 + bake-off 选风格
- [转场与特效](#转场与特效) — 别让整片一个节奏（运镜层 / 程序化特效）
- [配乐](#配乐) — 配乐 + 按旁白自动让路（ducking）
- [自检](#自检) — 单调 / 不同步都能自动查出来
- [渲染](#渲染)
- [踩坑速查](#踩坑速查)
- 参考文件

---

## 五个阶段

### 1. 立项目

```bash
node "<skill>/scripts/scaffold.mjs" --slug <英文短横线名> --out "E:\AI\视频制作"
```

会复制模板工程到 `E:\AI\视频制作\<slug>\`，并装好依赖。依赖里有 Remotion 自带的 ffprobe，后面量音频时长要用。

**首次装依赖约 4 分钟**，请后台跑，别干等。已经装过的项目可以 `--from <已存在的项目路径>` 复用它的 `node_modules`（秒级完成）。

### 2. 写稿 + 分镜 → `script.json`

文件在 `<项目>/script.json`。这是**唯一**需要你动脑的文件，结构见 `assets/script.example.json`。

**动笔之前先确认事实。** 解说片的说服力来自具体数字，而具体数字也最容易编错或想当然：

- 拿不准的数字要么去查（WebSearch/WebFetch），要么**从稿子里删掉**，不要写一个"看起来合理"的值
- 引述的 `attribution` 只写**真实存在**的来源。拿不到来源就把这条从 `quote` 改成 `kinetic`，让陈述本身承担说服力
- `source` 字段（IEEE 802.11、NASA/JPL 这类）同样要核实，错误的出处比没有出处更糟

配音一旦生成，观众听到的就是确定的事实陈述，没有任何"大概"的空间。

**写完先体检**（秒级，比渲完才发现省几分钟）：

```bash
npm run preflight          # 等价于 python "<skill>/scripts/preflight.py" --project .
```

它查 id 重复、kind 拼错、缺必填字段、图文件不存在、层少 `y`、枚举值写错、字体缺失、
弧名不合法、`camera`/`vfx` 写错、配乐文件不存在。有错先改，别去配音。

**写稿之前先选一条叙事弧**（`arc` 字段）。弧决定 beat 的**顺序和形状**，
组件决定 beat 的**长相**——两件事分开想。14 条弧、拍数数字表、hook 句式库、
反单调清单见 **`references/arcs.md`**。

**每一拍还要定两根轴**（写进 `script.json`）：

| 轴 | 字段 | 管什么 |
|---|---|---|
| 轴一 | `visual.camera` | 整幅怎么动：`push_in`/`pull_out`/`pan`/`tilt`/`parallax`/`whip`/`static` |
| 轴二 | `visual.elementMotion` | 画面里什么在动（写给实现看，也是反单调的检查项） |

只做轴一，画面还是死的；只做轴二，镜头是死的。**相邻两拍的 `camera` 不要重复**。

最小形态：

```json
{
  "title": "旅行者一号为什么飞了 47 年",
  "voice": "zh-CN-YunjianNeural",
  "rate": "+12%",
  "beats": [
    {
      "id": "hook",
      "narration": "1997年7月4日，一枚只有3.8公斤的探测器发射升空。",
      "visual": {
        "kind": "kinetic",
        "words": ["1997年7月4日", "一枚只有3.8公斤的探测器", "发射升空"],
        "emphasis": ["3.8公斤", "发射升空"]
      }
    },
    {
      "id": "cost",
      "narration": "它花了47年，才飞到太阳系的边缘。",
      "visual": {
        "kind": "stat",
        "value": 47,
        "unit": "年",
        "label": "飞行时间",
        "source": "NASA/JPL"
      }
    }
  ]
}
```

两个字段值得特别说明：

- **`narration` 和 `visual.words` 高度重叠是正常的，而且是故意的。** TTS 是按 `narration` 合成的，词级时间戳也是按它切出来的。`visual.words` 用同样的词，才能让"旅行者一号"这四个字恰好在旁白念到它的那一帧弹出来。如果两处词序不一致，动态排版就会和声音错位。
- **`visual.words` 可以比 `narration` 少。** 旁白可以更长更口语，画面只挑关键词上屏。多出来的音节不弹字，只是继续念——这是正常的。

> **停在这里，不要往下跑。** 按[闸门 A](#闸门-a先给分镜和事实再配音)把分镜表、时长预估、事实出处交给用户确认。拿到明确同意前不跑 TTS。

### 3. 配音 + 生成时间轴（过闸门 A 之后）

**先体检，再配音**（秒级，挡住那些"渲完才发现"的错）：

```bash
python "<skill>/scripts/preflight.py" --project "<项目>"
```

它查：id 重复、kind 写错、每种 kind 缺必填字段、`image`/`layers` 引用的文件
在 `public/` 下真的存在、层给了 `band` 却没给 `y`（远景会被中景盖死）、
`words` 不是旁白的原样片段、枚举值（`imageLayout`/`impact`/`transition`）拼错、字体在不在。
有错就先改，别配乐。`--strict` 让提醒也当失败。

体检过了再配音：

```bash
cd "<项目>" && npm run tts
```

等价于直接调用脚本（首次会自动在项目下建 `.venv-tts` 并装 edge-tts，无需你干预）：

```bash
python "<skill>/scripts/vox_tts.py" --project "<项目路径>"
```

这一条命令干三件事：

1. 逐 beat 合成 `public/audio/<beatId>.mp3`（并发最多 4 路，edge-tts 会限流；每拍失败重试 3 次）
2. 从 TTS 服务拿**词级时间戳**，转成 beat 内相对帧
3. 调 Remotion 自带的 ffprobe 量每个 mp3 的真实时长，累加出 `src/timeline.json`

产物：`public/audio/*.mp3` + `src/timeline.json`。

```jsonc
{
  "fps": 30,
  "totalFrames": 1276,
  "beats": [{
    "id": "hook",
    "from": 0,                    // 这一拍在整片里的起始帧
    "durationInFrames": 87,       // 音频实长 + padAfter，已向上取整到整帧
    "audioFrom": 6,               // 音频相对这一拍的偏移（padBefore）
    "words": [{ "t": 6, "d": 21, "text": "1997年7月4日" }]  // t = beat 内相对帧
  }]
}
```

`VoxVideo.tsx` 已经读好了这个结构，你**不需要**改它，也不需要碰 `Root.tsx` 的 `durationInFrames`（那里绑的是 `timeline.totalFrames`）。

### 4. 加视觉

如果 `visual.kind` 是现成组件，到这儿就结束了，直接去第 5 步渲染。

需要配图（`kind: "image"` 或 `visual.layers`）时，先在 `images.json` 里写提示词，
过闸门 A 后跑 ComfyUI 出图，再在 `script.json` 里引用 `img/<id>.png`。
见[素材图（ComfyUI）](#素材图comfyui)。

**先定"看的层"，再出图。** 纸艺系有 6 套风格预设（`paper` / `paper-ink` /
`paper-newsprint` / `paper-poster` / `paper-zine` / `paper-washi`），
"哪套好看"是眼睛决定的事：跑一次 bake-off，同一条 brief、**同一个 seed**、每套风格各出一张，
出一张对比表让人挑：

```bash
python "<skill>/scripts/bakeoff.py" --project . --beat shot-hook
# → public/img/_bakeoff/*.png + out/bakeoff/sheet.html
```

挑完把预设名写进 `images.json` 的 `style_preset`。

**别忘了配乐。** 音乐文件由使用者提供（放进 `public/`），`script.json` 里写
`"music": {"src": "audio/bed.mp3", "gain": 0.2, "duck": 0.6}`，
配乐会在有人说话时自动让路。见[配乐](#配乐)。

需要更复杂的画面时（比如流程图、关系图、仪表盘），按下面的清单加组件。**四个文件都要改，少一个都会 tsc 报错或运行时拿到 undefined**——这是加新组件最容易踩的坑：

| # | 文件 | 改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `src/components/YourThing.tsx` | 新组件本体 | — |
| 2 | `src/components/index.ts` | 加一行 export | import 不到 |
| 3 | `src/timeline.ts` | `VisualKind` 加类型名，**并给 `VisualSpec` 加字段** | **tsc 报错：类型不兼容** |
| 4 | `src/visuals.tsx` | import + `REGISTRY` 加一行 | `script.json` 里写这个 kind 时静默回落到 KineticText |

第 3 步最容易漏：`VisualKind` 和 `VisualSpec` 是**封闭联合类型**，不是开放结构。只往 `REGISTRY` 里塞一个新组件、却没扩 `VisualSpec`，编译就过不去。

组件签名统一是 `({beat, visual, accent, tone})`。`beat` 里带着词级时间戳，用 `resolveWordTimings` / `useBeatWords` 就能让动画卡在旁白上——**别自己按固定帧数排动画**，那样这一拍就和声音脱节了。写之前先翻 `references/components.md` 确认现有组件真的做不到，也别忘了遵守那里的布局分区（左上角标 / 左下出处 / 底边进度条）。

组件只读 `useCurrentFrame()`，**不要用 CSS transition / animation / @keyframes**——渲染是逐帧截图的，浏览器没有时间推进，CSS 动画不会动。

### 5. 渲染

```bash
cd "<项目>" && npx remotion render VoxVideo out/video.mp4
```

## 分镜节奏：VOX 的命门

VOX 视频看着"信息密度高"，本质是**剪辑节奏快**。60 秒的片子大约 10-13 个 beat，平均每个 4-6 秒。

**写稿之前先选一条叙事弧**——弧决定 beat 的顺序和形状，组件决定 beat 的长相，
两件事分开想。完整的弧库、拍数数字表、hook 句式库、反单调清单见
**`references/arcs.md`**（写稿阶段必读）。

```jsonc
{
  "arc": "chronicle",     // 选好的弧：chronicle / timeline / how_it_works / man_in_hole / myth_buster / pas / ...
  "beats": [ ... ]
}
```

| 位置 | 时长 | 作用 |
|---|---|---|
| Hook（第 1 拍） | 1-3s | 必须有一个反常识的事实或问题，把人钩住；不许铺垫 |
| 主体 | 4-6s/拍 | 一个 beat 讲一件事，不要塞两个观点 |
| Stat（数字） | 3-5s | 大数字停留要够久，观众需要时间读 |
| Quote（金句） | 4-6s | 引述要慢，让人读完 |
| Payoff | 10-20% | 兑现 hook 里那个承诺 |
| 收尾 | 0-2s | 落回 hook 提出的问题（`hard_cut` / `quick_cta` / `loop_close`） |

几条实操经验：

- **`padAfter` 默认 0.35 秒**。VOX 的画面是在旁白说完后**停半拍**才切的，这半拍是节奏感的来源。太短会显得慌乱，太长会拖。
- **一个 beat 只配一个视觉。** 想在一个 beat 里既出大字又出数字卡片，就拆成两个 beat——反正长度是量出来的，拆开不花钱。
- **`rate` 默认 `+12%`**。中文 TTS 默认语速对解说视频偏慢，加 10-15% 才有 VOX 那种紧凑感。超过 `+20%` 中文会开始吞字。
- **无声 beat 是合法的**（`narration: ""`）。纯视觉留白（比如放一张图配环境音）节奏上很有用。
- **开头别铺垫。** 第一个 beat 直接给最反直觉的那个事实。

**每拍还要定两根轴**：`visual.camera`（整幅怎么动：push_in / pull_out / pan / tilt /
parallax / whip / static）和 `visual.elementMotion`（画面里什么在动）。
只做镜头运动画面还是死的，只做元素运动镜头是死的——**两根轴分开想**。
相邻两拍的 `camera` 不要重复，这是最省力的反单调手段。词表见 `references/arcs.md`。

## 选视觉组件

| 组件 | `kind` | 什么时候用 |
|---|---|---|
| `KineticText` | `kinetic` | 大字逐词弹出。默认首选，但**一整片别超过 4 拍连续用** |
| `StatCard` | `stat` | 巨大数字 + 计数动画 + 单位 + 出处 |
| `Odometer` | `odometer` | 机械逐位计数。数字本身在**跳**的时候比平滑计数更有张力 |
| `Chart` | `chart` | 柱状 / 折线 / 环形。多组数据的量级对比 |
| `Highlight` | `highlight` | 荧光笔划线 + 手绘圈注。在**文字**上标重点（`Callout` 是在图片上） |
| `Split` | `split` | 2–4 格并排。同层级的并列信息，每格一个短标题 |
| `Stack` | `stack` | 累积墙。逐项叠加增长的量（逐年、逐级） |
| `Person` | `person` | 人物：肖像 + 姓名 + 身份年代 + 关键台词 |
| `Route` | `route` | 地图/路线：行军、迁移、势力范围，点位跟着旁白依次点亮 |
| `Callout` | `callout` | 画面圈注：箭头 + 圈 + 标签，把静态图变成被讲解的图 |
| `QuoteCard` | `quote` | 引述、金句、他人观点（自动压深色底） |
| `CompareSplit` | `compare` | A vs B、前后对比、两个方案的取舍 |
| `TimelineRail` | `timeline` | 按时间推进的历史、里程碑、流程 |
| `CardStack` | `cards` | "三个原因"这类并列要点 |
| `ImageCard` | `image` | 配图 + 说明文字（图片放 `public/img/`） |

另有一层**常驻字幕轨** `CaptionTrack`，不由 `kind` 控制：`script.json` 里
`"captions": true`（默认）就显示，跟着旁白逐句切换，不参与转场交叠。

**配图层是全部 `kind` 通用的**：`visual.image: "img/xxx.png"` 把一张图铺满全幅、
盖一层纸浆（`imageWash`，浅色拍默认 0.42 / 深色拍 0.55），内容照常压在上面——
卡片、文字本来就是贴在这张纸上的东西。适合**注解类**拍（`cards`、`kinetic`、`person`）。

**符号类**拍（`route`、`chart`、`timeline`、`split`）要配图就用
`"imageLayout": "inset"`：图会变成一张白边照片，角贴在右侧 41% 宽的位置，
两段胶带粘住，地图/图表留在左半幅。满幅图不能给这些拍——图是"场景"、
组件画的是"符号"，两层隐喻会互相拆台（实测北伐路线压在行军插画上，
路线读成了"地上的一道线"，点位标签还和画里的人物打架）。`Route` 在 `inset`
下会自动把点位压到左侧 46%，其它符号组件要自己收进左半幅。

有配图的拍会自动关掉 `AmbientLight`——那两块 accent 色斑压在照片上就是一层品红滤镜。

> `image` 生效需要重跑 `npm run tts`：Remotion 读的是生成物 `src/timeline.json`，
> 不是 `script.json`。改完脚本没重新生成，会看到画面毫无变化。

完整 props、字段和可调参数见 `references/components.md`。

**"单调"几乎不是组件不够，而是没人管重复度。** 十五种组件摆在那里，
写稿时凭感觉挑，最后 `kinetic` 用六次、其中连续三次——整片一个节奏。
`scripts/check_rhythm.py` 会把这件事变成可测的数字（见下）。

## 纸艺拼贴视觉层（`paper.tsx`）

整套视觉是**定格纸艺拼贴**：底纸是旧牛皮色的桌面，内容是剪下来、贴上去的纸片。
这不是"加个纹理"，它决定三件事——纸片要有边、要有影、要歪；镜头是缓慢推近的，
纸张在空气里极慢地漂，尘埃在镜头前上浮。

| 工具 | 干什么 |
|---|---|
| `PaperSheet` | 一张纸。自动毛边（`clip-path` 多边形）+ 三层影 + 轻微旋转 + 缓慢漂移 |
| `Tape` | 半透明胶带，贴在纸角上（贴两角，四角全贴像信封） |
| `roughEdge` | 毛边多边形。`amp` 单位是 **px**，不是百分比——百分比抖动在大元素上会变成缺口 |
| `sway` | 缓慢漂移（低频正弦）。整幅、大面积一律用它，6px / 240 帧起步 |
| `jitter` | 定格抖动（每 `hold` 帧换一次位置）。只给个别小标签，**整幅禁用** |
| `fiberStyle` | 纸纤维点阵。幅度必须极低，见下方"帧差" |

**五条硬规矩：**

1. **底纸要比纸片深一档。** 底纸 `COLORS.stage`（#E9E2D2）vs 纸片 `PAPER.sheet`（#FFFDF6）。
   两者都接近白时整幅糊成一片米白，纸的边界消失，帧间差也跟着掉 15%。
2. **投影只能放在背景层。** `PaperSheet` 的影是背景层上的 `filter: drop-shadow`：
   `box-shadow` 会被 `clip-path` 一起裁掉；放在外层容器上则卡片里每个字都投一道 16px 的影。
3. **不要用 `mix-blend-mode`。** 它和祖先元素的 `transform`（漂移层、缩放层）一起会触发
   Chromium 的合成层缓存 bug，成片里留下前几帧的**残影**（文字横向叠成三四个）。
   `LightSweep` / `AmbientLight` 都已改成普通 alpha 叠加。
4. **深色拍不放纸屑、纸纤维压到 0.14。** 浅色纸屑压在夜里会变成一块发灰的方块。
5. **曝光要呼吸，但整幅不许跳。** `PaperStage` 顶层有一层 0.4%-2.0% 的黑（深色拍是白）
   每 3 帧换一次值，模拟定格每拍一格的曝光误差；加上 34 粒缓慢上浮的纸屑尘埃。
   这两样是"整幅一直在变"的全部来源，**不要用整幅位移去凑**——见下。

> **别整幅用 `jitter()`。** 它每 2-3 帧跳一次位置，单片纸看着像定格动画，
> 但整幅 + 几十个元素同时跳，眼睛读到的是"画面一直在抖"。整幅运动只有两种可接受的形式：
> **低频正弦漂移**（`sway()`，6px / 240 帧，读作纸张在呼吸）和**慢推近**（`ambient`）。
> 小标签可以留一点 `jitter()` 手工感，整幅和卡片不要。

**动效语言只有四种，全部连续、可复现、由代码驱动：**

| 层 | 实现 | 幅度 | 读作 |
|---|---|---|---|
| 漂移 | `sway()` 低频正弦 | 6px / 240 帧，0.06° / 300 帧 | 纸张在缓慢呼吸 |
| 粒子 | `MOTES`（34 粒纸屑尘埃） | 上浮 0.008-0.03 %/帧，明暗 0.06-0.15 | 空气里有东西 |
| 推近 | `visual.ambient` | soft 1.8% / normal 3.2% / strong 4.8% | 镜头在走 |
| 元素级 | `floatAt()` + 组件自己的入场/计数/画线 | 3-8px / 60-100 帧 | 这一拍在讲什么 |

配图另有两种慢动作：整幅图 1.01-1.022 的极慢缩放、角贴照片 3px / 210 帧的独立滑移。

**面积决定观感**：同样 2px，在小标签上是"手工感"，铺满全幅再加几十个元素就是"手抖镜头"。
这就是为什么定格抖动的参数只能给局部用。

**背景不是空的：** 账册格线（96px，`COLORS.ink` 13% 透明度）铺满全幅，它和纸屑、纸纤维
一起被包在**漂移层**里（整张底纸作为一个实物在缓慢移动），只有边缘压暗留在外层。
1px 的格线在整个画幅上缓慢爬行——这是画面上唯一铺满全幅的高频硬边，
薄信息量的拍（`timeline`、`person`）全靠它和纸屑尘埃撑住"画面还在动"。

## 素材图（ComfyUI）

配图是可选步骤：没有 ComfyUI 也能出片，`ImageCard` 会退化成斜纹占位板。

三步：

1. 在项目根目录写 `images.json`（参照 `assets/images.example.json`）。**一镜一条**，
   用 `scene` 逐镜 brief 而不是一句 prompt——顺序固定为
   `camera → subject → environment → materials → light → color → text`，
   写法与 vox-full-pipeline 的 MG-VOXSTAGE 分镜一致。`style_preset` 全片只写一份
   （默认 `paper` 纸艺拼贴，换 `vector` 是扁平编辑插画）。
   一拍要拆成几层就写几条（每层一条，`id` 加后缀 `-far` / `-mid` / `-near`）。
   **`scene.text` 是白名单**：不写字就留 `[]`，脚本会补"画面内不出现任何文字"；
   填了字就只许出现那几个字。蒸馏模型（Z-Image / FLUX）cfg=1.0，负向提示词不生效，
   文字只能靠这条白名单管住。
2. `--check` 核对服务与模型，`--dry-run` 看拼好的提示词（**出图前给用户过一遍**）。
3. 出图到 `public/img/<id>.png`，在 `script.json` 里给需要配图的那一拍写
   `"image": "img/<id>.png"`（不是 `src`，`src` 只给 `kind: "image"` 用），重跑 `npm run tts`。

```bash
python "<skill>/scripts/comfy_gen.py" --check --project "<项目>"
python "<skill>/scripts/comfy_gen.py" --project "<项目>" --dry-run
python "<skill>/scripts/comfy_gen.py" --project "<项目>"
```

尺寸默认 `1536×864`（`ImageCard` 是 16:9 + `objectFit: cover`）。seed 和最终 prompt 写进
`public/img/_generated.json`，同一份清单重跑可复现。

#### 风格预设：同一部片子可以换"看的层"

`images.json` 里的 `style_preset` 决定生成的图长什么样。内置：

| 预设 | 样子 |
|---|---|
| `paper`（默认） | 厚纸多层拼贴、柔和投影、纤维质感 |
| `paper-ink` | 宣纸水墨，焦墨淡墨分层次，朱砂点染 |
| `paper-newsprint` | 旧报刊：米白 + 深红 + 芥黄，半调网点、套印偏移 |
| `paper-poster` | 复古宣传画：红黑米白三色油墨，强对角几何 |
| `paper-zine` | 朋克复印：黑白噪点 + 一个荧光色，粗黑描边 |
| `paper-washi` | 淡雅和纸：浅灰蓝 + 极淡赭色，留白多 |
| `vector` | 平面矢量插画（不是纸艺） |

**选风格让人来挑，不要让模型一次定死。** 用 bake-off：

```bash
python scripts/bakeoff.py --project . --beat shot-hook
# → public/img/_bakeoff/*.png + out/bakeoff/sheet.html
```

同一条 brief、**同一个 seed**、只有风格不同——这样挑出来的是"这套风格好"，
不是"这张运气好"。挑完把预设名写进 `images.json` 的 `style_preset`
（全局）或某一条的 `style_preset`（单条覆盖）。

### 分层背景板（景深）

整幅配图是一张"印在纸上"的画，只有一层。要有景深就把场景**拆成几张背景板**，
每张只负责一层，代码按不同速度推它们 —— 这是这套管线里最接近真 MG 舞台的做法。

```jsonc
"visual": {
  "kind": "kinetic",
  "imageWash": 0.2,
  "layers": [
    { "src": "img/far.png",  "depth": 0.05 },
    { "src": "img/mid.png",  "depth": 0.55, "band": 0.62, "y": 0.38 },
    { "src": "img/near.png", "depth": 1,    "band": 0.24, "y": 0.76 }
  ]
}
```

- `depth` 0→1：视差系数。远层几乎不动（系数 0.14），近层跟着底纸走（1.04）。
- `band`：这层只露出原图**底部**那条带（0-1），顶边自动裁成撕纸毛边。
- `y`：这条带落在画面的什么位置（0-1，从上到下）。**没有 `y` 这层就废了**——
  所有带都会堆在底部，远景被中景盖住。
- `imageWash`：整叠图的纸浆覆盖，默认 0.26（比单张图浅，否则景深全被洗平）。

**出图时的硬规矩：内容必须落在原图底部那条带里。** 裁切是从下往上取的，
提示词要写"主体全部位于画面下方 X%，上方是空白米色纸（会被裁掉）"。
否则旗帜、人物的头会被水平切断。

三层的光源方向、纸张色调必须一致（同一份 brief 的 `light` / `color` 复制过去），
否则叠起来像三张不同的画。实测两拍分层后帧均差大幅上升（土木堡 3.24 → 4.63、
煤山 4.61 → 7.19），因为每层各自在动——这是比"整幅抖动"干净得多的活力来源。

**层也可以整幅用**（不给 `band`）：一张自成体系的构图（满幅一面纸墙 + 一棵纸剪树）
当背景，前面再叠一条近景纸带，景深照样成立。

**不是每拍都适合上图**：
- `person` 拍的圆形剪影在画面左侧中段，横着的背景带会把它拦腰截断 →
  这种拍用整幅背景，或把带压到 `y ≥ 0.72`，或干脆不用。
- 大数字拍（`stat`）留白最好，别加图。
- 主体在原图**中间**的图（城墙正好在中间、脚下还有别的颜色）没法靠裁切救：
  裁切只能从底部取。要么改 brief 让主体落在底部，要么重出。

**`image` 和 `layers` 可以同时给**：`image` 当最底的一张（`full` 时铺满），
`layers` 叠在它上面。这样"角贴照片 + 分层背景"能共存——比如路线拍：远处山脊一条带、
右侧角贴一张照片、路线走左侧。`inset` 的照片本来就画在内容层下面，天然压在层之上。

一次全片铺满背景板的实测：13 拍里 11 拍接上图或分层，全片帧均差 3.02 → **3.74**，
最薄的几拍提升最大（时间轴 1.84 → 3.42、山海关 3.70 → 6.00、煤山 4.61 → 7.28、
土木堡 3.24 → 5.19、北伐路线 2.51 → 3.05），文件还小了
（59.6MB → 55MB，图替掉了大片平涂纸面）。留白不动的两拍是大数字和圆形人像。

**换模型**分两种：同架构只改 `assets/comfy/models.json` 加一组文件名；换架构再加一份
API 格式工作流，模型组里的任意字段都能当占位符用（`{{ckpt}}`、`{{lora}}`…）。
`--models` / `--workflow` / `--preset` 可临时覆盖清单。步骤和占位符表见 `references/comfyui.md`。

**内容规矩：** 默认不让模型画文字（要画只能走 `scene.text` 白名单）；历史题材走插画/象征，
不做"伪史料照片"；真实人物不做写实脸。

**默认模型 Z-Image-Turbo**（Apache 2.0，可商用，1536×864 约 38 秒）。
另有 FLUX schnell GGUF（Apache 2.0，108 秒，容易写实化）和 Qwen-Image 2.1
（**不可商用**，只作对照）。商用片子不要选 Qwen。

**Intel Arc 注意：** 本机 XPU 后端跑 SDXL 会 `DEVICE_LOST` 并让 ComfyUI 执行器卡死，
不要碰 SDXL。细节见 `references/comfyui.md`。

## 转场与特效

转场让相邻两拍交叠，**这是纯视觉决策，不影响旁白**——音频按实测位置绝对
摆放，永远不参与交叠。所以转场可以随便调，改完重跑 `npm run tts` 即可。

但要注意：`TransitionSeries` 每加一个 `te` 帧转场，后面所有拍的画面都会整体
提前 `te` 帧，音频不会。所以 `from` 必须记在**视觉时钟**上（每拍推进
`durationInFrames - 下一拍 transitionFrames`），音频再跟着这个 `from` 摆。
写成音频时钟的后果是：越往后画面越早、片尾留一段没有画面的空白——而且
`verify_sync.py` 查不出来，因为它只比字幕和音频。`vox_tts.py` 已经这么算了，
手改 `timeline.json` 时别把这条丢掉。

在 `script.json` 里给每一拍指定**进入这一拍**的转场：

```jsonc
{
  "transitionFrames": 10,        // 全片默认交叠帧数，约 0.33s
  "beats": [
    { "id": "hook",  "transition": "none" },     // 第 0 拍没有前一段
    { "id": "second","transition": "slide" },
    { "id": "third", "transition": "filmBurn", "transitionFrames": 16 }
  ]
}
```

可选：`fade`（默认）、`dissolve`、`slide`、`pushCut`、`blurSlide`、`wipe`、
`iris`、`clockWipe`、`flip`、`bookFlip`、`crossZoom`、`zoomInOut`、
`dreamyZoom`、`filmBurn`、`ripple`、`none`（硬切）。还有别名
`default` / `push` / `cut` / `hard` / `book` / `burn`。

**按"这一对拍子之间是什么关系"选，不要随机轮换：**

| 关系 | 用 |
|---|---|
| 同类内容软切换 | `fade` |
| 话题往前推进 | `slide` / `pushCut` |
| 换时代 / 换地方 / 换维度 | `wipe` / `iris` / `clockWipe` |
| 翻到下一章 | `flip` / `bookFlip` |
| 灾难、战乱、崩盘 | `filmBurn` / `ripple` |
| 同类型连续内容 | `none`（硬切反而比淡入淡出利落） |

> **`dissolve` 不是"软溶解"。** 在 Remotion 4.0.535 里它是按**亮度**算的烧灼
> 转场（默认 spread `#ff0000` / hot `#e6e633`）：亮度一致的区域会**整片同时**
> 烧起来。我们的画面是平涂纸面，亮度几乎一致 → 整幅闪一记橙色，像渲染错误
> （实测 12 帧转场第 10 帧是全屏橙黄）。想要"不惹眼的软切换"用 `fade`；
> `dissolve` 只适合有真实明暗层次的实拍图。

**一个接缝只用一式，不要叠加。** 甩镜糊段里再加闪白会被读作穿帮。

每拍还可以挂特效层：

```jsonc
"visual": {
  "kind": "kinetic",
  "impact": "heavy",   // "soft"(默认) | "medium" | "heavy" —— 镜头推近+抖动
  "flash": true,       // 闪白 3 帧
  "sweep": true,       // 光带扫过
  "ambient": "normal"  // "off" | "soft" | "normal"(默认) | "strong" —— 常驻运动
}
```

**`impact`/`flash` 作用于整画面层，全片合计 ≤3 处，且相邻两处间隔 ≥3 拍。**
逐词的小反应（字弹一下、卡片落一下）是元素层，可以密集；整层震屏会让观众
疲劳。`check_rhythm.py` 会替你数。

### 运镜层（`camera`）—— 轴一

`camera` 管的是**整幅怎么动**（背景 + 内容一起动），`elementMotion` 管的是
**画面里什么在动**。两根轴分开想：只做运镜画面还是死的，只做元素运动镜头是死的。

```jsonc
"visual": {
  "kind": "cards",
  "camera": "pan",                    // 轴一
  "elementMotion": "卡片依次落位"      // 轴二
}
```

| 值 | 效果 | 什么时候用 |
|---|---|---|
| `push_in` | 缓慢推近 | 默认 |
| `pull_out` | 缓慢拉远 | 揭示、收束 |
| `pan` | 横移 | 横向扫过一组并列的东西 |
| `tilt` | 纵移 | 纵向扫过 |
| `parallax` | 带层差的横移 | 有前景遮挡物的画面 |
| `whip` | 快速甩镜 + 方向性模糊 | 换章、卡点，**慎用**（会切边缘） |
| `static` | 不动 | 点题段、留白段 |

**相邻两拍的 `camera` 不要重复**——这是最省力的反单调手段。整片的拍数、弧、
hook 句式见 `references/arcs.md`。

> **幅度都刻意压得很小**：排版已经吃掉 90% 的画幅宽度，推近超过 4% 就切字。
> 平移类（`pan`/`tilt`/`parallax`/`whip`）靠**放大留出血**实现（1.06-1.2×），
> 平移绝不能靠仿射位移硬凑，否则会露出画布外的黑边。
> 角标和章节进度条**不参与运镜**——它们是屏幕上的 UI，不该被镜头甩走。

### 元素级动效：碎片拼贴（`pieceBase` + `pieces`）

比整幅运镜更"有戏"的一招：把一张纸艺图切成几块，**飞进来拼回原图**。适合
"撕裂""重建""拼回来""被切开"这类句意，也适合给一张信息密度高的图找一个
不用镜头也能动的动法。

```jsonc
"visual": {
  "pieceBase": "img/shot-knife.png",   // 底图；和 image 互斥（否则底图画两遍）
  "pieces": [
    { "x": 0, "y": 0, "w": 0.551, "h": 0.509, "enter": "fly_left", "at": 12, "depth": 0.62 },
    { "x": 0.551, "y": 0, "w": 0.449, "h": 0.509, "enter": "fly_right", "at": 17 },
    { "x": 0, "y": 0.509, "w": 0.551, "h": 0.491, "enter": "fly_up", "at": 22 },
    { "x": 0.551, "y": 0.509, "w": 0.449, "h": 0.491, "enter": "pop", "at": 27 }
  ]
}
```

- `x/y/w/h` 是**画幅比例**（0-1），`at` 是**拍内帧**。`enter` 六种：
  `fly_left`/`fly_right`/`fly_up`/`drop`/`slap`/`pop`。`depth`（0-1）决定
  投影和前后遮挡，`spin`（度，±3 以内）给一点手抖。
- **四块正好铺满 = 飞进来拼成一张完整的图**；留出缺口 = 一直有个洞（想留"缺失感"才这么做）。
- 切的位置最好压在画面里本来就有的**接缝/裂口/分割线**上，块飞起来时那条线就
  是"撕开的口子"；切在干净的地方会看到一条突兀的直线。
- **放在内容占幅小的拍上**（`kinetic` / `stat` / `quote`）。`compare`、`split`
  这类组件铺满画幅、纸片又不透明，会把拼装整个挡在下面——实测两栏卡片让
  左半幅的块完全看不见。
- 图必须 **16:9**，否则会被拉伸。
- 想上**自由形状**的抠件（不是矩形）才需要抠图模型，见 `references/comfyui.md`。

> 为什么不直接抠图：BiRefNet / RMBG 是真实照片训的，平涂纸艺图的撕边和纸底色
> 会被吃掉。切矩形是像素级精确的——拼回去一个像素不差。

**这条路有两个静默坑**（都实测过，详见 `references/components.md`）：
CSS `mask-image` 塞 data-URI 和内联 SVG `<mask>` 在本机 Chromium 里都**不生效
也不报错**，正确写法是 `clip-path: path(evenodd, ...)`；四块精确拼满会漏出
一像素纸色的直线，必须让块间重叠 `PAD = 0.004`。

### 程序化特效（`vfx`）

```jsonc
"visual": { "vfx": "confetti" }   // "none" | "confetti"(纸屑雨) | "starburst"(冲击放射)
```

- `confetti`：**撒在最上层**。小纸片边翻边落，一拍给一次就够，连着几拍都在下会吵。
- `starburst`：**画在内容下面**。放射线一亮，观众先看到线、再看到字（实测），
  所以透明度必须压低（0.42），画在文字层之下。

### 常驻运动层（`ambient`）

模板给每一拍自动套一层**不会停**的微运动：匀速推近 + 低频漂移 + 入场动量 +
漂移光。目的是消灭"组件入场后归位静止"造成的死帧——这是本管线最容易翻车
的地方（实测改版前静止帧占比 83%，观感就是 PPT）。

三档幅度：`soft` 1.8% / `normal` 3.2% / `strong` 4.8% 推近。

> **推近有 4% 的硬上限。** 满宽排版（`kinetic` 一行 11 个字、`highlight` 的圈注框）
> 已经吃掉 90% 以上的画幅宽度，超过 4% 就开始切字。实测 8% 会把
> "没有一个死在敌人手里"的末二字切掉。想要更强的镜头感，得先改布局留出血，
> 而不是继续调这个数。

默认 `normal`。文案极密、需要观众逐字读的拍可以调 `soft`；`image`、`quote`
这类画面留白多的拍可以上 `strong`。`off` 只在你确实要"定帧"时用。

> **别指望这一层救动效。** 它只能消掉"完全不动"的死帧，不能让画面变活泼。
> 真正决定观感的是组件自己的元素级动作（词级入场、计数、画线、卡片落位）。
> 想量化差距就跑 `check_motion.py`，看逐拍均差。

## 自检

三个脚本：`check_rhythm.py` 在渲染前查脚本，`verify_sync.py` 和 `check_motion.py`
在渲染后查成片。它们查的正是"肉眼看片最容易漏、也最难自查"的三件事。

### 节奏自检 —— 把"单调"变成数字

```bash
python "<skill>/scripts/check_rhythm.py" --project "<项目>" --src "<模板 src>"
```

查：视觉重复度（连续同款 / 单款占比 / 种类数）、转场重复度、
全画面冲击是否超预算、组件字号是否低于 1080p 可读下限、首拍是否像 hook。

### 同步校验 —— 验"音频是时钟"真的成立

```bash
python "<skill>/scripts/verify_sync.py" --project "<项目>"
```

从渲出的 mp4 抽音轨，与源 mp3 做包络互相关，逐拍输出误差表，并区分
**系统性偏移**（所有拍一致，可整体补偿）和**抖动**（逐拍离散，才是真问题）。

实测本管线（Remotion 4.0.535 / H.264+AAC / 1080p30）：**系统性偏移 0 帧，
逐拍抖动 ±0.02 帧**。所以这套架构是可信的。

⚠️ 这个偏移由「Remotion 版本 + 编码 + 采样率 + 容器」共同决定。
换版本或换输出参数后**必须重量一次**，别照搬结论。

⚠️ **有配乐的片子不要直接信首拍探针**：它只看能量上跳，分不清旁白和配乐，
而推荐做法正是让音乐在旁白之前淡入。测同步请用无配乐渲染（临时删掉 `music`
字段重新渲染），或只看逐拍残差的**抖动**列——报告里 `systematic_offset_frames`
是互相关量出来的，`onset_offset_frames` 是首拍探针，两个数是不同的测量。

### 动效自检 —— 把"像 PPT"变成逐拍数字

```bash
python "<skill>/scripts/check_motion.py" --project "<项目>"
```

采样 10fps、降到 192×108 灰度，量三件事：帧间平均差、九宫格变异系数
（>0.5 说明是元素在动，<0.3 说明只是整幅推拉）、**逐拍均差**。

**判定只看逐拍均差和九宫格。** "近乎静止占比"默认只打印参考值——它奖励的是
整幅像素都在变，而最廉价的整幅变化是噪声；拿它当闸门就会把片子做成颤动
（详见下面那段）。真要把它当硬闸门，显式加 `--strict`。

**改版之后要和改版之前比，绝对值说明不了问题。** 留一份旧成片，体检时加
`--baseline`：

```bash
python "<skill>/scripts/check_motion.py" --project "<项目>" --baseline out/old.mp4
```

它逐拍打出"基准 → 现在"的增减、箭头和静止占比变化，并点名**哪几拍明显变死了**
（均差掉 0.3 以上）。改一版就比一版，比盯着绝对值灵敏得多。

真正有用的是最后一项：**均差 <1.5 的拍就是"死拍"**——旁白还在说，画面已经定格。
本片实测 13 拍里 6 拍是死拍，问题一眼就定位到具体 beat 和具体组件；
补上元素级浮动、巡游元素、并把 4 个"图只占中间一块"的组件改成铺满之后，
死拍清零（全片均差 1.73 → 2.00）。

换到纸艺拼贴之后又掉回 1.78（纸比矢量平，硬边少），逐项定位到三件事：
底纸与纸片反差不足、薄拍完全没有持续变化、`maxWidth` 把纸片困在中间。
修完（底纸加深一档 + 纸片 + 里程碑改成纸片 + 姓名逐字落位）全片 **2.55**，
最薄的 `timeline` 也从 0.93 回到 1.54。**这个顺序别搞反：先看对比度和构图，
再考虑加动作。**

**"近乎静止占比"是个陷阱，先看这段再决定要不要追。** 上面这些做完，均差过线了，
但近乎静止帧仍占 74%——旁白在说的那两秒里，像素确实没变。两件事能把它压下去：

1. **把底纸也放进整幅运动**（格线、纸屑、纤维跟着内容一起走）：74% → 72%。
2. **整幅定格抖动**（每 2 帧重摆 2.5px + 0.12°）：72% → **39%**，均差 2.63 → 3.52。

但第 2 条**看起来就是"画面一直在抖"**——它靠的是大面积高频位移，观众的读数不是
"手工感"，是振动。后来改成低频正弦漂移（`sway()` 6px / 240 帧）+ 纸屑尘埃 +
整幅 0.4%-2.0% 的曝光呼吸，占比回到 **60%**，均差 3.02，画面才安静下来。

> 结论：这个指标奖励的是"整幅像素都在变"，而最便宜的整幅变化就是噪声/颤动。
> **不要拿观感去换它。** 60%-70% 在这套风格里是正常的；判死拍用逐拍均差（<1.5），
> 判"还活着"用有没有尘埃/漂移/元素动作，不要用这个百分比当 KPI。

**但幅度不是杠杆。** 把浮动振幅从 4px 翻到 8px，死拍只涨 0.1 左右——
剩下 4 拍（`timeline`、`route`、`cards`、`compare`）的问题是**构图太空**
（一张地图只占画面中间一小块），不是动得不够。这类要改布局：让主体铺满、
把留白变成内容，而不是继续加大幅度。

> **软渐变救不了帧差。** 把背景色斑漂移从 18px 加到 58px，均差只涨 0.02——
> 大面积柔光在 8bit 灰度上每像素只差 1-2 级，被整幅平均摊掉了。
> 有效的是**硬边 + 大面积**：纸片、卡片、大字块的位移与出现。

> **阈值不能照抄参考片的 15%。** 纸艺/实拍类参考片静止帧 2-9%，那是靠贴图纹理和
> i2v 元素运动撑起来的；纯平涂矢量画面，同一段运动在 192/384/960 三个采样分辨率下
> 测出来几乎一样（说明不是降采样问题），均值天花板就在 2 附近。拿 15% 去卡只会
> 永远不通过。判据请用**逐拍均差**和**前后对比**，不要用绝对静止占比。

> 它和 `verify_sync.py` 一样需要成片，所以都在**用户同意渲染之后**跑。

> **停在这里，不要往下跑。** 按[闸门 B](#闸门-b先看静帧再渲染整片)按 beat 抽帧，把静帧给用户看过、拿到明确同意，才进渲染。

## 配乐

一条人声讲解片**必须有配乐**——只有人声的话，观众听到的是"念稿"不是"片子"。

**我们没有本地音乐模型**，音乐文件由使用者提供（放进 `public/`）：

```jsonc
"music": {
  "src": "audio/bed.mp3",   // 相对 public/
  "gain": 0.2,              // 底音量 0-1
  "duck": 0.6,              // 有人说话时压低多少 0-1（0.6 = 说话时只剩 40%）
  "fadeIn": 18,             // 开头淡入帧数
  "fadeOut": 30             // 结尾淡出帧数
}
```

**让路（ducking）是自动的**：配乐在**有人说话的时候自动压低**，说完再慢慢回来。
用的是旁白的**词级时间戳**，所以让路的位置跟嘴型是帧级对齐的，不靠猜。
音量曲线是解析式的（每帧独立算），逐帧渲染可复现。

没有音乐就删掉整个 `music` 字段；`preflight.py` 会检查配乐文件在不在。

> **挑音乐的三条经验**：
> 1. **别挑有旋律记忆点的**——观众会记住旋律而不是你的旁白。要的是"垫底"不是"主角"。
> 2. **别挑节奏跟旁白打架的**。快节奏鼓组配慢速解说最难受，宁可用无节奏的 pad。
> 3. **首尾要留空间**。开头 1-2 秒没旁白时音乐先进来建立氛围，结尾留 1 秒给画面收。
>
> 音量拿不准就 `gain 0.2 / duck 0.6` 起步。`preflight.py` 会在 `gain > 0.45`
> 或 `duck < 0.4` 时提醒你。

## 渲染

```bash
cd "<项目>"
npx remotion render VoxVideo out/video.mp4              # 成片
npx remotion studio                                     # 交互预览，拖时间轴调试
npx remotion render VoxVideo out/cover.png --frame=45   # 抽一帧做封面
```

预览时重点看两件事：**每个 beat 的画面是不是在旁白开始前就位**（不该一上来就空着），以及**词是否在念到它的那一帧弹出**（差半帧无所谓，差一拍就说明 `visual.words` 和 `narration` 词序不一致了）。

## 踩坑速查

| 症状 | 原因 |
|---|---|
| 音画从片尾开始错位 | 改了代码里的帧数。改 `script.json` 的 `rate`/`padAfter` 再重跑 TTS |
| **片尾旁白被截掉几秒** | 加了转场但没让气口装得下交叠。`npm run tts` 会自动把尾部留白撑到 ≥ `transitionFrames`；若你手改过时间轴，跑 `verify_sync.py` 一眼就能看出来 |
| **画面越往后越早、片尾一段空白** | `from` 按音频时钟累加，而视觉被转场逐拍压缩。必须是 `cursor += dur - next_te`。`verify_sync` 查不出来（它只比字幕和音频），只能抽尾帧看 |
| 字弹出的时机对不上声音 | `visual.words` 和 `narration` 词序不一致 |
| **加了 `image` 但画面没变** | Remotion 读的是 `src/timeline.json`（生成物）。改 `script.json` 后要重跑 `npm run tts` |
| **配图拍整体发品红** | `AmbientLight` 的 accent 色斑压在照片上。模板已对有图的拍自动关闭；自己改过 `visuals.tsx` 的话检查那一行 |
| 整片视觉很单调 | `kinetic` 之类用太多次且连续。跑 `check_rhythm.py` 看数字 |
| **像 PPT：旁白还在说，画面已定格** | 多数是**构图太空**：图只占中间一小块，四周纯色把帧均差摊平。先让主体铺满（改布局），其次才给组件补元素级动作；`visual.ambient` 只能救"完全不动"。用 `check_motion.py` 的逐拍均差定位，<1.5 算死拍 |
| **画面一直在抖 / 整片像在颤** | 整幅用了 `jitter()`（每 2-3 帧重摆）。换 `sway()`：连续低频正弦，6px / 240 帧。面积越大越只能用连续运动；`jitter` 只留给个别小标签 |
| **画面整块发米白、纸片没边界** | 底纸和纸片都接近白。底纸用 `COLORS.stage`（比 `paper` 深一档），纸片 `PAPER.sheet` |
| **文字横向叠成三四个残影** | `mix-blend-mode` + 祖先 `transform` 触发 Chromium 合成层缓存 bug。去掉混合模式，改普通 alpha |
| **纸片没有投影 / 投影把字也复制了一份** | 影放错层了。用 `PaperSheet`：影在背景层的 `drop-shadow`，`box-shadow` 会被 `clip-path` 裁掉 |
| 画面小字读不清 | 1080p 下辅助文字 <32px、主叙事文字 <56px。`check_rhythm.py` 会扫出来 |
| `spring()` 抛 `RangeError: Frame NaN is not finite` | 传进 `spring` 的 frame 是 NaN。模板里的 `safe()` 封装已防护，自己写新组件时也用它 |
| `Malformed path data: M was expected to have numbers` | `clockWipe` / `iris` 需要画幅尺寸。无参调用时 Remotion 4.0.535 内部算出 `NaN` 半径，生成 `M NaN…` 路径而崩在渲染那一帧。模板的 `transitionFor()` 已统一喂尺寸 |
| 中文字掉字/闪一下 | 字体没等加载完。`fonts.tsx` 的 `FontGate` 用 `delayRender` 挡住首帧，新加字体记得走同一套 |
| **中文标题变成细黑体、整片像 PPT** | 用了 `@remotion/google-fonts` 只请求 `latin` 子集 → 中文静默回落到雅黑。改用 `public/fonts/` 本地字体 + `FontGate`，见 `references/troubleshooting.md` 字体节 |
| webpack 解析路径失败（错误信息巨长） | `src/components/` 下导入 `src/theme` 必须写 `../theme`，不是 `./theme` |
| 首帧闪一下 | `<Sequence>` 少了 `premountFor`。模板里都加了 30 帧 |
| ComfyUI 任务一直停在 pending、不出图 | 执行器卡死（XPU 崩溃后常见）。`curl -X POST 127.0.0.1:8188/queue -d '{"clear":true}'` 后重启 ComfyUI |
| ComfyUI 报 `DEVICE_LOST` | Intel Arc 上跑 SDXL 会打崩 level_zero 后端。换默认的 Z-Image-Turbo 工作流 |

更长的排查清单见 `references/troubleshooting.md`。

## 参考文件

- `references/components.md` — 15 个组件的完整 props、转场选型、特效层、运镜层、配乐床
- `references/arcs.md` — 叙事弧库、拍数数字表、hook 句式库、两根轴的词表、反单调清单
- `references/comfyui.md` — ComfyUI 出图：模型清单、工作流格式、XPU 已知问题
- `references/troubleshooting.md` — 渲染报错、字体、音画不同步的完整排查
- `assets/script.example.json` — 带注释的 `script.json` 完整示例
- `assets/images.example.json` — `images.json` 示例（即梦/ComfyUI 配图清单）
- `assets/comfy/` — 工作流 JSON 与模型文件名清单
- `assets/template/` — 模板工程本体（scaffold 复制的就是它，组件源码的唯一真相）
- `evals/evals.json` — 回归用例：功能、纸艺风格、防整幅抖动、分层景深、闸门行为、模板同步、叙事弧与运镜、bake-off 选风格、回灌方向

## 组件代码住在哪

组件源码的唯一真相是 **skill 的 `assets/template/src/`**，项目里的 `src/` 是它的副本。
两边会漂移——改了模板不推，项目跑的还是旧的；在项目里改了不回灌，别的项目拿不到。

用 `sync_template.py` 管这件事，别手工拷：

```bash
python "<skill>/scripts/sync_template.py" --project "<项目>" --check   # 看差异（有差异退出码 1）
python "<skill>/scripts/sync_template.py" --project "<项目>" --push    # 模板 → 项目
python "<skill>/scripts/sync_template.py" --project "<项目>" --pull --force  # 项目 → 模板（先备份）
```

共享范围：`src/**`（除 `src/timeline.json`）、`public/fonts/**`、`remotion.config.ts`、
`tsconfig.json`、`.gitignore`。
**永远不碰**：`script.json`、`images.json`、`src/timeline.json`、`public/img`、
`public/audio`、`out/`、`node_modules/`、`package.json`（里面的脚本路径是每台机器写死的）。

---

## 工具速查

| 脚本 | 什么时候跑 | 干什么 |
|---|---|---|
| `scripts/preflight.py` | 配音**之前** | 查 script.json 的错：id 重复、kind 拼错、图不存在、层少 `y`、枚举值写错、字体缺失 |
| `scripts/vox_tts.py` | 闸门 A 之后 | 合成配音 + 生成 `src/timeline.json`（帧数由音频实测推导） |
| `scripts/stills.py` | 闸门 B（渲染之前） | 按 beat 抽静帧 + HTML 联络表，`out/stills/sheet.html` |
| `scripts/check_rhythm.py` | 闸门 B 之前 | 查节奏单调、字号太小、类 CSS 动画 |
| `scripts/check_motion.py` | 渲染之后 | 逐拍均差、九宫格、静止占比；`--baseline` 跟旧版逐拍对比 |
| `scripts/verify_sync.py` | 渲染之后 | 音画同步（包络互相关），区分系统偏移和抖动 |
| `scripts/comfy_gen.py` | 需要配图时 | 出配图；`--check` 先自检服务与模型 |
| `scripts/bakeoff.py` | 定"看的层"之前 | 同一条 brief 按多套风格各出一张 + HTML 对比表，人来挑 |
| `scripts/sync_template.py` | 改了组件之后 | 模板 ↔ 项目的代码同步；`--check` 看漂移，`--push` 推到项目，`--pull` 回灌模板 |
| `scripts/scaffold.mjs` | 立项目 | 从模板复制出一个新工程 |

一条命令跑完整条线（脚本都在 `scripts/` 里，路径换成你自己的）：

```bash
python scripts/preflight.py --project .          # 1 体检
npm run tts                                       # 2 配音 + 时间轴
python scripts/stills.py --project . --sheet      # 3 抽帧（闸门 B，给用户看）
npm run render                                    # 4 整片
python scripts/check_motion.py --project . --baseline out/old.mp4   # 5 体检
python scripts/verify_sync.py --project .        # 6 同步校验
```
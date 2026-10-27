---
name: vox-video
description: 用 Remotion + Edge TTS 把中文旁白稿做成 VOX 风格的解说视频（fast-paced explainer：大字动态排版、数字卡片、时间轴、金句卡、配音与画面逐词对齐）。只要用户提到做解说视频/科普视频/动画视频/口播视频/解释型短视频、或提到 Remotion 配旁白、把文稿变成视频、给视频加配音和字幕、给视频生成配图/素材图，就使用这个 skill —— 即使用户没说"VOX"或"Remotion"这几个字也要用。它同时负责从选题到成片的全流程：写稿→切 beat→TTS 配音→按音频真实时长生成时间轴→生成场景代码→渲染 MP4。**每片必须配图；开工前先出效果图给用户确认；配音和渲染前各停一次等确认，不会自己一路出片。**
---

# VOX 风格解说视频生产线

把一段中文旁白稿变成一条 VOX 风格的解说视频：画面跟着旁白逐词跳动，节奏紧凑，60-90 秒讲清一件事。

## 四条硬规则

1. **必须配图。** 每一片都要有 AI 配图，数量底线是 `max(3, ceil(拍数 / 3))` 拍（`image` / `layers` / `pieceBase` / `cutouts` / `kind: "image"` / `stage3d` 都算）。第一拍优先上图。`preflight.py` 把这条当**错误**拦，不是提醒。ComfyUI 不可用时停下来问用户，**不许拿斜纹占位板顶替**。
2. **开工前先出效果图。** 立项后、写全稿前，先出一张真实样张（纸艺样帧 + 一张按本题出的配图）给用户看，拿到明确同意才动笔（[闸门 0](#闸门-0先出效果图再开工)）。
3. **配音前确认稿子**（[闸门 A](#闸门-a先给分镜和事实再配音)）。
4. **渲染前确认关键帧**（[闸门 B](#闸门-b先看关键帧图片再渲染整片)）。

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

## 三道确认闸门（不可跳过）

这个 skill **不会自己一路跑到成片**。有三处必须停下来，等用户明确点头。

| 闸门 | 停在哪 | 用户要确认什么 |
|---|---|---|
| **0 效果图** | 立项后、写全稿前 | 纸艺质感、五色配色、字体字号、画面密度、**配图风格**（看真实样张，不是听描述） |
| **A 稿子** | `script.json` 写完、事实核完，**跑 TTS 之前** | 选题角度、beat 切分、旁白措辞、每个数字和出处、配图提示词清单 |
| **B 画面** | `timeline.json` 生成后，**整片渲染之前** | 关键帧 PNG 联络表（用户亲眼看图）、字幕、转场、节奏、配图是否就位 |

### 闸门 0：先出效果图，再开工

立项之后**先不要写 `script.json`**。按顺序做四件事，把结果直接发给用户：

1. **写出图清单 + 确认链路**：`images.json` 先只写 hook 那一条（`--check` 也会读它），
   然后跑 `python "<skill>/scripts/comfy_gen.py" --check --project "<项目>"`。
   失败就停下来问用户（起服务 / 换服务器 / 明确同意换方案），**不许跳过配图**。
2. **按本题出一张真实配图**：`--dry-run` 把拼好的提示词发给用户过一遍，再用
   `--only <hook-id>` 出图。
3. **出样张**：用 scaffold 生成的示例时间轴抽一批代表帧（联络表至少 3 张）——
   ```bash
   python "<skill>/scripts/stills.py" --project "<项目>" --sheet
   ```
4. **一起发给用户**：`out/stills/sheet.png`、`assets/mg-voxstage-style-board.png`、
   第 2 步那张配图。用户要能一眼看到：纸艺质感、配色、字号、画面密度、配图风格。

拿到明确同意后，才写完整 `script.json`、批量出图、跑 TTS。

**为什么必须停：** 配图是这条管线里最贵的一步（一张几十秒到几分钟），风格定错要整批重出；
稿子写完整再改视觉方向，分镜、镜头拆分、版式都要跟着重排。一张样张 1 分钟，返工 1 小时。

| 借口 | 现实 |
|---|---|
| "用户已经说清楚要什么风格了" | 文字描述 ≠ 看到画面。风格是眼睛决定的事 |
| "我先把全稿写完再一起给他看" | 视觉方向错了，越完整的稿子返工越贵 |
| "ComfyUI 没开，先拿占位板凑一张" | 配图是硬要求；没有链路就停下来问用户，不要自己降级 |
| "样张只是示例内容，不能代表成片" | 样张确认的是视觉语言，不是文案；这正是效果图的用途 |

### 闸门 A：先给分镜和事实，再配音

写完 `script.json` 就停。给用户看这五样：

- 一句话题目 + 时长预估（各 beat 旁白字数 ÷ 语速）
- beat 表：`id` / 画面类型 `kind` / 旁白第一句
- **所有具体数字、年份、人名、引述的出处**；拿不准的单独列出来问
- 打算用的镜头类型分布（避免全片 `kinetic`）
- **`images.json` 的完整提示词清单**（必交；见[素材图](#素材图comfyui)）。配图拍数与分配理由一起说清楚

然后等回复。用户明确说可以，才跑 `npm run tts`。

**为什么必须停：** TTS 一跑完，旁白就固化成音频了。改一句话要重跑整条时间轴，
所有依赖词级时间戳的动画都会跟着变。稿子阶段改一个字是几秒钟的事。

### 闸门 B：先看关键帧图片，再渲染整片

`timeline.json` 出来后，**先抽关键帧、把图片直接发给用户，拿到明确同意后才渲染**。
顺序不能反：渲完整片再补看，等于把几十分钟机器时间押在没看过的画面上。

```bash
python "<skill>/scripts/stills.py" --project "<项目>" --sheet --tail
```

它按 `beat.from + 30`（默认）给每拍抽一张，`--tail` 再加每拍出场前 8 帧；
静帧存在 `out/stills/seq/`，联络表出两份：`sheet.png`（**直接贴进对话给用户看**）
和 `sheet.html`（能放大、每格标着拍号/帧号/类型）。
只想看某几拍用 `--beat tumu,gate`，先看计划不渲染用 `--list`。

关键帧至少覆盖这些位置：

- 每拍中段：主体、字幕、纸片字是否就位
- 每拍出场前 8 帧（`--tail`）：转场接缝有没有露底、元素会不会突然跳走
- 强调词纸片：贴的位置对不对、版式和颜色有没有撞（同拍两张别长得一样）
- **配图拍**：图有没有真的就位、是否跑题、图里有没有冒出不该有的文字、纸浆覆盖后还能不能看清
- `quote` / `compare` / `stat`：数字、单位、出处、左右栏有没有错

**把 `sheet.png` 发给用户**（不是只报路径，也不是只说"我看过了"），逐条说清这次改了什么。
用户明确点头后，才进 `## 渲染`。

> **未拿到确认前，不执行 `npx remotion render`。** 这是硬规则，不是建议。
> 整片渲染是几分钟到几十分钟的机器时间，抽帧是几秒钟——先抽帧永远更省。

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

- 你正准备写完整 `script.json`，但还没把闸门 0 的效果图发给用户
- 你正准备批量出图，但配图风格还没经用户确认
- 你正准备跑 `npm run tts`，但还没把 beat 表发给用户
- 你正准备跑 `remotion render`，但还没抽帧给用户看
- 你在想"先渲出来再一起说"
- 用户只回了一个"嗯"，或只回答了你问的别的细节

## 目录

- [确认闸门](#三道确认闸门不可跳过) — **效果图、配音、渲染前三处必须停下**
- [五个阶段](#五个阶段) — 完整流程
- [第 2 步：写稿 + 分镜](#2-写稿--分镜--scriptjson) — 你唯一要手写的文件
- [分镜节奏](#分镜节奏vox-的命门) — 多长一个 beat、什么时候换画面（弧库见 `references/arcs.md`）
- [风格基线](#风格基线) — 只有五支颜色、三层纸、三种手势，**开工前先读**
- [选视觉组件](#选视觉组件) — 16 个组件覆盖 90% 场景
- [素材图（ComfyUI）](#素材图comfyui) — **强制**：每片都要配图；风格预设 + bake-off 选风格
- [转场与特效](#转场与特效) — 别让整片一个节奏（运镜层 / 程序化特效）
- [配乐](#配乐) — 配乐 + 按旁白自动让路（ducking）
- [自检](#自检) — 单调 / 死拍 / 丰富度 / 不同步都能自动查出来
- [渲染](#渲染)
- [踩坑速查](#踩坑速查)
- 参考文件

---

## 风格基线

整片只有一套视觉语言：**档案纸拼贴**（MG-VOXSTAGE）。风格板在
`assets/mg-voxstage-style-board.png`，实现说明在 **`references/style.md`**。

先记住四件事，细节再看文档：

1. **五支颜色**：存档米棕 `#D3C2A4` / 纸片米白 `#F8F1E0` / 油墨黑 `#1A1A1A` /
   网点灰 `#8C8C8C` / 正红 `#D62E1F`（+ 芥末黄 `#D9A441` 做次级）。没有蓝/青/品红。
2. **没有纯色背景**：底纸 = 做旧色层 + 旧地图纹 + 半调网点/纤维，缺一层就会"死"。
3. **红只做记号**：下划线、描边、色条、偏移剪影。红不铺面，强调词是**墨色字 + 红笔划线**，
   不是彩色字。
4. **没有页码、没有圆角卡片、没有彩色描边按钮**——出现任意一个，整片就退回 PPT。

改风格不是改某一拍，是改 `src/theme.ts` + `PaperStage` + `paper.tsx` 这三处；
改完先渲 3-4 张代表帧给用户看（这就是[闸门 0](#闸门-0先出效果图再开工)），
**风格定下来再往下做分镜**。

## 五个阶段

### 1. 立项目

```bash
node "<skill>/scripts/scaffold.mjs" --slug <英文短横线名> --out "E:\AI\视频制作"
```

会复制模板工程到 `E:\AI\视频制作\<slug>\`，并装好依赖。依赖里有 Remotion 自带的 ffprobe，后面量音频时长要用。

**首次装依赖约 4 分钟**，请后台跑，别干等。已经装过的项目可以 `--from <已存在的项目路径>` 复用它的 `node_modules`（秒级完成）。

**装完先过[闸门 0](#闸门-0先出效果图再开工)**：`comfy_gen.py --check` 通不通、样张好不好看、
配图风格对不对。**没拿到确认之前不要写完整 `script.json`。**

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

它查 id 重复、kind 拼错、缺必填字段、图文件不存在、**配图拍数不够**、层少 `y`、
枚举值写错、字体缺失、弧名不合法、`camera`/`vfx` 写错、配乐文件不存在、
`stage3d` 坐标量级和三条 3D 依赖。有错先改，别去配音。

**写稿之前先选一条叙事弧**（`arc` 字段）。弧决定 beat 的**顺序和形状**，
组件决定 beat 的**长相**——两件事分开想。14 条弧、拍数数字表、hook 句式库、
反单调清单见 **`references/arcs.md`**。

**每一拍还要定三根杆**（写进 `script.json`）：

| 杆 | 字段 | 管什么 |
|---|---|---|
| 轴一 | `visual.camera` | 整幅怎么动：`push_in`/`pull_out`/`pan`/`tilt`/`parallax`/`whip`/`static` |
| 轴二 | `visual.motion` | 内容怎么进场：`stamp`（盖章）/`wipe`（揭开）/`rise`（升起）/`flip`（翻页）/`build`（逐项搭）/`drift`（漂入）。**不写会按拍序自动轮换**（相邻拍保证不同），写错了手写值 |
| 摆法 | `visual.layout` | 版式变体：`center`（默认）/`left-edge`/`bottom-third`/`split`（仅 stat）/`full-bleed`（需要 `image`）。不写一律是居中卡片 |

只做轴一，画面还是死的；只做轴二，镜头是死的。**相邻两拍的 `camera` 不要重复。**
`motion` 别连写同一个——自动轮换不会重复，`check_rhythm` 报"相邻重复"一定是手写写重了。
挑几拍写 `layout`（尤其 stat 的 `split`、长文的 `left-edge`），整片都是居中卡片就是 PPT。
`elementMotion` 已降级为自由备注，不再影响渲染。

### 每拍变化清单（`change`，可选）

`change` 是写稿时逼自己想清楚"这一拍到底在演什么"的四件事，**不参与渲染**；
写了 `preflight` 就要求四项齐全（中英文键名都认）：

```jsonc
"change": {
  "enter": "标题纸片从上方落下，落定回正",
  "main": "念到「土木堡」时红章砸下、数字从 20 万跳到 50 万",
  "secondary": "底纸网点缓慢爬移，左上角小人眨眼",
  "exit": "纸片盖屏，切到下一拍"
}
```

主动作写不出来，就说明这一拍只是把字摆好了——重想画面，别把字段留空。
变化频率、次要动作幅度、抽象概念→现有组件的映射表见
**`references/visual-craft.md`**。

### 镜头拆分（`visual.shots`）

一拍 6 秒只演一个视觉，画面就"定"住了。`kinetic` 拍的旁白有多个从句时，可以在
拍内再切成 2–3 个镜头，每个镜头自己入场、自己对齐词级时间戳：

```json
"visual": {
  "kind": "kinetic",
  "shots": [
    { "to": 2.8, "words": ["你自己的设备", "也在排队"], "motion": "stamp" },
    { "from": 2.8, "words": ["每多连一台", "能分到的就少一分"], "motion": "rise",
      "transition": "crossfade" }
  ]
}
```

- `from`/`to` 的单位是**秒**（相对拍开头）；省略 `from` = 接上一镜结尾，省略 `to` = 下一镜开头（末镜到拍尾）。第 2 镜起要写 `from`，且不能倒序。
- **不写 `shots` 的 `kinetic` 长拍会自动按从句拆**：旁白里的句读（`，。！？；、`）落在
  哪个词之后，下一个词就是新镜头的起点。edge-tts 的词文本**不带标点**，所以 `shots.ts`
  会把 `narration`（去空白和标点）和词流做字符级对齐再定位句读。短于 1.5 秒的句子
  并入相邻句（末句并进前一句），合并后只剩一句就是单镜头。想精确控制边界和上屏词就写显式 `shots`。
- **只对 `kinetic` 生效**——其它 kind 的词级锚点是另一套机制，`preflight` 会挡。
- 写了 `shots` 之后，拍级 `visual.words` 和 `visual.motion` **失效**：上屏词改由每个镜头的
  `words` 接管，入场配方按**全局镜头序号**轮换（跨拍相邻也不重复）。**自动拆分同样不认
  拍级 `motion`**——要指定配方就写显式 `shots`。拍级 `visual.text` 在多镜拍里也不上屏，
  避免每一镜都重复整句。
- `camera` 仍是 **beat 级**：镜头切的是内容层，纸台和运镜不动。
- `impact` / `flash` 是**拍级**：拆镜后 `impact` 只在首镜开火，`check_rhythm` 的冲击预算仍按拍计。
- 镜头之间默认硬切；`"transition": "crossfade"` 让前镜多挂 8 帧、后镜淡入交叠。

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
        "source": "NASA/JPL",
        "motion": "rise",
        "layout": "split"
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

组件都就位之后，**配图仍要补齐**——配图是每片的硬要求，不是"有组件就不用图"。
先在 `images.json` 里写全提示词，过闸门 A 后跑 ComfyUI 出图，再在 `script.json` 里
引用 `img/<id>.png`；`preflight.py` 会检查全片配图拍数，不够直接报错。
细节与风格选择见[素材图（ComfyUI）](#素材图comfyui)。

**先定"看的层"，再出图。** 纸艺系有 6 套风格预设，"哪套好看"是眼睛决定的事——
用 bake-off 同一条 brief、**同一个 seed** 各出一张让人挑。

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

组件签名统一是 `({beat, visual, accent, tone})`。`beat` 里带着词级时间戳，用 `resolveWordTimings` / `useBeatWords` 就能让动画卡在旁白上——**别自己按固定帧数排动画**，那样这一拍就和声音脱节了。写之前先翻 `references/components.md` 确认现有组件真的做不到，也别忘了遵守那里的布局分区（左上报头 / 左下出处 / 底边进度条）。

组件只读 `useCurrentFrame()`，**不要用 CSS transition / animation / @keyframes**——渲染是逐帧截图的，浏览器没有时间推进，CSS 动画不会动。

### 5. 渲染

见[渲染](#渲染)。

## 分镜节奏：VOX 的命门

VOX 视频看着"信息密度高"，本质是**剪辑节奏快**。60 秒的片子大约 10-13 个 beat，平均每个 4-6 秒。

**写稿之前先选一条叙事弧**——弧决定 beat 的顺序和形状，见
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
- **片尾留白（`tailPad`，默认 0.6 秒）并进最后一拍**。这段是给配乐收尾的，画面会一直铺到最后一帧——别再手工往末尾加空拍，加出来的那几帧会露出纯色底。
- **一个 beat 只配一个视觉。** 想在一个 beat 里既出大字又出数字卡片，就拆成两个 beat——反正长度是量出来的，拆开不花钱。
- **`rate` 默认 `+12%`**。中文 TTS 默认语速对解说视频偏慢，加 10-15% 才有 VOX 那种紧凑感。超过 `+20%` 中文会开始吞字。
- **无声 beat 是合法的**（`narration: ""`）。纯视觉留白（比如放一张图配环境音）节奏上很有用。
- **开头别铺垫。** 第一个 beat 直接给最反直觉的那个事实。
- **每 2–3 秒要有一个看得见的新东西**（新元素进场、变形、换色、推近），每 3–5 秒
  一次大变化；任何一段静止不超过 2 秒。写每拍 `change` 四件事，出片后用
  `check_richness.py` 量——判据和实测见 **`references/visual-craft.md`**。

## 选视觉组件

| 组件 | `kind` | 什么时候用 |
|---|---|---|
| `KineticText` | `kinetic` | 大字逐词弹出。默认首选，但**一整片别超过 4 拍连续用** |
| `StatCard` | `stat` | 巨大数字 + 计数动画 + 单位 + 出处 |
| `Odometer` | `odometer` | 机械逐位计数，印在墨色纸块上。数字本身在**跳**时比平滑计数更有张力 |
| `Chart` | `chart` | 柱状 / 折线 / 环形。多组数据的量级对比 |
| `Highlight` | `highlight` | 红马克笔条 + 红笔划线 + 手绘圈注。在**文字**上标重点（`Callout` 是在图片上） |
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
| `Handwrite` | `handwrite` | 一只手拿笔在纸上写。笔尖走到哪，字显到哪；适合"写下这句话"的誓词、定义、日期 |

`handwrite` 的文字写在 `visual.text`，用 `\n` 换行；`write.size`（字号，默认 150）、
`write.color`（`ink` 钢笔 / `red` 红笔）、`write.speed`（字/秒，默认 3.2）可调。
**一拍只写一句短话**：单行超过 12 字字号会被压到 110 以下，手也跟着变小；
`visual.emphasis` 里的词会用红笔写。手是一张剪纸手部素材（蓝杆钢笔、金箍、银色笔尖，
随模板自带 `public/handwrite/hand.png`），剪到手腕为止、不画手臂，起笔淡入、
写完抬笔退场；它只挡在笔尖右上方还没写到的位置，所以文字右端离画幅右缘留一点空间。

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

**批注层同样全 `kind` 通用**：`visual.annotations` 往纸上画红笔记号——
`circle` 圈数字、`arrow` 指方向、`measure` 量宽度、`tag` 贴小纸签、
`stamp` 压橡皮章、`shape` 放一个剪出来的形状（勒洛三角等）。
坐标是画幅百分比，到点后 12-14 帧"画"进去。版面空得不像话时用它，
**不要当装饰撒满每一拍**；信息已经满的 compare / cards 不加。
字段说明见 `references/components.md` 的「红笔批注层」。

> `image` / `annotations` 生效需要重跑 `npm run tts`：Remotion 读的是生成物
> `src/timeline.json`，不是 `script.json`。改完脚本没重新生成，会看到画面毫无变化。

完整 props、字段和可调参数见 `references/components.md`。

选之前先查 **`references/visual-craft.md`** 第五节的「抽象概念 → 现有画面」：
范围、累积、步骤、缺失这类概念分别该用哪种 kind、哪些是真缺口；字号和对比度
的下限见 **`references/readability.md`**。

**"单调"几乎不是组件不够，而是没人管重复度。** 十六种组件摆在那里，
写稿时凭感觉挑，最后 `kinetic` 用六次、其中连续三次——整片一个节奏。
`scripts/check_rhythm.py` 会把这件事变成可测的数字（见下）。

## 纸艺拼贴视觉层（`paper.tsx`）

整套视觉是**定格纸艺拼贴**：底纸是旧牛皮色的桌面，内容是剪下来、贴上去的纸片。
这不是"加个纹理"，它决定三件事——纸片要有边、要有影、要歪；镜头缓慢推近，
纸张在空气里极慢地漂，尘埃在镜头前上浮。

强调词是这套语言里最典型的物件：从旁白里剪下来贴成纸片——短词是金色小价签，
3-5 字是便签或剪报，整句是带红边的长条，全片只留一张红纸给最重的那句。
按字数自动选，同一拍的第二张会换一种；版式表见
`references/components.md#kinetictext`。

**四条不能破的约束**（每条都对应一次实测翻车）：

1. **底纸比纸片深一档**（`COLORS.stage` vs `PAPER.sheet`）。两者都接近白时整幅糊成
   一片米白，纸的边界消失，帧间差也跟着掉 15%。
2. **投影放背景层，用 `drop-shadow`。** `box-shadow` 会被 `clip-path` 一起裁掉；
   放到外层容器上，卡片里每个字都投一道 16px 的影。
3. **不要用 `mix-blend-mode`。** 它和祖先 `transform` 一起会触发 Chromium 合成层
   缓存 bug，成片里留下前几帧的**文字残影**。光带、柔光都用普通 alpha 叠加。
4. **整幅只允许连续运动**：低频正弦漂移（`sway()`，6px / 240 帧）或慢推近。
   `jitter()` 是定格抖动（每 2-3 帧重摆），只给个别小标签——整幅用它，眼睛读到的是
   "画面一直在抖"，不是手工感。深色拍不放纸屑，纸纤维压到 0.14。

动效语言全部连续、可复现、由代码驱动：漂移（`sway()`）、粒子（34 粒纸屑尘埃）、
曝光呼吸（0.4%-2.0% / 3 帧）、推近（`visual.ambient`）、元素级（组件自己的
入场/计数/画线，3-8px / 60-100 帧）。

**面积决定观感**：同样 2px，在小标签上是"手工感"，铺满全幅再加几十个元素就是"手抖镜头"。
背景也不是空的——账册格线（96px）、纸屑、纸纤维一起包在漂移层里，薄信息量的拍
（`timeline`、`person`）全靠它们撑住"画面还在动"。

基元表（`PaperSheet` / `Tape` / `roughEdge` / `bandEdge` / `fiberStyle` …）、props
和幅度参数见 `references/components.md#背景与常驻件`。

### 3D 纸艺舞台（可选，`stage3d`）

默认舞台是 2D 的 `PaperStage`。需要**真前后遮挡**时——方盖掉进洞里、纸片从另一张
纸背后转出来、镜头穿过一层纸——给单拍加 `visual.stage3d`：这一拍的底纸/纸片/胶带
换成 React Three Fiber 的真 Z 轴，文字仍由 DOM 排（中文字形在 3D 里没有胜算）。

```jsonc
"visual": {
  "kind": "kinetic",
  "stage3d": {
    "camera": "push_in", "punch": 0.7, "mapSrc": "img/map.png",
    "pieces": [
      { "src": "img/hole-cut.png", "x": 1.3,  "y": -0.05, "z": -0.45, "w": 2.65 },
      { "src": "img/lid-cut.png",  "x": 1.22, "y": 0.56,  "z": 0.42,  "w": 1.0,
        "enter": "drop", "at": "井盖", "fall": "掉进", "alphaCut": 0.9 }
    ]
  }
}
```

- **坐标是世界单位**（16:9 画幅约 7.2 × 4.05），`x/y` 是纸片**中心**、`w` 是宽度。
  抄 2D `cutouts` 的 0-1 坐标会让纸片缩在画面正中一小团，`preflight` 会提醒。
- `at` / `spinAt` / `fall` 和 `cutouts` 一样写**旁白原词**；命中后提前 2 帧起手。
- `camera` 只支持 `push_in` / `pull_out` / `pan` / `static`，其它值回落 `push_in`。
- 这一拍的 `cutouts` / `pieceBase`+`pieces` / `image` / `layers` **不会渲染**
  （不报错）；`kind` 组件、字幕、批注、特效、转场照常压在 3D 上。`quote` 是深色
  纸台，别和 3D 混用。
- **按拍开**，没写 `stage3d` 的拍还是 2D，混排没问题。
- 老项目要补依赖：`npm install three @react-three/fiber @remotion/three@4.0.535`；
  模板新建的项目已经带上。`preflight` 会查这三件套在不在。

> 3D 不是"更高级"的默认选择。渲染不慢，但慢镜头下画面反而更**静**——PPT 感靠在
> 拍内安排词级动作和切镜，不在 Z 轴。只在真的需要遮挡关系时用它。

字段全表、`marks` 红笔和四条实现坑（uniform 冻结、alpha 裁切、词锚点规则）见
`references/components.md#3d-纸艺舞台stage3dtsx`。

## 素材图（ComfyUI）

**每一片都必须有配图，没有例外。** 配图拍数底线是 `max(3, ceil(拍数 / 3))`，
第一拍（hook）优先。`preflight.py` 把这条当**错误**拦——纯排版的片子就是 PPT，
不管你组件用得多花。

没有 ComfyUI 不是降级理由：`ImageCard` 退化成斜纹占位板只是组件兜底，**不是可交付状态**。
先 `--check`，不通就停下来问用户（起服务 / 换服务器 / 明确同意其它方案）。

**优先给这些拍配图**：`hook`、`kinetic`、`cards`、`person`、`quote`、`image`。
`stat` / `chart` / `timeline` / `split` 这类符号拍要么用 `imageLayout: "inset"`
把图贴到右侧，要么不配——满幅图会和图表互相拆台。

1. 项目根目录写 `images.json`（参照 `assets/images.example.json`），**一镜一条**。
   `scene` 按 `camera → subject → environment → materials → light → color → text`
   的顺序写，一拍要分层就写多条（`id` 加 `-far` / `-mid` / `-near`）。**`scene.text`
   是白名单**：不写字就留 `[]`；填了字就只许出现那几个字。蒸馏模型（Z-Image / FLUX）
   cfg=1.0，负向提示词不生效，文字只能靠这条白名单管住。
2. `--check` 核对服务与模型（闸门 0 已先跑过一次）；`--dry-run` 看拼好的提示词
   （**出图前给用户过一遍**，并入闸门 A）。
3. 出图到 `public/img/<id>.png`，在 `script.json` 里写 `"image": "img/<id>.png"`
   （不是 `src`，`src` 只给 `kind: "image"` 用），重跑 `npm run tts`。
4. 出图后跑 `npm run preflight` 确认配图拍数过线；不够就补拍再出图。

```bash
python "<skill>/scripts/comfy_gen.py" --check --project "<项目>"
python "<skill>/scripts/comfy_gen.py" --project "<项目>" --dry-run
python "<skill>/scripts/comfy_gen.py" --project "<项目>"
```

尺寸 `1536×864`（16:9 + `objectFit: cover`）。seed 和最终 prompt 写进
`public/img/_generated.json`，同一份清单重跑可复现。

**`style_preset` 决定图长什么样，全片只写一份。** 内置 `paper`（默认）、`paper-ink`、
`paper-newsprint`、`paper-poster`、`paper-zine`、`paper-washi`、`vector`。
**选风格让人来挑，不要让模型一次定死**：用 bake-off 出同一 brief、同一 seed 的
多套风格，挑完把预设名写进 `images.json`（全局，或某一条单条覆盖）。

```bash
python scripts/bakeoff.py --project . --beat shot-hook   # → out/bakeoff/sheet.html
```

预设清单、提示词模板、换模型、XPU 已知问题见 `references/comfyui.md`。
内容规矩：默认不让模型画文字（除非走白名单）；历史题材走插画/象征，不做伪史料照片；
真实人物不做写实脸。

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

- `depth` 0→1：视差系数。远层几乎不动（0.14），近层跟着底纸走（1.04）。
- `band`：这层只露出原图**底部**那条带，顶边自动裁成撕纸毛边；不给 `band` 就整层铺满。
- `y`：这条带落在画面的什么位置。**没有 `y` 这层就废了**——所有带会堆在底部。
- `imageWash`：整叠图的纸浆覆盖，默认 0.26（比单张图浅，否则景深全被洗平）。

**出图时的硬规矩：内容必须落在原图底部那条带里。** 提示词要写"主体全部位于画面
下方 X%，上方是空白米色纸（会被裁掉）"，否则旗帜、人物的头会被水平切断。
三层的 `light` / `color` 必须一致，否则叠起来像三张不同的画。

**`image` 和 `layers` 可以同时给**：`image` 当最底的一张，`layers` 叠在它上面——
"角贴照片 + 分层背景"能共存（远处一条山脊、右侧角贴、路线走左侧）。

哪类拍不适合上图（`person` 的圆形剪影、`stat`、主体在原图正中）见
`references/troubleshooting.md#分层背景板远层看不见--主体被水平切断--叠起来像三张不同的画`。
每层各自在动，是比"整幅抖动"干净得多的活力来源（实测见 `references/tuning.md`）。

模型默认 Z-Image-Turbo（可商用），换模型、许可对照和 Intel Arc 的 XPU 坑见
`references/comfyui.md`。

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
  "transitionFrames": 10,                        // 全片默认，约 0.33s
  "beats": [
    { "id": "hook",   "transition": "none" },    // 第 0 拍没有前一段
    { "id": "second", "transition": "slide" },
    { "id": "third",  "transition": "filmBurn", "transitionFrames": 16 }
  ]
}
```

**按"这一对拍子是什么关系"选，不要随机轮换：**

| 关系 | 用 |
|---|---|
| 同类内容软切换 | `fade` |
| 话题往前推进 | `slide` / `pushCut` |
| 换时代 / 换地方 / 换维度 | `wipe` / `iris` / `clockWipe` |
| 翻到下一章 | `flip` / `bookFlip` |
| 灾难、战乱、崩盘 | `filmBurn` / `ripple` |
| 纸片盖住画面再换内容（保持拼贴质感） | `paperCover` + `transitionFrames: 18` |
| 同类型连续内容 | `none`（硬切比淡入淡出利落） |

> **`dissolve` 不是"软溶解"。** Remotion 4.0.535 里它按**亮度**烧灼，平涂纸面亮度
> 几乎一致 → 整幅闪一记橙色，像渲染错误。想要不惹眼的软切换用 `fade`。

**`paperCover` 是自定义转场**：纸片一片片落下来盖满、切点换内容、再掉走。
它必须给足 16-20 帧（默认 10 帧会看到"半屏纸 + 半屏内容"），且 progress 0.5
处完全盖住——前一拍最后 0.3s 别放关键信息。实现与坑见
`references/components.md#papercover--纸片盖屏自定义`。

**一个接缝只用一式，不要叠加。** 甩镜糊段里再加闪白会被读作穿帮。

每拍还可以挂特效层：`impact`（"soft" 默认 | "medium" | "heavy"，镜头推近+抖动）、
`flash`（闪白 3 帧）、`sweep`（光带扫过）、`ambient`（常驻运动档位）。
**`impact` / `flash` 作用于整画面层，全片合计 ≤3 处，相邻两处间隔 ≥3 拍**——
整层震屏会让观众疲劳；逐词的小反应是元素层，可以密集。`check_rhythm.py` 会替你数。

完整转场名与别名、每个特效的实现见 `references/components.md#转场` 与
`references/components.md#特效层`。

### 运镜层（`camera`）—— 轴一

`camera` 管**整幅怎么动**；轴二是 `motion`（**内容怎么进场**，不写自动轮换），
杆三是 `layout`（**摆在哪**，不写一律居中）。三根杆分开想：
只做运镜画面还是死的，只做元素运动镜头是死的，每页居中像 PPT。
配方表和版式表见 `references/arcs.md#三根杆镜头怎么动-内容怎么进场-摆在哪`。

| 值 | 效果 | 什么时候用 |
|---|---|---|
| `push_in` | 缓慢推近 | 默认 |
| `pull_out` | 缓慢拉远 | 揭示、收束 |
| `pan` / `tilt` | 横移 / 纵移 | 扫过一组并列的东西 |
| `parallax` | 带层差的横移 | 有前景遮挡物的画面 |
| `whip` | 快甩 + 方向性模糊 | 换章、卡点，**慎用**（切边缘） |
| `static` | 不动 | 点题、留白；相邻两拍别都 static |

**相邻两拍的 `camera` 不要重复**——这是最省力的反单调手段。整片的拍数、弧、
hook 句式见 `references/arcs.md`。

> 推近有 **4% 硬上限**（满宽排版超了切字）；平移必须靠放大留出血（1.06-1.2×），
> 否则露黑边；报头和进度条不参与运镜。幅度与实现见 `references/components.md#运镜层camera`。

### 元素级动效：碎片拼贴（`pieceBase` + `pieces`）

把一张纸艺图切成几块，**飞进来拼回原图**。适合"撕裂""重建""拼回来"这类句意。

```jsonc
"visual": {
  "pieceBase": "img/shot-knife.png",   // 底图；和 image 互斥
  "pieces": [
    { "x": 0,   "y": 0, "w": 0.5, "h": 1, "enter": "fly_left",  "at": 12, "depth": 0.62 },
    { "x": 0.5, "y": 0, "w": 0.5, "h": 1, "enter": "fly_right", "at": 17 }
  ]
}
```

- `x/y/w/h` 是**画幅比例**，`at` 是**拍内帧**；`enter` 六种：`fly_left` / `fly_right` /
  `fly_up` / `drop` / `slap` / `pop`。`depth` 决定投影和遮挡，`spin`（±3°）给手抖。
- **块铺满 = 拼成完整一张**；留缺口 = 一直有个洞（留给"缺失感"）。
- 切的位置压在画面本来就有的**接缝/裂口**上，飞起来才像"撕开"；切在干净处会看到直线。
- **只放在内容占幅小的拍上**（`kinetic` / `stat` / `quote`）：`compare` / `split`
  铺满画幅、纸片又不透明，会把拼装整个挡住。
- 图必须 **16:9**。

> 不用 AI 抠图：抠图模型是真实照片训的，会把平涂纸艺的撕边吃掉；切矩形拼回去一个
> 像素不差。两个静默坑（`mask-image` 不生效、拼满漏一像素要 `PAD = 0.004`）见
> `references/components.md#碎片拼贴层piecestsx`。

单张撕边纸片掉落用 `PaperDrop`（`src/paperfx.tsx`）：标题或关键词纸片从上方落下、
落地回正，和 `Pieces` 的矩形切块不是一回事。一组纸片的 `at` 错开 3-4 帧，
别同时落。参数见 `references/components.md#paperdrop--撕边纸片掉落进场`。

### 程序化特效与常驻运动

- `vfx: "confetti"`：纸屑雨，撒在最上层；一拍给一次就够，连着几拍会吵。
- `vfx: "starburst"`：冲击放射，画在内容**下面**（压在字上会先看到线），透明度 0.42。
- `ambient`：每拍自动套的常驻微运动，`soft` 1.8% / `normal` 3.2% / `strong` 4.8% 推近。
  文案密、要逐字读的拍调 `soft`；留白多的 `image` / `quote` 可上 `strong`。
  **它只能消掉"完全不动"的死帧，不能让画面变活泼**——活力来自元素级动作。

> `vfx` 与 `ambient` 的全部参数见 `references/components.md#特效层`。

## 自检

四个脚本：`check_rhythm.py` 在渲染前查脚本，`verify_sync.py`、`check_motion.py`
和 `check_richness.py` 在渲染后查成片。它们查的正是"肉眼看片最容易漏、也最难自查"
的几件事。

```bash
python "<skill>/scripts/check_rhythm.py" --project "<项目>" --src "<模板 src>"
python "<skill>/scripts/verify_sync.py" --project "<项目>"
python "<skill>/scripts/check_motion.py" --project "<项目>" --baseline out/old.mp4
python "<skill>/scripts/check_richness.py" --project "<项目>"
```

**节奏**：视觉重复度（连续同款 / 单款占比 / 种类数）、转场重复、全画面冲击是否
超预算、字号是否低于 1080p 可读下限、字幕是否低于 60px、主题色文字/背景的
WCAG 对比度、首拍是否像 hook。字号与对比度的依据见 `references/readability.md`。

**同步**：从 mp4 抽音轨与源 mp3 做包络互相关，逐拍输出误差，并区分**系统性偏移**
（所有拍一致）和**抖动**（逐拍离散，才是真问题）。

⚠️ 偏移由「Remotion 版本 + 编码 + 采样率 + 容器」共同决定，换任一项都要重测。
⚠️ **有配乐的片子别信首拍探针**：它只看能量上跳，分不清旁白和配乐，而推荐做法正是
让音乐在旁白之前淡入。测同步用无配乐渲染（临时删掉 `music` 字段），或只看抖动列——
`systematic_offset_frames` 是互相关量出来的，`onset_offset_frames` 是首拍探针。

**动效**：采样 10fps、降到 192×108 灰度，量帧间均差、九宫格变异系数（>0.5 说明是
元素在动，<0.3 说明只是整幅推拉）、**逐拍均差**。判定只看**逐拍均差**和**九宫格**：
均差 <1.5 就是死拍。改版后加 `--baseline` 和旧版逐拍比，比盯绝对值灵敏。
**"近乎静止占比"不要当 KPI**——它奖励噪声和颤动，60%-70% 属正常；确实要卡，
显式加 `--strict`。

**丰富度**：每 2.5 秒抽一格（裁掉底部字幕纸带），量相邻格的像素差。判定是
**平均 ≥10 且没有"几乎没变"（<4）的对**；另报在动帧占比和最长静止（>2 秒提醒）。
输出 `out/richness/richness.txt` + 联络表 `sheet.png`，标了 `FLAT` 的格就是要补变化
的地方。阈值在纸艺片上复核过：`ming-ep01` 平均 34.8、0/25 对几乎没变；
`demo-film` 5/15 对几乎没变——这就是"过了动效检查但看着单调"的样子。
判据和补变化的方法见 `references/visual-craft.md`。

> 实测数据、阈值推导和"软渐变为什么无效"见 `references/tuning.md`。

> `verify_sync.py` 和 `check_motion.py` 需要成片，所以在**用户同意渲染之后**跑；
> `check_rhythm.py` 只读脚本，配音前就能跑。

> **停在这里，不要往下跑。** 按[闸门 B](#闸门-b先看关键帧图片再渲染整片)抽关键帧，
> 把 `out/stills/sheet.png` 直接发给用户、拿到明确同意，才进渲染。

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

**ducking 是自动的**：按旁白的**词级时间戳**压低、说完再慢慢回来，帧级对齐；音量曲线解析式逐帧计算，渲染可复现。没有音乐就删掉整个 `music` 字段，`preflight.py` 会检查配乐文件在不在。

> **挑音乐**：别挑有旋律记忆点的（观众会记住旋律而不是你的旁白）；别挑节奏跟旁白打架的（快鼓配慢解说最难受，宁可用无节奏的 pad）；首尾留空间（开头 1-2 秒音乐先进来，结尾留 1 秒给画面收）。
> 音量拿不准就 `gain 0.2 / duck 0.6` 起步；`preflight.py` 会在 `gain > 0.45` 或 `duck < 0.4` 时提醒。

## 渲染

> **闸门 B 已经通过才往下走。** `preflight` 通过、配图拍数过线、关键帧
> `sheet.png` 已发给用户并拿到明确同意。没确认就先回闸门 B 抽帧，
> 不要拿整片渲染当预览。**画面里还有斜纹占位板就不算过门。**

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
| **片尾旁白被截掉几秒** | 加了转场但没让气口装得下交叠。`npm run tts` 会自动把尾部留白撑到 ≥ `transitionFrames`；手改过时间轴就跑 `verify_sync.py` |
| **画面越往后越早、片尾一段空白** | `from` 按音频时钟累加，而视觉被转场逐拍压缩。必须是 `cursor += dur - next_te`。`verify_sync` 查不出来，只能抽尾帧看 |
| **preflight 报「配图不够」** | 配图是硬要求：至少 `max(3, ceil(拍数/3))` 拍要有 image / layers / pieceBase / cutouts / kind=image / stage3d。补 `images.json` 出图 |
| **没出效果图就直接写稿 / 批量出图** | 违反闸门 0。先出样张给用户确认视觉与配图风格，再写全稿 |
| **ComfyUI 没开就渲了占位板** | 非法交付。停下问用户（起服务 / 换机器 / 明确同意其它方案），不许降级 |
| **加了 `image` 但画面没变** | Remotion 读的是 `src/timeline.json`（生成物）。改 `script.json` 后要重跑 `npm run tts` |
| **像 PPT：旁白还在说，画面已定格** | 多数是**构图太空**：主体只占中间一小块，四周纯色把帧均差摊平。先让主体铺满（改布局），其次才补元素级动作；`visual.ambient` 只能救"完全不动"。用 `check_motion.py` 的逐拍均差定位，<1.5 算死拍 |
| **长拍还是像 PPT** | 拍 ≥4s 的 `kinetic` 没写 `shots`，而旁白有多个从句——写 `shots` 按句切镜；不写也会自动按从句拆，但词尾没有标点就拆不开 |
| **镜头切到一半字没了** | 显式 `shots` 的 `to` 落在词中间。`to` 取旁白从句边界的时刻，让一镜说完一整句 |
| **画面一直在抖 / 整片像在颤** | 整幅用了 `jitter()`（每 2-3 帧重摆）。换 `sway()`：连续低频正弦，6px / 240 帧；`jitter` 只留给个别小标签 |
| **画面整块发米白、纸片没边界** | 底纸和纸片都接近白。底纸用 `COLORS.stage`（比 `PAPER.sheet` 深一档），纸片 `PAPER.sheet` |
| **文字横向叠成三四个残影** | `mix-blend-mode` + 祖先 `transform` 触发 Chromium 合成层缓存 bug。去掉混合模式，改普通 alpha |
| **3D 纸片定格在入场那一帧** | shader uniform 被原地改值，多进程渲染会冻结。每帧新建 uniforms 对象 |
| **3D 纸片边缘一圈灰影** | 素材把烘焙投影做进了 alpha。`alphaCut: 0.9` 裁掉灰影，投影改用 `shadow` |
| **用了 `stage3d` 但 tsc / 渲染找不到模块** | 老项目没装 `three`、`@react-three/fiber`、`@remotion/three`（版本要和 `remotion` 一致） |
| **3D 纸片没按词动，一开场就掉** | `at` 在旁白里找不到，退回拍开头。改词或换成旁白里原样出现的片段，`preflight` 会提醒 |

字体、`spring` NaN、`clockWipe` 尺寸、webpack 路径、首帧闪、配图发品红等完整排查见 `references/troubleshooting.md`；ComfyUI 卡 pending / `DEVICE_LOST` 见 `references/comfyui.md`。

## 参考文件

- `references/style.md` — 风格基线：五色表、三层纸舞台、组件语法、字号字距、动效表、禁用清单
- `references/components.md` — 16 个组件的完整 props、转场选型、特效层、运镜层、入场配方、版式变体与镜头拆分、配乐床
- `references/arcs.md` — 叙事弧库、拍数数字表、hook 句式库、三根杆的词表、反单调清单
- `references/visual-craft.md` — 每拍变化清单（进场/主动作/次要动作/出场）、变化频率、抽象概念→画面映射、丰富度判据
- `references/readability.md` — 字号下限、WCAG 对比度、字幕安全区、停留时间（全部带出处）
- `references/comfyui.md` — ComfyUI 出图：模型清单、工作流格式、XPU 已知问题
- `references/tuning.md` — 实测参数与调优记录：死拍阈值、推近上限、分层收益、同步精度
- `references/troubleshooting.md` — 渲染报错、字体、音画不同步的完整排查
- `assets/script.example.json` — 带注释的 `script.json` 完整示例
- `assets/images.example.json` — `images.json` 示例（即梦/ComfyUI 配图清单）
- `assets/comfy/` — 工作流 JSON 与模型文件名清单
- `assets/template/` — 模板工程本体（scaffold 复制的就是它，组件源码的唯一真相）
- `evals/evals.json` — 回归用例：功能、纸艺风格、防整幅抖动、分层景深、闸门行为、模板同步、叙事弧与运镜、bake-off 选风格、回灌方向、镜头拆分

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
| `scripts/preflight.py` | 配音**之前** | 查 script.json 的错：id 重复、kind 拼错、图不存在、**配图拍数不够**、层少 `y`、枚举值写错、字体缺失、stage3d 坐标与依赖 |
| `scripts/vox_tts.py` | 闸门 A 之后 | 合成配音 + 生成 `src/timeline.json`（帧数由音频实测推导） |
| `scripts/stills.py` | 闸门 0（效果图）/ 闸门 B（渲染之前） | 按 beat 抽关键帧 + 联络表；`sheet.png` 直接发用户，`sheet.html` 可放大看标签 |
| `scripts/check_rhythm.py` | 闸门 B 之前 | 查节奏单调、字号/字幕下限、WCAG 对比度、类 CSS 动画 |
| `scripts/check_motion.py` | 渲染之后 | 逐拍均差、九宫格、静止占比；`--baseline` 跟旧版逐拍对比 |
| `scripts/check_richness.py` | 渲染之后 | 每 2.5 秒抽格：相邻格变化、几乎没变的接缝、在动帧、最长静止 + 联络表 |
| `scripts/verify_sync.py` | 渲染之后 | 音画同步（包络互相关），区分系统偏移和抖动 |
| `scripts/comfy_gen.py` | 闸门 0 + 每片出图（强制） | 出配图；`--check` 先自检服务与模型，`--dry-run` 给用户过提示词 |
| `scripts/bakeoff.py` | 定"看的层"之前 | 同一条 brief 按多套风格各出一张 + HTML 对比表，人来挑 |
| `scripts/sync_template.py` | 改了组件之后 | 模板 ↔ 项目的代码同步；`--check` 看漂移，`--push` 推到项目，`--pull` 回灌模板 |
| `scripts/scaffold.mjs` | 立项目 | 从模板复制出一个新工程 |
| `scripts/selftest.py` | 改过上面任何一个脚本之后 | 脚本自身的回归断言；只读文件，10 秒内跑完 |

一条命令跑完整条线（脚本都在 `scripts/` 里，路径换成你自己的）：

```bash
python scripts/comfy_gen.py --check --project .   # 0 出图链路（闸门 0）
python scripts/stills.py --project . --sheet       # 0 效果图（发图等确认）
python scripts/preflight.py --project .            # 1 体检（含配图拍数）
npm run tts                                        # 2 配音 + 时间轴（闸门 A 之后）
python scripts/stills.py --project . --sheet --tail   # 3 抽关键帧（闸门 B，发图等确认）
npm run render                                     # 4 整片（确认之后）
python scripts/check_motion.py --project . --baseline out/old.mp4   # 5 体检
python scripts/check_richness.py --project .       # 6 丰富度（每 2.5 秒一格）
python scripts/verify_sync.py --project .          # 7 同步校验
```
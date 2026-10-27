# 可读性硬指标（带出处）

> 画面都按 1920×1080 说。判断口径是**手机竖着看横屏视频**：画面缩到约 480 宽
> （1080 高缩成 270），1080p 上的像素乘 0.25 就是手机上的实际大小。
> 能自动查的项写进了 `scripts/check_rhythm.py`；查不了的（停留时间、纹理底上的
> 最不利处）在闸门 0 / 闸门 B 出静帧时人眼看。

## 一、字号

| 层 | 1080p | 手机上约 | 用在哪 | 出处 |
|---|---|---|---|---|
| 字幕 | **≥60px** | 15px | `CaptionTrack`，全片常驻 | 参考片实测；Netflix 简体字幕规范 |
| 主叙事 | 56–104px | 14–26px | `kinetic` / `quote` 的主句，组件按字数自适配 | 实测：低于 56 在手机小窗糊 |
| 关键信息 | **≥48px** | 12px | 数据格、标签、图注——观众要读的字 | 实测：S06 数据格 42 → 48、S22 标签 34 → 52 才读得清 |
| 标题 | **≥72px** | 18px | 片名、章节大字 | 经验；标题是远看的那一层 |
| 辅助 | ≥32px | 8px | 出处、页码、装饰小字 | 本 skill 的硬下限（`check_rhythm`） |

- 装饰字可以小于 32px，但**不能承载观众要读的信息**。出处、版权这类"想知道才看"的
  小字可以压到 32，再小就只当纹理。
- 不要靠"镜头推近"救小字：推近会切掉版式边缘（`camera` 幅度刻意压在 4% 内），
  它只用来临时强调，不是字号补偿。
- 改完字号先跑 `check_rhythm.py`，再出 480 宽的静帧看——数字达标不等于读得清。

## 二、对比度（WCAG 2.2 AA）

门槛（`Understanding SC 1.4.3` / `1.4.11`）：

- 正文 **4.5:1**；大字（≥24px，或 ≥18.5px 粗体）**3:1**；图形、箭头、色块边界 **3:1**。
- AAA 的 7:1 不作为门槛，但纸面正文实际都在 7 以上，够用。

本 skill 五支颜色的实测值（`scripts/check_rhythm.py` 会按 `theme.ts` 的现值重算）：

| 组合 | 比值 | 结论 |
|---|---|---|
| `ink` / `paper` | 15.17 | 正文，过 |
| `ink` / `paperAlt` | 12.59 | 卡片标题，过 |
| `ink` / `stage` | 9.96 | 直接落在底纸，过 |
| `inkSoft` / `paper` | 7.40 | 次要正文，过 |
| `inkSoft` / `stage` | 4.86 | 压在底纸上也过，但只剩 0.36 余量 |
| `nightInk` / `night` | 15.27 | quote 深底，过 |
| `accent` / `paper` | 4.29 | **只给大字 / 粗体**（≥3:1，不够正文） |
| `accent` / `paperAlt` | 3.56 | 同上，只给大字 |
| `gold` / `night` | 7.79 | 深底上的黄，过 |
| `gold` / `paper` | **1.96** | **不能当浅底文字**，只做纸片底 / 装饰 |
| `inkFaint` / `paper` | **2.93** | 次要标签也偏浅；读不清就换 `inkSoft` |

- 所以：`ink` / `inkSoft` 是文字色；`accent` 是记号色（划线、描边、大字关键词）；
  `gold` 和 `inkFaint` 不当浅底文字。红色面积超过 10% 就已经用滥了，见 `style.md`。
- 颗粒、渐变、网点底上的字按**最不利处**算，不够就给字加底（`PaperSheet` / 纸条）
  或改用深一档的字色（`inkSoft` → `ink`）。
- 自己改色后的验算（WCAG 相对亮度，同 `check_rhythm.py`）：

```bash
node -e 'const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};const[a,b]=process.argv.slice(1).map(L);console.log(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)+":1")' '#F6EFDD' '#1A1A1A'
```

## 三、字幕安全区

- 本风格的字幕是**一张纸**：96px 底距 + 单行约 119px 纸带（60px 字 + 上下 padding）
  ≈ 底部 **215px**（y ≥ 865）。版式组件给字幕留 220–240px。
- 两行字幕会长到约 300px。长句宁可在逗号处切短（`CaptionTrack` 的软断点上限 16 字），
  不要让字幕变两行去压住画面；`preflight.py` 把 `y > 78%` 当字幕带，批注落进去会提醒。
- EBU R 95 图文安全区：每边 5%（左右各 96、上下各 54）；动作安全区每边 3.5%。
  页眉区（左上角标 / 右上期数）同样当禁区，内容不进去。
- 回剪映还要再叠贴纸、字幕时，四周再多留一点。

## 四、停留时间

- 读速按 **9 字/秒**，读完再停约 0.5 秒：12 字的说明至少 `12/9 + 0.5 ≈ 1.8s`。
- Netflix 简体字幕规范：单行 ≤16 字、最多两行、能一行就一行。`CaptionTrack` 的
  `SOFT_MAX = 16` 就是这条；超过 32 字且没有逗号才会被迫整句上屏。
- 字幕跟旁白走：正常语速约 5–7 字/秒，比 9 慢，所以字幕一般来得及。把 `rate` 临时
  提到 +30% 以上时，先抽一帧看字幕是不是一闪而过。
- 画面上的标签不是字幕，同样按 9 字/秒留时间；讲完后让它留在画面上，不要提前撤。

## 五、怎么验

1. `python scripts/check_rhythm.py --project <项目> --src <模板 src>`：
   字号下限、字幕 60px、对比度三节都会打出来。
2. `python scripts/stills.py --project <项目> --sheet --scale 480`：联络表每格 480 宽，
   和手机同尺寸。字读不清就是不够大，别用原尺寸截图说服自己。
3. 改了色板或字号 → 先出关键帧，用户点头再渲整片（闸门 B）。

## 六、出处

1. W3C，*WCAG 2.2*，Understanding SC 1.4.3 Contrast (Minimum)、1.4.6 Contrast
   (Enhanced)、1.4.11 Non-text Contrast：<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
2. Netflix Partner Help Center，*Simplified Chinese (PRC) Timed Text Style Guide*，
   第 1、10、14 节：<https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007>
3. EBU，*R 95 Safe areas for 16:9 television production*，v1.1（2017-06）：
   <https://tech.ebu.ch/publications/r095>
4. 参考片实测：11 套样片里 S06 数据格 42 → 48、S22 标签 34 → 52、S09 数据短句
   改到 47 才在 480 宽检查图上读清；字幕 60px 是同一批样片的读数。

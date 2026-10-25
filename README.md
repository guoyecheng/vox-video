# vox-video

把一段中文旁白稿做成 VOX 风格解说视频的 skill：Remotion 渲染、Edge TTS 配音，画面跟着旁白逐词推进。

适用于支持 `SKILL.md` 的 agent（Qoder、opencode 等）。具体流程与硬规则都在 [SKILL.md](SKILL.md)，本文件只做总览。

## 两条硬规则

1. **音频是时钟**：永远不手写 `durationInFrames`。每拍先合成 mp3，用 ffprobe 实测时长生成 `src/timeline.json`，场景代码只读时间轴。
2. **两道确认闸门**：配音前确认分镜与事实（闸门 A），渲染前先看关键帧图片并等确认（闸门 B）。没过门不动手。

## 流程

```text
scaffold → script.json → preflight → TTS + timeline.json → stills → render → check_motion / verify_sync
立项目     写稿/分镜      体检         闸门 A 之后             闸门 B    整片       渲后自检
```

`script.json` 是唯一需要手写的文件，其余都由脚本推导。

## 目录

| 路径 | 作用 |
|---|---|
| `SKILL.md` | 主入口：完整流程、闸门、硬规则 |
| `assets/template/` | Remotion 模板工程，组件源码的唯一真相 |
| `assets/script.example.json` | `script.json` 带注释示例 |
| `assets/images.example.json` | 配图清单示例 |
| `assets/comfy/` | ComfyUI 工作流与模型文件名清单 |
| `references/` | 叙事弧、组件 props、ComfyUI、实测调优、排错手册 |
| `scripts/` | 流水线脚本 |
| `evals/` | 回归用例 |

## 环境要求

- Node.js 18+（推荐 20/22）
- Python 3.10+
- 可访问 Edge TTS 的网络
- 可选：ComfyUI（生成素材图）

`ffprobe` 由 Remotion 依赖自带；`edge-tts` 在首次配音时自动装进项目的 `.venv-tts`，不需要手动准备。

## 安装

把本目录挂到 agent 的 skills 目录。Qoder 示例：

Windows（目录联接，无需管理员权限）：

```bat
mklink /J "%USERPROFILE%\.qoder-cn\skills\vox-video" "C:\Users\<you>\.config\opencode\skills\vox-video"
```

macOS / Linux：

```bash
ln -s ~/.config/opencode/skills/vox-video ~/.qoder-cn/skills/vox-video
```

## 快速开始

```bash
# 1. 从模板立项目（已装过依赖的机器可加 --from <已有项目> 秒级完成）
node "<skill>/scripts/scaffold.mjs" --slug my-video --out "E:\AI\视频制作"

# 2. 编辑 <项目>/script.json，然后体检
python "<skill>/scripts/preflight.py" --project "<项目>"

# 3. 闸门 A 通过后配音 + 生成时间轴
python "<skill>/scripts/vox_tts.py" --project "<项目>"

# 4. 闸门 B：抽静帧给用户看
python "<skill>/scripts/stills.py" --project "<项目>" --sheet

# 5. 在项目目录渲染
cd "<项目>" && npm run render

# 6. 渲后自检
python "<skill>/scripts/check_motion.py" --project "<项目>"
python "<skill>/scripts/verify_sync.py" --project "<项目>"
```

## 脚本一览

| 脚本 | 时机 | 作用 |
|---|---|---|
| `preflight.py` | 配音前 | 校验 `script.json`：id 重复、kind 拼错、缺字段、图/字体缺失、枚举错误 |
| `vox_tts.py` | 闸门 A 后 | 合成配音，按实测音频生成 `timeline.json` |
| `stills.py` | 闸门 B | 按 beat 抽静帧 + HTML 联络表 |
| `check_rhythm.py` | 闸门 B 前 | 检查节奏单调、字号过小、类 CSS 动画 |
| `check_motion.py` | 渲染后 | 逐拍均差、九宫格、静止占比，可对比基线 |
| `verify_sync.py` | 渲染后 | 音画同步（包络互相关），区分系统偏移与抖动 |
| `comfy_gen.py` | 需要配图时 | 调 ComfyUI 出图，`--check` 自检服务与模型 |
| `bakeoff.py` | 定视觉风格前 | 同一 brief 多风格各出一张 + 对比表 |
| `sync_template.py` | 改过组件后 | 模板与项目代码同步（`--check` / `--push` / `--pull`） |
| `scaffold.mjs` | 立项目 | 从模板复制并安装依赖 |
| `selftest.py` | 改过脚本后 | 回归断言：kind 名单、转场规则、默认语速、报告字段、文档路径与锚点 |

## 模板同步

组件源码的唯一真相是 `assets/template/src/`，项目里的 `src/` 是副本。改完组件用 `sync_template.py` 同步，不要手工拷贝：`--check` 看漂移，`--push` 推到项目，`--pull --force` 回灌模板（回灌前自动备份到 `assets/template/.backup/`）。

## 许可

MIT，见 [LICENSE](LICENSE)。模板字体 Archivo Black 与 Noto Sans SC 遵循 SIL Open Font License。

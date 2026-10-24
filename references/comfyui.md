# ComfyUI 出图

给解说视频生成配图。可选步骤——没有 ComfyUI 也能出片，`ImageCard` 会退化成斜纹占位板。

## 前提

- ComfyUI 在跑，默认地址 `http://127.0.0.1:8188`（用 `--server` 或环境变量 `COMFY_URL` 改）
- 模型文件名登记在 `assets/comfy/models.json`
- 节点图在 `assets/comfy/workflows/*.json`，**API 格式**（不是 UI 里 Save 出来的 workflow）

先自检，别直接出图：

```bash
python "<skill>/scripts/comfy_gen.py" --check --project "<项目>"
```

它会核对：服务版本、显卡与显存、工作流文件在不在、工作流里的占位符有没有人提供、
每个模型文件是否真的在 ComfyUI 的可选项里、队列是否卡死、`images.json` 是否存在。
模型名对不上时会打印"同名的在：…"，照着改 `models.json` 即可。

### 服务没起来时自己拉（ComfyUI Desktop）

出图报 `WinError 10061`（连接被拒）= 服务没跑。桌面版的服务是独立进程，
可以直接用安装目录里的 venv 拉起来，不用开 GUI：

```powershell
# 1. 写一份额外的模型路径（桌面版用共享模型目录，不写就找不到 z_image_turbo）
#    D:\AI\ComfyUI-Shared\models\ 下的 checkpoints / diffusion_models / unet / vae / clip /
#    text_encoders / loras / controlnet ... 逐项映射到同名子目录
# 2. 起服务
& "D:\AI\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe" main.py `
  --extra-model-paths-config "<上面那份 yaml>" --windows-standalone-build --enable-assets --port 8188 `
  -WorkingDirectory "D:\AI\ComfyUI-Installs\ComfyUI\ComfyUI"
```

两个坑：
- yaml 里的 `custom_nodes` 路径**不能写**（不存在会直接 `FileNotFoundError` 崩在 prestartup）。
- 桌面版自己也在跑时会报 `Database is locked`——那是数据库被占，不是你的命令错了；
  等桌面版起来即可，别再起第二个。

## 清单 `images.json`

放项目根目录，结构见 `assets/images.example.json`。**一镜一条**，靠 `beat` 对回时间轴。

```jsonc
{
  "models": "z_image_turbo",
  "style_preset": "paper",
  "size": [1536, 864],
  "seed": 42,
  "items": [
    {
      "id": "shot05-road",
      "shot": 5,
      "beat": "road",
      "narration": "十几年后，南边的城墙上挂起了大明的旗。",
      "scene": {
        "camera": "低机位广角，地平线压在画面下三分之一",
        "subject": "一支很短的队伍沿黄土大道向北走，最前面的人扛着褪色的旗",
        "environment": "近景干裂的黄土地，中景三层灰纸远山，远景大片米色天空",
        "materials": "旗与人是撕边纸片；远山三层灰纸垫高、投影落右下；天空是整张米色纸",
        "light": "清晨侧逆光，光源左上，影子落右下",
        "color": "米白、赭石、灰蓝，低饱和",
        "text": []
      },
      "animation": "队伍前移，旗面像被风吹动一样清晰可感地摆动",
      "seed": 105
    }
  ]
}
```

- `models` 不写就是默认的 `z_image_turbo`。`workflow`、`steps`、`cfg` 一般也不用写——
  模型组里已经带着（Z-Image 8 步 / cfg 1.0，FLUX 4 步 / cfg 1.0）。
- `style_preset` 可选 `paper`（默认，纸艺拼贴微缩舞台）或 `vector`（扁平编辑插画）。
  **全片一份**，换了就等于换画风。单条要覆盖时在条目里写 `style` / `negative`。
- 老写法 `"prompt": "a lone courier on a dusty road"` 仍然能用，但不带文字规则；
  正文里给用户的清单建议一律写成 `scene`。
- **蒸馏模型（Z-Image / FLUX）cfg 是 1.0，负向提示词根本不起作用。**
  所以 `no text, no letters, no numbers` 必须写在 `style` 里，不能指望 `negative`。
  在 `negative` 里再写一遍也无害，换回非蒸馏模型时它才有用。
- `size` 默认 `[1536, 864]`（16:9）。`ImageCard` 是 16:9 + `objectFit: cover`，
  给别的比例会被裁掉两边或上下。
- `seed` 缺省时用 `基础 seed + 序号`。**落盘记录，重跑可复现。**
- `id` 决定文件名：`public/img/<id>.png`。在 `script.json` 里用两种方式接上：
  `"image": "img/<id>.png"`（任意 kind 当纸下压图，推荐）或
  `"kind": "image", "src": "img/<id>.png"`（整拍就是一张图 + 图注）。
  改完要重跑 `npm run tts`，Remotion 读的是生成物 `src/timeline.json`。
- `beat` 用来把图对回时间轴（`--only` 之外也靠它排查"这张图到底给哪一拍"）。
- `narration` 只是备注，让你写提示词时知道这一镜在说什么。
- `animation` 不是给这个脚本用的——它是留给人（或以后接图生视频）看的动作说明。

## 逐镜提示词模板

照 vox-full-pipeline 的 MG-VOXSTAGE 分镜写法，字段顺序固定，不合并、不换顺序：

| 字段 | 写什么 | 反例 |
| --- | --- | --- |
| `camera` | 机位、景别、地平线位置 | "好看的构图" |
| `subject` | 画面里只有这一个主体，写清朝向和数量 | "一群人和一些东西" |
| `environment` | 前/中/远景各有什么，留白在哪边 | 只写主体，环境一片空白 |
| `materials` | **具体到纸**：厚纸板、牛皮纸、卷出的瓦垄、撕边 | "纸艺风格" |
| `light` | 光源方向 + 投影方向（两者必须一致） | "光线很好" |
| `color` | 3-4 个色名 + 饱和度 | "配色高级" |
| `text` | **允许出现的字**，一个字一个元素；不写字就留 `[]` | 忘了写，模型自己往匾额上塞乱码 |

三条硬规矩：

1. **文字必须先列白名单。** 只写"不要文字"时，模型依旧会把匾额、旗面、卷轴填上乱码；
   写了"允许出现的文字仅限：崇祯"，它才知道其余位置该留白。脚本会自动补这句。
2. **材料本体不能带纸感。** 石板、金属、木料、陶器要写"平直裁切 + 见厚度 + 不卷翘"，
   否则拼贴风会给所有东西画上撕边和卷角，硬物看起来像纸片。
3. **一处细节只出现一次。** 同一个元素不要既写进 `subject` 又写进 `environment`，
   重复描述会让模型把它画两遍。

先看拼好的提示词，不提交：

```bash
python "<skill>/scripts/comfy_gen.py" --project "<项目>" --dry-run
```

`--dry-run` 会打印拼好的整条 prompt（白名单那句也在里面）。**出图前把这一屏给用户过一遍**，
并入闸门 A；图出来后并进闸门 B 的静帧。

## 出图

```bash
# 先看提示词和参数，不提交
python "<skill>/scripts/comfy_gen.py" --project "<项目>" --dry-run

# 正式出图（已存在的跳过）
python "<skill>/scripts/comfy_gen.py" --project "<项目>"

# 只重抽某几张
python "<skill>/scripts/comfy_gen.py" --project "<项目>" --only hook-road,palace-courtyard --force
```

产物：

- `public/img/<id>.png`
- `public/img/_generated.json` — 每条的实际 prompt、seed、尺寸、耗时、ComfyUI 任务 id。
  改提示词后回滚、或者想复现某张图，看这里。

## 换模型 / 加工作流

分三种情况，按改动量从小到大。

### A. 同架构换权重 —— 只改 `models.json`

比如 Z-Image-Turbo 换一个社区微调版。工作流一个字都不用动，只加一组：

```jsonc
"z_image_turbo_anime": {
  "workflow": "z_image_turbo_t2i",
  "unet": "z_image_turbo_anime_v2.safetensors",
  "clip": "qwen_3_4b_fp8_mixed.safetensors",
  "vae": "ae.safetensors",
  "steps": 8,
  "cfg": 1.0
}
```

组里的 `steps` / `cfg` 是这一组的默认值，`images.json` 里可以逐条覆盖。
`images.json` 写 `"models": "z_image_turbo_anime"` 就切过去了。模型组对**整份清单**生效，
不逐条切换；一部片子里要混用两套，就跑两遍、用 `--models` + `--only` 分批出图：

```bash
python "<skill>/scripts/comfy_gen.py" --project "<项目>" --models z_image_turbo_anime --only a,b
```

### B. 换架构（SD1.5 / SDXL / Flux …）—— 加工作流 + 加模型组

节点图不一样，必须新增一套：

1. 在 ComfyUI 里搭好图，用 **Save (API Format)** 导出 JSON，
   放进 `assets/comfy/workflows/sdxl_ckpt_t2i.json`（文件名就是工作流名）。
2. 把会变的字段换成占位符（见下表）；确认图是自包含的：
   加载器 → 编码 → 采样 → 解码 → `SaveImage`。
3. `models.json` 加一组，随便起字段名，字段名就是占位符名：

```jsonc
"sdxl_juggernaut": {
  "workflow": "sdxl_ckpt_t2i",
  "ckpt": "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
}
```

工作流里对应写 `"ckpt_name": "{{ckpt}}"`。
4. `--check`（会拿 `CheckpointLoaderSimple.ckpt_name` 核对文件名）→ 出图。

### C. 临时覆盖

`--workflow xxx` 覆盖清单里的工作流名，配 `--only` 可以只重抽某几张。

### 占位符全集

| 占位符 | 来源 |
| --- | --- |
| `{{prompt}}` | 条目 `prompt` + `style` 拼接 |
| `{{negative}}` | 条目 → 清单 → 空 |
| `{{seed}}` `{{steps}}` `{{cfg}}` | 条目 → 清单 → 默认（42 / 20 / 2.5） |
| `{{width}}` `{{height}}` | `size`，默认 1536×864 |
| `{{id}}` | 条目 id，已清洗成安全文件名 |
| **模型组里的任意字段** | `unet` `clip` `vae` `ckpt` `lora` … 组里写什么字段就能用什么占位符 |

两条规则：

- **整串占位符**（字段值只有 `{{seed}}`）保留数字类型（int/float）；混在字符串里
  只做文本替换。所以采样器的 `seed`/`steps`/`cfg` 要写整串。
- 文件名必须是 ComfyUI 下拉框里的相对路径（含子目录）。`--check` 对不上时会提示
  "同名的在：…"，照抄即可。

保存节点必须是 `SaveImage`（或带 `images` 输出的同类节点），脚本靠它取文件名。

> 本机（Arc B580 / XPU）SDXL 会打崩设备，见下节。现有的三组：
> `z_image_turbo`（默认）、`flux_schnell_gguf`、`qwen_image_2_1`。
> 换到 NVIDIA 机器，B 方案就是标准做法。

## 用哪套模型

| 模型组 | 许可 | 1536×864 实测 | 风格贴合 | 备注 |
| --- | --- | --- | --- | --- |
| `z_image_turbo` | Apache 2.0 | **38 秒**（8 步） | 好 | **默认**。扁平插画、留白、构图都听话 |
| `flux_schnell_gguf` | Apache 2.0 | 108 秒（4 步） | 一般 | 容易自己"写实化"，要多写 style 约束 |
| `qwen_image_2_1` | 不可商用 | 67 秒（20 步） | 好 | 只留作对照，**不要用在要发布的片子里** |

许可这块以模型官方页面为准，换模型前自己确认一遍。默认值在
`scripts/comfy_gen.py` 的 `DEFAULT_MODEL`，改一处即可。

## 已知问题

### XPU（Intel Arc）上 SDXL 会打崩设备

在本机（Arc B580 / PyTorch 2.14.0+xpu）实测：SDXL 工作流在 `CLIPTextEncode`
阶段抛 `level_zero backend failed with error: 20 (UR_RESULT_ERROR_DEVICE_LOST)`，
之后 **ComfyUI 的 HTTP 还在响应，但执行器已经死了**——新任务永远停在 pending。

判断方法：

```bash
curl http://127.0.0.1:8188/queue
# running 为空、pending 有东西 = 执行器卡死
```

脚本内置了这个检测：任务排队但没人执行、持续 90 秒就报错退出，不会干等到超时。
**唯一的修法是重启 ComfyUI**（桌面版 Quit 后重开）。重启前先清队列：

```bash
curl -X POST http://127.0.0.1:8188/queue -d '{"clear":true}'
```

所以本机不要切 SDXL。要写实风格就用 FLUX schnell，别碰 SDXL。

### 出图速度

B580 / 1536×864 实测：**Z-Image-Turbo 38 秒 / FLUX schnell 108 秒 / Qwen 67 秒**。
一批 6 张大约 4–11 分钟，出图期间不要并发跑渲染抢显存。

### 模型名对不上

`--check` 会列出来。ComfyUI 的可选项就是 `models/checkpoints`、
`models/diffusion_models`、`models/text_encoders`、`models/vae` 下的相对路径，
子目录要带上（例如 `Lykon---DreamShaper\DreamShaper_8_pruned.safetensors`）。

## 内容规矩

- **默认不让模型画字。** 所有文字都由 Remotion 渲染，模型只出画面；
  `scene.text` 白名单只在确实需要"画在画面里的实物文字"（匾额、旗号）时才填。
- **历史题材走"插画/象征"，不做"伪史料照片"。** 生成一张"崇祯上吊"的写实图，
  观众会当成史料；生成一张象征性的空宫殿、断弓、倾覆的灯，不会误导。
- **人物脸不要写实。** 真实历史人物没有可信的肖像参考，写实脸等于编造。
- 出图前把 `images.json` 的**提示词清单**一起给用户确认（并入闸门 A）；
  图出来后在闸门 B 的静帧里一并看。

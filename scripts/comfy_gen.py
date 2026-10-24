#!/usr/bin/env python3
"""
ComfyUI 出图客户端：把 images.json 里的提示词逐条提交给本地 ComfyUI，
下载生成的图到 <project>/public/img/。

设计原则：
  * 薄客户端。节点图在 assets/comfy/workflows/*.json（API 格式），
    脚本只负责替换占位符、提交、轮询、下载。换模型只换 JSON。
  * 可复现。每条都记录 seed 和最终 prompt 到 _generated.json，
    重跑同一份清单能得到同一批图。
  * 失败要说得清。ComfyUI 的节点报错、执行器卡死、模型缺失，
    都给出能直接照做的下一步，而不是干等超时。

用法：
  python comfy_gen.py --check --project <项目>
  python comfy_gen.py --project <项目> --dry-run
  python comfy_gen.py --project <项目>
  python comfy_gen.py --project <项目> --only hook,road --force
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
COMFY_DIR = SKILL_ROOT / "assets" / "comfy"

DEFAULT_SERVER = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
# 默认模型组。商用选 Apache 2.0 的 Z-Image-Turbo；
# Qwen-Image 的权重不可商用，只留作对照。
DEFAULT_MODEL = "z_image_turbo"
POLL_SECONDS = 1.5
# 执行器卡死判定：任务在 pending、running 为空，持续这么久就报错退出
STALL_SECONDS = 90


# ---------------------------------------------------------------- 基础 IO

def log(msg: str) -> None:
    print(msg, flush=True)


def read_json(path: Path):
    # utf-8-sig：Windows 记事本 / PowerShell 存出来的 JSON 常带 BOM，
    # 用 utf-8 读会直接抛 "Unexpected UTF-8 BOM"，那种报错没人看得懂
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------- HTTP

class Comfy:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def _request(self, path: str, payload=None, timeout: int = 30):
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    def stats(self):
        return self._request("/system_stats")

    def object_info(self, node: str):
        return self._request(f"/object_info/{node}")

    def queue(self):
        return self._request("/queue")

    def submit(self, prompt: dict) -> str:
        res = self._request("/prompt", {"prompt": prompt, "client_id": str(uuid.uuid4())})
        if "prompt_id" not in res:
            raise RuntimeError(f"ComfyUI 拒绝了任务：{json.dumps(res, ensure_ascii=False)[:500]}")
        return res["prompt_id"]

    def history(self, prompt_id: str):
        h = self._request(f"/history/{prompt_id}")
        return h.get(prompt_id)

    def download(self, filename: str, subfolder: str, kind: str, dest: Path) -> None:
        q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": kind})
        with urllib.request.urlopen(f"{self.base}/view?{q}", timeout=120) as r:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.read())


# ---------------------------------------------------------------- 工作流

PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")
NUMERIC = {"seed", "steps", "cfg", "width", "height", "denoise", "batch_size"}


def fill(node, values: dict):
    """把 {{key}} 换成真实值。整串就是占位符时保留原类型（int/float）。"""
    if isinstance(node, dict):
        return {k: fill(v, values) for k, v in node.items()}
    if isinstance(node, list):
        return [fill(v, values) for v in node]
    if not isinstance(node, str):
        return node

    whole = PLACEHOLDER.fullmatch(node)
    if whole:
        key = whole.group(1)
        if key not in values:
            raise KeyError(f"工作流占位符 {{{{{key}}}}} 没有对应的值")
        return values[key]

    def repl(m):
        key = m.group(1)
        if key not in values:
            raise KeyError(f"工作流占位符 {{{{{key}}}}} 没有对应的值")
        return str(values[key])

    return PLACEHOLDER.sub(repl, node)


def coerce_numeric(prompt: dict) -> dict:
    """占位符如果写成整串会保留类型；这里兜底把字符串数字转回来。"""
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        for key in list(inputs):
            val = inputs[key]
            if key in NUMERIC and isinstance(val, str) and val.strip() != "":
                try:
                    inputs[key] = float(val) if "." in val else int(val)
                except ValueError:
                    pass
    return prompt


def load_workflow(name: str) -> dict:
    path = COMFY_DIR / "workflows" / f"{name}.json"
    if not path.exists():
        available = sorted(p.stem for p in (COMFY_DIR / "workflows").glob("*.json"))
        raise SystemExit(f"[comfy] 找不到工作流 {name}.json，可用：{', '.join(available) or '（无）'}")
    return read_json(path)


# ---------------------------------------------------------------- 检查

# 模型组里的字段 → 可能落在哪个加载器的哪个下拉框。
# 换架构时这里没登记的新字段会退化成"在所有加载器里找一遍"，不会误报。
LOADER_FIELDS = {
    "ckpt": [("CheckpointLoaderSimple", "ckpt_name")],
    "unet": [("UNETLoader", "unet_name"), ("UnetLoaderGGUF", "unet_name")],
    "clip": [("CLIPLoader", "clip_name"), ("DualCLIPLoader", "clip_name1")],
    "clip2": [("DualCLIPLoader", "clip_name2")],
    "vae": [("VAELoader", "vae_name")],
}

_options_cache: dict = {}


def loader_options(comfy: "Comfy", node: str, field: str):
    """取某个节点某个下拉框的可选项。节点没装（比如缺 GGUF 扩展）就返回 None。"""
    key = (node, field)
    if key in _options_cache:
        return _options_cache[key]
    try:
        info = comfy.object_info(node)
        inp = info[node]["input"]
        spec = (inp.get("required") or {}).get(field) or (inp.get("optional") or {}).get(field)
        opts = spec[0] if isinstance(spec, list) and spec and isinstance(spec[0], list) else None
    except Exception:  # noqa: BLE001
        opts = None
    _options_cache[key] = opts
    return opts


def check_model_name(comfy: "Comfy", key: str, value: str) -> bool:
    pairs = LOADER_FIELDS.get(key)
    if pairs is None:
        pairs = [p for group in LOADER_FIELDS.values() for p in group]

    seen: list = []
    matched = None
    for node, field in pairs:
        opts = loader_options(comfy, node, field)
        if opts is None:
            continue
        seen += opts
        if value in opts:
            matched = f"{node}.{field}"
            break

    if matched:
        log(f"[comfy]   √ {key} = {value}  ({matched})")
        return True

    if not seen:
        log(f"[comfy]   ! 认不出 {key} = {value}（没有可查的加载器节点，跳过）")
        return True

    log(f"[comfy]   x 缺少 {value}（{key}）")
    near = sorted({o for o in seen if Path(o).name == Path(value).name})
    if near:
        log(f"[comfy]     同名的在：{near[0]}")
    log("[comfy]     把 assets/comfy/models.json 里的文件名改成实际的可选项")
    return False


def check(comfy: Comfy, project: Path) -> int:
    log("[comfy] 检查服务 …")
    try:
        stats = comfy.stats()
    except Exception as exc:  # noqa: BLE001
        log(f"[comfy] x 连不上 {comfy.base}：{exc}")
        log("[comfy]   先启动 ComfyUI（桌面版点 Start，或命令行 python main.py），再重试")
        return 1

    version = stats.get("system", {}).get("comfyui_version", "?")
    log(f"[comfy] √ ComfyUI {version}")

    for dev in stats.get("devices", []):
        total = dev.get("vram_total", 0) / 1024**3
        log(f"[comfy] √ {dev.get('type')}:{dev.get('index')} {dev.get('name')} · VRAM {total:.1f} GB")

    models = read_json(COMFY_DIR / "models.json")
    ok = True
    for profile, spec in models.items():
        if profile.startswith("//"):
            continue
        log(f"[comfy] 检查模型组 {profile} …")

        wf_name = spec.get("workflow")
        wf_path = COMFY_DIR / "workflows" / f"{wf_name}.json" if wf_name else None
        if not wf_path or not wf_path.exists():
            ok = False
            log(f"[comfy]   x 找不到工作流 {wf_name or '（未指定）'}")
        else:
            log(f"[comfy]   √ 工作流 {wf_name}")
            every = {"prompt", "negative", "width", "height", "seed", "steps", "cfg", "id"}
            missing = set()
            for node in read_json(wf_path).values():
                for val in (node.get("inputs") or {}).values():
                    if isinstance(val, str):
                        missing |= set(PLACEHOLDER.findall(val))
            missing -= every | {k for k, v in spec.items() if isinstance(v, str)}
            if missing:
                ok = False
                log(f"[comfy]   x 工作流里的占位符没人提供：{', '.join(sorted(missing))}")

        for key, value in spec.items():
            if key == "workflow" or not isinstance(value, str):
                continue
            if not check_model_name(comfy, key, value):
                ok = False

    try:
        q = comfy.queue()
        running, pending = len(q.get("queue_running", [])), len(q.get("queue_pending", []))
        log(f"[comfy] 队列：running={running} pending={pending}")
        if pending and not running:
            log("[comfy] ! 有任务在排队但没有任务在跑——执行器可能已经卡死，需要重启 ComfyUI")
    except Exception as exc:  # noqa: BLE001
        log(f"[comfy] ! 读不到队列：{exc}")

    img_dir = project / "public" / "img"
    log(f"[comfy] 输出目录：{img_dir}")
    manifest = project / "images.json"
    log(f"[comfy] 清单：{manifest} {'√' if manifest.exists() else '(不存在，出图前要写)'}")
    return 0 if ok else 1


# ---------------------------------------------------------------- 出图

def wait_for(comfy: Comfy, prompt_id: str, timeout: int) -> dict:
    started = time.time()
    stalled_since = None

    while True:
        item = comfy.history(prompt_id)
        if item:
            status = item.get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                detail = ""
                for msg in messages:
                    if msg and msg[0] == "execution_error":
                        d = msg[1]
                        detail = (
                            f"节点 {d.get('node_id')} ({d.get('node_type')}) 失败："
                            f"{d.get('exception_message', '').strip()}"
                        )
                        break
                raise RuntimeError(detail or json.dumps(status, ensure_ascii=False)[:800])
            if status.get("completed"):
                return item

        # 卡死检测：有任务在排队、却没有任务在跑，且持续超过阈值
        try:
            q = comfy.queue()
            running = len(q.get("queue_running", []))
            pending = q.get("queue_pending", [])
            mine = any(row and len(row) > 1 and row[1] == prompt_id for row in pending)
            if mine and running == 0:
                stalled_since = stalled_since or time.time()
                if time.time() - stalled_since > STALL_SECONDS:
                    raise RuntimeError(
                        "ComfyUI 执行器卡死：任务一直在排队但没有执行。"
                        "重启 ComfyUI 后再跑一次（常见于 XPU 后端崩溃后）。"
                    )
            else:
                stalled_since = None
        except RuntimeError:
            raise
        except Exception:  # noqa: BLE001
            pass

        if time.time() - started > timeout:
            raise TimeoutError(f"等待出图超过 {timeout}s")
        time.sleep(POLL_SECONDS)


# ---- 逐镜提示词模板 -------------------------------------------------------
#   镜头语言 → 主体 → 环境层次 → 材质 → 光线 → 色彩 → 允许出现的文字
# 顺序固定不是为了好看：同一部片子里每张图用同一种描述顺序，风格漂移会小很多。
#
# 文字规则是这套模板最值钱的一条——**先列允许出现的字，其余一律禁止**。
# 只写 "no text" 时模型照样会往匾额、旗面、卷轴上塞乱码；给了允许清单，
# 它才知道哪些位置必须留白。
STYLE_PRESETS = {
    "paper": {
        "style": (
            "MG-VOXSTAGE 风格的 3D 纸艺拼贴微缩舞台：多层切口纸片叠出前后景深，"
            "纸片有真实厚度（侧边可见）、柔和投影和纸张纤维；撕边、毛边、卷角是纸片该有的质感，"
            "但硬质材料（石板、金属、木料、器物）必须读出固体状态：平直裁切、有厚度、不卷翘。"
            "摆拍感、手工痕迹、自然的不完美，冷调柔和布光"
        ),
        "negative": (
            "文字, 字母, 数字, 水印, 签名, logo, 字幕, 标题, 乱码, 错字, "
            "照片, 写实摄影, 3D 渲染塑料感, 平滑渐变, 玻璃质感, 高光过曝, "
            "低清晰度, 模糊, 变形, 多余肢体, 手部畸形, 现代物品, 版权角色"
        ),
    },
    # ---- 纸艺系的其他"看的层"：同一部片子换一套配色/质感/情绪 ----
    "paper-ink": {
        "style": (
            "宣纸水墨拼贴舞台：宣纸底上以水墨渲染的层叠剪影，焦墨与淡墨分出前后层次，"
            "朱砂点染提神；纸面纤维与墨的渗化清晰可见，边缘是手撕纸的毛边；"
            "硬质材料（石板、金属、木料、器物）必须读出固体状态：平直裁切、有厚度、不卷翘；"
            "留白多、气质清冷安静"
        ),
        "negative_extra": "油画笔触, 厚涂, 鲜艳渐变, 彩色, 3D 塑料感, 柔焦, 梦幻光晕, 照片写实",
    },
    "paper-newsprint": {
        "style": (
            "旧报刊拼贴舞台：米白新闻纸底，深红与芥黄油墨，厚重半调网点，"
            "轻微套印偏移与油墨压痕；撕边纸片有真实厚度与投影；"
            "硬质材料保持平直裁切的块面，不做圆润建模；"
            "高对比、紧实、有编辑部的急促感"
        ),
        "negative_extra": "柔和渐变, 柔光, 景深虚化, 梦幻, 3D 光滑塑料, 彩色照片, "
                          "报纸排版正文, 书刊文字, 可读文字, 标语条, 号码",
    },
    "paper-poster": {
        "style": (
            "复古宣传画拼贴舞台：红、黑、米白三色油墨，强对角几何构成，"
            "块面硬朗、边缘是模切纸片的直边与毛边混合，套色印刷的轻微错位；"
            "硬质材料用几何化块面表达，不做写实纹理；"
            "气势强烈、张力足、适合断言式大字"
        ),
        "negative_extra": "柔和渐变, 圆润造型, 写实材质纹理, 照片, 粉彩色调, 柔光",
    },
    "paper-zine": {
        "style": (
            "地下朋克 zine 拼贴舞台：黑白复印机噪点，一个荧光酸绿作为唯一亮色，"
            "粗黑描边、剪贴字块般的几何碎片、复印错位与油墨污渍；"
            "硬质材料用高对比黑白块面加荧光色勾边；"
            "粗粝、躁动、反主流"
        ),
        "negative_extra": "彩色, 柔和渐变, 精致整洁, 3D 渲染, 照片, 干净背景, 明亮",
    },
    "paper-washi": {
        "style": (
            "淡雅和纸拼贴舞台：米白与浅灰蓝、极淡赭色，纸片边缘柔韧微卷、纤维可见、投影轻；"
            "构图标静、留白多；硬质材料以素净块面与薄厚度呈现；"
            "克制、清透、留白呼吸"
        ),
        "negative_extra": "高对比, 强烈撞色, 黑色主导, 厚重阴影, 3D 塑料感, 照片写实",
    },
    "vector": {
        "style": (
            "flat vector editorial illustration, muted paper palette of cream ochre and slate, "
            "minimal geometric shapes, soft paper grain, wide empty compositional space, "
            "no text, no letters, no numbers, no watermark"
        ),
        "negative": (
            "text, letters, numbers, watermark, signature, logo, caption, subtitle, "
            "blurry, low quality, deformed, extra limbs, photorealistic, 3d render"
        ),
    },
}

DEFAULT_PRESET = "paper"

# 所有预设共用的负面词。预设可以在 negative_extra 里再追加自己的。
COMMON_NEGATIVE = (
    "文字, 字母, 数字, 水印, 签名, logo, 字幕, 标题, 乱码, 错字, "
    "照片, 写实摄影, 3D 渲染塑料感, 平滑渐变, 玻璃质感, 高光过曝, "
    "低清晰度, 模糊, 变形, 多余肢体, 手部畸形, 现代物品, 版权角色"
)


def scene_prompt(item: dict) -> str:
    """把逐镜 brief（scene 字段）拼成一条完整提示词。"""
    scene = item.get("scene") or {}
    parts = []

    shot = item.get("shot")
    if shot not in (None, ""):
        try:
            parts.append(f"【镜头{int(shot):02d}】")
        except (TypeError, ValueError):
            parts.append(f"【镜头{shot}】")

    for key in ("camera", "subject", "environment", "materials", "light", "color"):
        text = (scene.get(key) or "").strip()
        if not text:
            continue
        parts.append(text if text.endswith(("。", ".", "；")) else text + "。")

    allowed = scene.get("text") or []
    if isinstance(allowed, str):
        allowed = [allowed]
    allowed = [str(t).strip() for t in allowed if str(t).strip()]
    if allowed:
        parts.append(
            "画面允许出现的文字仅限："
            + "、".join(allowed)
            + "；这些字必须笔画完整、简体中文、不重叠、不做艺术变形，"
            "画面里不得出现其他任何文字、字母、数字、水印。"
        )
    else:
        parts.append("画面内不出现任何文字、字母、数字、水印。")

    return "".join(parts)


def build_values(item: dict, cfg: dict, models: dict, index: int) -> dict:
    # 两种写法都支持：老的 prompt 单句，或新的 scene 逐镜 brief
    prompt = scene_prompt(item) if item.get("scene") else item.get("prompt", "").strip()
    if not prompt:
        raise ValueError(f"清单项 {item.get('id')} 既没有 prompt 也没有 scene")

    # 预设三级优先：单条 brief > 清单全局 > 默认。
    # 单条覆盖是 bake-off 的基础——同一条 brief 要按不同风格各出一张。
    preset_name = (item.get("style_preset") or cfg.get("style_preset") or DEFAULT_PRESET).strip()
    preset = STYLE_PRESETS.get(preset_name) or STYLE_PRESETS[DEFAULT_PRESET]
    style = (item.get("style") or cfg.get("style") or preset["style"]).strip()
    full_prompt = f"{prompt}, {style}" if style else prompt

    preset_negative = preset.get("negative") or (
        COMMON_NEGATIVE + preset.get("negative_extra", "")
    )
    negative = item.get("negative") or cfg.get("negative") or preset_negative

    size = item.get("size") or cfg.get("size") or [1536, 864]
    width, height = int(size[0]), int(size[1])

    seed = item.get("seed")
    if seed is None:
        seed = int(cfg.get("seed", 42)) + index

    values = {
        "prompt": full_prompt,
        "negative": negative,
        "width": width,
        "height": height,
        "seed": int(seed),
        "steps": int(item.get("steps") or cfg.get("steps") or models.get("steps") or 20),
        "cfg": float(item.get("cfg") or cfg.get("cfg") or models.get("cfg") or 2.5),
        "id": re.sub(r"[^\w.-]+", "_", item["id"]),
    }
    # 模型组里的**每个字符串字段**都能直接当占位符：unet / clip / vae / ckpt / lora …
    # 换架构时只改 models.json 和工作流，不用回来改脚本。
    for key, val in models.items():
        if key != "workflow" and isinstance(val, str):
            values[key] = val
    return values


def generate(comfy: Comfy, project: Path, manifest_path: Path, args) -> int:
    if not manifest_path.exists():
        log(f"[comfy] x 找不到清单 {manifest_path}")
        log("[comfy]   照着 assets/images.example.json 写一份放到项目根目录")
        return 1

    cfg = read_json(manifest_path)
    if args.preset:
        cfg["style_preset"] = args.preset
    items = cfg.get("items") or []
    if not items:
        log("[comfy] 清单里没有 items")
        return 1

    models_all = read_json(COMFY_DIR / "models.json")
    profile_name = args.models or cfg.get("models", DEFAULT_MODEL)
    if profile_name.startswith("//"):
        profile_name = DEFAULT_MODEL
    models = models_all.get(profile_name)
    if not models:
        log(f"[comfy] x models.json 里没有模型组 {profile_name}")
        return 1

    workflow_name = cfg.get("workflow") or models.get("workflow")
    if args.workflow:
        workflow_name = args.workflow
    if not workflow_name:
        log("[comfy] x 没有指定 workflow")
        return 1
    workflow = load_workflow(workflow_name)

    only = {s.strip() for s in args.only.split(",")} if args.only else None
    img_dir = project / "public" / "img"
    record_path = img_dir / "_generated.json"
    record = read_json(record_path) if record_path.exists() else {}

    done, failed = 0, []
    for index, item in enumerate(items):
        item_id = item.get("id")
        if not item_id:
            log(f"[comfy] ! 第 {index} 项没有 id，跳过")
            continue
        if only and item_id not in only:
            continue

        values = build_values(item, cfg, models, index)
        slug = values["id"]
        dest = img_dir / f"{slug}.png"

        if dest.exists() and not args.force:
            log(f"[comfy] · {item_id} 已存在，跳过（--force 覆盖）")
            continue

        if args.dry_run:
            log(f"[comfy] [dry] {item_id} {values['width']}x{values['height']} "
                f"seed={values['seed']} steps={values['steps']} cfg={values['cfg']}")
            log(f"         prompt: {values['prompt']}")
            continue

        prompt = coerce_numeric(fill(workflow, values))
        t0 = time.time()
        try:
            prompt_id = comfy.submit(prompt)
            log(f"[comfy] … {item_id} 已提交 ({values['width']}x{values['height']}, "
                f"seed={values['seed']}, {prompt_id[:8]})")
            item_hist = wait_for(comfy, prompt_id, args.timeout)
        except Exception as exc:  # noqa: BLE001
            log(f"[comfy] x {item_id} 失败：{exc}")
            failed.append(item_id)
            continue

        images = []
        for node_out in item_hist.get("outputs", {}).values():
            images.extend(node_out.get("images", []))
        if not images:
            log(f"[comfy] x {item_id} 完成但没有产出图片")
            failed.append(item_id)
            continue

        img = images[0]
        try:
            comfy.download(img["filename"], img.get("subfolder", ""), img.get("type", "output"), dest)
        except Exception as exc:  # noqa: BLE001
            log(f"[comfy] x {item_id} 下载失败：{exc}")
            failed.append(item_id)
            continue

        seconds = round(time.time() - t0, 1)
        done += 1
        log(f"[comfy] √ {item_id} -> public/img/{slug}.png ({seconds}s)")

        record[slug] = {
            "id": item_id,
            "beat": item.get("beat"),
            "shot": item.get("shot"),
            "file": f"img/{slug}.png",
            "prompt": values["prompt"],
            "negative": values["negative"],
            "seed": values["seed"],
            "width": values["width"],
            "height": values["height"],
            "steps": values["steps"],
            "cfg": values["cfg"],
            "workflow": workflow_name,
            "models": profile_name,
            "comfy_prompt_id": prompt_id,
            "seconds": seconds,
        }
        write_json(record_path, record)

    if args.dry_run:
        log("[comfy] dry-run 结束，没有提交任何任务")
        return 0

    log(f"[comfy] 完成：{done} 张新图" + (f"，失败 {len(failed)}：{', '.join(failed)}" if failed else ""))
    log(f"[comfy] 记录：{record_path}")
    return 1 if failed else 0


def list_presets() -> None:
    for name, preset in STYLE_PRESETS.items():
        mark = "（默认）" if name == DEFAULT_PRESET else ""
        head = preset.get("style", "")[:46].replace("\n", " ")
        print(f"  {name:<16} {mark}{head}...")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="用本地 ComfyUI 批量生成解说视频配图")
    ap.add_argument("--project", default=".", help="项目根目录（含 script.json / public/）")
    ap.add_argument("--manifest", default=None, help="默认 <project>/images.json")
    ap.add_argument("--server", default=DEFAULT_SERVER, help=f"默认 {DEFAULT_SERVER}")
    ap.add_argument("--workflow", default=None, help="覆盖清单里的 workflow 名")
    ap.add_argument("--models", default=None, help="覆盖清单里的模型组名")
    ap.add_argument(
        "--preset",
        default=None,
        choices=sorted(STYLE_PRESETS),
        help=f"风格预设，默认取清单 style_preset（缺省 {DEFAULT_PRESET}）",
    )
    ap.add_argument("--check", action="store_true", help="只检查服务、模型和清单")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要用的提示词和参数")
    ap.add_argument("--only", default=None, help="只跑这些 id，逗号分隔")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的图")
    ap.add_argument("--timeout", type=int, default=600, help="单张超时秒数，默认 600")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not project.exists():
        log(f"[comfy] x 项目目录不存在：{project}")
        return 1
    manifest = Path(args.manifest).resolve() if args.manifest else project / "images.json"
    comfy = Comfy(args.server)

    if args.check:
        return check(comfy, project)
    return generate(comfy, project, manifest, args)


if __name__ == "__main__":
    sys.exit(main())

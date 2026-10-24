#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bake-off：同一条 brief 按多套风格各出一张，出一张对比联络表给人挑。

为什么需要它
------------
"哪套风格好看"是**眼睛**决定的事，不是推理决定的事。
让模型一次定死风格，赌的是运气；让模型出五张摆在一起，人 3 秒就能挑出来。

用法
----
    # 从项目 images.json 里挑一条 brief 做对比
    python scripts/bakeoff.py --project <项目目录> --beat shot06-tumu-far

    # 自己给一条 brief（JSON 文件，格式同 images.json 的一项）
    python scripts/bakeoff.py --project <项目目录> --scene-file my-scene.json

    # 指定要比的风格（默认：全部纸艺系预设）
    python scripts/bakeoff.py --project <目录> --beat xxx --presets paper,paper-ink,paper-newsprint

产物
----
    public/img/_bakeoff/<id>--<preset>.png   每种风格一张
    out/bakeoff/sheet.html                   对比联络表（浏览器打开）

同一条 brief 用**同一个 seed** 出所有风格——否则风格和随机性混在一起，
人挑出来的是"这张运气好"，不是"这套风格好"。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

import comfy_gen as cg  # noqa: E402


PAPER_PRESETS = [
    "paper",
    "paper-ink",
    "paper-newsprint",
    "paper-poster",
    "paper-zine",
    "paper-washi",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def find_item(cfg: dict, beat: str) -> dict | None:
    """按 id 找 brief。允许前缀模糊匹配（shot06 命中 shot06-tumu-far）。"""
    items = cfg.get("items") or []
    for it in items:
        if it.get("id") == beat:
            return it
    hits = [it for it in items if str(it.get("id", "")).startswith(beat)]
    if len(hits) == 1:
        return hits[0]
    return None


def build_sheet(out_dir: Path, rows: list[dict]) -> Path:
    """出一张 HTML 联络表。HTML 比拼图稳：Remotion 自带的 ffmpeg 没有 tile 滤镜。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet = out_dir / "sheet.html"

    cards = []
    for r in rows:
        rel = r["file"].relative_to(out_dir).as_posix()
        cards.append(
            f"""    <figure class="c">
      <img src="{rel}" alt="{r['preset']}">
      <figcaption><b>{r['preset']}</b><span>{r.get('note','')}</span></figcaption>
    </figure>"""
        )

    html = f"""<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>bake-off 风格对比</title>
<style>
  body {{ margin:0; padding:28px; background:#1b1815; color:#F2EDE3;
         font:15px/1.6 "Noto Sans SC", system-ui, sans-serif; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  p.sub {{ margin:0 0 22px; color:#a89f8f; font-size:13px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:18px; }}
  figure.c {{ margin:0; background:#252019; border:1px solid #3a332a; border-radius:10px;
              overflow:hidden; }}
  figure.c img {{ width:100%; display:block; }}
  figure.c figcaption {{ padding:10px 12px; display:flex; justify-content:space-between; }}
  figure.c span {{ color:#a89f8f; font-size:12px; }}
  code {{ background:#332c23; padding:2px 6px; border-radius:4px; }}
</style>
<h1>bake-off · 同一条 brief 的多风格对比</h1>
<p class="sub">同一个 seed，只有风格不同。挑中之后把预设名写进 images.json 的
<code>style_preset</code>（全局）或某一条的 <code>style_preset</code>（单条覆盖）。</p>
<div class="grid">
{chr(10).join(cards)}
</div>
</html>
"""
    sheet.write_text(html, encoding="utf-8")
    return sheet


def main() -> int:
    # Windows 下 stdout 被重定向时用 GBK，✓/✗ 与中文混排会 UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="同一条 brief 出多风格对比图")
    ap.add_argument("--project", required=True, help="项目根目录")
    ap.add_argument("--manifest", default="", help="清单路径，默认 <project>/images.json")
    ap.add_argument("--beat", default="", help="要对比的 brief id")
    ap.add_argument("--scene-file", default="", help="自定义 brief 文件（JSON，一项）")
    ap.add_argument("--presets", default="", help="要比的预设，逗号分隔；默认全部纸艺系")
    ap.add_argument("--server", default=cg.DEFAULT_SERVER)
    ap.add_argument("--models", default="")
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--force", action="store_true", help="覆盖已存在的对比图")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not project.is_dir():
        log(f"[bakeoff] x 项目目录不存在：{project}")
        return 1

    manifest_path = Path(args.manifest) if args.manifest else project / "images.json"
    if not manifest_path.exists():
        log(f"[bakeoff] x 找不到清单 {manifest_path}")
        return 1

    cfg = cg.read_json(manifest_path)

    if args.scene_file:
        item = cg.read_json(Path(args.scene_file))
        if isinstance(item, dict) and "items" in item:
            item = item["items"][0]
    else:
        if not args.beat:
            log("[bakeoff] x 要么给 --beat，要么给 --scene-file")
            return 1
        item = find_item(cfg, args.beat)
        if not item:
            log(f"[bakeoff] x 清单里没有 id 命中 '{args.beat}'")
            log(f"[bakeoff]   现有 id：{', '.join(str(i.get('id')) for i in (cfg.get('items') or []))}")
            return 1

    item_id = str(item.get("id") or "scene")
    presets = [p.strip() for p in args.presets.split(",") if p.strip()] or PAPER_PRESETS
    unknown = [p for p in presets if p not in cg.STYLE_PRESETS]
    if unknown:
        log(f"[bakeoff] x 不认识的预设：{', '.join(unknown)}")
        log(f"[bakeoff]   可用：{', '.join(cg.STYLE_PRESETS)}")
        return 1

    models_all = cg.read_json(cg.COMFY_DIR / "models.json")
    profile_name = args.models or cfg.get("models") or cg.DEFAULT_MODEL
    models = models_all.get(profile_name)
    if not models:
        log(f"[bakeoff] x models.json 里没有模型组 {profile_name}")
        return 1
    workflow_name = cfg.get("workflow") or models.get("workflow")
    if not workflow_name:
        log("[bakeoff] x 没有指定 workflow")
        return 1
    workflow = cg.load_workflow(workflow_name)

    # 同一个 seed 出所有风格：风格是唯一变量
    base_seed = int(item.get("seed") if item.get("seed") is not None else cfg.get("seed", 42))

    out_dir = project / "out" / "bakeoff"
    img_dir = project / "public" / "img" / "_bakeoff"
    out_dir.mkdir(parents=True, exist_ok=True)
    img_dir.mkdir(parents=True, exist_ok=True)

    comfy = cg.Comfy(args.server)
    try:
        comfy.stats()
    except Exception as exc:  # noqa: BLE001
        log(f"[bakeoff] x 连不上 ComfyUI（{args.server}）：{exc}")
        log("[bakeoff]   起服务见 references/comfyui.md")
        return 1

    rows = []
    for preset in presets:
        variant = dict(item)
        variant["style_preset"] = preset
        variant["seed"] = base_seed
        try:
            values = cg.build_values(variant, cfg, models, 0)
        except Exception as exc:  # noqa: BLE001
            log(f"[bakeoff] x {preset} 建提示词失败：{exc}")
            continue

        dest = img_dir / f"{item_id}--{preset}.png"
        if dest.exists() and not args.force:
            log(f"[bakeoff] · {preset} 已存在，跳过（--force 覆盖）")
        else:
            prompt = cg.coerce_numeric(cg.fill(workflow, values))
            try:
                pid = comfy.submit(prompt)
                log(f"[bakeoff] … {preset} 已提交（seed={base_seed}）")
                hist = cg.wait_for(comfy, pid, args.timeout)
            except Exception as exc:  # noqa: BLE001
                log(f"[bakeoff] x {preset} 失败：{exc}")
                continue
            images = []
            for node_out in hist.get("outputs", {}).values():
                images.extend(node_out.get("images", []))
            if not images:
                log(f"[bakeoff] x {preset} 完成但没有产出图片")
                continue
            img = images[0]
            try:
                comfy.download(img["filename"], img.get("subfolder", ""),
                              img.get("type", "output"), dest)
            except Exception as exc:  # noqa: BLE001
                log(f"[bakeoff] x {preset} 下载失败：{exc}")
                continue
            log(f"[bakeoff] ✓ {preset} → {dest.name}")

        rows.append({
            "preset": preset,
            "file": dest,
            "note": f"seed {base_seed}",
        })

    if not rows:
        log("[bakeoff] x 一张都没出来")
        return 1

    # 联络表里的图要能被浏览器读到：拷一份到 out/bakeoff 下
    for r in rows:
        target = out_dir / r["file"].name
        if r["file"].resolve() != target.resolve():
            target.write_bytes(r["file"].read_bytes())
        r["file"] = target

    sheet = build_sheet(out_dir, rows)
    log("")
    log(f"[bakeoff] 对比表：{sheet}")
    log("[bakeoff] 挑中之后把预设名写进 images.json：")
    log(f'[bakeoff]   "style_preset": "{rows[0]["preset"]}"   ← 替换成你挑的那个')
    return 0


if __name__ == "__main__":
    sys.exit(main())

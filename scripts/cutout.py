#!/usr/bin/env python3
"""
把 images.json 里标记 `"cutout": true` 的平底元素图抠成透明 PNG。

为什么不用全局色键：纸艺元素内部常有接近底色的浅色（井盖中心、纸片内芯），
全局抠色会把它们一起吃掉。这里从画布四边做连通行 flood fill——只删
"与边缘连通"的底色，被图形包住的近似色保留下来。

产物：public/img/<id>-cut.png（透明、按内容裁边、留 pad 透明边），
以及 public/img/_cutouts.json（每张的裁切框和底色，便于复查）。

    python scripts/cutout.py --project <项目>
    python scripts/cutout.py --project <项目> --only hook-hole,hook-square --force

依赖 Pillow（只在出抠图这一步需要）。
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def log(msg: str) -> None:
    print(msg, flush=True)


def read_json(path: Path):
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def background_color(im: Image.Image) -> tuple[int, int, int]:
    """边框像素的中位数。取中位数是为了容忍边缘上偶尔压到主体的像素。"""
    w, h = im.size
    px = im.load()
    edge = []
    for x in range(w):
        edge.append(px[x, 0])
        edge.append(px[x, h - 1])
    for y in range(h):
        edge.append(px[0, y])
        edge.append(px[w - 1, y])
    return tuple(int(statistics.median(c[i] for c in edge)) for i in range(3))  # type: ignore[return-value]


def key_out(
    im: Image.Image,
    tolerance: int = 26,
    erode: int = 2,
    feather: float = 0.7,
    pad: int = 8,
) -> tuple[Image.Image, dict]:
    """返回 (裁边后的 RGBA, 元数据)。"""
    rgb = im.convert("RGB")
    w, h = rgb.size
    bg = background_color(rgb)
    px = rgb.load()

    # 候选底色掩码：与边框中位数的通道差都在容差内
    bgmask = Image.new("L", (w, h), 0)
    mp = bgmask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) <= tolerance:
                mp[x, y] = 255

    # 从四边灌水：只把与画布边缘连通的底色标成 128
    step = max(8, min(w, h) // 32)
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for x in range(0, w, step):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, step):
        seeds += [(0, y), (w - 1, y)]
    for seed in seeds:
        if mp[seed] == 255:
            ImageDraw.floodfill(bgmask, seed, 128, thresh=0)

    alpha = bgmask.point(lambda v: 0 if v == 128 else 255)
    if erode > 0:
        # 去掉留在边缘的一圈底色/抗锯齿光晕
        alpha = alpha.filter(ImageFilter.MinFilter(erode * 2 + 1))
    if feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))

    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)

    bbox = alpha.getbbox()
    meta = {
        "src_w": w,
        "src_h": h,
        "bg": list(bg),
        "tolerance": tolerance,
        "erode": erode,
        "bbox": None,
        "size": [w, h],
    }
    if bbox is None:
        return rgba, meta

    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(w, bbox[2] + pad)
    bottom = min(h, bbox[3] + pad)
    cropped = rgba.crop((left, top, right, bottom))
    meta["bbox"] = [left, top, right, bottom]
    meta["size"] = [cropped.width, cropped.height]
    return cropped, meta


def process(project: Path, manifest: Path, args) -> int:
    if not manifest.exists():
        log(f"[cutout] x 找不到清单 {manifest}")
        return 1
    cfg = read_json(manifest)
    items = [i for i in (cfg.get("items") or []) if i.get("cutout")]
    if not items:
        log("[cutout] x 清单里没有 cutout: true 的条目")
        return 1

    only = {s.strip() for s in args.only.split(",")} if args.only else None
    img_dir = project / "public" / "img"

    record_path = img_dir / "_cutouts.json"
    record = read_json(record_path) if record_path.exists() else {}

    done, failed, skipped = 0, [], 0
    for item in items:
        item_id = item.get("id")
        if not item_id:
            continue
        if only and item_id not in only:
            continue
        slug = re.sub(r"[^\w.-]+", "_", item_id)
        src = img_dir / f"{slug}.png"
        dst = img_dir / f"{slug}{args.suffix}.png"
        if not src.exists():
            log(f"[cutout] x {item_id} 缺原图：{src}")
            failed.append(item_id)
            continue
        if dst.exists() and not args.force:
            log(f"[cutout] · {item_id} 已存在，跳过（--force 覆盖）")
            skipped += 1
            continue

        # 单条可以写 "cutout": {"tolerance": 14}：浅灰纸片贴近底色时，
        # 全局容差会把它们一起吃掉，需要按条收紧。
        opts = item["cutout"] if isinstance(item["cutout"], dict) else {}
        try:
            with Image.open(src) as im:
                out, meta = key_out(
                    im,
                    tolerance=int(opts.get("tolerance", args.tolerance)),
                    erode=int(opts.get("erode", args.erode)),
                    feather=float(opts.get("feather", args.feather)),
                    pad=int(opts.get("pad", args.pad)),
                )
                # "card": 12 —— 不透明裁切，留着环绕主体的纸边。
                # 洞、缺口这类元素抠成透明后，纸边会变成零散的碎屑；
                # 留一圈纸，它才读成"一张纸上的洞"。
                card = int(opts.get("card", 0))
                if card > 0 and meta["bbox"] is not None:
                    l, t, r, b = meta["bbox"]
                    box = (
                        max(0, l - card),
                        max(0, t - card),
                        min(im.width, r + card),
                        min(im.height, b + card),
                    )
                    out = im.convert("RGBA").crop(box)
                    meta["mode"] = "card"
                    meta["card"] = card
                    meta["bbox"] = list(box)
                    meta["size"] = [out.width, out.height]
        except Exception as exc:  # noqa: BLE001
            log(f"[cutout] x {item_id} 处理失败：{exc}")
            failed.append(item_id)
            continue

        if meta["bbox"] is None:
            log(f"[cutout] x {item_id} 整张图都是底色，没有可保留的主体")
            failed.append(item_id)
            continue

        out.save(dst)
        done += 1
        record[slug] = {**meta, "file": f"img/{dst.name}", "source": f"img/{src.name}"}
        write_json(record_path, record)
        log(
            f"[cutout] √ {item_id} -> public/img/{dst.name} "
            f"({meta['size'][0]}x{meta['size'][1]}, bg={tuple(meta['bg'])})"
        )

    log(f"[cutout] 完成：{done} 张新图，跳过 {skipped}" + (f"，失败 {len(failed)}：{', '.join(failed)}" if failed else ""))
    log(f"[cutout] 记录：{record_path}")
    return 1 if failed else 0


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="把平底元素图抠成透明 PNG（连通行 flood fill）")
    ap.add_argument("--project", default=".", help="项目根目录（含 images.json / public/）")
    ap.add_argument("--manifest", default=None, help="默认 <project>/images.json")
    ap.add_argument("--only", default=None, help="只跑这些 id，逗号分隔")
    ap.add_argument("--suffix", default="-cut", help="输出文件名后缀，默认 -cut")
    ap.add_argument("--tolerance", type=int, default=26, help="底色容差（0-255），默认 26")
    ap.add_argument("--erode", type=int, default=2, help="去边像素，默认 2")
    ap.add_argument("--feather", type=float, default=0.7, help="羽化半径，默认 0.7")
    ap.add_argument("--pad", type=int, default=8, help="裁边后保留的透明边，默认 8")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的 cut 图")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not project.exists():
        log(f"[cutout] x 项目目录不存在：{project}")
        return 1
    manifest = Path(args.manifest).resolve() if args.manifest else project / "images.json"
    return process(project, manifest, args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
闸门 B 的工具：按 beat 抽静帧。

为什么需要这个
--------------
"先抽帧再渲染"是这套管线最省时间的一条规矩（抽一帧 5 秒，渲整片 3-8 分钟），
但手工抽帧要两样东西：每拍在第几帧、和帧号对应的 beat 是哪个。
前者要读 timeline.json，后者要自己记。渲完回头找"第 3 拍长什么样"更麻烦。

这个脚本把两样都算好：

    python stills.py --project "<项目>"                 # 每拍抽一张，放 out/stills/
    python stills.py --project "<项目>" --sheet         # 再拼一张联络表
    python stills.py --project "<项目>" --beat tumu,gate
    python stills.py --project "<项目>" --offset 45      # 抽帧位置往后挪

抽帧位置默认是 `beat.from + 30`（一秒后，组件基本都入场了）；
每一拍还会再抽一张结尾前 8 帧的（`--tail`），用来看出场那一刻的状态。

用法
----
    python stills.py --project "<项目>" [--beat id,...] [--offset N] [--tail]
                      [--sheet] [--scale 480] [--cols 4]

退出码：0 全部渲出来了；1 有失败。
"""

from __future__ import annotations

import argparse
import glob
import json
import shutil
import subprocess
import sys
from pathlib import Path

from _media import compositor_bins


def find_remotion(project: Path) -> list[str]:
    """优先用项目里的 remotion，找不到再退回 npx。"""
    for pat in ("node_modules/.bin/remotion.cmd", "node_modules/.bin/remotion",
                "node_modules/.bin/remotion.exe"):
        hits = sorted(glob.glob(str(project / pat)))
        if hits:
            return [hits[0]]
    if shutil.which("npx"):
        return ["npx", "--no-install", "remotion"]
    sys.exit("[stills] 找不到 remotion。先在项目里跑一次 npm install。")


def plan(timeline: dict, offset: int, tail: bool) -> list[dict]:
    fps = timeline.get("fps", 30)
    out = []
    for b in timeline.get("beats", []):
        start = int(b["from"])
        dur = int(b["durationInFrames"])
        frames = [min(start + offset, start + dur - 1)]
        if tail and dur > 12:
            frames.append(max(start, start + dur - 8))
        for i, f in enumerate(frames):
            out.append({
                "id": b["id"],
                "frame": f,
                "label": "mid" if i == 0 else "tail",
                "kind": b.get("visual", {}).get("kind", "?"),
                "seconds": round(f / fps, 2),
            })
    return out


def render(project: Path, remotion: list[str], jobs: list[dict], outdir: Path) -> list[dict]:
    seq = outdir / "seq"
    seq.mkdir(parents=True, exist_ok=True)
    results = []
    for i, job in enumerate(jobs, 1):
        target = seq / f"{i:03d}.png"
        cmd = remotion + ["still", "VoxVideo", str(target), f"--frame={job['frame']}",
                          "--log=error"]
        r = subprocess.run(cmd, cwd=str(project), capture_output=True, text=True)
        ok = r.returncode == 0 and target.exists()
        job = dict(job, file=str(target), ok=ok)
        if not ok:
            job["error"] = (r.stderr or r.stdout or "").strip().splitlines()[-1:] or ["?"]
        results.append(job)
        mark = "✓" if ok else "✗"
        print(f"  {mark} {job['id']:<12} frame={job['frame']:<5} {job['seconds']:>6}s  "
              f"{job['kind']:<9} -> {target.name}")
    return results


def full_ffmpeg(project: Path) -> str | None:
    """找一个**带 tile 滤镜**的 ffmpeg。Remotion 自带的那个阉割版没有，
    拼不出联络表。系统装了完整版就能拼 PNG 版。"""
    cands = [shutil.which("ffmpeg"), *compositor_bins(project, "ffmpeg")]
    for c in cands:
        if not c:
            continue
        try:
            r = subprocess.run([c, "-hide_banner", "-filters"], capture_output=True, text=True,
                               timeout=30)
        except Exception:  # noqa: BLE001
            continue
        if " tile " in (r.stdout or ""):
            return c
    return None


def sheet_png(project: Path, jobs: list[dict], outdir: Path, scale: int, cols: int) -> bool:
    """系统有完整 ffmpeg 时拼一张 PNG 联络表。"""
    ffmpeg = full_ffmpeg(project)
    if not ffmpeg:
        return False
    ok_jobs = [j for j in jobs if j["ok"]]
    if not ok_jobs:
        return False
    rows = (len(ok_jobs) + cols - 1) // cols
    target = outdir / "sheet.png"
    vf = f"scale={scale}:-1,tile={cols}x{rows}:padding=6:margin=6:color=white"
    cmd = [ffmpeg, "-y", "-v", "error", "-framerate", "1",
           "-i", str(outdir / "seq" / "%03d.png"),
           "-vf", vf, "-frames:v", "1", str(target)]
    r = subprocess.run(cmd, cwd=str(project), capture_output=True, text=True)
    if r.returncode == 0 and target.exists():
        print(f"  → PNG 联络表 {target}（{len(ok_jobs)} 拍，{cols}x{rows}）")
        return True
    return False


def sheet_html(jobs: list[dict], outdir: Path, cols: int) -> None:
    """HTML 联络表：一张网格 + 每帧的拍号/帧号/类型。浏览器直接开，
    比 PNG 版好用（能放大、能看到标签），而且不依赖任何滤镜。"""
    cells = []
    for i, j in enumerate(jobs, 1):
        if not j["ok"]:
            continue
        cells.append(
            f'  <figure><img src="seq/{i:03d}.png" alt="{j["id"]}">'
            f'<figcaption><b>{j["id"]}</b><br>frame {j["frame"]} · {j["seconds"]}s'
            f' · {j["kind"]}</figcaption></figure>')
    html = f"""<!doctype html>
<meta charset="utf-8">
<title>静帧联络表</title>
<style>
  body {{ margin: 24px; background: #f4f1ea; font: 14px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; color: #2b2a26; }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  p {{ margin: 0 0 20px; color: #6b675c; }}
  .grid {{ display: grid; grid-template-columns: repeat({cols}, 1fr); gap: 16px; }}
  figure {{ margin: 0; background: #fff; padding: 8px; border-radius: 6px;
            box-shadow: 0 2px 10px rgba(0,0,0,.12); }}
  img {{ width: 100%; display: block; border-radius: 3px; }}
  figcaption {{ padding-top: 6px; font-size: 12px; color: #6b675c; }}
</style>
<h1>静帧联络表 · {len(cells)} 拍</h1>
<p>闸门 B 用：逐张看过再决定要不要渲整片。</p>
<div class="grid">
{chr(10).join(cells)}
</div>
"""
    target = outdir / "sheet.html"
    target.write_text(html, encoding="utf-8")
    print(f"  → HTML 联络表 {target}（{len(cells)} 拍，{cols} 列）")


def main() -> int:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，✓ ✗ → 这类符号会直接崩
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="按 beat 抽静帧（闸门 B）")
    ap.add_argument("--project", default=".", help="项目根目录，默认当前目录")
    ap.add_argument("--timeline", default="src/timeline.json")
    ap.add_argument("--out", default="out/stills", help="输出目录（相对项目）")
    ap.add_argument("--beat", default=None, help="只抽这几拍，逗号分隔")
    ap.add_argument("--offset", type=int, default=30, help="抽帧位置：beat.from + offset")
    ap.add_argument("--tail", action="store_true", help="每拍再抽一张出场前 8 帧")
    ap.add_argument("--sheet", action="store_true", help="拼一张联络表")
    ap.add_argument("--scale", type=int, default=480, help="联络表每格宽度")
    ap.add_argument("--cols", type=int, default=4, help="联络表列数")
    ap.add_argument("--list", action="store_true", help="只列计划，不渲染")
    a = ap.parse_args()

    project = Path(a.project).resolve()
    tl = project / a.timeline
    if not tl.exists():
        sys.exit(f"[stills] 找不到 {tl}，先跑 npm run tts 生成时间轴。")
    timeline = json.loads(tl.read_text("utf-8"))

    jobs = plan(timeline, a.offset, a.tail)
    if a.beat:
        want = {b.strip() for b in a.beat.split(",") if b.strip()}
        jobs = [j for j in jobs if j["id"] in want]
        if not jobs:
            sys.exit(f"[stills] 没有匹配的拍：{', '.join(sorted(want))}")
    if not jobs:
        sys.exit("[stills] 时间轴里没有 beat")

    print(f"[stills] {len(jobs)} 张，位置 = beat.from + {a.offset}"
          f"{'，另加每拍出场前 8 帧' if a.tail else ''}")
    for j in jobs:
        print(f"  · {j['id']:<12} frame={j['frame']:<5} {j['seconds']:>6}s {j['kind']}")
    if a.list:
        return 0

    outdir = project / a.out
    outdir.mkdir(parents=True, exist_ok=True)
    # 序号目录每次重开：只渲其中几拍时，旧的 001.png 会和新的对不上号
    seq = outdir / "seq"
    if seq.exists():
        for old in seq.glob("*.png"):
            old.unlink()
    remotion = find_remotion(project)
    results = render(project, remotion, jobs, outdir)

    index = outdir / "index.txt"
    index.write_text(
        "\n".join(f"{j['file']}\t{j['id']}\tframe={j['frame']}\t{j['seconds']}s\t{j['kind']}"
                  for j in results) + "\n",
        encoding="utf-8")
    if a.sheet:
        if not sheet_png(project, results, outdir, a.scale, a.cols):
            print("  ! 系统没有带 tile 滤镜的 ffmpeg，改出 HTML 联络表")
        sheet_html(results, outdir, a.cols)

    bad = [j for j in results if not j["ok"]]
    if bad:
        print(f"[stills] {len(bad)} 张没渲出来")
        return 1
    print(f"[stills] 完成 → {outdir}（索引 {index.name}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

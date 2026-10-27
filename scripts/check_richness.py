#!/usr/bin/env python3
"""
丰富度巡检：成片有没有"每 2–3 秒一个新东西"。

为什么需要这个
--------------
`check_motion.py` 查的是"画面动没动"（帧差够不够、有没有死拍）。但它有个盲区：
整幅在抖、在推近，帧差也够，观众却可能觉得"讲了半天还是那一页"。这个脚本查的是
另一种东西——**画面有没有换过内容**：每 2.5 秒抽一格，量相邻格差多少。

三个读数
--------
1. 相邻格变化 —— 每 2.5 秒一格，相邻两格每像素平均差（0–255）。<4 读作
   "几乎没变"；全片平均 ≥10 且没有"几乎没变"的对才算过。
2. 在动的帧 —— 和 0.1 秒前比差 >0.3 的帧占比（定格一拍二也算动）。只作参考：
   整幅抖动也能把它拉满，不拿它当 KPI。
3. 最长静止 —— 连续多少秒没有超过阈值的帧间变化；>2 秒给提醒。

为什么裁掉底部字幕带
--------------------
字幕每句都在变，不裁的话"丰富度"会被字幕撑起来，图画死了也看不出来。
本风格字幕是一张纸，带上下 padding，底部约 220px（`references/readability.md`）；
默认 `--sub 220`。普通无纸带字幕的视频可以传 170。

ffmpeg 的两个坑（Remotion 自带精简构建）
----------------------------------------
- 没有 fps / select / tile 滤镜，所以抽格只能靠 `-ss` 单帧、降采样帧率只能靠
  输出的 `-r`，不能写进 `-vf`；
- rawvideo 没有 muxer，但 image2pipe + rawvideo 编码器可用。
这两条只在渲染机的精简 ffmpeg 上撞得到，本机装了完整版时看不出来。

用法
----
    python check_richness.py --project "<项目>"
    python check_richness.py --project "<项目>" --video out/video.mp4
    python check_richness.py --video 单镜.mp4 --every 2.5 --sub 220

退出码：0 过；1 有"几乎没变"的对或平均不够。
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

from _media import find_ffmpeg, find_ffprobe

GW = 192               # 灰度小图宽；和 check_motion / 参考片量法一致
FPS = 10               # 采样帧率
LAG = 1                # 0.1 秒 @10fps
MOVE = 0.3             # 和 0.1 秒前比，高于此值算"在动"
FLAT = 4.0             # 相邻格差低于此值 → 几乎没变
RICH = 10.0            # 相邻格平均下限（纸艺片实测有 35 的余量，见 visual-craft.md）
LONG_STATIC = 2.0      # 静止超过这个秒数给提醒
SUB_DEFAULT = 220      # 本风格字幕纸带高度；普通字幕 170


# ---------------------------------------------------------------- ffmpeg


def probe(video: Path, ffprobe: str | None) -> tuple[int, int, float]:
    """读宽高和时长；读不到就按 1920×1080、时长由帧数反推。"""
    if ffprobe:
        try:
            r = subprocess.run(
                [ffprobe, "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
                capture_output=True, text=True, timeout=30)
            wh = (r.stdout or "").strip().split(",")
            w, h = int(wh[0]), int(wh[1])
            r2 = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(video)],
                capture_output=True, text=True, timeout=30)
            dur = float((r2.stdout or "0").strip() or 0)
            if w > 0 and h > 0:
                return w, h, dur
        except Exception:  # noqa: BLE001
            pass
    return 1920, 1080, 0.0


def _read_exact(stream, n: int) -> bytes | None:
    """管道上的 read(n) 不保证一次读满；不补齐会把帧切错位。"""
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def frame_stream(video: Path, ffmpeg: str, crop_w: int, crop_h: int, out_h: int):
    """流式读灰度帧。ffmpeg 的参数写死在内部，免得调用方拼错。"""
    proc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", str(video),
         "-vf", f"crop={crop_w}:{crop_h}:0:0,scale={GW}:{out_h}", "-r", str(FPS),
         "-f", "image2pipe", "-c:v", "rawvideo", "-pix_fmt", "gray", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    n = GW * out_h
    try:
        while True:
            buf = _read_exact(proc.stdout, n)
            if buf is None:
                break
            yield buf
    finally:
        try:
            proc.stdout.close()
        finally:
            proc.wait()


# ---------------------------------------------------------------- 指标


def frame_diff(a: bytes, b: bytes) -> float:
    """逐像素绝对差的平均（0–255）。"""
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def motion_stats(frames: list[bytes], move: float = MOVE
                 ) -> tuple[float, float, float]:
    """返回（在动占比 %, 最长静止秒, 最长静止起点秒）。"""
    if len(frames) <= LAG:
        return 0.0, 0.0, 0.0
    moving = 0
    run = 0
    longest = 0
    longest_at = 0
    for i in range(LAG, len(frames)):
        if frame_diff(frames[i], frames[i - LAG]) > move:
            moving += 1
            run = 0
        else:
            run += 1
            if run > longest:
                longest = run
                # 连续 run 个差分从第 i-run 帧开始；差分 i 比的是 i-1 和 i
                longest_at = max(0, i - run) / FPS
    return 100 * moving / (len(frames) - LAG), longest / FPS, longest_at


def grid_diffs(frames: list[bytes], every: float) -> list[tuple[float, float]]:
    """每 every 秒取一格，返回 [(时刻秒, 与上一格的差)]（不含第 0 格）。"""
    if not frames:
        return []
    dur = len(frames) / FPS
    cells = []
    t = 0.0
    while t < dur - 0.05:
        cells.append(t)
        t += every
    out = []
    for k in range(1, len(cells)):
        i = min(len(frames) - 1, round(cells[k] * FPS))
        j = min(len(frames) - 1, round(cells[k - 1] * FPS))
        out.append((cells[k], frame_diff(frames[i], frames[j])))
    return out


def verdict(diffs: list[float]) -> tuple[bool, float, int, float]:
    """返回（过否, 平均, 几乎没变的对数, 去掉第 1 对后的平均）。"""
    if not diffs:
        return False, 0.0, 0, 0.0
    avg = sum(diffs) / len(diffs)
    flat = sum(1 for d in diffs if d < FLAT)
    rest = sum(diffs[1:]) / len(diffs[1:]) if len(diffs) > 1 else avg
    return flat == 0 and avg >= RICH, avg, flat, rest


def load_beats(project: Path) -> tuple[list[dict], float]:
    """读 timeline.json 的拍边界，用于把"几乎没变"指到具体一拍。"""
    p = project / "src" / "timeline.json"
    if not p.exists():
        return [], 30.0
    try:
        tl = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return [], 30.0
    fps = tl.get("fps", 30)
    if not isinstance(fps, (int, float)) or isinstance(fps, bool) or fps <= 0:
        fps = 30.0
    out = []
    for b in tl.get("beats") or []:
        if not isinstance(b, dict):
            continue
        frm, dur = b.get("from"), b.get("durationInFrames")
        if isinstance(frm, (int, float)) and isinstance(dur, (int, float)):
            out.append({"id": str(b.get("id", "?")),
                        "from": frm / fps, "to": (frm + dur) / fps})
    return out, float(fps)


def beat_at(beats: list[dict], t: float) -> str:
    for b in beats:
        if b["from"] <= t < b["to"]:
            return b["id"]
    return "?"


def beats_span(beats: list[dict], start: float, end: float) -> str:
    ids = []
    for b in beats:
        if b["to"] > start and b["from"] < end and b["id"] not in ids:
            ids.append(b["id"])
    return "、".join(ids)


# ---------------------------------------------------------------- 联络表


def contact_sheet(video: Path, ffmpeg: str, cells: list[float],
                  diffs_by_t: dict[float, float], outdir: Path) -> Path | None:
    """每格抽一张 384 宽的 PNG，再拼成联络表。抽不出来就返回 None。"""
    frames = outdir / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    for old in frames.glob("*.png"):
        old.unlink()
    kept: list[tuple[float, Path]] = []
    for k, t in enumerate(cells):
        dst = frames / f"{k:03d}.png"
        r = subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video),
             "-vf", "scale=384:-1", "-frames:v", "1", str(dst)],
            capture_output=True, text=True)
        if r.returncode == 0 and dst.exists():
            kept.append((t, dst))
    if not kept:
        return None

    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    try:
        font = ImageFont.load_default(size=15)
    except TypeError:  # Pillow < 10.1
        font = ImageFont.load_default()

    cols = 5
    ims = [(t, Image.open(p).convert("RGB")) for t, p in kept]
    cell_w = max(im.width for _, im in ims)
    cell_h = max(im.height for _, im in ims)
    cap, pad = 20, 6
    rows = math.ceil(len(ims) / cols)
    sheet = Image.new("RGB", (cols * cell_w + (cols + 1) * pad,
                              rows * (cell_h + cap) + (rows + 1) * pad),
                      (248, 246, 240))
    draw = ImageDraw.Draw(sheet)
    for k, (t, im) in enumerate(ims):
        x = pad + (k % cols) * (cell_w + pad)
        y = pad + (k // cols) * (cell_h + cap + pad)
        sheet.paste(im, (x, y))
        d = diffs_by_t.get(t)
        label = f"{t:.1f}s"
        if d is not None:
            label += f"  d={d:.1f}" + ("  FLAT" if d < FLAT else "")
        draw.text((x + 3, y + cell_h + 2), label, fill=(96, 90, 78), font=font)
    target = outdir / "sheet.png"
    sheet.save(target)
    return target


# ---------------------------------------------------------------- 主流程


def main() -> int:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，✗ ✓ 这类符号会直接崩
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="成片丰富度巡检（每 2.5 秒一格）")
    ap.add_argument("--project", default=".", help="项目根目录，默认当前目录")
    ap.add_argument("--video", default=None, help="成片路径；默认找 out/video.mp4")
    ap.add_argument("--every", type=float, default=2.5, help="每隔多少秒抽一格")
    ap.add_argument("--sub", type=int, default=SUB_DEFAULT,
                    help=f"底部字幕带高度（1080p 像素），默认 {SUB_DEFAULT}；普通字幕 170")
    ap.add_argument("--out", default=None, help="输出目录，默认 <项目>/out/richness")
    ap.add_argument("--no-sheet", action="store_true", help="不拼联络表，只出数字")
    a = ap.parse_args()

    project = Path(a.project).resolve()
    if a.video:
        video = Path(a.video)
        video = video if video.is_absolute() else project / video
        video = video.resolve()
    else:
        video = None
    if video is None:
        for name in ("out/video.mp4", "out/film-final.mp4", "out/final.mp4"):
            if (project / name).exists():
                video = project / name
                break
    if video is None or not video.exists():
        sys.exit(f"[richness] 找不到成片：{video or project / 'out/video.mp4'}")

    ffmpeg = find_ffmpeg(project)
    if not ffmpeg:
        sys.exit("[richness] 找不到 ffmpeg：先 npm install（Remotion 自带），"
                 "或把系统 ffmpeg 加进 PATH")
    vw, vh, dur = probe(video, find_ffprobe(project))

    keep_h = max(2, round(vh - a.sub * vh / 1080))
    out_h = max(1, round(GW * keep_h / vw))
    frames: list[bytes] = list(frame_stream(video, ffmpeg, vw, keep_h, out_h))
    if len(frames) < 2:
        sys.exit(f"[richness] {video.name} 解不出帧，检查文件是否完整。")
    if dur <= 0:
        dur = len(frames) / FPS

    lines: list[str] = []
    def pr(s: str = "") -> None:
        print(s)
        lines.append(s)

    pr(f"丰富度检查：{video.name}，{dur:.2f} 秒，{len(frames)} 帧（{FPS}fps 灰度 "
       f"{GW}x{out_h}）；底部 {a.sub}px 字幕带不算")
    pr()

    diffs = grid_diffs(frames, a.every)
    if not diffs:
        sys.exit("[richness] 片子太短，抽不出两格。")
    ok, avg, flat, rest = verdict([d for _, d in diffs])
    beats, _ = load_beats(project)

    cells = [0.0] + [t for t, _ in diffs]
    diff_by_t = {t: d for t, d in diffs}
    flat_lines = []
    for t, d in diffs:
        mark = "  ← 几乎没变" if d < FLAT else ""
        who = beat_at(beats, t)
        tag = f"  [{who}]" if who != "?" else ""
        line = f"  第 {round(t / a.every)} → {round(t / a.every) + 1} 格"
        line += f"（{t - a.every:.1f} → {t:.1f} 秒）：{d:.1f}{tag}{mark}"
        pr(line)
        if d < FLAT:
            flat_lines.append(f"{t - a.every:.1f} → {t:.1f} 秒（{who}）")
    pr()
    pr(f"相邻格变化：平均 {avg:.1f}；几乎没变 {flat} / {len(diffs)} 对")
    if len(diffs) > 2:
        tail = ""
        if rest < RICH and avg >= RICH:
            tail = "  ← 过线主要靠开场，后面变化偏少"
        pr(f"去掉第 1 对（开场）的平均：{rest:.1f}{tail}")

    moving_pct, longest_s, longest_at = motion_stats(frames)
    pr(f"在动的帧：{moving_pct:.0f}%；最长静止：{longest_s:.2f} 秒"
       f"（从 {longest_at:.2f} 秒起）")
    if longest_s > LONG_STATIC and beats:
        span = beats_span(beats, longest_at, longest_at + longest_s)
        if span:
            pr(f"  静止段跨的拍：{span}")

    pr()
    if ok:
        pr(f"判定：过（每格都有新变化，平均 ≥ {RICH:.0f}）")
    else:
        why = []
        if flat:
            why.append(f"{flat} 对几乎没变")
        if avg < RICH:
            why.append(f"平均 {avg:.1f} < {RICH:.0f}")
        pr(f"判定：不过——{'，'.join(why)}")
        if flat_lines:
            pr("  要补的接缝：")
            for f in flat_lines:
                pr(f"    - {f}")
        pr("  按 references/visual-craft.md 第一、二节补变化：新东西进场、推近、换色、换版面。")
    if longest_s > LONG_STATIC:
        pr(f"提醒：静止超过 {LONG_STATIC:.0f} 秒——加次要动作（飘动、闪烁、粒子、慢推），"
           "见 references/visual-craft.md 第一节")

    outdir = Path(a.out).resolve() if a.out else project / "out" / "richness"
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "richness.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n  → 读数 {outdir / 'richness.txt'}")
    if not a.no_sheet:
        sheet = contact_sheet(video, ffmpeg, cells, diff_by_t, outdir)
        if sheet:
            print(f"  → 联络表 {sheet}（每 {a.every:g} 秒一格，{5} 列，"
                  "从左到右、从上到下，第 1 格是 0 秒）")
        else:
            print("  ! 联络表没拼出来（缺 Pillow 或抽帧失败）——数字仍有效")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

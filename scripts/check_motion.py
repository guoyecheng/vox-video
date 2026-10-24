#!/usr/bin/env python3
"""
成片动效体检：量化"画面到底有没有在动"。

为什么需要这个
--------------
这一套管线最容易翻车的地方不是渲染失败，而是**渲染成功但像 PPT**：
组件用 spring 入场，进场后归位静止，一拍里大半段时间画面完全不动。
肉眼能感觉到"死"，但说不清是哪一拍、死了多久。这个脚本把它变成数字。

三个指标（都是逐帧差分，纯标准库，不需要 numpy/PIL）
----------------------------------------------------
1. 静止帧占比——帧间平均差 <2.0（0-255 灰度）的时长比例。
   纸艺/实拍类参考片 2-9%，靠的是传感器噪声和材质颗粒，不是"动得好"。
   **这个数字默认只作参考，不参与判定**：它奖励的是"整幅像素都在变"，
   而最廉价的整幅变化就是噪声/颤动。实测把整幅每 2 帧抖 2.5px 能把占比
   从 74% 压到 39%，但观感变成"画面一直在抖"——这是拿观感换指标。
   纸艺风格稳定在 60% 左右是正常的。要把它当硬闸门请显式加 `--strict`。
2. 九宫格变异系数——每帧切成 3x3 看差分能量的分布。
   >0.5 说明"画面里某些元素在动"（元素级动画）；
   <0.3 说明只是整幅推拉（相机运动）。两者观感差别很大。
3. 逐拍均差——按 timeline.json 的 from/durationInFrames 归属，
   找出平均帧差 <1.5 的"死拍"，那才是要返工的地方。**判定只看这一条 + 九宫格。**

用法
----
    python check_motion.py --project "<项目路径>"
    python check_motion.py --project "<项目>" --video out/video.mp4 --json
    python check_motion.py 单镜.mp4 --grid-only        # 只判元素级/整体运镜
    python check_motion.py --project "<项目>" --still-max 25 --strict

退出码：0 通过；1 有死拍 / 只是整幅运镜（`--strict` 时另加静止占比超限）。
"""

from __future__ import annotations

import argparse
import glob
import json
import shutil
import subprocess
import sys
from pathlib import Path

W, H = 192, 108          # 降采样到 192x108：和参考片的量法一致，纯 Python 也够快
FPS = 10                 # 采样帧率。30fps 全量没必要，10fps 足以看清静止段
STILL = 2.0              # 帧间平均差低于此值视为"近乎静止"
FROZEN = 1.0             # 几乎完全一致
DEAD_BEAT = 1.5          # 逐拍均差低于此值 → 这一拍基本没动
CUT = 8.0                # 硬切判定：帧差突然跳起来


# ---------------------------------------------------------------- ffmpeg

def find_ffmpeg(project: Path) -> str:
    for pat in ("node_modules/@remotion/compositor-*/ffmpeg.exe",
                "node_modules/@remotion/compositor-*/ffmpeg",
                "../node_modules/@remotion/compositor-*/ffmpeg.exe"):
        hits = sorted(glob.glob(str(project / pat)))
        if hits:
            return hits[0]
    which = shutil.which("ffmpeg")
    if which:
        return which
    sys.exit("[motion] 找不到 ffmpeg。先在项目里跑一次 npm install，或用 --ffmpeg 指定。")


def iter_frames(video: Path, ffmpeg: str, w: int, h: int, fps: int):
    """逐帧吐灰度字节。用管道流式读，整片也不占内存。

    注意这行命令对 Remotion 自带的 ffmpeg 是量身定做的，别改回常见写法：
      - 它**没有 rawvideo 这个 muxer**，但 image2pipe + rawvideo 编码器可用，
        出来的就是没有头的裸帧拼接；
      - 它**没有 fps 滤镜**，所以降采样帧率只能用输出的 `-r`，不能写进 -vf。
    这两个坑都只在渲染机上才会撞到，本机装了完整 ffmpeg 时看不出来。
    """
    proc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", str(video),
         "-vf", f"scale={w}:{h}", "-r", str(fps),
         "-f", "image2pipe", "-c:v", "rawvideo", "-pix_fmt", "gray", "-"],
        stdout=subprocess.PIPE,
    )
    n = w * h
    try:
        while True:
            buf = proc.stdout.read(n)
            if not buf or len(buf) < n:
                break
            yield buf
    finally:
        proc.stdout.close()
        proc.wait()


# ---------------------------------------------------------------- 指标

def grid_cv(prev: bytes, cur: bytes, w: int, h: int) -> tuple[float, float]:
    """九宫格差分能量的变异系数。元素级动画高，整体运镜低。"""
    d = bytes(abs(a - b) for a, b in zip(prev, cur))
    cw, ch = w // 3, h // 3
    cells = []
    for r in range(3):
        for c in range(3):
            s = 0
            for y in range(r * ch, (r + 1) * ch):
                row = y * w + c * cw
                s += sum(d[row:row + cw])
            cells.append(s / (cw * ch))
    m = sum(cells) / 9
    sd = (sum((v - m) ** 2 for v in cells) / 9) ** 0.5
    return sd / (m + 1e-6), m


def analyze(video: Path, ffmpeg: str, use_grid: bool = True) -> dict:
    diffs: list[float] = []
    cvs: list[float] = []
    prev = None
    for cur in iter_frames(video, ffmpeg, W, H, FPS):
        if prev is not None:
            # 平均帧差：逐像素绝对差 / 像素数。分块求和交给 C 层的 sum(bytes)
            d = bytes(abs(a - b) for a, b in zip(prev, cur))
            diffs.append(sum(d) / (W * H))
            if use_grid:
                cvs.append(grid_cv(prev, cur, W, H)[0])
        prev = cur

    if not diffs:
        sys.exit(f"[motion] {video} 解不出帧，检查文件是否完整。")

    res = {
        "file": video.name,
        "frames": len(diffs) + 1,
        "fps": FPS,
        "mean": round(sum(diffs) / len(diffs), 2),
        "max": round(max(diffs), 2),
        "still_pct": round(100 * sum(1 for v in diffs if v < STILL) / len(diffs), 1),
        "frozen_pct": round(100 * sum(1 for v in diffs if v < FROZEN) / len(diffs), 1),
    }
    if use_grid and cvs:
        cv = sum(cvs) / len(cvs)
        res["grid_cv"] = round(cv, 2)
        res["nature"] = ("元素级动画" if cv > 0.5 else ("整幅运镜为主" if cv < 0.3 else "混合"))
    res["cuts"] = sum(
        1 for i in range(1, len(diffs) - 1)
        if diffs[i] > CUT and diffs[i] > diffs[i - 1] * 2.2 and diffs[i] > diffs[i + 1] * 1.6
    )
    res["_diffs"] = diffs
    return res


def per_beat(res: dict, timeline: dict) -> list[dict]:
    """按 timeline 的 from 归属差分样本。注意 from 是音频时钟，
    转场会让视觉起点提前几帧，这里只求"哪一拍死了"，不求精确到帧。"""
    diffs = res["_diffs"]
    out = []
    for b in timeline.get("beats", []):
        s = int(b["from"] / timeline["fps"] * FPS)
        e = int((b["from"] + b["durationInFrames"]) / timeline["fps"] * FPS)
        seg = diffs[max(0, s):max(1, min(len(diffs), e))]
        if not seg:
            continue
        out.append({
            "id": b["id"],
            "start_s": round(b["from"] / timeline["fps"], 1),
            "dur_s": round(b["durationInFrames"] / timeline["fps"], 1),
            "kind": b.get("visual", {}).get("kind", "?"),
            "mean": round(sum(seg) / len(seg), 2),
            "still_pct": round(100 * sum(1 for v in seg if v < STILL) / len(seg), 1),
        })
    return out


# ---------------------------------------------------------------- 输出

def report(
    res: dict, beats: list[dict], still_max: float, cv_min: float, strict: bool = False
) -> bool:
    print(f"文件: {res['file']}   采样 {res['fps']}fps / {res['frames']} 帧")
    print(f"帧间平均差 {res['mean']:.2f}   最大 {res['max']:.2f}")
    print(f"近乎静止(<{STILL}) {res['still_pct']:.0f}%   全静止(<{FROZEN}) {res['frozen_pct']:.0f}%"
          f"   （参考片 2-9%，纯矢量画面天然偏高）")
    if "grid_cv" in res:
        print(f"九宫格变异系数 {res['grid_cv']:.2f} → {res['nature']}"
              f"   （>0.5 元素级 / <0.3 只是整体运镜）")
    print(f"检出硬切 {res['cuts']} 个")

    dead = []
    if beats:
        print("")
        print("拍号  起始s   时长s  类型        均差   静止占比")
        for b in beats:
            flag = "  <<< 死拍" if b["mean"] < DEAD_BEAT else ""
            print(f"{b['id']:<6}{b['start_s']:6.1f}  {b['dur_s']:5.1f}  {b['kind']:<10}"
                  f"{b['mean']:6.2f}  {b['still_pct']:5.1f}%{flag}")
            if b["mean"] < DEAD_BEAT:
                dead.append(b["id"])
        print("")

    problems = []
    if dead:
        problems.append(f"{len(dead)} 拍几乎没动：{', '.join(dead)}")
    if res["still_pct"] > still_max:
        if strict:
            problems.append(f"静止占比 {res['still_pct']:.0f}% > {still_max:.0f}%（--strict）")
        else:
            print(f"参考：静止占比 {res['still_pct']:.0f}%（>{still_max:.0f}%，"
                  f"纸艺/矢量风格常见，默认不判失败；要当闸门加 --strict）")
    if "grid_cv" in res and res["grid_cv"] < cv_min:
        problems.append(f"九宫格 CV {res['grid_cv']:.2f} < {cv_min:.2f}（只是整幅运镜）")

    if problems:
        print("判定：不通过 —— " + "；".join(problems))
        print("返工方向：死拍补元素级动作（入场后继续动），而不是整幅抖动——"
              "整幅高频位移会让画面一直在颤。构图太空的拍优先改布局。")
        return False
    print("判定：通过")
    return True


def report_baseline(base_beats: list[dict], beats: list[dict], base_mean: float,
                    mean: float) -> None:
    """改版前后对比。看"这一拍是变活了还是变死了"，比看绝对值有用得多。"""
    base = {b["id"]: b for b in base_beats}
    print("")
    print("改版前后对比（基准 → 现在）")
    print("拍号        均差          变化        静止占比")
    for b in beats:
        o = base.get(b["id"])
        if not o:
            continue
        d = b["mean"] - o["mean"]
        arrow = "↑" if d > 0.05 else ("↓" if d < -0.05 else "＝")
        print(f"{b['id']:<10}{o['mean']:>6.2f} → {b['mean']:<6.2f}{arrow}{d:>+7.2f}"
              f"    {o['still_pct']:>5.1f}% → {b['still_pct']:<5.1f}%")
    dm = mean - base_mean
    arrow = "↑" if dm > 0.05 else ("↓" if dm < -0.05 else "＝")
    print(f"{'全片':<10}{base_mean:>6.2f} → {mean:<6.2f}{arrow}{dm:>+7.2f}")
    dropped = [b["id"] for b in beats
               if b["id"] in base and b["mean"] - base[b["id"]]["mean"] < -0.3]
    if dropped:
        print(f"注意：{', '.join(dropped)} 明显变死了（均差掉 0.3 以上），先看这几拍")


def main() -> int:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，↑ ↓ 这类符号会直接崩
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="成片动效体检")
    ap.add_argument("video", nargs="?", help="直接给视频路径；配合 --project 时可省略")
    ap.add_argument("--project", default=".", help="项目根目录，默认当前目录")
    ap.add_argument("--out", default="out/video.mp4", help="成片相对项目的路径")
    ap.add_argument("--timeline", default="src/timeline.json", help="timeline 相对项目的路径")
    ap.add_argument("--ffmpeg", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--grid-only", action="store_true", help="不按拍拆分，只看整体")
    ap.add_argument("--still-max", type=float, default=25.0, help="静止占比上限，默认 25")
    ap.add_argument("--cv-min", type=float, default=0.30, help="九宫格 CV 下限，默认 0.30")
    ap.add_argument("--strict", action="store_true", help="静止占比超标即失败（默认只作参考）")
    ap.add_argument("--baseline", default=None,
                    help="改版前的成片路径，用来逐拍对比增减")
    a = ap.parse_args()

    project = Path(a.project).resolve()
    video = Path(a.video) if a.video else project / a.out
    if not video.is_absolute():
        video = project / video
    if not video.exists():
        sys.exit(f"[motion] 找不到成片：{video}")

    ffmpeg = a.ffmpeg or find_ffmpeg(project)
    res = analyze(video, ffmpeg, use_grid=True)

    beats = []
    tl_path = project / a.timeline
    if not a.grid_only and tl_path.exists():
        impacts = {b["id"]: b for b in json.loads(tl_path.read_text("utf-8"))["beats"]}
        beats = per_beat(res, json.loads(tl_path.read_text("utf-8")))
        for b in beats:
            b["kind"] = impacts[b["id"]].get("visual", {}).get("kind", "?")

    ok = report(res, beats, a.still_max, a.cv_min, a.strict)

    if a.baseline:
        base = Path(a.baseline)
        if not base.is_absolute():
            base = project / base
        if not base.exists():
            sys.exit(f"[motion] 找不到基准成片：{base}")
        # 基准不需要九宫格，省一半时间
        bres = analyze(base, ffmpeg, use_grid=False)
        bbeats = []
        if tl_path.exists():
            bbeats = per_beat(bres, json.loads(tl_path.read_text("utf-8")))
        report_baseline(bbeats, beats, bres["mean"], res["mean"])

    if a.json:
        payload = {k: v for k, v in res.items() if not k.startswith("_")}
        payload["beats"] = beats
        payload["pass"] = ok
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

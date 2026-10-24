#!/usr/bin/env python3
"""
把 script.json 变成 timeline.json —— 这条流水线的时钟发生器。

做三件事：
  1. 逐 beat 用 Edge TTS 合成 public/audio/<beatId>.mp3，并取回**词级**时间戳
  2. 用 Remotion 自带的 ffprobe 量每个 mp3 的真实时长
  3. 累加出 src/timeline.json（每拍的起始帧、长度、音频偏移、词级帧号）

关键点：帧数是**测量结果**。写死 durationInFrames 是这条流水线唯一
不能做的事——那样画面必然和配音逐渐错位。
"""

from __future__ import annotations

import argparse
import asyncio
import glob
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------- bootstrap

def _bootstrap(project: Path) -> None:
    """没装 edge_tts 就自己建 .venv-tts 装上，然后换到那个解释器重跑自己。"""
    try:
        import edge_tts  # noqa: F401
        return
    except ImportError:
        pass

    venv_dir = project / ".venv-tts"
    venv_py = venv_dir / "Scripts" / "python.exe"
    if not venv_py.exists():
        if not venv_py.parent.exists():
            venv_py.parent.mkdir(parents=True, exist_ok=True)
        print("[tts] 创建虚拟环境 .venv-tts ...", flush=True)
        subprocess.check_call([sys.executable, "-m", "venv", str(venv_dir)])

    if sys.executable != str(venv_py):
        print("[tts] 安装 edge-tts ...", flush=True)
        subprocess.check_call(
            [str(venv_py), "-m", "pip", "install", "-q", "--disable-pip-version-check", "edge-tts"]
        )
        print("[tts] 切换到 .venv-tts 重新执行 ...", flush=True)
        os.execv(str(venv_py), [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]])

    sys.exit("[tts] 依赖装不上。请手动执行：python -m pip install edge-tts")


# ---------------------------------------------------------------- utilities

def find_ffprobe(project: Path) -> str:
    """Remotion 会把 ffprobe 打包进 compositor-*，直接用它，省得装 ffmpeg。"""
    for pat in (
        "node_modules/@remotion/compositor-*/ffprobe.exe",
        "node_modules/@remotion/compositor-*/ffprobe",
        "../node_modules/@remotion/compositor-*/ffprobe.exe",
    ):
        hits = sorted(glob.glob(str(project / pat)))
        if hits:
            return hits[0]
    which = shutil.which("ffprobe")
    if which:
        return which
    sys.exit("[tts] 找不到 ffprobe。先在项目里跑一次 npm install（Remotion 会带上它）。")


def probe_duration(ffprobe: str, media: Path) -> float:
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(media)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def valid_rate(rate: str) -> bool:
    """接受 +12% / -5% / +0% / 0% / +%。写成正则更不容易漏掉边界。"""
    return bool(re.fullmatch(r"[+-]?\d+%?", rate or ""))


# ---------------------------------------------------------------- tts core

async def synth_beat(
    text: str, voice: str, rate: str, volume: str, pitch: str, dest: Path, sem: asyncio.Semaphore
) -> list[dict]:
    import edge_tts

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            async with sem:
                comm = edge_tts.Communicate(
                    text, voice, rate=rate, volume=volume, pitch=pitch,
                    boundary="WordBoundary",
                )
                audio = bytearray()
                words: list[dict] = []
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        audio.extend(chunk["data"])
                    elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        words.append({
                            "offset": chunk["offset"] / 1e7,   # 100ns 单位 → 秒
                            "duration": chunk["duration"] / 1e7,
                            "text": chunk["text"],
                        })
                if not audio:
                    raise RuntimeError("TTS 返回空音频")
                dest.write_bytes(bytes(audio))
                return words
        except Exception as exc:  # 网络抖动 / 限流
            last_err = exc
            await asyncio.sleep(1.5 * (attempt + 1))

    raise RuntimeError(f"TTS 失败（重试 3 次）：{last_err}") from last_err


async def run_tts(jobs: list[dict], concurrency: int) -> None:
    sem = asyncio.Semaphore(concurrency)
    results = await asyncio.gather(
        *(synth_beat(j["text"], j["voice"], j["rate"], j["volume"], j["pitch"], j["dest"], sem)
          for j in jobs)
    )
    for job, words in zip(jobs, results):
        job["words"] = words

    total = sum(len(j["words"]) for j in jobs)
    print(f"[tts] 完成 {len(jobs)} 段，取到 {total} 个词级时间戳", flush=True)


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="script.json → 配音 + timeline.json")
    ap.add_argument("--project", default=".", help="项目根目录（含 script.json）")
    ap.add_argument("--rate", default=None, help="覆盖 script.json 的语速，如 +15%%")
    ap.add_argument("--voice", default=None, help="覆盖 script.json 的音色")
    ap.add_argument("--only", default=None, help="只重做某个 beat（保留其余已合成的音频）")
    ap.add_argument("--concurrency", type=int, default=4, help="并发合成路数，默认 4")
    ap.add_argument("--force", action="store_true", help="忽略缓存，全部重新合成")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    _bootstrap(project)

    script_path = project / "script.json"
    if not script_path.exists():
        sys.exit(f"[tts] 找不到 {script_path}")

    script = json.loads(script_path.read_text(encoding="utf-8"))

    fps = int(script.get("fps", 30))
    rate = args.rate or script.get("rate", "+12%")
    if not valid_rate(rate):
        sys.exit(f"[tts] 语速格式不对：{rate}（应该是 +12% / -5% 这种）")
    voice = args.voice or script.get("voice", "zh-CN-YunjianNeural")
    volume = script.get("volume", "+0%")
    pitch = script.get("pitch", "+0Hz")

    audio_dir = project / "public" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    beats = script.get("beats") or []
    if not beats:
        sys.exit("[tts] script.json 里没有 beats")

    print(f"[tts] 音色 {voice}  语速 {rate}  {len(beats)} 拍", flush=True)

    # ---- 1. 合成（带缓存：旁白/音色/语速没变就复用，避免每次都打网络）
    jobs = []
    cached: dict[str, list[dict]] = {}

    for b in beats:
        nar = (b.get("narration") or "").strip()
        if not nar:
            continue

        bid = b["id"]
        media = audio_dir / f"{bid}.mp3"
        sidecar = audio_dir / f"{bid}.words.json"
        # 指纹必须覆盖旁白本身：改了文案却复用旧音频/旧时间戳，
        # 会产出「文字是新的、声音是旧的」这种极难排查的成片
        fingerprint = hashlib.sha1(
            f"{nar}|{voice}|{rate}|{volume}|{pitch}".encode("utf-8")
        ).hexdigest()

        forced = args.force or (args.only is not None and args.only == bid)
        reusable = False
        if not forced and media.exists() and sidecar.exists():
            try:
                saved = json.loads(sidecar.read_text(encoding="utf-8"))
                reusable = saved.get("fingerprint") == fingerprint
                if reusable:
                    cached[bid] = saved["words"]
            except Exception:
                reusable = False

        if not reusable:
            jobs.append({
                "id": bid, "text": nar, "voice": voice, "rate": rate,
                "volume": volume, "pitch": pitch, "dest": media,
                "sidecar": sidecar, "fingerprint": fingerprint,
            })

    if args.only and not jobs:
        sys.exit(f"[tts] --only {args.only} 没匹配到任何 beat（该 beat 的旁白是空的？）")

    reused = len(cached)
    if jobs:
        print(f"[tts] 合成 {len(jobs)} 段" + (f"（复用缓存 {reused} 段）" if reused else ""), flush=True)
        asyncio.run(run_tts(jobs, max(1, args.concurrency)))

        for j in jobs:
            j["sidecar"].write_text(
                json.dumps(
                    {
                        "fingerprint": j["fingerprint"],
                        "voice": voice, "rate": rate,
                        "narration": j["text"], "words": j.get("words", []),
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            cached[j["id"]] = j.get("words", [])

    # ---- 2. 量时长 + 累加帧数
    #
    # 这里是本脚本最容易写错的地方，说清楚三件事：
    #
    # 1) from / durationInFrames 是**实测值**，也就是音频时钟本身。
    #    音频在代码里按 from + audioFrom 绝对摆放，**不参与转场交叠**。
    #
    # 2) 转场的交叠必须从**旁白之间的气口**里扣，不能凭空吃。
    #    每拍尾部的留白取 max(padAfter, 下一拍的 transitionFrames)，
    #    这样 TransitionSeries 的总长恰好等于「旁白总长 + 最后一拍的气口」，
    #    转场不额外拉长也不缩短片子。
    #
    # 3) 总长还要对音频再兜一次底：取「视觉总长」和「音频结束位置」的较大者。
    #    少了这一步，一旦留白被放大，片尾旁白就会被静默截断——
    #    这类 bug 在预览单帧时完全看不出来。
    ffprobe = find_ffprobe(project)
    default_te = int(round(float(script.get("transitionFrames", 10))))

    # ---- 2a. 先把音频时长量出来
    measured = []
    for i, b in enumerate(beats):
        bid = b["id"]
        pad_before = float(b.get("padBefore", 0.0))
        audio_from = None
        words = []
        audio_frames = 0

        if cached.get(bid):
            media = audio_dir / f"{bid}.mp3"
            secs = probe_duration(ffprobe, media)
            audio_from = int(round(pad_before * fps))
            words = [
                {
                    "t": int(round((audio_from + w["offset"]) * fps)),
                    "d": max(1, int(round(w["duration"] * fps))),
                    "text": w["text"],
                }
                for w in cached[bid]
            ]
            audio_frames = int(math.ceil(secs * fps))
        measured.append({
            "id": bid,
            "audioFrom": audio_from,
            "audioFrames": audio_frames,
            "words": words,
            "padAfterFrames": int(round(float(b.get("padAfter", 0.35)) * fps)),
        })

    # ---- 2b. 转场长度：进入这一拍的转场，第 0 拍没有前一段可交叠
    for i, b in enumerate(beats):
        te = int(round(float(b.get("transitionFrames", default_te))))
        name = b.get("transition", script.get("transition", "fade"))
        if i == 0 or not te or name in ("none", None, ""):
            te = 0
        measured[i]["transition"] = name
        measured[i]["te"] = max(0, min(te, 2 * fps))  # 上限 2 秒，防止整段被拉长

    # ---- 2c. 累加：尾部留白至少要装得下通往下一拍的转场
    #
    # 光标必须走**视觉时钟**，不能走音频时钟。视觉用 TransitionSeries，每加一个
    # te 帧的转场，后面所有拍都会整体提前 te 帧；音频是绝对摆放的、不会被压缩。
    # 两个时钟不同步的直接后果：越往后画面越早、片尾留下一段没有任何画面的空白。
    # 所以这里 per-beat 扣掉下一拍的转场长度，让 from 同时是音频和视觉的起点。
    cursor = 0
    out_beats = []
    for i, b in enumerate(beats):
        m = measured[i]
        next_te = measured[i + 1]["te"] if i + 1 < len(measured) else 0
        tail = max(m["padAfterFrames"], next_te)

        if m["audioFrom"] is not None:
            dur = m["audioFrom"] + m["audioFrames"] + tail
        else:
            # 无声拍：只有视觉留白
            hold = float(b.get("hold", 0))
            dur = max(fps, int(round(hold * fps)))

        out_beats.append({
            "id": m["id"],
            "from": cursor,
            "durationInFrames": dur,
            "audioFrom": m["audioFrom"],
            "transition": m["transition"],
            "transitionFrames": m["te"],
            "narration": b.get("narration", ""),
            "words": m["words"],
            "visual": b.get("visual", {"kind": "kinetic"}),
        })
        cursor += dur - next_te

    # 走完最后一拍，cursor 就是视觉轨的结束帧（= 音频结束帧）
    visual_total = cursor

    # 音频结束位置（绝对帧）。无声拍不参与。
    spoken = [x for x in out_beats if x["audioFrom"] is not None]
    audio_end = (spoken[-1]["from"] + spoken[-1]["durationInFrames"]) if spoken else 0

    tail_pad = int(round(float(script.get("tailPad", 0.6)) * fps))
    # 兜底：视觉被转场压缩，音频不会跟着压缩，所以总长必须听得过音频的
    total = max(visual_total, audio_end) + tail_pad

    timeline = {
        "title": script.get("title", "untitled"),
        "voice": voice,
        "rate": rate,
        "fps": fps,
        "width": int(script.get("width", 1920)),
        "height": int(script.get("height", 1080)),
        "totalFrames": total,
        # 字幕轨跟随旁白。中文解说视频基本都要开。
        "captions": bool(script.get("captions", True)),
        # 配乐床。有 music.src 才带下去（文件由使用者提供，放 public/ 下）
        "music": script.get("music") if script.get("music", {}).get("src") else None,
        "beats": out_beats,
    }

    tpath = project / "src" / "timeline.json"
    tpath.parent.mkdir(parents=True, exist_ok=True)
    tpath.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")

    secs_total = timeline["totalFrames"] / fps
    print(f"[tts] 写出 {tpath}")
    print(f"[tts] 总长 {timeline['totalFrames']} 帧 = {secs_total:.1f}s @ {fps}fps，"
          f"{len(out_beats)} 拍")
    for b in out_beats:
        mark = "·" if b["audioFrom"] is not None else "○"
        print(f"  {mark} {b['id']:<14} {b['durationInFrames']:>4}帧 "
              f"({b['durationInFrames'] / fps:4.1f}s)  {b['visual'].get('kind')}")


if __name__ == "__main__":
    main()
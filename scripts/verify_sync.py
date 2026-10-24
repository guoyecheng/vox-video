#!/usr/bin/env python3
"""
校验成片的音画同步。

为什么需要这个
--------------
本 skill 的整个架构建立在「音频是时钟」上：TTS 返回的词级时间戳是真值，
时间轴由它推导。但**从源 MP3 到渲出的 MP4，中间还有编码/封装这一段**，
AAC encoder 会填充一段 priming 样本，导致渲出成片的音轨相对视频**整体偏后**。

这个偏移是常数（由 Remotion 版本 + codec + 采样率 + 容器共同决定），
量一次、记下来、减掉即可。它不影响"帧数从哪来"，但会影响"观众听到人声的
那一帧到底是不是我们算出来的那一帧"。

量法（纯标准库，不需要 numpy）
---------------------------
1. 把成片和每个源 MP3 都抽成 8kHz 单声道 WAV
2. 在两边各自找**语音起点**（首个超过阈值的能量帧）。
   TTS 源音频自带一小段前导静音，两边都有，所以**起点之差就是管线偏移**
3. 和时间轴推算的绝对位置比对，输出每拍的误差

注意配乐床：本脚本的人声起点探针只看**能量上跳**，分不清旁白和配乐。
写了 music 的片子，音乐若在旁白之前淡入（我们推荐的做法），首拍探针会测到
音乐的起点，得出一个假的偏移。**测同步请先在 script.json 里去掉 music
重新渲染，或直接拿无配乐版本测**；另外 ±2~3 帧是这套量法本身的测量精度。

用法
----
    python verify_sync.py --project "<项目路径>"
    python verify_sync.py --project "<项目>" --out out/video.mp4
"""

from __future__ import annotations

import argparse
import array
import glob
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

SAMPLE_RATE = 8000      # 降采样到 8k：纯 Python 也能秒级处理，且语音包络足够清晰
BIN = 0.001             # 能量帧长 1ms = 8 samples
THRESHOLD = 0.06        # 相对该信号 95 分位的门限


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
    sys.exit("[sync] 找不到 ffmpeg。先在项目里跑一次 npm install。")


def to_wav(src: Path, dest: Path, ffmpeg: str) -> Path:
    subprocess.run(
        [ffmpeg, "-v", "error", "-y", "-i", str(src),
         "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", str(dest)],
        check=True,
    )
    return dest


# ---------------------------------------------------------------- 音频分析

def read_wav_mono(path: Path) -> array.array:
    with wave.open(str(path), "rb") as w:
        n = w.getnframes()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw)
    if sys.byteorder == "big":
        a.byteswap()
    return a


def envelope(samples: array.array) -> list[float]:
    """1ms 一格的 RMS 包络"""
    hop = SAMPLE_RATE // 1000
    out: list[float] = []
    for i in range(0, len(samples) - hop, hop):
        acc = 0
        for j in range(i, i + hop):
            v = samples[j]
            acc += v * v
        out.append(math.sqrt(acc / hop))
    return out


def speech_onset_ms(env: list[float]) -> int | None:
    """首个显著能量出现的时刻。用人声的 95 分位当参考，
    这样绝对电平高低（不同音色差异很大）不会影响判定。"""
    if not env:
        return None
    s = sorted(env)
    p95 = s[int(len(s) * 0.95)]
    if p95 <= 0:
        return None
    th = p95 * THRESHOLD
    for i, v in enumerate(env):
        if v >= th:
            return i
    return None


def rms_db(samples: array.array) -> float:
    if not samples:
        return -120.0
    acc = sum(v * v for v in samples)
    return 20 * math.log10(math.sqrt(acc / len(samples)) / 32768.0 + 1e-12)


# ---------------------------------------------------------------- 主流程

def main() -> None:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，→ 这类符号会直接崩
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="校验成片音画同步")
    ap.add_argument("--project", default=".")
    ap.add_argument("--out", default=None, help="成片路径，默认 out/video.mp4")
    ap.add_argument("--tol-frames", type=float, default=3.0,
                    help="可接受的抖动（帧）。默认 3——低于这个量级无法与测量误差区分")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    mp4 = Path(args.out) if args.out else project / "out" / "video.mp4"
    if not mp4.exists():
        sys.exit(f"[sync] 找不到成片 {mp4}")

    tl_path = project / "src" / "timeline.json"
    if not tl_path.exists():
        sys.exit("[sync] 找不到 src/timeline.json，先跑 npm run tts")
    tl = json.loads(tl_path.read_text(encoding="utf-8"))

    ffmpeg = find_ffmpeg(project)
    tmp = Path(tempfile.mkdtemp(prefix="vox-sync-"))

    try:
        print("[sync] 抽成片音轨 ...", flush=True)
        vw = to_wav(mp4, tmp / "video.wav", ffmpeg)
        v_samples = read_wav_mono(vw)
        v_env = envelope(v_samples)
        print(f"[sync] 成片音轨 {len(v_samples)/SAMPLE_RATE:.2f}s  "
              f"RMS {rms_db(v_samples):.1f} dBFS")

        fps = tl.get("fps", 30)
        beats = tl.get("beats", [])
        spoken = [b for b in beats if b.get("audioFrom") is not None]
        if not spoken:
            sys.exit("[sync] 时间轴里没有任何带旁白的拍")

        # ---- 管线偏移：拿第一拍当探针（它的 audioFrom 最小，起点最靠前）
        first = spoken[0]
        src = project / "public" / "audio" / f"{first['id']}.mp3"
        if not src.exists():
            sys.exit(f"[sync] 找不到 {src}")
        sw = to_wav(src, tmp / f"{first['id']}.wav", ffmpeg)
        s_samples = read_wav_mono(sw)
        s_onset = speech_onset_ms(envelope(s_samples))
        v_onset = speech_onset_ms(v_env)
        if s_onset is None or v_onset is None:
            sys.exit("[sync] 找不到语音起点，无法测量")

        # 源 MP3 自带 s_onset 毫秒的前导静音（TTS 合成的固有特性）。
        # 理想时间轴里，这一拍的人声应当出现在：
        #   音频起点 + 源音频的前导静音
        # 成片里实际测到的是 v_onset，两者之差即管线偏移。
        audio_start_ms = (first["from"] + first["audioFrom"]) * 1000.0 / fps
        expected_ms = audio_start_ms + s_onset
        measured_ms = float(v_onset)

        offset_ms = measured_ms - expected_ms
        offset_frames = offset_ms / 1000.0 * fps
        print(f"\n[sync] 管线偏移（以 {first['id']} 为探针）")
        print(f"       音频应落在        {audio_start_ms:.0f} ms")
        print(f"       源音频前导静音    {s_onset} ms")
        print(f"       理论人声起点      {expected_ms:.0f} ms")
        print(f"       成片实际人声起点  {measured_ms:.0f} ms")
        print(f"       → 偏移 {offset_ms:+.0f} ms = {offset_frames:+.2f} 帧 @{fps}fps")

        if abs(offset_frames) <= 0.5:
            print("       判定：偏移可忽略，无需补偿")
        else:
            print(f"       判定：存在系统性偏移 {abs(offset_frames):.2f} 帧。"
                  f"当前版本没有自动补偿字段——要抵消就逐拍调 padBefore 后重跑 tts，"
                  f"或接受这个误差")

        # ---- 逐拍误差表（已扣除同一个管线偏移后的"残余"）
        print(f"\n[sync] 逐拍同步误差表（包络互相关）")
        print(f"{'beat':<16}{'理论(ms)':>10}{'实测(ms)':>10}{'残差(f)':>10}")
        rows = []
        for b in spoken:
            src = project / "public" / "audio" / f"{b['id']}.mp3"
            if not src.exists():
                continue
            sw = to_wav(src, tmp / f"{b['id']}.wav", ffmpeg)
            s_env = envelope(read_wav_mono(sw))
            lead = speech_onset_ms(s_env)
            if lead is None:
                continue
            center = int((b["from"] + b["audioFrom"]) * 1000.0 / fps) + lead
            # 模板取语音起点之后 80~380ms 这一段，避开 TTS 自带的前导静音
            tmpl = s_env[lead + 80: lead + 380]
            if len(tmpl) < 50:
                continue
            shift = align_offset(v_env, tmpl, center)
            resid = shift / 1000.0 * fps
            rows.append({"id": b["id"], "expected_ms": center,
                         "measured_ms": round(center + shift, 1),
                         "residual_frames": round(resid, 2)})
            print(f"{b['id']:<16}{center:>10}{center + shift:>10.0f}{resid:>10.2f}")

        # ---- 结论：区分"系统性偏移"和"抖动"，这两者的处理方式完全不同
        # 全部拍残差都相同 → 常数偏移，可整体补偿；
        # 残差随时间散开 → 真的在漂移，要去找原因。
        if not rows:
            sys.exit("[sync] 没有任何拍能测（源 mp3 缺失，或语音段短于模板长度）")
        resids = [r["residual_frames"] for r in rows]
        mean_r = sum(resids) / len(resids)
        jitter = max(abs(x - mean_r) for x in resids)
        # 这是互相关量出来的系统性偏移，和上面 onset 探针那个不是同一个测量
        systematic_frames = mean_r

        verdict = "通过" if jitter <= args.tol_frames else "抖动超容差"

        print(f"\n[sync] 结论")
        print(f"       系统性偏移 {systematic_frames:+.2f} 帧（互相关，所有拍一致，可整体补偿）")
        print(f"       onset 探针 {offset_frames:+.2f} 帧（仅首拍，配乐淡入在前时这个值不可信）")
        print(f"       抖动       ±{jitter:.2f} 帧（逐拍离散度，容差 {args.tol_frames}）")
        print(f"       判定       {verdict}")
        print(f"       测量精度   8kHz 包络互相关对中文语音约有 ±2~3 帧的音节歧义，"
              f"小于这个量级的残差无法与测量误差区分")

        out = project / "out" / "sync-report.json"
        out.write_text(json.dumps({
            "fps": fps,
            # onset 探针（首拍能量起点）与互相关（全部拍）是两个独立的测量
            "onset_offset_ms": round(offset_ms, 1),
            "onset_offset_frames": round(offset_frames, 3),
            "systematic_offset_frames": round(systematic_frames, 3),
            "jitter_frames": round(jitter, 2),
            "tolerance_frames": args.tol_frames,
            "verdict": verdict,
            "measurement_precision_frames": 3.0,
            "beats": rows,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[sync] 报告已写入 {out}")

        if verdict != "通过":
            sys.exit(1)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def align_offset(video_env: list[float], tmpl: list[float], center_ms: int,
                 window_ms: int = 400) -> float:
    """在理论时刻附近滑动源音频的包络模板，取相关性最高的位移。

    不能用「找能量上跳最大的点」——旁白是连续语音，一个句子里哪个音节
    更响是随机的，那样测出来的是音节混淆而不是同步误差（会得到毫无规律的
    几帧到十几帧，读起来像漂移，其实全错）。

    用包络模板做互相关：源音频开头 300ms 的起伏形状在成片音轨里唯一，
    把它对回去得到的就是真实位移。
    """
    n = len(tmpl)
    if n == 0:
        return 0.0

    mu_t = sum(tmpl) / n
    tmpl_c = [v - mu_t for v in tmpl]
    norm_t = math.sqrt(sum(v * v for v in tmpl_c)) or 1e-9

    best_d, best_score = 0, -1e18
    lo = max(0, center_ms - window_ms)
    hi = min(len(video_env) - n, center_ms + window_ms)

    for d in range(lo, hi + 1):
        seg = video_env[d:d + n]
        if len(seg) < n:
            break
        mu_v = sum(seg) / n
        acc = 0.0
        vv = 0.0
        for i in range(n):
            x = seg[i] - mu_v
            acc += x * tmpl_c[i]
            vv += x * x
        denom = norm_t * (math.sqrt(vv) or 1e-9)
        score = acc / denom
        if score > best_score:
            best_score, best_d = score, d

    return float(best_d - center_ms)


if __name__ == "__main__":
    main()
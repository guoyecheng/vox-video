#!/usr/bin/env python3
"""
开渲前的体检：把"渲完 6 分钟才发现"的错挡在前面。

为什么需要这个
--------------
Remotion 渲染很慢（一条 60 秒的片子 3-8 分钟），而 `script.json` 里的错
大部分是**静默**的：

- `visual.image` 写成 `img/shot-road.png`，但文件其实叫 `shot-road.jpg`
  → 渲染不报错，画面上就是空白
- `visual.layers` 给了 `band` 没给 `y` → 所有层堆在画面底部，远景被中景盖死
- `kind: "kinetic"` 的 `words` 和旁白对不上 → 上屏的词和念出来的不同时
- `kind: "image"` 忘了写 `src` → 这一拍空白
- 图的路径写成了 `public/img/x.png` → 运行时找不到

这些在浏览器里预览能看出来，但没人会为了一个错字渲整片。
这个脚本把它们变成秒级的检查。

检查项
------
1. 结构：beats 非空、id 不重复、每拍有 kind、kind 合法
2. 必填字段：每种 kind 需要的字段在不在（stat 要 value、compare 要 left/right…）
3. 旁白：非空；kinetic 的 words 必须按顺序出现在旁白里
4. 素材：image / src / layers[].src 引用的文件在 public/ 下真的存在
5. 图层：band / y / depth 的取值范围；给了 band 不给 y 会让层堆在底部
6. 取值域：imageLayout / impact / ambient / transition 这些枚举别写错
7. 环境：字体文件在不在（缺了中文会静默回落雅黑）

用法
----
    python preflight.py --project "<项目>"
    python preflight.py --project "<项目>" --strict   # 提醒也算失败

退出码：0 通过；1 有错（提醒不影响退出码，除非 --strict）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

KINDS = {
    "kinetic", "stat", "odometer", "quote", "highlight", "compare",
    "split", "timeline", "cards", "stack", "image", "person",
    "route", "callout", "chart",
}

# 每种 kind 真正必须有的字段（缺了就是空拍或渲染报错）
REQUIRED = {
    "stat": ["value"], "odometer": ["value"], "quote": ["text"],
    "highlight": ["text"], "compare": ["left", "right"],
    "split": ["panels"], "timeline": ["milestones"],
    "cards": ["items"], "stack": ["items"], "image": ["src"],
    "person": ["name"], "route": ["points"], "callout": ["notes"],
    "chart": ["data"],
}

TRANSITIONS = {
    "none", "fade", "dissolve", "wipe", "iris", "clockWipe", "slide",
    "pushCut", "blurSlide", "flip", "bookFlip", "crossZoom", "zoomInOut",
    "dreamyZoom", "filmBurn", "ripple",
    # 别名
    "default", "push", "cut", "hard", "book", "burn",
}
IMAGE_LAYOUTS = {"full", "inset"}
CAMERA_MOVES = {"push_in", "pull_out", "pan", "tilt", "parallax", "whip", "static"}
VFX = {"none", "confetti", "starburst"}
# references/arcs.md 里的叙事弧
ARCS = {
    "hook_payoff", "how_it_works", "timeline", "chronicle", "man_in_hole",
    "myth_buster", "three_act", "origin", "story_spine", "pas", "bab",
    "aida", "listicle", "story_circle",
}
IMPACTS = {"soft", "medium", "heavy"}
AMBIENTS = {"off", "soft", "normal", "strong"}

FONTS = ["public/fonts/NotoSansSC-VF.ttf", "public/fonts/ArchivoBlack-Regular.ttf"]


def kinds_from_code(project: Path) -> set[str] | None:
    """从项目源码里读 VisualKind，免得脚本和代码两套名单。

    必须截到声明自己的那个分号：VisualKind 后面紧跟着 CameraMove / VfxKind / PieceIn，
    按固定长度截取会把 "pan"、"none" 这类枚举值当成合法 kind 放过。
    """
    p = project / "src" / "timeline.ts"
    if not p.exists():
        return None
    txt = p.read_text("utf-8")
    i = txt.find("export type VisualKind")
    if i < 0:
        return None
    block = txt[i:]
    end = block.find(";")
    if end < 0:
        return None
    names = set(re.findall(r'"(\w+)"', block[:end]))
    return names or None


def transitions_from_code(project: Path) -> set[str] | None:
    """从 transitions.ts 里读注册表和别名。"""
    p = project / "src" / "transitions.ts"
    if not p.exists():
        return None
    txt = p.read_text("utf-8")
    names = set(re.findall(r"^\s{2}(\w+),", txt, re.M))
    aliases = set(re.findall(r"(\w+):\s*\"(\w+)\"", txt))
    names |= {a for a, _ in aliases}
    return names or None


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warns: list[str] = []

    def err(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}：{msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warns.append(f"{where}：{msg}")


def is_remote(p: str) -> bool:
    return p.startswith(("http://", "https://", "data:"))


def check_asset(project: Path, rep: Report, where: str, path: str) -> None:
    """引用的素材必须在 public/ 下真的存在。"""
    if not path or is_remote(path):
        return
    rel = path.lstrip("/")
    if rel.startswith("public/"):
        rep.warn(where, f"路径写成了 {path}；visual 里应该写相对 public/ 的路径，比如 "
                        f"{rel[len('public/'):]}")
        rel = rel[len("public/"):]
    if not (project / "public" / rel).exists():
        rep.err(where, f"素材不存在：public/{rel}")


def check_layers(project: Path, rep: Report, where: str, visual: dict) -> None:
    layers = visual.get("layers")
    if layers is None:
        return
    if not isinstance(layers, list) or not layers:
        rep.err(where, "layers 是空数组或不是数组")
        return
    for i, l in enumerate(layers):
        w = f"{where}.layers[{i}]"
        if not isinstance(l, dict):
            rep.err(w, "不是一个对象")
            continue
        src = l.get("src")
        if not src:
            rep.err(w, "少了 src")
        else:
            check_asset(project, rep, w, src)
        band = l.get("band")
        y = l.get("y")
        depth = l.get("depth")
        if band is not None:
            if not isinstance(band, (int, float)) or not (0 < band <= 1):
                rep.err(w, f"band 应该在 (0, 1]，现在是 {band}")
            if y is None:
                rep.err(w, "给了 band 就要给 y——不给的话这条带默认落在画面底部，"
                           "远景会被中景盖死")
        if y is not None:
            if not isinstance(y, (int, float)) or not (0 <= y <= 1):
                rep.err(w, f"y 应该在 [0, 1]，现在是 {y}")
            elif y + (band or 0) > 1.02:
                rep.warn(w, f"y({y}) + band({band}) 超过 1，这层会掉出画面")
        if depth is not None:
            if not isinstance(depth, (int, float)) or not (0 <= depth <= 1):
                rep.err(w, f"depth 应该在 [0, 1]，现在是 {depth}")


PIECE_ENTERS = {"fly_left", "fly_right", "fly_up", "drop", "slap", "pop"}


def check_pieces(project: Path, rep: Report, where: str, visual: dict) -> None:
    """碎片拼贴（pieceBase + pieces）的校验。

    这套参数最容易错的地方不是语法，而是**位置和尺寸的语义**：
    x/y/w/h 是画幅比例（0-1），不是像素、也不是百分比。
    """
    base = visual.get("pieceBase")
    pieces = visual.get("pieces")
    if not base and not pieces:
        return
    if not base:
        rep.err(where, "有 pieces 但没有 pieceBase——碎片没有底图可取")
        return
    if not pieces:
        rep.err(where, "有 pieceBase 但没有 pieces——那只是一张整图，用 image 就行")
        return
    check_asset(project, rep, f"{where}.pieceBase", base)
    if not str(base).startswith("img/"):
        rep.warn(f"{where}.pieceBase", "习惯上放在 public/img/ 下，路径写 img/xxx.png")

    # 底图和整幅图会各画一遍：pieceBase 上面再压一张同图的 image 就是双重底
    if visual.get("image"):
        rep.err(where, "pieceBase 和 image 同时给了——底图会画两遍（碎片底下多一张完整的图，"
                       "挖的洞就白挖了）。只用 pieceBase")
    if visual.get("layers"):
        rep.warn(where, "pieceBase 和 layers 同时给了：layers 会先铺一层背景，碎片盖在它上面。"
                        "确认这是你要的效果")

    if not isinstance(pieces, list):
        rep.err(f"{where}.pieces", "不是数组")
        return

    total = 0.0
    for i, p in enumerate(pieces):
        w = f"{where}.pieces[{i}]"
        if not isinstance(p, dict):
            rep.err(w, "不是一个对象")
            continue
        for k in ("x", "y", "w", "h"):
            v = p.get(k)
            if not isinstance(v, (int, float)):
                rep.err(w, f"{k} 必须是数字（画幅比例 0-1），现在是 {v!r}")
                break
            if not (0 <= v <= 1):
                rep.err(w, f"{k} 应该在 [0, 1]（画幅比例），现在是 {v}")
                break
        else:
            if p["w"] < 0.02 or p["h"] < 0.02:
                rep.err(w, f"块太小了（w={p['w']}, h={p['h']}）——"
                           f"小于 2% 的块飞起来看不出来，只会像噪点")
            if p["x"] + p["w"] > 1.001 or p["y"] + p["h"] > 1.001:
                rep.err(w, f"块超出画幅（x+w={p['x'] + p['w']:.3f}, "
                           f"y+h={p['y'] + p['h']:.3f}，应该 ≤ 1）")
            total += p["w"] * p["h"]
        enter = p.get("enter")
        if enter is None:
            # 不给 enter 时组件默认 pop，但那是最不好看的一种，值得提醒
            rep.warn(w, "没写 enter（组件会按 pop 处理）——飞入/落下比原地放大有戏")
        elif enter not in PIECE_ENTERS:
            rep.err(w, f"enter 只能是 {', '.join(sorted(PIECE_ENTERS))}，现在 {enter}")
        at = p.get("at")
        if at is not None and (not isinstance(at, (int, float)) or at < 0):
            rep.err(w, f"at 是「这一拍第几帧开始」（≥0），现在是 {at!r}")
        depth = p.get("depth")
        if depth is not None and (not isinstance(depth, (int, float)) or not (0 <= depth <= 1)):
            rep.err(w, f"depth 应该在 [0, 1]，现在是 {depth}")
        spin = p.get("spin")
        if spin is not None and (not isinstance(spin, (int, float)) or abs(spin) > 8):
            rep.warn(w, f"spin={spin} 度偏大——超过 8 度就不再像「被甩进来」，像翻倒")

    if total < 0.55:
        rep.warn(where, f"碎片只盖住画幅的 {total * 100:.0f}%——没盖到的位置会一直是"
                        f"挖空的纸底（除非你就是想留个缺口）")


def check_visual(project: Path, rep: Report, where: str, visual: dict, narration: str = "",
                 kinds: set[str] | None = None) -> None:
    kinds = kinds or KINDS
    if not isinstance(visual, dict):
        rep.err(where, "visual 不是一个对象")
        return
    kind = visual.get("kind")
    if not kind:
        rep.err(where, "少了 visual.kind")
        return
    if kind not in kinds:
        rep.err(where, f"kind '{kind}' 不认识（合法的：{', '.join(sorted(kinds))}）")
        return

    for f in REQUIRED.get(kind, []):
        v = visual.get(f)
        if v is None or (isinstance(v, (list, dict, str)) and len(v) == 0):
            rep.err(where, f"kind '{kind}' 必须有 {f}")

    if kind == "kinetic":
        words = visual.get("words")
        if not words:
            rep.warn(where, "kinetic 没有 words，上屏的就是整句旁白（想要逐词跳动就得写 words）")
        else:
            # 组件对"上屏词不在旁白里"是容忍的（resolveWordTimings 有别名和顺序兜底），
            # 所以这是提醒不是错——但对不上会让词错位弹出来。
            pos = -1
            for w in words:
                idx = narration.find(w, pos + 1)
                if idx < 0:
                    rep.warn(where, f"words 里的「{w}」不是旁白的原样片段，"
                                   f"组件会按顺序兜底——上屏时刻可能和念到它的时刻错开")
                    break
                pos = idx

    if visual.get("image"):
        check_asset(project, rep, f"{where}.image", visual["image"])
        if not str(visual["image"]).startswith("img/"):
            rep.warn(f"{where}.image", "习惯上放在 public/img/ 下，路径写 img/xxx.png")
    if kind == "image" and visual.get("src"):
        check_asset(project, rep, f"{where}.src", visual["src"])

    layout = visual.get("imageLayout")
    if layout is not None and layout not in IMAGE_LAYOUTS:
        rep.err(f"{where}.imageLayout", f"只能是 {', '.join(sorted(IMAGE_LAYOUTS))}，现在 {layout}")
    if layout == "inset" and kind in {"chart", "timeline", "split"}:
        rep.warn(where, "inset 的角贴照片在右边，chart/timeline 不会自动让位，"
                        "内容要自己收进左半幅")

    cam = visual.get("camera")
    if cam and cam not in CAMERA_MOVES:
        rep.err(f"{where}.camera", f"只能是 {', '.join(sorted(CAMERA_MOVES))}，现在 {cam}")
    vfx = visual.get("vfx")
    if vfx and vfx not in VFX:
        rep.err(f"{where}.vfx", f"只能是 {', '.join(sorted(VFX))}，现在 {vfx}")
    if vfx == "confetti" and kind == "stat":
        rep.warn(where, "大数字特写上撒纸屑会干扰读数")
    if not visual.get("elementMotion"):
        rep.warn(where, "没写 elementMotion（这一拍画面里什么在动）——"
                        "两根轴少一根，这一拍容易看起来像 PPT")

    if visual.get("impact") and visual["impact"] not in IMPACTS:
        rep.err(f"{where}.impact", f"只能是 {', '.join(sorted(IMPACTS))}")
    if visual.get("ambient") and visual["ambient"] not in AMBIENTS:
        rep.err(f"{where}.ambient", f"只能是 {', '.join(sorted(AMBIENTS))}")

    check_layers(project, rep, where, visual)
    check_pieces(project, rep, where, visual)

    # 经验提醒：不是错，但会明显掉观感
    if kind == "stat" and (visual.get("image") or visual.get("layers")):
        rep.warn(where, "大数字特写加背景会压住数字，这种拍留白最好")
    if kind == "person" and visual.get("layers"):
        rep.warn(where, "person 拍 + 背景层：确认左侧的圆形剪影没有被横带截断"
                        "（把带压到 y ≤ 0.72 最稳，或者干脆用整幅图）")


# ---------------------------------------------------------------- 主体


def check_script(project: Path, rep: Report, kinds: set[str] | None = None,
                 transitions: set[str] | None = None) -> dict:
    kinds = kinds or KINDS
    transitions = transitions or TRANSITIONS
    path = project / "script.json"
    if not path.exists():
        rep.err("script.json", "不存在")
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
    except Exception as e:  # noqa: BLE001
        rep.err("script.json", f"不是合法 JSON：{e}")
        return {}

    beats = data.get("beats")
    if not isinstance(beats, list) or not beats:
        rep.err("script.json", "没有 beats")
        return data

    seen: set[str] = set()
    for i, b in enumerate(beats):
        where = f"beats[{i}]"
        if not isinstance(b, dict):
            rep.err(where, "不是一个对象")
            continue
        bid = b.get("id")
        if not bid:
            rep.err(where, "少了 id")
        else:
            where = f"{bid}"
            if bid in seen:
                rep.err(where, "id 重复")
            seen.add(bid)
        narration = b.get("narration")
        if not isinstance(narration, str) or not narration.strip():
            if not b.get("hold"):
                rep.err(where, "旁白是空的（想放空镜就写 hold）")
        if b.get("transition") and b["transition"] not in transitions:
            rep.err(where, f"transition '{b['transition']}' 不认识"
                           f"（合法的：{', '.join(sorted(transitions))}）")
        check_visual(project, rep, where, b.get("visual") or {}, narration or "", kinds)

    music = data.get("music")
    if music:
        if not isinstance(music, dict):
            rep.err("script.json", "music 必须是一个对象")
        else:
            msrc = str(music.get("src") or "").strip()
            if not msrc:
                rep.err("script.json", "music.src 不能为空（配乐文件相对 public/）")
            elif not (project / "public" / msrc).exists():
                rep.err("script.json", f"配乐文件不存在：public/{msrc}"
                                      "（音乐由使用者提供，放进 public/ 目录）")
            # 音量提醒跟文件在不在无关，两件事都要报
            try:
                gain = float(music.get("gain", 0.2) or 0)
                duck = float(music.get("duck", 0.6) or 0)
            except (TypeError, ValueError) as e:
                rep.err("script.json", f"music.gain/duck 要是数字：{e}")
            else:
                if gain > 0.45:
                    rep.warn("script.json", f"music.gain={gain} 偏大，配乐容易盖过人声")
                if duck < 0.4:
                    rep.warn("script.json", f"music.duck={duck} 偏小，人声段配乐让得不够")

    arc = data.get("arc")
    if arc and arc not in ARCS:
        rep.err("script.json", f"arc '{arc}' 不认识（见 references/arcs.md）")
    elif not arc:
        rep.warn("script.json", "没写 arc（叙事弧）——写稿前先选一条，beat 的顺序和形状由它决定")

    if not isinstance(data.get("fps", 30), (int, float)) or data.get("fps", 30) <= 0:
        rep.err("script.json", "fps 要是正数")
    # 默认值和 vox_tts.py 保持一致：不写 rate 就是 +12%
    rate = str(data.get("rate", "+12%"))
    if not re.fullmatch(r"[+-]\d+%", rate):
        rep.err("script.json", f"rate 格式不对：{rate}（应该像 +12% / -5%）")
    return data


def check_env(project: Path, rep: Report) -> None:
    for f in FONTS:
        if not (project / f).exists():
            rep.err(f, "字体文件不在（缺了中文会静默回落系统雅黑）")
    if not (project / "node_modules").exists():
        rep.warn("node_modules", "不存在，先跑一次 npm install")


def main() -> int:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，✗ → 这类符号会直接
    # UnicodeEncodeError 把体检打断——报错还没看到，脚本先崩了
    # stderr 也要一起改：sys.exit("中文") 走的是 stderr
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="开渲前的 script.json 体检")
    ap.add_argument("--project", default=".", help="项目根目录，默认当前目录")
    ap.add_argument("--strict", action="store_true", help="提醒也算失败")
    a = ap.parse_args()

    project = Path(a.project).resolve()
    rep = Report()
    kinds = kinds_from_code(project)
    transitions = transitions_from_code(project)
    if kinds:
        print(f"[preflight] 视觉类型从 src/timeline.ts 读到 {len(kinds)} 种")
    if transitions:
        print(f"[preflight] 转场从 src/transitions.ts 读到 {len(transitions)} 种")
    data = check_script(project, rep, kinds, transitions)
    check_env(project, rep)

    print(f"[preflight] 项目 {project}")
    if data:
        n = len(data.get("beats") or [])
        print(f"  script.json：{n} 拍，rate={data.get('rate', '+12%')}，fps={data.get('fps', 30)}")
    for w in rep.errors:
        print(f"  ✗ {w}")
    for w in rep.warns:
        print(f"  ! {w}")

    if rep.errors:
        print(f"判定：不通过 — {len(rep.errors)} 个错、{len(rep.warns)} 个提醒。"
              f"先改错，别渲。")
        return 1
    if rep.warns and a.strict:
        print(f"判定：不通过（--strict）— {len(rep.warns)} 个提醒")
        return 1
    print(f"判定：通过{'（有提醒，不拦）' if rep.warns else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

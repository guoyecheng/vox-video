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
6. 取值域：imageLayout / motion / layout / tile / impact / ambient / transition 这些枚举别写错
7. 批注：annotations 的 kind / 百分比坐标 / 字数 / 是否落进字幕带
8. 纸片：tile 只对 kinetic / quote 生效；红纸整片最多一次
9. 环境：字体文件在不在（缺了中文会静默回落雅黑）

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
SHOT_TRANSITIONS = {"cut", "crossfade"}
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

# motion / layout 的兜底名单，优先从 src/timeline.ts 读（见 _enum_from_code）
MOTION_RECIPES = {"stamp", "wipe", "rise", "flip", "build", "drift"}
LAYOUT_MODES = {"center", "left-edge", "full-bleed", "split", "bottom-third"}
# 强调词的纸片版式（src/components/PaperTile.tsx 的 TileVariant）
TILE_VARIANTS = {"auto", "cut", "note", "clip", "label", "banner", "red"}

# 各 kind 已实现哪些 layout 变体（src/components/ 里的实现）。没列出的 kind
# 只有默认居中；写了没实现的变体会被静默忽略，所以提醒而不是报错。
LAYOUT_SUPPORT = {
    "kinetic": {"left-edge", "bottom-third", "full-bleed"},
    "stat": {"left-edge", "bottom-third", "split", "full-bleed"},
    "quote": {"left-edge", "bottom-third", "full-bleed"},
    "cards": {"left-edge", "bottom-third"},
}

FONTS = ["public/fonts/NotoSansSC-VF.ttf", "public/fonts/ArchivoBlack-Regular.ttf"]


def _enum_from_code(project: Path, name: str) -> set[str] | None:
    """从项目源码里读一个字符串联合类型（VisualKind / MotionRecipe / LayoutMode）。

    必须截到声明自己的那个分号：VisualKind 后面紧跟着 CameraMove / VfxKind / PieceIn，
    按固定长度截取会把 "pan"、"none" 这类枚举值当成合法 kind 放过。
    """
    p = project / "src" / "timeline.ts"
    if not p.exists():
        return None
    txt = p.read_text("utf-8")
    i = txt.find(f"export type {name}")
    if i < 0:
        return None
    block = txt[i:]
    end = block.find(";")
    if end < 0:
        return None
    names = set(re.findall(r'"([\w-]+)"', block[:end]))
    return names or None


def kinds_from_code(project: Path) -> set[str] | None:
    return _enum_from_code(project, "VisualKind")


def motions_from_code(project: Path) -> set[str] | None:
    return _enum_from_code(project, "MotionRecipe")


def layouts_from_code(project: Path) -> set[str] | None:
    return _enum_from_code(project, "LayoutMode")


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


CUTOUT_ENTERS = {"pop", "drop", "rise", "fly_left", "fly_right", "stamp"}


def check_cutouts(project: Path, rep: Report, where: str, visual: dict, narration: str) -> None:
    """抠图元素（visual.cutouts）的校验。

    和 pieces 一样，坐标是画幅比例、不是像素；区别是 x/y 是**中心点**，
    所以越界判断是 x±w/2，而不是 x+w。
    """
    cutouts = visual.get("cutouts")
    if not cutouts:
        return
    if not isinstance(cutouts, list):
        rep.err(f"{where}.cutouts", "不是数组")
        return
    if visual.get("pieces"):
        rep.warn(where, "cutouts 和 pieces 同时给了——两种元素层会叠在一起，确认不是想二选一")

    plain = narration.replace(" ", "").replace("\u3000", "")
    for i, c in enumerate(cutouts):
        w = f"{where}.cutouts[{i}]"
        if not isinstance(c, dict):
            rep.err(w, "不是一个对象")
            continue
        src = c.get("src")
        if not src:
            rep.err(w, "少了 src")
        else:
            check_asset(project, rep, w, src)
            rel = str(src).lstrip("/")
            if not is_remote(rel) and not (project / "public" / rel).exists():
                rep.warn(w, "抠图缺失时先跑 scripts/cutout.py（images.json 里要标 cutout: true）")
            elif not rel.endswith("-cut.png"):
                rep.warn(w, "看起来不是 cutout.py 的产物（习惯上以 -cut.png 结尾）")

        for k in ("x", "y"):
            v = c.get(k)
            if not isinstance(v, (int, float)) or not (0 <= v <= 1):
                rep.err(w, f"{k} 是中心点（画幅比例 0-1），现在是 {v!r}")
        width = c.get("w")
        if not isinstance(width, (int, float)) or not (0 < width <= 1):
            rep.err(w, f"w 应该是 (0, 1] 的宽度比例，现在是 {width!r}")
        else:
            if width < 0.06:
                rep.warn(w, f"w={width} 太小，元素会缩成一个小贴纸")
            x, y = c.get("x"), c.get("y")
            if isinstance(x, (int, float)) and (x - width / 2 < -0.05 or x + width / 2 > 1.05):
                rep.warn(w, "元素横向超出画幅——这是有意的出画/入画就没问题")
            if isinstance(y, (int, float)) and (y < 0.05 or y > 0.95):
                rep.warn(w, "元素中心贴近画幅边缘，坠落/入场后可能大半在画外")

        enter = c.get("enter")
        if enter is not None and enter not in CUTOUT_ENTERS:
            rep.err(w, f"enter 只能是 {', '.join(sorted(CUTOUT_ENTERS))}，现在 {enter}")

        for key in ("at", "fall"):
            word = c.get(key)
            if word is None:
                continue
            if not isinstance(word, str) or not word.strip():
                rep.err(w, f"{key} 应该是旁白里的词，现在是 {word!r}")
            elif word.replace(" ", "") not in plain:
                rep.warn(w, f"{key}=\"{word}\" 在旁白里找不到——会退回拍开头，动效会脱拍")

        depth = c.get("depth")
        if depth is not None and (not isinstance(depth, (int, float)) or not (0 <= depth <= 1)):
            rep.err(w, f"depth 应该在 [0, 1]，现在是 {depth}")
        rotate = c.get("rotate")
        if rotate is not None and (not isinstance(rotate, (int, float)) or abs(rotate) > 180):
            rep.err(w, f"rotate 应该在 [-180, 180] 度，现在是 {rotate}")
        shadow = c.get("shadow")
        if shadow is not None and (not isinstance(shadow, (int, float)) or shadow < 0):
            rep.err(w, f"shadow 是不小于 0 的像素值，现在是 {shadow}")
        blend = c.get("blend")
        if blend is not None and blend not in ("normal", "multiply"):
            rep.err(w, f"blend 只能是 normal / multiply，现在 {blend}")
        if "front" in c and not isinstance(c["front"], bool):
            rep.err(w, "front 应该是布尔值")
            continue

        at, fall = c.get("at"), c.get("fall")
        if at and fall and at == fall:
            rep.warn(w, "at 和 fall 是同一个词：元素会在入场的同一帧开始坠落")


STAGE3D_CAMERAS = {"push_in", "pull_out", "pan", "static"}
STAGE3D_ENTERS = {"drop", "rise", "pop"}


def check_stage3d(project: Path, rep: Report, where: str, visual: dict, narration: str) -> None:
    """3D 纸艺舞台（visual.stage3d）的校验。

    坐标是**世界单位**（16:9 画幅约 7.2 × 4.05），不是 0-1 比例；
    x/y 是纸片中心。最常见的翻车是直接抄 2D cutouts 的 0-1 坐标——
    纸片会全部缩在画面正中一小团，所以这里单独校验量级。
    """
    stage = visual.get("stage3d")
    if stage is None:
        return
    if not isinstance(stage, dict):
        rep.err(f"{where}.stage3d", "不是一个对象")
        return

    if visual.get("cutouts"):
        rep.warn(where, "stage3d 生效时 cutouts 不会渲染——两套元素层只能选一套")
    if visual.get("pieceBase") or visual.get("pieces"):
        rep.warn(where, "stage3d 生效时碎片拼贴（pieceBase/pieces）不会渲染")
    if visual.get("image") or visual.get("layers"):
        rep.warn(where, "stage3d 生效时 2D 配图 / 分层背景板不会渲染")
    if visual.get("kind") == "quote":
        rep.warn(where, "quote 拍用深色纸台；stage3d 目前只有浅色纸底")

    cam = stage.get("camera")
    if cam is None:
        cam2d = visual.get("camera")
        if cam2d in {"tilt", "parallax", "whip"}:
            rep.warn(f"{where}.stage3d.camera",
                     f"3D 不支持 camera='{cam2d}'，会回落到 push_in")
    elif cam not in STAGE3D_CAMERAS:
        rep.err(f"{where}.stage3d.camera",
                f"只能是 {', '.join(sorted(STAGE3D_CAMERAS))}，现在 {cam!r}")

    map_src = stage.get("mapSrc")
    if map_src:
        check_asset(project, rep, f"{where}.stage3d.mapSrc", map_src)

    pieces = stage.get("pieces")
    if not isinstance(pieces, list) or not pieces:
        rep.err(f"{where}.stage3d.pieces", "至少要有一张纸片")
        return

    plain = narration.replace(" ", "").replace("\u3000", "")
    for i, p in enumerate(pieces):
        w = f"{where}.stage3d.pieces[{i}]"
        if not isinstance(p, dict):
            rep.err(w, "不是一个对象")
            continue
        src = p.get("src")
        if not src:
            rep.err(w, "少了 src")
        else:
            check_asset(project, rep, w, src)

        for k in ("x", "y"):
            v = p.get(k)
            if not isinstance(v, (int, float)):
                rep.err(w, f"{k} 是世界坐标中心（约 -3.6…3.6 / -2…2），现在是 {v!r}")
            elif abs(v) > 6:
                rep.warn(w, f"{k}={v} 明显超出画幅（世界单位约 ±3.6），确认用错了 0-1 比例")
        width = p.get("w")
        if not isinstance(width, (int, float)) or width <= 0:
            rep.err(w, f"w 是世界单位宽度（画幅约 7.2），现在是 {width!r}")
        elif width < 1:
            rep.warn(w, f"w={width} 更像画幅比例；3D 用世界单位，满幅约 7.2")
        else:
            x = p.get("x")
            if isinstance(x, (int, float)) and abs(x) - width / 2 > 4.6:
                rep.warn(w, "纸片完全在画外（世界单位 ±4.6 之外），确认不是坐标写错")

        z = p.get("z", 0)
        if not isinstance(z, (int, float)):
            rep.err(w, f"z 应该是数字，现在是 {z!r}")
        elif z < -2.9:
            rep.warn(w, f"z={z} 在背景纸（约 -3）后面，会被完全挡住")

        enter = p.get("enter")
        if enter is not None and enter not in STAGE3D_ENTERS:
            rep.err(w, f"enter 只能是 {', '.join(sorted(STAGE3D_ENTERS))}，现在 {enter}")

        for key in ("at", "spinAt", "fall"):
            word = p.get(key)
            if word is None:
                continue
            if not isinstance(word, str) or not word.strip():
                rep.err(w, f"{key} 应该是旁白里的词，现在是 {word!r}")
            elif word.replace(" ", "") not in plain:
                rep.warn(w, f"{key}=\"{word}\" 在旁白里找不到——会按拍长均匀铺开，动效脱拍")

        for key in ("wash", "gray", "hole", "alphaCut"):
            v = p.get(key)
            if v is not None and (not isinstance(v, (int, float)) or not (0 <= v <= 1)):
                rep.err(w, f"{key} 应该在 [0, 1]，现在是 {v!r}")
        for key in ("shadow", "drift"):
            v = p.get(key)
            if v is not None and (not isinstance(v, (int, float)) or v < 0):
                rep.err(w, f"{key} 是不小于 0 的数，现在是 {v!r}")
        blend = p.get("blend")
        if blend is not None and blend not in ("normal", "multiply"):
            rep.err(w, f"blend 只能是 normal / multiply，现在 {blend}")
        rot = p.get("rot")
        if rot is not None and (not isinstance(rot, (int, float)) or abs(rot) > 180):
            rep.err(w, f"rot 应该在 [-180, 180] 度，现在是 {rot}")

        marks = p.get("marks")
        if marks is not None:
            if not isinstance(marks, list):
                rep.err(f"{w}.marks", "不是数组")
                continue
            for j, m in enumerate(marks):
                mw = f"{w}.marks[{j}]"
                if not isinstance(m, dict):
                    rep.err(mw, "不是一个对象")
                    continue
                if not isinstance(m.get("w"), (int, float)) or m["w"] <= 0:
                    rep.err(mw, f"w 应该是正数，现在是 {m.get('w')!r}")
                word = m.get("at")
                if word and (not isinstance(word, str) or word.replace(" ", "") not in plain):
                    rep.warn(mw, f"at=\"{word}\" 在旁白里找不到——会按拍长均匀铺开，脱拍")

    tapes = stage.get("tapes")
    if tapes is not None:
        if not isinstance(tapes, list):
            rep.err(f"{where}.stage3d.tapes", "不是数组")
        else:
            for i, t in enumerate(tapes):
                tw = f"{where}.stage3d.tapes[{i}]"
                if not isinstance(t, dict):
                    rep.err(tw, "不是一个对象")
                    continue
                for k in ("x", "y", "z", "w", "h", "rot"):
                    if not isinstance(t.get(k), (int, float)):
                        rep.err(tw, f"{k} 应该是数字，现在是 {t.get(k)!r}")


NOTE_KINDS = {"arrow", "circle", "measure", "tag", "stamp", "shape"}
NOTE_SHAPES = {"square", "circle", "triangle", "reuleaux", "hex"}


def check_notes(rep: Report, where: str, visual: dict) -> None:
    """红笔批注（visual.annotations）。

    字段名是 annotations，不是 notes：`callout` 拍的 notes 是图片上的
    圈注列表（坐标 0-1），和这个横跨全画的批注层是两回事。
    """
    notes = visual.get("annotations")
    if not notes:
        return
    if not isinstance(notes, list):
        rep.err(f"{where}.annotations", "不是数组")
        return
    for i, n in enumerate(notes):
        w = f"{where}.annotations[{i}]"
        if not isinstance(n, dict):
            rep.err(w, "不是一个对象")
            continue
        kind = n.get("kind")
        if kind not in NOTE_KINDS:
            rep.err(w, f"kind 只能是 {', '.join(sorted(NOTE_KINDS))}，现在 {kind!r}")
            continue
        for k in ("x", "y"):
            v = n.get(k)
            if not isinstance(v, (int, float)) or not (0 <= v <= 100):
                rep.err(w, f"{k} 是画幅百分比（0-100），现在是 {v!r}")
        for k in ("w", "h"):
            v = n.get(k)
            if v is not None and (not isinstance(v, (int, float)) or v == 0):
                rep.err(w, f"{k} 是不为 0 的像素值，现在是 {v!r}")
        at = n.get("at")
        if at is not None and (not isinstance(at, (int, float)) or at < 0):
            rep.err(w, f"at 是拍内秒数，现在是 {at!r}")
        rot = n.get("rot")
        if rot is not None and (not isinstance(rot, (int, float)) or abs(rot) > 60):
            rep.err(w, f"rot 建议在 ±60 度内，现在是 {rot}")
        if kind == "shape":
            shp = n.get("shape")
            if shp is not None and shp not in NOTE_SHAPES:
                rep.err(w, f"shape 只能是 {', '.join(sorted(NOTE_SHAPES))}，现在 {shp!r}")
        if kind in ("tag", "stamp"):
            text = n.get("text")
            if not isinstance(text, str) or not text.strip():
                rep.err(w, f"{kind} 必须有 text")
            else:
                limit = 6 if kind == "tag" else 4
                if len(text) > limit:
                    rep.warn(w, f"{kind} 建议 ≤{limit} 字，现在 {len(text)}——纸片会被撑得很宽")
        if kind in ("arrow", "measure") and n.get("w") is None:
            rep.warn(w, f"{kind} 没写 w：默认长度 170px，多数位置会太短")
        y = n.get("y")
        if isinstance(y, (int, float)) and y > 78 and kind in ("tag", "stamp", "shape"):
            rep.warn(w, "批注落在字幕带（y>78%）里，会被字幕盖住")


def check_shots(where: str, visual: dict, motions: set[str], layouts: set[str],
                rep: Report) -> None:
    """beat 内镜头拆分（visual.shots）的结构校验。

    v1 只对 kinetic 生效——items 类组件的词级时间戳不在词流里，按项锚点是
    另一套机制。from/to 的单位是**秒**（相对拍开头），写帧是最常见的错。
    """
    shots = visual.get("shots")
    if shots is None:
        return
    if not isinstance(shots, list) or not shots:
        rep.err(f"{where}.shots", "是空数组或不是数组——不拆分就删掉这个字段")
        return
    kind = visual.get("kind")
    if kind != "kinetic":
        rep.err(where, f"shots 目前只对 kinetic 生效（现在 kind='{kind}'）——"
                       "非 kinetic 的镜头拆分 v1 不做")
        return
    if len(shots) == 1:
        rep.warn(f"{where}.shots", "只有 1 条 shots，拆了等于没拆")

    prev_to: float | None = None
    prev_from: float | None = None
    for i, s in enumerate(shots):
        w = f"{where}.shots[{i}]"
        if not isinstance(s, dict):
            rep.err(w, "不是一个对象")
            continue
        frm, to = s.get("from"), s.get("to")
        for key, v in (("from", frm), ("to", to)):
            if v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0):
                rep.err(f"{w}.{key}", f"应该是 ≥0 的秒数（相对拍开头），现在是 {v!r}")
        if isinstance(frm, (int, float)) and isinstance(to, (int, float)) and to <= frm:
            rep.err(w, f"to({to}) 必须大于 from({frm})——否则这一镜没有时长")
        if i > 0 and frm is None:
            rep.err(w, "第 2 镜起必须写 from（秒）——起点靠上一镜 to 推导，少一个字段就错位")
        if isinstance(frm, (int, float)):
            if prev_from is not None and frm < prev_from:
                rep.err(w, f"from({frm}) 比上一镜 from({prev_from}) 还早——shots 要按时间顺序写")
            prev_from = frm
            if prev_to is not None and frm < prev_to:
                rep.err(w, f"from({frm}) 落在上一镜结束({prev_to})之前——镜头不能重叠")
        if isinstance(to, (int, float)):
            prev_to = to
        motion = s.get("motion")
        if motion is not None and motion not in motions:
            rep.err(f"{w}.motion", f"只能是 {', '.join(sorted(motions))}，现在 {motion}")
        layout = s.get("layout")
        if layout is not None and layout not in layouts:
            rep.err(f"{w}.layout", f"只能是 {', '.join(sorted(layouts))}，现在 {layout}")
        trans = s.get("transition")
        if trans is not None and trans not in SHOT_TRANSITIONS:
            rep.err(f"{w}.transition",
                    f"只能是 {', '.join(sorted(SHOT_TRANSITIONS))}，现在 {trans}")
        words = s.get("words")
        if words is not None and (not isinstance(words, list)
                                  or not all(isinstance(x, str) for x in words)):
            rep.err(f"{w}.words", "必须是字符串数组")


def check_shot_fit(project: Path, rep: Report, beats: list) -> None:
    """有 timeline.json 时，核对显式镜的 from/to 没有越过这一拍的实测拍长。

    from/to 是秒，拍长是 TTS 之后才量出来的帧数——只读脚本时无法判断，
    所以没有 timeline.json 就跳过。越界的镜头运行时会被 clamp 成末尾一帧，
    整镜内容静默消失，必须在体检阶段报出来。
    """
    tp = project / "src" / "timeline.json"
    if not tp.exists():
        return
    try:
        tl = json.loads(tp.read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return
    if not isinstance(tl, dict):
        return
    fps = tl.get("fps")
    if not isinstance(fps, (int, float)) or isinstance(fps, bool) or fps <= 0:
        fps = 30
    durations = {}
    for b in tl.get("beats") or []:
        if isinstance(b, dict) and b.get("id") is not None:
            d = b.get("durationInFrames")
            if isinstance(d, (int, float)) and not isinstance(d, bool):
                durations[str(b["id"])] = d

    for i, b in enumerate(beats):
        if not isinstance(b, dict):
            continue
        v = b.get("visual") or {}
        shots = v.get("shots")
        dur = durations.get(str(b.get("id")))
        if not isinstance(shots, list) or not shots or dur is None:
            continue
        limit = dur / fps
        for j, s in enumerate(shots):
            if not isinstance(s, dict):
                continue
            where = f"beats[{i}].visual.shots[{j}]"
            for key in ("from", "to"):
                val = s.get(key)
                if isinstance(val, (int, float)) and not isinstance(val, bool) \
                        and val > limit + 1e-6:
                    rep.err(f"{where}.{key}",
                            f"{key}({val}s) 超出这一拍实测时长 {dur} 帧（{limit:.2f}s）——"
                            "运行时会被 clamp，这一镜会被压没")


def check_visual(project: Path, rep: Report, where: str, visual: dict, narration: str = "",
                 kinds: set[str] | None = None,
                 motions: set[str] | None = None,
                 layouts: set[str] | None = None) -> None:
    kinds = kinds or KINDS
    motions = motions or MOTION_RECIPES
    layouts = layouts or LAYOUT_MODES
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
        # 写了 shots 之后上屏词由每个镜头的 words 接管，拍级 words 本来就不该有
        if not words and not visual.get("shots"):
            rep.warn(where, "kinetic 没有 words，上屏的就是整句旁白（想要逐词跳动就得写 words）")
        elif words:
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
    # 入场配方不写会自动轮换（相邻拍保证不同），所以缺 motion 不算错；
    # 写错了才是错。elementMotion 已是自由备注，不再参与检查。
    motion = visual.get("motion")
    if motion is not None and motion not in motions:
        rep.err(f"{where}.motion", f"只能是 {', '.join(sorted(motions))}，现在 {motion}")
    layout_mode = visual.get("layout")
    if layout_mode is not None and layout_mode not in layouts:
        rep.err(f"{where}.layout", f"只能是 {', '.join(sorted(layouts))}，现在 {layout_mode}")
    if layout_mode == "full-bleed" and not (visual.get("image") or visual.get("layers")):
        rep.warn(where, "layout 写了 full-bleed 但没有 image/layers——贴边排版底下没有图可贴")
    if layout_mode and layout_mode != "center" and layout_mode not in LAYOUT_SUPPORT.get(kind, set()):
        rep.warn(where, f"kind '{kind}' 还没实现 layout '{layout_mode}'，写了不会生效")

    if visual.get("impact") and visual["impact"] not in IMPACTS:
        rep.err(f"{where}.impact", f"只能是 {', '.join(sorted(IMPACTS))}")
    if visual.get("ambient") and visual["ambient"] not in AMBIENTS:
        rep.err(f"{where}.ambient", f"只能是 {', '.join(sorted(AMBIENTS))}")

    tile = visual.get("tile")
    if tile is not None and tile not in TILE_VARIANTS:
        rep.err(f"{where}.tile", f"只能是 {', '.join(sorted(TILE_VARIANTS))}，现在 {tile!r}")
    elif tile and not visual.get("emphasis"):
        rep.warn(f"{where}.tile", "没有 emphasis——纸片只贴在强调词上，tile 不会生效")
    elif tile and kind not in {"kinetic", "quote"}:
        rep.warn(f"{where}.tile", f"kind '{kind}' 没有强调词纸片，tile 不会生效")

    emphasis = visual.get("emphasis")
    if isinstance(emphasis, list):
        for w in emphasis:
            if isinstance(w, str) and len(w.replace(" ", "")) > 10:
                rep.warn(f"{where}.emphasis", f"「{w}」超过 10 字，纸片会折成两行、"
                                              "可能压到字幕——拆成两个短强调更稳")

    check_layers(project, rep, where, visual)
    check_pieces(project, rep, where, visual)
    check_cutouts(project, rep, where, visual, narration)
    check_stage3d(project, rep, where, visual, narration)
    check_notes(rep, where, visual)
    check_shots(where, visual, motions, layouts, rep)

    # 经验提醒：不是错，但会明显掉观感
    if kind == "stat" and (visual.get("image") or visual.get("layers")):
        rep.warn(where, "大数字特写加背景会压住数字，这种拍留白最好")
    if kind == "person" and visual.get("layers"):
        rep.warn(where, "person 拍 + 背景层：确认左侧的圆形剪影没有被横带截断"
                        "（把带压到 y ≤ 0.72 最稳，或者干脆用整幅图）")


# ---------------------------------------------------------------- 主体


def check_script(project: Path, rep: Report, kinds: set[str] | None = None,
                 transitions: set[str] | None = None,
                 motions: set[str] | None = None,
                 layouts: set[str] | None = None) -> dict:
    kinds = kinds or KINDS
    transitions = transitions or TRANSITIONS
    motions = motions or MOTION_RECIPES
    layouts = layouts or LAYOUT_MODES
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
    red_tiles: list[str] = []
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
            visual = b.get("visual")
            if isinstance(visual, dict) and visual.get("tile") == "red":
                red_tiles.append(where)
        narration = b.get("narration")
        if not isinstance(narration, str) or not narration.strip():
            if not b.get("hold"):
                rep.err(where, "旁白是空的（想放空镜就写 hold）")
        if b.get("transition") and b["transition"] not in transitions:
            rep.err(where, f"transition '{b['transition']}' 不认识"
                           f"（合法的：{', '.join(sorted(transitions))}）")
        check_visual(project, rep, where, b.get("visual") or {}, narration or "",
                     kinds, motions, layouts)

    check_shot_fit(project, rep, beats)

    if len(red_tiles) > 1:
        rep.warn("script.json", f"红纸用了 {len(red_tiles)} 次（{', '.join(red_tiles)}）——"
                                "整片最多一次，用多了红色就不再是重点")

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


def check_env(project: Path, rep: Report, data: dict | None = None) -> None:
    for f in FONTS:
        if not (project / f).exists():
            rep.err(f, "字体文件不在（缺了中文会静默回落系统雅黑）")
    if not (project / "node_modules").exists():
        rep.warn("node_modules", "不存在，先跑一次 npm install")
        return
    # 老项目是 scaffold 出来的，package.json 不会随 sync 更新——3D 依赖得自己补
    beats = (data or {}).get("beats") or []
    uses_3d = any(isinstance(b, dict) and (b.get("visual") or {}).get("stage3d")
                  for b in beats)
    if uses_3d:
        missing = [p for p in ("@remotion/three", "@react-three/fiber", "three")
                   if not (project / "node_modules" / p).exists()]
        if missing:
            rep.err("node_modules", f"用了 stage3d 但缺依赖：{', '.join(missing)}"
                                    "——跑 npm install three @react-three/fiber "
                                    f"@remotion/three@{'4.0.535'}")


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
    motions = motions_from_code(project)
    layouts = layouts_from_code(project)
    if kinds:
        print(f"[preflight] 视觉类型从 src/timeline.ts 读到 {len(kinds)} 种")
    if transitions:
        print(f"[preflight] 转场从 src/transitions.ts 读到 {len(transitions)} 种")
    if motions:
        print(f"[preflight] 入场配方从 src/timeline.ts 读到 {len(motions)} 种")
    if layouts:
        print(f"[preflight] 版式变体从 src/timeline.ts 读到 {len(layouts)} 种")
    data = check_script(project, rep, kinds, transitions, motions, layouts)
    check_env(project, rep, data)

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

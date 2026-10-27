#!/usr/bin/env python3
"""
视觉节奏自检。

「内容表现单调」几乎不是视觉组件不够，而是没人管重复度：十种组件摆在
那里，写稿时凭感觉挑，最后 kinetic 用六次、cards 用三次，整片一个节奏。
这个脚本把"单调"变成可测的数字。

检查项
------
1. 视觉重复度      —— 同一种 kind 连续出现 / 某种 kind 占比过高
2. 转场重复度      —— 相邻两拍用同一种转场（等于没转）
3. 入场配方重复度  —— 相邻两拍同一种入场配方（自动轮换不会重复，报出来就是手写写重）
4. 全画面冲击上限  —— impact/flash 作用于整画面，按"大 slam"计，全片 ≤3
5. 字号下限        —— 扫组件源码，1080p 下正文 ≥32px、字幕 ≥60px
6. 对比度          —— 从 theme.ts 读五支颜色，审文字/背景组合（WCAG AA）
7. 能量骨架        —— 首拍必须是 hook，末拍必须收束

字号、对比度、安全区和停留时间的出处与换算见 `references/readability.md`。

用法
----
    python check_rhythm.py --project "<项目路径>"
    python check_rhythm.py --project "<项目>" --src "<模板 src 目录>"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# 同一种视觉连续出现几次以上就算"节奏没变"
MAX_CONSECUTIVE = 2
# 某种视觉在全片出现几次以上就该警觉
MAX_TOTAL = 4
# 全画面级冲击（整层 scale 泵 / 震屏 / 闪帧）的全片预算
MAX_WHOLE_FRAME_HITS = 3
# 1080p 下的字号下限
MIN_AUX_PX = 32
MIN_MAIN_PX = 56
# 字幕是观众读得最久的一层，按参考片实测取 60（不是 56）
MIN_CAPTION_PX = 60

# WCAG 2.2 AA：正文 4.5:1，大字（≥24px 或 ≥18.5px 粗体）3:1
CONTRAST_BODY = 4.5
CONTRAST_LARGE = 3.0

# 只审"组件里真的当文字用"的组合。键名对应 src/theme.ts 的 COLORS。
# (前景, 背景, 下限, 用在哪)
CONTRAST_PAIRS = (
    ("ink", "paper", CONTRAST_BODY, "标题 / 正文落在纸面"),
    ("ink", "paperAlt", CONTRAST_BODY, "卡片标题落在浅纸"),
    ("ink", "stage", CONTRAST_BODY, "文字直接落在底纸"),
    ("inkSoft", "paper", CONTRAST_BODY, "次要正文落在纸面"),
    ("inkSoft", "paperAlt", CONTRAST_BODY, "次要正文落在浅纸"),
    ("inkSoft", "stage", CONTRAST_BODY, "次要正文落在底纸"),
    ("nightInk", "night", CONTRAST_BODY, "quote 深底上的字"),
    ("accent", "paper", CONTRAST_LARGE, "红色关键词（只给大字/粗体）"),
    ("accent", "paperAlt", CONTRAST_LARGE, "红色关键词落在浅纸（只给大字）"),
    ("accentSoft", "paper", CONTRAST_LARGE, "浅红强调（只给大字）"),
    ("gold", "night", CONTRAST_LARGE, "深底上的芥末黄"),
)
# 量出来备查、但不判失败：这些色在纸面上本来就不是"文字色"。
CONTRAST_CAVEATS = (
    ("gold", "paper", "芥末黄只做纸片底/装饰，当文字读不清"),
    ("inkFaint", "paper", "网点灰当次要标签也偏浅，正文改用 inkSoft"),
)

WARN = "!"
FAIL = "x"
OK = " "


def longest_run(items: list[str]) -> tuple[str, int]:
    best_item, best_n = "", 0
    cur_item, cur_n = "", 0
    for x in items:
        if x == cur_item:
            cur_n += 1
        else:
            cur_item, cur_n = x, 1
        if cur_n > best_n:
            best_item, best_n = cur_item, cur_n
    return best_item, best_n


def check_visual_variety(beats: list[dict]) -> list[str]:
    out, problems = [], []
    kinds = [(b.get("visual") or {}).get("kind", "?") for b in beats]
    cnt = Counter(kinds)
    item, run = longest_run(kinds)

    out.append(f"视觉类型分布：{len(cnt)} 种 / {len(beats)} 拍")
    for k, n in cnt.most_common():
        bar = "#" * n
        out.append(f"   {k:<10} {n:>2}  {bar}")

    if run > MAX_CONSECUTIVE:
        problems.append(f"「{item}」连续出现 {run} 次——节奏没变，换掉中间那个")
        out.append(f"   {FAIL} 连续重复超限（上限 {MAX_CONSECUTIVE}）")
    else:
        out.append(f"   {OK} 无连续重复（最长 {run}）")

    over = [(k, n) for k, n in cnt.items() if n > MAX_TOTAL]
    if over:
        problems.append("占比过高：" + "、".join(f"{k}×{n}" for k, n in over))
        out.append(f"   {FAIL} 占比超限（单种上限 {MAX_TOTAL} 次）")

    if len(cnt) * 2 < len(beats):
        problems.append(f"只有 {len(cnt)} 种视觉撑 {len(beats)} 拍，重复感必然出现")
        out.append(f"   {FAIL} 视觉种类不足（建议 ≥ 拍数的一半）")

    return out, problems


def check_transitions(beats: list[dict]) -> tuple[list[str], list[str]]:
    out, problems = [], []
    names = [b.get("transition", "fade") for b in beats[1:]]  # 第 0 拍没有转场
    if not names:
        return ["转场：全部硬切"], []
    cnt = Counter(names)
    out.append(f"\n转场分布：{len(cnt)} 种 / {len(names)} 个接缝")
    for k, n in cnt.most_common():
        out.append(f"   {k:<12} {n:>2}  {'#' * n}")

    dup = [i for i in range(1, len(names))
           if names[i] == names[i - 1] and names[i] != "none"]
    # 连续硬切是 SKILL.md 推荐的做法（同类型连续内容用 none 比淡入淡出利落），
    # 不算"等于没转"
    if dup:
        problems.append("相邻两拍用了同一种转场，等于没转")
        out.append(f"   {FAIL} 接缝 {dup} 处转场重复")
    else:
        out.append(f"   {OK} 无相邻重复")

    if len(cnt) == 1 and len(names) >= 3 and names[0] != "none":
        problems.append(f"全片只用了一种转场（{names[0]}）")
        out.append(f"   {FAIL} 转场单一")

    return out, problems


# 与 assets/template/src/components/BeatPresence.tsx 的 autoMotion 保持一致：
# 不写 motion 的拍按拍序轮换，build 落在不可 build 的 kind 上时用 drift 顶替。
ORDER = ["stamp", "build", "wipe", "rise", "drift"]
BUILDABLE_KINDS = {"kinetic", "stat", "odometer", "cards", "stack",
                   "compare", "split", "timeline", "chart", "callout", "route"}


def _auto_recipe(cursor: int, kind: str | None) -> str:
    recipe = ORDER[cursor % len(ORDER)]
    return "drift" if recipe == "build" and kind not in BUILDABLE_KINDS else recipe


def effective_motion(beats: list[dict]) -> list[str]:
    """每拍实际生效的入场配方：显式 motion 优先，否则按**全局镜头序号**轮换。

    带显式 shots 的拍取首镜头配方（拍级检查只看得到一个值，镜头级由
    check_shot_rhythm 负责）；游标按镜头数累加，和运行时的全局序号一致。
    """
    out = []
    cursor = 0
    for b in beats:
        v = b.get("visual") or {}
        kind = v.get("kind")
        shots = v.get("shots")
        if isinstance(shots, list) and shots and kind == "kinetic":
            first = shots[0] if isinstance(shots[0], dict) else {}
            out.append(first.get("motion") or _auto_recipe(cursor, kind))
            cursor += len(shots)
            continue
        out.append(v.get("motion") or _auto_recipe(cursor, kind))
        cursor += 1
    return out


def check_shot_rhythm(beats: list[dict]) -> tuple[list[str], list[str]]:
    """镜头级配方平铺：显式 shots 按条展开，没写 shots 的拍按 1 镜头计。

    两条不确定性要分清楚，否则会把自动拆分的车读到显式值头上：
    - 带词流的 kinetic 拍运行时会自动拆成几镜，脚本里算不出——它之后所有
      自动配方的**序号**都不确定（游标可能多走几格），它的**末镜**配方也不确定。
      这类接缝只提示，不判失败。
    - 显式镜头数确定，游标保持精确，所以显式值之间的相邻重复是真错。
    """
    out, problems = [], []
    # (标签, 配方, 是否手写, 值是否精确, 是否一定是上一镜)
    seq: list[tuple[str, str, bool, bool, bool]] = []
    cursor = 0
    cursor_exact = True
    auto = 0
    split_unknown = 0

    for i, b in enumerate(beats):
        v = b.get("visual") or {}
        kind = v.get("kind")
        shots = v.get("shots")
        bid = str(b.get("id", i))
        kinetic = kind == "kinetic"
        if isinstance(shots, list) and shots and kinetic:
            for j, s in enumerate(shots):
                m = (s or {}).get("motion") if isinstance(s, dict) else None
                seq.append((f"{bid}.s{j}", m or _auto_recipe(cursor, kind),
                            bool(m), bool(m) or cursor_exact, True))
                cursor += 1
            continue

        m = v.get("motion")
        may_split = kinetic and bool(b.get("words"))
        seq.append((bid, m or _auto_recipe(cursor, kind), bool(m),
                    bool(m) or cursor_exact, not may_split))
        cursor += 1
        auto += 1
        if may_split:
            cursor_exact = False
            split_unknown += 1

    dups, maybe = [], []
    for i in range(1, len(seq)):
        a, b = seq[i - 1], seq[i]
        if a[1] != b[1]:
            continue
        if a[3] and b[3] and a[4]:
            dups.append((a[0], b[0], b[1]))
        else:
            maybe.append((a[0], b[0], b[1]))

    out.append(f"\n镜头级配方：{len(seq)} 镜 / {len(beats)} 拍")
    if auto:
        out.append(f"   没写 shots 的 {auto} 拍各按 1 镜头计"
                   "（自动拆分运行时可能更多，全局序号已保证不重复）")
    if split_unknown:
        out.append(f"   {WARN} {split_unknown} 拍带词流但没写 shots，运行时会自动拆镜——"
                   "它们之后的自动配方序号算不准，相关接缝只提示不判失败")
    if dups:
        pairs = "、".join(f"{a}→{b}({m})" for a, b, m in dups)
        problems.append(f"相邻镜头入场配方相同：{pairs}——显式 motion 写重了")
        out.append(f"   {FAIL} 相邻重复 {len(dups)} 处")
    else:
        out.append(f"   {OK} 相邻镜头无重复")
    if maybe:
        pairs = "、".join(f"{a}→{b}({m})" for a, b, m in maybe)
        out.append(f"   {WARN} 另有 {len(maybe)} 处序号不确定的同配方接缝：{pairs}")
    return out, problems


def check_motion_variety(beats: list[dict]) -> tuple[list[str], list[str]]:
    out, problems = [], []
    motions = effective_motion(beats)
    # 带 shots 的拍在拍级只看得见首镜；首镜≠末镜，真正的相邻由镜头级检查负责
    has_shots = []
    for b in beats:
        v = b.get("visual") or {}
        has_shots.append(v.get("kind") == "kinetic"
                         and isinstance(v.get("shots"), list) and bool(v.get("shots")))
    cnt = Counter(motions)
    out.append(f"\n入场配方分布：{len(cnt)} 种 / {len(beats)} 拍（没写的按拍序自动轮换）")
    for k, n in cnt.most_common():
        out.append(f"   {k:<10} {n:>2}  {'#' * n}")

    dup = [i for i in range(1, len(motions))
           if motions[i] == motions[i - 1] and not (has_shots[i] or has_shots[i - 1])]
    skipped = [i for i in range(1, len(motions)) if has_shots[i] or has_shots[i - 1]]
    if dup:
        problems.append("相邻两拍入场配方相同（接缝 " + "、".join(str(i) for i in dup)
                        + "）——自动轮换不会重复，这是显式 motion 写重了")
        out.append(f"   {FAIL} 相邻重复（不写会自动错开）")
    else:
        out.append(f"   {OK} 无相邻重复")
    if skipped:
        out.append(f"   {WARN} {len(skipped)} 处接缝含带 shots 的拍——"
                   "拍级比的是首镜，真正的相邻镜由镜头级检查负责")

    # layout 不自动轮换：连续多拍不写 layout 就是连续多张居中卡片，这正是 PPT 感
    run = cur = 0
    for b in beats:
        cur = 0 if (b.get("visual") or {}).get("layout") else cur + 1
        run = max(run, cur)
    if run >= 3:
        out.append(f"   {WARN} 最长连续 {run} 拍没写 layout（都落回居中卡片）——"
                   "挑几拍写 left-edge / bottom-third / split 破一破")
    return out, problems


def check_impact_budget(beats: list[dict]) -> tuple[list[str], list[str]]:
    """整画面级冲击按"大 slam"计预算。

    逐词的小反应（字弹一下、卡片落一下）不算——那是元素层，正是应该密集的。
    只有作用于整画面层的才算，因为那个会让观众疲劳。
    """
    out, problems = [], []
    hits = []
    for b in beats:
        v = b.get("visual") or {}
        imp = v.get("impact")
        if imp in ("medium", "heavy") or v.get("flash"):
            hits.append(b.get("id"))

    out.append(f"全画面冲击：{len(hits)} 处 / {len(beats)} 拍  {hits}")
    if len(hits) > MAX_WHOLE_FRAME_HITS:
        problems.append(f"全画面冲击 {len(hits)} 处，超出预算 {MAX_WHOLE_FRAME_HITS} 处")
        out.append(f"   {FAIL} 超出预算")
    else:
        out.append(f"   {OK} 在预算内（≤{MAX_WHOLE_FRAME_HITS}）")

    # 相邻两处冲击之间要有间隔，不然像连打
    if len(hits) >= 2:
        idx = [i for i, b in enumerate(beats) if b.get("id") in hits]
        gaps = [idx[i] - idx[i - 1] for i in range(1, len(idx))]
        if gaps and min(gaps) < 3:
            problems.append(f"两处冲击只隔 {min(gaps)} 拍，连打读作抽搐")
            out.append(f"   {FAIL} 冲击间隔过近（最小 {min(gaps)} 拍，建议 ≥3）")
        else:
            out.append(f"   {OK} 冲击间隔（最小 {min(gaps) if gaps else '—'} 拍）")

    return out, problems


def check_font_floor(src: Path) -> tuple[list[str], list[str]]:
    out, problems = [], []
    if not src.exists():
        return [f"字号：跳过（{src} 不存在）"], []
    bad = []
    for f in sorted(src.rglob("*.tsx")):
        if f.name == "timeline.ts":
            continue
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"fontSize:\s*(\d+)", text):
            n = int(m.group(1))
            if n < MIN_AUX_PX:
                bad.append(f"{f.name}:{text[:m.start()].count(chr(10)) + 1} fontSize={n}")
    out.append(f"\n字号下限（1080p / 辅助 ≥{MIN_AUX_PX}px）：{len(bad)} 处违规")
    for b in bad:
        out.append(f"   {FAIL} {b}")
        problems.append(f"字号过小：{b}")
    if not bad:
        out.append(f"   {OK} 全部达标")
    out.append(f"（主叙事文字 ≥{MIN_MAIN_PX}px、字幕 ≥{MIN_CAPTION_PX}px；"
               "依据与换算见 references/readability.md）")
    return out, problems


def _caption_source(src: Path) -> Path | None:
    direct = src / "components" / "CaptionTrack.tsx"
    if direct.exists():
        return direct
    hits = sorted(src.rglob("CaptionTrack.tsx"))
    return hits[0] if hits else None


def check_caption_size(src: Path) -> tuple[list[str], list[str]]:
    """字幕字号单独卡 60px：它是全片读得最久的一层，不能跟普通正文同一条线。"""
    out, problems = [], []
    f = _caption_source(src)
    if f is None:
        return [f"\n字幕字号：跳过（{src} 里没有 CaptionTrack.tsx）"], []
    text = f.read_text(encoding="utf-8")
    m = re.search(r"fontSize:\s*(\d+)", text)
    if not m:
        out.append("\n字幕字号：找不到 fontSize，跳过")
        return out, problems
    n = int(m.group(1))
    line = text[:m.start()].count(chr(10)) + 1
    if n < MIN_CAPTION_PX:
        msg = (f"字幕 fontSize={n}（{f.name}:{line}），1080p 下限 {MIN_CAPTION_PX}px——"
               "手机竖看缩到约 480 宽只剩 15px，再小就糊；改完跑 sync_template 同步")
        problems.append(msg)
        out.append(f"\n字幕字号：{FAIL} {msg}")
    else:
        out.append(f"\n字幕字号：{OK} {n}px（下限 {MIN_CAPTION_PX}px）")
    return out, problems


def relative_luminance(color: str) -> float:
    """WCAG 2.2 相对亮度。只认 #rrggbb。"""
    c = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast_ratio(fg: str, bg: str) -> float:
    a, b = relative_luminance(fg), relative_luminance(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def theme_colors(src: Path) -> dict[str, str]:
    """从 src/theme.ts 读 COLORS 里的 #rrggbb。找不到就返回空。"""
    for name in ("theme.ts", "theme.tsx", "theme.js", "theme.jsx"):
        f = src / name
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        m = re.search(r"COLORS\s*=\s*\{(.*?)\}", text, re.S)
        if not m:
            continue
        return {k: v for k, v in re.findall(
            r"(\w+)\s*:\s*[\"'](#[0-9A-Fa-f]{6})[\"']", m.group(1))}
    return {}


def contrast_audit(colors: dict[str, str]) -> tuple[list[str], list[str]]:
    """纯函数：给定色板，返回报告行和问题。方便自检直接喂假色板。"""
    out, problems = [], []
    checked = 0
    for fg, bg, floor, role in CONTRAST_PAIRS:
        if fg not in colors or bg not in colors:
            continue
        r = contrast_ratio(colors[fg], colors[bg])
        checked += 1
        mark = OK if r >= floor else FAIL
        out.append(f"   {mark} {fg}/{bg:<9} {r:>5.2f}:1  ≥{floor}  {role}")
        if r < floor:
            problems.append(f"对比度不足：{fg}/{bg} {r:.2f}:1 < {floor}:1（{role}）")
    for fg, bg, note in CONTRAST_CAVEATS:
        if fg not in colors or bg not in colors:
            continue
        r = contrast_ratio(colors[fg], colors[bg])
        out.append(f"   {WARN} {fg}/{bg:<9} {r:>5.2f}:1  {note}")
    out.insert(0, f"\n对比度（WCAG 2.2 AA，审了 {checked} 组文字/背景）：")
    return out, problems


def check_contrast(src: Path) -> tuple[list[str], list[str]]:
    colors = theme_colors(src)
    if not colors:
        return [f"\n对比度：跳过（{src} 里没有 theme.ts 的 COLORS）"], []
    return contrast_audit(colors)



def check_arc(beats: list[dict]) -> tuple[list[str], list[str]]:
    out, problems = [], []
    if not beats:
        return ["骨架：无 beats"], []

    first = (beats[0].get("visual") or {}).get("kind")
    last_kinds = [(b.get("visual") or {}).get("kind") for b in beats[-2:]]

    out.append(f"\n能量骨架：{len(beats)} 拍")
    out.append(f"   首拍 {first}（应为一个有反差事实或提问的 hook）")
    if first not in ("kinetic", "stat", "compare"):
        problems.append(f"首拍用了 {first}，hook 建议用 kinetic/stat/compare 直接甩反差")
        out.append(f"   {FAIL} 首拍不像 hook")
    else:
        out.append(f"   {OK} 首拍形态合理")

    if all(k in ("kinetic", "cards") for k in last_kinds):
        out.append(f"   {OK} 末两拍是收束形态")

    # 每拍都要有旁白，除非是显式的无声视觉拍
    silent = [b.get("id") for b in beats if not (b.get("narration") or "").strip()]
    if silent:
        out.append(f"   {WARN} 无旁白的拍：{silent}（确认是有意的视觉留白）")
    return out, problems


def main() -> None:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，✗ ✓ 这类符号会直接崩
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="视觉节奏自检")
    ap.add_argument("--project", default=".")
    ap.add_argument("--src", default=None, help="组件源码目录，用于字号检查")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    sp = project / "script.json"
    if not sp.exists():
        sys.exit(f"[rhythm] 找不到 {sp}")
    script = json.loads(sp.read_text(encoding="utf-8"))
    beats = script.get("beats") or []
    if not beats:
        sys.exit("[rhythm] script.json 里没有 beats")

    src = Path(args.src) if args.src else project / "src"

    sections, problems = [], []
    for fn in (check_visual_variety, check_transitions, check_motion_variety,
               check_shot_rhythm, check_impact_budget, check_font_floor,
               check_caption_size, check_contrast, check_arc):
        if fn in (check_font_floor, check_caption_size, check_contrast):
            out, probs = fn(src)
        else:
            out, probs = fn(beats)
        sections.extend(out)
        problems.extend(probs)

    print(f"[rhythm] {script.get('title', '')} —— {len(beats)} 拍\n")
    print("\n".join(sections))

    print()
    if problems:
        print(f"[rhythm] {FAIL} {len(problems)} 条待处理：")
        for p in problems:
            print(f"       - {p}")
        sys.exit(1)
    print(f"[rhythm] {OK} 全部通过")


if __name__ == "__main__":
    main()
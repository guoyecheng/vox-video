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
3. 全画面冲击上限  —— impact/flash 作用于整画面，按"大 slam"计，全片 ≤3
4. 字号下限        —— 扫组件源码，1080p 下正文 ≥32px、主叙事 ≥56px
5. 能量骨架        —— 首拍必须是 hook，末拍必须收束

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

    dup = [i for i in range(1, len(names)) if names[i] == names[i - 1]]
    if dup:
        problems.append("相邻两拍用了同一种转场，等于没转")
        out.append(f"   {FAIL} 接缝 {dup} 处转场重复")
    else:
        out.append(f"   {OK} 无相邻重复")

    if len(cnt) == 1 and len(names) >= 3:
        problems.append(f"全片只用了一种转场（{names[0]}）")
        out.append(f"   {FAIL} 转场单一")

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
    out.append(f"（主叙事文字 ≥{MIN_MAIN_PX}px，1080p 下低于此值在手机小窗里读不清）")
    return out, problems


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
    for fn in (check_visual_variety, check_transitions, check_impact_budget,
               check_font_floor, check_arc):
        out, probs = fn(beats) if fn not in (check_font_floor,) else fn(src)
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
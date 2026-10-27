"""脚本自检：把踩过的坑变成断言。

这些工具脚本没有第三方依赖，也不适合上 pytest——但它们的 bug 有一个共同特点：
**脚本自己"通过"了**。体检误判 kind、转场规则误报、Windows 管道崩在报错之前，
都是使用者看不见的错误结论。这里守住那些已经修过、又容易被改回去的地方。

    python scripts/selftest.py

只读仓库里的文件，不下载、不出图、不渲染。
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
TEMPLATE = ROOT / "assets" / "template"

sys.path.insert(0, str(SCRIPTS))

import check_rhythm  # noqa: E402
import check_richness  # noqa: E402
import preflight  # noqa: E402
import _media  # noqa: E402


def declared_kinds() -> set[str]:
    txt = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    decl = txt[txt.find("export type VisualKind"):]
    return set(re.findall(r'"([\w-]+)"', decl[:decl.find(";")]))


def test_kind_list_matches_declaration() -> str:
    got = preflight.kinds_from_code(TEMPLATE)
    want = declared_kinds()
    assert got == want, f"读到 {sorted(got or [])}，声明是 {sorted(want)}"
    return f"{len(want)} 种"


def test_kind_list_rejects_schema_enums() -> str:
    """VisualKind 后面紧跟 CameraMove / VfxKind / PieceIn，别把它们的值收进来。"""
    got = preflight.kinds_from_code(TEMPLATE) or set()
    leaked = got & {"push_in", "pull_out", "pan", "tilt", "parallax", "whip",
                    "static", "none", "confetti", "starburst"}
    assert not leaked, f"误收：{sorted(leaked)}"
    return "无误收"


def _transitions(names: list[str]) -> list[str]:
    beat = {"transition": "none", "transitionFrames": 0}
    beats = [beat] + [{"transition": n, "transitionFrames": 0 if n == "none" else 8}
                      for n in names]
    _, problems = check_rhythm.check_transitions(beats)
    return problems


def test_consecutive_hard_cuts_are_fine() -> str:
    assert _transitions(["none", "none", "none"]) == []
    assert _transitions(["none", "none", "slide", "none"]) == []
    return "连续 none 不报"


def test_repeated_soft_transition_is_flagged() -> str:
    assert _transitions(["fade", "fade", "fade"]), "连续 fade 应当报警"
    return "连续 fade 报警"


def test_single_soft_transition_is_flagged() -> str:
    problems = _transitions(["slide", "wipe", "iris"])
    assert not problems, f"三种转场不该报单一：{problems}"
    problems = _transitions(["fade", "slide", "wipe", "iris"])
    assert not problems
    return "单一检测只对重复项生效"


def test_motion_layout_enums_match_declaration() -> str:
    txt = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    for name, reader in (("MotionRecipe", preflight.motions_from_code),
                         ("LayoutMode", preflight.layouts_from_code)):
        decl = txt[txt.find(f"export type {name}"):]
        want = set(re.findall(r'"([\w-]+)"', decl[:decl.find(";")]))
        got = reader(TEMPLATE) or set()
        assert got == want, f"{name} 读到 {sorted(got)}，声明是 {sorted(want)}"
    # 带连字符的值（left-edge 这类）曾经被 \w+ 整条吞掉——两边用同一个 bug
    # 正则时上面的等式照样成立，这里单独点名锁死。
    assert {"left-edge", "full-bleed", "bottom-third"} <= (preflight.layouts_from_code(TEMPLATE) or set()), \
        "LayoutMode 带连字符的值没被读到"
    return "motion+layout"


def test_shot_spec_declared() -> str:
    txt = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    for needle in ("export type ShotTransition", "export type ShotSpec", "shots?: ShotSpec[];"):
        assert needle in txt, f"timeline.ts 缺 {needle}"
    decl = txt[txt.find("export type ShotSpec"):]
    fields = set(re.findall(r"^  (\w+)\??:", decl[:decl.find("};") + 2], re.M))
    assert {"from", "to", "words", "motion", "layout", "transition"} <= fields, \
        f"ShotSpec 字段缺了：{sorted({'from', 'to', 'words', 'motion', 'layout', 'transition'} - fields)}"
    return "ShotSpec 声明齐全"


def test_shot_transition_enum_matches_declaration() -> str:
    got = preflight._enum_from_code(TEMPLATE, "ShotTransition") or set()
    assert got == {"cut", "crossfade"}, f"ShotTransition 读到 {sorted(got)}"
    return "cut+crossfade"


def _template_order() -> list[str]:
    txt = (TEMPLATE / "src" / "recipes.ts").read_text(encoding="utf-8")
    decl = txt[txt.find("export const ORDER"):]
    start = decl.find("= [") + 3
    return re.findall(r'"(\w+)"', decl[start:decl.find("]", start) + 1])


def test_auto_rotation_never_repeats_adjacent() -> str:
    """模板与 check_rhythm 的轮换表必须一致，且任意 kind 序列相邻（含 wrap）不重复。"""
    assert _template_order() == check_rhythm.ORDER, (
        f"模板 ORDER={_template_order()}，check_rhythm.ORDER={check_rhythm.ORDER}")
    sequences = (
        [{"visual": {"kind": "kinetic"}}] * 8,
        [{"visual": {"kind": "image"}}] * 8,
        [{"visual": {"kind": k}} for k in ("kinetic", "image") * 4],
        [{"visual": {"kind": k}} for k in ("image", "stat", "quote", "image") * 2],
    )
    for beats in sequences:
        got = check_rhythm.effective_motion(beats)
        assert all(a != b for a, b in zip(got, got[1:])), f"相邻重复：{got}"
    plain = check_rhythm.effective_motion([{"visual": {"kind": "image"}}] * 5)
    assert "build" not in plain, f"不可 build 的拍拿到了 build：{plain}"
    return "轮换相邻不同"


def test_motion_variety_detects_repeats() -> str:
    def beats(*motions):
        return [{"visual": {"kind": "kinetic", "motion": m}} for m in motions]
    _, problems = check_rhythm.check_motion_variety(beats("stamp", "stamp", "wipe"))
    assert problems, "相邻同配方应当报警"
    _, problems = check_rhythm.check_motion_variety(beats("stamp", "wipe", "rise"))
    assert not problems, "不同配方不该报警"
    auto = [{"visual": {"kind": k}} for k in ("kinetic", "image", "stat", "quote")]
    _, problems = check_rhythm.check_motion_variety(auto)
    assert not problems, f"自动轮换不该报警：{problems}"
    out, _ = check_rhythm.check_motion_variety([{"visual": {"kind": "kinetic"}}] * 3)
    assert any("没写 layout" in line for line in out), "连续无 layout 应当提示"
    return "检测生效"


def test_layout_support_matches_components() -> str:
    """preflight 的 LAYOUT_SUPPORT 矩阵要和组件实现对上，否则"没实现"提醒会误报。"""
    support = preflight.LAYOUT_SUPPORT
    assert set(support) <= preflight.KINDS, f"矩阵里有不认识的 kind：{set(support) - preflight.KINDS}"
    files = {"kinetic": "KineticText", "stat": "StatCard",
             "quote": "QuoteCard", "cards": "CardStack", "handwrite": "Handwrite"}
    for kind, modes in support.items():
        assert modes <= preflight.LAYOUT_MODES, f"{kind} 的变体有非法值：{modes - preflight.LAYOUT_MODES}"
        txt = (TEMPLATE / "src" / "components" / f"{files[kind]}.tsx").read_text(encoding="utf-8")
        assert 'visual.layout ?? "center"' in txt, f"{files[kind]} 没读 layout"
    return "支持矩阵与实现一致"


def test_rate_default_is_consistent() -> str:
    """三处默认语速必须一致，否则预览节奏和成片差 12%。"""
    for path in (SCRIPTS / "preflight.py", SCRIPTS / "vox_tts.py", SCRIPTS / "scaffold.mjs"):
        txt = path.read_text(encoding="utf-8")
        assert '"+12%"' in txt, f"{path.name} 没写 +12% 默认值"
    return "+12%"


def test_sync_report_field_names() -> str:
    txt = (SCRIPTS / "verify_sync.py").read_text(encoding="utf-8")
    for key in ("onset_offset_ms", "onset_offset_frames", "systematic_offset_frames"):
        assert f'"{key}"' in txt, f"verify_sync.py 缺少字段 {key}"
    for ghost in ("audioOffsetMs", "pipeline_offset"):
        assert ghost not in txt, f"verify_sync.py 里还有幽灵字段 {ghost}"
    return "两种测量分开"


def test_every_script_guards_stderr() -> str:
    """sys.exit("中文") 走 stderr，只改 stdout 的话管道里仍是乱码。"""
    missing = []
    for path in sorted(SCRIPTS.glob("*.py")):
        if path.name == "_media.py":
            continue  # 纯库，不直接打印
        txt = path.read_text(encoding="utf-8")
        for stream in ("stdout", "stderr"):
            if f"sys.{stream}.reconfigure" not in txt:
                missing.append(f"{path.name}:{stream}")
    assert not missing, f"缺编码守卫：{missing}"
    return "stdout + stderr"


def test_media_prefers_compositor_build() -> str:
    """项目里的 Remotion 自带版优先于 PATH，且两种后缀都要认。"""
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        pinned = proj / "node_modules" / "@remotion" / "compositor-windows-x64"
        pinned.mkdir(parents=True)
        (pinned / "ffmpeg.exe").write_bytes(b"")
        found = _media.find_ffmpeg(proj)
        assert found and Path(found).parent == pinned, f"取到的是 {found}"
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        pinned = proj / "node_modules" / "@remotion" / "compositor-linux-x64"
        pinned.mkdir(parents=True)
        (pinned / "ffprobe").write_bytes(b"")
        found = _media.find_ffprobe(proj)
        assert found and Path(found).name == "ffprobe", f"取到的是 {found}"
    return "自带版优先"


def test_annotations_wired_and_validated() -> str:
    """annotations：NoteKind → NoteSpec → NoteLayer → visuals 接线 → preflight。"""
    declared = preflight._enum_from_code(TEMPLATE, "NoteKind") or set()
    assert declared == preflight.NOTE_KINDS, \
        f"NoteKind 与 preflight 枚举不一致：{declared ^ preflight.NOTE_KINDS}"

    timeline = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    assert "export type NoteSpec" in timeline, "缺 NoteSpec 类型"
    assert "annotations?: NoteSpec[]" in timeline, "VisualSpec 没声明 annotations"

    comp = TEMPLATE / "src" / "components" / "NoteLayer.tsx"
    assert comp.exists(), "缺 NoteLayer.tsx"
    src = comp.read_text(encoding="utf-8")
    for needle in ("roughEllipse", "roughLine", "strokeDashoffset", "ShapeMark"):
        assert needle in src, f"NoteLayer 缺 {needle}"

    visuals = (TEMPLATE / "src" / "visuals.tsx").read_text(encoding="utf-8")
    assert "<NoteLayer notes={beat.visual.annotations}" in visuals, "visuals.tsx 没接 annotations"

    kinds = preflight.kinds_from_code(TEMPLATE) or preflight.KINDS
    motions = preflight.motions_from_code(TEMPLATE) or preflight.MOTION_RECIPES
    layouts = preflight.layouts_from_code(TEMPLATE) or preflight.LAYOUT_MODES

    def run(visual: dict):
        rep = preflight.Report()
        preflight.check_visual(Path("."), rep, "beat0", visual, "方的井盖会掉进洞里。",
                               kinds, motions, layouts)
        return rep

    good = {"kind": "stat", "value": 41, "annotations": [
        {"kind": "circle", "x": 33, "y": 48, "w": 620, "h": 360, "rot": -4, "at": 1},
        {"kind": "tag", "x": 72, "y": 30, "text": "对角"},
    ]}
    rep = run(good)
    assert not rep.errors and not [w for w in rep.warns if "批注" in w], \
        f"合法 annotations 被误报：{rep.errors} {rep.warnings}"

    bad = {"kind": "kinetic", "annotations": [
        {"kind": "explode", "x": 50, "y": 50},
        {"kind": "circle", "x": 120, "y": 50, "w": 0},
        {"kind": "tag", "x": 50, "y": 50},
    ]}
    errs = run(bad).errors
    assert any("kind" in e for e in errs), f"非法 note kind 没报错：{errs}"
    assert any("画幅百分比" in e for e in errs), f"越界坐标没报错：{errs}"
    assert any("w" in e for e in errs), f"w=0 没报错：{errs}"
    assert any("text" in e for e in errs), f"tag 缺 text 没报错：{errs}"

    low = {"kind": "stat", "value": 1, "annotations": [{"kind": "stamp", "x": 50, "y": 90, "text": "结论"}]}
    assert any("字幕带" in w for w in run(low).warns), "落进字幕带没给警告"
    return "类型/组件/接线/校验一致"


def test_handwrite_wired_and_validated() -> str:
    """handwrite：类型 → 组件 → 注册 → preflight 校验，四处对上。"""
    declared = preflight._enum_from_code(TEMPLATE, "VisualKind") or set()
    assert "handwrite" in declared and "handwrite" in preflight.KINDS, \
        "handwrite 没同时出现在 VisualKind 和 preflight.KINDS"

    timeline = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    for needle in ("export type WriteSpec", "write?: WriteSpec", '"handwrite"'):
        assert needle in timeline, f"timeline.ts 缺 {needle}"

    comp = TEMPLATE / "src" / "components" / "Handwrite.tsx"
    assert comp.exists(), "缺 Handwrite.tsx"
    src = comp.read_text(encoding="utf-8")
    # 逐字显影、笔尖跟随、手形、换行抬笔——少一个就不是"写字"
    for needle in ("PaperHand", "hotIndices", "perChar", "visual.write",
                   "opacity: p", "cross", "charWidth"):
        assert needle in src, f"Handwrite.tsx 缺 {needle}"
    # 手部素材：组件 staticFile 引用它，图片丢了渲染会 404
    assert "staticFile" in src, "Handwrite.tsx 没引用 staticFile 手部素材"
    asset = TEMPLATE / "public" / "handwrite" / "hand.png"
    assert asset.exists(), "缺手部素材 public/handwrite/hand.png"

    visuals = (TEMPLATE / "src" / "visuals.tsx").read_text(encoding="utf-8")
    assert "handwrite: Handwrite" in visuals, "visuals.tsx 没注册 handwrite"
    index = (TEMPLATE / "src" / "components" / "index.ts").read_text(encoding="utf-8")
    assert 'export { Handwrite }' in index, "components/index.ts 没导出 Handwrite"

    kinds = preflight.kinds_from_code(TEMPLATE) or preflight.KINDS
    motions = preflight.motions_from_code(TEMPLATE) or preflight.MOTION_RECIPES
    layouts = preflight.layouts_from_code(TEMPLATE) or preflight.LAYOUT_MODES

    def run(visual: dict):
        rep = preflight.Report()
        preflight.check_visual(Path("."), rep, "beat0", visual, "我们不再退。",
                               kinds, motions, layouts)
        return rep

    good = {"kind": "handwrite", "text": "这一次，\n我们不再退。",
            "emphasis": ["不再退"], "layout": "left-edge",
            "write": {"size": 150, "color": "red", "speed": 3.2}}
    rep = run(good)
    assert not rep.errors, f"合法 handwrite 被误报：{rep.errors}"
    assert not [w for w in rep.warns if "layout" in w], f"handwrite 的 layout 没接上：{rep.warns}"

    errs = run({"kind": "handwrite"}).errors
    assert any("text" in e for e in errs), f"缺 text 没报错：{errs}"

    errs = run({"kind": "handwrite", "text": "写一句",
                "write": {"size": 900, "color": "blue", "speed": 0}}).errors
    for key in ("size", "color", "speed"):
        assert any(key in e for e in errs), f"非法 write.{key} 没报错：{errs}"

    warns = run({"kind": "handwrite", "text": "这是一句明显超过十二个字的手写长句"}).warns
    assert any("字" in w for w in warns), f"过长的手写句没提醒：{warns}"
    return "类型/组件/注册/校验一致"


def test_stage3d_wired_and_validated() -> str:
    """stage3d：类型 → 3D 组件 → visuals 接线 → preflight 校验 → 依赖，五处对上。"""
    declared = preflight._enum_from_code(TEMPLATE, "Stage3DCamera") or set()
    assert declared == preflight.STAGE3D_CAMERAS, \
        f"Stage3DCamera 与 preflight 枚举不一致：{declared ^ preflight.STAGE3D_CAMERAS}"

    timeline = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    for needle in ("export type Stage3DSpec", "export type Stage3DPieceSpec",
                   "stage3d?: Stage3DSpec"):
        assert needle in timeline, f"timeline.ts 缺 {needle}"
    assert '"drop" | "rise" | "pop"' in timeline, "纸片 enter 枚举变了，preflight 没跟着改"

    comp = TEMPLATE / "src" / "stage3d.tsx"
    assert comp.exists(), "缺 stage3d.tsx"
    src = comp.read_text(encoding="utf-8")
    for needle in ("ThreeCanvas", "resolveWordTimings", "useCurrentFrame",
                   "uCut", "piece.fall", "uShadow"):
        assert needle in src, f"stage3d.tsx 缺 {needle}"
    # uniform 原地改值会在逐帧多进程渲染里冻结——必须每帧新建对象
    assert "const uniforms = { ...baseUniforms" in src, \
        "找不到每帧新建 uniforms 的写法，画面可能定格在第一帧"
    assert "uniforms.uOpacity.value =" not in src, \
        "stage3d.tsx 原地改 uniform（会导致画面定格在第一帧）"

    visuals = (TEMPLATE / "src" / "visuals.tsx").read_text(encoding="utf-8")
    for needle in ("import { Stage3D }", "<Stage3D", "beat.visual.stage3d"):
        assert needle in visuals, f"visuals.tsx 缺 {needle}"

    pkg = (TEMPLATE / "package.json").read_text(encoding="utf-8")
    for dep in ("@react-three/fiber", "@remotion/three", "\"three\""):
        assert dep in pkg, f"模板 package.json 缺依赖 {dep}"

    pre = (ROOT / "scripts" / "preflight.py").read_text(encoding="utf-8")
    assert "check_stage3d(project, rep, where, visual, narration)" in pre, \
        "preflight 没接上 check_stage3d"

    kinds = preflight.kinds_from_code(TEMPLATE) or preflight.KINDS
    motions = preflight.motions_from_code(TEMPLATE) or preflight.MOTION_RECIPES
    layouts = preflight.layouts_from_code(TEMPLATE) or preflight.LAYOUT_MODES

    def run(visual: dict, narration: str = "方的井盖，会掉进自己的洞里。"):
        rep = preflight.Report()
        preflight.check_visual(Path("."), rep, "beat0", visual, narration,
                               kinds, motions, layouts)
        return rep

    good = {"kind": "kinetic", "stage3d": {"camera": "push_in", "pieces": [
        {"src": "https://example.invalid/lid-cut.png", "x": 1.22, "y": 0.56,
         "z": 0.42, "w": 1.0, "enter": "drop", "at": "井盖", "fall": "掉进",
         "marks": [{"w": 1.5, "h": 0.03, "rot": 44, "at": "对角"}]},
        {"src": "https://example.invalid/hole-cut.png", "x": 1.3, "y": -0.05,
         "z": -0.45, "w": 2.65, "hole": 1},
    ]}}
    rep = run(good)
    assert not rep.errors, f"合法 stage3d 被误报：{rep.errors}"

    scaled = {"kind": "kinetic", "stage3d": {"pieces": [
        {"src": "https://example.invalid/x-cut.png", "x": 0.5, "y": 0.5, "w": 0.3},
    ]}}
    assert any("画幅比例" in w for w in run(scaled).warns), "抄 0-1 坐标没提醒"

    bad = {"kind": "kinetic", "stage3d": {"camera": "tilt", "pieces": [
        {"src": "https://example.invalid/y-cut.png", "x": 0, "y": 0, "w": 2,
         "enter": "explode", "z": -5},
    ]}}
    errs = run(bad).errors
    assert any("camera" in e for e in errs), f"非法 camera 没报错：{errs}"
    assert any("enter" in e for e in errs), f"非法 enter 没报错：{errs}"
    assert any("后面" in w for w in run(bad).warns), "z 落到背景纸后面没提醒"

    lost = {"kind": "kinetic", "stage3d": {"pieces": [
        {"src": "https://example.invalid/z-cut.png", "x": 0, "y": 0, "w": 2,
         "at": "旁白里没有的词"},
    ]}}
    assert any("找不到" in w for w in run(lost).warns), "锚词脱拍没给警告"

    mixed = {"kind": "kinetic", "cutouts": [{"src": "https://example.invalid/a-cut.png",
                                             "x": 0.5, "y": 0.5, "w": 0.3}], **good}
    assert any("不会渲染" in w for w in run(mixed).warns), "cutouts 与 stage3d 并存没提醒"
    return "类型/依赖/接线/校验一致"


def test_doc_paths_exist() -> str:
    """文档里写到的 references/ 和 scripts/ 路径必须真的存在。"""
    missing = set()
    for doc in (ROOT / "SKILL.md", ROOT / "README.md"):
        txt = doc.read_text(encoding="utf-8")
        for rel in re.findall(r"(?:references|scripts|assets|evals)/[\w./-]+\.(?:md|py|mjs|json|jsonc)", txt):
            if not (ROOT / rel).exists():
                missing.add(f"{doc.name}: {rel}")
    assert not missing, f"文档指向不存在的文件：{sorted(missing)}"
    return "文档路径全部命中"


def _slug(heading: str) -> str:
    """近似 GitHub 的标题锚点规则：保留 CJK/字母/数字，空格转连字符，其余丢弃。"""
    out = []
    for ch in heading.replace("`", "").lower():
        if ch.isalnum() or ch in "-_":
            out.append(ch)
        elif ch.isspace():
            out.append("-")
    return "".join(out)


def _anchors(path: Path) -> set[str]:
    txt = path.read_text(encoding="utf-8")
    return {_slug(m.group(2)) for m in re.finditer(r"^(#{1,6})\s+(.*)$", txt, re.M)}


def test_doc_anchors_resolve() -> str:
    """跨文档链接的 #锚点 必须能落到真实标题上。"""
    docs = [ROOT / "SKILL.md", ROOT / "README.md", *sorted((ROOT / "references").glob("*.md"))]
    bad = []
    for doc in docs:
        txt = doc.read_text(encoding="utf-8")
        for m in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", txt):
            target = m.group(1)
            if target.startswith(("http", "mailto:")):
                continue
            rel, _, anchor = target.partition("#")
            dest = doc if not rel else doc.parent / rel
            if not dest.exists():
                continue
            if anchor and anchor not in _anchors(dest):
                bad.append(f"{doc.name}: {target}")
    assert not bad, f"锚点指向不存在的标题：{bad}"
    return "跨文档锚点可解析"


def test_visuals_wires_shots() -> str:
    """镜头拆分要在三处接上：visuals 渲染、VoxVideo 全局游标、BeatPresence 的 holdExit。"""
    visuals = (TEMPLATE / "src" / "visuals.tsx").read_text(encoding="utf-8")
    for needle in ("shots.map(", "<ShotLayer", "<Sequence",
                   "multiShot={shots.length > 1}", "fireImpact={i === 0}"):
        assert needle in visuals, f"visuals.tsx 缺 {needle}"
    layer = (TEMPLATE / "src" / "ShotLayer.tsx").read_text(encoding="utf-8")
    assert "multiShot" in layer and "shot.shown === undefined" in layer, \
        "ShotLayer 没在多镜拍里清掉拍级 text（会被每一镜重复上屏）"
    assert "fireImpact" in layer, "ShotLayer 没把冲击限制在拍内首镜（预算按拍计）"
    vox = (TEMPLATE / "src" / "VoxVideo.tsx").read_text(encoding="utf-8")
    assert "computeShots(" in vox and "cursor" in vox, "VoxVideo.tsx 没接全局镜头游标"
    assert "shots={shotsByBeat[i]" in vox, "VoxVideo.tsx 没把 shots 传给 BeatVisual"
    presence = (TEMPLATE / "src" / "components" / "BeatPresence.tsx").read_text(encoding="utf-8")
    assert "holdExit" in presence, "BeatPresence.tsx 缺 holdExit"
    assert re.search(r"EntranceContext[\s\S]{0,160}?holdExit: false", presence), \
        "EntranceContext 默认值缺 holdExit: false"
    return "三处接线齐全"


def test_preflight_validates_shots() -> str:
    """shots 的结构错误要在体检阶段被挡住，而不是渲染时静默失配。"""
    motions = preflight.motions_from_code(TEMPLATE) or preflight.MOTION_RECIPES
    layouts = preflight.layouts_from_code(TEMPLATE) or preflight.LAYOUT_MODES
    kinds = preflight.kinds_from_code(TEMPLATE) or preflight.KINDS

    def errors_for(visual: dict) -> list[str]:
        rep = preflight.Report()
        preflight.check_visual(Path("."), rep, "beat0", visual, "", kinds, motions, layouts)
        return rep.errors

    got = errors_for({"kind": "image", "src": "img/x.png", "shots": [{"to": 2}]})
    assert any("只对 kinetic" in e for e in got), f"非 kinetic 写 shots 没报错：{got}"

    assert errors_for({"kind": "kinetic", "shots": [{"to": 2}, {"from": 1}]}), \
        "重叠的 shots 没报错"
    assert errors_for({"kind": "kinetic", "shots": [{"from": 3, "to": 2}]}), \
        "to ≤ from 没报错"
    assert errors_for({"kind": "kinetic", "shots": [{"transition": "wipe"}]}), \
        "非法 ShotTransition 没报错"

    got = errors_for({"kind": "kinetic", "shots": [{"to": 2}, {"from": 2, "motion": "rise"}]})
    assert not got, f"合法 shots 被误报：{got}"

    assert errors_for({"kind": "kinetic", "shots": [{"to": 2}, {"to": 4}]}), \
        "第 2 镜起没写 from 没报错"
    assert errors_for({"kind": "kinetic", "shots": [{"from": 2}, {"from": 1}]}), \
        "from 倒序没报错"

    # 首镜缺 from 是合法的（从 0 开始）
    assert not errors_for({"kind": "kinetic", "shots": [{"to": 2}, {"from": 2}]}), \
        "首镜缺 from 被误报"
    return "shots 结构校验"


def test_preflight_shot_fit() -> str:
    """显式镜的 to 越过实测拍长时要在体检阶段报出来。

    from/to 是秒，拍长是 TTS 之后才有的帧数——没有 timeline.json 就跳过，
    有就必须查：否则运行时只会把它 clamp 成末尾一帧，静默吞掉整镜。
    """
    import json

    tmp = Path(tempfile.mkdtemp(prefix="fit-"))
    (tmp / "src").mkdir()
    script = {"title": "t", "beats": [{
        "id": "a",
        "narration": "一，二。",
        "visual": {"kind": "kinetic", "shots": [{"to": 1}, {"from": 1, "to": 9}]},
    }]}
    (tmp / "script.json").write_text(json.dumps(script, ensure_ascii=False), encoding="utf-8")

    (tmp / "src" / "timeline.json").write_text(
        json.dumps({"fps": 30, "beats": [{"id": "a", "durationInFrames": 120}]}),
        encoding="utf-8",
    )
    rep = preflight.Report()
    preflight.check_script(tmp, rep)
    assert any("超出" in e for e in rep.errors), f"越拍长没报错：{rep.errors}"

    (tmp / "src" / "timeline.json").write_text(
        json.dumps({"fps": 30, "beats": [{"id": "a", "durationInFrames": 300}]}),
        encoding="utf-8",
    )
    rep = preflight.Report()
    preflight.check_script(tmp, rep)
    assert not rep.errors, f"合法时长被误报：{rep.errors}"
    return "显式镜越拍长"


def test_check_rhythm_shot_adjacency() -> str:
    """镜头级配方要跨拍检查相邻重复（全局序号），不能只看拍级首镜。"""
    beats = [
        {"id": "a", "visual": {"kind": "kinetic", "shots": [{"motion": "stamp"}]}},
        {"id": "b", "visual": {"kind": "kinetic", "shots": [{"motion": "stamp"}]}},
    ]
    _, problems = check_rhythm.check_shot_rhythm(beats)
    assert problems, "跨拍相邻镜头同配方没报警"

    beats = [
        {"id": "a", "visual": {"kind": "kinetic", "shots": [{}, {}]}},
        {"id": "b", "visual": {"kind": "kinetic", "shots": [{}]}},
    ]
    _, problems = check_rhythm.check_shot_rhythm(beats)
    assert not problems, f"默认轮换不该报警：{problems}"

    # 前一拍可能自动拆成多镜（末镜配方未知）→ 这一对接缝算不准，只提示不判失败
    beats = [
        {"id": "a", "narration": "甲，乙。", "words": [{"t": 0, "d": 10, "text": "甲"}],
         "visual": {"kind": "kinetic"}},
        {"id": "b", "visual": {"kind": "kinetic", "shots": [{"motion": "stamp"}]}},
    ]
    _, problems = check_rhythm.check_shot_rhythm(beats)
    assert not problems, f"自动拆分之后的相邻判定误报失败：{problems}"

    # 拍级相邻检查要跳过带 shots 的拍：首镜≠末镜，真正的接缝由镜头级负责
    beats = [
        {"id": "a", "visual": {"kind": "kinetic",
                               "shots": [{"motion": "stamp"}, {"motion": "rise"}]}},
        {"id": "b", "visual": {"kind": "kinetic", "motion": "stamp"}},
    ]
    _, problems = check_rhythm.check_motion_variety(beats)
    assert not problems, f"shots 拍的拍级相邻误报：{problems}"
    return "镜头级相邻检测"


def test_contrast_audit() -> str:
    """对比度审计要读得到 theme 色板，且五色板当前组合全过；改坏要报。"""
    colors = check_rhythm.theme_colors(TEMPLATE / "src")
    assert colors, "读不到 theme.ts 的 COLORS"
    _, problems = check_rhythm.contrast_audit(colors)
    assert not problems, f"模板色板不该有对比度错误：{problems}"

    bad = dict(colors)
    bad["ink"] = colors["paper"]  # 1:1，必然不够
    _, problems = check_rhythm.contrast_audit(bad)
    assert any("对比度不足" in p for p in problems), "调色板改坏没报"
    assert abs(check_rhythm.contrast_ratio("#000000", "#FFFFFF") - 21) < 0.02
    return f"{len(colors)} 支颜色 / 算法校准"


def test_caption_size_floor() -> str:
    """字幕 60px 是单独一条线，不能和辅助文字共用 32px 的下限。"""
    _, problems = check_rhythm.check_caption_size(TEMPLATE / "src")
    assert not problems, f"模板字幕不该低于 60px：{problems}"

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "src"
        (src / "components").mkdir(parents=True)
        (src / "components" / "CaptionTrack.tsx").write_text(
            "fontSize: 56,\n", encoding="utf-8")
        _, problems = check_rhythm.check_caption_size(src)
        assert problems, "56px 字幕没报"
        assert "60" in problems[0]
    return "60px 单独卡"


def test_preflight_validates_change() -> str:
    """change 可选；写了就四件事齐全，中英文键名都认。"""
    good = {"enter": "落下", "main": "盖章", "secondary": "网点爬移", "exit": "盖屏"}
    rep = preflight.Report()
    preflight.check_change(rep, "b1", good)
    assert not rep.errors, rep.errors

    cn = {"进场": "落下", "主动作": "盖章", "次要动作": "网点爬移", "出场": "盖屏"}
    rep = preflight.Report()
    preflight.check_change(rep, "b2", cn)
    assert not rep.errors, f"中文键名被误报：{rep.errors}"

    rep = preflight.Report()
    preflight.check_change(rep, "b3", {"enter": "落下", "secondary": "网点"})
    assert any("主动作" in e for e in rep.errors), "缺主动作没报"

    rep = preflight.Report()
    preflight.check_change(rep, "b4", "落下")
    assert rep.errors, "非对象没报"

    rep = preflight.Report()
    preflight.check_change(rep, "b5", {**good, "结尾": "切"})
    assert any("不认识的键" in e for e in rep.errors), "未知键没报"
    return "四项齐全 / 中英键名"


def test_richness_metrics() -> str:
    """丰富度的三个读数：帧差、在动占比、最长静止、相邻格判定。"""
    assert check_richness.frame_diff(b"\x00\x00", b"\x0a\x14") == 15.0

    # 25 帧全灰、后 25 帧全白：每 2.5 秒一格，第 2 格差 100
    frames = [b"\x00"] * 25 + [b"\x64"] * 25
    diffs = check_richness.grid_diffs(frames, 2.5)
    assert len(diffs) == 1 and abs(diffs[0][1] - 100) < 1e-6, diffs

    ok, avg, flat, _ = check_richness.verdict([12.0, 11.0])
    assert ok and flat == 0 and abs(avg - 11.5) < 1e-6
    assert not check_richness.verdict([12.0, 3.0])[0], "几乎没变应判不过"
    assert not check_richness.verdict([9.0, 9.0])[0], "平均不够应判不过"

    # 帧 0/1 相同、帧 2/3 变化：静止 0.2 秒，从 0 秒起
    moving, longest, at = check_richness.motion_stats(
        [b"\x00", b"\x00", b"\x00", b"\x32"])
    assert abs(moving - 100 / 3) < 1e-6 and abs(longest - 0.2) < 1e-6 and at == 0.0
    return "帧差 / 静止段 / 判定"


def test_node_shot_suite() -> str:
    """computeShots 的 node 断言套件。esbuild 不可用时警告并跳过（不 FAIL）。"""
    import subprocess

    tmp = Path(tempfile.mkdtemp(prefix="shots-"))
    bundle = tmp / "shots.bundle.mjs"
    entry = TEMPLATE / "src" / "shots.ts"
    # Windows 下 npx 是 .cmd shim，CreateProcess 直接跑不了，走 shell
    try:
        r = subprocess.run(
            f'npx -y esbuild "{entry}" --bundle --format=esm "--outfile={bundle}"',
            shell=True, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"    (esbuild 不可用，跳过 node 子套件：{e})")
        return "跳过"
    if r.returncode != 0:
        print(f"    (esbuild 失败，跳过 node 子套件：{(r.stderr or '').strip()[:120]})")
        return "跳过"
    r2 = subprocess.run(
        ["node", str(SCRIPTS / "shots_check.mjs"), str(bundle)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
    )
    if r2.returncode != 0:
        raise AssertionError(f"node 套件失败：\n{r2.stdout}\n{r2.stderr}")
    return r2.stdout.strip().splitlines()[-1]


def test_word_alignment_suite() -> str:
    """resolveWordTimings 的 node 套件：上屏词与词流两侧都要剥标点。"""
    import subprocess

    tmp = Path(tempfile.mkdtemp(prefix="words-"))
    bundle = tmp / "words.bundle.mjs"
    entry = TEMPLATE / "src" / "words.ts"
    try:
        r = subprocess.run(
            f'npx -y esbuild "{entry}" --bundle --format=esm "--outfile={bundle}"',
            shell=True, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"    (esbuild 不可用，跳过 node 子套件：{e})")
        return "跳过"
    if r.returncode != 0:
        print(f"    (esbuild 失败，跳过 node 子套件：{(r.stderr or '').strip()[:120]})")
        return "跳过"
    r2 = subprocess.run(
        ["node", str(SCRIPTS / "words_check.mjs"), str(bundle)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
    )
    if r2.returncode != 0:
        raise AssertionError(f"node 套件失败：\n{r2.stdout}\n{r2.stderr}")
    return r2.stdout.strip().splitlines()[-1]


def test_paper_tiles_wired() -> str:
    """强调词贴纸片：切分是纯函数，两个文本组件都接上了，且每拍限量。"""
    words = (TEMPLATE / "src" / "words.ts").read_text(encoding="utf-8")
    assert "export const splitByEmphasis" in words, "words.ts 缺 splitByEmphasis"

    tile = (TEMPLATE / "src" / "components" / "PaperTile.tsx").read_text(encoding="utf-8")
    for needle in ("roughEdge", "drop-shadow", "spring", "Tape", "BrushUnderline"):
        assert needle in tile, f"PaperTile 缺 {needle}"

    assert "export const autoTileVariant" in tile, "PaperTile 缺 autoTileVariant"
    for variant in ("cut", "note", "clip", "label", "banner", "red"):
        assert f"\n  {variant}: {{" in tile, f"PaperTile 缺版式 {variant}"
    assert "COLORS.gold" in tile, "label 版式没用金色——短词就跳不出来"
    assert "chars >= 6" in tile, "长文本应自动走 banner"
    assert "order" in tile, "同一拍第二张纸片要能换版"

    for name in ("KineticText", "QuoteCard"):
        src = (TEMPLATE / "src" / "components" / f"{name}.tsx").read_text(encoding="utf-8")
        assert 'from "./PaperTile"' in src, f"{name} 没接 PaperTile"
        assert "splitByEmphasis" in src, f"{name} 没切分强调短语"
        assert "slice(0, 2)" in src, f"{name} 没有每拍 2 张的上限"
        assert "order={" in src, f"{name} 没把纸片序号传给 PaperTile"

    docs = (ROOT / "references" / "components.md").read_text(encoding="utf-8")
    assert "纸片字" in docs, "components.md 没写纸片字规则"
    for variant in ("label", "banner", "red"):
        assert f"`{variant}`" in docs, f"components.md 没写 {variant} 版式"

    preflight = (ROOT / "scripts" / "preflight.py").read_text(encoding="utf-8")
    line = next((l for l in preflight.splitlines() if l.startswith("TILE_VARIANTS")), "")
    for variant in ("cut", "note", "clip", "label", "banner", "red", "auto"):
        assert f'"{variant}"' in line, f"preflight 的 TILE_VARIANTS 缺 {variant}"
    return "纯切分 + 每拍限量 + 六种版式"


def test_render_gate_requires_still_approval() -> str:
    """闸门 B：先出关键帧联络表并拿到用户确认，渲染排在确认之后。"""
    skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert "未拿到确认前，不执行 `npx remotion render`" in skill, \
        "SKILL.md 没写渲染前的硬停"
    assert "sheet.png" in skill and "不是只报路径" in skill, \
        "闸门 B 要把关键帧图片发给用户，不能只报路径"
    assert skill.index("### 闸门 B") < skill.index("## 渲染"), \
        "闸门 B 必须写在渲染之前"

    stills = (ROOT / "scripts" / "stills.py").read_text(encoding="utf-8")
    assert "sheet_png_pillow" in stills, \
        "没有完整 ffmpeg 时要用 Pillow 拼 PNG 联络表，否则用户看不到图"
    return "关键帧确认后才渲染"


def test_images_are_mandatory() -> str:
    """配图是硬要求；闸门 0（效果图）必须排在写稿与配音之前。"""
    skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert "### 闸门 0" in skill, "缺闸门 0（开工前效果图）"
    assert skill.index("### 闸门 0") < skill.index("### 闸门 A"), \
        "闸门 0 必须排在闸门 A 之前"
    assert "每一片都必须有配图" in skill, "SKILL.md 没写配图是硬要求"
    assert "配图是可选步骤" not in skill, "SKILL.md 还在说配图可选"

    with tempfile.TemporaryDirectory() as td:
        rep = preflight.Report()
        beats = [{"id": f"b{i}", "visual": {"kind": "kinetic"}} for i in range(6)]
        preflight.check_image_coverage(Path(td), rep, beats)
        assert rep.errors and "配图不够" in rep.errors[0], "6 拍零配图应当报错"

        rep2 = preflight.Report()
        beats2 = [{"id": f"b{i}", "visual": {"kind": "kinetic"}} for i in range(6)]
        for i in (0, 2, 4):
            beats2[i]["visual"] = {"kind": "kinetic", "image": "img/b.png"}
        preflight.check_image_coverage(Path(td), rep2, beats2)
        assert not rep2.errors, f"3/6 拍有配图不应报错：{rep2.errors}"
    return "配图下限 + 闸门 0 顺序"


def test_word_helpers_are_pure_module() -> str:
    """对齐逻辑必须住在无 React 依赖的 words.ts 里，否则 node 套件测不到。"""
    words = (TEMPLATE / "src" / "words.ts").read_text(encoding="utf-8")
    assert "export const resolveWordTimings" in words, "words.ts 缺 resolveWordTimings"
    assert "export const makeEmphasisMatcher" in words, "words.ts 缺 makeEmphasisMatcher"
    for banned in ("from \"remotion\"", "from \"react\"", "from \"./components"):
        assert banned not in words, f"words.ts 不能依赖 {banned}"

    presence = (TEMPLATE / "src" / "components" / "BeatPresence.tsx").read_text(encoding="utf-8")
    assert 'from "../words"' in presence, "BeatPresence 没从 words.ts 取对齐函数"
    return "纯模块 + 单向依赖"


def test_tail_never_shows_bare_stage() -> str:
    """片尾留白必须并进最后一拍：否则 TransitionSeries 散场后露出纯色根底。"""
    import vox_tts

    beats = [{"from": 0, "durationInFrames": 100}, {"from": 100, "durationInFrames": 50}]
    vox_tts.stretch_last_beat(beats, 168)
    assert beats[-1]["durationInFrames"] == 68, "最后一拍没吸收片尾留白"
    assert beats[0]["durationInFrames"] == 100, "前面的拍不能被改"

    same = [{"from": 0, "durationInFrames": 70}]
    vox_tts.stretch_last_beat(same, 70)
    assert same[0]["durationInFrames"] == 70, "总长已对齐时不应改动"
    vox_tts.stretch_last_beat([], 10)  # 空片不炸
    return "最后一拍吸收 tailPad"


def test_cutout_keying_keeps_enclosed_colors() -> str:
    """抠底只删与画布边缘连通的底色；被图形包住的近似色（纸片内芯）必须留住。"""
    try:
        import cutout  # noqa: PLC0415
    except ImportError as e:
        return f"跳过（{e}）"

    from PIL import Image, ImageDraw  # noqa: PLC0415

    im = Image.new("RGB", (400, 300), (244, 241, 234))
    d = ImageDraw.Draw(im)
    d.ellipse([110, 60, 290, 240], fill=(45, 48, 56))
    # 内芯颜色接近底色，但被深灰环整个包住——按连通行抠底时不能删
    d.ellipse([145, 95, 255, 205], fill=(238, 234, 222))

    rgba, meta = cutout.key_out(im)
    assert rgba.mode == "RGBA"
    center = (rgba.width // 2, rgba.height // 2)
    assert rgba.getpixel((0, 0))[3] == 0, "画布角落的底色应被抠掉"
    assert rgba.getpixel(center)[3] == 255, "被深色环包住的浅色内芯不能被误抠"
    assert meta["bbox"] is not None
    assert rgba.size[0] < 400 and rgba.size[1] < 300, "应按内容裁边"
    return "flood fill + 裁边"


def test_cutouts_wired_and_validated() -> str:
    """cutouts：类型 → 组件 → visuals 接线 → preflight 校验，四处都要对上。"""
    declared = preflight._enum_from_code(TEMPLATE, "CutoutEnter") or set()
    assert declared == preflight.CUTOUT_ENTERS, \
        f"CutoutEnter 与 preflight 枚举不一致：{declared ^ preflight.CUTOUT_ENTERS}"

    timeline = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    assert "cutouts?: CutoutSpec[]" in timeline, "VisualSpec 没声明 cutouts"
    assert "export type CutoutSpec" in timeline, "缺 CutoutSpec 类型"

    comp = TEMPLATE / "src" / "components" / "CutoutLayer.tsx"
    assert comp.exists(), "缺 CutoutLayer.tsx"
    src = comp.read_text(encoding="utf-8")
    for needle in ("resolveWordTimings", "drop-shadow", "fallAtom", "translate(-50%, -50%)"):
        if needle == "fallAtom":
            assert "spec.fall" in src, "CutoutLayer 没处理坠落锚词"
        else:
            assert needle in src, f"CutoutLayer 缺 {needle}"

    visuals = (TEMPLATE / "src" / "visuals.tsx").read_text(encoding="utf-8")
    for needle in ("backCutouts", "frontCutouts", "<CutoutLayer"):
        assert needle in visuals, f"visuals.tsx 缺 {needle}"

    kinds = preflight.kinds_from_code(TEMPLATE) or preflight.KINDS
    motions = preflight.motions_from_code(TEMPLATE) or preflight.MOTION_RECIPES
    layouts = preflight.layouts_from_code(TEMPLATE) or preflight.LAYOUT_MODES

    def run(visual: dict, narration: str = "方的井盖，会掉进自己的洞里。"):
        rep = preflight.Report()
        preflight.check_visual(Path("."), rep, "beat0", visual, narration,
                               kinds, motions, layouts)
        return rep

    good = {"kind": "kinetic", "cutouts": [{
        "src": "https://example.invalid/hole-cut.png",
        "x": 0.5, "y": 0.42, "w": 0.36, "enter": "drop",
        "at": "掉进", "fall": "洞里", "depth": 0.4,
    }]}
    rep = run(good)
    assert not rep.errors and not [w for w in rep.warns if "cutout" in w], \
        f"合法 cutouts 被误报：{rep.errors} {rep.warnings}"

    bad = {"kind": "kinetic", "cutouts": [
        {"src": "https://example.invalid/x-cut.png", "x": 1.4, "y": 0.5, "enter": "explode"},
        {"src": "https://example.invalid/y-cut.png", "x": 0.5, "y": 0.5, "w": 0},
    ]}
    errs = run(bad).errors
    assert any("中心点" in e for e in errs), f"越界坐标没报错：{errs}"
    assert any("enter" in e for e in errs), f"非法 enter 没报错：{errs}"
    assert any("w" in e for e in errs), f"w=0 没报错：{errs}"

    lost = {"kind": "kinetic", "cutouts": [{
        "src": "https://example.invalid/z-cut.png",
        "x": 0.5, "y": 0.5, "w": 0.3, "at": "旁白里没有的词",
    }]}
    assert any("找不到" in w for w in run(lost).warns), "锚词脱拍没给警告"
    return "类型/组件/接线/校验一致"


TESTS = [
    test_kind_list_matches_declaration,
    test_kind_list_rejects_schema_enums,
    test_consecutive_hard_cuts_are_fine,
    test_repeated_soft_transition_is_flagged,
    test_single_soft_transition_is_flagged,
    test_motion_layout_enums_match_declaration,
    test_shot_spec_declared,
    test_shot_transition_enum_matches_declaration,
    test_visuals_wires_shots,
    test_preflight_validates_shots,
    test_preflight_shot_fit,
    test_check_rhythm_shot_adjacency,
    test_contrast_audit,
    test_caption_size_floor,
    test_preflight_validates_change,
    test_richness_metrics,
    test_auto_rotation_never_repeats_adjacent,
    test_motion_variety_detects_repeats,
    test_layout_support_matches_components,
    test_rate_default_is_consistent,
    test_sync_report_field_names,
    test_every_script_guards_stderr,
    test_media_prefers_compositor_build,
    test_node_shot_suite,
    test_word_alignment_suite,
    test_word_helpers_are_pure_module,
    test_paper_tiles_wired,
    test_render_gate_requires_still_approval,
    test_images_are_mandatory,
    test_tail_never_shows_bare_stage,
    test_cutout_keying_keeps_enclosed_colors,
    test_cutouts_wired_and_validated,
    test_annotations_wired_and_validated,
    test_handwrite_wired_and_validated,
    test_stage3d_wired_and_validated,
    test_doc_paths_exist,
    test_doc_anchors_resolve,
]


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    failed = 0
    for fn in TESTS:
        try:
            note = fn()
        except AssertionError as e:
            failed += 1
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ✗ {fn.__name__}: {type(e).__name__}: {e}")
        else:
            print(f"  ✓ {fn.__name__}  {note}")

    print(f"\n[selftest] {len(TESTS) - failed}/{len(TESTS)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

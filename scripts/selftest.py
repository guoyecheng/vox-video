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
import preflight  # noqa: E402
import _media  # noqa: E402


def declared_kinds() -> set[str]:
    txt = (TEMPLATE / "src" / "timeline.ts").read_text(encoding="utf-8")
    decl = txt[txt.find("export type VisualKind"):]
    return set(re.findall(r'"(\w+)"', decl[:decl.find(";")]))


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


TESTS = [
    test_kind_list_matches_declaration,
    test_kind_list_rejects_schema_enums,
    test_consecutive_hard_cuts_are_fine,
    test_repeated_soft_transition_is_flagged,
    test_single_soft_transition_is_flagged,
    test_rate_default_is_consistent,
    test_sync_report_field_names,
    test_every_script_guards_stderr,
    test_media_prefers_compositor_build,
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

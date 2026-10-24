#!/usr/bin/env python3
"""
模板 ↔ 项目 的代码同步。

为什么需要这个
--------------
组件代码住在 skill 的 `assets/template/` 里，但真正跑的是各个项目。
改了模板不推过去，项目跑的还是旧组件（"为什么这个项目没有新功能"）；
在项目里改了组件不回灌模板，别的项目也拿不到。

手工复制最容易出两类事故：
1. 把项目私有的东西一起拷走（`script.json`、`src/timeline.json`、`public/img`…）
2. 拷了一半，模板和项目各有一套

这个脚本把"哪些文件是共享的"写死在这里，两个方向都受同一份清单管。

共享清单
--------
- `src/**` —— 除了 `src/timeline.json`（那是 TTS 生成的产物，每拍不同）
- `public/fonts/**` —— 字体是共享资产（17MB，相同就不重复拷）
- `remotion.config.ts`、`tsconfig.json`、`.gitignore`

**永远不碰**：`script.json`、`src/timeline.json`、`public/img`、`public/audio`、
`out/`、`node_modules/`、`package.json`（里面的脚本路径是每台机器写死的，
由 scaffold 负责改写）。

用法
----
    python sync_template.py --project "<项目>" --check              # 只看差异
    python sync_template.py --project "<项目>" --push               # 模板 → 项目
    python sync_template.py --project "<项目>" --pull --force       # 项目 → 模板（先备份）

`--check` 有差异时退出码为 1，可以进 CI。
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import time
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / "assets" / "template"

# 项目私有，永不同步
PRIVATE = {
    "script.json",
    "images.json",
    "src/timeline.json",
    "package.json",
    "package-lock.json",
}

# 共享的顶层文件 / 目录
SHARED_FILES = ["remotion.config.ts", "tsconfig.json", ".gitignore"]
SHARED_DIRS = ["src", "public/fonts"]


def is_private(rel: str) -> bool:
    if rel in PRIVATE:
        return True
    for p in PRIVATE:
        if rel.startswith(p + "/"):
            return True
    # 项目自己的产出目录
    for p in ("out/", "node_modules/", "public/img/", "public/audio/"):
        if rel.startswith(p):
            return True
    return False


def shared_files(root: Path) -> list[str]:
    """列出 root 下所有属于共享清单的相对路径。"""
    out: list[str] = []
    for f in SHARED_FILES:
        if (root / f).exists():
            out.append(f.replace("\\", "/"))
    for d in SHARED_DIRS:
        base = root / d
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = str(p.relative_to(root)).replace("\\", "/")
                if not is_private(rel):
                    out.append(rel)
    return sorted(set(out))


def digest(p: Path) -> str:
    h = hashlib.md5()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def compare(src: Path, dst: Path) -> tuple[list[str], list[str], list[str]]:
    """返回（只在 src、只在 dst、内容不同）三组相对路径。"""
    s = {f: (src / f) for f in shared_files(src)}
    d = {f: (dst / f) for f in shared_files(dst)}
    only_src = sorted(set(s) - set(d))
    only_dst = sorted(set(d) - set(s))
    diff = []
    for f in sorted(set(s) & set(d)):
        if s[f].stat().st_size != d[f].stat().st_size or digest(s[f]) != digest(d[f]):
            diff.append(f)
    return only_src, only_dst, diff


def copy_one(src_file: Path, dst_file: Path, backup: Path | None) -> None:
    dst_file.parent.mkdir(parents=True, exist_ok=True)
    if backup and dst_file.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dst_file, backup)
    shutil.copy2(src_file, dst_file)


def main() -> int:
    # Windows 下 stdout 被重定向（npm run / 管道）时用 GBK，✓/✗ 这类符号会
    # UnicodeEncodeError 把同步报告打断
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ap = argparse.ArgumentParser(description="模板 ↔ 项目 代码同步")
    ap.add_argument("--project", required=True, help="项目根目录")
    ap.add_argument("--template", default=None,
                    help="模板目录，默认用 skill 里的 assets/template（测试或分叉模板时用）")
    ap.add_argument("--check", action="store_true", help="只看差异，不写文件")
    ap.add_argument("--push", action="store_true", help="模板 → 项目")
    ap.add_argument("--pull", action="store_true", help="项目 → 模板")
    ap.add_argument("--force", action="store_true", help="pull 时允许覆盖模板（先自动备份）")
    ap.add_argument("--quiet", action="store_true", help="只报差异数量")
    a = ap.parse_args()

    project = Path(a.project).resolve()
    template = Path(a.template).resolve() if a.template else TEMPLATE
    if not project.exists():
        sys.exit(f"[sync] 项目不存在：{project}")
    if not template.exists():
        sys.exit(f"[sync] 模板不存在：{template}")
    if a.check == (a.push or a.pull):
        sys.exit("[sync] 用法：--check / --push / --pull 三选一")

    if a.check:
        only_t, only_p, diff = compare(template, project)
        print(f"[sync] 模板 {template}")
        print(f"      项目 {project}")
        print(f"  只在模板：{len(only_t)}  缺文件")
        for f in only_t[:20]:
            print(f"      - {f}")
        print(f"  只在项目：{len(only_p)}  （未回灌的新增文件；push 不动它们，要进模板用 --pull）")
        for f in only_p[:20]:
            print(f"      + {f}")
        print(f"  内容不同：{len(diff)}")
        for f in diff[:40]:
            print(f"      ~ {f}")
        if len(diff) > 40:
            print(f"      … 还有 {len(diff) - 40} 个")
        n = len(only_t) + len(diff)
        print(f"[sync] {'有漂移' if n else '一致'}（{n} 处）")
        return 1 if n else 0

    if a.push:
        src, dst = template, project
        only_src, _, diff = compare(src, dst)
        todo = sorted(set(only_src) | set(diff))
        if not todo:
            print("[sync] 项目已经和模板一致，没什么要推的")
            return 0
        print(f"[sync] 模板 → 项目，{len(todo)} 个文件")
        for f in todo:
            copy_one(src / f, dst / f, None)
            print(f"      ← {f}")
        print(f"[sync] 推完了：{dst}")
        print("      提醒：改了 src/ 之后要重新渲染才看得到；timeline 没变就不用重跑 npm run tts")
        return 0

    # pull：项目 → 模板
    if not a.force:
        print("[sync] pull 会覆盖模板里的文件（模板是所有项目的源头）。")
        print("      确认无误后加 --force；覆盖前会自动备份到 assets/template/.backup/<时间戳>/")
        return 2
    # compare(src=项目, dst=模板) → only_src 是**只在项目里**的文件。
    # 这正是要回灌的东西：新加的 src/xxx.tsx 就靠它带回去。
    # （早期版本这里误用了 only_dst，等于只回灌"模板独有"的文件，项目新增的反而丢了。）
    only_src, _, diff = compare(project, template)
    todo = sorted(set(only_src) | set(diff))
    if not todo:
        print("[sync] 模板已经和项目一致，没什么要回灌的")
        return 0
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = template / ".backup" / stamp
    print(f"[sync] 项目 → 模板，{len(todo)} 个文件（备份到 {backup}）")
    for f in todo:
        copy_one(project / f, template / f, backup / f)
        print(f"      → {f}")
    print(f"[sync] 回灌完了：{template}")
    print("      提醒：改完模板后，其它项目要跑 --push 才拿到")
    return 0


if __name__ == "__main__":
    sys.exit(main())

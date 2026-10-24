"""定位 Remotion 自带的 ffmpeg / ffprobe。

`@remotion/compositor-*` 随 npm install 一起下来，里面有一套静态构建的
ffmpeg/ffprobe。优先用它：不能假设用户机器上装了系统 ffmpeg。

返回 None 而不是直接退出——各脚本要报自己的前缀和补救建议。
"""

from __future__ import annotations

import glob
import shutil
from pathlib import Path


def compositor_bins(project: Path, name: str) -> list[str]:
    """Remotion 自带的可执行文件，按路径排序保证跨机一致。"""
    patterns = (
        f"node_modules/@remotion/compositor-*/{name}.exe",
        f"node_modules/@remotion/compositor-*/{name}",
        # 项目可能是 monorepo 里的子目录，依赖提升到了上一层
        f"../node_modules/@remotion/compositor-*/{name}.exe",
        f"../node_modules/@remotion/compositor-*/{name}",
    )
    hits: list[str] = []
    for pat in patterns:
        hits += sorted(glob.glob(str(project / pat)))
    return hits


def find_tool(project: Path, name: str) -> str | None:
    """先找项目里的 Remotion 自带版，再退回 PATH。"""
    bins = compositor_bins(project, name)
    return bins[0] if bins else shutil.which(name)


def find_ffmpeg(project: Path) -> str | None:
    return find_tool(project, "ffmpeg")


def find_ffprobe(project: Path) -> str | None:
    return find_tool(project, "ffprobe")

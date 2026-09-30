#!/usr/bin/env python3
# Copyright 2026 重庆半格智能科技有限公司
# SPDX-License-Identifier: AGPL-3.0-only
"""Tellomi: _locales/*/messages.json 里的品牌字符串改名，已经搬到超级仓库 scripts/brand/rename-strings.py（tellomi/tellomi#1246）。

这个文件只是转发，让 `python3 scripts/tellomi/rename-strings.py [--check]` 这条老命令还能用，不再自带规则：
Android / iOS / Desktop 共用同一张表和同一套把关规则，两份规则放在两处会漂移。原来这里的那份用各语种自己的译文判分类，
ORG_HINTS 只认中文和英文，把 3 个讲非营利组织的 key 在 55 种语言里改成了「Tellomi 是非营利组织」（157 处，已取回上游原文）；
也不认音译、拉丁语种的变格、韩语助词和土耳其语词尾。

    python3 scripts/tellomi/rename-strings.py --check          # 只统计，不改文件
    python3 scripts/tellomi/rename-strings.py                  # 真改
    python3 scripts/tellomi/rename-strings.py --restore-org    # 一次性：把被改坏的组织陈述从上游 tag 取回
    python3 scripts/tellomi/rename-strings.py --stats          # 逐语种列出改了几条

超级仓库在哪：环境变量 TELLOMI_SUPER_ROOT，或者这个 fork 本身就是超级仓库里的 clients/desktop。找不到就报错退出，不会退回到旧规则。
上游基线 tag 默认是 v8.27.0（超级仓库 docs/signal/VERSIONS.md），fork 被 rebase 到新的上游 tag 之后用 BRAND_DESKTOP_UPSTREAM_REF 指过去。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

FORK = Path(__file__).resolve().parents[2]


def find_super_script() -> Path | None:
    roots = []
    if os.environ.get("TELLOMI_SUPER_ROOT"):
        roots.append(Path(os.environ["TELLOMI_SUPER_ROOT"]))
    roots.append(FORK.parents[1])  # <超级仓库>/clients/desktop
    for root in roots:
        script = root / "scripts" / "brand" / "rename-strings.py"
        if script.is_file():
            return script
    return None


def main() -> int:
    script = find_super_script()
    if script is None:
        print(
            "找不到超级仓库的 scripts/brand/rename-strings.py。"
            "把 TELLOMI_SUPER_ROOT 指到 tellomi/tellomi 的检出，例如：\n"
            f"  TELLOMI_SUPER_ROOT=<tellomi 超级仓库> python3 {Path(__file__).name} {' '.join(sys.argv[1:])}",
            file=sys.stderr,
        )
        return 2
    env = {**os.environ, "BRAND_DESKTOP_ROOT": str(FORK)}
    return subprocess.run(
        [sys.executable, str(script), "--platform", "desktop", *sys.argv[1:]], env=env
    ).returncode


if __name__ == "__main__":
    sys.exit(main())

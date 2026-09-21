#!/usr/bin/env python3
"""Tellomi: 把 _locales/*/messages.json 文案里的产品名「Signal」换成「Tellomi」，幂等，可在每次合并上游后重跑。

    python3 scripts/tellomi/rename-strings.py --check    # 只统计
    python3 scripts/tellomi/rename-strings.py            # 真改，并把不动的条目列到 build/tellomi-strings-todo.txt

与超级仓库 scripts/brand/rename-strings.py（Android / iOS）同一套分类，三类不动（换了就是假话 / 错话，留给人定）：
  url       含 signal.org / signal.me / 任何链接的（我们对应页面还没有）
  org       讲 Signal 这个组织的（非营利、捐赠、版权、Signal Messenger）
  protocol  「Signal Protocol」这种技术名词
只改 messageformat 的值，不碰 key、description、占位符；写回保持 2 空格缩进与原键序。"""
import argparse, json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD, NEW = "Signal", "Tellomi"
WORD = re.compile(rf"\b{OLD}\b")
URL_HINTS = ("signal.org", "signal.me", "://")
ORG_HINTS = ("501", "nonprofit", "non-profit", "非营利", "非牟利", "llc", "foundation", "signal messenger", "donat", "捐款", "捐赠", "版权", "copyright")
PROTO_HINTS = ("signal protocol", "signal 协议")


def classify(text):
    low = text.lower()
    if any(h in low for h in URL_HINTS): return "url"
    if any(h in low for h in PROTO_HINTS): return "protocol"
    if any(h in low for h in ORG_HINTS): return "org"
    return "rename"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--check", action="store_true"); a = ap.parse_args()
    counts = Counter(); todo = []; files = 0
    for p in sorted((ROOT / "_locales").glob("*/messages.json")):
        raw = p.read_text(encoding="utf-8"); d = json.loads(raw); changed = 0
        for k, v in d.items():
            if not isinstance(v, dict) or not isinstance(v.get("messageformat"), str): continue
            m = v["messageformat"]
            if not WORD.search(m): continue
            kind = classify(m)
            if kind != "rename":
                todo.append(f"{kind}\t{p.parent.name}\t{k}\t{m[:120]}"); counts[kind] += 1; continue
            v["messageformat"] = WORD.sub(NEW, m); changed += 1
        counts["rename"] += changed
        if changed and not a.check:
            p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"); files += 1
    print(f"rename={counts['rename']} url={counts['url']} org={counts['org']} protocol={counts['protocol']} files_written={files}")
    if not a.check:
        out = ROOT / "build" / "tellomi-strings-todo.txt"; out.parent.mkdir(exist_ok=True)
        out.write_text("\n".join(todo) + "\n", encoding="utf-8"); print(f"待人定的条目：{out}（{len(todo)} 条）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

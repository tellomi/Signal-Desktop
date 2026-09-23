#!/usr/bin/env python3
"""Tellomi: rewrite user-facing Signal web links (download / support / legal) to tellomi.app. Idempotent; rerun after every
upstream rebase. Deep links (signal.me / .group / .art / .link → tell.cc) are handled in ts/util/signalRoutes.std.ts, not here.
Test fixtures (ts/test-*, *_test*, *.stories.*) are left alone: they exercise upstream parsing rules.

  python3 scripts/tellomi/rename-links.py          # apply
  python3 scripts/tellomi/rename-links.py --check  # list remaining user-facing signal.* links, exit 1 if any
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RULES = [
    (re.compile(r"https://signal\.org/download/?"), "https://tellomi.app/download/"),
    (re.compile(r"https://support\.signal\.org/beta"), "https://tellomi.app/download/"),
    # help-center articles: keep the article id so the website can map each one to our own page (or redirect to /help/)
    (re.compile(r"https://support\.signal\.org/hc/(?:[a-z-]+/)?articles/(\d+)[A-Za-z0-9-]*(#[A-Za-z0-9_-]+)?/?"), r"https://tellomi.app/help/\1\2"),
    (re.compile(r"https://support\.signal\.org/hc/requests/new\?desktop"), "https://tellomi.app/support/"),
    (re.compile(r"https://support\.signal\.org/hc/"), "https://tellomi.app/support/"),
    (re.compile(r"https://signal\.org/legal/?"), "https://tellomi.app/legal/"),
    (re.compile(r"https://updates2\.signal\.org/static/badges/"), "https://updates.tellomi.app/static/badges/"),
    # Scheme-less text and e-mail addresses (#1045). Every rule above requires `https://`, and so did the
    # --check regex below -- so the two user-visible strings that spell the host WITHOUT a scheme
    # ("Click to go to signal.org/download", "Please email support@signal.org") matched nothing and
    # --check still printed "no user-facing signal.org links left". They shipped in 0.1.8, in all 68 locales.
    # Keep these LAST: the https:// rules above have already rewritten the real links by this point.
    # The look-behind lists ASCII explicitly instead of `\w`, for the same reason rename-strings.py
    # avoids `\b`: Python's `\w` includes CJK, and zh-HK / zh-Hant write "點擊進入signal.org/download"
    # with no space -- `(?<!\w)` would silently skip two of the five languages we actually ship.
    (re.compile(r"(?<![/@A-Za-z0-9._-])signal\.org/download/?"), "tellomi.app/download"),
    (re.compile(r"support@signal\.org"), "support@tellomi.app"),
]
SKIP = re.compile(r"(^|/)(test-[a-z]+|test|node_modules|release|build)/|_test\.|\.stories\.|signalRoutes\.std\.ts$")

def files():
    for base in ("ts", "app", "_locales"):
        for d, _, fs in os.walk(os.path.join(ROOT, base)):
            for f in fs:
                p = os.path.join(d, f)
                if SKIP.search(p.replace(ROOT + "/", "")):
                    continue
                if f.endswith((".ts", ".tsx", ".json", ".html")):
                    yield p

check = "--check" in sys.argv
changed = 0; remaining = []
for p in files():
    s = open(p, encoding="utf-8").read(); t = s
    for rx, rep in RULES:
        t = rx.sub(rep, t)
    if check:
        # Two patterns, not one. The first is the original (a scheme makes it a link, whatever the host).
        # The second is why 0.1.8 shipped with signal.org in five languages (#1045): requiring `https://`
        # hid both "Click to go to signal.org/download" and "Please email support@signal.org", and this
        # check printed "no user-facing signal.org links left" the whole time.
        # The scheme-less pattern deliberately requires a path (`signal.org/...`) or an `@`, so that bare
        # infrastructure hosts (chat/storage/cdn*.signal.org in createHTTPSAgent, preconnect) stay out of
        # it -- those are endpoints, not links, and they have their own checks.
        for rx in (r"https?://[A-Za-z0-9./_-]*signal\.org[A-Za-z0-9./_?=#-]*",
                   r"(?<![A-Za-z0-9._-])signal\.org/[A-Za-z0-9./_?=#-]*",
                   r"[A-Za-z0-9._%+-]+@signal\.org"):
            for m in re.finditer(rx, t):
                remaining.append(f"{os.path.relpath(p, ROOT)}: {m.group(0)}")
    elif t != s:
        open(p, "w", encoding="utf-8").write(t); changed += 1
if check:
    print("\n".join(remaining) or "no user-facing signal.org links left"); sys.exit(1 if remaining else 0)
print(f"rewrote {changed} files")

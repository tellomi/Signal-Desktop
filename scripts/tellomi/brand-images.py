#!/usr/bin/env python3
"""Tellomi: 把超级仓库 scripts/brand/make-icons.py 的产物接到 Desktop 的 images/（品牌插画 / 托盘底图 / Linux 窗口图标 / 错误图标）。

    ~/.nexi/brand-venv/bin/python scripts/tellomi/brand-images.py <make-icons 产物目录> [--repo <超级仓库根>]
    然后：pnpm run build:tray-icons   # 用新的 base PNG 重生成 alert 角标版

映射（谁用见文件名旁的注释）：
  images/signal-logo.svg               ← docs/brand/logo.svg           CSS mask（开屏 / 偏好页），只用形状
  images/signal-logo-and-wordmark.svg  ← wordmark/lockup.svg            CSS mask（配对页左上角标 + 字标）
  images/signal-logo-with-text.svg     ← lockup.svg，fill 写死墨色      <img>（独立注册页，不走 mask）
  images/signal-login.svg              ← 圆角矩形 + 白标                <img>（账号密钥说明页的小插画）
  images/titlebar_icon.svg             ← logo.svg（当前无人引用）
  images/signal-logo-desktop-linux.png ← desktop/png/512x512.png        Linux 窗口图标
  images/app-icon-with-error.png       ← 128 图标 + 右下红点             致命错误对话框
  images/tray-icons/base/*.png         ← 16/32/48/256 圆角图标          托盘底图（再跑 build:tray-icons）
"""
import argparse, re, shutil, sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parents[2]
INK_DARK, BG_DARK = "#111113", "#17171A"


def svg_resize(src: Path, width: int, height: int) -> str:
    s = src.read_text(encoding="utf-8")
    s = re.sub(r'\swidth="[^"]*"', f' width="{width}"', s, count=1)
    s = re.sub(r'\sheight="[^"]*"', f' height="{height}"', s, count=1)
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out"); ap.add_argument("--repo", default=str(HERE.parents[1]))
    a = ap.parse_args()
    out = Path(a.out); repo = Path(a.repo); img = HERE / "images"
    logo = repo / "docs/brand/logo.svg"; lockup = out / "wordmark/lockup.svg"
    for p in (logo, lockup, out / "desktop/png/512x512.png", out / "desktop/png/256x256.png"):
        if not p.exists():
            sys.exit(f"缺 {p}")

    (img / "signal-logo.svg").write_text(svg_resize(logo, 128, 128), encoding="utf-8")
    (img / "titlebar_icon.svg").write_text(svg_resize(logo, 32, 32), encoding="utf-8")
    (img / "signal-logo-and-wordmark.svg").write_text(svg_resize(lockup, 560, 155), encoding="utf-8")
    (img / "signal-logo-with-text.svg").write_text(svg_resize(lockup, 115, 32).replace("currentColor", INK_DARK), encoding="utf-8")

    # signal-login.svg：98×56 圆角矩形（品牌底色）+ 白色标居中（用 <image> 内联 PNG 太大，改用 logo 路径缩放）
    logo_svg = logo.read_text(encoding="utf-8")
    paths = re.search(r"<g[^>]*>(.*)</g>", logo_svg, re.S).group(1)
    (img / "signal-login.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="98" height="56" viewBox="0 0 98 56" fill="none">'
        f'<rect width="98" height="56" rx="8" fill="{BG_DARK}"/>'
        f'<g fill="#FFFFFF" fill-rule="evenodd" transform="translate(31 10) scale(0.03516)">{paths}</g></svg>\n', encoding="utf-8")

    shutil.copy(out / "desktop/png/512x512.png", img / "signal-logo-desktop-linux.png")

    # 代码里内联的标：配对二维码中心（BrandedQRCode）用 ts/components/tellomiMark.std.ts
    (HERE / "ts/components/tellomiMark.std.ts").write_text(
        "// Tellomi 品牌标（docs/brand/logo.svg，viewBox 0 0 1024 1024，fill-rule evenodd）。\n"
        "// 由 clients/desktop/scripts/tellomi/brand-images.py 生成，不要手改；换标只换 logo.svg 再跑一次。\n"
        "export const TELLOMI_MARK_SIZE = 1024;\n"
        "export const TELLOMI_MARK_PATHS: ReadonlyArray<string> = [\n"
        + "".join("  '" + d.replace("'", "\\'") + "',\n" for d in re.findall(r'<path d="([^"]+)"', logo_svg))
        + "];\n", encoding="utf-8")

    # 安全提示插画里画着 Signal 标的那一张（safety-tip-dont-respond.svg：圆里的 #566b98 路径）→ 换成 Tellomi 标
    tip = img / "safety-tips/safety-tip-dont-respond.svg"
    t = tip.read_text(encoding="utf-8")
    t2 = re.sub(r'<path fill="#566b98" d="[^"]*"[^>]*/>',
                f'<g fill="#566b98" fill-rule="evenodd" transform="translate(96 69) scale(0.04297)">{paths}</g>', t, count=1)
    if t2 != t:
        tip.write_text(t2, encoding="utf-8")

    err = Image.open(out / "desktop/png/128x128.png").convert("RGBA")
    d = ImageDraw.Draw(err); d.ellipse((84, 84, 124, 124), fill="#E53935", outline="#FFFFFF", width=4)
    d.rounded_rectangle((101, 92, 107, 110), radius=2, fill="#FFFFFF"); d.ellipse((100, 113, 108, 121), fill="#FFFFFF")
    err.save(img / "app-icon-with-error.png")

    base = img / "tray-icons/base"
    for px in (16, 32, 48, 256):
        shutil.copy(out / f"desktop/png/{px}x{px}.png", base / f"signal-tray-icon-{px}x{px}-base.png")
    print("images 更新完成；接着跑 pnpm run build:tray-icons")
    return 0


if __name__ == "__main__":
    sys.exit(main())

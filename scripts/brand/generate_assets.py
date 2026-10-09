#!/usr/bin/env python3
"""
Genera los recursos de marca (ícono y splash) de Luni Cliente y Luni Studio.

Salida en apps/<app>/assets/, que es lo que lee @capacitor/assets:
  icon-only.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png

Uso (desde la raíz, tras `npm install`):
  pip install pillow fonttools
  python scripts/brand/generate_assets.py

Las tipografías salen de los paquetes Fontsource ya instalados (woff -> ttf en memoria).
"""
import io
import math
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "node_modules" / "@fontsource"
SS = 2  # supersampling para bordes suaves

PALETTE = {
    "cream": "#fffdf9",
    "ink": "#443637",
    "plum": "#5a3d40",
    "rose": "#e9c8c8",
    "rose_deep": "#b8797e",
    "gold": "#c9ab75",
}

APPS = {
    "client": {
        "icon_bg": PALETTE["rose"], "ring": PALETTE["cream"], "letter": PALETTE["plum"], "star": PALETTE["cream"],
        "splash_bg": PALETTE["cream"], "splash_ring": "#d7b5a2", "splash_letter": PALETTE["rose_deep"],
        "splash_star": "#b59a68", "splash_text": "#6f4549", "splash_sub": "#6f615d",
        "dark_bg": "#3a2c2d", "dark_ring": "#8a6a63", "dark_letter": PALETTE["rose"], "dark_star": PALETTE["gold"],
        "dark_text": "#f1dcd8", "dark_sub": "#c9b2ac",
        "sub": "TU MOMENTO, TU ESTILO",
    },
    "provider": {
        "icon_bg": PALETTE["plum"], "ring": PALETTE["gold"], "letter": PALETTE["cream"], "star": PALETTE["gold"],
        "splash_bg": PALETTE["plum"], "splash_ring": PALETTE["gold"], "splash_letter": PALETTE["cream"],
        "splash_star": PALETTE["gold"], "splash_text": PALETTE["cream"], "splash_sub": "#e3cfc6",
        "dark_bg": PALETTE["ink"], "dark_ring": PALETTE["gold"], "dark_letter": PALETTE["cream"], "dark_star": PALETTE["gold"],
        "dark_text": PALETTE["cream"], "dark_sub": "#d9c4bb",
        "sub": "STUDIO",
    },
}


def load_font(package: str, filename: str, size: int) -> ImageFont.FreeTypeFont:
    font = TTFont(FONTS / package / "files" / filename)
    font.flavor = None
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


def serif_italic(size: int):
    return load_font("playfair-display", "playfair-display-latin-500-italic.woff", size)


def sans_semibold(size: int):
    return load_font("dm-sans", "dm-sans-latin-600-normal.woff", size)


def star_points(cx, cy, r_outer, r_inner=None):
    r_inner = r_inner or r_outer * 0.34
    pts = []
    for i in range(8):
        r = r_outer if i % 2 == 0 else r_inner
        a = -math.pi / 2 + i * math.pi / 4
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_mark(draw, cx, cy, d, ring, letter, star):
    """Monograma de Luni: anillo, «l» cursiva en serif y destello."""
    w = max(2, round(d * 0.028))
    draw.ellipse([cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2], outline=ring, width=w)
    font = serif_italic(round(d * 0.80))
    l, t, r, b = font.getbbox("l")
    draw.text((cx - (l + r) / 2, cy - (t + b) / 2), "l", font=font, fill=letter)
    sx, sy = cx + d * 0.255, cy - d * 0.255
    draw.polygon(star_points(sx, sy, d * 0.085), fill=star)


def new_canvas(size, bg=None):
    mode = "RGBA"
    return Image.new(mode, (size * SS, size * SS), bg or (0, 0, 0, 0))


def finish(img, size, path, flatten=None):
    out = img.resize((size, size), Image.LANCZOS)
    if flatten:
        base = Image.new("RGB", (size, size), flatten)
        base.paste(out, mask=out.split()[3])
        out = base
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, optimize=True)


def make_icons(cfg, out):
    size = 1024
    # ícono legado (cuadrado a sangre)
    img = new_canvas(size, cfg["icon_bg"])
    draw_mark(ImageDraw.Draw(img), size * SS / 2, size * SS / 2, 640 * SS, cfg["ring"], cfg["letter"], cfg["star"])
    finish(img, size, out / "icon-only.png", flatten=cfg["icon_bg"])
    # primer plano adaptativo: la zona segura es ~66% del lienzo
    img = new_canvas(size)
    draw_mark(ImageDraw.Draw(img), size * SS / 2, size * SS / 2, 560 * SS, cfg["ring"], cfg["letter"], cfg["star"])
    finish(img, size, out / "icon-foreground.png")
    # fondo adaptativo
    finish(new_canvas(size, cfg["icon_bg"]), size, out / "icon-background.png", flatten=cfg["icon_bg"])


def centered_text(draw, cx, y, text, font, fill, tracking=0):
    widths = [font.getlength(ch) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, wd in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill, anchor="ls")
        x += wd + tracking


def make_splash(cfg, out, name, bg, ring, letter, star, text, sub):
    size = 2732
    img = new_canvas(size, bg)
    d = ImageDraw.Draw(img)
    cx = size * SS / 2
    draw_mark(d, cx, 1090 * SS, 560 * SS, ring, letter, star)
    centered_text(d, cx, 1650 * SS, "luni", serif_italic(300 * SS), text)
    centered_text(d, cx, 1790 * SS, cfg["sub"], sans_semibold(58 * SS), sub, tracking=18 * SS)
    finish(img, size, out / name, flatten=bg)


def main():
    for app, cfg in APPS.items():
        out = ROOT / "apps" / app / "assets"
        make_icons(cfg, out)
        make_splash(cfg, out, "splash.png", cfg["splash_bg"], cfg["splash_ring"], cfg["splash_letter"],
                    cfg["splash_star"], cfg["splash_text"], cfg["splash_sub"])
        make_splash(cfg, out, "splash-dark.png", cfg["dark_bg"], cfg["dark_ring"], cfg["dark_letter"],
                    cfg["dark_star"], cfg["dark_text"], cfg["dark_sub"])
        print("ok", out.relative_to(ROOT))


if __name__ == "__main__":
    main()

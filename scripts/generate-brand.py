#!/usr/bin/env python3
"""Generate Recurday's rainbow mark, app icons, favicon, and og.png.

Run from the repo root:  python3 scripts/generate-brand.py
Uses only the local palette — no network, no paid tools.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"

# Full spectrum, slightly softened so it stays warm and family-friendly.
RAINBOW = [
    "#e4452e",  # red
    "#f07812",  # orange
    "#efc100",  # yellow
    "#2fa24c",  # green
    "#2b7de1",  # blue
    "#4b3cb8",  # indigo
    "#8d2db5",  # violet
]
PAPER = "#f6efe4"
INK = "#2a2318"
MUTED = "#5a5146"

SERIF = Path("/usr/share/fonts/truetype/sand-box/custom/Source Serif Pro/SourceSerifPro-Bold.ttf")
SANS = Path("/usr/share/fonts/truetype/sand-box/google/Source Sans 3/SourceSans3-VariableFont_wght.ttf")


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_rainbow_arc(
    img: Image.Image,
    cx: float,
    cy: float,
    r_outer: float,
    r_inner: float,
    start_deg: float = 200,
    end_deg: float = 340,
    width_scale: float = 1.0,
) -> None:
    """Paint 7 concentric arcs. Coordinates are in the image's pixel space."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    bands = len(RAINBOW)
    for i, color in enumerate(RAINBOW):
        r_out = lerp(r_outer, r_inner, i / bands)
        r_in = lerp(r_outer, r_inner, (i + 1) / bands)
        # A little overlap so downsampling does not leave hairline gaps.
        width = max(1, int(round((r_out - r_in) * width_scale)) + 2)
        radius = (r_out + r_in) / 2
        bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
        d.arc(bbox, start=start_deg, end=end_deg, fill=color, width=width)
    if img.mode == "RGBA":
        img.alpha_composite(overlay)
    else:
        base = img.convert("RGBA")
        base.alpha_composite(overlay)
        img.paste(base.convert(img.mode))


def make_icon(size: int, padding: float, path: Path) -> None:
    scale = 8
    S = size * scale
    pad = S * padding
    img = Image.new("RGB", (S, S), PAPER)
    # Semicircle rainbow, bounding box centered in the padded square.
    r_outer = (S - 2 * pad) / 2
    # Leave a generous inner hole so the arc reads clearly at small sizes.
    r_inner = r_outer * 0.42
    cx = S / 2
    # Vertically center the arc's bounding box (top = cy - r_outer, bottom = cy at the endpoints of a 180° arc).
    # Use a slightly open arc (200–340) which is shorter; adjust cy so the painted arc sits in the middle.
    start, end = 200, 340
    # Endpoints sit at these angles (PIL: 0 is east, clockwise? PIL/ImageDraw: 0 is 3 o'clock, increasing clockwise).
    # PIL angles: 0 is east, 90 is south, 180 is west, 270 is north. So a rainbow uses 180–360 (west, north, east)
    # or a tighter 200–340.
    start, end = 200, 340
    cy = S / 2 + r_outer * 0.38
    draw_rainbow_arc(img, cx, cy, r_outer, r_inner, start, end)
    out = img.resize((size, size), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")


def make_mark_svg(path: Path) -> None:
    # Tight crop around a 200–340° arc. viewBox fits the painted strokes.
    vb_w, vb_h = 72, 42
    cx, cy = 36, 40
    r_outer, r_inner = 34, 14
    bands = len(RAINBOW)
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 42" fill="none" aria-hidden="true">',
    ]
    for i, color in enumerate(RAINBOW):
        r_out = lerp(r_outer, r_inner, i / bands)
        r_in = lerp(r_outer, r_inner, (i + 1) / bands)
        r = (r_out + r_in) / 2
        w = r_out - r_in
        # Angles in SVG: we'll use math (0 east, counter-clockwise, y-up) then flip y.
        # 200–340° in PIL clockwise from east = from 200° clockwise to 340°.
        # PIL 200° is 200 clockwise from east = 20° south of west, i.e. a bit below the west point.
        # Easier: match the icons with a path A command from start to end, going the long/short way.
        # For a rainbow we want the upper arc: from the left endpoint to the right, through the top.
        # In a y-down SVG with standard trig if we use:
        #   x = cx + r * cos(theta), y = cy + r * sin(theta)
        # and theta clockwise from east (same as PIL), then 200° → 340° through 270° (north, smaller y? 
        # 270 clockwise from east is north? East=0, clockwise: 90=south, 180=west, 270=north. Yes.
        # 200 to 340 clockwise goes 200, 270 (north), 340 — that's the upper short arc. Good.

        def pt(deg: float) -> tuple[float, float]:
            rad = math.radians(deg)
            return cx + r * math.cos(rad), cy + r * math.sin(rad)

        x1, y1 = pt(200)
        x2, y2 = pt(340)
        # sweep flag: clockwise in SVG y-down. From 200 to 340 clockwise is a minor arc (~140°).
        # SVG flags: large-arc=0 (140 < 180), sweep=1 (positive/clockwise in y-down? 
        # In SVG, sweep=1 is positive angle, which is clockwise because y is down.
        parts.append(
            f'  <path d="M {x1:.3f} {y1:.3f} A {r:.3f} {r:.3f} 0 0 1 {x2:.3f} {y2:.3f}" '
            f'stroke="{color}" stroke-width="{w:.3f}" stroke-linecap="butt"/>'
        )
    parts.append("</svg>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts) + "\n")
    print(f"wrote {path.relative_to(ROOT)}")


def rounded_rect_mask(size: tuple[int, int], inset: int, radius: int, thickness: int) -> Image.Image:
    w, h = size
    outer = Image.new("L", size, 0)
    inner = Image.new("L", size, 0)
    od = ImageDraw.Draw(outer)
    idr = ImageDraw.Draw(inner)
    od.rounded_rectangle([inset, inset, w - 1 - inset, h - 1 - inset], radius=radius, fill=255)
    idr.rounded_rectangle(
        [inset + thickness, inset + thickness, w - 1 - inset - thickness, h - 1 - inset - thickness],
        radius=max(0, radius - thickness),
        fill=255,
    )
    # frame = outer - inner
    return Image.composite(outer, Image.new("L", size, 0), ImageChops_subtract(outer, inner))


def ImageChops_subtract(a: Image.Image, b: Image.Image) -> Image.Image:
    from PIL import ImageChops
    return ImageChops.subtract(a, b)


def make_og(path: Path) -> None:
    W, H = 1200, 630
    scale = 2
    w, h = W * scale, H * scale
    img = Image.new("RGB", (w, h), PAPER)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay, "RGBA")

    def rgba(hex_color: str, alpha: int) -> tuple[int, int, int, int]:
        hex_color = hex_color.lstrip("#")
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return (r, g, b, alpha)

    # Soft rainbow-tinted circles, same composition as the previous og.png but with spectrum accents.
    d.ellipse([int(-0.18 * w), int(-0.45 * h), int(0.48 * w), int(0.85 * h)], fill=rgba("#e4452e", 28))
    d.ellipse([int(0.55 * w), int(0.25 * h), int(1.22 * w), int(1.45 * h)], fill=rgba("#2b7de1", 26))
    d.ellipse([int(0.62 * w), int(-0.35 * h), int(1.15 * w), int(0.45 * h)], fill=rgba("#8d2db5", 18))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))

    # Rainbow rounded frame via concentric rounded rectangles.
    inset = int(72 * scale)
    radius = int(8 * scale)
    thickness = max(3 * scale, 4)
    band = max(2, thickness // 1)
    # 7 adjacent rounded-rect strokes from outside in, each `band` thick, total ~ 7*band
    from PIL import ImageChops

    for i, color in enumerate(RAINBOW):
        off = inset + i * band
        rad = max(2, radius - i * band)
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        mask_outer = Image.new("L", (w, h), 0)
        mask_inner = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask_outer).rounded_rectangle(
            [off, off, w - 1 - off, h - 1 - off], radius=rad, fill=255
        )
        ImageDraw.Draw(mask_inner).rounded_rectangle(
            [off + band, off + band, w - 1 - off - band, h - 1 - off - band],
            radius=max(0, rad - band),
            fill=255,
        )
        frame = ImageChops.subtract(mask_outer, mask_inner)
        color_img = Image.new("RGBA", (w, h), color + "FF")
        layer.paste(color_img, mask=frame)
        img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

    # Small rainbow arc above the title.
    arc_cx, arc_cy = w / 2, int(232 * scale)
    draw_rainbow_arc(img, arc_cx, arc_cy, r_outer=int(78 * scale), r_inner=int(36 * scale), start_deg=200, end_deg=340)

    draw = ImageDraw.Draw(img)
    serif = ImageFont.truetype(str(SERIF), int(118 * scale))
    # Source Sans 3 variable: set a medium weight if possible.
    try:
        sans = ImageFont.truetype(str(SANS), int(40 * scale))
    except OSError:
        sans = ImageFont.truetype(str(SANS), int(40 * scale))

    title = "Recurday"
    tag = "Your family's own special days."
    # Center text
    tb = draw.textbbox((0, 0), title, font=serif)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = (w - tw) / 2 - tb[0]
    ty = int(268 * scale)
    draw.text((tx, ty), title, font=serif, fill=INK)

    gb = draw.textbbox((0, 0), tag, font=sans)
    gw, gh = gb[2] - gb[0], gb[3] - gb[1]
    gx = (w - gw) / 2 - gb[0]
    gy = ty + th + int(22 * scale)
    draw.text((gx, gy), tag, font=sans, fill=MUTED)

    out = img.resize((W, H), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({W}x{H})")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    make_mark_svg(ICONS / "mark.svg")
    make_icon(192, padding=0.14, path=ICONS / "icon-192.png")
    make_icon(512, padding=0.14, path=ICONS / "icon-512.png")
    # Maskable: important content inside the center 80% safe zone.
    make_icon(192, padding=0.22, path=ICONS / "icon-192-maskable.png")
    make_icon(512, padding=0.22, path=ICONS / "icon-512-maskable.png")
    make_icon(180, padding=0.14, path=PUBLIC / "apple-touch-icon.png")
    make_icon(64, padding=0.12, path=PUBLIC / "favicon.png")
    make_og(PUBLIC / "og.png")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate Recurday's rainbow mark, app icons, favicon, and og.png.

Home-screen icons (144px and up) show a rainbow over the word Recurday,
with a house at the left foot and a heart at the right foot.
Tiny favicons (48px and under) stay a rainbow-only mark, because the
house and heart will not read at that size.

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
PAPER = "#ffffff"
INK = "#2a2318"
MUTED = "#5a5146"

# Original emoji-like house and heart palette. Drawn as our own vectors;
# not copied from Apple, Google, Twemoji, or any other vendor artwork.
HOUSE_WALL = "#f0d9b0"
HOUSE_ROOF = "#d24c38"
HOUSE_ROOF_SHADE = "#a83a2c"
HOUSE_CHIMNEY_CAP = "#8f3228"
HOUSE_DOOR = "#7a4a28"
HOUSE_KNOB = "#e8c98a"
HOUSE_WINDOW = "#8ec8ea"
HOUSE_OUTLINE = "#4a3026"
HEART = "#ee4a58"
HEART_OUTLINE = "#8c2832"
HEART_SHINE = "#ffd4d8"

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


# Geometry of the 200–340° rainbow arc, in units of r_outer.
# Width spans both endpoints; height is the top of the outer arc down to those endpoints.
_ARC_WIDTH_K = 2 * abs(math.cos(math.radians(200)))
_ARC_HEIGHT_K = 1 - abs(math.sin(math.radians(200)))
_SIN20 = abs(math.sin(math.radians(200)))
_COS20 = abs(math.cos(math.radians(200)))
# House and heart height, as a fraction of the outer rainbow radius.
_EMBLEM_K = 0.36


def hex_rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def foot_xy(cx: float, cy: float, radius: float, deg: float) -> tuple[float, float]:
    rad = math.radians(deg)
    return cx + radius * math.cos(rad), cy + radius * math.sin(rad)


def emblem_size(r_outer: float) -> float:
    return r_outer * _EMBLEM_K


def emblem_placement(cx: float, cy: float, r_outer: float, r_inner: float, size: float):
    """House at the left foot, heart at the right, standing just past the ends."""
    r_mid = (r_outer + r_inner) / 2
    lx, _ = foot_xy(cx, cy, r_mid, 200)
    rx, _ = foot_xy(cx, cy, r_mid, 340)
    _, ly_in = foot_xy(cx, cy, r_inner, 200)
    _, ry_in = foot_xy(cx, cy, r_inner, 340)
    ground = max(ly_in, ry_in) + size * 0.12
    shift = size * 0.12
    return {
        "ground": ground,
        "house_cx": lx - shift,
        "heart_cx": rx + shift,
        "heart_cy": ground - size / 2,
        "size": size,
    }


def space_below_outer_feet(r_outer: float, r_inner: float, size: float, pad: float) -> float:
    """How far the standing emblems hang below the outer (higher) rainbow feet."""
    inner_drop = _SIN20 * (r_outer - r_inner)
    return inner_drop + size * 0.12 + pad


def heart_points(cx: float, cy: float, size: float, steps: int = 96) -> list[tuple[float, float]]:
    """Classic heart curve, scaled so its height is size and centered at (cx, cy)."""
    raw: list[tuple[float, float]] = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        raw.append((x, y))
    xs = [p[0] for p in raw]
    ys = [p[1] for p in raw]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    scale = size / (maxy - miny)
    ox, oy = (minx + maxx) / 2, (miny + maxy) / 2
    return [(cx + (x - ox) * scale, cy + (y - oy) * scale) for x, y in raw]


def _expand_rect(rect: tuple[float, float, float, float], o: float) -> list[float]:
    x0, y0, x1, y1 = rect
    return [x0 - o, y0 - o, x1 + o, y1 + o]


def _expand_poly(pts: list[tuple[float, float]], o: float) -> list[tuple[float, float]]:
    """Grow a polygon slightly from its centroid, for a soft outline under the fill."""
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    out: list[tuple[float, float]] = []
    for x, y in pts:
        dx, dy = x - mx, y - my
        length = math.hypot(dx, dy) or 1
        out.append((x + o * dx / length, y + o * dy / length))
    return out


def house_geom(cx: float, baseline_y: float, size: float) -> dict:
    """Original house geometry: cream walls, terracotta roof, chimney, door, window.

    size is the height from the chimney top down to the ground.
    """
    body_w = size * 0.80
    body_h = size * 0.52
    body_left = cx - body_w / 2
    body_right = cx + body_w / 2
    body_top = baseline_y - body_h

    roof_w = size * 1.16
    eave_y = body_top + size * 0.055
    peak = (cx, baseline_y - size * 0.90)
    left_eave = (cx - roof_w / 2, eave_y)
    right_eave = (cx + roof_w / 2, eave_y)
    fascia_h = size * 0.075
    fascia = [
        left_eave,
        right_eave,
        (right_eave[0] - size * 0.025, eave_y + fascia_h),
        (left_eave[0] + size * 0.025, eave_y + fascia_h),
    ]
    roof = [peak, left_eave, right_eave]

    # Chimney on the right roof slope, drawn first so the roof covers its base.
    ch_w = size * 0.17
    t = 0.62
    roof_x = peak[0] + (right_eave[0] - peak[0]) * t
    roof_y = peak[1] + (right_eave[1] - peak[1]) * t
    ch_left = roof_x - ch_w * 0.35
    ch_right = ch_left + ch_w
    ch_top = baseline_y - size
    ch_bottom = roof_y + size * 0.06
    cap_h = size * 0.07
    cap_over = size * 0.035
    cap = (ch_left - cap_over, ch_top, ch_right + cap_over, ch_top + cap_h)

    door_w = body_w * 0.28
    door_h = body_h * 0.62
    door_cx = cx + body_w * 0.12
    door = (door_cx - door_w / 2, baseline_y - door_h, door_cx + door_w / 2, baseline_y)
    knob_r = size * 0.028
    knob = (door_cx + door_w * 0.22, baseline_y - door_h * 0.50, knob_r)

    win = body_w * 0.26
    win_cx = cx - body_w * 0.18
    win_cy = body_top + body_h * 0.40
    window = (win_cx - win / 2, win_cy - win / 2, win_cx + win / 2, win_cy + win / 2)

    outline_w = max(size * 0.055, 1.0)
    return {
        "body": (body_left, body_top, body_right, baseline_y),
        "roof": roof,
        "fascia": fascia,
        "chimney": (ch_left, ch_top, ch_right, ch_bottom),
        "cap": cap,
        "door": door,
        "door_radius": size * 0.045,
        "knob": knob,
        "window": window,
        "win_radius": size * 0.03,
        "outline_w": outline_w,
        "min_x": min(left_eave[0], cap[0]) - outline_w / 2,
        "max_x": max(right_eave[0], cap[2]) + outline_w / 2,
        "min_y": min(ch_top, cap[1]) - outline_w / 2,
        "max_y": baseline_y + outline_w / 2,
    }


def draw_heart(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float) -> None:
    """Friendly heart with a soft outline and a small shine, to match the house."""
    outline_w = max(size * 0.055, 1.0)
    draw.polygon(heart_points(cx, cy, size + outline_w * 2), fill=hex_rgb(HEART_OUTLINE) + (255,))
    draw.polygon(heart_points(cx, cy, size), fill=hex_rgb(HEART) + (255,))
    hw, hh = size * 0.18, size * 0.14
    if hw >= 2:
        hx, hy = cx - size * 0.16, cy - size * 0.18
        draw.ellipse([hx - hw / 2, hy - hh / 2, hx + hw / 2, hy + hh / 2], fill=hex_rgb(HEART_SHINE) + (255,))


def draw_house(draw: ImageDraw.ImageDraw, cx: float, baseline_y: float, size: float) -> None:
    """A simple full-color house, standing on baseline_y, centered at cx."""
    g = house_geom(cx, baseline_y, size)
    o = g["outline_w"]
    outline = hex_rgb(HOUSE_OUTLINE) + (255,)
    # Soft outline: paint slightly larger copies of the outer shapes first.
    draw.rectangle(_expand_rect(g["chimney"], o), fill=outline)
    draw.rectangle(_expand_rect(g["cap"], o), fill=outline)
    draw.rectangle(_expand_rect(g["body"], o), fill=outline)
    draw.polygon(_expand_poly(g["roof"], o), fill=outline)
    draw.polygon(_expand_poly(g["fascia"], o), fill=outline)
    # Color fills, back to front.
    draw.rectangle(list(g["chimney"]), fill=hex_rgb(HOUSE_ROOF) + (255,))
    draw.rectangle(list(g["cap"]), fill=hex_rgb(HOUSE_CHIMNEY_CAP) + (255,))
    draw.rectangle(list(g["body"]), fill=hex_rgb(HOUSE_WALL) + (255,))
    draw.polygon(g["roof"], fill=hex_rgb(HOUSE_ROOF) + (255,))
    draw.polygon(g["fascia"], fill=hex_rgb(HOUSE_ROOF_SHADE) + (255,))
    x0, y0, x1, y1 = g["door"]
    r = g["door_radius"]
    draw.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=hex_rgb(HOUSE_DOOR) + (255,))
    # Keep the door square at the ground (only the top is rounded).
    draw.rectangle([x0, y0 + r, x1, y1], fill=hex_rgb(HOUSE_DOOR) + (255,))
    kx, ky, kr = g["knob"]
    if kr >= 0.8:
        draw.ellipse([kx - kr, ky - kr, kx + kr, ky + kr], fill=hex_rgb(HOUSE_KNOB) + (255,))
    wx0, wy0, wx1, wy1 = g["window"]
    draw.rounded_rectangle([wx0, wy0, wx1, wy1], radius=g["win_radius"], fill=hex_rgb(HOUSE_WINDOW) + (255,))
    # A small glass shine, not a pane cross (a cross reads like a medical mark at this size).
    shine = (wx1 - wx0) * 0.32
    if shine >= 1.6:
        sx0 = wx0 + (wx1 - wx0) * 0.14
        sy0 = wy0 + (wy1 - wy0) * 0.14
        draw.ellipse([sx0, sy0, sx0 + shine, sy0 + shine * 0.78], fill=(255, 255, 255, 200))


def paint_emblems(img: Image.Image, place: dict) -> None:
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    size = place["size"]
    draw_house(draw, place["house_cx"], place["ground"], size)
    draw_heart(draw, place["heart_cx"], place["heart_cy"], size)
    if img.mode == "RGBA":
        img.alpha_composite(overlay)
    else:
        base = img.convert("RGBA")
        base.alpha_composite(overlay)
        img.paste(base.convert(img.mode))


def _svg_rect(rect: tuple[float, float, float, float], fill: str, rx: float = 0) -> str:
    x0, y0, x1, y1 = rect
    rx_attr = f' rx="{rx:.3f}" ry="{rx:.3f}"' if rx else ""
    return f'<rect x="{x0:.3f}" y="{y0:.3f}" width="{x1 - x0:.3f}" height="{y1 - y0:.3f}" fill="{fill}"{rx_attr}/>'


def _svg_poly(pts: list[tuple[float, float]], fill: str) -> str:
    d = "M " + " L ".join(f"{x:.3f} {y:.3f}" for x, y in pts) + " Z"
    return f'<path d="{d}" fill="{fill}"/>'


def house_svg_paths(cx: float, baseline_y: float, size: float) -> list[str]:
    g = house_geom(cx, baseline_y, size)
    o = g["outline_w"]
    x0, y0, x1, y1 = g["door"]
    r = g["door_radius"]
    # Door path: rounded only at the top.
    door_path = (
        f'<path d="M {x0:.3f} {y1:.3f} L {x0:.3f} {y0 + r:.3f} '
        f'A {r:.3f} {r:.3f} 0 0 1 {x0 + r:.3f} {y0:.3f} '
        f'L {x1 - r:.3f} {y0:.3f} '
        f'A {r:.3f} {r:.3f} 0 0 1 {x1:.3f} {y0 + r:.3f} '
        f'L {x1:.3f} {y1:.3f} Z" fill="{HOUSE_DOOR}"/>'
    )
    kx, ky, kr = g["knob"]
    wx0, wy0, wx1, wy1 = g["window"]
    shine = (wx1 - wx0) * 0.32
    sx0 = wx0 + (wx1 - wx0) * 0.14
    sy0 = wy0 + (wy1 - wy0) * 0.14
    parts = [
        # Soft outline, same expanded shapes as the PNG.
        _svg_rect(_expand_rect(g["chimney"], o), HOUSE_OUTLINE),
        _svg_rect(_expand_rect(g["cap"], o), HOUSE_OUTLINE),
        _svg_rect(_expand_rect(g["body"], o), HOUSE_OUTLINE),
        _svg_poly(_expand_poly(g["roof"], o), HOUSE_OUTLINE),
        _svg_poly(_expand_poly(g["fascia"], o), HOUSE_OUTLINE),
        _svg_rect(g["chimney"], HOUSE_ROOF),
        _svg_rect(g["cap"], HOUSE_CHIMNEY_CAP),
        _svg_rect(g["body"], HOUSE_WALL),
        _svg_poly(g["roof"], HOUSE_ROOF),
        _svg_poly(g["fascia"], HOUSE_ROOF_SHADE),
        door_path,
        f'<circle cx="{kx:.3f}" cy="{ky:.3f}" r="{kr:.3f}" fill="{HOUSE_KNOB}"/>',
        _svg_rect(g["window"], HOUSE_WINDOW, rx=g["win_radius"]),
        (
            f'<ellipse cx="{sx0 + shine / 2:.3f}" cy="{sy0 + shine * 0.39:.3f}" '
            f'rx="{shine / 2:.3f}" ry="{shine * 0.39:.3f}" fill="#ffffff" fill-opacity="0.78"/>'
        ),
    ]
    return parts


def heart_svg_paths(cx: float, cy: float, size: float) -> list[str]:
    outline_w = max(size * 0.055, 0.4)
    def path(pts: list[tuple[float, float]], fill: str) -> str:
        d = "M " + " L ".join(f"{x:.3f} {y:.3f}" for x, y in pts) + " Z"
        return f'<path d="{d}" fill="{fill}"/>'
    hw, hh = size * 0.18, size * 0.14
    hx, hy = cx - size * 0.16, cy - size * 0.18
    return [
        path(heart_points(cx, cy, size + outline_w * 2, steps=48), HEART_OUTLINE),
        path(heart_points(cx, cy, size, steps=48), HEART),
        (
            f'<ellipse cx="{hx:.3f}" cy="{hy:.3f}" rx="{hw / 2:.3f}" ry="{hh / 2:.3f}" '
            f'fill="{HEART_SHINE}"/>'
        ),
    ]


def fit_title_font(text: str, max_width: int, max_size: int) -> ImageFont.FreeTypeFont:
    lo, hi = 1, max_size
    best = ImageFont.truetype(str(SERIF), 1)
    while lo <= hi:
        mid = (lo + hi) // 2
        font = ImageFont.truetype(str(SERIF), mid)
        box = font.getbbox(text)
        if box[2] - box[0] <= max_width:
            best = font
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def make_icon(
    size: int,
    padding: float,
    path: Path,
    label: bool = False,
    text_padding: float | None = None,
    emblems: bool = False,
) -> None:
    scale = 8
    S = size * scale
    pad = S * padding
    img = Image.new("RGB", (S, S), PAPER)
    start, end = 200, 340
    cx = S / 2

    if label or emblems:
        th = tw = 0
        font = box = None
        if label:
            title = "Recurday"
            text_side = S * (text_padding if text_padding is not None else padding)
            font = fit_title_font(title, int(S - 2 * text_side), int(S * 0.28))
            box = font.getbbox(title)
            tw, th = box[2] - box[0], box[3] - box[1]
        # First guess from width, then fit the stack into the padded square.
        r_guess = (S - 2 * pad) / _ARC_WIDTH_K
        e_guess = emblem_size(r_guess) if emblems else 0
        r_inner_guess = r_guess * 0.42
        below = space_below_outer_feet(r_guess, r_inner_guess, e_guess, S * 0.025) if emblems else max(S * 0.03, th * 0.28)
        text_part = (th + th * 0.18) if label else 0
        avail_h = S - 2 * pad
        r_outer = min((S - 2 * pad) / _ARC_WIDTH_K, (avail_h - below - text_part) / _ARC_HEIGHT_K)
        r_inner = r_outer * 0.42
        e_size = emblem_size(r_outer) if emblems else 0
        below = space_below_outer_feet(r_outer, r_inner, e_size, S * 0.025) if emblems else max(S * 0.03, th * 0.28)
        arc_h = r_outer * _ARC_HEIGHT_K
        stack_h = arc_h + below + text_part
        stack_top = max(pad, (S - stack_h) / 2)
        cy = stack_top + r_outer
        draw_rainbow_arc(img, cx, cy, r_outer, r_inner, start, end)
        if emblems:
            paint_emblems(img, emblem_placement(cx, cy, r_outer, r_inner, e_size))
        if label:
            draw = ImageDraw.Draw(img)
            text_top = stack_top + arc_h + below + th * 0.02
            draw.text(((S - tw) / 2 - box[0], text_top - box[1]), title, font=font, fill=INK)
    else:
        # Semicircle rainbow, bounding box centered in the padded square.
        r_outer = (S - 2 * pad) / 2
        # Leave a generous inner hole so the arc reads clearly at small sizes.
        r_inner = r_outer * 0.42
        # Vertically center the painted 200–340° arc in the square.
        # PIL angles: 0 is east, 90 is south, 180 is west, 270 is north.
        cy = S / 2 + r_outer * 0.38
        draw_rainbow_arc(img, cx, cy, r_outer, r_inner, start, end)

    out = img.resize((size, size), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")


def make_mark_svg(path: Path) -> tuple[int, int]:
    # Same rainbow as before, plus a house and a heart at the two feet.
    # viewBox is a tight crop around the painted strokes and emblems.
    cx, cy = 36, 40
    r_outer, r_inner = 34, 14
    e_size = emblem_size(r_outer)
    place = emblem_placement(cx, cy, r_outer, r_inner, e_size)
    bands = len(RAINBOW)
    arc_parts: list[str] = []
    min_x, min_y = 1e9, 1e9
    max_x, max_y = -1e9, -1e9

    def include(x: float, y: float) -> None:
        nonlocal min_x, min_y, max_x, max_y
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)

    for i, color in enumerate(RAINBOW):
        r_out = lerp(r_outer, r_inner, i / bands)
        r_in = lerp(r_outer, r_inner, (i + 1) / bands)
        r = (r_out + r_in) / 2
        w = r_out - r_in

        def pt(deg: float, radius: float = r) -> tuple[float, float]:
            rad = math.radians(deg)
            return cx + radius * math.cos(rad), cy + radius * math.sin(rad)

        x1, y1 = pt(200)
        x2, y2 = pt(340)
        xt, yt = pt(270)
        # Outer edge of this band, for the tight crop.
        for deg in (200, 270, 340):
            include(*pt(deg, r_out))
        arc_parts.append(
            f'  <path d="M {x1:.3f} {y1:.3f} A {r:.3f} {r:.3f} 0 0 1 {x2:.3f} {y2:.3f}" '
            f'stroke="{color}" stroke-width="{w:.3f}" stroke-linecap="butt"/>'
        )

    # House and heart bounds, including the chimney, eaves, and soft outlines.
    hg = house_geom(place["house_cx"], place["ground"], e_size)
    include(hg["min_x"], hg["min_y"])
    include(hg["max_x"], hg["max_y"])
    heart_outline = max(e_size * 0.055, 0.4)
    for x, y in heart_points(place["heart_cx"], place["heart_cy"], e_size + heart_outline * 2, steps=48):
        include(x, y)

    pad = 2.0
    vb_x = min_x - pad
    vb_y = min_y - pad
    vb_w = (max_x + pad) - vb_x
    vb_h = (max_y + pad) - vb_y
    # Snap to a tidy integer viewBox so width/height attributes stay simple.
    vx, vy = math.floor(vb_x), math.floor(vb_y)
    vw, vh = math.ceil(vb_x + vb_w) - vx, math.ceil(vb_y + vb_h) - vy

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx} {vy} {vw} {vh}" fill="none" aria-hidden="true">',
        *arc_parts,
    ]
    for line in house_svg_paths(place["house_cx"], place["ground"], e_size):
        parts.append("  " + line)
    for line in heart_svg_paths(place["heart_cx"], place["heart_cy"], e_size):
        parts.append("  " + line)
    parts.append("</svg>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts) + "\n")
    print(f"wrote {path.relative_to(ROOT)} (viewBox={vx} {vy} {vw} {vh})")
    return vw, vh


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

    # Small rainbow arc above the title, with a house and a heart at the feet.
    arc_cx, arc_cy = w / 2, int(226 * scale)
    r_outer = int(78 * scale)
    r_inner = int(36 * scale)
    draw_rainbow_arc(img, arc_cx, arc_cy, r_outer=r_outer, r_inner=r_inner, start_deg=200, end_deg=340)
    e_size = emblem_size(r_outer)
    place = emblem_placement(arc_cx, arc_cy, r_outer, r_inner, e_size)
    paint_emblems(img, place)

    draw = ImageDraw.Draw(img)
    serif = ImageFont.truetype(str(SERIF), int(118 * scale))
    # Source Sans 3 variable: set a medium weight if possible.
    try:
        sans = ImageFont.truetype(str(SANS), int(40 * scale))
    except OSError:
        sans = ImageFont.truetype(str(SANS), int(40 * scale))

    title = "Recurday"
    tag_lines = [
        "Creating family traditions.",
        "It was always about the small things.",
    ]
    # Center text, keeping a little air under the house and heart.
    tb = draw.textbbox((0, 0), title, font=serif)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = (w - tw) / 2 - tb[0]
    ty = max(int(250 * scale), int(place["ground"] + e_size * 0.2))
    draw.text((tx, ty), title, font=serif, fill=INK)

    gy = ty + th + int(20 * scale)
    for line in tag_lines:
        gb = draw.textbbox((0, 0), line, font=sans)
        gw, gh = gb[2] - gb[0], gb[3] - gb[1]
        gx = (w - gw) / 2 - gb[0]
        draw.text((gx, gy), line, font=sans, fill=MUTED)
        gy += gh + int(8 * scale)

    out = img.resize((W, H), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({W}x{H})")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    make_mark_svg(ICONS / "mark.svg")
    # Tiny favicons cannot hold a readable house and heart, so they stay a rainbow-only mark.
    for size in (16, 32, 48):
        pad = 0.12 if size <= 32 else 0.14
        make_icon(size, padding=pad, path=ICONS / f"icon-{size}.png")
    # 64 and 96 can hold the house and heart without the word.
    make_icon(64, padding=0.12, path=PUBLIC / "favicon.png", emblems=True)
    make_icon(96, padding=0.14, path=ICONS / "icon-96.png", emblems=True)
    # Home-screen icons: rainbow, house and heart, and the word Recurday.
    make_icon(144, padding=0.10, path=ICONS / "icon-144.png", label=True, emblems=True, text_padding=0.06)
    make_icon(180, padding=0.10, path=PUBLIC / "apple-touch-icon.png", label=True, emblems=True, text_padding=0.06)
    make_icon(192, padding=0.10, path=ICONS / "icon-192.png", label=True, emblems=True, text_padding=0.06)
    make_icon(512, padding=0.10, path=ICONS / "icon-512.png", label=True, emblems=True, text_padding=0.06)
    # Maskable: keep the word, house, and heart inside the center 80% safe zone.
    make_icon(192, padding=0.14, path=ICONS / "icon-192-maskable.png", label=True, emblems=True, text_padding=0.12)
    make_icon(512, padding=0.14, path=ICONS / "icon-512-maskable.png", label=True, emblems=True, text_padding=0.12)
    Image.open(ICONS / "icon-48.png").convert("RGBA").save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"wrote {(PUBLIC / 'favicon.ico').relative_to(ROOT)}")
    make_og(PUBLIC / "og.png")


if __name__ == "__main__":
    main()

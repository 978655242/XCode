"""Aiscoo brand assets, following Accio Work's system: heavy black letterform + glowing AI light."""
import math
from pathlib import Path

OUT = Path(__file__).parent
INK = "#121317"   # same near-black Accio uses
PAPER = "#FFFFFF"
STOPS = [(0, "#22D3EE"), (0.5, "#3B82F6"), (1, "#8B5CF6")]  # cyan -> blue -> violet


def grad(gid, glow=False):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in STOPS)
    g = f'<linearGradient id="{gid}" x1="0" y1="1" x2="1" y2="0">{s}</linearGradient>'
    if glow:
        g += ('<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">'
              '<feGaussianBlur stdDeviation="4"/></filter>')
    return g


def sparkle(cx, cy, R, fill, k=0.13):
    k = R * k
    return (f'<path d="M{cx} {cy-R}Q{cx+k} {cy-k} {cx+R} {cy}Q{cx+k} {cy+k} {cx} {cy+R}'
            f'Q{cx-k} {cy+k} {cx-R} {cy}Q{cx-k} {cy-k} {cx} {cy-R}Z" fill="{fill}"/>')


def mark(fg, gid, glow=False, spark_fill=None):
    """Heavy single-storey 'a'; the counter holds an AI sparkle, a smaller spark rides the stem."""
    cx, cy, r, sw = 43, 57, 26, 17
    body = (f'<g fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round">'
            f'<circle cx="{cx}" cy="{cy}" r="{r}"/><path d="M{cx+r} {cy-r}V{cy+r+sw/2-0.5}" '
            f'stroke-linecap="butt"/></g>'
            f'<rect x="{cx+r-sw/2}" y="{cy-r-sw/2}" width="{sw}" height="{sw}" rx="{sw/2}" fill="{fg}"/>')
    sf = spark_fill or f"url(#{gid})"
    halo = f'<g filter="url(#glow)" opacity="0.9">{sparkle(cx, cy, 16, sf)}</g>' if glow else ""
    spark = sparkle(cx, cy, 16, sf) + sparkle(cx + r + 13, cy - r - 13, 7.5, sf)
    return halo + body + spark


# ---------- wordmark: heavy geometric lowercase "aiscoo", i-dot = sparkle ----------
def wordmark(color, gid, sw=22, gap=16):
    r = 50 - sw / 2
    p, x = [], sw / 2
    cx = x + r
    p.append(f'<circle cx="{cx:.2f}" cy="50" r="{r:.2f}"/>')
    a_spark = sparkle(round(cx, 2), 50, r - sw / 2 - 3, f"url(#{gid})")
    sx = cx + r
    p.append(f'<path d="M{sx:.2f} 0V100" stroke-linecap="butt"/>')
    x = sx + sw + gap
    p.append(f'<path d="M{x:.2f} {sw/2:.2f}V100" stroke-linecap="butt"/>')
    p.append(f'<path d="M{x:.2f} {sw/2:.2f}V{sw/2+0.1:.2f}"/>')
    dot = a_spark + f'<circle cx="{x:.2f}" cy="-19" r="{sw*0.62:.2f}" fill="{color}"/>'
    x += sw + gap
    rs, rx = (100 - sw) / 4, (100 - sw) / 4 * 1.22
    cx = x + rx - sw / 2 + sw / 2
    a1, a2 = math.radians(-35), math.radians(145)
    ux, uy = cx + rx * math.cos(a1), sw / 2 + rs + rs * math.sin(a1)
    lx, ly = cx + rx * math.cos(a2), 100 - sw / 2 - rs + rs * math.sin(a2)
    p.append(f'<path d="M{ux:.2f} {uy:.2f}A{rx:.2f} {rs:.2f} 0 1 0 {cx:.2f} 50'
             f'A{rx:.2f} {rs:.2f} 0 1 1 {lx:.2f} {ly:.2f}"/>')
    x = cx + rx + sw + gap
    cx = x + r
    c1, c2 = (cx + r * math.cos(math.radians(-40)), 50 + r * math.sin(math.radians(-40))), \
             (cx + r * math.cos(math.radians(40)), 50 + r * math.sin(math.radians(40)))
    p.append(f'<path d="M{c1[0]:.2f} {c1[1]:.2f}A{r:.2f} {r:.2f} 0 1 0 {c2[0]:.2f} {c2[1]:.2f}"/>')
    x = cx + r + sw + gap - 4
    for _ in range(2):
        cx = x + r
        p.append(f'<circle cx="{cx:.2f}" cy="50" r="{r:.2f}"/>')
        x = cx + r + sw + gap
    width = x - gap - sw / 2
    g = (f'<g fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round">'
         f'{"".join(p)}</g>{dot}')
    return g, width


def svg(w, h, body, defs="", bg=None):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" '
            f'width="{w:.0f}" height="{h:.0f}"><defs>{defs}</defs>{rect}{body}</svg>\n')


def app_icon(dark=False):
    """macOS 1024 grid: 824 body, ~185 radius, like Accio's white squircle."""
    top, bot = ("#262A31", "#0E1013") if dark else ("#FFFFFF", "#F1F3F6")
    fg = PAPER if dark else INK
    body = ('<g filter="url(#shadow)"><rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/></g>'
            f'<rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" '
            f'stroke="{"#FFFFFF" if dark else "#000000"}" stroke-opacity="{0.1 if dark else 0.06}"/>'
            f'<g transform="translate(238 226) scale(5.6)">{mark(fg, "g", glow=True)}</g>')
    defs = grad("g", glow=True) + (
        f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
        f'<stop offset="1" stop-color="{bot}"/></linearGradient>'
        '<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">'
        '<feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity="0.22"/></filter>')
    return svg(1024, 1024, body, defs)


def lockup(fg, bg):
    wm, ww = wordmark(fg, "g")
    pad, h = 40, 200
    return svg(pad * 2 + ww, h, f'<g transform="translate({pad} {(h-100)/2+14})">{wm}</g>', grad("g"), bg)


def tray(fg):
    """Menu-bar template: solid silhouette, 22pt box."""
    return svg(100, 100, mark(fg, "g", spark_fill=fg).replace('stroke-width="17"', 'stroke-width="19"'))


def main():
    (OUT / "icon-light.svg").write_text(app_icon(False))
    (OUT / "icon-dark.svg").write_text(app_icon(True))
    (OUT / "mark.svg").write_text(svg(100, 100, mark(INK, "g"), grad("g")))
    (OUT / "mark-white.svg").write_text(svg(100, 100, mark(PAPER, "g"), grad("g")))
    (OUT / "mark-mono-white.svg").write_text(svg(100, 100, mark(PAPER, "g", spark_fill=PAPER)))
    (OUT / "tray-template.svg").write_text(tray("#000000"))
    (OUT / "lockup-light.svg").write_text(lockup(INK, PAPER))
    (OUT / "lockup-dark.svg").write_text(lockup(PAPER, "#1C1C1E"))
    wm, ww = wordmark(INK, "g")
    (OUT / "wordmark.svg").write_text(svg(ww + 40, 170, f'<g transform="translate(20 52)">{wm}</g>', grad("g")))


if __name__ == "__main__":
    main()

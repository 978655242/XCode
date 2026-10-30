"""Shared SVG/letter helpers and legacy filenames delegating to the canonical Aiscoo design."""
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
    # 原因：旧命令仍可执行；星光 a 只保留在历史记录，当前出口复用正式 ai。
    import ai
    from make import inner
    return inner(ai.mark(fg, INK if fg == PAPER else PAPER, gid, animated=False, tucked=True))


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
    from make import icon
    return icon(dark)


def lockup(fg, bg):
    import ai
    return ai.lockup(fg, bg, "g", animated=False, tucked=True)


def tray(fg):
    import ai
    return ai.mark(fg, PAPER, "g", animated=False, tucked=True)


def main():
    (OUT / "icon-light.svg").write_text(app_icon(False))
    (OUT / "icon-dark.svg").write_text(app_icon(True))
    (OUT / "mark.svg").write_text(svg(172, 172, mark(INK, "g")))
    (OUT / "mark-white.svg").write_text(svg(172, 172, mark(PAPER, "g")))
    (OUT / "mark-mono-white.svg").write_text(svg(172, 172, mark(PAPER, "g", spark_fill=PAPER)))
    (OUT / "tray-template.svg").write_text(tray("#000000"))
    (OUT / "lockup-light.svg").write_text(lockup(INK, PAPER))
    (OUT / "lockup-dark.svg").write_text(lockup(PAPER, "#1C1C1E"))
    (OUT / "wordmark.svg").write_text(lockup(INK, PAPER))


if __name__ == "__main__":
    main()

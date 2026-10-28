"""Aiscoo 'peeking a' — cute + soft 3D edition.

Shapes stay the letter a: rounded stem = the wall corner, round bowl = a head peeking out from behind it.
3D comes from: top-left key light, glossy highlight, the wall's cast shadow on the head, a blue rim light,
and dimensional glowing eyes with white catchlights.
"""
from pathlib import Path
from build import svg, INK, PAPER, wordmark as flat_wordmark

OUT = Path(__file__).parent

SX, SW, TOP, BOT = 62, 20, 26, 87   # wall
HX, HY, HR = 44, 58, 30.5           # head
GAP = 3.5


def defs(u, dark):
    head_hi, head_lo = ("#4A5160", "#0B0D11") if not dark else ("#FFFFFF", "#C9D0DC")
    wall_hi, wall_lo = ("#3A404C", "#0E1014") if not dark else ("#F4F6FA", "#B8C0CD")
    return f'''
<radialGradient id="{u}head" cx="0.32" cy="0.26" r="0.85">
  <stop offset="0" stop-color="{head_hi}"/><stop offset="0.55" stop-color="{'#1B1F27' if not dark else '#EEF1F6'}"/>
  <stop offset="1" stop-color="{head_lo}"/></radialGradient>
<linearGradient id="{u}wall" x1="0" y1="0" x2="1" y2="0.2">
  <stop offset="0" stop-color="{wall_hi}"/><stop offset="0.45" stop-color="{'#1C2028' if not dark else '#E6EAF0'}"/>
  <stop offset="1" stop-color="{wall_lo}"/></linearGradient>
<linearGradient id="{u}eye" x1="0" y1="0" x2="0.3" y2="1">
  <stop offset="0" stop-color="#7DF9FF"/><stop offset="0.45" stop-color="#38A8FF"/>
  <stop offset="1" stop-color="#7C5CFF"/></linearGradient>
<radialGradient id="{u}rim" cx="0.15" cy="0.6" r="0.7">
  <stop offset="0.72" stop-color="#3B82F6" stop-opacity="0"/>
  <stop offset="1" stop-color="#60A5FA" stop-opacity="{0.75 if not dark else 0.5}"/></radialGradient>
<linearGradient id="{u}shade" x1="1" y1="0" x2="0" y2="0">
  <stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
<filter id="{u}eg" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4"/></filter>
<filter id="{u}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>
<clipPath id="{u}hc"><circle cx="{HX}" cy="{HY}" r="{HR}"/></clipPath>
<mask id="{u}gap" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">
  <rect x="-20" y="-20" width="140" height="140" fill="#fff"/>
  <rect x="{SX-GAP}" y="-20" width="{SW+GAP*2}" height="140" fill="#000"/></mask>'''


def eye(cx, cy, u, w=12, h=17):
    """Big rounded glowing eye with catchlights: reads as 'eye', not as a letter."""
    return (f'<ellipse cx="{cx}" cy="{cy}" rx="{w/2}" ry="{h/2}" fill="url(#{u}eye)"/>'
            f'<ellipse cx="{cx-1.6}" cy="{cy-3.6}" rx="2.6" ry="3.1" fill="#fff"/>'
            f'<circle cx="{cx+2.2}" cy="{cy+3.4}" r="1.15" fill="#fff" opacity="0.85"/>')


def face(u, hand, blush):
    ex = [31.5, 47.5]; ey = 57
    glow = "".join(f'<ellipse cx="{x}" cy="{ey}" rx="7.5" ry="10" fill="#3B9BFF"/>' for x in ex)
    out = f'<g filter="url(#{u}eg)" opacity="0.75">{glow}</g>' + "".join(eye(x, ey, u) for x in ex)
    if blush:
        out += (f'<g filter="url(#{u}soft)" opacity="0.55">'
                f'<ellipse cx="25" cy="70" rx="5" ry="2.8" fill="#FF7AB6"/>'
                f'<ellipse cx="51" cy="70" rx="4.5" ry="2.6" fill="#FF7AB6"/></g>')
    return out


def mark(u="m", dark=False, hand=False, blush=False, flat=False):
    if flat:  # small sizes / tray: crisp silhouette, cut-out eyes
        fg = PAPER if dark else INK
        holes = "".join(f'<ellipse cx="{x}" cy="57" rx="6.5" ry="9" fill="#000"/>' for x in (31.5, 47.5))
        return (f'<defs><mask id="{u}f" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">'
                f'<rect x="-20" y="-20" width="140" height="140" fill="#fff"/>{holes}'
                f'<rect x="{SX-GAP}" y="-20" width="{SW+GAP*2}" height="140" fill="#000"/></mask></defs>'
                f'<circle cx="{HX}" cy="{HY}" r="{HR}" fill="{fg}" mask="url(#{u}f)"/>'
                f'<path d="M{SX} {TOP+SW/2}A{SW/2} {SW/2} 0 0 1 {SX+SW} {TOP+SW/2}V{BOT-2.5}Q{SX+SW} {BOT} {SX+SW-2.5} {BOT}'
                f'H{SX+2.5}Q{SX} {BOT} {SX} {BOT-2.5}Z" fill="{fg}"/>')
    head = (f'<g mask="url(#{u}gap)">'
            f'<circle cx="{HX}" cy="{HY}" r="{HR}" fill="url(#{u}head)"/>'
            f'<g clip-path="url(#{u}hc)">'
            f'<circle cx="{HX}" cy="{HY}" r="{HR}" fill="url(#{u}rim)"/>'
            f'<rect x="{SX-13}" y="0" width="13" height="100" fill="url(#{u}shade)"/>'   # wall's cast shadow
            f'<path d="M{HX-23} {HY-6}A{HR-6} {HR-6} 0 0 1 {HX+2} {HY-25}" fill="none" stroke="#fff" '
            f'stroke-width="3.2" stroke-linecap="round" opacity="{0.38 if not dark else 0.95}"/>'          # gloss arc
            f'<circle cx="{HX+7}" cy="{HY-25.5}" r="1.7" fill="#fff" opacity="{0.38 if not dark else 0.95}"/>'
            f'{face(u, hand, blush)}</g></g>')
    r = SW / 2
    wall_d = (f'M{SX} {TOP+r}A{r} {r} 0 0 1 {SX+SW} {TOP+r}V{BOT-2.5}Q{SX+SW} {BOT} {SX+SW-2.5} {BOT}'
              f'H{SX+2.5}Q{SX} {BOT} {SX} {BOT-2.5}Z')
    wall = (f'<path d="{wall_d}" fill="url(#{u}wall)"/>'
            f'<rect x="{SX+3.5}" y="{TOP+5}" width="3.2" height="{BOT-TOP-12}" rx="1.6" fill="#fff" '
            f'opacity="{0.22 if not dark else 0.8}"/>')  # wall edge highlight
    fingers = ""
    if hand:
        c, line, hi = ("#353B47", "#07080B", "#6B7484") if not dark else ("#FFFFFF", "#9AA3B2", "#FFFFFF")
        fingers = "".join(
            f'<rect x="{SX-3}" y="{y}" width="11" height="6.6" rx="3.3" fill="{c}" stroke="{line}" stroke-width="1.3"/>'
            f'<rect x="{SX-1.2}" y="{y+1.2}" width="4.5" height="1.6" rx="0.8" fill="{hi}" opacity="0.7"/>'
            for y in (38, 45.2))
    return f'<defs>{defs(u, dark)}</defs>{head}{wall}{fingers}'


def icon(u, dark=False, **kw):
    top, bot = ("#FFFFFF", "#EEF1F5") if not dark else ("#2A2E36", "#0D0F12")
    body = (f'<defs><linearGradient id="{u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset="1" stop-color="{bot}"/></linearGradient>'
            f'<radialGradient id="{u}floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.28"/>'
            f'<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
            f'<filter id="{u}sh" x="-10%" y="-10%" width="120%" height="125%">'
            f'<feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity="0.22"/></filter></defs>'
            f'<g filter="url(#{u}sh)"><rect x="100" y="100" width="824" height="824" rx="185" fill="url(#{u}bg)"/></g>'
            f'<rect x="101" y="101" width="822" height="822" rx="184" fill="none" stroke="#fff" stroke-opacity="{0.9 if not dark else 0.08}" stroke-width="2"/>'
            f'<ellipse cx="512" cy="760" rx="250" ry="34" fill="url(#{u}floor)"/>'
            f'<g transform="translate(146 92) scale(7.4)">{mark(u, dark, **kw)}</g>')
    return svg(1024, 1024, body)


def lockup(fg, bg, u):
    """Flat wordmark keeps the 3D mark's glyph language: peeking a + plain 'iscoo'."""
    import re
    wm, ww = flat_wordmark(fg, "g")
    wm = re.sub(r'<circle [^>]*/>', '', wm, count=1)
    wm = re.sub(r'<path d="M[0-9.]+ 0V100"[^>]*/>', '', wm, count=1)
    wm = re.sub(r'</g><path d="M[^"]*Q[^"]*"[^>]*/>', '</g>', wm, count=1)
    s = 100 / 61   # glyph box of the mark -> x-height 100
    a = (f'<g transform="translate({-18*s:.2f} {-(TOP)*s+(-2):.2f}) scale({s:.4f})">'
         f'{mark(u, dark=(fg == PAPER), flat=True)}</g>')
    pad, h = 40, 200
    body = f'<g transform="translate({pad} {(h-100)/2+14})">{a}<g transform="translate(14 0)">{wm}</g></g>'
    return svg(pad * 2 + ww + 14, h, body, "", bg)


if __name__ == "__main__":
    variants = {"q": {}, "q-hand": {"hand": True, "blush": True}}
    for n, kw in variants.items():
        (OUT / f"icon-{n}.svg").write_text(icon(n.replace("-", ""), **kw))
        (OUT / f"icon-{n}-dark.svg").write_text(icon(n.replace("-", "") + "d", dark=True, **kw))
        (OUT / f"mark-{n}.svg").write_text(svg(100, 100, mark(n.replace("-", "") + "m", **kw)))
    (OUT / "mark-flat.svg").write_text(svg(100, 100, mark("f", flat=True)))
    (OUT / "mark-flat-white.svg").write_text(svg(100, 100, mark("fw", dark=True, flat=True)))
    (OUT / "tray-template.svg").write_text(svg(100, 100, f'<g transform="translate(-10 -16) scale(1.3)">{mark("t", flat=True).replace(INK, "#000")}</g>'))
    (OUT / "lockup-light.svg").write_text(lockup(INK, PAPER, "ll"))
    (OUT / "lockup-dark.svg").write_text(lockup(PAPER, "#1C1C1E", "ld"))

"""Rebuild all final Aiscoo assets from ai.py (i-as-wall design)."""
import re
import xml.dom.minidom as dom
from pathlib import Path
import ai
from build import svg

OUT = Path(__file__).parent


def write(name, content):
    dom.parseString(content)
    (OUT / name).write_text(content)


def inner(s):
    return re.sub(r'^<svg[^>]*>|</svg>\s*$', '', s.strip())


def icon(dark):
    fg = ai.PAPER if dark else ai.INK
    top, bot = ("#2A2E36", "#0D0F12") if dark else ("#FFFFFF", "#EEF1F5")
    body = (f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset="1" stop-color="{bot}"/></linearGradient><filter id="sh" x="-10%" y="-10%" width="120%" height="125%">'
            f'<feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity="0.22"/></filter></defs>'
            f'<g filter="url(#sh)"><rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/></g>'
            f'<g transform="translate(512 512) scale(4.2) translate(-86 -86)">'
            f'{inner(ai.mark(fg, bot, "i" + ("d" if dark else "l"), animated=False, tucked=True))}</g>')
    return svg(1024, 1024, body)


for a, sfx in ((True, "-anim"), (False, "")):
    write(f"ai-lockup{sfx}-light.svg", ai.lockup(ai.INK, ai.PAPER, "l", a, tucked=True))
    write(f"ai-lockup{sfx}-dark.svg", ai.lockup(ai.PAPER, "#1C1C1E", "d", a, tucked=True))
    write(f"ai-mark{sfx}.svg", ai.mark(ai.INK, ai.PAPER, "m", a, tucked=a))
    write(f"ai-mark{sfx}-white.svg", ai.mark(ai.PAPER, "#1C1C1E", "w", a, tucked=a))
write("ai-mark-tucked.svg", ai.mark(ai.INK, ai.PAPER, "t", False, tucked=True))
write("ai-mark-tucked-white.svg", ai.mark(ai.PAPER, "#1C1C1E", "tw", False, tucked=True))
write("ai-icon.svg", icon(False))
write("ai-icon-dark.svg", icon(True))

s = (OUT / "splash.html").read_text()
s = re.sub(r'<div class="logo light">.*?</svg></div>',
           lambda m: '<div class="logo light">' + (OUT / "ai-mark-anim.svg").read_text().strip() + '</div>', s, flags=re.S)
s = re.sub(r'<div class="logo dark">.*?</svg></div>',
           lambda m: '<div class="logo dark">' + (OUT / "ai-mark-anim-white.svg").read_text().strip() + '</div>', s, flags=re.S)
(OUT / "splash.html").write_text(s)
print("ok")

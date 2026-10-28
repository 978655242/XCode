"""Rebuild every published Aiscoo SVG and the splash page in place, from the parameters in ai.py."""
import re
import xml.dom.minidom as dom
from pathlib import Path
import ai
from build import svg

PKG = Path(__file__).resolve().parent.parent   # docs/brand/aiscoo/


def write(rel, content):
    dom.parseString(content)
    (PKG / rel).write_text(content)


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


write("logo/svg/aiscoo-light.svg", ai.lockup(ai.INK, ai.PAPER, "l", False, tucked=True))
write("logo/svg/aiscoo-dark.svg", ai.lockup(ai.PAPER, "#1C1C1E", "d", False, tucked=True))
write("logo-animated/aiscoo-animated-light.svg", ai.lockup(ai.INK, ai.PAPER, "l", True, tucked=True))
write("logo-animated/aiscoo-animated-dark.svg", ai.lockup(ai.PAPER, "#1C1C1E", "d", True, tucked=True))
write("splash/ai-animated-light.svg", ai.mark(ai.INK, ai.PAPER, "m", True, tucked=True))
write("splash/ai-animated-dark.svg", ai.mark(ai.PAPER, "#1C1C1E", "w", True, tucked=True))
write("mark/svg/ai-light.svg", ai.mark(ai.INK, ai.PAPER, "t", False, tucked=True))
write("mark/svg/ai-dark.svg", ai.mark(ai.PAPER, "#1C1C1E", "tw", False, tucked=True))
write("app-icon/png/icon-light.svg", icon(False))
write("app-icon/png/icon-dark.svg", icon(True))

# The splash page inlines the animated marks so it plays without external files.
splash = PKG / "splash/splash.html"
s = splash.read_text()
for theme, rel in (("light", "splash/ai-animated-light.svg"), ("dark", "splash/ai-animated-dark.svg")):
    s, n = re.subn(rf'<div class="logo {theme}">.*?</svg></div>',
                   lambda m, rel=rel: f'<div class="logo {theme}">' + (PKG / rel).read_text().strip() + '</div>',
                   s, flags=re.S)
    assert n == 1, f"splash.html: expected one {theme} logo slot, found {n}"
splash.write_text(s)
print("updated SVGs and splash/splash.html under", PKG)

"""Animated flat 'aiscoo' wordmark: the peeking a pops out, glances around, blinks, eyes the i-dot (which hops), ducks back."""
import re
from pathlib import Path
from build import svg, INK, PAPER, wordmark as flat_wordmark
from q3d import SX, SW, TOP, BOT, HX, HY, HR, GAP

OUT = Path(__file__).parent
EYES = (31.5, 47.5)
EY, ERX, ERY = 57, 6.5, 9

CSS = """
.head{animation:peek 4.8s cubic-bezier(.34,1.56,.64,1) infinite}
.tilt{transform-box:view-box;transform-origin:62px 86px;animation:tilt 4.8s ease-in-out infinite}
.eyes{animation:look 4.8s ease-in-out infinite}
.eye{transform-box:fill-box;transform-origin:50% 50%;animation:blink 4.8s ease-in-out infinite}
.idot{transform-box:fill-box;transform-origin:50% 100%;animation:hop 4.8s ease-in-out infinite}
@keyframes peek{
 0%,6%{transform:translateX(21px)}
 16%{transform:translateX(-2px)}
 20%,84%{transform:translateX(0)}
 88%{transform:translateX(-3px)}
 96%,100%{transform:translateX(21px)}}
@keyframes tilt{0%,22%{transform:rotate(0)}28%,36%{transform:rotate(-7deg)}42%,100%{transform:rotate(0)}}
@keyframes look{
 0%,20%{transform:translate(0,0)}
 26%,34%{transform:translate(-4px,1px)}
 40%,46%{transform:translate(3px,0)}
 52%,64%{transform:translate(5px,-5px)}
 70%,100%{transform:translate(0,0)}}
@keyframes blink{0%,74%,80%,100%{transform:scaleY(1)}77%{transform:scaleY(.12)}}
@keyframes hop{
 0%,54%{transform:translateY(0) scale(1)}
 57%{transform:translateY(0) scale(1.15,.82)}
 62%{transform:translateY(-14px) scale(.92,1.1)}
 67%{transform:translateY(0) scale(1.12,.86)}
 70%,100%{transform:translateY(0) scale(1)}}
@media (prefers-reduced-motion:reduce){.head,.tilt,.eyes,.eye,.idot{animation:none}}
"""


def peeking_a(fg, bg, u):
    """In the 100-unit mark box. Head is clipped left of the wall, so sliding right = hiding behind it."""
    r = SW / 2
    wall = (f'<path d="M{SX} {TOP+r}A{r} {r} 0 0 1 {SX+SW} {TOP+r}V{BOT-2.5}Q{SX+SW} {BOT} {SX+SW-2.5} {BOT}'
            f'H{SX+2.5}Q{SX} {BOT} {SX} {BOT-2.5}Z" fill="{fg}"/>')
    eyes = "".join(f'<ellipse class="eye" cx="{x}" cy="{EY}" rx="{ERX}" ry="{ERY}" fill="{bg}"/>' for x in EYES)
    head = (f'<g class="head"><g class="tilt"><circle cx="{HX}" cy="{HY}" r="{HR}" fill="{fg}"/>'
            f'<g clip-path="url(#{u}hc)"><g class="eyes">{eyes}</g></g></g></g>')
    defs = (f'<clipPath id="{u}hide"><rect x="-40" y="-40" width="{SX-GAP+40}" height="180"/></clipPath>'
            f'<clipPath id="{u}hc"><circle cx="{HX}" cy="{HY}" r="{HR-1}"/></clipPath>')
    return defs, f'<g clip-path="url(#{u}hide)">{head}</g>{wall}'


def animated_lockup(fg, bg, u, pad=40, h=200, with_bg=True):
    wm, ww = flat_wordmark(fg, "g")
    wm = re.sub(r'<circle [^>]*/>', '', wm, count=1)                          # original a bowl
    wm = re.sub(r'<path d="M[0-9.]+ 0V100"[^>]*/>', '', wm, count=1)          # original a stem
    wm = re.sub(r'</g><path d="M[^"]*Q[^"]*"[^>]*/>', '</g>', wm, count=1)    # sparkle
    wm = re.sub(r'<circle (cx="[0-9.]+" cy="-19")', r'<circle class="idot" \1', wm, count=1)
    assert 'class="idot"' in wm
    s = 100 / 61
    d, a = peeking_a(fg, bg, u)
    body = (f'<style>{CSS}</style>'
            f'<g transform="translate({pad} {(h-100)/2+14})">'
            f'<g transform="translate({-18*s:.2f} {-TOP*s-2:.2f}) scale({s:.4f})">{a}</g>'
            f'<g transform="translate(14 0)">{wm}</g></g>')
    return svg(pad * 2 + ww + 14, h, body, d, bg if with_bg else None)


def animated_mark(fg, bg, u):
    d, a = peeking_a(fg, bg, u)
    return svg(100, 100, f'<style>{CSS}</style><g transform="translate(-4 -6)">{a}</g>', d)


if __name__ == "__main__":
    (OUT / "lockup-anim-light.svg").write_text(animated_lockup(INK, PAPER, "l"))
    (OUT / "lockup-anim-dark.svg").write_text(animated_lockup(PAPER, "#1C1C1E", "d"))
    (OUT / "mark-anim.svg").write_text(animated_mark(INK, PAPER, "m"))
    (OUT / "mark-anim-white.svg").write_text(animated_mark(PAPER, "#1C1C1E", "w"))

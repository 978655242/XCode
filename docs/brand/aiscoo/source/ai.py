"""'aiscoo' wordmark where the stroke of the i is the wall: the head (the a) peeks out from behind the i."""
import re
from pathlib import Path
from build import svg, INK, PAPER, wordmark as flat_wordmark
from anim import CSS as BASE_CSS

OUT = Path(__file__).parent

# Head drawn in the original mark space (HX 44, HY 58, r 30.5), mapped onto the wordmark's x-height 100.
HX, HY, HR = 44, 58, 30.5
S = 50 / HR                       # head diameter = x-height
HEAD_CX = 66                      # wordmark units; right side tucks behind the i stem (x 116..138)
TX, TY = HEAD_CX - HX * S, 50 - HY * S
I_LEFT, GAP = 116, 5
SHIFT = -(HEAD_CX - 50)           # move everything so the head's left edge sits at x=0
EYES, EY, EYE_WIDTH, EYE_HEIGHT = (30.5, 48.5), 57, 7.4, 17.2
# i proportions (wordmark units, x-height 0..100). Stem top = round-cap centre.
I_STEM_TOP, I_DOT_CY, I_DOT_R = 11, -18, 11   # stem cap top at 0 = level with the head and s c o; dot gap 7


def set_i(stem_top, dot_cy, dot_r):
    global I_STEM_TOP, I_DOT_CY, I_DOT_R
    I_STEM_TOP, I_DOT_CY, I_DOT_R = stem_top, dot_cy, dot_r

def _stretch(css):
    # 原因：oo_preview 导入时仍构造旧实验动效；保留其接口，正式 Logo 直接使用 anim.CSS。
    def frames(match):
        return re.sub(r'(\d+(?:\.\d+)?)%',
                      lambda p: p.group(0) if p.group(1) == "100"
                      else f"{float(p.group(1)) * 4.8 / 8:g}%", match.group(0))
    css = re.sub(r'@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', frames, css)
    return css.replace("4.8s", "8.0s")


# The i stem is the pivot for the tilt: 111% / 100% of the head's box in mark space.
CSS = BASE_CSS.replace("transform-box:view-box;transform-origin:62px 86px",
                       "transform-box:fill-box;transform-origin:111% 100%")


# Same offset as the peek keyframes' hidden pose. CSS animation overrides this attribute while it runs,
# so it only shows when the mark is static or motion is reduced.
TUCK = ' transform="translate(21 0)"'


def set_head(top=0, right=116):
    """Head = round bowl sitting on the baseline. `top` is its top edge (x-height units); `right` its right edge behind the i."""
    global S, HEAD_CX, TX, TY, SHIFT
    r = (100 - top) / 2
    S = r / HR
    HEAD_CX = right - r
    TX, TY = HEAD_CX - HX * S, (100 + top) / 2 - HY * S
    SHIFT = -(HEAD_CX - r)


def head(fg, bg, u, tucked=False):
    # 胶囊直接改变高度闭眼，保留圆头；静态与减少动态效果时只显示常态眼睛。
    eyes = "".join(f'<rect class="eye" x="{x-EYE_WIDTH/2:g}" y="{EY-EYE_HEIGHT/2:g}" '
                   f'width="{EYE_WIDTH}" height="{EYE_HEIGHT}" rx="{EYE_WIDTH/2:g}" fill="{bg}"/>'
                   for x in EYES)
    # 原因：细描边在小尺寸下显尖；闭合厚弧保留饱满弧顶、内凹底和圆润端点。
    smile = "".join(
        f'<g transform="translate({x:g} 0)"><path d="M-6.7 56.8'
        'C-6.7 53.1 -3.7 50.3 0 50.3C3.7 50.3 6.7 53.1 6.7 56.8'
        'C6.7 58.2 5.8 59.1 4.5 59.1C3.2 59.1 2.7 58.2 2 57.2'
        'C1 55.8 -1 55.8 -2 57.2C-2.7 58.2 -3.2 59.1 -4.5 59.1'
        'C-5.8 59.1 -6.7 58.2 -6.7 56.8Z"/></g>' for x in EYES)
    eyes = (f'<g class="eye-open">{eyes}</g><g class="smile" opacity="0" '
            f'fill="{bg}">{smile}</g>')
    defs = (f'<clipPath id="{u}hide"><rect x="-200" y="-200" width="{I_LEFT-GAP+200}" height="500"/></clipPath>'
            f'<clipPath id="{u}hc"><circle cx="{HX}" cy="{HY}" r="{HR-1}"/></clipPath>')
    body = (f'<g clip-path="url(#{u}hide)"><g transform="translate({TX:.2f} {TY:.2f}) scale({S:.4f})">'
            f'<g class="head"{TUCK if tucked else ""}><g class="bounce"><g class="tilt">'
            f'<circle cx="{HX}" cy="{HY}" r="{HR}" fill="{fg}"/>'
            f'<g clip-path="url(#{u}hc)"><g class="eyes">{eyes}</g></g></g></g></g></g></g>')
    return defs, body


def rest_of_word(fg):
    wm, ww = flat_wordmark(fg, "g")
    wm = re.sub(r'<circle [^>]*/>', '', wm, count=1)                          # old a bowl
    wm = re.sub(r'<path d="M[0-9.]+ 0V100"[^>]*/>', '', wm, count=1)          # old a stem (the extra "|")
    wm = re.sub(r'</g><path d="M[^"]*Q[^"]*"[^>]*/>', '</g>', wm, count=1)    # old sparkle
    wm = wm.replace('<path d="M127.00 11.00V100" stroke-linecap="butt"/>', '')
    wm = wm.replace('<path d="M127.00 11.00V11.10"/>', '')
    wm = re.sub(r'<circle cx="127.00" cy="-19" r="[0-9.]+" fill="([^"]+)"/>',
                lambda m: i_stem(m.group(1)) + f'<circle class="idot" cx="127.00" cy="{I_DOT_CY}" r="{I_DOT_R}" fill="{m.group(1)}"/>',
                wm, count=1)
    assert 'class="idot"' in wm and 'M89.00 0V100' not in wm
    return wm, ww


def i_stem(fg):
    t = I_STEM_TOP
    return f'<path d="M116 {t}A11 11 0 0 1 138 {t}V100H116Z" fill="{fg}"/>'


def i_only(fg):
    """Just the i (stem + hopping dot) for the square mark."""
    return (i_stem(fg) +
            f'<circle class="idot" cx="127" cy="{I_DOT_CY}" r="{I_DOT_R}" fill="{fg}"/>')


LETTER_GAP = 12   # clear space between letters (x-height units); approved option A


def lockup(fg, bg, u, animated=True, pad=40, h=200, tucked=False):
    import sys
    if "oo_preview" in sys.modules:
        word_fn = sys.modules["oo_preview"].rest_of_word
    else:
        from oo_preview import rest_of_word as word_fn
    d, hd = head(fg, bg, u, tucked)
    wm, end = word_fn(fg, LETTER_GAP, LETTER_GAP, False)
    # Static tucked logo is trimmed to the visible glyph; the animated one keeps room for the head to pop out.
    left = -SHIFT + (21 * S if tucked and not animated else 0)
    style = f'<style>{CSS}</style>' if animated else ""
    body = f'{style}<g transform="translate({pad-left:.2f} {(h-100)/2+14})">{hd}{wm}</g>'
    return svg(pad * 2 + end - left, h, body, d, bg)


def mark(fg, bg, u, animated=True, tucked=False):
    """Square 'ai' mark: head peeking from behind the i, dot on top."""
    d, hd = head(fg, bg, u, tucked)
    style = f'<style>{CSS}</style>' if animated else ""
    # Centre on the visible glyph: the tucked head is shifted right (TUCK is in head units, so scale by S),
    # and the i's dot sets the top edge.
    left = -SHIFT + (21 * S if tucked else 0)
    top = I_DOT_CY - I_DOT_R
    size, cx, cy = 172, (left + 138) / 2, (top + 100) / 2
    body = f'{style}<g transform="translate({size/2-cx} {size/2-cy})">{hd}{i_only(fg)}</g>'
    return svg(size, size, body, d)


if __name__ == "__main__":
    for a, sfx in ((True, "-anim"), (False, "")):
        (OUT / f"ai-lockup{sfx}-light.svg").write_text(lockup(INK, PAPER, "l", a))
        (OUT / f"ai-lockup{sfx}-dark.svg").write_text(lockup(PAPER, "#1C1C1E", "d", a))
        (OUT / f"ai-mark{sfx}.svg").write_text(mark(INK, PAPER, "m", a))
        (OUT / f"ai-mark{sfx}-white.svg").write_text(mark(PAPER, "#1C1C1E", "w", a))

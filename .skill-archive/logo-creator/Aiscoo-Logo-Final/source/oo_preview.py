"""Review page: 'oo' as a pair of eyes + tighter letter spacing. Writes oo-* files only; finals are untouched."""
import base64
import math
from pathlib import Path

import ai
from build import svg

OUT = Path(__file__).parent
SW, R = 22, 50 - 22 / 2
PUPIL_RX, PUPIL_RY = 10.5, 14          # same proportions as the head's eyes (6.5 x 9 head units * S)
REST = (-10, 0)                        # at rest the oo eyes watch the i, where the AI hides

# Timeline in the 4.8 s active base, stretched to the full cycle like the head's keyframes.
OO_CSS = ai._stretch("""
.oolook{animation:ooLook 4.8s ease-in-out infinite}
@keyframes ooLook{
 0%,14%{transform:translate(-10px,0)}
 18%{transform:translate(-12px,-1px)}
 22%,34%{transform:translate(-10px,2px)}
 40%,46%{transform:translate(0,0)}
 52%,64%{transform:translate(-8px,-9px)}
 70%,100%{transform:translate(-10px,0)}}
@media (prefers-reduced-motion:reduce){.oolook{animation:none}}
""")


def rest_of_word(fg, gap, oo_gap, eyes, k=1.0):
    """i s c o o on the same skeleton as build.wordmark; gap = clear space between letters."""
    i = ai.i_stem(fg) + f'<circle class="idot" cx="127" cy="{ai.I_DOT_CY}" r="{ai.I_DOT_R}" fill="{fg}"/>'
    strokes = []
    rs = (100 - SW) / 4
    rx = rs * 1.22
    cx = 138 + gap + SW / 2 + rx
    a1, a2 = math.radians(-35), math.radians(145)
    ux, uy = cx + rx * math.cos(a1), SW / 2 + rs + rs * math.sin(a1)
    lx, ly = cx + rx * math.cos(a2), 100 - SW / 2 - rs + rs * math.sin(a2)
    strokes.append(f'<path d="M{ux:.2f} {uy:.2f}A{rx:.2f} {rs:.2f} 0 1 0 {cx:.2f} 50'
                   f'A{rx:.2f} {rs:.2f} 0 1 1 {lx:.2f} {ly:.2f}"/>')
    Rx = R * k                          # k < 1 condenses c and o into upright ovals
    cx = cx + rx + SW + gap + Rx
    c1 = (cx + Rx * math.cos(math.radians(-40)), 50 + R * math.sin(math.radians(-40)))
    c2 = (cx + Rx * math.cos(math.radians(40)), 50 + R * math.sin(math.radians(40)))
    strokes.append(f'<path d="M{c1[0]:.2f} {c1[1]:.2f}A{Rx:.2f} {R} 0 1 0 {c2[0]:.2f} {c2[1]:.2f}"/>')
    o1 = cx + Rx + SW + gap - 4 + Rx    # open c: optical -4, same as the current wordmark
    o2 = o1 + 2 * Rx + SW + oo_gap
    strokes += [f'<ellipse cx="{o:.2f}" cy="50" rx="{Rx:.2f}" ry="{R}"/>' for o in (o1, o2)]
    body = i + f'<g fill="none" stroke="{fg}" stroke-width="{SW}" stroke-linecap="round">{"".join(strokes)}</g>'
    if eyes:
        pupils = "".join(f'<ellipse class="eye" cx="{o:.2f}" cy="50" rx="{PUPIL_RX}" ry="{PUPIL_RY}" fill="{fg}"/>'
                         for o in (o1, o2))
        body += f'<g class="oolook" transform="translate({REST[0]} {REST[1]})">{pupils}</g>'
    return body, o2 + Rx + SW / 2


def lockup(fg, bg, u, gap, oo_gap, eyes, animated, k=1.0, pad=40, h=200):
    """Static = tucked and trimmed to the visible glyph; animated keeps room on the left for the head to pop out."""
    d, hd = ai.head(fg, bg, u, tucked=True)
    word, end = rest_of_word(fg, gap, oo_gap, eyes, k)
    left = -ai.SHIFT + (0 if animated else 21 * ai.S)
    style = f"<style>{ai.CSS}{OO_CSS}</style>" if animated else ""
    body = f'{style}<g transform="translate({pad - left:.2f} {(h - 100) / 2 + 14})">{hd}{word}</g>'
    return svg(pad * 2 + end - left, h, body, d, bg), end - (-ai.SHIFT + 21 * ai.S)


VARIANTS = {
    "A": dict(gap=11, oo_gap=6, eyes=True, title="A · 眼睛 oo + 字距收紧"),
    "B": dict(gap=11, oo_gap=0, eyes=True, title="B · 眼睛 oo 并拢 + 字距收紧"),
    "C": dict(gap=9, oo_gap=0, eyes=True, k=0.84, title="C · 窄体 c o + 眼睛 oo 并拢（最紧凑）"),
}


def uri(text):
    return "data:image/svg+xml;base64," + base64.b64encode(text.encode()).decode()


def main():
    current = (OUT / "ai-lockup-light.svg").read_text(), (OUT / "ai-lockup-dark.svg").read_text()
    _, current_w = lockup(ai.INK, ai.PAPER, "x", 16, 16, False, False)
    built = {}
    for k, v in VARIANTS.items():
        kw = {x: v[x] for x in ("gap", "oo_gap", "eyes", "k") if x in v}
        sl, w = lockup(ai.INK, ai.PAPER, f"{k}sl", animated=False, **kw)
        sd, _ = lockup(ai.PAPER, "#1C1C1E", f"{k}sd", animated=False, **kw)
        al, _ = lockup(ai.INK, ai.PAPER, f"{k}al", animated=True, **kw)
        ad, _ = lockup(ai.PAPER, "#1C1C1E", f"{k}ad", animated=True, **kw)
        for name, text in (("light", sl), ("dark", sd), ("anim-light", al), ("anim-dark", ad)):
            (OUT / f"oo-{k}-lockup-{name}.svg").write_text(text)
        built[k] = (sl, sd, al, ad, w)

    def card(text, dark=False, h=None):
        style = f"height:{h}px;width:auto" if h else "width:100%"
        return (f'<div class="card" style="background:{"#1C1C1E" if dark else "#fff"}">'
                f'<img src="{uri(text)}" style="{style}"></div>')

    def label(title, w):
        return f'<div class="label">{title}<small>字形宽度 {w:.0f}，为当前的 {w / current_w:.0%}</small></div>'

    rows_static = label("当前", current_w) + card(current[0]) + card(current[1], True)
    rows_anim, rows_small = "", f'<div class="label">当前</div>{card(current[0], h=36)}{card(current[1], True, 36)}'
    for k, (sl, sd, al, ad, w) in built.items():
        t = VARIANTS[k]["title"]
        rows_static += label(t, w) + card(sl) + card(sd, True)
        rows_anim += f'<div class="label">{t}</div>' + card(al) + card(ad, True)
        rows_small += f'<div class="label">{t}</div>' + card(sl, h=36) + card(sd, True, 36)

    page = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Aiscoo · oo 眼睛方案</title><style>
body{{margin:0;background:#E9EBEF;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#3F4652}}
main{{max-width:1120px;margin:0 auto;padding:32px 24px 48px;display:grid;gap:24px}}
h1{{margin:0;font-size:22px;color:#121317}} h2{{margin:0 0 10px;font-size:15px;color:#121317}}
header p{{margin:4px 0 0;color:#6B7280}}
.grid{{display:grid;grid-template-columns:150px 1fr 1fr;gap:12px;align-items:center}}
.label{{font-weight:600;color:#121317}} .label small{{display:block;font-weight:400;color:#6B7280;font-size:12px}}
.card{{border-radius:16px;overflow:hidden;display:grid;place-items:center;min-height:72px;padding:6px 0}}
.card img{{display:block;max-width:100%}}
@media (max-width:720px){{.grid{{grid-template-columns:1fr}}}}
</style></head><body><main>
<header><h1>oo 眼睛方案（待确认）</h1>
<p>oo 加上瞳孔，变成一双盯着 i 后面那个 AI 的眼睛；字距收紧，整体更短。动效里，AI 探出时 oo 先看它，AI 看你时 oo 也看你，圆点跳起时 oo 抬眼看圆点，最后和 AI 一起眨眼。</p></header>
<section><h2>静态（缩起状态）</h2><div class="grid">{rows_static}</div></section>
<section><h2>动效（8 秒一轮）</h2><div class="grid">{rows_anim}</div></section>
<section><h2>小尺寸（高 36px，接近侧栏和标题栏）</h2><div class="grid">{rows_small}</div></section>
</main></body></html>"""
    (OUT / "oo-preview.html").write_text(page)
    for k, v in built.items():
        print(k, f"width {v[4]:.1f} vs current {current_w:.1f} ({v[4] / current_w:.0%})")


if __name__ == "__main__":
    main()

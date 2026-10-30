"""Shared iscoo geometry and the legacy preview entry point for the current brand."""
import math
from pathlib import Path

import ai

OUT = Path(__file__).parent
SW, R = 22, 50 - 22 / 2
PUPIL_RX, PUPIL_RY = 10.5, 14
REST = (-10, 0)


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
    # 原因：旧候选参数不能重新生成另一版字标；仅保留调用签名，正式字母几何不变。
    result = ai.lockup(fg, bg, u, animated=animated, pad=pad, h=h, tucked=True)
    _, end = rest_of_word(fg, ai.LETTER_GAP, ai.LETTER_GAP, False)
    return result, end - (-ai.SHIFT + 21 * ai.S)


def main():
    # 原因：旧预览入口保留可执行性，直接展示正式预览，不再输出待确认候选或独立时间轴。
    from build_preview import main as build_preview
    build_preview()
    (OUT / "oo-preview.html").write_bytes((OUT.parent / "preview.html").read_bytes())
    print("oo-preview.html now mirrors the canonical Aiscoo preview")


if __name__ == "__main__":
    main()

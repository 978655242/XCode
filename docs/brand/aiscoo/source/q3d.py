"""Legacy 3D filenames now delegate to the canonical flat Aiscoo design.

The old hand/blush/flat arguments remain accepted for caller compatibility.
Only docs/brand/aiscoo/source/ai.py owns the robot geometry.
"""
from pathlib import Path
from build import svg, INK, PAPER

OUT = Path(__file__).parent


def mark(u="m", dark=False, hand=False, blush=False, flat=False):
    # 原因：旧 3D 入口会重新生成椭圆眼；兼容文件名统一复用正式收起图形。
    import ai
    from make import inner
    return inner(ai.mark(PAPER if dark else INK, "#1C1C1E" if dark else PAPER,
                         u, animated=False, tucked=True))


def icon(u, dark=False, **kw):
    from make import icon as canonical_icon
    return canonical_icon(dark)


def lockup(fg, bg, u):
    import ai
    return ai.lockup(fg, bg, u, animated=False, tucked=True)


if __name__ == "__main__":
    variants = {"q": {}, "q-hand": {"hand": True, "blush": True}}
    for n, kw in variants.items():
        (OUT / f"icon-{n}.svg").write_text(icon(n.replace("-", ""), **kw))
        (OUT / f"icon-{n}-dark.svg").write_text(icon(n.replace("-", "") + "d", dark=True, **kw))
        (OUT / f"mark-{n}.svg").write_text(svg(172, 172, mark(n.replace("-", "") + "m", **kw)))
    (OUT / "mark-flat.svg").write_text(svg(172, 172, mark("f", flat=True)))
    (OUT / "mark-flat-white.svg").write_text(svg(172, 172, mark("fw", dark=True, flat=True)))
    (OUT / "tray-template.svg").write_text(svg(172, 172, mark("t", flat=True).replace(INK, "#000")))
    (OUT / "lockup-light.svg").write_text(lockup(INK, PAPER, "ll"))
    (OUT / "lockup-dark.svg").write_text(lockup(PAPER, "#1C1C1E", "ld"))

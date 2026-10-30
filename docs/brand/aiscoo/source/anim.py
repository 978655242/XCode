"""Canonical seconds-based robot timeline and compatible legacy animation entry points."""
import re
from pathlib import Path
from build import INK, PAPER

OUT = Path(__file__).parent

CYCLE = 10.0


def keyframes(name, frames):
    # 原因：统一拉长百分比会拖慢旧动作；以秒维护，只将原收起片段后移 2 秒。
    rules = (",".join(f"{time / CYCLE * 100:g}%" for time in times) + "{" + value + "}"
             for times, value in frames)
    return "@keyframes " + name + "{\n " + "\n ".join(rules) + "}\n"


CSS = """
.head{animation:peek DURATION cubic-bezier(.34,1.56,.64,1) infinite}
.bounce{transform-box:fill-box;transform-origin:50% 100%;animation:bounce DURATION ease-in-out infinite}
.tilt{transform-box:view-box;transform-origin:62px 86px;animation:tilt DURATION ease-in-out infinite}
.eyes{animation:look DURATION ease-in-out infinite}
.eye{animation:blink DURATION ease-in-out infinite}
.eye-open{animation:open-eyes DURATION steps(1,end) infinite}
.smile{animation:smile DURATION steps(1,end) infinite}
.smile path{transform-box:fill-box;transform-origin:50% 50%;animation:smile-shape DURATION ease-in-out infinite}
.idot{transform-box:fill-box;transform-origin:50% 100%;animation:hop DURATION ease-in-out infinite}
""".replace("DURATION", f"{CYCLE}s")
CSS += keyframes("peek", [
    ((0, .288), "transform:translateX(21px)"),
    ((.768,), "transform:translateX(-2px)"),
    ((.96, 6.032), "transform:translateX(0)"),
    ((6.224,), "transform:translateX(-3px)"),
    ((6.608, CYCLE), "transform:translateX(21px)"),
])
CSS += keyframes("tilt", [
    ((0, 1.152), "transform:rotate(0)"),
    ((1.44, 1.68), "transform:rotate(-3.5deg)"),
    ((2.16,), "transform:rotate(2deg)"),
    ((2.592, 3.072), "transform:rotate(-1.5deg)"),
    ((3.36, 3.52), "transform:rotate(0)"),
    ((3.82, 5.30), "transform:rotate(-2deg)"),
    ((5.55, CYCLE), "transform:rotate(0)"),
])
CSS += keyframes("look", [
    ((0, .96), "transform:translate(0,0)"),
    ((1.248, 1.632), "transform:translate(-3px,.5px)"),
    ((2.016, 2.208), "transform:translate(2px,0)"),
    ((2.496, 3.072), "transform:translate(3px,-3px)"),
    ((3.36, CYCLE), "transform:translate(0,0)"),
])
CSS += keyframes("blink", [
    ((0, 1.752, 1.968, 3.48, 5.55, CYCLE), "y:48.4px;height:17.2px"),
    ((1.824, 1.848), "y:55.2px;height:3.6px"),
    ((3.62, 5.40), "y:54.8px;height:4.4px"),
])
# 原因：交叉淡变会叠出两套眼型；先压短胶囊，再同时切换两层的可见性。
CSS += keyframes("open-eyes", [((0,), "opacity:1"), ((3.62,), "opacity:0"), ((5.40, CYCLE), "opacity:1")])
CSS += keyframes("smile", [((0,), "opacity:0"), ((3.62,), "opacity:1"), ((5.40, CYCLE), "opacity:0")])
CSS += keyframes("smile-shape", [
    ((0, 3.62, 5.40, CYCLE), "transform:scale(.55,.48)"),
    ((3.76, 5.30), "transform:scale(1)"),
])
CSS += keyframes("bounce", [
    ((0, 3.36), "transform:translateY(0) scale(1)"),
    ((3.52,), "transform:translateY(0) scale(1.035,.94);animation-timing-function:cubic-bezier(.18,.72,.35,1)"),
    ((3.82,), "transform:translateY(-8.2px) scale(.98,1.025);animation-timing-function:cubic-bezier(.55,0,.85,.4)"),
    ((4.04,), "transform:translateY(0) scale(1)"),
    ((4.10,), "transform:translateY(0) scale(1.03,.95)"),
    ((4.27,), "transform:translateY(-2.1px) scale(.99,1.01)"),
    ((4.42,), "transform:translateY(0) scale(1.01,.985)"),
    ((4.50, CYCLE), "transform:translateY(0) scale(1)"),
])
CSS += keyframes("hop", [
    ((0, 2.592), "transform:translateY(0) scale(1)"),
    ((2.736,), "transform:translateY(0) scale(1.15,.82)"),
    ((2.976,), "transform:translateY(-14px) scale(.92,1.1)"),
    ((3.216,), "transform:translateY(0) scale(1.12,.86)"),
    ((3.36, CYCLE), "transform:translateY(0) scale(1)"),
])
CSS += """
@media (prefers-reduced-motion:reduce){
 .head,.bounce,.tilt,.eyes,.eye,.eye-open,.smile,.smile path,.idot{animation:none}
 .eye-open{opacity:1}
 .smile{opacity:0}}
"""


def peeking_a(fg, bg, u):
    # 原因：旧实验独立绘制椭圆眼；延迟导入正式几何，避免 ai → anim 的循环依赖。
    import ai
    defs, head = ai.head(fg, bg, u, tucked=True)
    return defs, head + ai.i_only(fg)


def animated_lockup(fg, bg, u, pad=40, h=200, with_bg=True):
    import ai
    result = ai.lockup(fg, bg, u, animated=True, pad=pad, h=h, tucked=True)
    if not with_bg:
        result = re.sub(r'(<defs>.*?</defs>)<rect width="[^"]+" height="[^"]+" fill="[^"]+"/>',
                        r'\1', result, count=1, flags=re.S)
    return result


def animated_mark(fg, bg, u):
    import ai
    return ai.mark(fg, bg, u, animated=True, tucked=True)


if __name__ == "__main__":
    (OUT / "lockup-anim-light.svg").write_text(animated_lockup(INK, PAPER, "l"))
    (OUT / "lockup-anim-dark.svg").write_text(animated_lockup(PAPER, "#1C1C1E", "d"))
    (OUT / "mark-anim.svg").write_text(animated_mark(INK, PAPER, "m"))
    (OUT / "mark-anim-white.svg").write_text(animated_mark(PAPER, "#1C1C1E", "w"))

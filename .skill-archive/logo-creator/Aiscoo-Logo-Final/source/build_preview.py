"""Rebuild preview.html from the published assets; every asset is inlined, so the single file can be shared."""
import base64
import html
import re
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent   # docs/brand/aiscoo/


def data_uri(name):
    return "data:image/svg+xml;base64," + base64.b64encode((PKG / name).read_bytes()).decode()


def img(name, style=""):
    return f'<img src="{data_uri(name)}" alt="{name}" style="{style}">'


def splash(theme):
    s = (PKG / "splash/splash.html").read_text()
    if theme == "dark":
        # Force the dark branch regardless of the viewer's system theme.
        s = s.replace("@media (prefers-color-scheme:dark){", "@media all{")
    else:
        s = re.sub(r"@media \(prefers-color-scheme:dark\)\{.*?\}\}", "", s, count=1, flags=re.S)
    return f'<iframe srcdoc="{html.escape(s, quote=True)}" title="启动页 {theme}"></iframe>'


def frozen_frame(name, time, identity, width=120):
    source = (PKG / name).read_text()
    # 同一生产 SVG 时间轴冻结在指定时刻；唯一 id 防止裁剪引用串帧。
    ids = re.findall(r'id="([^"]+)"', source)
    for original in ids:
        source = source.replace(f'id="{original}"', f'id="{identity}-{original}"').replace(
            f'url(#{original})', f'url(#{identity}-{original})')
    source = source.replace('<style>', '<style>svg[data-frame] *{animation-play-state:paused!important;'
                            'animation-delay:var(--frame-delay)!important}')
    return source.replace('<svg ', f'<svg data-frame="{identity}" '
                          f'style="--frame-delay:-{time}s;width:{width}px;height:auto" ', 1)


def expression_frames():
    return "".join(
        f'<figure>{frozen_frame("splash/ai-animated-light.svg", time, f"review-{index}")}'
        f'<figcaption>{time:g}s · {label}</figcaption></figure>'
        for index, (time, label) in enumerate((
            (1.5, "侧看"), (1.835, "短眨眼"), (2.976, "看圆点"),
            (3.52, "蓄力"), (3.82, "腾空笑眼"), (4.10, "落地轻压"),
            (4.27, "小回弹"), (4.9, "笑眼停留"), (5.7, "恢复常态"), (6.608, "收回"))))


def expression_sizes():
    return "".join(
        f'<div class="card {"dark" if theme == "dark" else ""}"><div class="sizes">' +
        "".join(f'<figure>{frozen_frame(f"splash/ai-animated-{theme}.svg", 4.9, f"size-{theme}-{w}", w)}'
                f'<figcaption>{w}px</figcaption></figure>' for w in (64, 32, 24, 20)) +
        f'{frozen_frame(f"logo-animated/aiscoo-animated-{theme}.svg", 4.9, f"header-{theme}", 240)}</div></div>'
        for theme in ("light", "dark"))


def sizes(name):
    return "".join(f'<figure>{img(name, f"width:{w}px")}<figcaption>{w}px</figcaption></figure>'
                   for w in (128, 64, 32, 20, 16))


CSS = """
:root{color-scheme:light}
body{margin:0;background:#E9EBEF;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#3F4652}
main{max-width:1120px;margin:0 auto;padding:32px 24px 48px;display:grid;gap:28px}
header h1{margin:0;font-size:22px;color:#121317}
header p{margin:4px 0 0;color:#6B7280}
section{display:grid;gap:12px}
h2{margin:0;font-size:15px;color:#121317}
.note{margin:0;color:#6B7280;font-size:13px}
.row{display:grid;gap:16px;grid-template-columns:1fr 1fr}
.row3{display:grid;gap:16px;grid-template-columns:repeat(3,1fr)}
.card{background:#fff;border-radius:16px;overflow:hidden;display:grid;place-items:center;min-height:120px}
.card.dark{background:#1C1C1E}
.card img{display:block;max-width:100%}
.wide img{width:100%}
iframe{display:block;width:100%;height:280px;border:0;border-radius:16px;background:#fff}
.sizes{display:flex;flex-wrap:wrap;justify-content:center;gap:28px;align-items:flex-end;padding:20px}
.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;background:white;border-radius:16px;padding:16px}
.frames svg{width:120px;height:120px}
figure{margin:0;display:grid;justify-items:center;gap:6px}
figcaption{font-size:12px;color:#9CA3AF}
table{border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden;font-size:13px}
td,th{padding:10px 14px;text-align:left;border-bottom:1px solid #EEF0F3}
th{color:#121317;font-weight:600}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#121317}
@media (max-width:720px){.row,.row3{grid-template-columns:1fr}}
"""

FILES = [
    ("应用图标 · macOS", "app-icon/macos/Aiscoo.icns（另附 Aiscoo.iconset）"),
    ("应用图标 · Windows", "app-icon/windows/Aiscoo.ico"),
    ("应用图标 · 原图", "app-icon/png/icon-light-1024.png / icon-dark-1024.png（含 SVG）"),
    ("应用 Logo · 静态", "logo/svg/aiscoo-light.svg / aiscoo-dark.svg，PNG：logo/png/aiscoo-*@2x.png"),
    ("应用 Logo · 动效", "logo-animated/aiscoo-animated-light.svg / aiscoo-animated-dark.svg"),
    ("启动页", "splash/splash.html（动效：splash/ai-animated-*.svg）"),
    ("ai 图形 · 缩起", "mark/svg/ai-light.svg / ai-dark.svg，PNG：mark/png/ai-*-512.png"),
]


def main():
    rows = "".join(f"<tr><td>{a}</td><td><code>{html.escape(b)}</code></td></tr>" for a, b in FILES)
    page = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Aiscoo Logo 预览</title>
<style>{CSS}</style></head><body><main>
<header><h1>Aiscoo Logo</h1><p>a 是躲在 i 后面的 AI：探出、张望、短眨眼、看圆点、开心弹跳、笑眼停留、缩回。10 秒一轮，缩回后停约 3.7 秒。</p></header>

<section><h2>应用 Logo · 动效</h2>
<div class="row"><div class="card wide">{img("logo-animated/aiscoo-animated-light.svg")}</div>
<div class="card wide dark">{img("logo-animated/aiscoo-animated-dark.svg")}</div></div></section>

<section><h2>表情分镜 · 同一条 10 秒时间轴</h2><div class="frames">{expression_frames()}</div></section>

<section><h2>笑眼 · 小尺寸与 240px 页头</h2><div class="row">{expression_sizes()}</div></section>

<section><h2>启动页</h2><p class="note">首帧和"减少动态效果"时显示收起状态。</p>
<div class="row">{splash("light")}{splash("dark")}</div></section>

<section><h2>启动页静态 Logo · 收起状态</h2>
<div class="row"><div class="card">{img("mark/svg/ai-light.svg", "width:180px")}</div>
<div class="card dark">{img("mark/svg/ai-dark.svg", "width:180px")}</div></div></section>

<section><h2>应用图标</h2>
<div class="row"><div class="card">{img("app-icon/png/icon-light.svg", "width:260px")}</div>
<div class="card">{img("app-icon/png/icon-dark.svg", "width:260px")}</div></div>
<div class="card"><div class="sizes">{sizes("app-icon/png/icon-light.svg")}{sizes("app-icon/png/icon-dark.svg")}</div></div></section>

<section><h2>应用 Logo · 静态</h2>
<div class="row"><div class="card wide">{img("logo/svg/aiscoo-light.svg")}</div>
<div class="card wide dark">{img("logo/svg/aiscoo-dark.svg")}</div></div></section>

<section><h2>文件清单</h2><p class="note">路径相对于本文件所在目录（docs/brand/aiscoo/）。</p>
<table><tr><th>用途</th><th>文件</th></tr>{rows}</table></section>
</main></body></html>
"""
    (PKG / "preview.html").write_text(page)
    print(f"preview.html {len(page) // 1024} KB")


if __name__ == "__main__":
    main()

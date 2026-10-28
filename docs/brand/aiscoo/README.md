# Aiscoo Logo · 最终版

打开 `preview.html` 可以一次看完所有效果，包括动效。这个文件已经内嵌了全部图片，单独发给别人也能正常打开。

## 设计说明

- 开头的 "a" 是一个躲在 "i" 后面的 AI，"i" 的竖笔就当作墙。
- 半圆形的头、"i" 的竖笔、后面的 s、c、o 三者顶部在同一条线上。
- 字母间距为 12（以字母高度 100 为单位）。
- 动效 8 秒一轮：AI 从 i 后面探出、张望、看 i 上的圆点，圆点跳一下，AI 眨眼后缩回，缩回后停约 3.7 秒。
- 静态 Logo、应用图标和启动页的第一帧都是缩起状态。
- 系统开启"减少动态效果"时，动效停在缩起状态。

## 文件

| 用途              | 文件                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| macOS 应用图标    | `app-icon/macos/Aiscoo.icns`，附 `Aiscoo.iconset`（16 到 1024 px）                      |
| Windows 应用图标  | `app-icon/windows/Aiscoo.ico`（16 到 256 px）                                           |
| 图标原图          | `app-icon/png/icon-light-1024.png`、`icon-dark-1024.png`，以及同名 SVG                  |
| 应用 Logo（静态） | `logo/svg/aiscoo-light.svg`、`aiscoo-dark.svg`；PNG 版为 `logo/png/aiscoo-*@2x.png`     |
| 应用 Logo（动效） | `logo-animated/aiscoo-animated-light.svg`、`aiscoo-animated-dark.svg`                   |
| 启动页            | `splash/splash.html`；动效图形为 `splash/ai-animated-light.svg`、`ai-animated-dark.svg` |
| 单独的 "ai" 图形  | `mark/svg/ai-light.svg`、`ai-dark.svg`；PNG 版为 `mark/png/ai-*-512.png`                |

- `light` 版用在浅色背景上（黑色字），`dark` 版用在深色背景上（白色字）。
- 动效 SVG 直接用 `<img src="...">` 引用就会播放，不需要 JavaScript。

## 修改与重新生成

`source/` 里是生成上面所有文件的脚本，需要 Python 3。

1. 修改 `source/ai.py` 顶部的参数：
   - `LETTER_GAP`：字母间距
   - `I_STEM_TOP, I_DOT_CY, I_DOT_R`：i 的高度和圆点
   - `ACTIVE, CYCLE`：动效节奏
2. 把 `splash/splash.html` 复制到 `source/`，因为 `make.py` 会把动效写进这个文件。
3. 在 `source/` 目录下运行 `python3 make.py`，生成所有 SVG 和 `splash.html`。
4. 运行 `python3 build_preview.py`，生成预览页。

`.png`、`.icns`、`.ico` 需要另外导出：用浏览器把 SVG 截成 PNG，再用 macOS 自带的 `iconutil` 生成 `.icns`。

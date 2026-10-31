#!/usr/bin/env python3
"""Refresh only the robot eye region of the approved raster designs.

Run after source/make.py, then run scripts/xcode/generate-icons.py.
Requires Pillow 12.1.0 and the workspace's @napi-rs/canvas 0.1.100.
The existing PNGs own the original browser-rendered shadow and edge alpha.
--template-root can point at a preserved copy of docs/brand/aiscoo;
--output-root exports in isolation, and --check never writes.
"""
import argparse
from io import BytesIO
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops, __version__ as pillow_version

SOURCE = Path(__file__).resolve().parent.parent
ROOT = SOURCE.parents[2]
# 原因：release 只维护 xcode 发布器；正式源与归档镜像共用同一个生成实现。
SPEC = importlib.util.spec_from_file_location("aiscoo_assets", ROOT / "scripts/xcode/generate-icons.py")
ASSETS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSETS)
NS = "{http://www.w3.org/2000/svg}"
ET.register_namespace("", "http://www.w3.org/2000/svg")


def eye_mask(svg):
    tree = ET.fromstring(svg)
    parents = {child: parent for parent in tree.iter() for child in parent}
    eyes = [element for element in tree.iter() if element.get("class") == "eyes"]
    if len(eyes) != 1:
        raise ValueError("Expected one static robot eye group")
    keep = {eyes[0]}
    current = eyes[0]
    while current in parents:
        current = parents[current]
        keep.add(current)
    for parent in list(tree.iter()):
        if parent not in keep:
            continue
        for child in list(parent):
            if child not in keep and child.tag != NS + "defs":
                parent.remove(child)
    # 原因：旧椭圆比新胶囊宽；mask 同时包住两者及抗锯齿，避免留下旧眼睛。
    # 只保留原有变换和裁切链，因此不会覆盖 i、其余字母、圆角底与阴影。
    ET.SubElement(eyes[0], NS + "rect", {
        "x": "23", "y": "46", "width": "33", "height": "22", "fill": "#FFFFFF",
    })
    return ET.tostring(tree, encoding="unicode")


def replace_eyes(original, rendered, mask):
    updated = original.copy()
    updated.paste(rendered, (0, 0), mask)
    updated.putalpha(original.getchannel("A"))
    outside = ImageChops.multiply(ImageChops.difference(original, updated).convert("RGB"),
                                  ImageChops.invert(mask).convert("RGB"))
    if outside.getbbox() is not None:
        raise RuntimeError("Unexpected change outside eye region")
    return updated


def raster_outputs(template_root):
    if pillow_version != ASSETS.PILLOW_VERSION:
        raise RuntimeError(f"Expected Pillow {ASSETS.PILLOW_VERSION}, got {pillow_version}")
    pairs = [(f"app-icon/png/icon-{theme}.svg", f"app-icon/png/icon-{theme}-1024.png")
             for theme in ("light", "dark")]
    pairs += [(f"{kind}/svg/{name}-{theme}.svg", f"{kind}/png/{name}-{theme}{suffix}.png")
              for theme in ("light", "dark")
              for kind, name, suffix in (("mark", "ai", "-512"), ("logo", "aiscoo", "@2x"))]
    outputs = {}
    for svg_path, png_path in pairs:
        original = ASSETS.clean_image((template_root / png_path).read_bytes())
        tree = ET.fromstring((SOURCE / svg_path).read_text())
        # 按目标分辨率栅格化矢量，避免先以 172px 渲染再放大造成胶囊边缘模糊。
        tree.set("width", str(original.width))
        tree.set("height", str(original.height))
        svg = ET.tostring(tree, encoding="unicode")
        rendered, mask_data = ASSETS.rasterize([
            {"svg": svg, "width": original.width, "height": original.height},
            {"svg": eye_mask(svg), "width": original.width, "height": original.height},
        ])
        # 原因：SVG 渲染器不支持原稿投影；整图重绘还会改变字母和边缘抗锯齿。
        # 仅替换脸内眼区 RGB，连原 PNG 的半透明边缘与 alpha 都逐像素保留。
        mask = ASSETS.clean_image(mask_data).getchannel("A").point(lambda value: 255 if value else 0)
        outputs[Path(png_path)] = ASSETS.png(replace_eyes(original, ASSETS.clean_image(rendered), mask))
        if png_path == "app-icon/png/icon-light-1024.png":
            app_mask = mask
    app = ASSETS.clean_image(outputs[Path("app-icon/png/icon-light-1024.png")])
    # 原因：原 iconset 来自浏览器，不能用另一种缩放器重建整张而改变阴影。
    # 每档沿用原像素，仅眼区使用新版 1024 图的缩放结果；保留原始 alpha。
    sizes = (16, 32, 48, 64, 128, 256, 512, 1024)
    scaled = {size: app.resize((size, size), Image.Resampling.LANCZOS) for size in sizes}
    # mask 用最近邻缩放，避免 Lanczos 振铃把局部覆盖扩散到 i 或圆形轮廓。
    masks = {size: app_mask.resize((size, size), Image.Resampling.NEAREST) for size in sizes}
    iconset = Path("app-icon/macos/Aiscoo.iconset")
    for points in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            relative = iconset / f"icon_{points}x{points}{'@2x' if scale == 2 else ''}.png"
            original = ASSETS.clean_image((template_root / relative).read_bytes())
            size = points * scale
            outputs[relative] = ASSETS.png(replace_eyes(original, scaled[size], masks[size]))
    with tempfile.TemporaryDirectory(prefix="aiscoo-iconset-") as temporary:
        directory = Path(temporary)
        for relative, data in outputs.items():
            if relative.parent == iconset:
                target = directory / "Aiscoo.iconset" / relative.name
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(data)
        target = directory / "Aiscoo.icns"
        subprocess.run(["iconutil", "-c", "icns", str(directory / "Aiscoo.iconset"), "-o", str(target)],
                       check=True, capture_output=True, timeout=30)
        outputs[Path("app-icon/macos/Aiscoo.icns")] = target.read_bytes()
    frames = []
    with Image.open(template_root / "app-icon/windows/Aiscoo.ico") as container:
        for size, _ in sorted(container.ico.sizes()):
            frame = container.ico.getimage((size, size)).convert("RGBA")
            frames.append(replace_eyes(frame, scaled[size], masks[size]))
    stream = BytesIO()
    frames[-1].save(stream, format="ICO", sizes=[frame.size for frame in frames], append_images=frames)
    outputs[Path("app-icon/windows/Aiscoo.ico")] = stream.getvalue()
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template-root", type=Path, default=SOURCE)
    parser.add_argument("--output-root", type=Path, default=SOURCE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = raster_outputs(args.template_root)
    mismatches = []
    for relative, data in sorted(generated.items()):
        target = args.output_root / relative
        if args.check:
            if not target.is_file() or target.read_bytes() != data:
                mismatches.append(str(relative))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    if mismatches:
        sys.stderr.write("Raster designs differ:\n" + "\n".join(mismatches) + "\n")
        return 1
    print(f"{'Verified' if args.check else 'Exported'} {len(generated)} raster designs; original alpha and pixels outside eyes preserved")
    return 0


if __name__ == "__main__":
    sys.exit(main())

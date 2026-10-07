"""XCODE: regenerate X lettermark assets without changing the original icon backdrop.
Requires Pillow. Run from the repository root; existing assets supply the backdrops.
"""
from PIL import Image, ImageDraw, ImageFont

POLYGONS = [((154, 0), (256, 0), (102, 218), (0, 218)),
            ((0, 0), (82, 0), (111, 41), (70, 99)),
            ((186, 119), (256, 218), (174, 218), (145, 177))]


def replace_mark(path, box):
    image = Image.open(path).convert('RGBA')
    x0, y0, x1, y1 = box
    # Preserve the original exterior, alpha, rounded corners and packaging.
    for y in range(y0, y1 + 1):
        left, right = image.getpixel((x0 - 12, y)), image.getpixel((x1 + 12, y))
        for x in range(x0, x1 + 1):
            t = (x - x0) / (x1 - x0)
            image.putpixel((x, y), tuple(round(a * (1 - t) + b * t) for a, b in zip(left, right)))
    mask = Image.new('L', (1024 * 4, 1024 * 4))
    draw = ImageDraw.Draw(mask)
    for polygon in POLYGONS:
        draw.polygon([((x0 + x / 256 * (x1 - x0)) * 4,
                       (y0 + y / 218 * (y1 - y0)) * 4) for x, y in polygon], fill=255)
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)
    image.paste(Image.new('RGBA', image.size, 'white'), (0, 0), mask)
    image.save(path)
    return image


app = replace_mark('packages/desktop/build/icon.png', (256, 294, 768, 730))
windows = replace_mark('packages/desktop/build/icon_windows.png', (159, 212, 865, 813))
installer = replace_mark('packages/desktop/build/icon_installer.png', (319, 426, 730, 783))
for directory in ('packages/desktop/build/icons', 'public/logo/icons'):
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        app.resize((size, size), Image.Resampling.LANCZOS).save(f'{directory}/{size}x{size}.png')
app.save('public/icon_512@2x.png')
for path in ('packages/desktop/build/icon.icns', 'public/logo/icons/icon.icns'):
    app.save(path, format='ICNS')
for path in ('packages/desktop/build/icon.ico', 'public/logo/icons/icon.ico', 'packages/web/public/favicon.ico'):
    windows.save(path, format='ICO', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
installer.save('packages/desktop/build/icon_installer.icns', format='ICNS')
installer.save('packages/desktop/build/icon_installer.ico', format='ICO', sizes=[(s, s) for s in (16, 32, 48, 64, 128, 256)])
# XCODE: DMG 包装背景中的组合字标也属于品牌图形，必须显示 XWORK。
for path, scale in (('packages/desktop/build/dmg_background.png', 1),
                    ('packages/desktop/build/dmg_background@2x.png', 2)):
    image = Image.open(path).convert('RGBA')
    background = image.getpixel((170 * scale, 75 * scale))
    ImageDraw.Draw(image).rectangle(
        (170 * scale, 72 * scale, 370 * scale, 124 * scale), fill=background)
    font = ImageFont.load_default(size=38 * scale)
    ImageDraw.Draw(image).text(
        (173 * scale, 74 * scale), 'XWORK', font=font, fill='#333333',
        stroke_width=1 * scale, stroke_fill='#333333')
    image.save(path)
print('Generated XWork desktop, installer, web and public icons')

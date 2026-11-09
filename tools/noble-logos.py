#!/usr/bin/env python3
"""FC 卡机构徽标的生成脚本。

原始 mark 从各学会官网 / Wikimedia 抓来放在 assets/nobles-raw/，
深浅、底色、比例都不统一（AAAI、AE 官方给的是白字版，中科院那张是白底），
直接贴到藏青卡面上要么糊掉要么变成一块白斑。

所以统一压成米色墨章：有 alpha 的地方落墨，接近纯白的地方镂空 ——
ACM 菱形里的白字、中科院的白底、NAS 金盘里的白人都会自动变成透空的细节，
不需要逐张抠图。AAAI、AE 是反过来的（白纸上印深色线稿），镂空方向也得跟着反过来。

改完 raw/ 重跑：python3 tools/noble-logos.py
"""
import os
import sys
from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets/nobles-raw')
OUT = os.path.join(ROOT, 'client/public/images/nobles')
CREAM = (236, 227, 200)
SIZE = 200
# 亮度低于 KNOCK_LO 的算墨，高于 KNOCK_HI 的镂空（ACM 白字、中科院白底、NAS 白人都走镂空这条路）
KNOCK_LO, KNOCK_HI = 200, 255
# 官方给的是白底白字版（AAAI、AE）：图案是"白纸上的深色墨线"，
# 所以取反方向 —— 越亮越吃墨，深色线条镂空。其余是深色 mark 压在透明/白底上，越暗越吃墨。
LIGHT_MARKS = {'aaai', 'ae'}

# 宽 lockup 在 39px 下只剩一条糊线，裁出 symbol 那格（比例，不是像素）
CROP = {'ieee': (0.0, 0.0, 0.30, 0.57)}


def mono(im, key):
    """把彩色/白底 mark 压成一通道米色墨：alpha 决定有没有墨，亮度决定往哪边镂空。"""
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    alpha = im.split()[3]
    lum = im.convert('L')
    if key in LIGHT_MARKS:
        ramp = lum.point(lambda v: 0 if v <= 128 else min(255, int(255 * (v - 128) / 92)))
    else:
        ramp = lum.point(lambda v: 255 if v <= KNOCK_LO else int(255 * (KNOCK_HI - v) / (KNOCK_HI - KNOCK_LO)))
    return ImageChops.multiply(alpha, ramp)


def trim_pad_square(ink):
    box = ink.getbbox()
    if not box:
        raise ValueError('empty mark')
    ink = ink.crop(box)
    w, h = ink.size
    side = max(w, h)
    margin = int(side * 0.06)
    canvas = Image.new('L', (side + 2 * margin, side + 2 * margin), 0)
    canvas.paste(ink, (margin + (side - w) // 2, margin + (side - h) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    if not os.path.isdir(RAW):
        sys.exit(f'缺少原始 mark 目录：{RAW}')
    done = []
    for name in sorted(os.listdir(RAW)):
        if not name.endswith('.png'):
            continue
        key = name[:-4]
        im = Image.open(os.path.join(RAW, name))
        if key in CROP:
            x0, y0, x1, y1 = CROP[key]
            im = im.crop((int(im.width * x0), int(im.height * y0),
                          int(im.width * x1), int(im.height * y1)))
        ink = mono(im, key)
        flat = Image.merge('RGB', [Image.new('L', (SIZE, SIZE), v) for v in CREAM])
        out = Image.merge('RGBA', [*flat.split(), trim_pad_square(ink)])
        out.save(os.path.join(OUT, f'{key}.png'))
        done.append(key)
    print(f'生成 {len(done)} 张：{", ".join(done)}')


if __name__ == '__main__':
    main()

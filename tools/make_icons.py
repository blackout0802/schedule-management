#!/usr/bin/env python3
"""ホーム画面に追加するときのアイコン（PNG）を作る。  python3 tools/make_icons.py
  public/assets/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
図柄: 青地に、4色（青・橙・緑・紫）のマスのカレンダー。色や図柄を変えたいときは、このファイルを書き換えて、もう一度実行する。"""
import os
from PIL import Image, ImageDraw

BLUE = (33, 85, 214)
QUAD = [(33, 85, 214), (255, 150, 60), (30, 170, 120), (150, 90, 220)]  # 青・橙・緑・紫
PASTEL = [(190, 208, 248), (255, 214, 178), (186, 234, 214), (222, 204, 248)]  # マスの淡い色
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'public', 'assets', 'icons')
os.makedirs(out, exist_ok=True)


def draw_icon(size, rounded=True, glyph_scale=0.64):
    S = 4  # 4倍で描いて縮める（ギザギザを減らす）
    n = size * S
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=BLUE)
    else:
        d.rectangle([0, 0, n, n], fill=BLUE)  # 角丸にしない（端末側で形に切り抜かれる）
    g = int(n * glyph_scale)
    x0, y0 = (n - g) // 2, (n - g) // 2 + int(n * 0.01)
    r = int(g * 0.12)
    h = int(g * 0.26)
    head, body = (214, 226, 252), (255, 255, 255)
    d.rounded_rectangle([x0, y0, x0 + g, y0 + g], radius=r, fill=body)
    d.rounded_rectangle([x0, y0, x0 + g, y0 + h + r], radius=r, fill=head)
    d.rectangle([x0, y0 + h, x0 + g, y0 + h + r], fill=body)
    d.rectangle([x0, y0 + h - 1, x0 + g, y0 + h + 3], fill=head)
    for dx in (0.26, 0.74):  # とじ金
        cx = x0 + int(g * dx)
        d.rounded_rectangle([cx - int(g * 0.035), y0 - int(g * 0.07), cx + int(g * 0.035), y0 + int(g * 0.11)], radius=int(g * 0.035), fill=BLUE)
    gx, gy = x0 + int(g * 0.12), y0 + h + int(g * 0.10)
    cell = int(g * 0.76 / 4)
    for row in range(3):
        for col in range(4):
            c = QUAD[(row + col) % 4] if (row, col) == (1, 2) else PASTEL[(row * 4 + col) % 4]
            cx, cy = gx + col * cell, gy + row * int(cell * 0.92)
            d.rounded_rectangle([cx + 2 * S, cy + 2 * S, cx + cell - 4 * S, cy + int(cell * 0.92) - 4 * S], radius=int(cell * 0.12), fill=c)
    return img.resize((size, size), Image.LANCZOS)


draw_icon(192).save(os.path.join(out, 'icon-192.png'))
draw_icon(512).save(os.path.join(out, 'icon-512.png'))
draw_icon(512, rounded=False, glyph_scale=0.52).save(os.path.join(out, 'icon-maskable-512.png'))  # Android が丸・角丸などに切り抜いても、図柄が欠けない余白
draw_icon(180, rounded=False, glyph_scale=0.62).convert('RGB').save(os.path.join(out, 'apple-touch-icon.png'))  # iPhone は角を自分で丸める
print('icons:', sorted(os.listdir(out)))

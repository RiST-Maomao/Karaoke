# アイコン生成（Pillow）：暖色グラデーションの角丸に、音程カーブと声の波紋
from PIL import Image, ImageDraw, ImageFilter
import math

def make(size):
    S = size * 4
    img = Image.new('RGBA', (S, S), (20, 18, 26, 255))
    # 対角グラデーション
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    c1, c2 = (255, 143, 107), (255, 196, 138)
    for y in range(S):
        for x in range(0, S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    img = grad
    d = ImageDraw.Draw(img)
    ink = (43, 19, 10, 255)
    # 音程カーブ（ビブラート付きのロングトーン）
    pts = []
    for i in range(0, 1001):
        u = i / 1000
        x = S * (0.16 + 0.68 * u)
        if u < 0.25:
            yv = 0.62 - 0.22 * (u / 0.25) ** 0.6
        elif u < 0.55:
            yv = 0.40
        else:
            yv = 0.40 + 0.045 * math.sin((u - 0.55) * 2 * math.pi * 5.5) * min(1, (u - 0.55) / 0.12)
        pts.append((x, S * yv))
    w2 = S * 0.03
    for (x, y) in pts:
        d.ellipse([x - w2, y - w2, x + w2, y + w2], fill=ink)
    r = S * 0.045
    x0, y0 = pts[0]
    d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=ink)
    x1, y1 = pts[-1]
    d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=ink)
    # 下部の 3 本バー（聞き心地メーター）
    for k, hgt in enumerate([0.08, 0.13, 0.18]):
        bx = S * (0.36 + k * 0.11)
        d.rounded_rectangle([bx, S * (0.80 - hgt), bx + S * 0.07, S * 0.80], radius=S * 0.03, fill=ink)
    return img.resize((size, size), Image.LANCZOS)

for s in (180, 192, 512):
    make(s).convert('RGB').save(f'icons/icon-{s}.png')
print('ok')

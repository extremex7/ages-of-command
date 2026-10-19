"""Draws the Ages of Command icon (a gold globe with a star on a navy shield) and writes
launcher/icon/icon.png (256 px), icon.ico (16-256 px) and styles/icon.png (the page favicon).
Usage: python3 tools/make_icon.py   (needs Pillow; only for rebuilding the icon)"""
import math, os
from PIL import Image, ImageDraw

root = os.path.join(os.path.dirname(__file__), '..')
S = 1024  # draw large, scale down
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
navy, gold, light = (22, 36, 64, 255), (226, 178, 74, 255), (250, 226, 160, 255)
d.rounded_rectangle([40, 40, S - 40, S - 40], radius=200, fill=navy)
c, r, w = S // 2, 330, 34
d.ellipse([c - r, c - r, c + r, c + r], outline=gold, width=w)
for k in (0.45, 0.85):  # meridians
    d.ellipse([c - r * k, c - r, c + r * k, c + r], outline=gold, width=w - 8)
d.line([c, c - r, c, c + r], fill=gold, width=w - 8)
for y in (-0.5, 0, 0.5):  # parallels
    half = r * math.sqrt(1 - y * y)
    d.line([c - half, c + y * r, c + half, c + y * r], fill=gold, width=w - 8)
pts = []  # five-pointed star at the top right
sx, sy, R = c + 255, c - 255, 150
for i in range(10):
    a = -math.pi / 2 + i * math.pi / 5
    rr = R if i % 2 == 0 else R * 0.42
    pts.append((sx + rr * math.cos(a), sy + rr * math.sin(a)))
d.ellipse([sx - R * 1.05, sy - R * 1.05, sx + R * 1.05, sy + R * 1.05], fill=navy)
d.polygon(pts, fill=light)

big = img.resize((256, 256), Image.LANCZOS)
out = os.path.join(root, 'launcher', 'icon')
os.makedirs(out, exist_ok=True)
big.save(os.path.join(out, 'icon.png'))
big.save(os.path.join(out, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((64, 64), Image.LANCZOS).save(os.path.join(root, 'styles', 'icon.png'))
print('icons written')

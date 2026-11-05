from PIL import Image, ImageDraw, ImageFont
import os

os.makedirs('icons', exist_ok=True)
W = 512
img = Image.new('RGB', (W, W), '#a63a2a')
d = ImageDraw.Draw(img)
# subtle darker bottom band
for y in range(W):
    t = y / W
    r = int(166 - 30 * t)
    g = int(58 - 18 * t)
    b = int(42 - 12 * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))
# gold ring
d.ellipse([54, 54, W-54, W-54], outline='#d8b46a', width=4)
# text
font = None
for p in ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc']:
    try:
        font = ImageFont.truetype(p, 248)
        break
    except Exception:
        pass
if font is None:
    font = ImageFont.load_default()
text = '研'
bbox = d.textbbox((0, 0), text, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
d.text(((W - tw) / 2 - bbox[0], (W - th) / 2 - bbox[1] - 8), text, font=font, fill='#fff8ec')
# small dot
d.ellipse([W//2-7, W-108, W//2+7, W-94], fill='#d8b46a')
img.save('icons/icon-512.png')
img.resize((192, 192), Image.LANCZOS).save('icons/icon-192.png')
img.resize((180, 180), Image.LANCZOS).save('icons/apple-touch-icon.png')
img.resize((32, 32), Image.LANCZOS).save('icons/favicon-32.png')
print('icons written')

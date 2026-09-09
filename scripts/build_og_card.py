#!/usr/bin/env python3
"""
build_og_card.py — the image a shared link shows.

WHY. The site had no og: tags and no card, so a link pasted into WhatsApp,
Facebook or a newsroom Slack rendered as a bare URL. This site spreads by people
passing links to each other; an unpreviewable link is a broken channel.

The card is generated here and served from our own origin. No third-party card
service, for the same reason there is no font CDN: it would hand someone the
referrer list of a site about police misconduct.

    python3 scripts/build_og_card.py --demo      # while the data is synthetic
    python3 scripts/build_og_card.py             # once it is real

Needs pillow and the merged font that scripts/build_glyphs.sh produces; any
font with Bengali coverage works if you point --font at it.
"""
import argparse, pathlib
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG, INK, DIM, ACCENT, WARN = (15, 17, 19), (233, 237, 241), (152, 162, 173), \
                             (217, 139, 58), (201, 86, 75)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='web/static/og.png')
    ap.add_argument('--font', default='/tmp/nirapod-sans.ttf')
    ap.add_argument('--demo', action='store_true',
                    help='stamp DEMO on the card; use while figures are synthetic')
    a = ap.parse_args()

    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype(a.font, 74)
    mid = ImageFont.truetype(a.font, 40)
    sm = ImageFont.truetype(a.font, 28)

    # A faint street-grid texture, so the card is not a flat rectangle.
    for x in range(0, W, 60):
        d.line([(x, 0), (x - 160, H)], fill=(26, 30, 34), width=2)
    for y in range(120, H, 90):
        d.line([(0, y), (W, y)], fill=(23, 26, 29), width=2)
    d.rectangle([0, 0, 14, H], fill=ACCENT)

    top = 92
    if a.demo:
        # The DEMO marker has to survive a link preview, which is one of the two
        # places a screenshot warning cannot reach (the other is the browser tab,
        # which the <title> covers).
        d.rectangle([0, 0, W, 56], fill=WARN)
        d.text((70, 12), 'ডেমো · কোনো সংখ্যাই প্রকৃত নয় · DEMO, all figures synthetic',
               font=sm, fill=(20, 9, 8))
        top = 120

    d.text((70, top), 'নিরাপদ.site', font=big, fill=INK)
    d.text((70, top + 113), 'ছিনতাই হয়েছে? চাঁদা চেয়েছে?', font=mid, fill=INK)
    d.text((70, top + 170), 'রাস্তার বাতি নষ্ট?', font=mid, fill=INK)
    d.text((70, top + 253), 'আপনার এলাকার কথা আপনিই জানেন। লিখে রাখুন।', font=sm, fill=DIM)
    d.text((70, top + 303), 'Area-level street safety reports for Dhaka', font=sm, fill=DIM)

    y = top + 378
    d.rounded_rectangle([70, y, 470, y + 70], radius=35, fill=ACCENT)
    d.text((110, y + 18), 'বেনামী · দুই মিনিট', font=sm, fill=(23, 19, 10))
    d.text((500, y + 18), 'অ্যাকাউন্ট লাগবে না', font=sm, fill=DIM)

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f'wrote {out} ({W}x{H}, demo={a.demo})')

if __name__ == '__main__':
    main()

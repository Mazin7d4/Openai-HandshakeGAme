#!/usr/bin/env python3
"""
Generate ship-ready contact sheets for PIX & NEE art review.
Outputs:
1. /workspace/handshake/playtest/oct26/art/final-before-after-floor1.png
2. /workspace/handshake/playtest/oct26/art/final-before-after-all.png
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ART_DIR = '/workspace/handshake/playtest/oct26/art'

FONT_PATH = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
FONT_REGULAR = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'

def get_font(size, bold=True):
    try:
        path = FONT_PATH if bold else FONT_REGULAR
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def find_image(prefix_list, spot, ext='.png'):
    for p in prefix_list:
        path = os.path.join(ART_DIR, f"{p}-{spot}{ext}")
        if os.path.exists(path):
            return path
    return None

def build_floor1_sheet():
    spots = [
        ('apron', 'Apron (Arrival Loading)'),
        ('reception', 'Reception Lobby'),
        ('vent', 'Vent Shaft Infiltration'),
        ('office', 'Open Office Workspace'),
        ('strip-locked', 'Checkpoint (Locked Forward Strip)'),
        ('strip-unlocked', 'Checkpoint (Unlocked Forward Strip)'),
        ('server', 'Server Core Rack Rows'),
        ('memory-array', 'Memory Array Vault'),
        ('lab', 'R&D Prototype Lab'),
        ('dock', 'Extraction Loading Dock'),
    ]

    # Layout: 5 rows x 2 pairs (4 columns: [Before, After] [Before, After])
    cols_per_row = 2
    thumb_w, thumb_h = 640, 360
    card_padding = 16
    header_h = 44
    title_h = 90
    pair_w = thumb_w * 2 + card_padding
    pair_h = thumb_h + header_h

    total_w = card_padding + cols_per_row * (pair_w + card_padding)
    num_rows = (len(spots) + cols_per_row - 1) // cols_per_row
    total_h = title_h + num_rows * (pair_h + card_padding) + card_padding

    canvas = Image.new('RGB', (total_w, total_h), color=(14, 16, 20))
    draw = ImageDraw.Draw(canvas)

    title_font = get_font(32, bold=True)
    subtitle_font = get_font(18, bold=False)
    header_font = get_font(18, bold=True)
    badge_font = get_font(14, bold=True)

    # Title block
    draw.text((card_padding, 18), "PIX & NEE — Floor 1 Heist Visual Upgrade (Before vs After)", fill=(240, 240, 245), font=title_font)
    draw.text((card_padding, 56), "Approved Pass 1 vs Pass 2 Ship-Ready Neutral Art | Non-Glowing Architectural Palette & Scoped Lighting", fill=(140, 150, 165), font=subtitle_font)

    before_prefixes = [
        'before-medium-1280x720',
        'before-low-1280x720',
    ]
    after_prefixes = [
        'final-medium-1280x720',
        'final-low-1280x720',
    ]

    for idx, (spot_id, label) in enumerate(spots):
        row = idx // cols_per_row
        col = idx % cols_per_row
        x0 = card_padding + col * (pair_w + card_padding)
        y0 = title_h + row * (pair_h + card_padding)

        # Header background card
        draw.rectangle([x0, y0, x0 + pair_w, y0 + header_h], fill=(24, 28, 36))
        draw.text((x0 + 12, y0 + 12), label, fill=(230, 235, 245), font=header_font)

        # Before & After tags
        draw.rectangle([x0 + thumb_w - 90, y0 + 10, x0 + thumb_w - 10, y0 + 34], fill=(80, 36, 36))
        draw.text((x0 + thumb_w - 82, y0 + 13), "BEFORE", fill=(255, 180, 180), font=badge_font)

        draw.rectangle([x0 + pair_w - 80, y0 + 10, x0 + pair_w - 10, y0 + 34], fill=(28, 70, 48))
        draw.text((x0 + pair_w - 72, y0 + 13), "AFTER", fill=(160, 245, 190), font=badge_font)

        # Load Before image
        before_path = find_image(before_prefixes, spot_id)
        if before_path:
            with Image.open(before_path) as im:
                im_thumb = im.convert('RGB').resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                canvas.paste(im_thumb, (x0, y0 + header_h))
        else:
            draw.rectangle([x0, y0 + header_h, x0 + thumb_w, y0 + header_h + thumb_h], fill=(30, 30, 30))
            draw.text((x0 + 20, y0 + header_h + 20), f"Missing before: {spot_id}", fill=(200, 100, 100), font=badge_font)

        # Load After image
        after_path = find_image(after_prefixes, spot_id)
        if after_path:
            with Image.open(after_path) as im:
                im_thumb = im.convert('RGB').resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                canvas.paste(im_thumb, (x0 + thumb_w + card_padding, y0 + header_h))
        else:
            draw.rectangle([x0 + thumb_w + card_padding, y0 + header_h, x0 + pair_w, y0 + header_h + thumb_h], fill=(30, 30, 30))
            draw.text((x0 + thumb_w + card_padding + 20, y0 + header_h + 20), f"Missing after: {spot_id}", fill=(200, 100, 100), font=badge_font)

    out_path = os.path.join(ART_DIR, 'final-before-after-floor1.png')
    canvas.save(out_path, format='PNG', optimize=True)
    print(f"Saved: {out_path} ({total_w}x{total_h})")

def build_all_sheet():
    spots = [
        ('title', 'Title & Attract Screen'),
        ('apron', 'Floor 1: Apron Arrival'),
        ('reception', 'Floor 1: Reception Lobby'),
        ('vent', 'Floor 1: Vent Shaft'),
        ('office', 'Floor 1: Open Office'),
        ('strip-locked', 'Floor 1: Checkpoint Locked'),
        ('strip-unlocked', 'Floor 1: Checkpoint Unlocked'),
        ('server', 'Floor 1: Server Core'),
        ('memory-array', 'Floor 1: Memory Array'),
        ('lab', 'Floor 1: R&D Prototype Lab'),
        ('dock', 'Floor 1: Extraction Dock'),
        ('nightshift-floor2', 'Night Shift: Floor 2'),
        ('nightshift-floor3', 'Night Shift: Floor 3'),
        ('nightshift-floor4', 'Night Shift: Floor 4'),
        ('nightshift-floor5', 'Night Shift: Floor 5'),
        ('nightshift-floor6', 'Night Shift: Floor 6'),
        ('nightshift-floor7', 'Night Shift: Floor 7'),
        ('nightshift-floor8', 'Night Shift: Floor 8'),
        ('nightshift-floor9', 'Night Shift: Floor 9'),
        ('nightshift-floor10', 'Night Shift: Floor 10'),
        ('nightshift-floor11', 'Night Shift: Floor 11'),
        ('nightshift-floor12', 'Night Shift: Floor 12'),
        ('report', 'Heist Report Summary'),
    ]

    # Layout: 3 pairs per row across 8 rows
    cols_per_row = 3
    thumb_w, thumb_h = 440, 248
    card_padding = 14
    header_h = 36
    title_h = 85
    pair_w = thumb_w * 2 + 8
    pair_h = thumb_h + header_h

    total_w = card_padding + cols_per_row * (pair_w + card_padding)
    num_rows = (len(spots) + cols_per_row - 1) // cols_per_row
    total_h = title_h + num_rows * (pair_h + card_padding) + card_padding

    canvas = Image.new('RGB', (total_w, total_h), color=(14, 16, 20))
    draw = ImageDraw.Draw(canvas)

    title_font = get_font(30, bold=True)
    subtitle_font = get_font(16, bold=False)
    header_font = get_font(15, bold=True)
    badge_font = get_font(12, bold=True)

    draw.text((card_padding, 16), "PIX & NEE — Full Visual Transformation Contact Sheet (Before vs After)", fill=(240, 240, 245), font=title_font)
    draw.text((card_padding, 52), "All 23 Views: Title, Floor 1 Heist Rooms, Night Shift Floors 2-12, and Heist Report | Neutral PBR, Desaturated Decor", fill=(140, 150, 165), font=subtitle_font)

    before_prefixes = [
        'before-medium-1280x720',
        'before-low-1280x720',
        'before-low-844x390',
    ]
    after_prefixes = [
        'final-medium-1280x720',
        'final-low-1280x720',
        'final-medium-844x390',
        'final-low-844x390',
    ]

    for idx, (spot_id, label) in enumerate(spots):
        row = idx // cols_per_row
        col = idx % cols_per_row
        x0 = card_padding + col * (pair_w + card_padding)
        y0 = title_h + row * (pair_h + card_padding)

        draw.rectangle([x0, y0, x0 + pair_w, y0 + header_h], fill=(24, 28, 36))
        draw.text((x0 + 10, y0 + 10), label, fill=(230, 235, 245), font=header_font)

        # Before / After chips
        draw.rectangle([x0 + thumb_w - 74, y0 + 8, x0 + thumb_w - 6, y0 + 28], fill=(70, 30, 30))
        draw.text((x0 + thumb_w - 68, y0 + 10), "BEFORE", fill=(255, 180, 180), font=badge_font)

        draw.rectangle([x0 + pair_w - 68, y0 + 8, x0 + pair_w - 6, y0 + 28], fill=(24, 64, 42))
        draw.text((x0 + pair_w - 62, y0 + 10), "AFTER", fill=(160, 245, 190), font=badge_font)

        before_path = find_image(before_prefixes, spot_id)
        if before_path:
            with Image.open(before_path) as im:
                im_thumb = im.convert('RGB').resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                canvas.paste(im_thumb, (x0, y0 + header_h))
        else:
            draw.rectangle([x0, y0 + header_h, x0 + thumb_w, y0 + header_h + thumb_h], fill=(30, 30, 30))
            draw.text((x0 + 10, y0 + header_h + 10), f"No before: {spot_id}", fill=(200, 100, 100), font=badge_font)

        after_path = find_image(after_prefixes, spot_id)
        if after_path:
            with Image.open(after_path) as im:
                im_thumb = im.convert('RGB').resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                canvas.paste(im_thumb, (x0 + thumb_w + 8, y0 + header_h))
        else:
            draw.rectangle([x0 + thumb_w + 8, y0 + header_h, x0 + pair_w, y0 + header_h + thumb_h], fill=(30, 30, 30))
            draw.text((x0 + thumb_w + 18, y0 + header_h + 10), f"No after: {spot_id}", fill=(200, 100, 100), font=badge_font)

    out_path = os.path.join(ART_DIR, 'final-before-after-all.png')
    canvas.save(out_path, format='PNG', optimize=True)
    print(f"Saved: {out_path} ({total_w}x{total_h})")

if __name__ == '__main__':
    build_floor1_sheet()
    build_all_sheet()

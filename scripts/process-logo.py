#!/usr/bin/env python3
"""
Logo processing script for Serial Helper.
Converts a source PNG to the required icon sizes, removing near-black
background pixels (making them transparent).

Usage:
    python scripts/process-logo.py <source.png> [--threshold N] [--dry-run]

Output:
    src-tauri/icons/32x32.png
    src-tauri/icons/128x128.png
    src-tauri/icons/128x128@2x.png
    src-tauri/icons/icon.ico
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = PROJECT_ROOT / "src-tauri" / "icons"

ICON_SPECS = [
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
]


def remove_black_background(img: Image.Image, threshold: int) -> Image.Image:
    """Make near-black pixels transparent. Returns a new RGBA image."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r <= threshold and g <= threshold and b <= threshold:
                pixels[x, y] = (r, g, b, 0)

    return img


def generate_icons(src_path: Path, threshold: int, dry_run: bool) -> None:
    print(f"Loading: {src_path}")
    img = Image.open(src_path)
    print(f"  Size: {img.size}, Mode: {img.mode}")

    print(f"Removing near-black (<= {threshold}) background...")
    img = remove_black_background(img, threshold)

    # Resize to a reasonable base size for the ICO (256px max)
    base = img.copy()
    base.thumbnail((256, 256), Image.LANCZOS)

    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    for filename, size in ICON_SPECS:
        out_path = ICONS_DIR / filename
        resized = img.resize((size, size), Image.LANCZOS)
        if dry_run:
            print(f"  [DRY RUN] Would save: {out_path} ({size}x{size})")
        else:
            resized.save(out_path, "PNG")
            print(f"  Saved: {out_path} ({size}x{size})")

    ico_path = ICONS_DIR / "icon.ico"
    if dry_run:
        print(f"  [DRY RUN] Would save: {ico_path}")
    else:
        base.save(ico_path, "ICO", sizes=[(256, 256)])
        print(f"  Saved: {ico_path}")

    # Also update root logo.png with the processed version
    root_logo = PROJECT_ROOT / "logo.png"
    if dry_run:
        print(f"  [DRY RUN] Would update: {root_logo}")
    else:
        img.save(root_logo, "PNG")
        print(f"  Updated: {root_logo}")

    print("Done.")


def main():
    parser = argparse.ArgumentParser(description="Process Serial Helper logo")
    parser.add_argument("source", help="Path to source PNG image")
    parser.add_argument(
        "--threshold", type=int, default=30,
        help="Max RGB value for a pixel to be treated as 'black' (default: 30)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview only, don't write files")
    args = parser.parse_args()

    src_path = Path(args.source)
    if not src_path.exists():
        print(f"ERROR: Source file not found: {src_path}")
        sys.exit(1)

    generate_icons(src_path, args.threshold, args.dry_run)


if __name__ == "__main__":
    main()

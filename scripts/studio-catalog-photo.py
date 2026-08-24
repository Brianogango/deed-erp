#!/usr/bin/env python3
"""Cut the subject out and composite it onto a uniform studio field."""
from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

from PIL import Image
from rembg import remove

STUDIO = (243, 245, 248)
PAD_RATIO = 0.16
MAX_SIDE = 1600


def flatten(src: Path, dest: Path) -> None:
    cut = remove(src.read_bytes())
    image = Image.open(BytesIO(cut)).convert("RGBA")
    box = image.getbbox()
    if not box:
        raise SystemExit(f"studio flatten produced an empty mask: {src}")
    image = image.crop(box)
    width, height = image.size
    pad = int(max(width, height) * PAD_RATIO)
    side = max(width + 2 * pad, height + 2 * pad, 1)
    canvas = Image.new("RGBA", (side, side), STUDIO + (255,))
    canvas.paste(image, ((side - width) // 2, (side - height) // 2), image)
    rgb = canvas.convert("RGB")
    rgb.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    rgb.save(dest, "JPEG", quality=82, optimize=True)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: studio-catalog-photo.py <input.jpg> <output.jpg>")
    flatten(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()

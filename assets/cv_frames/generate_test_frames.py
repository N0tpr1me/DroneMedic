"""Generate synthetic aerial-view test frames for YOLOv8 inference demo.

Creates 640x480 images with colored rectangles representing buildings,
roads, and trees from a top-down perspective.  These are not photorealistic
-- they exist so YOLOv8 has real images to process during the demo loop.

Usage:
    python assets/cv_frames/generate_test_frames.py
"""

from __future__ import annotations

import sys
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent


def _require_deps() -> tuple:
    """Import numpy and PIL, exit with a helpful message if missing."""
    try:
        import numpy as np
        from PIL import Image, ImageDraw
        return np, Image, ImageDraw
    except ImportError:
        print(
            "Requires numpy and Pillow.  Install with:\n"
            "  pip install numpy Pillow",
            file=sys.stderr,
        )
        sys.exit(1)


def generate_frame_01(np, Image, ImageDraw) -> None:
    """Urban scene: grey road, brown buildings, green park."""
    img = Image.new("RGB", (640, 480), (110, 130, 100))  # muted ground
    draw = ImageDraw.Draw(img)

    # Road (horizontal + vertical cross)
    draw.rectangle([0, 210, 640, 270], fill=(80, 80, 80))
    draw.rectangle([290, 0, 350, 480], fill=(80, 80, 80))

    # Buildings (brown/tan rectangles)
    draw.rectangle([40, 30, 180, 170], fill=(160, 120, 80))
    draw.rectangle([400, 30, 560, 160], fill=(140, 100, 70))
    draw.rectangle([50, 310, 200, 440], fill=(150, 110, 75))
    draw.rectangle([410, 320, 580, 450], fill=(165, 125, 85))

    # Green park area
    draw.rectangle([380, 170, 450, 200], fill=(50, 140, 50))
    draw.ellipse([390, 175, 440, 195], fill=(30, 120, 30))

    img.save(OUTPUT_DIR / "frame_01.png")
    print("  frame_01.png  (urban cross-road)")


def generate_frame_02(np, Image, ImageDraw) -> None:
    """Suburban scene: houses, trees, vehicle on road."""
    arr = np.full((480, 640, 3), (95, 145, 80), dtype=np.uint8)  # grass
    img = Image.fromarray(arr)
    draw = ImageDraw.Draw(img)

    # Diagonal road
    for y in range(480):
        x_start = int(200 + y * 0.4)
        draw.rectangle([x_start, y, x_start + 60, y + 1], fill=(90, 90, 90))

    # Houses
    draw.rectangle([60, 100, 160, 200], fill=(180, 60, 60))   # red roof
    draw.rectangle([70, 300, 170, 400], fill=(60, 100, 180))   # blue house
    draw.rectangle([480, 80, 580, 180], fill=(200, 180, 60))   # yellow

    # Trees (green circles)
    for cx, cy in [(30, 50), (500, 250), (550, 400), (120, 250)]:
        draw.ellipse([cx - 15, cy - 15, cx + 15, cy + 15], fill=(20, 100, 20))

    # Vehicle rectangle on road
    draw.rectangle([310, 240, 345, 270], fill=(200, 200, 220))

    img.save(OUTPUT_DIR / "frame_02.png")
    print("  frame_02.png  (suburban diagonal road)")


def generate_frame_03(np, Image, ImageDraw) -> None:
    """Open field with warehouse and parked truck."""
    arr = np.full((480, 640, 3), (130, 155, 100), dtype=np.uint8)  # dry field
    img = Image.fromarray(arr)
    draw = ImageDraw.Draw(img)

    # Large warehouse
    draw.rectangle([180, 120, 460, 300], fill=(170, 170, 170))
    draw.rectangle([290, 250, 350, 300], fill=(100, 80, 60))  # door

    # Parking area
    draw.rectangle([180, 310, 460, 340], fill=(70, 70, 70))

    # Parked truck
    draw.rectangle([220, 315, 290, 335], fill=(220, 50, 50))

    # Fence line
    for x in range(100, 540, 40):
        draw.rectangle([x, 360, x + 5, 380], fill=(140, 120, 90))
    draw.line([(100, 365), (540, 365)], fill=(140, 120, 90), width=2)

    # Scattered trees
    for cx, cy in [(50, 60), (590, 90), (30, 420), (600, 430)]:
        draw.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=(40, 110, 40))

    img.save(OUTPUT_DIR / "frame_03.png")
    print("  frame_03.png  (warehouse + truck)")


def main() -> None:
    np, Image, ImageDraw = _require_deps()
    print("Generating test frames in", OUTPUT_DIR)
    generate_frame_01(np, Image, ImageDraw)
    generate_frame_02(np, Image, ImageDraw)
    generate_frame_03(np, Image, ImageDraw)
    print("Done.")


if __name__ == "__main__":
    main()

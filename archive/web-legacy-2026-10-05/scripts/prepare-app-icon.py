"""Export the generated AVHub artwork to Windows icon sizes (requires Pillow).

Run from the repository root: python scripts/prepare-app-icon.py
This only resizes/exports the artwork; it does not redraw or crop it.
"""

from pathlib import Path

from PIL import Image


ASSETS = Path(__file__).resolve().parents[1] / "electron" / "assets"
SIZES = (16, 24, 32, 48, 64, 128, 256)


def main():
    with Image.open(ASSETS / "avhub-source.png") as source:
        if source.width != source.height or source.width < 512:
            raise ValueError("Icon artwork must be square and at least 512 pixels")
        image = source.convert("RGBA")
        if image.getextrema()[3][0] == 255:
            raise ValueError("Icon artwork must have transparent corners")
        image.resize((512, 512), Image.Resampling.LANCZOS).save(ASSETS / "avhub.png")
        image.save(ASSETS / "avhub.ico", sizes=[(size, size) for size in SIZES])

    with Image.open(ASSETS / "avhub.ico") as icon:
        assert icon.ico.sizes() == {(size, size) for size in SIZES}
        for size in SIZES:
            layer = icon.ico.getimage((size, size)).convert("RGBA")
            assert layer.size == (size, size)
            assert layer.getextrema()[3][0] < 255
    print("Exported AVHub PNG (512px) and ICO (16/24/32/48/64/128/256px)")


if __name__ == "__main__":
    main()

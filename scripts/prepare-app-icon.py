"""Export the About mark's canonical SVG to Windows icon sizes.

Run from the repository root: python scripts/prepare-app-icon.py
Requires Pillow and CairoSVG for regeneration only, not application startup.
No generated AI artwork: frontend/public/avhub.svg is the single brand source.
"""

from pathlib import Path

from PIL import Image
import cairosvg
from io import BytesIO
import hashlib
import json


ASSETS = Path(__file__).resolve().parents[1] / "electron" / "assets"
SOURCE = ASSETS.parents[1] / 'frontend' / 'public' / 'avhub.svg'
SIZES = (16, 24, 32, 48, 64, 128, 256)


def main():
    raster=cairosvg.svg2png(url=str(SOURCE),output_width=1024,output_height=1024)
    with Image.open(BytesIO(raster)) as source:
        if source.width != source.height or source.width < 512:
            raise ValueError("Icon artwork must be square and at least 512 pixels")
        image = source.convert("RGBA")
        if image.getextrema()[3][0] == 255:
            raise ValueError("Icon artwork must have transparent corners")
        image.save(ASSETS / 'avhub-source.png')
        image.resize((512, 512), Image.Resampling.LANCZOS).save(ASSETS / "avhub.png")
        image.save(ASSETS / "avhub.ico", sizes=[(size, size) for size in SIZES])

    with Image.open(ASSETS / "avhub.ico") as icon:
        assert icon.ico.sizes() == {(size, size) for size in SIZES}
        for size in SIZES:
            layer = icon.ico.getimage((size, size)).convert("RGBA")
            assert layer.size == (size, size)
            assert layer.getextrema()[3][0] < 255
    manifest={'source':'frontend/public/avhub.svg','source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'files':{name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() for name in ('avhub-source.png','avhub.png','avhub.ico')},
        'ico_sizes':list(SIZES),'style':'About mark: indigo rounded square and white rounded play glyph'}
    (ASSETS/'icon-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print("Exported AVHub PNG (512px) and ICO (16/24/32/48/64/128/256px)")


if __name__ == "__main__":
    main()

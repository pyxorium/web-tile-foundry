"""Makes Zine Scene's web fonts (Foundry v0.30.0) from the families' own files.

Each font is cut down to Latin (English and most European languages) and saved
as WOFF2 in public/zine-fonts/, with its licence. Variable fonts keep only the
weight axis, over the range the zine uses. Run once when the fonts change:

    pip install fonttools brotli
    python scripts/make-zine-fonts.py font-sources

`font-sources` holds the families as Google Fonts downloads them (one folder
each, unzipped). It isn't committed; the files made here are.
"""
import io, os, shutil, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

LATIN = ("U+0000-00FF,U+0100-017F,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
         "U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD")

# (output name, source file, axes to keep or pin)
FONTS = [
    ("fraunces", "Fraunces/Fraunces-VariableFont_SOFT,WONK,opsz,wght.ttf", {"SOFT": 0, "WONK": 0, "opsz": 24, "wght": (400, 900)}),
    ("fraunces-italic", "Fraunces/Fraunces-Italic-VariableFont_SOFT,WONK,opsz,wght.ttf", {"SOFT": 0, "WONK": 0, "opsz": 24, "wght": (400, 900)}),
    ("courier-prime", "Courier_Prime/CourierPrime-Regular.ttf", None),
    ("courier-prime-bold", "Courier_Prime/CourierPrime-Bold.ttf", None),
    ("courier-prime-italic", "Courier_Prime/CourierPrime-Italic.ttf", None),
    ("courier-prime-bold-italic", "Courier_Prime/CourierPrime-BoldItalic.ttf", None),
    ("nunito", "Nunito/Nunito-VariableFont_wght.ttf", {"wght": (400, 900)}),
    ("nunito-italic", "Nunito/Nunito-Italic-VariableFont_wght.ttf", {"wght": (400, 900)}),
    ("caveat", "Caveat/Caveat-VariableFont_wght.ttf", {"wght": (400, 700)}),
    ("bebas-neue", "Bebas_Neue/BebasNeue-Regular.ttf", None),
    ("pirata-one", "Pirata_One/PirataOne-Regular.ttf", None),
]
LICENCES = {"fraunces": "Fraunces", "courier-prime": "Courier_Prime", "nunito": "Nunito", "caveat": "Caveat", "bebas-neue": "Bebas_Neue", "pirata-one": "Pirata_One"}

def main(src, out="public/zine-fonts"):
    os.makedirs(out, exist_ok=True)
    for name, path, axes in FONTS:
        font = TTFont(os.path.join(src, path), lazy=False)
        if axes:
            # Pinned and narrowed first, then saved and read back whole (a cut-down
            # variable font read lazily can lose glyphs' variations).
            font = instancer.instantiateVariableFont(font, axes)
            buf = io.BytesIO()
            font.save(buf)
            buf.seek(0)
            font = TTFont(buf, lazy=False)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["kern", "liga", "clig", "calt", "ccmp", "locl", "mark", "mkmk"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.hinting = False
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=subset.parse_unicodes(LATIN))
        sub.subset(font)
        dest = os.path.join(out, name + ".woff2")
        font.flavor = "woff2"
        font.save(dest)
        print(f"{dest}: {os.path.getsize(dest) // 1024} KB")
    for name, folder in LICENCES.items():
        shutil.copyfile(os.path.join(src, folder, "OFL.txt"), os.path.join(out, name + "-OFL.txt"))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "font-sources")

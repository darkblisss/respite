#!/usr/bin/env python3
"""
Respite · dev/slice-sheet.py · cut a material sheet into named icons

One Midjourney 3x3 at --ar 1:1 is nine materials. This cuts it, names each
cell from the TIERS row it belongs to, and writes three variants so the look
can be judged at the size the game actually draws (46px in an .art box)
before anything lands in assets/.

    pip install pillow numpy rembg onnxruntime
    python3 dev/slice-sheet.py sheet.png --suffix _delve --out /tmp/ore \
        --names slag mire gloam cairn crucible starfall wyrmheart hollow titan

    tile/   straight crop, painted background kept
    cut/    background removed, trimmed to the object, square-padded
    fade/   crop kept, alpha vignette so the tile melts into any surface

cut/ trims every cell to its own bounding box, so a small object comes back
as large as a big one and the tier's sense of scale is lost. --lockscale
trims them all against the largest instead, which keeps the nine in
proportion to each other.
"""
import argparse, pathlib, sys
import numpy as np
from PIL import Image


def cells(img, rows, cols):
    w, h = img.size
    cw, ch = w // cols, h // rows
    for r in range(rows):
        for c in range(cols):
            yield img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))


def trimmed(im):
    box = im.getchannel("A").getbbox()
    return im.crop(box) if box else im


def square_pad(im, side, margin=0.06):
    """Centre im on a transparent square of `side`, leaving a margin."""
    room = int(side * (1 - margin * 2))
    scale = min(room / im.width, room / im.height, 1.0)
    if scale < 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return out


def vignette(im, inner=0.62, outer=0.99):
    """Alpha falls from 1 to 0 between inner and outer radius, as a fraction of the half-diagonal."""
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = (w - 1) / 2, (h - 1) / 2
    r = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy) / cy) ** 2) / np.sqrt(2)
    a = np.clip((outer - r) / (outer - inner), 0, 1) ** 1.35
    arr = np.array(im.convert("RGBA"))
    arr[..., 3] = (arr[..., 3] * a).astype(np.uint8)
    return Image.fromarray(arr)


def save(im, folder, name, size):
    im = im.convert("RGBA").resize((size, size), Image.LANCZOS)
    folder.mkdir(parents=True, exist_ok=True)
    im.save(folder / f"{name}.webp", quality=92, method=6)
    im.save(folder / f"{name}.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--names", nargs="+", required=True, help="one per cell, left to right, top to bottom")
    ap.add_argument("--suffix", default="", help="appended to every name, e.g. _delve")
    ap.add_argument("--rows", type=int, default=3)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--out", default="out")
    ap.add_argument("--lockscale", action="store_true", help="keep cut/ cells in proportion to one another")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    sheet = Image.open(args.sheet).convert("RGBA")
    chunks = list(cells(sheet, args.rows, args.cols))
    if len(args.names) != len(chunks):
        sys.exit(f"{len(chunks)} cells but {len(args.names)} names")

    try:
        from rembg import remove, new_session
        session = new_session("isnet-general-use")
    except Exception as err:
        print(f"rembg unavailable ({err}) — skipping cut/")
        session = None

    cutouts = []
    if session:
        from rembg import remove
        cutouts = [trimmed(remove(c, session=session)) for c in chunks]
        side = max(max(c.size) for c in cutouts) if args.lockscale else None

    for i, (name, cell) in enumerate(zip(args.names, chunks)):
        name = f"{name}{args.suffix}"
        save(cell, out / "tile", name, args.size)
        save(vignette(cell), out / "fade", name, args.size)
        if cutouts:
            box = side if args.lockscale else max(cutouts[i].size)
            save(square_pad(cutouts[i], box), out / "cut", name, args.size)
        print(f"  {name}")

    print(f"\n{len(chunks)} icons -> {out}/")


if __name__ == "__main__":
    main()

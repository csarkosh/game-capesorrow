"""Builds the town's texture layers: the files under client/assets/textures/ and their manifest.

Run (from the repository root; Pillow and numpy must be installed, nothing else):

    python3 -I tools/textures/build.py [--sources DIR] [--out DIR] [--check]

--sources  the folder of CC0 sources (default /Volumes/CyrusExtSSD/dayhike-lab/capesorrow-textures). Each work is a folder named
           by its asset id inside one folder of its provider's (<provider>/<id>/), holding either
           files/<id>_1K-JPG_{Color,NormalGL,Roughness,AmbientOcclusion}.jpg or <id>_{diff,nor_gl,rough,ao}_1k.jpg; the script
           finds the work by its id and knows the naming by which files are there. It is only read. Where each work came from
           (title, author, page, licence) is in CREDITS.md and nowhere else.
--out      where the files go (default client/assets/textures, beside this script's repository root).
--check    builds into memory and says whether the files on disk are what this script would write (bytes of the manifest
           only; WebP encoders differ between machines), writing nothing.

For each layer in LAYERS it writes two 512 x 512 WebP files and one line of the manifest (town.layers.json):

  town.<name>.color.webp   RGB, sRGB-encoded, 8 bits. A layer that is `paintable` carries neutral detail instead of a
                           colour: its linear luminance divided by its own mean, times 0.5 (so a stored value of 0.5 is
                           "as the paint colour" and the shader multiplies by 2), desaturated. The vertex colour is then
                           the paint, and the texture gives it grain, stains and shadow lines. Every other layer keeps
                           its own colour. The renderer reads the file as sRGB (rgba8unorm-srgb), so filtering and mip
                           levels are made in linear light.
  town.<name>.data.webp    RGBA, read as data (no colour management, no premultiplication): R = normal x, G = normal y
                           (OpenGL convention, green up; z is rebuilt as sqrt(1 - x^2 - y^2)), B = roughness,
                           A = 0.5 + 0.5 * ambient occlusion (1 where the set has none). The encoding is lossless, after
                           the rounding the constants below say. AO sits in the upper half of the
                           alpha channel because a browser that decodes through a canvas multiplies colour by alpha: a
                           quantised colour at alpha 0.5 is at worst a level or two off, where at alpha 0.1 it would be
                           noise. Normals are stored in the maps' own rows: the loader turns every image over as it
                           uploads it (as the engine's ground layers are), so v = 0 is the image's bottom row and a
                           texture's "up" is +v.

A source that is not square (Bricks097 and WoodSiding009 are 2:1) is resampled to 512 x 512 and its manifest tile size
says the two metres it spans. Resampling wraps at the edges, so a layer still tiles. The normals are renormalised after it.

The asphalt shingles are made here (`shingles()`), from a fixed seed, as a tiling height field: three-tab strip shingles
in courses of 14 cm exposure, tabs 30 cm wide with 1 cm slots, each course offset half a tab from the last.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SIZE = 512
DEFAULT_SOURCES = "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-textures"
DEFAULT_OUT = os.path.join(ROOT, "client", "assets", "textures")
MANIFEST = "town.layers.json"
SEED = 20261122

# The mean the paintable layers are stored at (0.5): the shader multiplies by its reciprocal.
PAINT_GAIN = 2.0
# Quality of the colour files (lossy WebP). The data files are lossless (a lossy encoder halves the normals' resolution
# with its chroma subsampling: measured, a mean error of 4 degrees against a surface tilted 9 degrees), so what keeps them
# small is rounding each channel to a step before the encoder sees it: the normal to 4 of 255 (under 1 degree), roughness
# to 8, AO (in its half of the alpha channel) to 16. That brings the whole set to about 6 MB. SOFTEN_NORMALS passes of a
# 1-2-1 blur on the normal's x and y would take a quarter off that again; they are off, since they take the finest grain.
COLOR_QUALITY = 82
NORMAL_STEP = 4
ROUGH_STEP = 8
AO_STEP = 16
SOFTEN_NORMALS = 0

# name: the layer's role. id: the work's asset id (CREDITS.md has its section, `town.<id>`), or `generated` for a layer made here. tile: the metres
# the layer's 512 x 512 spans, across and up; estimated: the figure is ours (the catalogue lists none). paintable: the
# colour file is neutral detail for a paint colour to multiply.
LAYERS = [
    # walls
    dict(name="siding_painted", id="WoodSiding009", tile=[2.4, 1.2], estimated=True, paintable=True, note="painted lap siding; 8 boards of about 15 cm over the picture's height"),
    dict(name="planks_peeling", id="green_rough_planks", tile=[1.5, 1.5], estimated=False, paintable=False, note="peeling painted boards"),
    dict(name="shingle_siding", id="WoodSiding010", tile=[1.4, 1.4], estimated=False, paintable=False, note="weathered cedar shingle siding"),
    dict(name="planks_weathered", id="dark_planks", tile=[2.0, 2.0], estimated=False, paintable=False, note="weathered boards, horizontal in the image; rotate the frame for vertical boards"),
    dict(name="brick", id="Bricks097", tile=[3.0, 1.5], estimated=True, paintable=False, note="old red brick; 20 courses of 7.5 cm over the picture's height, 2:1"),
    dict(name="metal_aged", id="corrugated_iron_02", tile=[2.7, 2.7], estimated=False, paintable=True, note="aged corrugated metal, ribs vertical in the image"),
    dict(name="metal_painted", id="CorrugatedSteel006A", tile=[2.0, 2.0], estimated=True, paintable=False, note="painted corrugated metal, ribs vertical in the image; four panels of 50 cm"),
    dict(name="concrete_board", id="concrete", tile=[4.0, 4.0], estimated=False, paintable=False, note="board-formed stained concrete, joints vertical in the image"),
    dict(name="stucco", id="Plaster007", tile=[2.0, 2.0], estimated=True, paintable=True, note="old stained stucco"),
    dict(name="stone", id="mossy_stone_wall", tile=[2.0, 2.0], estimated=False, paintable=False, note="stone wall"),
    dict(name="plywood", id="plywood", tile=[0.5, 0.5], estimated=False, paintable=False, note="boarded openings"),
    dict(name="shutter", id="painted_metal_shutter", tile=[2.0, 2.0], estimated=False, paintable=False, note="roll-up doors, slats horizontal in the image"),
    # roofs
    dict(name="roof_metal", id="corrugated_iron_03", tile=[2.0, 2.0], estimated=False, paintable=False, note="metal roofing, ribs vertical in the image"),
    dict(name="roof_bitumen", id="bitumen", tile=[20.0, 20.0], estimated=False, paintable=False, note="flat roofs"),
    dict(name="roof_shingle", generated=True, id="shingles", tile=[2.4, 2.24], estimated=False, paintable=True, note="three-tab asphalt shingles made by this script: 16 courses of 14 cm, 8 tabs of 30 cm"),
    # ground
    dict(name="sidewalk", id="Concrete047A", tile=[1.5, 1.5], estimated=True, paintable=False, note="sidewalk concrete"),
    dict(name="asphalt", id="asphalt_02", tile=[3.0, 3.0], estimated=False, paintable=False, note="cracked street asphalt, cracks run up the image"),
    dict(name="asphalt_dark", id="Road012B", tile=[2.0, 2.0], estimated=True, paintable=False, note="darker asphalt, for patches"),
    dict(name="gravel", id="Ground110", tile=[2.1, 2.1], estimated=False, paintable=False, note="gravel and dirt"),
    dict(name="mud", id="Ground051", tile=[2.0, 2.0], estimated=False, paintable=False, note="mud"),
    dict(name="moss", id="concrete_moss", tile=[3.0, 3.0], estimated=False, paintable=False, note="the wear overlay for moss and grime"),
    dict(name="rust", id="PaintedMetal013", tile=[1.0, 1.0], estimated=True, paintable=False, note="rust and peeling paint: metal things, and the rust overlay"),
]

def srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def source_paths(layer, root):
    """The work's files: its folder is <root>/<provider>/<id> for whichever provider folder has it, and the naming is told by
    which files are there."""
    i = layer["id"]
    folders = [os.path.join(root, d, i) for d in sorted(os.listdir(root)) if not d.startswith(".") and os.path.isdir(os.path.join(root, d, i))]
    if len(folders) != 1:
        raise SystemExit("%s: expected one folder %s/<provider>/%s, found %d" % (layer["name"], root, i, len(folders)))
    folder = folders[0]
    scans = os.path.join(folder, "files", i + "_1K-JPG_")
    if os.path.exists(scans + "Color.jpg"):
        return dict(color=scans + "Color.jpg", normal=scans + "NormalGL.jpg", rough=scans + "Roughness.jpg", ao=scans + "AmbientOcclusion.jpg")
    base = os.path.join(folder, i + "_")
    if os.path.exists(base + "diff_1k.jpg"):
        return dict(color=base + "diff_1k.jpg", normal=base + "nor_gl_1k.jpg", rough=base + "rough_1k.jpg", ao=base + "ao_1k.jpg")
    raise SystemExit("%s: no known file naming in %s" % (layer["name"], folder))


def load(path, channels):
    im = Image.open(path)
    im = im.convert("RGB" if channels == 3 else "L")
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a if channels == 3 else a[:, :, None]


def resize(a):
    """(H, W, C) float to SIZE x SIZE, wrapping at the edges so the result still tiles."""
    h, w, c = a.shape
    if h == SIZE and w == SIZE:
        return a
    ph, pw = h // 4, w // 4
    padded = np.pad(a, ((ph, ph), (pw, pw), (0, 0)), mode="wrap")
    th = round((h + 2 * ph) * SIZE / h)
    tw = round((w + 2 * pw) * SIZE / w)
    out = np.empty((th, tw, c), dtype=np.float32)
    for k in range(c):
        out[:, :, k] = np.asarray(Image.fromarray(padded[:, :, k]).resize((tw, th), Image.LANCZOS))
    oy, ox = round(ph * SIZE / h), round(pw * SIZE / w)
    return out[oy : oy + SIZE, ox : ox + SIZE]


def decode_normal(rgb):
    n = rgb * 2.0 - 1.0
    return n / np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)


def pack_data(nx, ny, rough, ao):
    """RGBA uint8: normal x, normal y, roughness, 0.5 + 0.5 AO, rounded as the constants above say."""
    def byte(v):
        return np.clip(np.rint(v * 255.0), 0, 255).astype(np.uint8)

    def coarse(v, step):
        q = np.rint(np.clip(v, 0, 255) / step) * step
        return np.clip(q, 0, 255).astype(np.uint8)

    x = blur((nx * 0.5 + 0.5) * 255.0, SOFTEN_NORMALS) if SOFTEN_NORMALS else (nx * 0.5 + 0.5) * 255.0
    y = blur((ny * 0.5 + 0.5) * 255.0, SOFTEN_NORMALS) if SOFTEN_NORMALS else (ny * 0.5 + 0.5) * 255.0
    return np.dstack([coarse(x, NORMAL_STEP), coarse(y, NORMAL_STEP), coarse(byte(rough), ROUGH_STEP), coarse(byte(0.5 + 0.5 * np.clip(ao, 0, 1)), AO_STEP)])


def neutral(linear_rgb):
    """The paintable layers' colour: linear luminance over its mean, halved, as sRGB grey."""
    lum = linear_rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    d = np.clip(lum / lum.mean() / PAINT_GAIN, 0.0, 1.0)
    s = linear_to_srgb(d)
    return np.dstack([s, s, s])


def from_source(layer, root):
    paths = source_paths(layer, root)
    color = resize(load(paths["color"], 3))
    nrm = resize(load(paths["normal"], 3))
    rough = resize(load(paths["rough"], 1))[:, :, 0]
    ao = resize(load(paths["ao"], 1))[:, :, 0] if os.path.exists(paths["ao"]) else np.ones((SIZE, SIZE), np.float32)
    lin = srgb_to_linear(np.clip(color, 0, 1))
    shown = neutral(lin) if layer["paintable"] else linear_to_srgb(lin)
    n = decode_normal(nrm)
    return shown, pack_data(n[:, :, 0], n[:, :, 1], rough, ao), dict(ao=os.path.exists(paths["ao"]))


def blur(a, passes=1):
    """A wrapped 1-2-1 blur, both ways."""
    for _ in range(passes):
        a = (np.roll(a, 1, 0) + 2 * a + np.roll(a, -1, 0)) / 4
        a = (np.roll(a, 1, 1) + 2 * a + np.roll(a, -1, 1)) / 4
    return a


def shingles():
    """Three-tab asphalt shingles as a tiling height field: colour (neutral), normal, roughness, AO."""
    rng = np.random.RandomState(SEED)
    courses, tab = 16, 64
    rows = SIZE // courses  # 32 texels: 14 cm
    ys, xs = np.mgrid[0:SIZE, 0:SIZE]
    course = ys // rows
    t = (ys % rows) / rows  # 0 at the course's top (under the course above), toward 1 at its butt edge
    # Each course sits half a tab along from the one below.
    shifted = (xs + (course % 2) * (tab // 2)) % SIZE
    tab_index = shifted // tab
    in_tab = shifted % tab
    slot = in_tab < 2  # a slot is 2 texels (1 cm) at the tab's left edge
    # Per-tab tone, per course and tab.
    tone = np.exp(rng.normal(0.0, 0.14, size=(courses, SIZE // tab)))
    tab_tone = tone[course, tab_index]
    # Height in millimetres: the surface rises 3.5 mm toward the butt edge, where the next course down is lower; a slot drops to the underlay.
    h = 3.5 * t
    h = np.where(slot, -2.0, h)
    grain = rng.normal(0.0, 1.0, size=(SIZE, SIZE))
    h = h + 0.3 * grain
    h = blur(h, 1)
    px_x, px_y = 2400.0 / SIZE, 2240.0 / SIZE  # millimetres a texel
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2 / px_x
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2 / px_y  # per image row, which runs down: +v is up, so n_y = +gy
    n = np.dstack([-gx * 1.4, gy * 1.4, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    # Colour: tab tone, granules at two scales, faint vertical streaks, the slots dark.
    g1 = rng.normal(0.0, 1.0, size=(SIZE, SIZE))
    g2 = blur(rng.normal(0.0, 1.0, size=(SIZE, SIZE)), 2) * 2.5
    streak = blur(np.repeat(rng.normal(0.0, 1.0, size=(1, SIZE)), SIZE, axis=0), 3)
    lum = tab_tone * np.exp(0.16 * g1 + 0.08 * g2 + 0.05 * streak)
    lum = np.where(slot, lum * 0.3, lum)
    lin = np.dstack([lum, lum, lum]).astype(np.float32)
    shown = neutral(lin)
    # AO: the shadow the course above throws on the top of this one, and the slots.
    ao = 0.55 + 0.45 * np.clip(t / 0.35, 0.0, 1.0) ** 1.5
    ao = np.where(slot, 0.35, ao)
    rough = np.clip(0.9 + 0.04 * grain + 0.02 * g1, 0.7, 1.0)
    return shown, pack_data(n[:, :, 0], n[:, :, 1], rough, blur(ao, 1))


def encode(shown, data):
    color = Image.fromarray(np.clip(np.rint(shown * 255.0), 0, 255).astype(np.uint8))
    packed = Image.fromarray(data)
    return color, packed


def write_webp(im, path, **kw):
    im.save(path, "WEBP", **kw)


def manifest_of():
    layers = []
    for i, layer in enumerate(LAYERS):
        generated = bool(layer.get("generated"))
        layers.append(
            dict(
                name=layer["name"],
                index=i,
                id=layer["id"],
                credit=None if generated else "town.%s" % layer["id"],
                generated=generated,
                tile=layer["tile"],
                tileEstimated=layer["estimated"],
                paintable=layer["paintable"],
                color="town.%s.color.webp" % layer["name"],
                data="town.%s.data.webp" % layer["name"],
                note=layer["note"],
            )
        )
    return dict(
        size=SIZE,
        paintGain=PAINT_GAIN,
        about="Written by tools/textures/build.py: do not edit. Tile sizes are metres across and up the 512 x 512 layer. Where a work came from is in CREDITS.md, under the layer's credit id.",
        layers=layers,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=DEFAULT_SOURCES)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = json.dumps(manifest_of(), indent=2) + "\n"
    if args.check:
        path = os.path.join(args.out, MANIFEST)
        same = os.path.exists(path) and open(path).read() == text
        print("manifest is current" if same else "manifest is stale")
        sys.exit(0 if same else 1)
    os.makedirs(args.out, exist_ok=True)
    total = 0
    for layer in LAYERS:
        if layer.get("generated"):
            shown, data = shingles()
        else:
            shown, data, _ = from_source(layer, args.sources)
        color, packed = encode(shown, data)
        cpath = os.path.join(args.out, "town.%s.color.webp" % layer["name"])
        dpath = os.path.join(args.out, "town.%s.data.webp" % layer["name"])
        write_webp(color, cpath, quality=COLOR_QUALITY, method=6)
        write_webp(packed, dpath, lossless=True, quality=100, method=6, exact=True)
        sizes = os.path.getsize(cpath) + os.path.getsize(dpath)
        total += sizes
        print("%-18s %7d bytes" % (layer["name"], sizes))
    with open(os.path.join(args.out, MANIFEST), "w") as f:
        f.write(text)
    print("total %.2f MB" % (total / 1e6))


if __name__ == "__main__":
    main()

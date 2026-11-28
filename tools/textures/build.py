"""Builds the game's texture layers: the files under client/assets/textures/ and their manifests, in two sets.

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

There are two sets. The town's (`town.<layer>.*`, `town.layers.json`) is loaded with the town. The interiors' (`interior.<layer>.*`,
`interior.layers.json`) is loaded the first time a player walks into a building and costs nothing before: it is self-contained, holding
the layers that only the rooms use (INTERIOR_LAYERS: marble, carpet, oak, dark wood, cloth, glazed tile, cane) and the few outdoor ones
the rooms use as well (brick, sidewalk concrete, stucco, painted steel), so that a room samples one pair of arrays. It is made by the same
steps as the town's, except that its colour maps are 512 x 512 and its data maps 256 x 256 (INTERIOR_COLOR_SIZE, INTERIOR_DATA_SIZE),
which keeps the whole set's memory under 22 MB (see DESIGN notes in ARCHITECTURE.md, "The town's textures"), and that each of its
layers states its `mean`, the average linear colour of its colour file, which the room's tints are divided by. The script checks the
stated mean against the picture it makes and stops when they differ.

For each layer of the town's set it writes two 512 x 512 WebP files and one line of the manifest (town.layers.json):

  <set>.<name>.color.webp  RGB, sRGB-encoded, 8 bits. A layer that is `paintable` carries neutral detail instead of a
                           colour: its linear luminance divided by its own mean, times 0.5 (so a stored value of 0.5 is
                           "as the paint colour" and the shader multiplies by 2), desaturated. The vertex colour is then
                           the paint, and the texture gives it grain, stains and shadow lines. Every other layer keeps
                           its own colour. The renderer reads the file as sRGB (rgba8unorm-srgb), so filtering and mip
                           levels are made in linear light.
  <set>.<name>.data.webp   RGBA, read as data (no colour management, no premultiplication): R = normal x, G = normal y
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
DEFAULT_SOURCES = "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-textures"  # keeps the game's former name on purpose: the sources are stored in a folder of that name
DEFAULT_OUT = os.path.join(ROOT, "client", "assets", "textures")
MANIFEST = "town.layers.json"
INTERIOR_MANIFEST = "interior.layers.json"
# The interiors' set: colour maps at 512, data maps (normal, roughness, AO) at 256. A normal map's detail is finer than the eye reads
# on a floor or a wall seen from a metre, and the data array is the larger part of a set's bytes in the GPU's memory, so halving its side
# takes a quarter off it. The low tier halves both again when it loads them (`interiorTextures.ts`).
INTERIOR_COLOR_SIZE = 512
INTERIOR_DATA_SIZE = 256
# How far (per channel, linear) a layer's stated mean may be from the one measured in its picture.
MEAN_TOLERANCE = 0.006
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

# The interiors' own layers. Same fields as LAYERS. Metre sizes: oak_veneer_04's is the
# catalogue's (1.0 m); the rest are not stated by their catalogue and are read from the pictures (estimated=True).
INTERIOR_OWN = [
    dict(name="marble_tile", id="Marble019", tile=[1.2, 1.2], estimated=True, paintable=False, note="pale marble with fine grey veins, no joints: a slab about 1.2 m across; joints are laid in geometry"),
    dict(name="carpet", id="Carpet004", tile=[0.45, 0.45], estimated=True, paintable=False, note="grey low-pile carpet with a square motif, 15 squares of 3 cm over the picture"),
    dict(name="oak", id="oak_veneer_04", tile=[1.0, 1.0], estimated=False, paintable=False, note="pale straight-grain oak veneer, grain horizontal in the image"),
    dict(name="dark_wood", id="WoodFloor008", tile=[1.5, 1.5], estimated=True, paintable=False, note="dark polished boards of about 14 cm, running across the image"),
    dict(name="cloth", id="Fabric036", tile=[0.4, 0.4], estimated=True, paintable=False, note="plain light-grey woven upholstery: threads of about 1 mm"),
    dict(name="glazed_tile", id="Tiles036", tile=[1.2, 1.2], estimated=True, paintable=False, note="small square glazed tiles of 12 cm with grey grout, 10 over the picture"),
    dict(name="cane", id="Wicker008A", tile=[0.3, 0.3], estimated=True, paintable=False, note="basket weave of strands about 1 cm wide: the nearest to cane webbing the catalogue has"),
    dict(name="paint", generated=True, id="paint", tile=[1.0, 1.0], estimated=False, paintable=False, note="smooth matt emulsion made by this script: a flat near-white wall with a faint roller stipple and a very fine orange peel, for a tint to colour"),
]
# Each interior layer's `mean`: the average linear colour of its colour file (red, green, blue), which the game divides a room's tint by so
# that a tint is the colour the surface comes out. Measured by this script (a build that finds another mean stops and prints it).
INTERIOR_MEANS = {
    "paint": [0.8, 0.8, 0.8],
    "marble_tile": [0.822, 0.824, 0.823],
    "carpet": [0.218, 0.223, 0.228],
    "oak": [0.715, 0.482, 0.313],
    "dark_wood": [0.055, 0.03, 0.017],
    "cloth": [0.492, 0.492, 0.492],
    "glazed_tile": [0.636, 0.636, 0.636],
    "cane": [0.351, 0.246, 0.148],
    "brick": [0.253, 0.168, 0.105],
    "sidewalk": [0.284, 0.246, 0.174],
    "stucco": [0.5, 0.5, 0.5],
    "rust": [0.421, 0.39, 0.378],
}
# The town's layers the rooms use too, by name (and the one source each, so they are the same pictures).
INTERIOR_SHARED = ["brick", "sidewalk", "stucco", "rust"]


def interior_layers():
    by = {layer["name"]: layer for layer in LAYERS}
    return INTERIOR_OWN + [dict(by[n]) for n in INTERIOR_SHARED]


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


def resize(a, size=SIZE):
    """(H, W, C) float to size x size, wrapping at the edges so the result still tiles."""
    h, w, c = a.shape
    if h == size and w == size:
        return a
    ph, pw = h // 4, w // 4
    padded = np.pad(a, ((ph, ph), (pw, pw), (0, 0)), mode="wrap")
    th = round((h + 2 * ph) * size / h)
    tw = round((w + 2 * pw) * size / w)
    out = np.empty((th, tw, c), dtype=np.float32)
    for k in range(c):
        out[:, :, k] = np.asarray(Image.fromarray(padded[:, :, k]).resize((tw, th), Image.LANCZOS))
    oy, ox = round(ph * size / h), round(pw * size / w)
    return out[oy : oy + size, ox : ox + size]


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


def from_source(layer, root, csize=SIZE, dsize=SIZE):
    paths = source_paths(layer, root)
    color = resize(load(paths["color"], 3), csize)
    nrm = resize(load(paths["normal"], 3), dsize)
    rough = resize(load(paths["rough"], 1), dsize)[:, :, 0]
    ao = resize(load(paths["ao"], 1), dsize)[:, :, 0] if os.path.exists(paths["ao"]) else np.ones((dsize, dsize), np.float32)
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


def paint(csize, dsize):
    """A smooth painted wall as a tiling layer: colour (flat near-white, linear 0.80, with one or two percent of slow variation and a faint
    roller stipple), a normal that is flat but for a very fine orange peel, matt roughness and no occlusion. Every blur wraps, so it tiles."""
    rng = np.random.RandomState(SEED + 1)

    def field(size, passes):
        f = blur(rng.normal(0.0, 1.0, size=(size, size)), passes)
        return f / max(float(f.std()), 1e-6)

    slow = field(csize, 40)
    stipple = field(csize, 1)
    lin = np.clip(0.80 * (1.0 + 0.012 * slow + 0.008 * stipple), 0.0, 1.0).astype(np.float32)
    shown = linear_to_srgb(np.dstack([lin, lin, lin]))
    peel = field(dsize, 1)
    gx = (np.roll(peel, -1, 1) - np.roll(peel, 1, 1)) / 2
    gy = (np.roll(peel, -1, 0) - np.roll(peel, 1, 0)) / 2
    n = np.dstack([-gx * 0.05, gy * 0.05, np.ones_like(peel)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    rough = np.clip(0.78 + 0.02 * field(dsize, 1), 0.0, 1.0)
    return shown, pack_data(n[:, :, 0], n[:, :, 1], rough, np.ones((dsize, dsize), np.float32))


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


def interior_manifest_of():
    """The interiors' manifest. A layer the town has too keeps the town's credit; the seven of its own are credited as `interior.<id>`."""
    own = {layer["name"] for layer in INTERIOR_OWN}
    layers = []
    for i, layer in enumerate(interior_layers()):
        layers.append(
            dict(
                name=layer["name"],
                index=i,
                id=layer["id"],
                credit=None if layer.get("generated") else ("interior.%s" if layer["name"] in own else "town.%s") % layer["id"],
                generated=bool(layer.get("generated")),
                tile=layer["tile"],
                tileEstimated=layer["estimated"],
                paintable=layer["paintable"],
                mean=INTERIOR_MEANS.get(layer["name"]),
                color="interior.%s.color.webp" % layer["name"],
                data="interior.%s.data.webp" % layer["name"],
                note=layer["note"],
            )
        )
    return dict(
        size=INTERIOR_COLOR_SIZE,
        dataSize=INTERIOR_DATA_SIZE,
        paintGain=PAINT_GAIN,
        about="Written by tools/textures/build.py: do not edit. The rooms' set, loaded when a player first walks into a building. Tile sizes are metres across and up the layer; colour files are `size` square and data files `dataSize` square; `mean` is the average linear colour of the colour file. Where a work came from is in CREDITS.md, under the layer's credit id.",
        layers=layers,
    )


def write_layers(layers, prefix, out, csize, dsize, means=None):
    """Writes each layer's two files; returns the bytes written. `means`, if given, receives each layer's measured mean colour."""
    total = 0
    for layer in layers:
        if layer.get("generated") and layer["id"] == "paint":
            shown, data = paint(csize, dsize)
        elif layer.get("generated"):
            shown, data = shingles()
        else:
            shown, data, _ = from_source(layer, args_sources(), csize, dsize)
        if means is not None:
            mean = srgb_to_linear(shown).reshape(-1, 3).mean(axis=0)
            means[layer["name"]] = [round(float(v), 3) for v in mean]
        color, packed = encode(shown, data)
        cpath = os.path.join(out, "%s.%s.color.webp" % (prefix, layer["name"]))
        dpath = os.path.join(out, "%s.%s.data.webp" % (prefix, layer["name"]))
        write_webp(color, cpath, quality=COLOR_QUALITY, method=6)
        write_webp(packed, dpath, lossless=True, quality=100, method=6, exact=True)
        sizes = os.path.getsize(cpath) + os.path.getsize(dpath)
        total += sizes
        print("%-8s %-18s %7d bytes" % (prefix, layer["name"], sizes))
    return total


SOURCES = [DEFAULT_SOURCES]


def args_sources():
    return SOURCES[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=DEFAULT_SOURCES)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    SOURCES[0] = args.sources
    town_text = json.dumps(manifest_of(), indent=2) + "\n"
    if args.check:
        # The interiors' means are stated in the script and measured when it builds, so a check without the sources compares the stated ones.
        interior_text = json.dumps(interior_manifest_of(), indent=2) + "\n"
        stale = []
        for name, text in ((MANIFEST, town_text), (INTERIOR_MANIFEST, interior_text)):
            path = os.path.join(args.out, name)
            if not (os.path.exists(path) and open(path).read() == text):
                stale.append(name)
        print("manifest is current" if not stale else "manifest is stale: %s" % ", ".join(stale))
        sys.exit(0 if not stale else 1)
    os.makedirs(args.out, exist_ok=True)
    total = write_layers(LAYERS, "town", args.out, SIZE, SIZE)
    with open(os.path.join(args.out, MANIFEST), "w") as f:
        f.write(town_text)
    print("town total %.2f MB" % (total / 1e6))
    measured = {}
    interior_total = write_layers(interior_layers(), "interior", args.out, INTERIOR_COLOR_SIZE, INTERIOR_DATA_SIZE, measured)
    wrong = [n for n, m in measured.items() if n not in INTERIOR_MEANS or max(abs(a - b) for a, b in zip(m, INTERIOR_MEANS[n])) > MEAN_TOLERANCE]
    if wrong:
        print("INTERIOR_MEANS is not what the pictures measure; set it to:")
        print("INTERIOR_MEANS = {")
        for n, m in measured.items():
            print('    "%s": %s,' % (n, m))
        print("}")
        sys.exit(1)
    with open(os.path.join(args.out, INTERIOR_MANIFEST), "w") as f:
        f.write(json.dumps(interior_manifest_of(), indent=2) + "\n")
    cells = INTERIOR_COLOR_SIZE ** 2 + INTERIOR_DATA_SIZE ** 2
    print("interior total %.2f MB; GPU %.2f MB with mips" % (interior_total / 1e6, cells * 4 * len(interior_layers()) * 4 / 3 / 1e6))


if __name__ == "__main__":
    main()

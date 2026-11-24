"""Builds the parked vehicles' models: the files under client/assets/models/ and their manifest (vehicles.json).

Run (from the repository root; Pillow and numpy must be installed, nothing else):

    python3 -I tools/models/build.py [--sources DIR] [--out DIR] [--check]

--sources  the folder of the downloaded models (default /Volumes/CyrusExtSSD/dayhike-lab/capesorrow-models). A model is found by the
           first characters of its folder's name inside one of its provider's folders (<provider>/<folder>/), and read as a binary
           glTF (.glb) or a glTF with its own .bin and textures (.gltf). The files are only read; they are untrusted, so nothing in them
           is run, and what is read of them is geometry, material numbers and images, decoded by Pillow. Where each work came from
           (title, author, page, licence) and what was changed is in CREDITS.md and nowhere else.
--out      where the files go (default client/assets/models, beside this script's repository root).
--check    says whether the files on disk are what the manifest lists (their sizes and SHA-256) and, where --sources is
           readable, builds into memory and says whether the manifest is what this script would write (bytes of the manifest
           only; WebP encoders differ between machines, so the images are not compared). It writes nothing.

For each model in MODELS it writes one binary glTF, `vehicle.<id>.glb`, and a line of `vehicles.json`. The file is the model as
the game wants to draw it, not as it was made:

  * One node, "LOD0", holds the whole vehicle, in metres, standing on y = 0 (the lowest point of its tyres), pointing along +x
    (its front), its left side toward -z in the file (the game's loader mirrors z, so it is the left to the game), and centred in
    x and z on its footprint (the box round every vertex). Every mesh is baked to that frame: the source files' nodes, their
    scales, their turns and their rolling wheels go into the vertices.
  * Its meshes are one a material: `paint` (the body's panels and bumpers, which carry no texture: the colour is a number, so the
    game paints each car its own), `glass` (blended), `lamp`, `plate` (blank), `tyre`, `under`, `interior`, and for a worn
    vehicle the one `body`. The materials are named, and the game tells them apart by name.
  * What is not shipped: the badges and the lettering (the makers' names and logos in the source's badge sheet are not used), the
    plates' lettering (the plates are blank), the sidewall lettering on the tyres (painted out of the image), the source's
    second texture coordinates and its clear-coat and specular maps. Textures are WebP, no larger than TEXTURE_CAP of their kind.
    The files that ship carry the same images as KTX2: they are re-encoded after this script, outside this repository (a quarter of
    the GPU memory a WebP image decodes to), and the manifest's sizes and hashes are those files'. After a rebuild the step is run
    again; the test beside this script fails until it is.

The manifest says what the game needs of each: the neutral id, the footprint (length, width, height), where its wheels touch (the
four contact points) and their radius, the material roles, the triangle count, what was removed, and its credit id in CREDITS.md.
"""
import argparse
import hashlib
import io
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT_SOURCES = "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-models"
DEFAULT_OUT = os.path.join(ROOT, "client", "assets", "models")
MANIFEST = "vehicles.json"

# The largest side of each kind of texture, in texels. A body's paint carries none; a lamp sheet is small stuff on a big sheet.
TEXTURE_CAP = dict(lamp=512, tyre=512, under=512, interior=512, body=1024)
WEBP_COLOUR = 80
WEBP_DATA = 88
# A normal map's channels are rounded to this step (of 255) before the lossless encoder sees them, as `tools/textures/build.py` does.
NORMAL_STEP = 4

# The credit ids (CREDITS.md `## <id>`), the folder to find, how the model is turned and how big it is, and what role it plays.
#   folder: the first characters of its folder's name.  provider: the folder of the provider's.  file: its file's name within it.
#   family: "kit" for the nine made to one pattern (named parts, one set of materials), "worn" for a model whose body, interior
#           and glass are one texture, "dust" for the covered car.
#   turn: degrees about y that bring the model's front to +x.  wheel_d: the tyre's diameter in metres, to set the scale of a model
#           whose file is in no unit (an estimate: a made-up number is flagged in the manifest).
MODELS = [
    dict(id="pickup_a", kind="pickup", folder="6c48c94", family="kit", note="compact pickup, 1989 in the author's lore"),
    dict(id="pickup_b", kind="pickup", folder="41b3a5c", family="kit", note="old pickup, 1978"),
    dict(id="sedan_a", kind="sedan", folder="e2678da", family="kit", note="full-size sedan, 1980"),
    dict(id="sedan_b", kind="sedan", folder="5c17c58", family="kit", note="compact sedan, 1986"),
    dict(id="wagon", kind="suv", folder="aa0becb", family="kit", note="station wagon, 1984"),
    dict(id="hatch", kind="suv", folder="055ff8a", family="kit", note="hatchback, 2011"),
    dict(id="van", kind="van", folder="09d718c", family="kit", note="panel van, 1992"),
    dict(id="flatbed", kind="work truck", folder="39195e5", family="kit", note="flatbed work truck, 1990"),
    dict(id="boxtruck", kind="work truck", folder="663a095", family="kit", note="box truck, 1995"),
    dict(id="derelict_sedan", kind="derelict", folder="6a2169d", family="worn", turn=None, wheel_d=0.64, note="abandoned sedan, doors open"),
    dict(id="derelict_truck", kind="derelict", folder="68f715c", family="worn", turn=None, wheel_d=0.78, note="rusty abandoned pickup, doors open"),
    dict(id="covered", kind="project", folder="covered_car", family="dust", turn=None, wheel_d=None, note="a car under a dust sheet"),
]

# ---- reading glTF ---------------------------------------------------------------------------------------------------------------

DTYPES = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


class Gltf:
    """A glTF as read: its JSON, its binary chunk (or .bin files), and the folder an external image is looked for in."""

    def __init__(self, path):
        self.dir = os.path.dirname(path)
        raw = open(path, "rb").read()
        self.bin = b""
        if raw[:4] == b"glTF":
            off = 12
            while off + 8 <= len(raw):
                size, kind = struct.unpack("<II", raw[off : off + 8])
                chunk = raw[off + 8 : off + 8 + size]
                off += 8 + size + (-size) % 4
                if kind == 0x4E4F534A:
                    self.json = json.loads(chunk)
                elif kind == 0x004E4942:
                    self.bin = chunk
        else:
            self.json = json.loads(raw)
        self.buffers = []
        for i, b in enumerate(self.json.get("buffers", [])):
            if "uri" in b:
                self.buffers.append(open(os.path.join(self.dir, b["uri"]), "rb").read())
            else:
                self.buffers.append(self.bin)

    def view(self, index):
        v = self.json["bufferViews"][index]
        start = v.get("byteOffset", 0)
        return self.buffers[v.get("buffer", 0)][start : start + v["byteLength"]]

    def accessor(self, index):
        """An accessor's values as a float64 or integer array, (count, components); normalized integers are scaled to 0..1 or -1..1."""
        a = self.json["accessors"][index]
        width = WIDTH[a["type"]]
        dtype = np.dtype(DTYPES[a["componentType"]])
        view = self.json["bufferViews"][a["bufferView"]]
        data = self.buffers[view.get("buffer", 0)]
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = view.get("byteStride") or width * dtype.itemsize
        count = a["count"]
        raw = np.frombuffer(data, dtype=np.uint8, count=stride * (count - 1) + width * dtype.itemsize, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(count, width * dtype.itemsize), strides=(stride, 1))
        out = np.ascontiguousarray(rows).view(dtype).reshape(count, width)
        if a.get("normalized"):
            scale = {"i1": 127.0, "u1": 255.0, "<i2": 32767.0, "<u2": 65535.0}[DTYPES[a["componentType"]]]
            out = np.maximum(out.astype(np.float64) / scale, -1.0)
        return out

    def image(self, index):
        """The decoded image of glTF image `index` (RGBA, 8 bits)."""
        im = self.json["images"][index]
        if "bufferView" in im:
            data = self.view(im["bufferView"])
        else:
            data = open(os.path.join(self.dir, im["uri"]), "rb").read()
        return Image.open(io.BytesIO(data)).convert("RGBA")

    def texture_image(self, tex):
        """The image index of glTF texture `tex` (the WebP extension's source where there is one)."""
        t = self.json["textures"][tex]
        return t.get("extensions", {}).get("EXT_texture_webp", {}).get("source", t.get("source"))


def local_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if "scale" in node:
        m = np.diag(list(node["scale"]) + [1.0]) @ m
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        r = np.eye(4)
        r[:3, :3] = [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
        m = r @ m
    if "translation" in node:
        t = np.eye(4)
        t[:3, 3] = node["translation"]
        m = t @ m
    return m


def flatten(g):
    """Every primitive of the default scene with its node's whole transform applied: a list of dicts name, material, pos (N,3),
    nrm (N,3), uv (N,2) or None, tri (M,3). A transform that mirrors has its triangles turned over, so they still face out."""
    out = []
    nodes = g.json["nodes"]
    scene = g.json["scenes"][g.json.get("scene", 0)]

    def walk(i, parent):
        node = nodes[i]
        world = parent @ local_matrix(node)
        if "mesh" in node:
            for prim in g.json["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                a = prim["attributes"]
                pos = g.accessor(a["POSITION"]).astype(np.float64)
                nrm = g.accessor(a["NORMAL"]).astype(np.float64) if "NORMAL" in a else np.zeros_like(pos)
                uv = g.accessor(a["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in a else None
                idx = g.accessor(prim["indices"]).reshape(-1).astype(np.int64) if "indices" in prim else np.arange(len(pos))
                tri = idx.reshape(-1, 3)
                lin = world[:3, :3]
                det = np.linalg.det(lin)
                pos = pos @ lin.T + world[:3, 3]
                nrm = nrm @ np.linalg.inv(lin).T
                nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
                if det < 0:
                    tri = tri[:, [0, 2, 1]]
                out.append(dict(name=node.get("name") or "", material=prim.get("material", -1), pos=pos, nrm=nrm, uv=uv, tri=tri))
        for c in node.get("children", []):
            walk(c, world)

    for r in scene["nodes"]:
        walk(r, np.eye(4))
    return out


# ---- what a source's materials are ---------------------------------------------------------------------------------------------

ROLE_ORDER = ["paint", "glass", "lamp", "plate", "tyre", "under", "interior", "body"]
# Roles with nothing of their own to read in a texture: the game draws them from a number.
FLAT_ROLES = {"paint", "glass", "plate"}
NO_UV_ROLES = FLAT_ROLES


def role_of(name):
    """The role of a kit model's material by its name; None for a part that is not shipped (the badges)."""
    low = name.lower()
    if "bodymat" in low:
        return "paint"
    if low.endswith("transperent"):
        return "glass"
    if low == "ucb_lights_and_glass":
        return "lamp"
    if low.startswith("numberplates"):
        return "plate"
    if low.startswith("carbadges"):
        return None
    if low.startswith("rb1c_tire"):
        return "tyre"
    if low.startswith("ucb_bottom"):
        return "under"
    if low.startswith("ucb_interior"):
        return "interior"
    raise SystemExit("material %r has no role: add it to role_of" % name)


def material_textures(g, m):
    """The images a glTF material reads, as glTF image indices: base, orm (the metallic-roughness one), occlusion, normal."""
    pbr = m.get("pbrMetallicRoughness", {})

    def img(ref):
        return None if ref is None else g.texture_image(ref["index"])

    return dict(base=img(pbr.get("baseColorTexture")), mr=img(pbr.get("metallicRoughnessTexture")), occ=img(m.get("occlusionTexture")), normal=img(m.get("normalTexture")))


def fit(im, cap):
    if max(im.size) <= cap:
        return im
    s = cap / max(im.size)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def paint_out_sidewall(im):
    """The tyre sheet's sidewall carries a maker's name and its small print in a ring round the wheel: blurred away inside the ring
    (the brake and the tread are outside it), with a soft edge. Positions are of the source's wheel sheet, as fractions of its side."""
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx + 0.5) / w - 0.4375, (yy + 0.5) / h - 0.5875)
    ring = np.clip((r - 0.225) / 0.02, 0, 1) * np.clip((0.405 - r) / 0.02, 0, 1)
    blurred = np.asarray(im.filter(ImageFilter.GaussianBlur(w / 64)), dtype=np.float64)
    a = np.asarray(im, dtype=np.float64)
    return Image.fromarray(np.clip(a * (1 - ring[..., None]) + blurred * ring[..., None], 0, 255).astype(np.uint8), im.mode)


def webp(im, lossless=False, quality=WEBP_COLOUR):
    buf = io.BytesIO()
    if lossless:
        im.save(buf, "WEBP", lossless=True, quality=100, method=6, exact=True)
    else:
        im.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def colour_image(g, index, cap, role):
    im = fit(g.image(index).convert("RGB"), cap)
    if role == "tyre":
        im = paint_out_sidewall(im)
    return webp(im, quality=WEBP_COLOUR), im.size


def orm_image(g, tex, cap):
    """Occlusion (red), roughness (green), metal (blue) in one image: the red is the occlusion map's where the material has one, and
    white where it has none (the loader reads the red of a lone metal-roughness map as occlusion)."""
    mr = fit(g.image(tex["mr"]).convert("RGB"), cap)
    a = np.asarray(mr).copy()
    if tex["occ"] is None:
        a[..., 0] = 255
    elif tex["occ"] != tex["mr"]:
        occ = g.image(tex["occ"]).convert("RGB").resize(mr.size, Image.LANCZOS)
        a[..., 0] = np.asarray(occ)[..., 0]
    return webp(Image.fromarray(a), quality=WEBP_DATA), mr.size


def normal_image(g, index, cap):
    im = fit(g.image(index).convert("RGB"), cap)
    a = (np.rint(np.asarray(im, dtype=np.float64) / NORMAL_STEP) * NORMAL_STEP).clip(0, 255).astype(np.uint8)
    return webp(Image.fromarray(a), lossless=True), im.size


def tangents(pos, nrm, uv, tri):
    """Per-vertex tangents (xyzw) from the triangles' texture-space edges, orthogonalised against the normal."""
    t = np.zeros_like(pos)
    b = np.zeros_like(pos)
    p0, p1, p2 = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
    u0, u1, u2 = uv[tri[:, 0]], uv[tri[:, 1]], uv[tri[:, 2]]
    e1, e2 = p1 - p0, p2 - p0
    d1, d2 = u1 - u0, u2 - u0
    det = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
    r = np.where(np.abs(det) > 1e-14, 1.0 / np.where(det == 0, 1, det), 0.0)[:, None]
    tt = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) * r
    bb = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) * r
    for k in range(3):
        np.add.at(t, tri[:, k], tt)
        np.add.at(b, tri[:, k], bb)
    t = t - nrm * np.sum(nrm * t, axis=1, keepdims=True)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    w = np.where(np.sum(np.cross(nrm, t) * b, axis=1) < 0, -1.0, 1.0)
    return np.hstack([t, w[:, None]])


# ---- one model ------------------------------------------------------------------------------------------------------------------


def find_source(sources, spec):
    if not os.path.isdir(sources):
        raise SystemExit("no folder %s" % sources)
    found = []
    for provider in sorted(os.listdir(sources)):
        base = os.path.join(sources, provider)
        if provider.startswith(".") or not os.path.isdir(base):
            continue
        found += [os.path.join(base, d) for d in sorted(os.listdir(base)) if not d.startswith(".") and d.startswith(spec["folder"])]
    if len(found) != 1:
        raise SystemExit("%s: expected one folder %s/<provider>/%s*, found %d" % (spec["id"], sources, spec["folder"], len(found)))
    folder = found[0]
    files = [f for f in sorted(os.listdir(folder)) if not f.startswith(".") and f.lower().endswith((".glb", ".gltf"))]
    if len(files) != 1:
        raise SystemExit("%s: expected one .glb or .gltf in %s, found %d" % (spec["id"], folder, len(files)))
    return os.path.join(folder, files[0])


def turn_about_y(prims, front):
    """Brings the model's front, given as the source axis it points along ('+z', '-z', '+x'), to +x (a turn about y)."""
    if front == "+x":
        return
    m = {"+z": np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float), "-z": np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], float), "-x": np.array([[-1, 0, 0], [0, 1, 0], [0, 0, -1]], float)}[front]
    for p in prims:
        p["pos"] = p["pos"] @ m.T
        p["nrm"] = p["nrm"] @ m.T


WORN = dict(
    derelict_sedan=dict(front="+z", wheels=["Object_24", "Object_26", "Object_32"], infer_wheel=True),
    derelict_truck=dict(front="+z", wheels=["Object_28", "Object_30", "Object_32", "Object_34"], infer_wheel=False),
    covered=dict(front="-z", wheels=["covered_car_wheel_01", "covered_car_wheel_02", "covered_car_wheel_03", "covered_car_wheel_04"], infer_wheel=False),
)


def build_model(sources, spec):
    path = find_source(sources, spec)
    g = Gltf(path)
    prims = flatten(g)
    mats = g.json.get("materials", [])
    removed = []
    kit = spec["family"] == "kit"
    for p in prims:
        p["role"] = None
    if kit:
        for p in prims:
            p["role"] = role_of(mats[p["material"]]["name"])
            if p["role"] is None:
                removed.append("badges")
        wheel_prims = [p for p in prims if p["role"] == "tyre"]
        front = "+x"
        wspec = None
    else:
        wspec = WORN[spec["id"]]
        front = wspec["front"]
        for p in prims:
            p["role"] = "body"
        wheel_prims = [p for p in prims if p["name"] in wspec["wheels"]]
    if len(wheel_prims) != len(wspec["wheels"] if wspec else wheel_prims):
        raise SystemExit("%s: wheels not found" % spec["id"])
    # The scale: a model with no unit is sized by its tyres.
    if spec.get("wheel_d"):
        dia = np.mean([p["pos"][:, 1].max() - p["pos"][:, 1].min() for p in wheel_prims])
        s = spec["wheel_d"] / dia
        for p in prims:
            p["pos"] = p["pos"] * s
        scale = dict(applied=round(float(s), 5), estimated=True, basis="tyre diameter %.2f m" % spec["wheel_d"])
    else:
        scale = dict(applied=1.0, estimated=False, basis="metres in the file")
    turn_about_y(prims, front)
    prims = [p for p in prims if p["role"] is not None]
    wheel_prims = [p for p in wheel_prims if p["role"] is not None]
    # Standing on y = 0 at the tyres' lowest, centred on the footprint.
    low = min(p["pos"][:, 1].min() for p in wheel_prims)
    allp = np.vstack([p["pos"] for p in prims])
    cx = (allp[:, 0].min() + allp[:, 0].max()) / 2
    # Centred across on the wheels' middle for a kit model (its mirrors reach a little further on one side); on the bounds for a worn one,
    # whose doors hang open on one side and whose wheels are not in a line.
    cz = float(np.mean([(p["pos"][:, 2].min() + p["pos"][:, 2].max()) / 2 for p in wheel_prims])) if kit else float((allp[:, 2].min() + allp[:, 2].max()) / 2)
    for p in prims:
        p["pos"] = p["pos"] - np.array([cx, low, cz])
    wheels = []
    for p in wheel_prims:
        lo, hi = p["pos"].min(0), p["pos"].max(0)
        wheels.append(dict(x=float((lo[0] + hi[0]) / 2), z=float((lo[2] + hi[2]) / 2), y=float(lo[1]), r=float((hi[1] - lo[1]) / 2), inferred=False))
    if wspec and wspec["infer_wheel"]:
        # A wheel gone from its hub: its place is across the car from the one left on its axle, as far from the middle as the other axle's.
        axles = {}
        for w in wheels:
            axles.setdefault(round(w["x"] / 0.5), []).append(w)
        full = [a for a in axles.values() if len(a) == 2][0]
        for a in axles.values():
            if len(a) == 1:
                lone = a[0]
                wheels.append(dict(x=lone["x"], z=full[0]["z"] + full[1]["z"] - lone["z"], y=lone["y"], r=lone["r"], inferred=True))
    return prims, wheels, g, path, scale, sorted(set(removed))


def pad4(b, fill=b"\0"):
    return b + fill * (-len(b) % 4)


class Writer:
    """A binary glTF being written: one buffer, its views and accessors."""

    def __init__(self):
        self.blob = b""
        self.views = []
        self.accessors = []

    def view(self, data, target=None):
        self.blob = pad4(self.blob)
        v = dict(buffer=0, byteOffset=len(self.blob), byteLength=len(data))
        if target:
            v["target"] = target
        self.blob += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, array, ctype, kind, target, bounds=False):
        data = np.ascontiguousarray(array).tobytes()
        a = dict(bufferView=self.view(data, target), componentType=ctype, count=int(len(array)), type=kind)
        if bounds:
            a["min"] = [float(x) for x in array.min(0)]
            a["max"] = [float(x) for x in array.max(0)]
        self.accessors.append(a)
        return len(self.accessors) - 1


def build_glb(spec, prims, g, wheels):
    """The shipped file's bytes, and what the manifest says of it."""
    mats = g.json.get("materials", [])
    w = Writer()
    images, textures, materials, meshes, nodes = [], [], [], [], []
    role_info = {}
    # Roles by their textures: a role whose materials differ in their images is split in two (named `<role>2`).
    groups = {}
    for p in prims:
        m = mats[p["material"]] if p["material"] >= 0 else {}
        tex = material_textures(g, m) if m else dict(base=None, mr=None, occ=None, normal=None)
        key = (p["role"], tex["base"], tex["mr"], tex["occ"], tex["normal"] if p["role"] == "body" else None) if p["role"] not in FLAT_ROLES else (p["role"],)
        groups.setdefault(key, []).append(p)
    named = {}
    seen = {}
    for key in sorted(groups, key=lambda k: (ROLE_ORDER.index(k[0]), str(k))):
        role = key[0]
        seen[role] = seen.get(role, 0) + 1
        named[key] = role if seen[role] == 1 else "%s%d" % (role, seen[role])
    removed_data = []
    for key in sorted(groups, key=lambda k: (ROLE_ORDER.index(k[0]), str(k))):
        role = key[0]
        name = named[key]
        members = groups[key]
        first = mats[members[0]["material"]] if members[0]["material"] >= 0 else {}
        pbr = first.get("pbrMetallicRoughness", {})
        tex = material_textures(g, first) if first else {}
        cap = TEXTURE_CAP["body" if role == "body" else role] if role not in FLAT_ROLES else 0
        material = dict(name=name, doubleSided=True)
        pbr_out = {}
        info = dict(role=role, textures=[])

        def add_image(data, label, size):
            images.append(dict(name="vehicle.%s.%s.%s" % (spec["id"], name, label), mimeType="image/webp", bufferView=w.view(data)))
            textures.append(dict(source=len(images) - 1, sampler=0))
            info["textures"].append(dict(map=label, size=list(size), bytes=len(data)))
            return dict(index=len(textures) - 1)

        if role == "paint":
            pbr_out.update(baseColorFactor=[0.5, 0.5, 0.5, 1.0], metallicFactor=0.0, roughnessFactor=0.45)
        elif role == "glass":
            material["alphaMode"] = "BLEND"
            pbr_out.update(baseColorFactor=[0.04, 0.055, 0.065, 0.55], metallicFactor=0.0, roughnessFactor=0.04)
        elif role == "plate":
            pbr_out.update(baseColorFactor=[0.6, 0.6, 0.56, 1.0], metallicFactor=0.0, roughnessFactor=0.5)
        else:
            if tex.get("base") is not None:
                data, size = colour_image(g, tex["base"], cap, role)
                pbr_out["baseColorTexture"] = add_image(data, "colour", size)
            else:
                pbr_out["baseColorFactor"] = pbr.get("baseColorFactor", [1, 1, 1, 1])
            if tex.get("mr") is not None:
                data, size = orm_image(g, tex, cap)
                ref = add_image(data, "orm", size)
                pbr_out["metallicRoughnessTexture"] = ref
                material["occlusionTexture"] = dict(ref)
            pbr_out["metallicFactor"] = float(pbr.get("metallicFactor", 0.0 if role == "lamp" else 1.0))
            pbr_out["roughnessFactor"] = float(pbr.get("roughnessFactor", 1.0))
            if role == "body" and tex.get("normal") is not None:
                data, size = normal_image(g, tex["normal"], cap)
                material["normalTexture"] = add_image(data, "normal", size)
        material["pbrMetallicRoughness"] = pbr_out
        materials.append(material)
        # The geometry: every member joined.
        pos, nrm, uv, tri, base = [], [], [], [], 0
        for p in members:
            pos.append(p["pos"])
            nrm.append(p["nrm"])
            uv.append(p["uv"] if p["uv"] is not None else np.zeros((len(p["pos"]), 2)))
            tri.append(p["tri"] + base)
            base += len(p["pos"])
        pos = np.vstack(pos).astype("<f4")
        nrm = np.vstack(nrm).astype("<f4")
        uv = np.vstack(uv).astype("<f4")
        tri = np.vstack(tri)
        index = tri.reshape(-1).astype("<u2" if len(pos) < 65536 else "<u4")
        attrs = dict(POSITION=w.accessor(pos, 5126, "VEC3", 34962, bounds=True), NORMAL=w.accessor(nrm, 5126, "VEC3", 34962))
        if role not in NO_UV_ROLES:
            attrs["TEXCOORD_0"] = w.accessor(uv, 5126, "VEC2", 34962)
            if "normalTexture" in material:
                attrs["TANGENT"] = w.accessor(tangents(pos.astype(np.float64), nrm.astype(np.float64), uv.astype(np.float64), tri).astype("<f4"), 5126, "VEC4", 34962)
        prim = dict(attributes=attrs, indices=w.accessor(index, 5125 if index.dtype == np.dtype("<u4") else 5123, "SCALAR", 34963), material=len(materials) - 1, mode=4)
        meshes.append(dict(name="vehicle.%s.%s" % (spec["id"], name), primitives=[prim]))
        nodes.append(dict(name="vehicle.%s.%s" % (spec["id"], name), mesh=len(meshes) - 1))
        info.update(triangles=int(len(tri)), vertices=int(len(pos)))
        role_info[name] = info
    root = len(nodes)
    nodes.append(dict(name="LOD0", children=list(range(root))))
    doc = {
        "asset": dict(version="2.0", generator="game-capesorrow tools/models/build.py"),
        "scene": 0,
        "scenes": [dict(nodes=[root])],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "samplers": [dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
        "buffers": [dict(byteLength=len(pad4(w.blob)))],
        "bufferViews": w.views,
        "accessors": w.accessors,
    }
    if images:
        doc["images"] = images
        doc["textures"] = textures
    js = pad4(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    bn = pad4(w.blob)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn)) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bn), 0x004E4942) + bn
    del removed_data
    return out, role_info


def entry_of(spec, prims, wheels, scale, removed, roles, data, path):
    allp = np.vstack([p["pos"] for p in prims])
    lo, hi = allp.min(0), allp.max(0)
    ws = sorted(wheels, key=lambda w: (-w["x"], w["z"]))
    front = [w for w in ws if w["x"] > 0] or ws[:2]
    rear = [w for w in ws if w not in front] or ws[-2:]
    wheelbase = float(np.mean([w["x"] for w in front]) - np.mean([w["x"] for w in rear]))
    track = float(np.mean([abs(w["z"]) for w in ws]) * 2)
    r3 = lambda v: round(float(v), 3)  # noqa: E731
    return dict(
        id="vehicle.%s" % spec["id"],
        file="vehicle.%s.glb" % spec["id"],
        kind=spec["kind"],
        note=spec["note"],
        credit="vehicle.%s" % spec["id"],
        credit_scale=scale,
        footprint=dict(length=r3(2 * max(-lo[0], hi[0])), width=r3(2 * max(-lo[2], hi[2])), height=r3(hi[1] - lo[1]), x=[r3(lo[0]), r3(hi[0])], z=[r3(lo[2]), r3(hi[2])]),
        wheels=[dict(x=r3(w["x"]), z=r3(w["z"]), y=r3(w["y"]), r=r3(w["r"]), inferred=w["inferred"]) for w in ws],
        wheelbase=r3(wheelbase),
        track=r3(track),
        triangles=sum(r["triangles"] for r in roles.values()),
        roles=roles,
        removed=removed,
        bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )


def manifest_of(entries):
    return dict(
        about="Written by tools/models/build.py: do not edit. Metres; +x is the front, y up, the files stand on y = 0 and are centred on their footprint. Where a work came from is in CREDITS.md, under the credit id.",
        total_bytes=sum(e["bytes"] for e in entries),
        vehicles=entries,
    )


def build_all(sources):
    entries, files = [], {}
    for spec in MODELS:
        prims, wheels, g, path, scale, removed = build_model(sources, spec)
        data, roles = build_glb(spec, prims, g, wheels)
        entries.append(entry_of(spec, prims, wheels, scale, removed, roles, data, path))
        files[entries[-1]["file"]] = data
    return manifest_of(entries), files


def check(out, sources):
    path = os.path.join(out, MANIFEST)
    if not os.path.exists(path):
        print("manifest is missing")
        return 1
    on_disk = json.load(open(path))
    bad = []
    if [e["id"] for e in on_disk["vehicles"]] != ["vehicle.%s" % m["id"] for m in MODELS]:
        bad.append("the manifest's models are not MODELS")
    for e in on_disk["vehicles"]:
        f = os.path.join(out, e["file"])
        if not os.path.exists(f):
            bad.append("%s is missing" % e["file"])
            continue
        data = open(f, "rb").read()
        if len(data) != e["bytes"] or hashlib.sha256(data).hexdigest() != e["sha256"]:
            bad.append("%s is not what the manifest lists" % e["file"])
    if not bad and os.path.isdir(sources):
        manifest, files = build_all(sources)
        # The encoders differ between machines: what is compared is everything but the bytes and hashes of the files.
        def bare(m):
            return json.dumps(strip(m), sort_keys=True)

        def strip(m):
            if isinstance(m, dict):
                return {k: strip(v) for k, v in m.items() if k not in ("bytes", "sha256", "total_bytes")}
            if isinstance(m, list):
                return [strip(v) for v in m]
            return m

        if bare(manifest) != bare(on_disk):
            bad.append("the manifest is not what the sources give")
    for b in bad:
        print(b)
    print("models are current" if not bad else "models are stale")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=DEFAULT_SOURCES)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        sys.exit(check(args.out, args.sources))
    manifest, files = build_all(args.sources)
    os.makedirs(args.out, exist_ok=True)
    for name, data in files.items():
        with open(os.path.join(args.out, name), "wb") as f:
            f.write(data)
        print("%-30s %8d bytes" % (name, len(data)))
    with open(os.path.join(args.out, MANIFEST), "w") as f:
        f.write(json.dumps(manifest, indent=2) + "\n")
    print("total %.2f MB" % (manifest["total_bytes"] / 1e6))


if __name__ == "__main__":
    main()

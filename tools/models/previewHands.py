#!/usr/bin/env python3 -I
"""An offline look at the built hand models (`client/assets/models/hand.right.glb` and `hand.left.glb`), in software, with numpy and Pillow only.

This draws the BUILT files, with their base colour textures sampled,
lit from up and the left, at the hold each arm has in the game: the right arm by `client/src/game/hand/handPose.ts` (`holdFor`, `torchBasis` at the drawn
axis and the roll, `handScaleFor`) and the left by `watchPose.ts`. The numbers below are those files' constants read by `holdFromSource`, so that a change of the
hold shows here at once. Nothing is run from the models: they are read as data.

    python3 -I tools/models/previewHands.py [--models client/assets/models] [--out /Volumes/CyrusExtSSD/dayhike-lab/capesorrow-hand-preview]

It writes `real-both-16x10.png` (and `real-both-12x10.png` and `real-both-22x10.png`, the hold at the narrowest and the widest shape), `real-torch-closeup.png`, `real-watch-closeup.png` and `real-grip-palm.png` (the right hand and the left, each from the palm
side, so that the grip can be judged). The file's frame is right handed and the game's loader mirrors x on a model's root, so the picture draws a point (x, y, z)
of a file at (-x, y, z) of the game's left handed frame (x right, y up, z forward), as the game does.
"""
import argparse
import importlib.util
import io
import math
import os
import re
import subprocess
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_MODELS = os.path.join(ROOT, "client", "assets", "models")
DEFAULT_OUT = "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-hand-preview"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build = _load("build_models", os.path.join(HERE, "build.py"))
build.WIDTH["MAT4"] = 16


# ---- the hold, read from the game's own constants ---------------------------------------------------------------------------------

def constants(path):
    """Every `export const NAME = number` (and `NAME = { x: a, y: b }`) of a source file, as numbers, for the hold."""
    text = open(path).read()
    out = {}
    for line in text.splitlines():
        if line.startswith("export const ") and "{" not in line and "[" not in line:
            for m in re.finditer(r"(\w+)(?::[^=,]+)? = (-?\d+(?:\.\d+)?)\s*[,;]", line):
                out[m.group(1)] = float(m.group(2))
    for m in re.finditer(r"export const (\w+) = \{ x: (-?[\d.]+), y: (-?[\d.]+) \}", text):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    m = re.search(r"WATCH_AXIS[^=]*= \[([^\]]+)\]", text)
    if m:
        out["WATCH_AXIS"] = [float(v) for v in m.group(1).split(",")]
    return out


def holdFromSource():
    base = os.path.join(ROOT, "client", "src", "game", "hand")
    h = constants(os.path.join(base, "handPose.ts"))
    w = constants(os.path.join(base, "watchPose.ts"))
    return h, w


def torch_basis(yaw, pitch, roll, scale):
    """`torchBasis` of handPose.ts for a drawn axis (yaw, pitch) and roll: three columns (right, up, forward), each times `scale`."""
    m = np.array([math.sin(yaw) * math.cos(pitch), -math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
    u = np.array([-m[1] * m[0], 1 - m[1] * m[1], -m[1] * m[2]])
    u /= np.linalg.norm(u)
    r = np.cross(u, m)
    cr, sr = math.cos(roll), math.sin(roll)
    r, u = r * cr + u * sr, u * cr - r * sr
    return np.stack([r, u, m], axis=1) * scale


def torch_scale_for(h, aspect):
    return h["HAND_SCALE"] * min(1.0, max(h["ASPECT_MIN"], aspect) / 1.6)


def holds(aspect=1.6, screen=None, screen_share=0.235):
    """`screen` is the left file's lit screen's diameter (metres): where given, the left arm's scale is the one that makes it `screen_share` of the view's height."""
    """The two arms' placements at the hold: (position, 3x3 basis) for a file's mirrored local frame, as the game draws them."""
    h, w = holdFromSource()
    half = math.tan(h["FOV"] / 2)
    a = min(h["ASPECT_MAX"], max(h["ASPECT_MIN"], aspect))
    hs = h["HOLD_SCREEN"]
    right_pos = np.array([(2 * hs[0] - 1) * half * a * h["HOLD_DEPTH"], -(2 * hs[1] - 1) * half * h["HOLD_DEPTH"], h["HOLD_DEPTH"]])
    right_basis = torch_basis(h["DRAWN_YAW"], h["DRAWN_PITCH"], h["HOLD_ROLL"], torch_scale_for(h, aspect))
    ws = w["WATCH_SCREEN"]
    left_pos = np.array([(2 * ws[0] - 1) * half * a * w["WATCH_DEPTH"], -(2 * ws[1] - 1) * half * w["WATCH_DEPTH"], w["WATCH_DEPTH"]])
    axis = np.array(w["WATCH_AXIS"])
    axis /= np.linalg.norm(axis)
    # The pose's mx, my, mz is the watch axis and the roll turns the face to the eye (`stepWatch`): the same `torchBasis`.
    arm_scale = w["ARM_SCALE"] if screen is None else screen_share * 2 * half * w["WATCH_DEPTH"] / screen
    lb = torch_basis_from_axis(axis, w["WATCH_ROLL"], arm_scale)
    # The left file's frame is x toward the fingers, y toward twelve, z out of the face; the loader's mirror puts the fingers at the mesh's -x. The pose's forearm
    # axis is the fingers' way and its `up` the face's normal: so the mesh's x is -axis, its y is -right (twelve is up the face's page) and its z is up.
    left_basis = np.stack([-lb[:, 2], -lb[:, 0], lb[:, 1]], axis=1)
    return dict(right=(right_pos, right_basis), left=(left_pos, left_basis), fov=h["FOV"], left_scale=arm_scale)


def torch_basis_from_axis(m, roll, scale):
    u = np.array([-m[1] * m[0], 1 - m[1] * m[1], -m[1] * m[2]])
    u /= np.linalg.norm(u)
    r = np.cross(u, m)
    cr, sr = math.cos(roll), math.sin(roll)
    r, u = r * cr + u * sr, u * cr - r * sr
    return np.stack([r, u, np.array(m)], axis=1) * scale


def decode_ktx2(g, texture):
    """A texture of the built file as a picture: its KTX2 image transcoded to RGBA by the `ktx` tool, from the second mip level (half size) to keep the drawing quick."""
    src = g.json["textures"][texture]["extensions"]["KHR_texture_basisu"]["source"]
    data = g.view(g.json["images"][src]["bufferView"])
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "in.ktx2"), os.path.join(d, "out.png")
        open(a, "wb").write(data)
        subprocess.run(["ktx", "extract", "--transcode", "rgba8", "--level", "1", a, b], check=True, capture_output=True)
        return Image.open(b).convert("RGBA")


# ---- reading a built file ---------------------------------------------------------------------------------------------------------

def read_glb(path):
    """The meshes of a built file as items: dict(name, pos, nrm, uv, tri, tex (float RGBA, linear colour, or None), factor, alpha)."""
    g = build.Gltf(path)
    items = []
    for p in build.flatten(g):
        m = g.json["materials"][p["material"]] if p["material"] >= 0 else {}
        pbr = m.get("pbrMetallicRoughness", {})
        factor = np.array(pbr.get("baseColorFactor", [1, 1, 1, 1]), dtype=np.float64)
        tex = None
        if "baseColorTexture" in pbr:
            tex = np.asarray(decode_ktx2(g, pbr["baseColorTexture"]["index"]), dtype=np.float64) / 255.0
        items.append(dict(name=p["name"], matname=m.get("name", ""), pos=p["pos"], nrm=p["nrm"], uv=p["uv"], tri=p["tri"], tex=tex, factor=factor,
                          blend=m.get("alphaMode") == "BLEND", emissive=np.array(m.get("emissiveFactor", [0, 0, 0]), dtype=np.float64),
                          metallic=float(pbr.get("metallicFactor", 1.0)), roughness=float(pbr.get("roughnessFactor", 1.0))))
    return items


def turned_about_z(items, angle):
    """The items turned about the file's z axis (a change of the roll a file is held at)."""
    c, s = math.cos(angle), math.sin(angle)
    m = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    out = []
    for it in items:
        k = dict(it)
        k["pos"] = it["pos"] @ m.T
        k["nrm"] = it["nrm"] @ m.T
        out.append(k)
    return out


def placed(items, pos, basis):
    """The items moved into the game's frame: a file's (x, y, z) is drawn at (-x, y, z), then turned by `basis` (columns right, up, forward) and moved to `pos`."""
    out = []
    flip = np.array([-1.0, 1.0, 1.0])
    for it in items:
        c = dict(it)
        c["pos"] = (it["pos"] * flip) @ basis.T + pos
        n = (it["nrm"] * flip) @ basis.T
        c["nrm"] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        out.append(c)
    return out


def with_lit_circle(items, info):
    """The screen's black plate with a stand-in for the map laid on it: a disc the size `hands.json` says the lit circle is (inside the case's rim), so that its size and place can be judged."""
    lit = info["screen_diameter"]
    out = []
    for it in items:
        if it["name"] != "watch_screen":
            out.append(it)
            continue
        out.append(it)
        radius = float(np.max(np.hypot(it["pos"][:, 0], it["pos"][:, 1])))
        k = lit / 2 / radius
        disc = dict(it)
        disc["pos"] = it["pos"] * np.array([k, k, 1.0]) + np.array([0.0, 0.0, 0.0005])
        disc["factor"] = np.array([0.55, 0.72, 0.95, 1.0])
        out.append(disc)
    return out


# ---- the rasteriser ----------------------------------------------------------------------------------------------------------------

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def sample(tex, uv):
    """Bilinear, repeating."""
    h, w = tex.shape[:2]
    u = (uv[:, 0] % 1.0) * w - 0.5
    v = (uv[:, 1] % 1.0) * h - 0.5
    x0 = np.floor(u).astype(int)
    y0 = np.floor(v).astype(int)
    fx = (u - x0)[:, None]
    fy = (v - y0)[:, None]
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return (tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx) * (1 - fy) + (tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx) * fy


# The nearest distance drawn: a point nearer than this is drawn as if it were this far (the game clips at its own near plane; this is a stand-in).
NEAR = 0.03
LIGHT = np.array([-0.45, 0.65, -0.6])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


class View:
    """A camera at the origin looking along +z (x right, y up), vertical field `fov`, `zoom` times in on the share (cx, cy) of the frame."""

    def __init__(self, width, height, fov, zoom=1.0, cx=0.5, cy=0.5):
        self.W, self.H, self.half = width, height, math.tan(fov / 2)
        self.aspect = width / height
        self.zoom, self.cx, self.cy = zoom, cx, cy

    def project(self, p):
        z = np.maximum(p[:, 2], NEAR)
        sx = ((0.5 + p[:, 0] / z / (self.half * self.aspect) / 2) - self.cx) * self.zoom + 0.5
        sy = ((0.5 - p[:, 1] / z / self.half / 2) - self.cy) * self.zoom + 0.5
        return sx * self.W, sy * self.H, 1.0 / z


def look_at(items, eye, target, up=(0.0, 1.0, 0.0)):
    """The items as a camera at `eye` looking at `target` sees them, in the camera's frame (x right, y up, z forward)."""
    f = np.array(target, dtype=np.float64) - eye
    f /= np.linalg.norm(f)
    r = np.cross(np.array(up, dtype=np.float64), f)
    r /= np.linalg.norm(r)
    u = np.cross(f, r)
    m = np.stack([r, u, f])
    out = []
    for it in items:
        c = dict(it)
        c["pos"] = (it["pos"] - eye) @ m.T
        c["nrm"] = it["nrm"] @ m.T
        out.append(c)
    return out


def draw(items, view, background=(0.62, 0.66, 0.72), light=LIGHT, ambient=0.38, ss=2):
    """Rasterise `items` (already in the camera's frame) into an RGB uint8 picture of the view's size."""
    W, H = view.W * ss, view.H * ss
    big = View(W, H, 2 * math.atan(view.half), view.zoom, view.cx, view.cy)
    big.aspect = view.aspect
    img = np.empty((H, W, 3))
    img[:] = np.array(background)[None, None, :]
    img = srgb_to_linear(img)
    zbuf = np.zeros((H, W))
    ordered = [i for i in items if not i["blend"]] + [i for i in items if i["blend"]]
    for it in ordered:
        sx, sy, iz = big.project(it["pos"])
        tri = it["tri"]
        uv = it["uv"] if it["uv"] is not None else np.zeros((len(it["pos"]), 2))
        tex, factor = it["tex"], it["factor"]
        if tex is not None:
            tex = srgb_to_linear(tex[..., :3]) if tex.shape[2] >= 3 else tex
            alpha_tex = it["tex"][..., 3] if it["tex"].shape[2] == 4 else None
        else:
            alpha_tex = None
        base_lin = srgb_to_linear(factor[:3])
        for t in tri:
            a, b, c = t
            if it["pos"][a, 2] < NEAR and it["pos"][b, 2] < NEAR and it["pos"][c, 2] < NEAR:
                continue
            x0, x1, x2 = sx[a], sx[b], sx[c]
            y0, y1, y2 = sy[a], sy[b], sy[c]
            xmin = max(int(math.floor(min(x0, x1, x2))), 0)
            xmax = min(int(math.ceil(max(x0, x1, x2))) + 1, W)
            ymin = max(int(math.floor(min(y0, y1, y2))), 0)
            ymax = min(int(math.ceil(max(y0, y1, y2))) + 1, H)
            if xmin >= xmax or ymin >= ymax:
                continue
            area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if abs(area) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(xmin, xmax) + 0.5, np.arange(ymin, ymax) + 0.5)
            w1 = ((gx - x0) * (y2 - y0) - (x2 - x0) * (gy - y0)) / area
            w2 = ((x1 - x0) * (gy - y0) - (gx - x0) * (y1 - y0)) / area
            w0 = 1 - w1 - w2
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            z_inv = w0 * iz[a] + w1 * iz[b] + w2 * iz[c]
            zb = zbuf[ymin:ymax, xmin:xmax]
            ok = inside & (z_inv > zb)
            if not ok.any():
                continue
            # perspective correct weights
            p0, p1, p2 = w0[ok] * iz[a], w1[ok] * iz[b], w2[ok] * iz[c]
            s = p0 + p1 + p2
            p0, p1, p2 = p0 / s, p1 / s, p2 / s
            n = p0[:, None] * it["nrm"][a] + p1[:, None] * it["nrm"][b] + p2[:, None] * it["nrm"][c]
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
            # a face seen from behind is lit by its flipped normal
            fn = np.cross(it["pos"][b] - it["pos"][a], it["pos"][c] - it["pos"][a])
            toward = -(it["pos"][a] @ fn)
            flip = np.sign(np.sum(n * fn, axis=1))
            n = n * np.where(flip == 0, 1, flip)[:, None] * (1 if toward != 0 else 1)
            if np.dot(fn, it["pos"][a]) > 0:
                pass
            lam = np.clip(n @ light, 0, 1)
            shade = ambient + (1 - ambient) * lam
            metal = it.get("metallic", 0.0)
            if metal > 0.3:
                # a stand-in for the sky a metal reflects: brighter all round, and a highlight where the light's half vector meets the normal
                view_dir = -np.array([(p0 * it["pos"][a][0] + p1 * it["pos"][b][0] + p2 * it["pos"][c][0]), (p0 * it["pos"][a][1] + p1 * it["pos"][b][1] + p2 * it["pos"][c][1]), (p0 * it["pos"][a][2] + p1 * it["pos"][b][2] + p2 * it["pos"][c][2])]).T
                view_dir /= np.maximum(np.linalg.norm(view_dir, axis=1, keepdims=True), 1e-12)
                half = view_dir + light
                half /= np.maximum(np.linalg.norm(half, axis=1, keepdims=True), 1e-12)
                spec = np.clip(np.sum(n * half, axis=1), 0, 1) ** (6 + 60 * (1 - it.get("roughness", 0.5)))
                shade = shade * (1 + 5.0 * metal) + 0.6 * metal * spec
            if tex is not None:
                u = p0[:, None] * uv[a] + p1[:, None] * uv[b] + p2[:, None] * uv[c]
                col = sample(tex, u) * base_lin[None, :]
            else:
                col = np.tile(base_lin, (len(p0), 1))
            lit = col * shade[:, None] + it["emissive"][None, :]
            alpha = factor[3]
            if it["blend"]:
                alpha = np.full(len(p0), alpha)
                dst = img[ymin:ymax, xmin:xmax][ok]
                img[ymin:ymax, xmin:xmax][ok] = dst * (1 - alpha[:, None]) + lit * alpha[:, None]
            else:
                img[ymin:ymax, xmin:xmax][ok] = lit
                zb[ok] = z_inv[ok]
    out = (linear_to_srgb(img) * 255 + 0.5).astype(np.uint8)
    pic = Image.fromarray(out)
    if ss > 1:
        pic = pic.resize((view.W, view.H), Image.LANCZOS)
    return pic


# ---- the four pictures -------------------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=DEFAULT_MODELS)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    right = read_glb(os.path.join(args.models, "hand.right.glb"))
    import json
    info = json.load(open(os.path.join(args.models, "hands.json")))
    left = with_lit_circle(read_glb(os.path.join(args.models, "hand.left.glb")), info["files"]["hand.left.glb"]["watch"])
    pose = holds(1.6)
    sd = info["files"]["hand.left.glb"]["watch"]["screen_diameter"]
    print("the watch's screen is %.1f%% of the view's height across at the hold (left arm drawn %.2f times)" % (100 * sd * pose["left_scale"] / (2 * math.tan(pose["fov"] / 2) * holdFromSource()[1]["WATCH_DEPTH"]), pose["left_scale"]))
    fov = pose["fov"]
    scene = placed(right, *pose["right"]) + placed(left, *pose["left"])

    def want(name):
        return not args.only or name in args.only

    if want("both"):
        draw(scene, View(1248, 780, fov)).save(os.path.join(args.out, "real-both-16x10.png"))
    if want("sizes"):
        # the same hold at the narrowest and the widest shape the game works out a hold for: the forearms' cut ends must be out of the view in both
        for aspect, name in ((1.2, "real-both-12x10.png"), (2.2, "real-both-22x10.png")):
            p = holds(aspect)
            draw(placed(right, *p["right"]) + placed(left, *p["left"]), View(int(780 * aspect), 780, fov)).save(os.path.join(args.out, name))
    if want("torch"):
        rp = pose["right"][0]
        h = 0.5 + 0.0
        draw(placed(right, *pose["right"]), View(1000, 780, fov, zoom=2.0, cx=0.62, cy=0.62)).save(os.path.join(args.out, "real-torch-closeup.png"))
    if want("watch"):
        draw(placed(left, *pose["left"]), View(1000, 780, fov, zoom=3.0, cx=0.31, cy=0.7)).save(os.path.join(args.out, "real-watch-closeup.png"))
    if want("grip"):
        # each hand from the palm side: the camera is put on the palm's side of its own file's frame by the file's own `palm` hint (hands.json)
        import json
        info = json.load(open(os.path.join(args.models, "hands.json")))
        tiles = []
        for key, items in (("right", right), ("left", left)):
            view = info["files"]["hand.%s.glb" % key]["preview"]["palm"]
            eye = np.array(view["eye"]); target = np.array(view["target"]); up = np.array(view["up"])
            flip = np.array([-1.0, 1.0, 1.0])
            moved = placed(items, np.zeros(3), np.eye(3))
            tiles.append(draw(look_at(moved, eye * flip, target * flip, up * flip), View(780, 780, 0.6)))
        both = Image.new("RGB", (1560, 780))
        both.paste(tiles[0], (0, 0))
        both.paste(tiles[1], (780, 0))
        both.save(os.path.join(args.out, "real-grip-palm.png"))


if __name__ == "__main__":
    main()

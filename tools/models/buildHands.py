#!/usr/bin/env python3 -I
"""Builds the first person arms' models from three downloaded works, in the manner of `build.py` beside it.

    python3 -I tools/models/buildHands.py [--sources DIR] [--out DIR] [--encoder SCRIPT] [--check]

It reads (only) three binary glTF files under the sources folder: a pair of arms in leather jacket sleeves and fingerless gloves, a tactical torch and a smart
watch (the folders' first characters are in `SOURCES`). It writes `hand.right.glb`, `hand.left.glb` and `hands.json` (the manifest: sizes, SHA-256, counts, credit ids
and the numbers the game places things by) into the output folder. The models are read as data: no code in them is run, and nothing is written to the sources.

* `hand.right.glb`: the right forearm and hand posed gripping the torch, with the torch in the grip, as one static (unskinned) file. The skin is baked here, by
  linear blend skinning in numpy from the joints' pose, the file's inverse bind matrices and its weights.
* `hand.left.glb`: the left forearm and hand relaxed, as when a wrist is turned up to read a watch, with the watch on the back of the wrist and a brown
  leather strap of our own making in place of the watch's bracelet.

Both are right handed glTF, in metres. A model's frame is given in `hands.json` (`frame`) and below, at `RIGHT_FRAME` and `LEFT_FRAME`. The game's loader
mirrors x on a model's root, which turns a right handed file into the game's left handed frame without turning a right hand into a left one.

Needs Python 3 with Pillow and numpy, and to BUILD, the texture encoder: a script outside this repository (`--encoder`, see `ENCODER`) that turns a picture into a
KTX2 file with no metadata. Encoders differ between machines, so `--check` compares the files on disk with the manifest's sizes and hashes and, where the sources
and the encoder are both at hand, the manifest with what the sources give except for sizes and hashes.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SOURCES = "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-models"  # keeps the game's former name on purpose: the sources are stored in a folder of that name
# The texture encoder: a script outside this repository, called as `ENCODER IN.png OUT.ktx2 colour|data|normal` (see `encode`). Its place can be given with
# `--encoder` or the environment's MODEL_TEXTURE_ENCODER.
ENCODER = os.environ.get("MODEL_TEXTURE_ENCODER", "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-models/tools/encode-texture.py")
DEFAULT_OUT = os.path.join(HERE, "..", "..", "client", "assets", "models")
MANIFEST = "hands.json"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build = _load("build_models", os.path.join(HERE, "build.py"))
build.WIDTH["MAT4"] = 16

# The credit ids (CREDITS.md `## <id>`), the folder to find (its first characters) and the file within it.
SOURCES = dict(
    arms=dict(id="hand.arms", folder="e3c42c0", file="first_person_arms.glb"),
    torch=dict(id="hand.torch", folder="dfb9ec2", file="tactical_flashlight.glb"),
    watch=dict(id="hand.watch", folder="c896964", file="wrist_watch_smartwatch.glb"),
)
# Texture sizes (the longer side) and the encoders' quality.
# The longer side of each map, in texels: a colour map is larger than a data map (normal, occlusion-roughness-metal).
COLOUR_SIZE = 1024
DATA_SIZE = 512

# Sizes, metres. The arms' file is in centimetres, near enough (a forearm there is 24 long).
ARMS_UNIT = 0.01
TORCH_LENGTH = 0.24
WATCH_CASE = 0.045
# The watch is sized from the wrist: its case is WATCH_FIT times the width of the arm under it (the silhouette across the forearm at the watch: the sleeve's end or the glove's
# cuff), `big` times a 45 mm case (about life size on this arm), and the strap's width and thickness follow it; the strap's path round the sleeve is the sleeve's own. The case stands
# on the sleeve, nearer the eye than the sleeve's widest points, so at the hold it is seen about 18 percent larger than it is against them: 0.68 here is 0.8 of the wrist as the eye
# sees it (`client/test/hand/handScreen.test.ts` measures that on the screen, 0.76 to 0.84). The build checks the share in the file is between WATCH_FIT_RANGE.
WATCH_FIT = 0.68
WATCH_FIT_RANGE = (0.62, 0.74)
# The lit circle the page draws the map on is this share of the case's diameter: inside the rim, so that the dark rim shows all round it. (The black plate under the glass,
# which the source has, reaches 92 percent of the case: that is the screen mesh, and it is not the lit part.)
LIT_SHARE = 0.88

RIGHT_FRAME = "origin at the middle of the torch's lens; +z the way the torch points (its tail is at -z); +y up as held (the roll the game's hold, handPose.ts, is worked out for); +x completes the right handed frame"
LEFT_FRAME = "origin at the middle of the watch's screen; +z out of the screen toward the reader; +y toward twelve o'clock; +x completes the right handed frame"


# ---- the source files ------------------------------------------------------------------------------------------------------------

def find_source(sources, spec):
    """The one .glb of the folder `<sources>/<provider>/<spec folder>*`, as `build.py` finds a model."""
    return build.find_source(sources, spec)


def rot(axis, angle):
    """The 4x4 turn by `angle` about the unit `axis` (Rodrigues)."""
    a = np.asarray(axis, dtype=np.float64)
    a = a / np.linalg.norm(a)
    c, s = math.cos(angle), math.sin(angle)
    x, y, z = a
    r = np.array([
        [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
        [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
        [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
    ])
    m = np.eye(4)
    m[:3, :3] = r
    return m


def about(m, point):
    """The 4x4 `m` made to act about `point` instead of the origin."""
    t = np.eye(4)
    t[:3, 3] = point
    u = np.eye(4)
    u[:3, 3] = -np.asarray(point)
    return t @ m @ u


def frame_matrix(origin, x, y, z):
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, origin
    return m


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


# ---- the arms --------------------------------------------------------------------------------------------------------------------

FINGERS = ("thumb", "point", "middle", "ring", "pink")


class Arms:
    """The arms' skinned mesh with its skeleton, in the bind pose the file's inverse bind matrices give."""

    def __init__(self, path):
        self.g = build.Gltf(path)
        j = self.g.json
        prim = j["meshes"][0]["primitives"][0]
        a = prim["attributes"]
        self.pos = self.g.accessor(a["POSITION"]).astype(np.float64)
        self.nrm = self.g.accessor(a["NORMAL"]).astype(np.float64)
        self.uv = self.g.accessor(a["TEXCOORD_0"]).astype(np.float64)
        self.joints = self.g.accessor(a["JOINTS_0"]).astype(np.int64)
        self.weights = self.g.accessor(a["WEIGHTS_0"]).astype(np.float64)
        self.tri = self.g.accessor(prim["indices"]).reshape(-1, 3).astype(np.int64)
        skin = j["skins"][0]
        self.names = [j["nodes"][k]["name"] for k in skin["joints"]]
        self.ibm = self.g.accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.bind = np.linalg.inv(self.ibm)
        # The parent of each joint, and a tip joint's offset (the arms' file has no inverse bind for the four tips; they hold no weight).
        node_of = {k: i for i, k in enumerate(skin["joints"])}
        self.parent = [-1] * len(self.names)
        self.offset_len = [0.0] * len(self.names)
        for k, i in node_of.items():
            for c in j["nodes"][k].get("children", []):
                if c in node_of:
                    self.parent[node_of[c]] = i
                    self.offset_len[node_of[c]] = float(np.linalg.norm(j["nodes"][c].get("translation", [0, 0, 0])))
        self.material = j["materials"][prim["material"]]

    def joint(self, side, name):
        """The index of joint `name` of side "L" or "R" (`arm`, `elbow`, `wrist`, `palm`, `thumb1` ... `pink3`)."""
        for i, n in enumerate(self.names):
            if n.startswith("%s_%s_" % (side, name)):
                return i
        raise KeyError(name)

    def pos_of(self, i):
        return self.bind[i][:3, 3].copy()

    def tip_of(self, side, finger):
        """Where finger `finger`'s fourth joint is in the bind pose: its third joint's place one bone along."""
        k = self.joint(side, finger + "3")
        tip = self.joint(side, finger + "4")
        return self.pos_of(k) - self.bind[k][:3, 2] * self.offset_len[tip]

    def pose(self, turns):
        """The skinning matrices for a pose, and the joints' posed places. `turns` maps a joint index to a 3x3 turn in the bind pose's frame: the joint turns
        about its own (posed) place by it, after its parent's motion has carried it, and what hangs from it goes with it."""
        n = len(self.names)
        posed = [None] * n
        for i in range(n):
            p = self.parent[i]
            move = np.eye(4) if p < 0 or posed[p] is None else posed[p] @ self.ibm[p]
            m = move @ self.bind[i]
            if i in turns:
                t = np.eye(4)
                t[:3, :3] = turns[i]
                m = about(t, m[:3, 3]) @ m
            posed[i] = m
        self.posed = posed
        return [posed[i] @ self.ibm[i] for i in range(n)]

    def posed_place(self, i):
        return self.posed[i][:3, 3].copy()

    def posed_tip(self, side, finger):
        k = self.joint(side, finger + "3")
        tip = self.joint(side, finger + "4")
        return self.posed[k][:3, 3] - self.posed[k][:3, 2] * self.offset_len[tip]

    def skin(self, mats):
        """The vertices (and normals) of the mesh as the skinning matrices put them: linear blend skinning."""
        pos_h = np.concatenate([self.pos, np.ones((len(self.pos), 1))], axis=1)
        out = np.zeros_like(self.pos)
        nout = np.zeros_like(self.nrm)
        for k in range(4):
            w = self.weights[:, k]
            m = np.stack([mats[i] for i in self.joints[:, k]])
            out += w[:, None] * np.einsum("nij,nj->ni", m[:, :3, :], pos_h)
            nout += w[:, None] * np.einsum("nij,nj->ni", m[:, :3, :3], self.nrm)
        nout /= np.maximum(np.linalg.norm(nout, axis=1, keepdims=True), 1e-12)
        return out, nout


# ---- poses -------------------------------------------------------------------------------------------------------------------------
# Every angle in radians and every length in the arms' own unit (about a centimetre). Set by eye against the owner's reference.

GRIP = dict(
    barrel_radius=2.0,  # the torch's grip, in the arms' unit (its knurled barrel is 1.99 at 24 cm)
    finger_half=0.95,  # half a finger's thickness: a finger's middle line lies this far outside the barrel
    along=-2.0,  # where the barrel's axis lies from the knuckle line toward the wrist (negative is toward the wrist), and
    above=5.0,  # how far out of the hand's back-to-front middle (the knuckles' level) along the palm's normal: the palm's face is 3.5 to 4.8 out
    hold_z=-1.6,  # the torch's own z (the source's unit) that lies at the middle of the knuckles: how far down the barrel the fist is
    cock=1.25,  # the wrist's turn toward the little finger (ulnar deviation)
    roll=0.0,  # the turn of the whole hand and torch about the torch's axis, to the frame's +y (see right_hand)
    thumb_angle=0.35,  # where the thumb lies round the barrel: 0 is straight out from the palm over the top, positive toward the fingers
    thumb_reach=1.35,  # how far outside the barrel the thumb's middle line lies
)
# The torch is turned in the grip, about the point of its axis under the middle finger, so that its head end points further away into the scene than the hand's own
# knuckle line takes it. `yaw` turns the head toward the file's -x (as the loader stands the file, toward the view's right-hand side as seen along the torch: the head swings away
# from the forearm), `pitch` toward the back of the hand (+y); both in degrees, in the right file's frame (z along the barrel as it lay in the grip, y out of the back of the hand). The
# arm is as it was: only the torch moves, and the fingers are curled again, as little as needed, round the turned barrel. The lens and the axis it ends with are in `hands.json`.
# How far (radians) a finger's joints may be curled again from where they lay round the straight barrel, and what a radian of change costs against the distance to the turned barrel.
RECURL_WINDOW = 0.6
RECURL_COST = 0.2
THUMB_FOLLOW = 0.5
TORCH_IN_GRIP = dict(yaw=-30.0, pitch=10.0)
RELAXED = dict(
    curl=dict(point=(0.75, 0.95, 0.5), middle=(0.8, 1.0, 0.55), ring=(0.85, 1.0, 0.55), pink=(0.9, 1.05, 0.55)),
    thumb=(0.25, 0.2, 0.1),
    watch_at=21.0,  # the watch's middle along the forearm from the elbow (the unit), over the sleeve's narrow end
)
# The left sleeve comes toward the eye (the arm is held across the front of the body): past 6 cm along the forearm it is at the near plane, so it is cut there and capped at once.
FOREARM_CUT_LEFT = 6.0
SLEEVE_RUN_LEFT = (1.5, 3.0)
SLEEVE_RUN = (1.5, 3.0)  # the sleeve's end is carried on by rings this far (the arms' unit) along the forearm's own line, as one closed tube
FOREARM_CUT = 10.0  # the right sleeve is cut this far from the elbow's place along the forearm (the wrist is at 24): the forearm comes at the eye, and past about 7 cm behind the wrist it is at the near plane


def swing(u, v):
    """The 3x3 turn that takes the direction `u` to the direction `v` by the shortest way."""
    u, v = unit(u), unit(v)
    c = float(u @ v)
    if c > 1 - 1e-12:
        return np.eye(3)
    if c < -1 + 1e-12:
        w = unit(np.cross(u, [1, 0, 0] if abs(u[0]) < 0.9 else [0, 1, 0]))
        return rot(w, math.pi)[:3, :3]
    w = np.cross(u, v)
    return rot(w, math.acos(max(-1.0, min(1.0, c))))[:3, :3]


def hinge(axis, angle):
    return rot(axis, angle)[:3, :3]


def hand_frame(arms, side):
    """The hand's frame in the bind pose: the wrist, the knuckles' middle, f (toward the fingers), a (from the little finger to the index) and n (out of the palm)."""
    w = arms.pos_of(arms.joint(side, "wrist"))
    knuckles = [arms.pos_of(arms.joint(side, name + "1")) for name in ("point", "middle", "ring", "pink")]
    k = np.mean(knuckles, axis=0)
    f = unit(k - w)
    a = knuckles[0] - knuckles[3]
    a = unit(a - f * (a @ f))
    n = np.cross(f, a)
    # The palms face the midline in the bind pose (the right arm is at -x, the left at +x).
    toward = np.array([1.0 if side == "R" else -1.0, 0, 0])
    if n @ toward < 0:
        n = -n
    curl_sign = 1.0 if np.cross(a, f) @ n > 0 else -1.0
    return dict(wrist=w, knuckles=k, f=f, a=a, n=n, curl_sign=curl_sign)


def fit_finger(p1, p2, p3, tip, axis, sign, centre, radius, cyl=None, near=None, window=0.0):
    """The three curl angles that lay a finger's middle line round a barrel: its joints and the points along its bones are brought to `radius` from the
    barrel's axis (through `centre`, along `cyl`, which is `axis` where the barrel lies square to the fingers' hinge), a grid search over the angles with a light preference for less curl."""
    cyl = axis if cyl is None else cyl
    best = (1e18, (0, 0, 0))
    grids = (np.arange(0.1, 1.75, 0.05), np.arange(0.2, 2.0, 0.05), np.arange(0.0, 1.5, 0.05))
    if near is not None:
        # Curled again as little as needed: only angles within `window` of the ones that fit the straight barrel (`near`) are tried, and the change is paid for.
        grids = tuple(g[np.abs(g - n_) <= window] for g, n_ in zip(grids, near))
    b1, b2, b3 = p2 - p1, p3 - p2, tip - p3
    for t1 in grids[0]:
        r1 = hinge(axis, sign * t1)
        q2 = p1 + r1 @ b1
        for t2 in grids[1]:
            r2 = hinge(axis, sign * (t1 + t2))
            q3 = q2 + r2 @ b2
            for t3 in grids[2]:
                r3 = hinge(axis, sign * (t1 + t2 + t3))
                qt = q3 + r3 @ b3
                cost = 0.0
                for u, v in ((q2, q3), (q3, qt)):
                    for s in (0.0, 0.5, 1.0):
                        d = u + (v - u) * s - centre
                        d = d - cyl * (d @ cyl)
                        cost += (np.linalg.norm(d) - radius) ** 2
                cost += 0.002 * (t1 + t2 + t3)
                if near is not None:
                    cost += RECURL_COST * ((t1 - near[0]) ** 2 + (t2 - near[1]) ** 2 + (t3 - near[2]) ** 2)
                if cost < best[0]:
                    best = (cost, (float(t1), float(t2), float(t3)))
    return best[1]


def finger_chain(arms, side, name):
    return [arms.joint(side, name + str(k)) for k in (1, 2, 3)]


def aim_chain(arms, turns, side, name, targets):
    """Turns a finger's joints, one after the other, so that each bone points at its target (the next joint's wanted place) by the shortest way."""
    chain = finger_chain(arms, side, name)
    for k, j in enumerate(chain):
        arms.pose(turns)
        here = arms.posed_place(j)
        nxt = arms.posed_place(chain[k + 1]) if k < 2 else arms.posed_tip(side, name)
        turns[j] = swing(nxt - here, targets[k] - here)
    return turns


def right_pose(arms):
    """The right hand's pose gripping the torch: the turns, and what the torch needs: the barrel's axis (a), a point on it, and the frame."""
    fr = hand_frame(arms, "R")
    f, a, n, sign = fr["f"], fr["a"], fr["n"], fr["curl_sign"]
    g = GRIP
    turns = {}
    # The wrist turns toward the little finger: the knuckle line then lies across the forearm at less than a right angle.
    wrist = arms.joint("R", "wrist")
    for s in (1.0, -1.0):
        rw = hinge(n, s * g["cock"])
        if (rw @ f) @ a < 0:
            break
    turns[wrist] = rw
    arms.pose(turns)
    a_c, f_c, n_c = rw @ a, rw @ f, rw @ n
    k_c = np.mean([arms.posed_place(arms.joint("R", nm + "1")) for nm in ("point", "middle", "ring", "pink")], axis=0)
    centre = k_c + f_c * g["along"] + n_c * g["above"]
    radius = g["barrel_radius"] + g["finger_half"]
    # The torch turned in the grip: about the point of its axis under the middle finger (`TORCH_IN_GRIP`), in the file's frame (z = a_c, y = out of the back of the hand = -n_c, x = y cross z).
    y_c = -n_c
    x_c = np.cross(y_c, a_c)
    ty, tp = math.radians(TORCH_IN_GRIP["yaw"]), math.radians(TORCH_IN_GRIP["pitch"])
    a_t = unit(a_c * math.cos(tp) * math.cos(ty) + x_c * math.cos(tp) * math.sin(ty) + y_c * math.sin(tp))
    middle = arms.posed_place(arms.joint("R", "middle1"))
    pivot = centre + a_c * float((middle - centre) @ a_c)
    for nm in ("point", "middle", "ring", "pink"):
        j1, j2, j3 = finger_chain(arms, "R", nm)
        p1, p2, p3 = arms.posed_place(j1), arms.posed_place(j2), arms.posed_place(j3)
        tip = arms.posed_tip("R", nm)
        straight = fit_finger(p1, p2, p3, tip, a_c, sign, centre, radius)
        angles = fit_finger(p1, p2, p3, tip, a_c, sign, pivot, radius, a_t, straight, RECURL_WINDOW)
        for j, t in zip((j1, j2, j3), angles):
            turns[j] = hinge(a_c, sign * t)
    # The thumb lies along the barrel, its tip toward the head: three points on a line parallel to the axis at the thumb's angle round it.
    arms.pose(turns)
    t1, t2, t3 = finger_chain(arms, "R", "thumb")
    p1, p2, p3 = (arms.posed_place(j) for j in (t1, t2, t3))
    tip = arms.posed_tip("R", "thumb")
    ang = g["thumb_angle"]
    l1, l2, l3 = np.linalg.norm(p2 - p1), np.linalg.norm(p3 - p2), np.linalg.norm(tip - p3)

    def thumb_targets(axis, at):
        out = n_c * math.cos(ang) + f_c * math.sin(ang)
        out = unit(out - axis * (out @ axis))
        line0 = at + out * (g["barrel_radius"] + g["thumb_reach"])
        # p2 on the line at the distance l1 from p1 (the one farther toward the head).
        d = line0 - p1
        d_along = d @ axis
        disc = l1 ** 2 - (d @ d - d_along ** 2)
        s2 = -d_along + (math.sqrt(disc) if disc > 0 else 0.0)
        q2 = line0 + axis * s2
        return np.array([q2, q2 + axis * l2, q2 + axis * (l2 + l3)])

    # The thumb follows the turned barrel part of the way (`THUMB_FOLLOW`), so that it still lies along the top of it and has not moved far from where it was.
    targets = list(thumb_targets(a_c, centre) * (1 - THUMB_FOLLOW) + thumb_targets(a_t, pivot) * THUMB_FOLLOW)
    for j in (t1, t2, t3):
        turns.pop(j, None)
    arms.pose(turns)
    aim_chain(arms, turns, "R", "thumb", targets)
    return dict(turns=turns, axis=a_c, turned=a_t, pivot=pivot, centre=centre, f=f_c, n=n_c, wrist=wrist)


# ---- the torch and the watch (the source's own parts, in their own units) ---------------------------------------------------------

def read_parts(path):
    g = build.Gltf(path)
    return g, build.flatten(g)


def torch_native(g, parts):
    """The torch's parts as (body, glass): the body is the one big mesh, the glass the small ones at the lens end. Their long axis is z and the lens is at the high end."""
    body = max(parts, key=lambda p: len(p["pos"]))
    glass = [p for p in parts if p is not body]
    return body, glass


def merge(items):
    pos, nrm, uv, tri, base = [], [], [], [], 0
    for p in items:
        pos.append(p["pos"])
        nrm.append(p["nrm"])
        uv.append(p["uv"] if p["uv"] is not None else np.zeros((len(p["pos"]), 2)))
        tri.append(p["tri"] + base)
        base += len(p["pos"])
    return dict(pos=np.vstack(pos), nrm=np.vstack(nrm), uv=np.vstack(uv), tri=np.vstack(tri))


def used_only(pos, nrm, uv, tri, extra=()):
    """The mesh without the vertices no triangle uses, the triangles renumbered; `extra` arrays are cut alike."""
    used = np.zeros(len(pos), dtype=bool)
    used[tri.reshape(-1)] = True
    remap = np.cumsum(used) - 1
    out = [pos[used], nrm[used], uv[used] if uv is not None else None, remap[tri]]
    return out + [e[used] for e in extra]


def extend_sleeve(pos, nrm, uv, tri, near, direction, lengths, sides=32):
    """Carries the sleeve on past its cut, as one closed tube on the forearm's own line. The tube's section is the sleeve's own where it is cut: the points `near` the cut give,
    round their middle, how far the sleeve reaches at each angle about `direction` (the forearm's axis, away from the hand), smoothed and taken a little in so that the tube lies
    inside the sleeve's skin where they meet. Rings of it at each of `lengths` along the axis (the first begins 2 units inside the sleeve), the last capped; the texture coordinates are those
    of the sleeve's point nearest at each angle. No bend, no gap, nothing wider than the sleeve."""
    d = unit(direction)
    u = unit(np.cross(d, [0.3, 0.2, 0.9]))
    v = np.cross(d, u)
    idx = np.nonzero(near)[0]
    pts = pos[idx]
    rel0 = pts - pts.mean(axis=0)
    centre = pts.mean(axis=0)
    x, y = rel0 @ u, rel0 @ v
    centre = centre + u * (x.max() + x.min()) / 2 + v * (y.max() + y.min()) / 2
    x, y = (pts - centre) @ u, (pts - centre) @ v
    ang = np.arctan2(y, x)
    rad = np.hypot(x, y)
    theta = np.arange(sides) * 2 * math.pi / sides
    r = np.zeros(sides)
    tex = np.zeros((sides, 2))
    for k, t in enumerate(theta):
        diff = np.abs((ang - t + math.pi) % (2 * math.pi) - math.pi)
        close = diff < math.pi / sides * 1.5
        r[k] = rad[close].max() if close.any() else np.nan
        tex[k] = uv[idx[np.argmin(diff)]]
    ok = ~np.isnan(r)
    r = np.interp(np.arange(sides), np.arange(sides)[ok], r[ok], period=sides)
    r = np.convolve(np.concatenate([r[-2:], r, r[:2]]), np.ones(5) / 5, mode="valid") * 0.97
    ring_dir = np.stack([np.cos(theta), np.sin(theta)], axis=1)
    offsets = [-2.0] + list(lengths)
    pos_out, nrm_out, uv_out, tri_out = [pos], [nrm], [uv], [tri]
    base = len(pos)
    along0 = float(((pts - centre) @ d).min())
    for s_ in offsets:
        ring = centre + d * (along0 + 2.0 + s_) + (u[None, :] * ring_dir[:, :1] + v[None, :] * ring_dir[:, 1:2]) * r[:, None]
        pos_out.append(ring)
        nrm_out.append(u[None, :] * ring_dir[:, :1] + v[None, :] * ring_dir[:, 1:2])
        uv_out.append(tex)
    for k in range(len(offsets) - 1):
        lo, hi = base + k * sides, base + (k + 1) * sides
        for i in range(sides):
            j = (i + 1) % sides
            tri_out.append(np.array([[lo + i, lo + j, hi + i], [lo + j, hi + j, hi + i]]))
    last = base + (len(offsets) - 1) * sides
    cap = base + len(offsets) * sides
    pos_out.append((centre + d * (along0 + 2.0 + offsets[-1]))[None, :])
    nrm_out.append(d[None, :])
    uv_out.append(tex.mean(axis=0)[None, :])
    for i in range(sides):
        tri_out.append(np.array([[cap, last + i, last + (i + 1) % sides]]))
    return np.vstack(pos_out), np.vstack(nrm_out), np.vstack(uv_out), np.vstack(tri_out)


def ring_base(base, k, n):
    return base + k * n


def grip_report(arms, pos, dom, torch_pos, axis, pivot):
    """How the fingers sit on the turned barrel, in millimetres: for each finger (and the thumb), how far its nearest vertex is from the barrel's surface (the gap: a finger that floats
    off the barrel has a large one), and how far its deepest vertex is inside the barrel (the penetration: a finger through it). Both from the skinned vertices of the fingers and the
    torch's vertices, in the arms' unit (a centimetre), so a tenth of a millimetre is a hundredth of a unit."""
    out = {}
    rel_t = torch_pos - pivot
    t_axial = rel_t @ axis
    t_radial = np.linalg.norm(rel_t - np.outer(t_axial, axis), axis=1)
    order = np.argsort(t_axial)
    for name in ("thumb", "point", "middle", "ring", "pink"):
        ids = [i for i, n in enumerate(arms.names) if n.startswith("R_%s" % name)]
        v = pos[np.isin(dom, ids)]
        # only the vertices near the barrel: within 6 cm of the pivot
        v = v[np.linalg.norm(v - pivot, axis=1) < 7.0]
        if len(v) == 0:
            out[name] = dict(gap_mm=None, penetration_mm=None)
            continue
        gap = np.min(np.linalg.norm(v[:, None, :] - torch_pos[None, ::6, :], axis=2), axis=1).min()
        rel = v - pivot
        ax_ = rel @ axis
        rad = np.linalg.norm(rel - np.outer(ax_, axis), axis=1)
        # the barrel's radius at each vertex's place along it: the torch's own at the nearest axial position
        idx = np.clip(np.searchsorted(t_axial[order], ax_), 0, len(order) - 1)
        near = t_radial[order][np.clip(idx, 0, len(order) - 1)]
        # a window of torch vertices round that axial position gives the radius there (the largest, the knurl's crest)
        r_here = np.array([t_radial[np.abs(t_axial - z) < 0.15].max() if (np.abs(t_axial - z) < 0.15).any() else 0.0 for z in ax_])
        pen = float(np.max(r_here - rad)) if len(rad) else 0.0
        out[name] = dict(gap_mm=round(float(gap) * 10 - 0.0, 2), penetration_mm=round(max(pen, 0.0) * 10, 2))
    return out


def right_hand(arms, torch_path):
    """The right forearm and hand gripping the torch, as parts in the file's frame (metres), and what the game needs of it."""
    pose = right_pose(arms)
    mats = arms.pose(pose["turns"])
    pos, nrm = arms.skin(mats)
    dom = arms.joints[np.arange(len(arms.joints)), arms.weights.argmax(1)]
    right_ids = [i for i, n in enumerate(arms.names) if n.startswith("R_")]
    elbow = arms.pos_of(arms.joint("R", "elbow"))
    ax = unit(hand_frame(arms, "R")["knuckles"] - elbow)
    along = (arms.pos - elbow) @ ax
    on_right = np.isin(dom, right_ids) & (along >= FOREARM_CUT)
    tri = arms.tri[on_right[arms.tri].all(axis=1)]
    used = np.zeros(len(pos), dtype=bool)
    used[tri.reshape(-1)] = True
    along_used = along[used]
    p, nr, uv, tri = used_only(pos, nrm, arms.uv, tri, ())
    up_arm = -ax
    p, nr, uv, tri = extend_sleeve(p, nr, uv, tri, along_used < along_used.min() + 1.2, up_arm, SLEEVE_RUN)
    # The torch, laid in the grip: its z along the barrel's axis, the head toward the thumb.
    g, parts = read_parts(torch_path)
    body, glass = torch_native(g, parts)
    scale = TORCH_LENGTH * 100.0 / float(np.ptp(body["pos"][:, 2]))
    a_c, centre = pose["axis"], pose["centre"]
    u = pose["n"]
    v = np.cross(a_c, u)
    basis = np.stack([u, v, a_c], axis=1)
    lens_z = float(glass[0]["pos"][:, 2].mean())

    def lay(q, normals=False):
        if normals:
            return q @ basis.T
        loc = np.stack([q[:, 0] * scale, q[:, 1] * scale, (q[:, 2] - GRIP["hold_z"]) * scale], axis=1)
        return centre + loc @ basis.T

    t_pos = lay(body["pos"])
    t_nrm = lay(body["nrm"], True)
    lens_straight = centre + a_c * ((lens_z - GRIP["hold_z"]) * scale)
    lens_hand = lens_straight
    g_items = merge(glass)
    g_pos, g_nrm = lay(g_items["pos"]), lay(g_items["nrm"], True)
    # The torch turned in the grip about the point of its axis under the middle finger (`TORCH_IN_GRIP`): the file's frame stays where it was, with its origin at the lens as it lay straight.
    turn = swing(a_c, pose["turned"])
    pivot = pose["pivot"]
    t_pos = pivot + (t_pos - pivot) @ turn.T
    g_pos = pivot + (g_pos - pivot) @ turn.T
    t_nrm, g_nrm = t_nrm @ turn.T, g_nrm @ turn.T
    lens_turned = pivot + turn @ (lens_straight - pivot)
    report = grip_report(arms, pos, dom, t_pos, pose["turned"], pivot)
    # The file's frame: origin at the lens's middle, +z along the barrel toward the head, +y from the barrel's axis out through the back of the hand (the fist is
    # on the +y side of the torch, the forearm rising from behind it), +x completing the right handed frame.
    yf = unit(-pose["n"])
    xf = np.cross(yf, a_c)
    m3 = np.stack([xf, yf, a_c], axis=1)
    # The roll about the barrel at which the file is held: set so that, at the game's drawn axis and roll (`handPose.ts`), the forearm rises from the bottom of the view.
    c, sn = math.cos(GRIP["roll"]), math.sin(GRIP["roll"])
    m3 = m3 @ np.array([[c, -sn, 0], [sn, c, 0], [0, 0, 1]]).T

    def to_file(q):
        return (q - lens_straight) @ m3 * ARMS_UNIT

    def dir_file(q):
        return q @ m3

    arm = dict(name="arm", material="arm", pos=to_file(p), nrm=dir_file(nr), uv=uv, tri=tri)
    torch = dict(name="torch", material="torch", pos=to_file(t_pos), nrm=dir_file(t_nrm), uv=body["uv"], tri=body["tri"])
    glass_part = dict(name="torch_glass", material="torch_glass", pos=to_file(g_pos), nrm=dir_file(g_nrm), uv=g_items["uv"], tri=g_items["tri"])
    cut = (elbow + ax * FOREARM_CUT)
    info = dict(
        lens=[round(float(x), 5) for x in to_file(lens_turned[None, :])[0]],
        axis=[round(float(x), 5) for x in dir_file(pose["turned"][None, :])[0]],
        torch_in_grip=dict(TORCH_IN_GRIP),
        grip=report,
        torch_length=round(TORCH_LENGTH, 4),
        torch_radius=round(float(GRIP["barrel_radius"] * ARMS_UNIT), 4),
        forearm_cut=dict(centre=[round(float(x), 4) for x in to_file(cut[None, :])[0]], direction=[round(float(x), 4) for x in dir_file(unit(up_arm)[None, :])[0]], runs_on=SLEEVE_RUN[-1] * ARMS_UNIT, wrist=[round(float(x), 4) for x in to_file(arms.posed_place(pose["wrist"])[None, :])[0]], toward_elbow=[round(float(x), 4) for x in dir_file(unit(elbow - arms.posed_place(pose["wrist"]))[None, :])[0]]),
        palm=dict(eye=[round(float(x), 4) for x in (dir_file(pose["n"][None, :])[0] * 0.5 + to_file(centre[None, :])[0])], target=[round(float(x), 4) for x in to_file(centre[None, :])[0]], up=[round(float(x), 4) for x in dir_file(pose["f"][None, :])[0]]),
    )
    return [arm, torch, glass_part], info


# ---- the left arm and the watch ------------------------------------------------------------------------------------------------------

STRAP = dict(
    width=0.022,  # across the band, along the forearm
    thick=0.0035,
    gap=0.0006,  # between the sleeve and the band's inner face
    lug_below=0.004,  # where the band leaves the case: this far above the case's back
    colour=(0.42, 0.22, 0.10, 1.0),  # linear, brown leather
    roughness=0.55,
    tile=0.012,  # a repeat of the grain, metres
)


def ring_profile(points, centre, bins=96):
    """The radius of a cross-section round `centre`, by angle (from +z toward +y, in the y-z plane): the farthest point in each bin, smoothed. Returns a function of the angle."""
    d = points - centre
    ang = np.arctan2(d[:, 0], d[:, 1])
    rad = np.hypot(d[:, 0], d[:, 1])
    k = np.floor((ang + math.pi) / (2 * math.pi) * bins).astype(int) % bins
    r = np.zeros(bins)
    for i in range(bins):
        m = k == i
        r[i] = rad[m].max() if m.any() else np.nan
    idx = np.arange(bins)
    good = ~np.isnan(r)
    r = np.interp(idx, idx[good], r[good], period=bins)
    wide = np.maximum.reduce([np.roll(r, s) for s in range(-3, 4)])
    kernel = np.ones(7) / 7
    smooth = np.convolve(np.concatenate([wide[-3:], wide, wide[:3]]), kernel, mode="valid")
    cent = (np.arange(bins) + 0.5) / bins * 2 * math.pi - math.pi

    def f(theta):
        t = (np.asarray(theta) + math.pi) % (2 * math.pi) - math.pi
        return np.interp(t, np.concatenate([[cent[-1] - 2 * math.pi], cent, [cent[0] + 2 * math.pi]]), np.concatenate([[smooth[-1]], smooth, [smooth[0]]]))

    return f


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def strap_band(profile, centre, z_lug, y_lug, side, end, lift_from, width, thick, gap, steps=48):
    """One band as its path in the y-z plane, from the case's lug round the sleeve to `end` (an angle past the underside). Returns the rows: (y, z) of the inner face
    and the outward unit normal of each."""
    start_theta = side * 0.0
    # The first angle at which the ring is out beyond the case's edge: the band joins the ring there.
    th = np.linspace(0, side * math.pi, 400)
    ring_y = centre[0] + (profile(th) + gap) * np.sin(th)
    ok = np.nonzero(np.abs(ring_y - 0.0) > abs(y_lug) + 0.006)[0]
    t1 = th[ok[0]] if len(ok) else side * 0.9
    ring_t = np.linspace(t1, end, steps)
    lift = thick * smoothstep((np.abs(ring_t) - lift_from) / 0.5) if lift_from is not None else np.zeros(steps)
    rad = profile(ring_t) + gap + lift
    py = centre[0] + rad * np.sin(ring_t)
    pz = centre[1] + rad * np.cos(ring_t)
    # leaves the case outward and a little down, and joins the ring along its tangent
    p0 = np.array([side * y_lug, z_lug])
    p1 = np.array([py[0], pz[0]])
    tan_ring = np.array([np.cos(t1), -np.sin(t1)]) * side
    tan0 = np.array([side * 1.0, -0.35])
    scale = np.linalg.norm(p1 - p0) * 1.1
    s = np.linspace(0, 1, 14, endpoint=False)[:, None]
    h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
    curve = h00 * p0 + h10 * tan0 * scale + h01 * p1 + h11 * tan_ring * scale
    path = np.vstack([curve, np.stack([py, pz], axis=1)])
    tang = np.gradient(path, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-12)
    nrm = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
    out_dir = np.stack([path[-1, 0] - centre[0], path[-1, 1] - centre[1]])
    if nrm[-1] @ out_dir < 0:
        nrm = -nrm
    return path, nrm


def sweep(path, nrm, width, thick, tile):
    """A band's four faces from its path: parts (pos, nrm, uv, tri) in the file's frame (x across the band, y and z in the plane)."""
    n = len(path)
    seg = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    hw = width / 2
    out = []

    def strip(rows_l, rows_r, normals, flip):
        pos = np.concatenate([rows_l, rows_r])
        nr = np.concatenate([normals, normals])
        uv = np.concatenate([np.stack([seg / tile, np.full(n, -hw / tile)], axis=1), np.stack([seg / tile, np.full(n, hw / tile)], axis=1)])
        tri = []
        for i in range(n - 1):
            a, b, c, d = i, i + 1, n + i, n + i + 1
            tri += [[a, b, c], [b, d, c]] if not flip else [[a, c, b], [b, c, d]]
        return dict(pos=pos, nrm=nr, uv=uv, tri=np.array(tri))

    def pts(offset, x):
        q = path + nrm * offset
        return np.stack([np.full(n, x), q[:, 0], q[:, 1]], axis=1)

    n3 = np.concatenate([np.zeros((n, 1)), nrm], axis=1)
    out.append(strip(pts(thick, -hw), pts(thick, hw), n3, False))
    out.append(strip(pts(0, -hw), pts(0, hw), -n3, True))
    side_n = np.zeros((n, 3))
    side_n[:, 0] = -1
    out.append(strip(pts(0, -hw), pts(thick, -hw), side_n, True))
    side_n = -side_n
    out.append(strip(pts(0, hw), pts(thick, hw), side_n, False))
    return out


def box(centre, axes, half):
    """A box with faces of their own: `axes` the three unit directions as rows, `half` the half sizes along them."""
    pos, nrm, tri = [], [], []
    for k in range(3):
        for sgn in (1, -1):
            u, v = axes[(k + 1) % 3], axes[(k + 2) % 3]
            c = centre + axes[k] * half[k] * sgn
            base = len(pos)
            for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                pos.append(c + u * half[(k + 1) % 3] * du + v * half[(k + 2) % 3] * dv)
                nrm.append(axes[k] * sgn)
            tri += [[base, base + 1, base + 2], [base, base + 2, base + 3]] if sgn > 0 else [[base, base + 2, base + 1], [base, base + 3, base + 2]]
    return dict(pos=np.array(pos), nrm=np.array(nrm), uv=np.zeros((len(pos), 2)), tri=np.array(tri))


def concat_meshes(items):
    m = merge(items)
    return m


def left_hand(arms, watch_path):
    fr = hand_frame(arms, "L")
    a, n, f, sign = fr["a"], fr["n"], fr["f"], fr["curl_sign"]
    turns = {}
    # A loose half fist: the fingers are brought together (their bind spread taken out, by turns about the palm's normal) and bent at all three joints, more toward
    # the little finger.
    def heading(nm):
        j1, j2 = arms.joint("L", nm + "1"), arms.joint("L", nm + "2")
        d = arms.pos_of(j2) - arms.pos_of(j1)
        return math.atan2(d @ a, d @ f)

    mid = heading("middle")
    for nm in ("point", "middle", "ring", "pink"):
        delta = mid - heading(nm)
        best = min((hinge(n, sg * delta), sg) for sg in (1.0, -1.0) for _ in [0])[1] if False else None
        for sg in (1.0, -1.0):
            r = hinge(n, sg * delta)
            j1, j2 = arms.joint("L", nm + "1"), arms.joint("L", nm + "2")
            d = r @ (arms.pos_of(j2) - arms.pos_of(j1))
            if abs(math.atan2(d @ a, d @ f) - mid) < 1e-6:
                best = sg
        spread = hinge(n, (best or 1.0) * delta)
        axis = spread @ a
        for k, (j, t) in enumerate(zip(finger_chain(arms, "L", nm), RELAXED["curl"][nm])):
            turns[j] = hinge(axis, sign * t) @ (spread if k == 0 else np.eye(3))
    # The thumb rests against the side of the index finger: its bones turned to lie along the index's first two, a finger's thickness to the thumb's side.
    arms.pose(turns)
    ix = [arms.posed_place(j) for j in finger_chain(arms, "L", "point")]
    side = a * 2.2
    t1 = finger_chain(arms, "L", "thumb")
    tip = arms.posed_tip("L", "point")
    targets = [ix[1] + side, ix[2] + side, tip + side]
    aim_chain(arms, turns, "L", "thumb", targets)
    pos, nrm = arms.skin(arms.pose(turns))
    dom = arms.joints[np.arange(len(arms.joints)), arms.weights.argmax(1)]
    ids = [i for i, n in enumerate(arms.names) if n.startswith("L_")]
    elbow = arms.pos_of(arms.joint("L", "elbow"))
    ax = unit(fr["knuckles"] - elbow)
    along = (arms.pos - elbow) @ ax
    keep = np.isin(dom, ids) & (along >= FOREARM_CUT_LEFT)
    tri = arms.tri[keep[arms.tri].all(axis=1)]
    used = np.zeros(len(pos), dtype=bool)
    used[tri.reshape(-1)] = True
    along_used = along[used]
    p, nr, uv, tri = used_only(pos, nrm, arms.uv, tri, ())
    up_arm = -ax
    p, nr, uv, tri = extend_sleeve(p, nr, uv, tri, along_used < along_used.min() + 1.2, up_arm, SLEEVE_RUN_LEFT)
    # The frame: +x along the forearm toward the fingers, +z out of the back of the hand (toward the reader), +y toward twelve.
    xf = ax
    zf = unit(-fr["n"] - xf * (-fr["n"] @ xf))
    yf = np.cross(zf, xf)
    m3 = np.stack([xf, yf, zf], axis=1)
    q = (p - elbow) @ m3 * ARMS_UNIT
    qn = nr @ m3
    thumb_side = float(unit(fr["a"]) @ yf)
    # The watch's parts in the source's own frame, then in ours.
    g, parts = read_parts(watch_path)
    by = {p_["name"].split("_")[0]: p_ for p_ in parts}
    shell = [p_ for p_ in parts if p_["name"].startswith("watchShell")]
    bottom = [p_ for p_ in parts if p_["name"].startswith("watchBottom")][0]
    glass = [p_ for p_ in parts if p_["name"].startswith("watchGlass")][0]
    top = [p_ for p_ in parts if p_["name"].startswith("WatchshellTop")][0]
    crown = min(shell, key=lambda p_: len(p_["pos"]))
    case_body = max(shell, key=lambda p_: len(p_["pos"]))
    straps = [p_ for p_ in parts if p_["name"].startswith("FinalStrap")]
    centre_n = top["pos"].mean(axis=0)
    # The face's normal is the screen's own plane's (a best fit by the least squares through its points), turned to the glass's side.
    sp = top["pos"] - top["pos"].mean(axis=0)
    zn = np.linalg.svd(sp, full_matrices=False)[2][-1]
    if zn @ (glass["pos"].mean(axis=0) - bottom["pos"].mean(axis=0)) < 0:
        zn = -zn
    cn = crown["pos"].mean(axis=0) - case_body["pos"].mean(axis=0)
    xn = unit(cn - zn * (cn @ zn))
    yn = np.cross(zn, xn)
    diam = float(np.ptp((case_body["pos"] - centre_n) @ xn))
    # The watch's size: from the width of the arm where it sits.
    x0 = RELAXED["watch_at"] * ARMS_UNIT
    wrist_w = float(np.ptp(q[np.abs(q[:, 0] - x0) < 0.013, 1]))
    big = WATCH_FIT * wrist_w / WATCH_CASE
    assert WATCH_FIT_RANGE[0] <= WATCH_CASE * big / wrist_w <= WATCH_FIT_RANGE[1]
    scale = WATCH_CASE * big / diam
    wm = np.stack([xn, yn, zn], axis=1)

    def w_pos(v):
        return (v - centre_n) @ wm * scale

    def w_dir(v):
        return v @ wm

    back_z = float(w_pos(bottom["pos"])[:, 2].min())
    # Where the watch sits on the sleeve: x = 0 is `watch_at` from the elbow; the slab round it gives the sleeve's cross-section.
    sw, st = STRAP["width"] * big, STRAP["thick"] * big
    slab = np.abs(q[:, 0] - x0) < sw / 2 + 0.002
    ys, zs = q[slab, 1], q[slab, 2]
    centre_yz = np.array([(ys.max() + ys.min()) / 2, (zs.max() + zs.min()) / 2])
    prof = ring_profile(np.stack([ys, zs], axis=1), centre_yz)
    # The case rests a little above the sleeve's top at its middle, toward the highest of the sleeve under its footprint (the cuff flares toward the hand).
    foot = (np.abs(q[:, 0] - x0) < WATCH_CASE * big / 2) & (np.abs(q[:, 1] - centre_yz[0]) < WATCH_CASE * big / 2) & (q[:, 2] > centre_yz[1])
    top_ring = float(centre_yz[1] + prof(0.0))
    top_z = top_ring + 0.4 * (float(q[foot, 2].max()) - top_ring)
    shift = np.array([-x0, -centre_yz[0], back_z - STRAP["gap"] - top_z])
    q = q + shift
    centre_yz = centre_yz + shift[1:]
    arm = dict(name="arm", material="arm", pos=q, nrm=qn, uv=uv, tri=tri)
    case = merge([dict(pos=w_pos(case_body["pos"]), nrm=w_dir(case_body["nrm"]), uv=case_body["uv"], tri=case_body["tri"]), dict(pos=w_pos(crown["pos"]), nrm=w_dir(crown["nrm"]), uv=crown["uv"], tri=crown["tri"])])
    case.update(name="watch_case", material="watch_case")
    back = dict(name="watch_back", material="watch_back", pos=w_pos(bottom["pos"]), nrm=w_dir(bottom["nrm"]), uv=bottom["uv"], tri=bottom["tri"])
    glass_p = dict(name="watch_glass", material="watch_glass", pos=w_pos(glass["pos"]), nrm=w_dir(glass["nrm"]), uv=glass["uv"], tri=glass["tri"])
    screen = dict(name="watch_screen", material="watch_screen", pos=w_pos(top["pos"]), nrm=w_dir(top["nrm"]), uv=top["uv"], tri=top["tri"])
    # A face's normals might point in or out: the screen's face to the reader.
    if screen["nrm"][:, 2].mean() < 0:
        screen["nrm"] = -screen["nrm"]
        screen["tri"] = screen["tri"][:, [0, 2, 1]]
    plate = float(np.max(np.hypot(screen["pos"][:, 0], screen["pos"][:, 1])))
    radius = LIT_SHARE * WATCH_CASE * big / 2
    # The strap: two bands from the case's lugs round the sleeve, one over the other underneath, with a keeper.
    y_lug = float(np.ptp(case["pos"][:, 1]) / 2) - 0.0025
    z_lug = back_z + STRAP["lug_below"] * big
    pieces = []
    paths = []
    for side, end, lift in ((1, math.pi + 0.45, None), (-1, -math.pi - 0.45, math.pi - 0.7)):
        path, nm_ = strap_band(prof, centre_yz, z_lug, y_lug, side, end, lift, sw, st, STRAP["gap"])
        paths.append((path, nm_))
        pieces += sweep(path, nm_, sw, st, STRAP["tile"])
    path, nm_ = paths[0]
    k = int(len(path) * 0.82)
    tang = unit(np.array([0.0, *(path[k + 1] - path[k - 1])]))
    out_n = np.array([0.0, *nm_[k]])
    ctr = np.array([0.0, *path[k]]) + out_n * st * 1.1
    pieces.append(box(ctr, np.array([[1.0, 0, 0], out_n, tang]), [sw / 2 + 0.002, st * 1.25, 0.003 * big]))
    strap = merge(pieces)
    # Every triangle wound to face the way its vertices' normals do (a shader that lights a double sided surface by which way it faces turns the normal of a face wound the other way).
    t = strap["tri"]
    face = np.cross(strap["pos"][t[:, 1]] - strap["pos"][t[:, 0]], strap["pos"][t[:, 2]] - strap["pos"][t[:, 0]])
    wrong = (face * strap["nrm"][t].mean(axis=1)).sum(axis=1) < 0
    t[wrong] = t[wrong][:, [0, 2, 1]]
    strap.update(name="strap", material="strap")
    r_screen = radius
    info = dict(
        screen_diameter=round(2 * r_screen, 5),
        screen_plate_diameter=round(2 * plate, 5),
        screen_corners=[[-r_screen, r_screen, 0.0], [r_screen, r_screen, 0.0], [r_screen, -r_screen, 0.0], [-r_screen, -r_screen, 0.0]],
        case_diameter=round(WATCH_CASE * big, 4),
        case_diameter_life=round(WATCH_CASE, 4),
        watch_big=round(big, 4),
        wrist_width=round(wrist_w, 4),
        forearm_cut=dict(centre=[round(float(x), 4) for x in (np.array([FOREARM_CUT_LEFT * ARMS_UNIT, 0.0, 0.0]) + shift)], direction=[round(float(x), 4) for x in (unit(up_arm) @ m3)], runs_on=SLEEVE_RUN_LEFT[-1] * ARMS_UNIT, wrist=[round(float(x), 4) for x in ((arms.pos_of(arms.joint("L", "wrist")) - elbow) @ m3 * ARMS_UNIT + shift)], toward_elbow=[round(float(x), 4) for x in (unit(elbow - arms.pos_of(arms.joint("L", "wrist"))) @ m3)]),
        thumb_side=round(thumb_side, 3),
        palm=dict(eye=[0.11, 0.0, -0.45], target=[0.11, 0.0, -0.04], up=[0.0, 1.0, 0.0]),
        watch_scale=scale,
    )
    return [arm, case, back, glass_p, screen, strap], info


# ---- writing a file ------------------------------------------------------------------------------------------------------------------

def gpu_bytes(size, mips=True):
    """What an image costs on the GPU once transcoded to a block format: a byte a texel, and with its mip chain a third more."""
    w, h = size
    total = 0
    while True:
        total += w * h
        if not mips or (w == 1 and h == 1):
            break
        w, h = max(1, w // 2), max(1, h // 2)
    return total


class Images:
    """The images of one file: WebP bytes, once each, with the sizes the manifest reports."""

    def __init__(self):
        self.items = []

    def add(self, name, data, size, label):
        self.items.append(dict(name=name, data=data, size=size, label=label))
        return len(self.items) - 1


def encode(im, kind):
    """The KTX2 file (Basis Universal, every mip level stored, no metadata) of a picture, made by the encoder outside this repository (`ENCODER`): the engine reads it
    through `KHR_texture_basisu` and transcodes it to the GPU's block format at a byte a texel, a quarter of what the same picture as WebP costs once decoded. `kind`
    is `colour` (sRGB), `data` (linear) or `normal` (linear, kept in the higher quality encoding). The same picture gives the same bytes, which is what lets two
    files share one GPU texture."""
    if not os.path.exists(ENCODER):
        sys.exit("the texture encoder is not at %s: give it with --encoder or MODEL_TEXTURE_ENCODER" % ENCODER)
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in.png"), os.path.join(d, "out.ktx2")
        im.save(src)
        subprocess.run([sys.executable, "-I", ENCODER, src, dst, kind], check=True, capture_output=True)
        return open(dst, "rb").read()


def source_pictures(g, material, prefix):
    """The base colour, occlusion-roughness-metal and normal pictures of a source material, each reduced to its size, as (name, picture, kind)."""
    tex = build.material_textures(g, material)
    base = build.fit(g.image(tex["base"]).convert("RGB"), COLOUR_SIZE)
    mr = build.fit(g.image(tex["mr"]).convert("RGB"), DATA_SIZE)
    a = np.asarray(mr).copy()
    if tex["occ"] is None:
        a[..., 0] = 255
    elif tex["occ"] != tex["mr"]:
        a[..., 0] = np.asarray(g.image(tex["occ"]).convert("RGB").resize(mr.size, Image.LANCZOS))[..., 0]
    normal = build.fit(g.image(tex["normal"]).convert("RGB"), DATA_SIZE)
    return dict(
        base=("%s.colour" % prefix, base, "colour"),
        orm=("%s.orm" % prefix, Image.fromarray(a), "data"),
        normal=("%s.normal" % prefix, normal, "normal"),
    )


def add_pictures(images, pictures, cache):
    """Adds each picture's KTX2 file to `images` (made once per name: `cache` holds it, so that two files carry the same bytes); returns the indices by role."""
    out = {}
    for role, (name, im, kind) in pictures.items():
        if name not in cache:
            cache[name] = (encode(im, kind), im.size)
        data, size = cache[name]
        out[role] = images.add(name, data, size, role if role != "base" else "colour")
    return out


def leather_tile(g, arms, images, prefix, cache):
    """A small tileable normal map for the strap's grain, cut from the arms' own normal map where the glove's leather is (the back of the hand), mirrored
    into a tile that repeats without a seam. No new texture is brought in: it is the arms' texture, a piece of it."""
    tex = build.material_textures(g, arms.material)
    im = g.image(tex["normal"]).convert("RGB")
    dom = arms.joints[np.arange(len(arms.joints)), arms.weights.argmax(1)]
    ids = [arms.joint("R", "wrist")]
    uv = arms.uv[np.isin(dom, ids)]
    c = np.median(uv, axis=0)
    w = im.size[0]
    half = int(w * 0.04)
    cx, cy = int(c[0] * w), int(c[1] * w)
    crop = im.crop((cx - half, cy - half, cx + half, cy + half))
    a = np.asarray(crop)
    top = np.concatenate([a, a[:, ::-1]], axis=1)
    tile = np.concatenate([top, top[::-1]], axis=0)
    out = Image.fromarray(tile).resize((128, 128), Image.LANCZOS)
    name = "%s.leather.normal" % prefix
    if name not in cache:
        cache[name] = (encode(out, "normal"), (128, 128))
    return images.add(name, cache[name][0], (128, 128), "normal")


NORMAL_STEP = build.NORMAL_STEP


def write_glb(root_name, parts, materials, images):
    """The binary glTF of `parts` (each name, material, pos, nrm, uv, tri) with `materials` (name -> spec) and `images`. Returns its bytes and the manifest's counts."""
    w = build.Writer()
    doc_images, textures, mats, meshes, nodes = [], [], [], [], []
    image_of = {}
    for idx, im in enumerate(images.items):
        doc_images.append(dict(name=im["name"], mimeType="image/ktx2", bufferView=w.view(im["data"])))
        textures.append(dict(sampler=0, extensions=dict(KHR_texture_basisu=dict(source=idx))))
        image_of[idx] = idx
    mat_index = {}
    for name, spec in materials.items():
        m = dict(name=name, doubleSided=bool(spec.get("double", False)))
        pbr = dict(baseColorFactor=list(spec["factor"]), metallicFactor=spec["metallic"], roughnessFactor=spec["roughness"])
        if spec.get("base") is not None:
            pbr["baseColorTexture"] = dict(index=spec["base"])
        if spec.get("orm") is not None:
            pbr["metallicRoughnessTexture"] = dict(index=spec["orm"])
            m["occlusionTexture"] = dict(index=spec["orm"])
        if spec.get("normal") is not None:
            m["normalTexture"] = dict(index=spec["normal"], scale=spec.get("normal_scale", 1.0))
        if spec.get("blend"):
            m["alphaMode"] = "BLEND"
        m["pbrMetallicRoughness"] = pbr
        mat_index[name] = len(mats)
        mats.append(m)
    counts = {}
    for part in parts:
        spec = materials[part["material"]]
        pos = part["pos"].astype("<f4")
        nrm = part["nrm"].astype("<f4")
        tri = part["tri"].astype(np.int64).copy()
        # Every triangle wound to face the way its vertices' normals do: a shader that lights a double sided surface by which way it faces would turn the normal of a face wound the other way.
        face = np.cross(pos[tri[:, 1]].astype(np.float64) - pos[tri[:, 0]], pos[tri[:, 2]].astype(np.float64) - pos[tri[:, 0]])
        wrong = (face * nrm[tri].astype(np.float64).mean(axis=1)).sum(axis=1) < 0
        tri[wrong] = tri[wrong][:, [0, 2, 1]]
        attrs = dict(POSITION=w.accessor(pos, 5126, "VEC3", 34962, bounds=True), NORMAL=w.accessor(nrm, 5126, "VEC3", 34962))
        textured = spec.get("base") is not None or spec.get("normal") is not None
        if textured:
            uv = part["uv"].astype("<f4")
            attrs["TEXCOORD_0"] = w.accessor(uv, 5126, "VEC2", 34962)
            if spec.get("normal") is not None:
                attrs["TANGENT"] = w.accessor(build.tangents(pos.astype(np.float64), nrm.astype(np.float64), uv.astype(np.float64), tri).astype("<f4"), 5126, "VEC4", 34962)
        index = tri.reshape(-1).astype("<u2" if len(pos) < 65536 else "<u4")
        prim = dict(attributes=attrs, indices=w.accessor(index, 5125 if index.dtype == np.dtype("<u4") else 5123, "SCALAR", 34963), material=mat_index[part["material"]], mode=4)
        meshes.append(dict(name=part["name"], primitives=[prim]))
        nodes.append(dict(name=part["name"], mesh=len(meshes) - 1))
        counts[part["name"]] = dict(triangles=int(len(tri)), vertices=int(len(pos)))
    root = len(nodes)
    nodes.append(dict(name=root_name, children=list(range(root))))
    doc = {
        "asset": dict(version="2.0", generator="game-portashton tools/models/buildHands.py"),
        "scene": 0,
        "scenes": [dict(nodes=[root])],
        "nodes": nodes,
        "meshes": meshes,
        "materials": mats,
        "samplers": [dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
        "buffers": [dict(byteLength=len(build.pad4(w.blob)))],
        "bufferViews": w.views,
        "accessors": w.accessors,
    }
    if doc_images:
        doc["extensionsUsed"] = ["KHR_texture_basisu"]
        doc["extensionsRequired"] = ["KHR_texture_basisu"]
        doc["images"] = doc_images
        doc["textures"] = textures
    js = build.pad4(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    bn = build.pad4(w.blob)
    data = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn)) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bn), 0x004E4942) + bn
    return data, counts


def r5(v):
    if isinstance(v, (list, tuple)):
        return [r5(x) for x in v]
    return round(float(v), 5)


def image_report(images):
    out = []
    for im in images.items:
        out.append(dict(name=im["name"], map=im["label"], size=list(im["size"]), bytes=len(im["data"]), sha256=hashlib.sha256(im["data"]).hexdigest()[:16], gpu_bytes=gpu_bytes(im["size"], False), gpu_bytes_with_mips=gpu_bytes(im["size"], True)))
    return out


def entry_of(file, parts, counts, images, data, credits, frame, extra):
    imgs = image_report(images)
    return dict(
        id=file[:-4],
        file=file,
        credits=credits,
        frame=frame,
        bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        triangles=sum(c["triangles"] for c in counts.values()),
        vertices=sum(c["vertices"] for c in counts.values()),
        parts=counts,
        textures=imgs,
        gpu_bytes=sum(i["gpu_bytes"] for i in imgs),
        gpu_bytes_with_mips=sum(i["gpu_bytes_with_mips"] for i in imgs),
        **extra,
    )


def build_all(sources):
    arms_path = find_source(sources, SOURCES["arms"])
    torch_path = find_source(sources, SOURCES["torch"])
    watch_path = find_source(sources, SOURCES["watch"])
    files, entries = {}, {}
    # the right hand
    arms = Arms(arms_path)
    parts, info = right_hand(arms, torch_path)
    images = Images()
    cache = {}
    arm_img = add_pictures(images, source_pictures(arms.g, arms.material, "hand.arms"), cache)
    tg = build.Gltf(torch_path)
    torch_mat = tg.json["materials"][1]
    torch_img = add_pictures(images, source_pictures(tg, torch_mat, "hand.torch"), cache)
    tpbr = torch_mat["pbrMetallicRoughness"]
    arm_pbr = arms.material["pbrMetallicRoughness"]
    materials = {
        "arm": dict(factor=[1, 1, 1, 1], metallic=float(arm_pbr.get("metallicFactor", 0.0)), roughness=float(arm_pbr.get("roughnessFactor", 1.0)), **arm_img),
        "torch": dict(factor=[1, 1, 1, 1], metallic=float(tpbr.get("metallicFactor", 1.0)), roughness=float(tpbr.get("roughnessFactor", 1.0)), **torch_img),
        "torch_glass": dict(factor=[0.9, 0.95, 1.0, 0.2], metallic=0.0, roughness=0.05, blend=True, double=True),
    }
    data, counts = write_glb("hand.right", parts, materials, images)
    files["hand.right.glb"] = data
    entries["hand.right.glb"] = entry_of(
        "hand.right.glb", parts, counts, images, data, ["hand.arms", "hand.torch"], RIGHT_FRAME,
        dict(lens=info["lens"], axis=info["axis"], torch_in_grip=info["torch_in_grip"], grip=info["grip"], torch_length=info["torch_length"], torch_radius=info["torch_radius"], forearm_cut=info["forearm_cut"], preview=dict(palm=info["palm"])),
    )
    # the left hand
    arms = Arms(arms_path)
    parts, info = left_hand(arms, watch_path)
    images = Images()
    arm_img = add_pictures(images, source_pictures(arms.g, arms.material, "hand.arms"), cache)
    leather = leather_tile(arms.g, arms, images, "hand.arms", cache)
    materials = {
        "arm": dict(factor=[1, 1, 1, 1], metallic=float(arm_pbr.get("metallicFactor", 0.0)), roughness=float(arm_pbr.get("roughnessFactor", 1.0)), **arm_img),
        "watch_case": dict(factor=[0.02, 0.02, 0.022, 1.0], metallic=0.6, roughness=0.35),
        "watch_back": dict(factor=[0.08, 0.08, 0.08, 1.0], metallic=0.09, roughness=0.5),
        "watch_glass": dict(factor=[0.05, 0.05, 0.06, 0.12], metallic=0.0, roughness=0.05, blend=True, double=True),
        "watch_screen": dict(factor=[0.004, 0.004, 0.005, 1.0], metallic=0.0, roughness=0.15, double=True),
        "strap": dict(factor=list(STRAP["colour"]), metallic=0.0, roughness=STRAP["roughness"], normal=leather, normal_scale=0.5, double=True),
    }
    data, counts = write_glb("hand.left", parts, materials, images)
    files["hand.left.glb"] = data
    entries["hand.left.glb"] = entry_of(
        "hand.left.glb", parts, counts, images, data, ["hand.arms", "hand.watch"], LEFT_FRAME,
        dict(
            watch=dict(screen_diameter=info["screen_diameter"], screen_plate_diameter=info["screen_plate_diameter"], screen_corners=r5(info["screen_corners"]), screen_corner_order="top left, top right, bottom right, bottom left, as the wearer reads the face", case_diameter=info["case_diameter"], case_diameter_life=info["case_diameter_life"], watch_big=info["watch_big"], wrist_width=info["wrist_width"]),
            forearm_cut=info["forearm_cut"],
            preview=dict(palm=info["palm"]),
        ),
    )
    return manifest_of(entries), files


def manifest_of(entries):
    return dict(
        about="Written by tools/models/buildHands.py: do not edit. The first person arms: metres, right handed glTF (the game's loader mirrors x on a model's root). Where each work came from is in CREDITS.md, under the ids named here.",
        total_bytes=sum(e["bytes"] for e in entries.values()),
        total_gpu_bytes=sum(e["gpu_bytes"] for e in entries.values()),
        # With both files loaded the arms' three maps (the same bytes in each) are one GPU texture each: every distinct image counted once.
        total_gpu_bytes_shared=sum({t["sha256"]: t["gpu_bytes_with_mips"] for e in entries.values() for t in e["textures"]}.values()),
        files=entries,
    )


def check(out, sources):
    path = os.path.join(out, MANIFEST)
    if not os.path.exists(path):
        print("manifest is missing")
        return 1
    on_disk = json.load(open(path))
    bad = []
    if sorted(on_disk["files"]) != ["hand.left.glb", "hand.right.glb"]:
        bad.append("the manifest's files are not the two hands")
    for name, e in on_disk["files"].items():
        f = os.path.join(out, name)
        if not os.path.exists(f):
            bad.append("%s is missing" % name)
            continue
        data = open(f, "rb").read()
        if len(data) != e["bytes"] or hashlib.sha256(data).hexdigest() != e["sha256"]:
            bad.append("%s is not what the manifest lists" % name)
    if not bad and os.path.isdir(sources) and os.path.exists(ENCODER):
        manifest, files = build_all(sources)

        def strip(m):
            if isinstance(m, dict):
                return {k: strip(v) for k, v in m.items() if k not in ("bytes", "sha256", "total_bytes")}
            if isinstance(m, list):
                return [strip(v) for v in m]
            return m

        if json.dumps(strip(manifest), sort_keys=True) != json.dumps(strip(on_disk), sort_keys=True):
            bad.append("the manifest is not what the sources give")
    for b in bad:
        print(b)
    print("models are current" if not bad else "models are stale")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=DEFAULT_SOURCES)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--encoder", default=None)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.encoder is not None:
        global ENCODER
        ENCODER = args.encoder
    if args.check:
        sys.exit(check(args.out, args.sources))
    manifest, files = build_all(args.sources)
    os.makedirs(args.out, exist_ok=True)
    for name, data in files.items():
        with open(os.path.join(args.out, name), "wb") as f:
            f.write(data)
        print("%-20s %9d bytes" % (name, len(data)))
    with open(os.path.join(args.out, MANIFEST), "w") as f:
        f.write(json.dumps(manifest, indent=2) + "\n")
    print("total %.2f MB, %.2f MB on the GPU with every mip level, sharing the arms' maps" % (manifest["total_bytes"] / 1e6, manifest["total_gpu_bytes_shared"] / 1e6))


if __name__ == "__main__":
    main()

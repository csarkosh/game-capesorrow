/**
 * An offline look at the hand and the torch: the meshes the game builds (`handArrays`), placed by the game's own pose (`stepHand` at the hold, `torchBasis`, the lens at
 * `holdFor`), projected through the game's lens (vertical field `FOV`) and rasterised in software with a depth buffer. No browser, no GPU, no dependency: the PNG is
 * encoded with node's zlib. Run from `client/`:
 *
 *     npx tsx tools/handPreview.ts [outDir]
 *
 * It writes `both-16x10.png` (1,248 x 780), `both-16x9.png` (1,280 x 720), `both-12x10.png` (949 x 780), `both-night-16x10.png` (the arms at the night's level, 0.12), `torch-closeup.png` and `watch-closeup.png` to `outDir`, which is by default
 * `/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-hand-preview/` (the external disk: never the repository). A grey box stands where the corner map (220 px, 12 px in from the
 * bottom right) and the party's rows above it sit. The shading is the vertex's colour (the albedo the builders give it) lit from up and the left with a little ambient
 * and a rim, so it shows the shapes and not the town's textures. It is a way of judging form and place, not a picture of the game.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { handArrays } from "../src/game/hand/handParts.js";
import { FOV, handScaleFor, newHandPose, newHandState, stepHand, torchBasis, type HandPose } from "../src/game/hand/handPose.js";
import { MeshBuilder } from "../src/game/town/meshBuilder.js";
import { SCREEN_RADIUS, SCREEN_Y, WATCH_BIG, watchGeometry } from "../src/game/hand/watchGeometry.js";
import { ARM_SCALE, newWatchPose, newWatchState, stepWatch, watchQuad } from "../src/game/hand/watchPose.js";

const OUT = process.argv[2] ?? "/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-hand-preview";
const NEAR = 0.05;

type Mesh = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array };

function crc32(buf: Buffer): number {
  let c: number;
  let crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ (buf[n] as number)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

type View = { W: number; H: number; zoom: number; cx: number; cy: number; map: boolean };
type Rgb3 = [number, number, number];
type Item = { m: Mesh; glow: boolean; pose: HandPose; basis: Float64Array; flat?: Rgb3; level?: number };

function render(items: Item[], view: View): Uint8Array {
  const { W, H } = view;
  const f = (H / 2 / Math.tan(FOV / 2)) * view.zoom;
  const img = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(1e9);
  // A dim street for the hand to be seen against: a grey gradient, so a dark glove and a bright torch both read.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H;
    const i = (y * W + x) * 3;
    img[i] = 0.34 + 0.1 * t;
    img[i + 1] = 0.38 + 0.1 * t;
    img[i + 2] = 0.44 + 0.08 * t;
  }
  const light = [-0.5, 0.75, -0.45];
  const ll = Math.hypot(light[0]!, light[1]!, light[2]!);
  const L = light.map((v) => v / ll);
  let pose: HandPose = items[0]!.pose;
  let basis: Float64Array = items[0]!.basis;
  const toCam = (m: Mesh, k: number): [number, number, number] => {
    const px = m.positions[k * 3]!, py = m.positions[k * 3 + 1]!, pz = m.positions[k * 3 + 2]!;
    return [pose.x + basis[0]! * px + basis[3]! * py + basis[6]! * pz, pose.y + basis[1]! * px + basis[4]! * py + basis[7]! * pz, pose.z + basis[2]! * px + basis[5]! * py + basis[8]! * pz];
  };
  const nrm = (m: Mesh, k: number): [number, number, number] => {
    const nx = m.normals[k * 3]!, ny = m.normals[k * 3 + 1]!, nz = m.normals[k * 3 + 2]!;
    return [basis[0]! * nx + basis[3]! * ny + basis[6]! * nz, basis[1]! * nx + basis[4]! * ny + basis[7]! * nz, basis[2]! * nx + basis[5]! * ny + basis[8]! * nz];
  };
  for (const item of items) {
    const { m, glow } = item;
    pose = item.pose;
    basis = item.basis;
    for (let t = 0; t < m.indices.length; t += 3) {
      const ids = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      let pts = ids.map((k) => ({ p: toCam(m, k), n: nrm(m, k), c: [m.colors[k * 4]!, m.colors[k * 4 + 1]!, m.colors[k * 4 + 2]!] }));
      // Facing the eye (the eye is the origin): a back face is not drawn, as the game's materials cull them.
      const n0 = pts[0]!.n;
      const p0 = pts[0]!.p;
      if (n0[0] * -p0[0] + n0[1] * -p0[1] + n0[2] * -p0[2] <= 0) continue;
      // Clip against the near plane.
      const out: typeof pts = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
        const ain = a.p[2] > NEAR, bin = b.p[2] > NEAR;
        if (ain) out.push(a);
        if (ain !== bin) {
          const s = (NEAR - a.p[2]) / (b.p[2] - a.p[2]);
          out.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * s, a.p[1] + (b.p[1] - a.p[1]) * s, NEAR], n: a.n, c: a.c });
        }
      }
      pts = out;
      if (pts.length < 3) continue;
      const sc = pts.map((v) => ({ x: W / 2 + ((v.p[0] / v.p[2]) * f - view.cx), y: H / 2 - ((v.p[1] / v.p[2]) * f - view.cy), z: v.p[2], n: v.n, c: v.c }));
      for (let q = 1; q < sc.length - 1; q++) {
        const a = sc[0]!, b = sc[q]!, c = sc[q + 1]!;
        const minx = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), maxx = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
        const miny = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), maxy = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
        const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(den) < 1e-9) continue;
        for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
          const l1 = ((b.y - c.y) * (x + 0.5 - c.x) + (c.x - b.x) * (y + 0.5 - c.y)) / den;
          const l2 = ((c.y - a.y) * (x + 0.5 - c.x) + (a.x - c.x) * (y + 0.5 - c.y)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          // Perspective-correct depth by 1/z.
          const iz = l1 / a.z + l2 / b.z + l3 / c.z;
          const z = 1 / iz;
          const di = y * W + x;
          if (z >= depth[di]!) continue;
          depth[di] = z;
          const mix = (u: number, v: number, w: number): number => (u * l1 / a.z + v * l2 / b.z + w * l3 / c.z) * z;
          let nx = mix(a.n[0], b.n[0], c.n[0]), ny = mix(a.n[1], b.n[1], c.n[1]), nz = mix(a.n[2], b.n[2], c.n[2]);
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          const lam = Math.max(0, nx * L[0]! + ny * L[1]! + nz * L[2]!);
          const rim = Math.pow(1 - Math.max(0, nz * -1), 3) * 0.0;
          const col = item.flat ?? [mix(a.c[0], b.c[0], c.c[0]), mix(a.c[1], b.c[1], c.c[1]), mix(a.c[2], b.c[2], c.c[2])];
          // A bright worn metal catches the light along its edges: a crude specular lobe from the half vector.
          const hx = L[0]! + 0, hy = L[1]! + 0, hz = L[2]! - 1;
          const hl = Math.hypot(hx, hy, hz) || 1;
          const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 24) * (col[0]! + col[1]! + col[2]! > 0.6 ? 0.5 : 0.08);
          const i3 = di * 3;
          for (let k = 0; k < 3; k++) {
            const albedo = glow ? 3 : col[k]! * (item.level ?? 1);
            const lit = glow || item.flat !== undefined ? albedo : albedo * (0.3 + 1.7 * lam) + spec * (item.level ?? 1) + rim;
            img[i3 + k] = Math.min(1, Math.pow(Math.max(0, lit), 1 / 2.2));
          }
        }
      }
    }
  }
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < img.length; i++) rgb[i] = Math.round(Math.min(1, Math.max(0, img[i]!)) * 255);
  if (view.map) {
    // The corner map (220 px, 12 px in) and the party's rows above it (about 80 px): at a 1,248 by 780 view; scaled for other sizes by the height.
    const s = H / 780;
    const box = (x0: number, y0: number, x1: number, y1: number, shade: number): void => {
      for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) {
        const i = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(rgb[i + k]! * 0.4 + shade * 0.6);
      }
    };
    box(W - (12 + 220) * s, H - (12 + 220) * s, W - 12 * s, H - 12 * s, 150);
    box(W - (12 + 220) * s, H - (12 + 220 + 12 + 80) * s, W - 12 * s, H - (12 + 220 + 12) * s, 110);
  }
  return rgb;
}

/** A flat disc in the watch's frame, for the lit screen's place. */
function disc(): Mesh {
  const n = 40;
  const positions: number[] = [0, SCREEN_Y + 0.0004, 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    positions.push(Math.sin(a) * SCREEN_RADIUS * WATCH_BIG, SCREEN_Y + 0.0004, Math.cos(a) * SCREEN_RADIUS * WATCH_BIG);
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + ((i + 1) % n));
  const nv = n + 1;
  return { positions: new Float32Array(positions), normals: new Float32Array(Array.from({ length: nv * 3 }, (_, k) => (k % 3 === 1 ? 1 : 0))), colors: new Float32Array(nv * 4), indices: new Uint32Array(indices) };
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const { body, lens } = handArrays();
  const lb = new MeshBuilder();
  watchGeometry(lb);
  const left = lb.take();
  process.stdout.write(`right: vertices ${body.positions.length / 3} + ${lens.positions.length / 3}, triangles ${body.indices.length / 3} + ${lens.indices.length / 3}; left: vertices ${left.positions.length / 3}, triangles ${left.indices.length / 3}\n`);
  const shapes = [["16x10", 1248, 780, 1], ["16x9", 1280, 720, 1], ["12x10", 949, 780, 1], ["night-16x10", 1248, 780, 0.12]] as const;
  for (const [name, W, H, level] of shapes) {
    const aspect = W / H;
    const f = H / 2 / Math.tan(FOV / 2);
    const rs = newHandState();
    const rp = newHandPose();
    for (let i = 0; i < 120; i++) stepHand(rs, { dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect }, rp);
    const rb = new Float64Array(9);
    torchBasis(restAxes(), rp, rb, handScaleFor(aspect));
    const ls = newWatchState();
    const lp = newWatchPose();
    for (let i = 0; i < 120; i++) stepWatch(ls, { dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect }, lp);
    const lbasis = new Float64Array(9);
    torchBasis(restAxes(), lp, lbasis, ARM_SCALE);
    const quad = new Float32Array(8);
    watchQuad(lp, lbasis, aspect, quad);
    const items = (which: "right" | "left" | "both"): Item[] => [
      ...(which !== "left" ? [{ m: body as Mesh, glow: false, pose: rp, basis: rb, level }, { m: lens as Mesh, glow: true, pose: rp, basis: rb }] : []),
      ...(which !== "right" ? [{ m: left as Mesh, glow: false, pose: lp, basis: lbasis, level }, { m: disc(), glow: false, pose: lp, basis: lbasis, flat: [0.6, 0.78, 1] as Rgb3 }] : []),
    ];
    const at = (k: number): [number, number] => {
      const px = rp.x + rb[6]! * -k, py = rp.y + rb[7]! * -k, pz = rp.z + rb[8]! * -k;
      return [0.5 + ((px / pz) * f) / W, 0.5 - ((py / pz) * f) / H];
    };
    const lensAt = at(0), fistAt = at(0.16), tailAt = at(0.2135);
    const qs = Array.from(quad, (v) => (v * 100).toFixed(0)).join(",");
    process.stdout.write(`${name}: head ${(lensAt[0] * 100).toFixed(0)}% / ${(lensAt[1] * 100).toFixed(0)}%, fist ${(fistAt[0] * 100).toFixed(0)}% / ${(fistAt[1] * 100).toFixed(0)}%, tail ${(tailAt[0] * 100).toFixed(0)}% / ${(tailAt[1] * 100).toFixed(0)}%, torch ${((Math.hypot((tailAt[0] - lensAt[0]) * W, (tailAt[1] - lensAt[1]) * H) / W) * 100).toFixed(0)}% of the width long; watch quad % ${qs}\n`);
    writeFileSync(`${OUT}/both-${name}.png`, png(W, H, render(items("both"), { W, H, zoom: 1, cx: 0, cy: 0, map: false })));
    if (name === "16x10") {
      const gx = rp.x + rb[6]! * -0.14, gy = rp.y + rb[7]! * -0.14, gz = rp.z + rb[8]! * -0.14;
      writeFileSync(`${OUT}/torch-closeup.png`, png(W, H, render(items("right"), { W, H, zoom: 3, cx: (gx / gz) * f * 3, cy: (gy / gz) * f * 3, map: false })));
      writeFileSync(`${OUT}/watch-closeup.png`, png(W, H, render(items("left"), { W, H, zoom: 2.2, cx: (lp.x / lp.z) * f * 2.2 + 120, cy: (lp.y / lp.z) * f * 2.2, map: false })));
    }
  }
}
main();

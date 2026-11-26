/**
 * What a working harbour has, other than its decks and boats: pilings (the fields of dead piles, the dolphins), the mill's log
 * pond (boom sticks chained between piles, floating logs, a jack ladder and house), a closed mill's wigwam burner, the terminal's
 * yard (decks of logs in trapezoid stacks, chip piles, silos, a bulk shed, cargo containers, parked cars), its barge and its
 * loading spout, and the lights. Plain arrays, each a function of the plan's data and the ground's height, no random call:
 * what varies comes from `hash01` of an index.
 */
import { boatGeometry } from "./boatGeometry.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { withMat } from "./materials.js";
import { GLASS, PILE, ROOF_METAL, STEEL, STEEL_RUST, TIMBER, TIMBER_WEATHERED } from "./palette.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import { HARBOUR_LAMP, LENS_GLOW, PIER_LAMP } from "./props/lamps.js";
import type { Barge, Piling, YardItem } from "../../sim/town/types.js";

const BARK: Rgb = [0.2, 0.14, 0.09];
const LOG_END: Rgb = [0.55, 0.45, 0.3];
const PILE_TOP: Rgb = [0.34, 0.28, 0.2];
const CHIPS: Rgb = [0.62, 0.52, 0.34];
const CONCRETE: Rgb = [0.5, 0.5, 0.48];
const RUST: Rgb = [0.38, 0.2, 0.12];
const WHITE: Rgb = [0.86, 0.86, 0.84];
const CONTAINERS: readonly Rgb[] = [[0.5, 0.15, 0.1], [0.12, 0.25, 0.45], [0.15, 0.35, 0.2], [0.45, 0.45, 0.43], [0.65, 0.4, 0.1], [0.3, 0.12, 0.3]];
const CARS: readonly Rgb[] = [[0.75, 0.75, 0.75], [0.1, 0.1, 0.12], [0.5, 0.08, 0.08], [0.12, 0.2, 0.4], [0.55, 0.55, 0.52], [0.2, 0.3, 0.2]];

const sinkAt = (sink: Sink, x: number, z: number): MeshBuilder => sink(x, z);

/** A pile: a post from the sea floor to its top, leaning, in a weathered colour that varies by index. */
function pile(g: TownGround, sink: Sink, p: Piling, i: number): void {
  const x = g.anchor.x + p.x;
  const z = g.anchor.z + p.z;
  const bottom = Math.min(g.heightAt(x, z), SEA - 0.4) - 0.3;
  const h = p.top - bottom;
  const k = 0.8 + hash01(i, 41) * 0.35;
  const colour = scaled(p.kind === "dolphin" ? TIMBER : PILE, k);
  withMat("wood", () => sink(x, z).prism([x, bottom, z], [x + p.lean.x * h, p.top, z + p.lean.z * h], p.radius, 6, colour, scaled(PILE_TOP, k)));
}

export function pilingGeometry(g: TownGround, sink: Sink): void {
  const h = g.plan.harbour;
  let i = 0;
  for (const field of h.pilings) for (const p of field.piles) pile(g, sink, p, i++);
  for (let d = 0; d < h.dolphins.length; d++) {
    const p = h.dolphins[d] as Piling;
    pile(g, sink, p, 1000 + d);
    // A wire lashing round each trio, a little under the tops.
    if (d % 3 === 2) {
      const a = h.dolphins[d - 2] as Piling;
      const b = h.dolphins[d - 1] as Piling;
      const cx = g.anchor.x + (a.x + b.x + p.x) / 3;
      const cz = g.anchor.z + (a.z + b.z + p.z) / 3;
      withMat("steel", () => sinkAt(sink, cx, cz).prism([cx, 2.6, cz], [cx, 2.9, cz], 0.4, 6, [0.1, 0.1, 0.1], null));
    }
  }
}

/** A log lying along (ax, az) from its middle, at height y. */
function logAt(m: MeshBuilder, cx: number, y: number, cz: number, ax: number, az: number, length: number, r: number, colour: Rgb): void {
  withMat("bark", () => m.prism([cx - (ax * length) / 2, y, cz - (az * length) / 2], [cx + (ax * length) / 2, y, cz + (az * length) / 2], r, 6, colour, LOG_END));
}

/** The mill's water: the pond's boom and logs, the jack ladder; and the burner of a closed mill. */
export function millGeometry(g: TownGround, sink: Sink): void {
  const pond = g.plan.harbour.logPond;
  if (pond !== null) {
    const ax = g.anchor.x;
    const az = g.anchor.z;
    const piles = pond.piles;
    for (let i = 0; i < piles.length; i++) pile(g, sink, piles[i] as Piling, 2000 + i);
    // The boom: sticks chained from pile to pile round the seaward side and the ends, a log long and a little proud of the water.
    const sea = piles.filter((p) => Math.abs(p.x - (pond.centre.x - pond.halfX)) < 0.01);
    const chain = (p: Piling, q: Piling): void => {
      const x0 = ax + p.x;
      const z0 = az + p.z;
      const x1 = ax + q.x;
      const z1 = az + q.z;
      withMat("bark", () => sinkAt(sink, x0, z0).prism([x0, 0.12, z0], [x1, 0.12, z1], 0.34, 6, scaled(BARK, 1.15), LOG_END));
    };
    for (let i = 0; i + 1 < sea.length; i++) chain(sea[i] as Piling, sea[i + 1] as Piling);
    const sides = piles.filter((p) => !sea.includes(p));
    for (let i = 0; i < sides.length; i++) {
      const p = sides[i] as Piling;
      // Each side's piles run landward from the seaward end: chain neighbours on the same side of the pond.
      const next = sides.find((q) => q !== p && Math.abs(q.z - p.z) < 0.01 && Math.abs(q.x - p.x - 7.5) < 0.01);
      if (next) chain(p, next);
    }
    for (const sgn of [-1, 1]) {
      const end = sea.find((p) => Math.abs(p.z - (pond.centre.z + sgn * pond.halfZ)) < 0.01);
      const first = sides.find((q) => Math.abs(q.z - (pond.centre.z + sgn * pond.halfZ)) < 0.01 && Math.abs(q.x - (pond.centre.x - pond.halfX + 7.5)) < 0.01);
      if (end && first) chain(end, first);
    }
    for (const l of pond.logs) {
      const x = ax + l.x;
      const z = az + l.z;
      logAt(sinkAt(sink, x, z), x, 0.02, z, l.heading.x, l.heading.z, l.length, l.radius, scaled(BARK, 0.8 + 0.4 * hash01(Math.floor(l.x * 7 + l.z * 13), 5)));
    }
    const jl = pond.jackLadder;
    if (jl !== null) {
      // A trough on trestles from the water up to the jack house: two sloped planks and a floor, legs where it stands above the ground.
      const x0 = ax + jl.a.x;
      const z0 = az + jl.a.z;
      const x1 = ax + jl.b.x;
      const z1 = az + jl.b.z;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const tx = (x1 - x0) / len;
      const tz = (z1 - z0) / len;
      const nx = tz;
      const nz = -tx;
      const hw = jl.width / 2;
      const n = Math.ceil(len / 3);
      const hAt = (s: number): number => jl.bottom + ((jl.top - jl.bottom) * s) / len;
      for (let i = 0; i < n; i++) {
        const s0 = (len * i) / n;
        const s1 = (len * (i + 1)) / n;
        const m = sink((x0 + x1) / 2, (z0 + z1) / 2);
        const q = (s: number, t: number, y: number): Vec3 => [x0 + tx * s + nx * t, y, z0 + tz * s + nz * t];
        withMat("wood", () => m.poly([q(s0, -hw, hAt(s0)), q(s1, -hw, hAt(s1)), q(s1, hw, hAt(s1)), q(s0, hw, hAt(s0))], [0, 1, 0], TIMBER, "wood", { back: { colour: [0.2, 0.17, 0.13] } }));
        for (const sgn of [-1, 1]) {
          withMat("wood", () => m.poly([q(s0, sgn * hw, hAt(s0)), q(s1, sgn * hw, hAt(s1)), q(s1, sgn * hw, hAt(s1) + 0.7), q(s0, sgn * hw, hAt(s0) + 0.7)], [nx * sgn, 0, nz * sgn], TIMBER_WEATHERED, "wood", { back: true }));
          withMat("wood", () => m.poly([q(s0, sgn * hw, hAt(s0) - 0.35), q(s1, sgn * hw, hAt(s1) - 0.35), q(s1, sgn * hw, hAt(s1)), q(s0, sgn * hw, hAt(s0))], [nx * sgn, 0, nz * sgn], TIMBER, "wood", { back: true }));
        }
        // Legs at the middle of each 3 m, down to the ground or the floor.
        const sm = (s0 + s1) / 2;
        const px = x0 + tx * sm;
        const pz = z0 + tz * sm;
        const floor = Math.min(g.heightAt(px, pz), SEA - 0.3) - 0.3;
        const top = hAt(sm) - 0.35;
        if (top - floor > 0.6) for (const sgn of [-1, 1]) withMat("wood", () => m.prism([px + nx * sgn * (hw - 0.15), floor, pz + nz * sgn * (hw - 0.15)], [px + nx * sgn * (hw - 0.15), top, pz + nz * sgn * (hw - 0.15)], 0.14, 4, PILE, PILE));
      }
      // The jack house at the top: a box with a roof.
      const hx = x1 + tx * 2.5;
      const hz = z1 + tz * 2.5;
      const base = jl.top - 0.4;
      withMat("wood", () => sinkAt(sink, hx, hz).box(hx, hz, base, 1, 0, 3.5, 3.5, 4.5, TIMBER_WEATHERED, ROOF_METAL));
      const floorH = Math.min(g.heightAt(hx, hz), base);
      withMat("wood", () => {
        sinkAt(sink, hx, hz).prism([hx - 3, floorH, hz - 3], [hx - 3, base, hz - 3], 0.2, 4, PILE, PILE);
        sinkAt(sink, hx, hz).prism([hx + 3, floorH, hz + 3], [hx + 3, base, hz + 3], 0.2, 4, PILE, PILE);
      });
    }
  }
  const b = g.plan.harbour.burner;
  if (b !== null) {
    const x = g.anchor.x + b.x;
    const z = g.anchor.z + b.z;
    const y = g.heightAt(x, z) - 0.3;
    const m = sinkAt(sink, x, z);
    // A low steel ring, the cone above it, a cap, and rust streaks as bands of a darker colour.
    withMat("rusty", () => {
      m.cylinder(x, z, y, b.radius + 0.4, 2.2, 14, scaled(RUST, 0.8), RUST, b.radius + 0.3);
      m.cylinder(x, z, y + 2.2, b.radius + 0.3, b.height * 0.5, 14, RUST, RUST, b.radius * 0.55);
      m.cylinder(x, z, y + 2.2 + b.height * 0.5, b.radius * 0.55, b.height * 0.4, 14, scaled(RUST, 1.2), RUST, b.radius * 0.22);
      m.cylinder(x, z, y + 2.2 + b.height * 0.9, b.radius * 0.22, 1.6, 10, scaled(RUST, 0.7), scaled(RUST, 0.6));
    });
  }
}

function box3(m: MeshBuilder, cx: number, cz: number, y0: number, hx: number, hz: number, h: number, side: Rgb, top: Rgb): void {
  m.box(cx, cz, y0, 1, 0, hx, hz, h, side, top);
}

/** A stack of logs in the shape of a trapezoid: rows of one fewer each, lying along z. */
function logStack(g: TownGround, m: MeshBuilder, it: YardItem, id: number): void {
  const x = g.anchor.x + it.x;
  const z = g.anchor.z + it.z;
  const y0 = g.heightAt(x, z);
  const r = 0.5;
  const rows = Math.max(1, Math.min(5, it.n - 3));
  for (let row = 0; row < rows; row++) {
    const n = it.n - row;
    const y = y0 + r + row * r * 1.75;
    for (let k = 0; k < n; k++) {
      const cx = x + (k - (n - 1) / 2) * r * 2.1;
      const len = it.halfZ * 2 * (0.85 + 0.15 * hash01(id * 97 + row * 13 + k, 6));
      const shift = (hash01(id * 31 + row * 7 + k, 7) - 0.5) * 1.2;
      logAt(m, cx, y, z + shift, 0, 1, len, r * (0.88 + 0.2 * hash01(id * 5 + row * 3 + k, 8)), scaled(BARK, 0.75 + 0.5 * hash01(id * 11 + row * 17 + k, 9)));
    }
  }
}

function yardItem(g: TownGround, sink: Sink, it: YardItem, id: number): void {
  const x = g.anchor.x + it.x;
  const z = g.anchor.z + it.z;
  const m = sinkAt(sink, x, z);
  const y0 = g.heightAt(x, z);
  switch (it.kind) {
    case "log stack":
      logStack(g, m, it, id);
      break;
    case "chip pile":
      withMat("gravel", () => m.cylinder(x, z, y0, it.halfX, it.height, 12, CHIPS, CHIPS, 0.7));
      break;
    case "silo": {
      withMat("concrete", () => {
        m.cylinder(x, z, y0, it.halfX, it.height, 14, CONCRETE, CONCRETE);
        m.cylinder(x, z, y0 + it.height, it.halfX + 0.1, 3.2, 14, scaled(CONCRETE, 0.8), ROOF_METAL, 0.5);
      });
      break;
    }
    case "bulk shed":
      withMat("ribbed", () => box3(m, x, z, y0, it.halfX, it.halfZ, it.height, STEEL, ROOF_METAL));
      break;
    case "containers": {
      // Rows of boxes two across, two long and stacked up to two high, each its own colour.
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          for (let h = 0; h < 1 + ((id + a + b) % 2); h++) {
            const c = CONTAINERS[Math.floor(hash01(id * 19 + a * 5 + b * 3 + h, 12) * CONTAINERS.length)] as Rgb;
            withMat("ribbed", () => box3(m, x + (a - 0.5) * 2.8, z + (b - 0.5) * (it.halfZ - 0.2), y0 + h * 2.6, 1.2, it.halfZ / 2 - 0.2, 2.5, c, scaled(c, 1.1)));
          }
        }
      }
      break;
    }
    case "cars": {
      for (let i = 0; i < it.n; i++) {
        const cx = x + ((i % 2) - 0.5) * 3.4;
        const cz = z + (Math.floor(i / 2) - (it.n / 2 - 1) / 2) * 2.9;
        const c = CARS[Math.floor(hash01(id * 23 + i, 13) * CARS.length)] as Rgb;
        withMat("painted", () => {
          box3(m, cx, cz, y0 + 0.2, 0.9, 2.1, 0.75, c, c);
          box3(m, cx, cz - 0.1, y0 + 0.95, 0.8, 1.1, 0.6, c, scaled(c, 1.1));
          // Wheels as dark bands, and a dark band of glass.
          box3(m, cx, cz - 0.1, y0 + 1.05, 0.82, 1.05, 0.35, GLASS, GLASS);
        });
      }
      break;
    }
  }
}

/** The barge: a flat hull with a rake at each end, and its cargo. */
function bargeGeometry(g: TownGround, sink: Sink, barge: Barge): void {
  const m = sinkAt(sink, barge.x, barge.z);
  const hx = barge.heading.x;
  const hz = barge.heading.z;
  const ax = hz;
  const az = -hx;
  const L = barge.length;
  const B = barge.beam;
  const P = (lx: number, ly: number, lz: number): Vec3 => [barge.x + hx * lx + ax * lz, ly, barge.z + hz * lx + az * lz];
  const draft = 1.6;
  const free = 1.4;
  const hullC: Rgb = [0.2, 0.2, 0.22];
  const bottom: Rgb = [0.3, 0.1, 0.08];
  // Sides, ends with a rake, deck.
  const h = B / 2;
  const rake = 3;
  const sideL: Vec3[] = [P(-L / 2, free, -h), P(L / 2 - rake, free, -h), P(L / 2 - rake, -draft, -h), P(-L / 2, -draft, -h)];
  const sideR: Vec3[] = [P(-L / 2, free, h), P(L / 2 - rake, free, h), P(L / 2 - rake, -draft, h), P(-L / 2, -draft, h)];
  withMat("steel", () => {
    m.poly(sideL, [-ax, 0, -az], hullC);
    m.poly(sideR, [ax, 0, az], hullC);
    m.poly([P(-L / 2, -draft, -h), P(-L / 2, free, -h), P(-L / 2, free, h), P(-L / 2, -draft, h)], [-hx, 0, -hz], hullC);
    // The bow's rake: the deck narrows to the bow's top and the sides slope under to the bottom.
    m.poly([P(L / 2 - rake, free, -h), P(L / 2, free * 0.35, -h * 0.8), P(L / 2, free * 0.35, h * 0.8), P(L / 2 - rake, free, h)], [hx * 0.3, 1, hz * 0.3], scaled(hullC, 1.1));
    m.poly([P(L / 2, free * 0.35, -h * 0.8), P(L / 2 - rake, free, -h), P(L / 2 - rake, -draft, -h), P(L / 2, -draft, -h * 0.8)], [-ax + hx * 0.4, 0, -az + hz * 0.4], hullC);
    m.poly([P(L / 2 - rake, free, h), P(L / 2, free * 0.35, h * 0.8), P(L / 2, -draft, h * 0.8), P(L / 2 - rake, -draft, h)], [ax + hx * 0.4, 0, az + hz * 0.4], hullC);
    m.poly([P(L / 2, free * 0.35, -h * 0.8), P(L / 2, free * 0.35, h * 0.8), P(L / 2, -draft, h * 0.8), P(L / 2, -draft, -h * 0.8)], [hx, 0, hz], hullC);
    m.poly([P(-L / 2, free, -h), P(L / 2 - rake, free, -h), P(L / 2 - rake, free, h), P(-L / 2, free, h)], [0, 1, 0], scaled(hullC, 1.3));
    m.poly([P(-L / 2, -draft, -h), P(L / 2, -draft, -h * 0.8), P(L / 2, -draft, h * 0.8), P(-L / 2, -draft, h)], [0, -1, 0], bottom);
  });
  // The cargo, in barge-local boxes and prisms.
  const bx = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, c: Rgb): void => {
    const p = (lx: number, lz: number, y: number): Vec3 => P(lx, y, lz);
    const quad = (pts: Vec3[], hint: Vec3, col: Rgb): void => m.poly(pts, hint, col);
    quad([p(x0, z0, y0), p(x1, z0, y0), p(x1, z0, y1), p(x0, z0, y1)], [-ax, 0, -az], c);
    quad([p(x0, z1, y0), p(x1, z1, y0), p(x1, z1, y1), p(x0, z1, y1)], [ax, 0, az], c);
    quad([p(x1, z0, y0), p(x1, z1, y0), p(x1, z1, y1), p(x1, z0, y1)], [hx, 0, hz], c);
    quad([p(x0, z0, y0), p(x0, z1, y0), p(x0, z1, y1), p(x0, z0, y1)], [-hx, 0, -hz], c);
    quad([p(x0, z0, y1), p(x1, z0, y1), p(x1, z1, y1), p(x0, z1, y1)], [0, 1, 0], scaled(c, 1.1));
    quad([p(x0, z0, y0), p(x0, z1, y0), p(x1, z1, y0), p(x1, z0, y0)], [0, -1, 0], scaled(c, 0.6));
  };
  switch (barge.cargo) {
    case "logs":
      for (let row = 0; row < 4; row++) {
        const n = 6 - row;
        for (let k = 0; k < n; k++) withMat("wood", () => m.prism(P(-L / 2 + 1, free + 0.5 + row * 0.85, (k - (n - 1) / 2) * 1.2), P(L / 2 - rake - 1, free + 0.5 + row * 0.85, (k - (n - 1) / 2) * 1.2), 0.55, 6, scaled(BARK, 0.8 + 0.4 * hash01(row * 9 + k, 14)), LOG_END));
      }
      break;
    case "chips":
      withMat("gravel", () => m.cylinder(barge.x + hx * -2, barge.z + hz * -2, free, 3.4, 4.5, 12, CHIPS, CHIPS, 0.8));
      break;
    case "grain":
      for (const c of [-6, 3]) withMat("steel", () => bx(c - 4, c + 4, -h + 0.8, h - 0.8, free, free + 3, STEEL_RUST));
      break;
    case "vehicles":
      for (let i = 0; i < 8; i++) {
        const c = CARS[i % CARS.length] as Rgb;
        withMat("painted", () => bx(-L / 2 + 2 + (i % 4) * 4.6, -L / 2 + 6 + (i % 4) * 4.6, -h + 0.9 + Math.floor(i / 4) * 3, -h + 2.7 + Math.floor(i / 4) * 3, free, free + 1.5, c));
      }
      break;
    case "containers":
      for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) withMat("ribbed", () => bx(-L / 2 + 1 + a * 6.6, -L / 2 + 7.2 + a * 6.6, -h + 0.8 + b * 3.3, -h + 3 + b * 3.3, free, free + 2.6 + ((a + b) % 2) * 2.6, CONTAINERS[(a * 2 + b) % CONTAINERS.length] as Rgb));
      break;
  }
}

/** The terminal's yard, its barge and its spout. */
export function terminalGeometry(g: TownGround, sink: Sink): void {
  const t = g.plan.harbour.terminal;
  if (t === null) return;
  for (let i = 0; i < t.yard.length; i++) yardItem(g, sink, t.yard[i] as YardItem, i + 1);
  if (t.barge !== null) bargeGeometry(g, sink, { ...t.barge, x: g.anchor.x + t.barge.x, z: g.anchor.z + t.barge.z });
  if (t.spout !== null) {
    // A loading spout: a post and a chute angled out over the barge.
    const x = g.anchor.x + t.spout.x;
    const z = g.anchor.z + t.spout.z;
    const m = sinkAt(sink, x, z);
    withMat("steel", () => {
      m.prism([x, 2.6, z], [x, 8, z], 0.35, 6, STEEL, STEEL);
      m.prism([x, 7.6, z], [x - 3, 5.4, z], 0.28, 6, STEEL_RUST, STEEL_RUST);
    });
  }
}

/** The boats and the barge's tug (a boat of the harbour's list). */
export function boatsGeometry(g: TownGround, sink: Sink): void {
  for (const b of g.plan.harbour.boats) boatGeometry((x, z) => sink(x, z), { ...b, x: g.anchor.x + b.x, z: g.anchor.z + b.z });
}

/** The lights: a harbour light on a tower, a day beacon on three legs, a light on the end of a pier. */
export function lightGeometry(g: TownGround, sink: Sink): void {
  for (const l of g.plan.harbour.lights) {
    const x = g.anchor.x + l.x;
    const z = g.anchor.z + l.z;
    const m = sinkAt(sink, x, z);
    const y = l.kind === "pier light" ? 2.6 : Math.max(g.heightAt(x, z), 0.5) - 0.4;
    if (l.kind === "harbour light") {
      withMat("concrete", () => box3(m, x, z, y, 1.6, 1.6, 0.8, CONCRETE, CONCRETE));
      withMat("painted", () => {
      m.cylinder(x, z, y + 0.8, 1, l.height, 10, WHITE, WHITE, 0.7);
      m.prism([x, y + l.height + 0.8, z], [x, y + l.height + 0.85, z], 0.95, 10, [0.2, 0.2, 0.22], [0.2, 0.2, 0.22]);
      // The lantern's glass shines from dusk to dawn (`props/lamps.ts`), dull by day.
      m.withHours(HARBOUR_LAMP.code, () => m.withGlow(LENS_GLOW, () => m.cylinder(x, z, y + l.height + 0.85, 0.5, 1.2, 10, HARBOUR_LAMP.colour, HARBOUR_LAMP.colour)));
      m.cylinder(x, z, y + l.height + 2.05, 0.75, 0.6, 10, [0.5, 0.1, 0.08], [0.5, 0.1, 0.08], 0.05);
      });
    } else if (l.kind === "day beacon") {
      // Three legs from the ground to a point, a slatted daymark at the top.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        withMat("wood", () => m.prism([x + Math.cos(a) * 1.6, y, z + Math.sin(a) * 1.6], [x, y + l.height, z], 0.12, 4, TIMBER, TIMBER));
      }
      withMat("boards", () => {
        box3(m, x, z, y + l.height - 0.4, 0.9, 0.08, 1.5, [0.55, 0.1, 0.08], [0.55, 0.1, 0.08]);
      // The white slat is a little taller than the red, so that their tops and bottoms are not faces in one plane where they cross.
        box3(m, x, z, y + l.height - 0.44, 0.08, 0.9, 1.58, WHITE, WHITE);
      });
    } else {
      withMat("steel", () => m.prism([x, y + 0.03, z], [x, y + l.height - 0.8, z], 0.11, 6, STEEL, STEEL));
      withMat("painted", () => m.withHours(PIER_LAMP.code, () => m.withGlow(LENS_GLOW, () => box3(m, x, z, y + l.height - 0.8, 0.3, 0.3, 0.7, PIER_LAMP.colour, PIER_LAMP.colour))));
    }
  }
}


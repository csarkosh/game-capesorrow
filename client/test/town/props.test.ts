import { VEHICLE_MODELS } from "../../src/sim/town/port/props/vehicleModels.js";
import { describe, expect, it } from "vitest";
import { overlap, corners, boxAt, type Box } from "../../src/sim/town/port/props/boxes.js";
import { signatures } from "../../src/sim/town/port/props/dedupe.js";
import { DIMS, STALL_CLEAR, STALL_LENGTH, STALL_PITCH, STALL_SETBACK } from "../../src/sim/town/port/props/tuning.js";
import { yardShape } from "../../src/sim/town/yardShapes.js";
import { bearingU } from "../../src/sim/town/bearings.js";
import type { Street, StreetEdge, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

/** Seeds the prop tests run over (the plan is made once per seed and shared with the other town tests). */
const PROP_SEEDS = SEEDS.slice(0, 20);
const HULL = 0.4;
/** A depth under which two boxes count as touching (two fence runs meet at a corner a few centimetres deep). */
const TOUCH = 0.05;

const grid = (s: Street): boolean => s.kind === "street" || s.kind === "main" || s.kind === "avenue";

function buildingBoxes(plan: TownPlan): Box[] {
  return plan.buildings.filter((b) => b.kind !== "pier").map((b) => {
    const u = bearingU(b.bearing);
    return { cx: b.centre.x, cz: b.centre.z, ux: u.x, uz: u.z, hu: b.halfAlong, hv: b.halfAcross };
  });
}

describe("the props stage (what stands in the streets, yards and docks)", () => {
  it("is deterministic and a part of every plan", () => {
    for (const seed of PROP_SEEDS.slice(0, 4)) {
      const { plan } = townFor(seed);
      expect(plan.props).toBeDefined();
      expect(plan.props.vehicles.length).toBeGreaterThan(0);
    }
  });

  it("keeps the counts sane over many seeds", () => {
    for (const seed of PROP_SEEDS) {
      const { plan } = townFor(seed);
      const p = plan.props;
      const n = plan.buildings.length;
      expect(p.vehicles.length, `vehicles ${seed}`).toBeGreaterThan(n * 0.15);
      expect(p.vehicles.length, `vehicles ${seed}`).toBeLessThan(n * 1.5);
      expect(p.poles.length, `poles ${seed}`).toBeGreaterThan(30);
      expect(p.poles.length, `poles ${seed}`).toBeLessThan(400);
      expect(p.fences.length, `fences ${seed}`).toBeLessThan(900);
      expect(p.trailers.length, `trailers ${seed}`).toBeLessThan(60);
      expect(p.solids.length, `solids ${seed}`).toBeLessThan(9000);
      // Most front yards have no fence: the lots with a front-side fence are a minority.
      const fenced = new Set<number>();
      for (const f of p.fences) fenced.add(f.lot);
      expect(fenced.size, `fenced ${seed}`).toBeLessThan(plan.lots.length * 0.6);
    }
  });

  it("puts every vehicle at its type's size", () => {
    for (const seed of PROP_SEEDS.slice(0, 6)) {
      for (const v of townFor(seed).plan.props.vehicles) {
        // A vehicle's box is its model's footprint; a camper, with no model, is its kind's size; and the room planned for its kind holds it.
        const own = v.model === "" ? DIMS[v.kind] : [VEHICLE_MODELS[v.model]!.length, VEHICLE_MODELS[v.model]!.width];
        expect(v.length).toBe(own[0]);
        expect(v.width).toBe(own[1]);
        expect(v.length).toBeLessThanOrEqual(Math.max(DIMS[v.kind][0], DIMS.pickup[0], DIMS["work truck"][0]));
        expect(Math.abs(v.hx * v.hx + v.hz * v.hz - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("puts no solid prop on a building, another prop, a junction's pavement, a crosswalk, a driveway mouth or the spawn", () => {
    for (const seed of PROP_SEEDS.slice(0, 10)) {
      const { plan } = townFor(seed);
      const solids = plan.props.solids;
      const buildings = buildingBoxes(plan);
      // Against the buildings.
      const bound = (b: Box): [number, number, number, number] => {
        const ex = Math.abs(b.ux) * b.hu + Math.abs(b.uz) * b.hv;
        const ez = Math.abs(b.uz) * b.hu + Math.abs(b.ux) * b.hv;
        return [b.cx - ex, b.cx + ex, b.cz - ez, b.cz + ez];
      };
      const sb = solids.map(bound);
      const bb = buildings.map(bound);
      for (let i = 0; i < solids.length; i++) {
        for (let j = 0; j < buildings.length; j++) {
          const a = sb[i]!;
          const c = bb[j]!;
          if (a[1] < c[0] || c[1] < a[0] || a[3] < c[2] || c[3] < a[2]) continue;
          expect(overlap(solids[i]!, buildings[j]!), `seed ${seed}: prop ${i} on building ${j}`).toBeLessThanOrEqual(TOUCH);
        }
      }
      // Against each other.
      const order = solids.map((_, i) => i).sort((a, b) => sb[a]![0] - sb[b]![0] || a - b);
      for (let ii = 0; ii < order.length; ii++) {
        const i = order[ii]!;
        for (let jj = ii + 1; jj < order.length; jj++) {
          const j = order[jj]!;
          if (sb[j]![0] > sb[i]![1]) break;
          if (sb[j]![2] > sb[i]![3] || sb[i]![2] > sb[j]![3]) continue;
          expect(overlap(solids[i]!, solids[j]!), `seed ${seed}: props ${i} and ${j} overlap`).toBeLessThanOrEqual(TOUCH);
        }
      }
      // Junction pavements (curb to curb, mouth) and the marked crosswalk beyond, and an alley's mouth.
      for (const j of plan.junctions) {
        for (const leg of j.legs) {
          if (leg.engine) continue;
          const len = leg.mouth + (leg.marked ? 3.5 : 0);
          if (!(len > 0)) continue;
          const strip = boxAt(leg.x + leg.dx * len / 2, leg.z + leg.dz * len / 2, leg.dx, leg.dz, len, 2 * leg.half);
          for (let i = 0; i < solids.length; i++) expect(overlap(solids[i]!, strip), `seed ${seed}: prop ${i} in junction ${j.id}`).toBeLessThanOrEqual(TOUCH);
        }
        if (j.alley !== null) {
          const m = j.alley;
          const mouth = boxAt(m.x - m.dx * 2, m.z - m.dz * 2, m.dx, m.dz, 4, m.width);
          for (let i = 0; i < solids.length; i++) expect(overlap(solids[i]!, mouth), `seed ${seed}: prop ${i} in alley mouth`).toBeLessThanOrEqual(TOUCH);
        }
      }
      // A drive's mouth (from the lot line out over the verge and the curb) and the drive itself against fences.
      for (const lot of plan.lots) {
        const d = yardShape(plan, lot.id).drive;
        if (d === null) continue;
        const mouth = boxAt(d.x - d.dx * 3, d.z - d.dz * 3, d.dx, d.dz, 6, 2 * d.half);
        for (let i = 0; i < solids.length; i++) expect(overlap(solids[i]!, mouth), `seed ${seed}: prop ${i} in the mouth of lot ${lot.id}'s drive`).toBeLessThanOrEqual(TOUCH);
      }
      for (const f of plan.props.fences) {
        const d = yardShape(plan, f.lot).drive;
        if (d === null) continue;
        const dx = f.bx - f.ax;
        const dz = f.bz - f.az;
        const len = Math.sqrt(dx * dx + dz * dz);
        const run = boxAt((f.ax + f.bx) / 2, (f.az + f.bz) / 2, dx / len, dz / len, len, 0.14);
        const drive = boxAt(d.x + d.dx * d.length / 2, d.z + d.dz * d.length / 2, d.dx, d.dz, d.length, 2 * d.half);
        expect(overlap(run, drive), `seed ${seed}: fence ${f.id} across lot ${f.lot}'s drive`).toBeLessThanOrEqual(TOUCH);
      }
      // The spawn.
      for (const s of solids) expect(overlap(s, boxAt(plan.spawn.x, plan.spawn.z, 1, 0, 5, 5)), `seed ${seed}: a prop at the spawn`).toBeLessThanOrEqual(0);
    }
  });

  it("keeps a parked car out of the travel lane and on its street's side", () => {
    for (const seed of PROP_SEEDS) {
      const { plan } = townFor(seed);
      for (const v of plan.props.vehicles) {
        if (v.spot !== "curb" && v.spot !== "pull-off") continue;
        // The street it stands on: the nearest of the grid's centre lines.
        let best: Street | null = null;
        let bd = Infinity;
        for (const s of plan.streets) {
          if (!grid(s)) continue;
          const dx = s.b.x - s.a.x;
          const dz = s.b.z - s.a.z;
          const l2 = dx * dx + dz * dz;
          const t = ((v.x - s.a.x) * dx + (v.z - s.a.z) * dz) / l2;
          if (t < 0 || t > 1) continue;
          const d = Math.hypot(v.x - (s.a.x + dx * t), v.z - (s.a.z + dz * t));
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        expect(best, `seed ${seed}`).not.toBeNull();
        const s = best!;
        const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
        const tx = (s.b.x - s.a.x) / len;
        const tz = (s.b.z - s.a.z) / len;
        const lat = corners(boxAt(v.x, v.z, v.hx, v.hz, v.length, v.width)).map((c) => Math.abs(-(c.x - s.a.x) * tz + (c.z - s.a.z) * tx));
        expect(Math.min(...lat), `seed ${seed}: car ${v.id} on ${s.name} reaches the centre line`).toBeGreaterThanOrEqual(0.9 - 1e-6);
        expect(Math.max(...lat), `seed ${seed}: car ${v.id} on ${s.name} is off the roadway`).toBeLessThanOrEqual(s.roadway / 2 + 1.3);
        // A narrow street is parked along one side only: there is room for traffic past the row.
        if (s.roadway < 9.6) expect(s.roadway - (Math.max(...lat) - Math.min(...lat)) - 0, `seed ${seed}: car ${v.id} leaves the traffic no room`).toBeGreaterThanOrEqual(4.6);
      }
    }
  });

  it("leaves a walker a way along every sidewalk (a hull of 0.4 m, swept along each poured run)", () => {
    for (const seed of PROP_SEEDS.slice(0, 12)) {
      const { plan } = townFor(seed);
      const solids = plan.props.solids;
      for (const s of plan.streets) {
        if (!grid(s)) continue;
        const e = plan.edges[s.id] as StreetEdge;
        const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
        const tx = (s.b.x - s.a.x) / len;
        const tz = (s.b.z - s.a.z) / len;
        const nx = -tz;
        const nz = tx;
        for (const k of [0, 1] as const) {
          const side = e.sides[k];
          if (!(side.walk > 0)) continue;
          const sg = k === 0 ? 1 : -1;
          const t0 = s.roadway / 2 + (side.curb ? 0.18 : 0) + side.verge;
          for (const run of side.runs) {
            let reach: boolean[] | null = null;
            const ts: number[] = [];
            for (let t = t0 + HULL * 0.5; t <= t0 + side.walk - HULL * 0.5 + 1e-9; t += 0.1) ts.push(t);
            if (ts.length === 0) continue;
            for (let ss = run.s0 + 1; ss <= run.s1 - 1; ss += 0.5) {
              const free = ts.map((t) => {
                const x = s.a.x + tx * ss + nx * sg * t;
                const z = s.a.z + tz * ss + nz * sg * t;
                return solids.every((b) => {
                  if (Math.abs(b.cx - x) > 8 || Math.abs(b.cz - z) > 8) return true;
                  const dx = x - b.cx;
                  const dz = z - b.cz;
                  const lu = Math.max(-b.hu, Math.min(b.hu, dx * b.ux + dz * b.uz));
                  const lv = Math.max(-b.hv, Math.min(b.hv, -dx * b.uz + dz * b.ux));
                  return Math.hypot(dx * b.ux + dz * b.uz - lu, -dx * b.uz + dz * b.ux - lv) >= HULL;
                });
              });
              // Reachable from the last step: a free cell next to one that was reachable.
              const next = free.map((f, i) => f && (reach === null || reach[i] === true || reach[i - 1] === true || reach[i + 1] === true));
              if (!next.some((x) => x)) expect.fail(`seed ${seed}: ${s.name} (${s.id}) side ${k} is blocked at ${ss.toFixed(1)} m of the run ${run.s0.toFixed(1)}-${run.s1.toFixed(1)}`);
              reach = next;
            }
          }
        }
      }
    }
  });

  it("stands poles on one side of a street, 35 to 45 m apart, behind the curb, and links them with wires", () => {
    const gaps: number[] = [];
    for (const seed of PROP_SEEDS) {
      const { plan } = townFor(seed);
      const p = plan.props;
      for (const pole of p.poles) {
        if (pole.next < 0) continue;
        const o = p.poles[pole.next]!;
        expect(o.street).toBe(pole.street);
        gaps.push(Math.hypot(o.x - pole.x, o.z - pole.z));
      }
      // One side of the street for each.
      for (const s of plan.streets) {
        const mine = p.poles.filter((x) => x.street === s.id);
        if (mine.length < 2) continue;
        const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
        const side = mine.map((x) => Math.sign(-(x.x - s.a.x) * (s.b.z - s.a.z) / len + (x.z - s.a.z) * (s.b.x - s.a.x) / len));
        expect(new Set(side).size, `seed ${seed}: ${s.name}'s poles stand on both sides`).toBe(1);
        // At or beyond the curb's back (the roadway's edge, plus the curb's width) and inside the right of way.
        for (const x of mine) {
          const lat = Math.abs(-(x.x - s.a.x) * (s.b.z - s.a.z) / len + (x.z - s.a.z) * (s.b.x - s.a.x) / len);
          expect(lat, `seed ${seed}: ${s.name} pole in the roadway`).toBeGreaterThan(s.roadway / 2 + 0.2);
          expect(lat, `seed ${seed}: ${s.name} pole outside the right of way`).toBeLessThan(s.width / 2 + 1);
        }
      }
      // The service drops land on buildings, from poles of their street.
      for (const d of p.drops) {
        expect(p.poles[d.pole]).toBeDefined();
        expect(plan.buildings[d.building]).toBeDefined();
      }
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(35);
    expect(median).toBeLessThanOrEqual(46);
    expect(gaps[Math.floor(gaps.length * 0.1)]!).toBeGreaterThan(20);
  });

  it("does not give two neighbouring lots the same set", () => {
    for (const seed of PROP_SEEDS) {
      const { plan } = townFor(seed);
      const sig = signatures(plan.props, plan.lots.length);
      // Neighbours: two lots of one block whose polygons share a corner within a hand.
      for (const a of plan.lots) {
        for (const b of plan.lots) {
          if (b.id <= a.id || a.block !== b.block) continue;
          const touch = a.polygon.filter((p) => b.polygon.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.7)).length;
          if (touch < 2) continue;
          const sa = sig[a.id]!;
          const sb = sig[b.id]!;
          if (sa.length === 0) continue;
          expect(sa.join("|") === sb.join("|"), `seed ${seed}: lots ${a.id} and ${b.id} carry the same set`).toBe(false);
        }
      }
    }
  });

  it("parks more cars outside the open businesses that draw them than along vacant fronts", () => {
    let nearOpen = 0;
    let lenOpen = 0;
    let nearVacant = 0;
    let lenVacant = 0;
    for (const seed of PROP_SEEDS) {
      const { plan } = townFor(seed);
      const curb = plan.props.vehicles.filter((v) => v.spot === "curb");
      for (const b of plan.buildings) {
        const u = plan.uses[b.id];
        if (b.lot < 0 || b.kind === "house" || b.kind === "pier" || u === undefined) continue;
        const lot = plan.lots[b.lot]!;
        if (lot.district !== "core") continue;
        const open = b.state === "open" && u.units.some((x) => x.state === "open" && x.tenant !== null && ["diner", "tavern", "restaurant", "grocery", "pizza and burgers"].includes(x.tenant.trade));
        const vacant = b.state !== "open";
        if (!open && !vacant) continue;
        const n = curb.filter((v) => Math.hypot(v.x - b.centre.x, v.z - b.centre.z) < 20).length;
        if (open) {
          nearOpen += n;
          lenOpen++;
        } else {
          nearVacant += n;
          lenVacant++;
        }
      }
    }
    expect(lenOpen).toBeGreaterThan(5);
    expect(lenVacant).toBeGreaterThan(5);
    expect(nearOpen / lenOpen).toBeGreaterThan((nearVacant / lenVacant) * 1.25);
  });

  it("explains each vehicle: dead ones lie in neglected yards, and none stands on a lot of a state that cannot hold it", () => {
    let dead = 0;
    let deadInTidy = 0;
    for (const seed of PROP_SEEDS) {
      const { plan } = townFor(seed);
      for (const v of plan.props.vehicles) {
        if (v.state === "project") expect(["yard"]).toContain(v.spot);
        if (v.state !== "derelict" || v.lot < 0) continue;
        dead++;
        if (plan.yards[v.lot]!.kind === "mown") deadInTidy++;
        expect(["yard", "drive", "lot"]).toContain(v.spot);
      }
    }
    expect(dead).toBeGreaterThan(10);
    expect(deadInTidy / dead).toBeLessThan(0.1);
  });

  it("puts mailboxes only where there is no sidewalk, and fences inside their lot", () => {
    for (const seed of PROP_SEEDS.slice(0, 10)) {
      const { plan } = townFor(seed);
      for (const m of plan.props.mailboxes) {
        const lot = plan.lots[m.lot]!;
        void lot;
        // On the street's side that has no poured walk where the box stands.
        let ok = false;
        for (const s of plan.streets) {
          if (!grid(s)) continue;
          const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
          const sc = ((m.x - s.a.x) * (s.b.x - s.a.x) + (m.z - s.a.z) * (s.b.z - s.a.z)) / len;
          const lat = (-(m.x - s.a.x) * (s.b.z - s.a.z) + (m.z - s.a.z) * (s.b.x - s.a.x)) / len;
          if (sc < 0 || sc > len || Math.abs(lat) > s.width / 2 + 0.5 || Math.abs(lat) < s.roadway / 2) continue;
          const e = (plan.edges[s.id] as StreetEdge).sides[lat > 0 ? 0 : 1];
          if (e.runs.length === 0) ok = true;
        }
        expect(ok, `seed ${seed}: mailbox ${m.id} stands where there is a sidewalk`).toBe(true);
      }
      for (const f of plan.props.fences) {
        const lot = plan.lots[f.lot]!;
        for (const [x, z] of [[f.ax, f.az], [f.bx, f.bz]] as const) {
          const inside = lot.polygon.length > 2 && insidePoly(lot.polygon, x, z, 0.05);
          expect(inside, `seed ${seed}: fence ${f.id} leaves lot ${f.lot}`).toBe(true);
        }
      }
    }
  });

  it("keeps the painted stalls' constants where the ground draws them", async () => {
    const text = (await import("node:fs")).readFileSync(new URL("../../src/game/town/groundGeometry.ts", import.meta.url), "utf8");
    for (const [name, value] of [["STALL_LENGTH", STALL_LENGTH], ["STALL_PITCH", STALL_PITCH], ["STALL_SETBACK", STALL_SETBACK], ["STALL_CLEAR", STALL_CLEAR]] as const) {
      expect(text).toContain(`export const ${name} = ${value};`);
    }
  });
});

function insidePoly(poly: readonly { x: number; z: number }[], x: number, z: number, tol: number): boolean {
  // The polygon may wind either way: it is inside when the point is on one side of every edge.
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const c = (ex * (z - a.z) - ez * (x - a.x)) / Math.hypot(ex, ez);
    if (c > tol) pos++;
    else if (c < -tol) neg++;
  }
  return pos === 0 || neg === 0;
}

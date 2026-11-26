/**
 * The town's lamps: what each street lamp is (dead, the old orange-yellow of sodium, or a newer white fixture), when it comes on, where its
 * lens is in the world, and the list of every lamp the town has for the light it throws (`lampLight.ts`). A street lamp is a utility pole's
 * arm (`Pole.light`, `props/poleGeometry.ts`); the harbour's lights are the plan's (`Light`, `harbourGeometry.ts`): the headlands' and the longest
 * pier's, and a working port's lamps along the piers and quay, on the floats and at the yards (`workLook`, `workLensAt`: about one in ten dead,
 * most the old orange-yellow, some white, the floods strong and long, the float lights dim and short). A lit boat's cabin and each open shop's
 * window throw a little light too (a shop's only while its unit is open: `Lamp.hours`). Nothing here is in the
 * simulation: which lamp is dead or white is the drawing's, from the pole's own seed, so the plan is the same for every kind.
 *
 * About one lamp in twelve is dead (never lights) and one in five of the rest is white; each lamp's on-step is its own (a photocell
 * comes on a few minutes before or after its neighbour), from just before dusk to about half an hour after; all stay on until dawn.
 */
import { DECK_TOP, FLOAT_TOP } from "../../../sim/town/levels.js";
import type { Light, Pole } from "../../../sim/town/types.js";
import { UNTIL_DAWN, nightCode, unitHours, type Hours } from "../hours.js";
import type { Trade } from "../../../sim/town/types.js";
import type { Lamp } from "../lampLight.js";
import type { Rgb } from "../meshBuilder.js";
import type { TownGround } from "../townTypes.js";
import { boatCabin, CABIN_LIGHT } from "../boatGeometry.js";
import { buildingLevels } from "../buildingGeometry.js";
import { PORCH, porchCode } from "../windowNight.js";
import { rnd } from "./kit.js";

export type LampKind = "dead" | "sodium" | "white";

/** The colour of a lens's glass and of its light, by kind. */
export const LAMP_COLOUR: Readonly<Record<LampKind, Rgb>> = { dead: [0.34, 0.36, 0.37], sodium: [1, 0.58, 0.2], white: [0.86, 0.93, 1] };
/** How far a street lamp's light reaches, metres, and how bright it is against another. */
export const STREET_RANGE = 24;
/** How far above the head's underside the lens hangs, metres. */
export const LENS_DROP = 0.07;
/** How bright a lens glows (a glow of 1 or more is a lamp's lens: `townMaterial.ts`, `HOURS_CODE`). */
export const LENS_GLOW = 1.5;

/** What a street lamp on `seed`'s pole is. */
export function lampKind(seed: number): LampKind {
  if (rnd(seed, 61) < 1 / 12) return "dead";
  return rnd(seed, 62) < 0.2 ? "white" : "sodium";
}

/** The night code of the street lamp on `seed`'s pole: on at its own step from dusk to half an hour after, off at dawn. */
export function lampCode(seed: number): number {
  return nightCode(6 + Math.floor(rnd(seed, 63) * 8), UNTIL_DAWN);
}

/** Where a pole's lens is, in the world: under the head the arm carries (the arm and the head are drawn in `poleGeometry.ts` from the same numbers). */
export function lensAt(g: TownGround, p: Pole): { x: number; y: number; z: number; ux: number; uz: number } | null {
  if (p.light === null) return null;
  const wx = g.anchor.x + p.x;
  const wz = g.anchor.z + p.z;
  const gh = g.heightAt(wx, wz) - 0.1;
  const top = p.height;
  const t = (top - 0.7) / p.height;
  const bx = wx + p.lx * t * t;
  const bz = wz + p.lz * t * t;
  const x = bx + p.light.ox * 2.75;
  const z = bz + p.light.oz * 2.75;
  return { x, y: gh + top - 0.52 - LENS_DROP, z, ux: p.light.ox, uz: p.light.oz };
}

/** The harbour light's lantern and the pier light's: when they shine, their colour, and how far and how bright their light is thrown. */
export const HARBOUR_LAMP = { code: nightCode(6, UNTIL_DAWN), colour: [1, 0.95, 0.8] as Rgb, range: 40, strength: 1.2 };
export const PIER_LAMP = { code: nightCode(8, UNTIL_DAWN), colour: [1, 0.8, 0.55] as Rgb, range: 16, strength: 0.8 };

/** A shop's window light: out from the glass, above head height, reaching 8 m; on from dusk to dawn while the unit is open (`Lamp.hours`). Warm for the trades that light a room by lamps (a tavern, a restaurant, a lobby), a cool white for the rest. */
export const SHOP_OUT = 0.5;
export const SHOP_HEIGHT = 2.3;
export const SHOP_RANGE = 8;
export const SHOP_STRENGTH = 0.85;
export const SHOP_CODE = nightCode(6, UNTIL_DAWN);
const SHOP_WARM: readonly Trade[] = ["tavern", "restaurant", "hotel", "motel", "lodge", "rooming house"];
const SHOP_WARM_COLOUR: Rgb = [1, 0.8, 0.52];
const SHOP_COOL_COLOUR: Rgb = [0.84, 0.92, 1];

/** The kinds of the plan's `Light` that are a working port's lamps (the other three are the headlands' and the longest pier's). */
export type WorkKind = "pier lamp" | "quay lamp" | "float light" | "flood mast" | "yard light";
export const isWorkKind = (k: Light["kind"]): k is WorkKind => k === "pier lamp" || k === "quay lamp" || k === "float light" || k === "flood mast" || k === "yard light";

/** What a working lamp is, from its drawn seed: dead about one in ten (a flood mast never: it has heads to spare), old orange-yellow or, one in four, a newer white. */
export type WorkLook = { readonly dead: boolean; readonly colour: Rgb; readonly range: number; readonly strength: number; readonly code: number };
const FLOAT_COLOUR: Rgb = [0.78, 0.88, 1];
const FLOOD_COLOUR: Rgb = [1, 0.97, 0.9];
export function workLook(l: Light): WorkLook {
  const seed = l.seed ?? 0;
  const code = lampCode(seed);
  const dead = l.kind !== "flood mast" && rnd(seed, 71) < 0.1;
  const white = rnd(seed, 72) < 0.25;
  const warm = white ? LAMP_COLOUR.white : LAMP_COLOUR.sodium;
  switch (l.kind) {
    case "float light": return { dead, colour: FLOAT_COLOUR, range: 6, strength: 0.4, code };
    case "flood mast": return { dead, colour: FLOOD_COLOUR, range: 45, strength: 2.2, code };
    case "quay lamp": return { dead, colour: warm, range: 22, strength: 1, code };
    case "yard light": return { dead, colour: warm, range: 22, strength: 1.1, code };
    default: return { dead, colour: warm, range: 18, strength: 0.9, code };
  }
}

/** How far a working lamp's arm reaches from its post toward `dx, dz`, metres: the lens hangs at its end (a pier lamp's, a quay lamp's, a yard light's; a flood's heads are on a bar at the top). */
export const WORK_ARM: Readonly<Record<WorkKind, number>> = { "pier lamp": 0.55, "quay lamp": 1, "float light": 0, "flood mast": 0.5, "yard light": 0.7 };

/** Where a working lamp's lens is in the world, and the way its arm or its heads face. A deck's lamp stands on the deck's top, a float's on the float's, the rest on the ground. */
export function workLensAt(g: TownGround, l: Light & { kind: WorkKind }): { x: number; y: number; z: number; dx: number; dz: number; base: number } {
  const x = g.anchor.x + l.x;
  const z = g.anchor.z + l.z;
  const base = l.kind === "pier lamp" || l.kind === "quay lamp" ? DECK_TOP : l.kind === "float light" ? FLOAT_TOP : g.heightAt(x, z);
  const dx = l.dx ?? 0;
  const dz = l.dz ?? 0;
  const arm = WORK_ARM[l.kind];
  const drop = l.kind === "float light" ? 0.15 : l.kind === "flood mast" ? 0 : 0.63;
  return { x: x + dx * arm, y: base + l.height - drop, z: z + dz * arm, dx, dz, base };
}

/** The light a harbour light throws, from the middle of its lantern (a day beacon has none). */
function harbourLamp(g: TownGround, l: Light): Lamp | null {
  if (l.kind === "day beacon") return null;
  if (isWorkKind(l.kind)) {
    const look = workLook(l);
    if (look.dead) return null;
    const at = workLensAt(g, l as Light & { kind: WorkKind });
    return { x: at.x, y: at.y, z: at.z, r: look.colour[0], g: look.colour[1], b: look.colour[2], range: look.range, strength: look.strength, code: look.code };
  }
  const x = g.anchor.x + l.x;
  const z = g.anchor.z + l.z;
  const y = l.kind === "pier light" ? 2.6 : Math.max(g.heightAt(x, z), 0.5) - 0.4;
  const top = l.kind === "pier light" ? y + l.height - 0.45 : y + l.height + 1.45;
  const k = l.kind === "pier light" ? PIER_LAMP : HARBOUR_LAMP;
  return { x, y: top, z, r: k.colour[0], g: k.colour[1], b: k.colour[2], range: k.range, strength: k.strength, code: k.code };
}

/** Every lamp the town has, for the light they throw: the street lamps that are not dead, and the harbour's lights that shine. */
export function lampSites(g: TownGround): Lamp[] {
  const out: Lamp[] = [];
  for (const p of g.plan.props.poles) {
    const lens = lensAt(g, p);
    if (lens === null) continue;
    const kind = lampKind(p.seed);
    if (kind === "dead") continue;
    const c = LAMP_COLOUR[kind];
    out.push({ x: lens.x, y: lens.y, z: lens.z, r: c[0], g: c[1], b: c[2], range: STREET_RANGE, strength: kind === "white" ? 0.95 : 1, code: lampCode(p.seed) });
  }
  for (const l of g.plan.harbour.lights) {
    const h = harbourLamp(g, l);
    if (h !== null) out.push(h);
  }
  // A lit cabin throws a little light on its hull, the deck and the pier beside it (the sea is the engine's and takes none).
  for (const b of g.plan.harbour.boats) {
    const cabin = boatCabin(b);
    if (cabin === null) continue;
    const lx = (cabin.along - 0.5) * b.length;
    out.push({ x: g.anchor.x + b.x + b.heading.x * lx, y: b.length * 0.05 * 0.74 + 0.4 * 0.74 + 1.5, z: g.anchor.z + b.z + b.heading.z * lx, r: CABIN_LIGHT[0], g: CABIN_LIGHT[1], b: CABIN_LIGHT[2], range: 7, strength: 0.5, code: cabin.code });
  }
  // An open shop throws light on its sidewalk: a lamp outside the glass at the middle of the window, on while the unit is open and it is dark.
  for (const b of g.plan.buildings) {
    const use = g.plan.uses[b.id];
    if (use === undefined || use.units.length === 0 || b.front === null) continue;
    const lit = use.units.filter((u) => u.state === "open" && u.interior.type !== undefined && unitHours(b, u) !== null && u.openings.some((o) => o.cover !== "bricked" && o.cover !== "boarded"));
    if (lit.length === 0) continue;
    const lv = buildingLevels(g, b);
    if (lv.xf === null) continue;
    for (const u of lit) {
      const hours = unitHours(b, u) as Hours;
      const glass = u.openings.filter((o) => o.cover !== "bricked" && o.cover !== "boarded");
      const s = (Math.min(...glass.map((o) => Math.min(o.s0, o.s1))) + Math.max(...glass.map((o) => Math.max(o.s0, o.s1)))) / 2;
      const c = SHOP_WARM.includes(u.tenant?.trade ?? "diner") ? SHOP_WARM_COLOUR : SHOP_COOL_COLOUR;
      out.push({
        x: lv.xf.ox + lv.xf.tx * s + lv.xf.nx * SHOP_OUT, y: lv.frontFloorY + SHOP_HEIGHT, z: lv.xf.oz + lv.xf.tz * s + lv.xf.nz * SHOP_OUT,
        r: c[0], g: c[1], b: c[2], range: SHOP_RANGE, strength: SHOP_STRENGTH, code: SHOP_CODE, hours,
      });
    }
  }
  for (const b of g.plan.buildings) {
    const use = g.plan.uses[b.id];
    const porch = porchCode(b, use);
    if (porch === null || use === undefined || use.door === null || b.front === null) continue;
    const lv = buildingLevels(g, b);
    if (lv.xf === null) continue;
    // The light stands by the door on the wall's own tangent's side (`openingsGeometry.ts`): the front wall's direction against the frame's.
    const fs = lv.sides[lv.frontAt] as (typeof lv.sides)[number];
    const [ax, az] = lv.corner(fs[0], fs[1]);
    const [bx, bz] = lv.corner(fs[2], fs[3]);
    const sign = (bx - ax) * lv.xf.tx + (bz - az) * lv.xf.tz >= 0 ? 1 : -1;
    const s = use.door.s + porch.side * sign * (use.door.width / 2 + PORCH.beside);
    out.push({
      x: lv.xf.ox + lv.xf.tx * s + lv.xf.nx * (PORCH.out / 2), y: lv.frontFloorY + PORCH.height - 0.04, z: lv.xf.oz + lv.xf.tz * s + lv.xf.nz * (PORCH.out / 2),
      r: PORCH.colour[0], g: PORCH.colour[1], b: PORCH.colour[2], range: PORCH.range, strength: PORCH.strength, code: porch.code,
    });
  }
  return out;
}

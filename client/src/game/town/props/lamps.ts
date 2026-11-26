/**
 * The town's lamps: what each street lamp is (dead, the old orange-yellow of sodium, or a newer white fixture), when it comes on, where its
 * lens is in the world, and the list of every lamp the town has for the light it throws (`lampLight.ts`). A street lamp is a utility pole's
 * arm (`Pole.light`, `props/poleGeometry.ts`); the harbour's lights are the plan's (`Light`, `harbourGeometry.ts`). Nothing here is in the
 * simulation: which lamp is dead or white is the drawing's, from the pole's own seed, so the plan is the same for every kind.
 *
 * About one lamp in twelve is dead (never lights) and one in five of the rest is white; each lamp's on-step is its own (a photocell
 * comes on a few minutes before or after its neighbour), from just before dusk to about half an hour after; all stay on until dawn.
 */
import type { Light, Pole } from "../../../sim/town/types.js";
import { UNTIL_DAWN, nightCode } from "../hours.js";
import type { Lamp } from "../lampLight.js";
import type { Rgb } from "../meshBuilder.js";
import type { TownGround } from "../townTypes.js";
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

/** The light a harbour light throws, from the middle of its lantern (a day beacon has none). */
function harbourLamp(g: TownGround, l: Light): Lamp | null {
  if (l.kind === "day beacon") return null;
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

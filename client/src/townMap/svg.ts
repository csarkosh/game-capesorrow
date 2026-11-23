/**
 * Draws a town plan as an SVG document. A pure function of a plan and its site: the map page and the
 * contact-sheet test both use it. Not simulation code (it may use any maths); it is for looking.
 *
 * North is up and the sea is to the left, as in the plan's own frame: x to the right, z up.
 */
import type { Building, BuildingKind, District, JunctionKind, Street, StreetKind, TownPlan } from "../sim/town/types.js";
import type { TownSite } from "../sim/town/site.js";
import { LAND_SLOPE, landOf } from "../sim/town/land.js";
import { bayOf } from "../sim/town/blend.js";
import { RAIL_CORRIDOR_HALF, RAIL_OFFSET } from "../sim/town/rail.js";
import { hasPavement, stopSignSpot } from "../sim/town/junctions.js";
import { onLeg, pavementPolygon } from "../sim/town/junctionShape.js";
import { polesIn } from "../sim/town/powerLine.js";

export type SvgOptions = {
  /** The drawing's width in pixels (its height follows). */
  readonly width?: number;
  /** Draw the lots' lines. */
  readonly lots?: boolean;
  /** Which labels: every landmark, the FBI office alone, or none. */
  readonly labels?: "all" | "fbi" | "none";
  /** Draw the scale bar and north arrow. */
  readonly furniture?: boolean;
  /** Draw the plan's frame only (no outer margin), for thumbnails. */
  readonly bare?: boolean;
  /** Pad the drawing to a square, the town centred in it (for a viewer that crops a tall picture). */
  readonly square?: boolean;
  /** The world's seed: with it the power line's poles are drawn. */
  readonly seed?: number;
  /** Shade the land under the town: the buildable ground, and the steep (default: shaded). */
  readonly land?: boolean;
};

/** How the land is shaded: buildable ground, ground that is gentle but held out (the highway, the rail's corridor, a headland, too low), steep ground, and very steep ground. */
export const LAND_SHADE = { buildable: "#2f6a3a", held: "#5a5a2a", steep: "#5a3a26", cliff: "#3a2018" } as const;

export const DISTRICT_FILL: Record<District, string> = {
  core: "#c9a45a",
  dock: "#b5603c",
  waterfront: "#5f8aa0",
  mill: "#8a62a0",
  "mill housing": "#7f8f4c",
  residential: "#466a46",
  "highway strip": "#a04f78",
  civic: "#4f75c0",
  industrial: "#77797c",
  outskirts: "#7a8a52",
};

export const STREET_STROKE: Record<StreetKind, string> = {
  highway: "#9a8d72",
  avenue: "#6d7378",
  main: "#7d8084",
  street: "#4a4e52",
  alley: "#33373a",
  wharf: "#7a6240",
  rail: "#bdbdbd",
  stair: "#f0e8c8",
};

const KIND_FILL: Partial<Record<BuildingKind, string>> & { default: string } = {
  storefront: "#ecdcaa",
  tavern: "#e09070",
  "boarding house": "#d8a080",
  office: "#d8d8c0",
  bank: "#f0e0a0",
  hotel: "#f0b858",
  "lodge hall": "#c8b0e0",
  house: "#cfc8b8",
  apartment: "#bfb7a6",
  warehouse: "#a2adb6",
  "mill shed": "#b890cc",
  cannery: "#7cc0d0",
  "port terminal shed": "#6aa4de",
  silo: "#b0c0d0",
  garage: "#98a0a8",
  "gas station": "#e07aa8",
  motel: "#d870a0",
  restaurant: "#e890b8",
  "fire hall": "#e05050",
  "shake mill": "#c09060",
  junkyard: "#8a8078",
  "big-box store": "#c05088",
  church: "#f4f4f4",
  school: "#78a8f0",
  hospital: "#f08080",
  courthouse: "#a0c0f0",
  "federal building": "#5cc8ff",
  "tsunami refuge": "#60e0b0",
  depot: "#d0a060",
  "customs house": "#b0d0a0",
  pier: "#7c5e3c",
  default: "#cccccc",
};

/** The pavement of each kind of junction on the map. */
export const JUNCTION_FILL: Readonly<Record<JunctionKind, string>> = {
  "four-way": "#f0f0f0",
  bend: "#b8b8b8",
  tee: "#7fc8ff",
  skew: "#ff6adf",
  highway: "#ffb060",
  alley: "#c8b888",
  "road end": "#b09a68",
  stair: "#c0c0c0",
  rail: "#ff9a30",
};

export function buildingFill(kind: BuildingKind): string {
  return KIND_FILL[kind] ?? KIND_FILL.default;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function f(n: number): string {
  return r2(n).toString();
}

/** The corners of a building's footprint. */
export function footprint(b: Building): { x: number; z: number }[] {
  const ux = b.bearing.a / b.bearing.c;
  const uz = b.bearing.b / b.bearing.c;
  const vx = uz;
  const vz = -ux;
  const out: { x: number; z: number }[] = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    out.push({ x: b.centre.x + ux * b.halfAlong * su + vx * b.halfAcross * sv, z: b.centre.z + uz * b.halfAlong * su + vz * b.halfAcross * sv });
  }
  return out;
}

/** Everything of the plan's extent worth drawing: the plan's bounds, padded, and the whole shoreline within them. */
function view(plan: TownPlan, site: TownSite): { x0: number; z0: number; x1: number; z1: number } {
  const pad = 90;
  // The town's own extent: its blocks and the water side of the quay (the highway runs the whole site and is not part of it).
  const pts = [...plan.blocks.flatMap((bl) => bl.polygon), ...plan.fill.flatMap((fl) => fl.polygon), ...plan.woods.flatMap((w) => w.polygon), plan.quay.a, plan.quay.b];
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  for (const p of pts) {
    bx0 = Math.min(bx0, p.x);
    bz0 = Math.min(bz0, p.z);
    bx1 = Math.max(bx1, p.x);
    bz1 = Math.max(bz1, p.z);
  }
  const b = { x0: bx0, z0: bz0, x1: bx1, z1: bz1 };
  let x0 = b.x0 - pad;
  const x1 = b.x1 + pad;
  // Include some sea on the left, so that the shoreline is seen to be a shore.
  x0 = Math.min(x0, Math.min(...site.shoreX) - 60);
  // The roads out run beyond the plan: the view reaches their destinations.
  let x1r = x1;
  let z0r = b.z0 - pad;
  let z1r = b.z1 + pad;
  for (const road of plan.roads) {
    x1r = Math.max(x1r, road.destination.x + pad);
    z0r = Math.min(z0r, road.destination.z - pad);
    z1r = Math.max(z1r, road.destination.z + pad);
  }
  return { x0, z0: z0r, x1: x1r, z1: z1r };
}

/** The colour a boat is drawn in: by kind, faded for a derelict, black for a sunk one. */
export const BOAT_FILL: Record<string, string> = {
  troller: "#4fb0e8",
  gillnetter: "#f0a030",
  crabber: "#e05a4a",
  tug: "#f0e060",
  skiff: "#c8c8c8",
  sailboat: "#ffffff",
  pleasure: "#d890f0",
};

function harbourSvg(plan: TownPlan, out: string[], X: (x: number) => number, Y: (z: number) => number): void {
  const h = plan.harbour;
  const P = (p: { x: number; z: number }): string => `${X(p.x)},${Y(p.z)}`;
  const rect = (c: { x: number; z: number }, ax: { x: number; z: number }, hA: number, hB: number): string => {
    const bx = ax.z;
    const bz = -ax.x;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => P({ x: c.x + ax.x * hA * a! + bx * hB * b!, z: c.z + ax.z * hA * a! + bz * hB * b! })).join(" ");
  };
  // The quay's apron, floats and gangways.
  for (const d of plan.decks) {
    if (d.kind === "float") out.push(`<polygon points="${rect(d.centre, d.axis, d.halfAlong, d.halfAcross)}" fill="#a88a5a" stroke="#2a2014" stroke-width="0.3"/>`);
    else if (d.kind === "gangway") out.push(`<polygon points="${rect(d.centre, d.axis, d.halfAlong, d.halfAcross)}" fill="#d8c090" stroke="#2a2014" stroke-width="0.3"/>`);
    else if (d.kind === "apron") out.push(`<polygon points="${rect(d.centre, d.axis, d.halfAlong, d.halfAcross)}" fill="#9a9a90" fill-opacity="0.8"/>`);
  }
  // The mill's pond: its boom as a dashed line, its logs, the jack ladder; and the burner.
  if (h.logPond !== null) {
    const p = h.logPond;
    out.push(`<polygon points="${rect(p.centre, { x: 0, z: 1 }, p.halfZ, p.halfX)}" fill="#1c3a40" fill-opacity="0.5" stroke="#c8a060" stroke-width="0.8" stroke-dasharray="3 2"/>`);
    for (const l of p.logs) out.push(`<line x1="${X(l.x - l.heading.x * l.length / 2)}" y1="${Y(l.z - l.heading.z * l.length / 2)}" x2="${X(l.x + l.heading.x * l.length / 2)}" y2="${Y(l.z + l.heading.z * l.length / 2)}" stroke="#7a5a32" stroke-width="${f(l.radius * 2)}"/>`);
    for (const q of p.piles) out.push(`<circle cx="${X(q.x)}" cy="${Y(q.z)}" r="0.7" fill="#d8c8a0"/>`);
    if (p.jackLadder) out.push(`<line x1="${X(p.jackLadder.a.x)}" y1="${Y(p.jackLadder.a.z)}" x2="${X(p.jackLadder.b.x)}" y2="${Y(p.jackLadder.b.z)}" stroke="#e8d098" stroke-width="2"/>`);
  }
  if (h.burner) out.push(`<circle cx="${X(h.burner.x)}" cy="${Y(h.burner.z)}" r="${h.burner.radius}" fill="#a0502a" fill-opacity="0.7" stroke="#e08040" stroke-width="0.8"/>`);
  // Dead pilings and dolphins.
  for (const field of h.pilings) for (const q of field.piles) out.push(`<circle cx="${X(q.x)}" cy="${Y(q.z)}" r="0.55" fill="#b0a890"/>`);
  for (const q of h.dolphins) out.push(`<circle cx="${X(q.x)}" cy="${Y(q.z)}" r="0.5" fill="#e8d098"/>`);
  // The terminal's yard and barge.
  if (h.terminal) {
    for (const y of h.terminal.yard) out.push(`<rect x="${X(y.x - y.halfX)}" y="${Y(y.z + y.halfZ)}" width="${f(y.halfX * 2)}" height="${f(y.halfZ * 2)}" fill="#6aa4de" fill-opacity="0.45" stroke="#c0e0ff" stroke-width="0.5"/>`);
    const b = h.terminal.barge;
    if (b) out.push(`<polygon points="${rect(b, b.heading, b.length / 2, b.beam / 2)}" fill="#8a8a92" stroke="#f0f0f0" stroke-width="0.5"/>`);
  }
  // Boats.
  for (const b of h.boats) {
    const fill = b.state === "working" ? (BOAT_FILL[b.kind] ?? "#cccccc") : b.state === "derelict" ? "#7a7066" : "#2a2a2a";
    out.push(`<polygon points="${rect(b, b.heading, b.length / 2, b.beam / 2)}" fill="${fill}" stroke="${b.state === "working" ? "#101010" : "#d04040"}" stroke-width="0.4"/>`);
  }
  // Lights.
  for (const l of h.lights) out.push(`<circle cx="${X(l.x)}" cy="${Y(l.z)}" r="3" fill="${l.kind === "harbour light" ? "#ffffff" : l.kind === "day beacon" ? "#e04040" : "#ffe070"}" stroke="#101010" stroke-width="0.6"/>`);
}

/** The land's cells as runs along z, by class (buildable, held out, steep, very steep), clipped to the view. */
function landSvg(site: TownSite, v: { x0: number; z0: number; x1: number; z1: number }, out: string[], X: (x: number) => number, Y: (z: number) => number): void {
  const land = landOf(site);
  const st = land.step;
  const ix0 = Math.max(0, Math.floor((v.x0 - land.x0) / st));
  const ix1 = Math.min(land.nx - 1, Math.ceil((v.x1 - land.x0) / st));
  const iz0 = Math.max(0, Math.floor((v.z0 - land.z0) / st));
  const iz1 = Math.min(land.nz - 1, Math.ceil((v.z1 - land.z0) / st));
  const classOf = (k: number): keyof typeof LAND_SHADE | null => {
    if ((land.h[k] as number) <= 0) return null;
    if (land.ok[k] === 1) return "buildable";
    const s = land.slope[k] as number;
    if (s <= LAND_SLOPE) return "held";
    return s <= 0.3 ? "steep" : "cliff";
  };
  const runs: Record<keyof typeof LAND_SHADE, string[]> = { buildable: [], held: [], steep: [], cliff: [] };
  for (let ix = ix0; ix <= ix1; ix++) {
    let start = -1;
    let cls: keyof typeof LAND_SHADE | null = null;
    const flush = (end: number): void => {
      if (cls === null || start < 0) return;
      const x = land.x0 + ix * st - st / 2;
      const z0 = land.z0 + start * st - st / 2;
      const z1 = land.z0 + end * st - st / 2;
      runs[cls].push(`<rect x="${X(x)}" y="${Y(z1)}" width="${st}" height="${r2(z1 - z0)}"/>`);
    };
    for (let iz = iz0; iz <= iz1 + 1; iz++) {
      const c = iz > iz1 ? null : classOf(ix * land.nz + iz);
      if (c !== cls) {
        flush(iz);
        cls = c;
        start = iz;
      }
    }
  }
  for (const k of ["steep", "cliff", "held", "buildable"] as const) {
    if (runs[k].length > 0) out.push(`<g fill="${LAND_SHADE[k]}" fill-opacity="${k === "buildable" ? 0.75 : 0.85}">${runs[k].join("")}</g>`);
  }
}

export function planSvg(plan: TownPlan, site: TownSite, options: SvgOptions = {}): string {
  const v = view(plan, site);
  const W = v.x1 - v.x0;
  const H = v.z1 - v.z0;
  const px = options.width ?? 1200;
  const pxH = Math.round((px * H) / W);
  const X = (x: number): number => r2(x - v.x0);
  const Y = (z: number): number => r2(v.z1 - z);
  const pt = (p: { x: number; z: number }): string => `${X(p.x)},${Y(p.z)}`;
  const poly = (ps: readonly { x: number; z: number }[]): string => ps.map(pt).join(" ");
  const out: string[] = [];
  const M = Math.max(W, H);
  const box = options.square ? `${f((W - M) / 2)} ${f((H - M) / 2)} ${f(M)} ${f(M)}` : `0 0 ${f(W)} ${f(H)}`;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${px}" height="${options.square ? px : pxH}" font-family="ui-monospace, monospace">`);
  out.push(`<title>${esc(plan.name)}</title>`);
  out.push(
    `<defs><pattern id="vacant" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" fill="#2a2a2e"/><line x1="0" y1="0" x2="0" y2="3" stroke="#e8c050" stroke-width="1.2"/></pattern>` +
      `<pattern id="ruin" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="3" height="3" fill="#1a0e0e"/><line x1="0" y1="0" x2="0" y2="3" stroke="#d04040" stroke-width="1.2"/></pattern></defs>`,
  );
  // The sea, then the land.
  out.push(`<rect width="${f(W)}" height="${f(H)}" fill="#0c1822"/>`);
  const shore: { x: number; z: number }[] = [];
  for (let i = 0; i < site.shoreX.length; i++) shore.push({ x: site.shoreX[i]!, z: site.z0 + i * site.step });
  // The shoreline runs on, straight, past the samples, so that the land fills the drawing.
  const land = [{ x: shore[0]!.x, z: v.z0 - 10 }, ...shore, { x: shore[shore.length - 1]!.x, z: v.z1 + 10 }];
  out.push(`<polygon points="${poly([...land, { x: v.x1, z: v.z1 + 10 }, { x: v.x1, z: v.z0 - 10 }])}" fill="#1c201b"/>`);
  out.push(`<polyline points="${poly(land)}" fill="none" stroke="#5fa8c8" stroke-width="2.2"/>`);

  // The land's own shape under the town: where the ground can be built on, and where it climbs too steeply.
  if (options.land !== false) landSvg(site, v, out, X, Y);

  // The made ground: fill the old plat stands on, drawn differently from natural land, and the quay.
  for (const f of plan.fill) out.push(`<polygon points="${poly(f.polygon)}" fill="#3a3a30" stroke="none"/>`);
  out.push(`<line x1="${X(plan.quay.a.x)}" y1="${Y(plan.quay.a.z)}" x2="${X(plan.quay.b.x)}" y2="${Y(plan.quay.b.z)}" stroke="#e8e0c8" stroke-width="2.4"/>`);

  // Plats' outlines.
  for (const p of plan.plats) out.push(`<polygon points="${poly(p.polygon)}" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1" stroke-dasharray="6 5"/>`);

  // Blocks.
  for (const b of plan.blocks) {
    out.push(`<polygon points="${poly(b.polygon)}" fill="${DISTRICT_FILL[b.district]}" fill-opacity="0.32" stroke="${DISTRICT_FILL[b.district]}" stroke-opacity="0.55" stroke-width="0.6"/>`);
  }
  // Lot lines.
  if (options.lots) for (const l of plan.lots) out.push(`<polygon points="${poly(l.polygon)}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="0.35"/>`);

  // Streets: widest first, so that the narrow ones lie over them.
  const order: Street[] = plan.streets.slice().sort((a, b) => b.width - a.width || a.id - b.id);
  for (const s of order) {
    const col = STREET_STROKE[s.kind];
    if (s.kind === "stair") {
      // A flight of steps: its right of way faintly, the steps as short bars across it.
      out.push(`<line x1="${X(s.a.x)}" y1="${Y(s.a.z)}" x2="${X(s.b.x)}" y2="${Y(s.b.z)}" stroke="#4a4e52" stroke-opacity="0.5" stroke-width="${s.width}"/>`);
      out.push(`<line x1="${X(s.a.x)}" y1="${Y(s.a.z)}" x2="${X(s.b.x)}" y2="${Y(s.b.z)}" stroke="${col}" stroke-width="${Math.max(s.roadway, 5)}" stroke-dasharray="1.2 1.2"/>`);
      continue;
    }
    out.push(`<line x1="${X(s.a.x)}" y1="${Y(s.a.z)}" x2="${X(s.b.x)}" y2="${Y(s.b.z)}" stroke="${col}" stroke-width="${s.width}"/>`);
  }
  // The sidewalks, side by side (`plan.edges`, `port/edges.ts`): each pour a cyan bar along its side of the street (the paler, the older its decade), a curb a thin white line at the roadway's edge, and a side with neither is left plain, so a street with a sidewalk on one side only, or none, shows.
  for (const s of plan.streets) {
    const e = plan.edges[s.id];
    if (e === undefined || (s.kind !== "street" && s.kind !== "main" && s.kind !== "avenue")) continue;
    const L = Math.sqrt((s.b.x - s.a.x) * (s.b.x - s.a.x) + (s.b.z - s.a.z) * (s.b.z - s.a.z));
    if (!(L > 0.1)) continue;
    const tx = (s.b.x - s.a.x) / L;
    const tz = (s.b.z - s.a.z) / L;
    const P = (d: number, t: number): [number, number] => [s.a.x + tx * d - tz * t, s.a.z + tz * d + tx * t];
    e.sides.forEach((side, k) => {
      const sg = k === 0 ? 1 : -1;
      if (side.curb) {
        const [x0, z0] = P(0, sg * (s.roadway / 2));
        const [x1, z1] = P(L, sg * (s.roadway / 2));
        out.push(`<line x1="${X(x0)}" y1="${Y(z0)}" x2="${X(x1)}" y2="${Y(z1)}" stroke="#ffffff" stroke-opacity="0.7" stroke-width="0.8"/>`);
      }
      for (const run of side.runs) {
        const t = sg * (s.width / 2 - side.walk / 2);
        const [x0, z0] = P(run.s0, t);
        const [x1, z1] = P(run.s1, t);
        const age = Math.min(1, Math.max(0, (run.decade - 1900) / 120));
        const g = Math.round(150 + 90 * age);
        out.push(`<line x1="${X(x0)}" y1="${Y(z0)}" x2="${X(x1)}" y2="${Y(z1)}" stroke="rgb(${Math.round(40 + 60 * age)},${g},255)" stroke-opacity="0.95" stroke-width="${Math.max(1.4, side.walk * 0.7)}"/>`);
      }
    });
  }
  // The made ends of streets: a gravel bulb for a turnaround, a red bar for a barricade, a blue one for a landing at the water.
  for (const e of plan.ends) {
    const nx = e.dz;
    const nz = -e.dx;
    const w = (plan.streets[e.street]?.roadway ?? 8) / 2;
    if (e.kind === "turnaround") out.push(`<circle cx="${X(e.x + e.dx * 7)}" cy="${Y(e.z + e.dz * 7)}" r="7" fill="#8a7a58" stroke="#c8b888" stroke-width="0.8"/>`);
    else out.push(`<line x1="${X(e.x + nx * w + e.dx)}" y1="${Y(e.z + nz * w + e.dz)}" x2="${X(e.x - nx * w + e.dx)}" y2="${Y(e.z - nz * w + e.dz)}" stroke="${e.kind === "barricade" ? "#d04040" : "#5fa8c8"}" stroke-width="3"/>`);
  }
  // The roads out: paved, gravel, and two wheel tracks, narrowing as they go, each to its destination.
  for (const road of plan.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const col = b.surface === "paved" ? "#7d8084" : b.surface === "gravel" ? "#b09a68" : "#8a5c34";
      const dash = b.surface === "tracks" ? ' stroke-dasharray="4 3"' : "";
      out.push(`<line x1="${X(a.x)}" y1="${Y(a.z)}" x2="${X(b.x)}" y2="${Y(b.z)}" stroke="${col}" stroke-width="${f((a.width + b.width) / 2)}" stroke-linecap="round"${dash}/>`);
    }
  }
  // The seam, emphasised.
  for (const sm of plan.seams) {
    out.push(`<line x1="${X(sm.a.x)}" y1="${Y(sm.a.z)}" x2="${X(sm.b.x)}" y2="${Y(sm.b.z)}" stroke="#ff8c2a" stroke-width="3" stroke-dasharray="14 6"/>`);
  }

  // The blocks the grid would have had that were left as woods: where the land would not bear them (rust), and where the budget ran out (green).
  for (const w of plan.woods) {
    const land = w.why === "land";
    out.push(`<polygon points="${poly(w.polygon)}" fill="${land ? "#6a3a1a" : "#2a5a2a"}" fill-opacity="0.35" stroke="${land ? "#d08848" : "#78b878"}" stroke-width="1.2" stroke-dasharray="5 4"/>`);
  }
  // The railroad's main line: its corridor (kept clear of every block, lot and building), the line, and where streets cross it at grade; and the town's own spur.
  {
    const zs = [v.z0, v.z1];
    const line: { x: number; z: number }[] = [];
    for (let i = 0; i < site.roadX.length; i++) {
      const z = site.z0 + i * site.step;
      if (z >= zs[0]! - 20 && z <= zs[1]! + 20) line.push({ x: site.roadX[i]! - RAIL_OFFSET, z });
    }
    if (line.length > 1) {
      out.push(`<polyline points="${poly(line)}" fill="none" stroke="#e0c040" stroke-opacity="0.22" stroke-width="${RAIL_CORRIDOR_HALF * 2}" stroke-linejoin="round"/>`);
      out.push(`<polyline points="${poly(line)}" fill="none" stroke="#f0e0a0" stroke-width="2" stroke-dasharray="7 3" stroke-linejoin="round"/>`);
    }
    for (const sp of plan.rail.spurs) {
      out.push(`<polyline points="${poly(sp.points)}" fill="none" stroke="#555" stroke-width="5" stroke-linejoin="round"/><polyline points="${poly(sp.points)}" fill="none" stroke="#e8e8e8" stroke-width="2.5" stroke-dasharray="8 3" stroke-linejoin="round"/>`);
      // A trestle where it crosses open water: a timber deck under the track.
      for (const r of sp.wet) out.push(`<polyline points="${poly(sp.points.slice(r.from, r.to + 1))}" fill="none" stroke="#a8743a" stroke-width="6" stroke-linejoin="round" stroke-opacity="0.9"/>`);
      // The turnout where it leaves the main line: a ring at its first point.
      const t = sp.points[0]!;
      out.push(`<circle cx="${X(t.x)}" cy="${Y(t.z)}" r="7" fill="none" stroke="#ffffff" stroke-width="1.6"/>`);
    }
    // The power line: a pole every 45 m or so beside the highway.
    if (options.seed !== undefined) for (const pl of polesIn(options.seed, v.z0 - 20, v.z1 + 20)) out.push(`<circle cx="${X(pl.x - site.anchor.x)}" cy="${Y(pl.z - site.anchor.z)}" r="1.6" fill="#c8b090" stroke="#201408" stroke-width="0.4"/>`);
    for (const c of plan.rail.crossings) out.push(`<rect x="${X(c.x) - 4}" y="${Y(c.z) - 4}" width="8" height="8" fill="#ff9a30" stroke="#201000" stroke-width="0.8"/>`);
  }

  // The junctions: each pavement in the colour of its kind, a marked crosswalk as a white bar across its leg, a STOP sign as a red dot where it stands, an all-way stop as a red ring, a leg closed with a planter as a green bar, a ramp-less corner outlined dashed.
  for (const j of plan.junctions) {
    if (j.kind === "alley") {
      const m = j.alley;
      if (m !== null) out.push(`<line x1="${X(m.x - m.dz * m.width * 0.5)}" y1="${Y(m.z + m.dx * m.width * 0.5)}" x2="${X(m.x + m.dz * m.width * 0.5)}" y2="${Y(m.z - m.dx * m.width * 0.5)}" stroke="${JUNCTION_FILL.alley}" stroke-width="2.4"/>`);
      continue;
    }
    if (!hasPavement(j)) continue;
    const shape = pavementPolygon(j.legs, j.corners);
    if (shape.length >= 3) out.push(`<polygon points="${poly(shape)}" fill="${JUNCTION_FILL[j.kind]}" fill-opacity="0.7" stroke="${j.ramps ? "none" : "#101010"}" stroke-width="0.8" stroke-dasharray="${j.ramps ? "none" : "2 2"}"/>`);
    for (const l of j.legs) {
      if (l.marked && !l.engine) {
        const a = onLeg(l, l.mouth + 1.5, -l.half);
        const b = onLeg(l, l.mouth + 1.5, l.half);
        out.push(`<line x1="${X(a.x)}" y1="${Y(a.z)}" x2="${X(b.x)}" y2="${Y(b.z)}" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="1.2 0.9"/>`);
      }
      const spot = stopSignSpot(l);
      if (l.stops && spot !== null) {
        const q = onLeg(l, spot.s, spot.lat);
        out.push(`<circle cx="${X(q.x)}" cy="${Y(q.z)}" r="2.6" fill="#d02020" stroke="#ffffff" stroke-width="0.7"/>`);
      }
    }
    for (const l of j.closed) {
      const a = onLeg(l, l.mouth + 0.4, -l.half);
      const b = onLeg(l, l.mouth + 0.4, l.half);
      out.push(`<line x1="${X(a.x)}" y1="${Y(a.z)}" x2="${X(b.x)}" y2="${Y(b.z)}" stroke="#3ad06a" stroke-width="2.6"/>`);
    }
    if (j.control === "all-way") out.push(`<circle cx="${X(j.x)}" cy="${Y(j.z)}" r="12" fill="none" stroke="#d02020" stroke-width="1.6"/>`);
  }
  for (const j of plan.junctions) {
    if (j.pavementEnds === null) continue;
    out.push(`<path d="M${X(j.pavementEnds.x)},${Y(j.pavementEnds.z) - 4} l4,4 l-4,4 l-4,-4 z" fill="#e8c020" stroke="#201800" stroke-width="0.7"/>`);
  }

  // Buildings.
  for (const b of plan.buildings) {
    const fill = b.state === "vacant" ? "url(#vacant)" : b.state === "ruin" ? "url(#ruin)" : buildingFill(b.kind);
    const stroke = b.state === "ruin" ? "#d04040" : b.state === "vacant" ? "#e8c050" : "#101010";
    out.push(`<polygon points="${poly(footprint(b))}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
  }

  // The thinning edge: a ring about each outlying building.
  for (const o of plan.outskirts) {
    const b = plan.buildings[o.building]!;
    out.push(`<circle cx="${X(b.centre.x)}" cy="${Y(b.centre.z)}" r="${Math.max(b.halfAlong, b.halfAcross) + 5}" fill="none" stroke="#ffd24a" stroke-width="1.2"/>`);
  }

  // The harbour: floats and gangways, the pond, pilings, the yard, boats by kind and state, the barge, the lights.
  harbourSvg(plan, out, X, Y);

  // Landmarks: a marker and a label each, the FBI office the most prominent.
  const labels = options.labels ?? "all";
  if (labels !== "none") {
    for (const l of plan.landmarks) {
      const b = plan.buildings[l.building];
      const fbi = l.role === "fbi";
      if (labels === "fbi" && !fbi) continue;
      const fs = fbi ? 20 : 12;
      // A place that is no building (a road's destination) has its own position.
      const lx = l.at?.x ?? b!.centre.x;
      const lz = l.at?.z ?? b!.centre.z;
      const place = l.at !== undefined;
      out.push(`<circle cx="${X(lx)}" cy="${Y(lz)}" r="${fbi ? 10 : place ? 6 : 4}" fill="${fbi ? "#ff3030" : place ? "#ffcf7a" : "none"}" fill-opacity="0.35" stroke="${fbi ? "#ff5050" : place ? "#ffcf7a" : "#ffffff"}" stroke-width="${fbi ? 2.5 : 1}"/>`);
      const tx = lx + (fbi ? 14 : 7);
      const tz = lz + (fbi ? 4 : 3);
      out.push(
        `<text x="${X(tx)}" y="${Y(tz)}" font-size="${fs}" fill="${fbi ? "#ffd0d0" : "#f0f0f0"}" font-weight="${fbi ? 700 : 400}" stroke="#0c1014" stroke-width="${fbi ? 4 : 3}" paint-order="stroke">${esc(l.name)}</text>`,
      );
    }
  }

  // The spawn: a marker with its facing.
  {
    const s = plan.spawn;
    const dx = Math.sin(s.yaw);
    const dz = Math.cos(s.yaw);
    const tip = { x: s.x + dx * 9, z: s.z + dz * 9 };
    const l = { x: s.x - dz * 3.5 - dx * 2, z: s.z + dx * 3.5 - dz * 2 };
    const r = { x: s.x + dz * 3.5 - dx * 2, z: s.z - dx * 3.5 - dz * 2 };
    out.push(`<polygon points="${poly([tip, l, r])}" fill="#3affa0" stroke="#0c1014" stroke-width="0.8"/>`);
  }

  // Furniture: a scale bar in metres and feet, and a north arrow.
  if (options.furniture !== false && !options.bare) {
    const bx = 30;
    const by = H - 34;
    const m100 = 100;
    const ft = 100 / 0.3048;
    out.push(`<g stroke="#e8f0f0" fill="#e8f0f0" stroke-width="2"><line x1="${bx}" y1="${by}" x2="${bx + m100}" y2="${by}"/><line x1="${bx}" y1="${by - 5}" x2="${bx}" y2="${by + 5}"/><line x1="${bx + m100}" y1="${by - 5}" x2="${bx + m100}" y2="${by + 5}"/>`);
    out.push(`<line x1="${bx}" y1="${by + 14}" x2="${bx + ft * 0.3048}" y2="${by + 14}"/></g>`);
    out.push(`<text x="${bx}" y="${by - 10}" font-size="12" fill="#e8f0f0">100 m</text><text x="${bx}" y="${by + 30}" font-size="12" fill="#e8f0f0">${Math.round(ft)} ft</text>`);
    const nx = W - 40;
    const ny = 60;
    out.push(`<g fill="#e8f0f0" stroke="#e8f0f0"><polygon points="${nx},${ny - 28} ${nx - 9},${ny + 8} ${nx},${ny} ${nx + 9},${ny + 8}" stroke-width="1"/><text x="${nx - 5}" y="${ny - 34}" font-size="16" stroke="none">N</text></g>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

/** The towns of a contact sheet: each a thumbnail with its name, what it was founded for and its bearings under it. */
export function sheetCaption(plan: TownPlan, site?: TownSite, worldSeed?: number): string[] {
  const h = plan.history;
  const stairs = plan.streets.filter((st) => st.kind === "stair").length;
  const land = site === undefined ? "" : `, ${landOf(site).hectares.toFixed(0)} ha buildable`;
  const bay = worldSeed === undefined ? "" : `bay ends ${Math.round(bayOf(worldSeed).end)} m inland`;
  const seam = plan.seams[0];
  return [
    `${plan.name} (seed ${plan.seed})`,
    `founded: ${h.founding.purpose} ${h.founding.year}`,
    `old grid ${plan.plats[0]!.bearing.deg}deg (${h.firstPlat.basis}), company grid 0deg${seam ? `, seam ${Math.round(seam.angle)}deg` : ""}`,
    `${h.fire ? `fire ${h.fire.year}` : "no fire"}, ${h.railroad ? "rail" : "no rail"}, mill ${h.mill.fate}${h.countySeat.isSeat ? ", county seat" : ""}`,
    `${bay}${land}`,
    `${plan.counts.blocks} blocks, ${stairs} stairs, ${plan.counts.outskirts} outlying, ${plan.counts.buildings} buildings`,
  ];
}

/** One SVG with several towns side by side, `columns` to a row. */
export function sheetSvg(entries: readonly { plan: TownPlan; site: TownSite; seed?: number }[], columns: number, cell = 560): string {
  const capH = 112;
  const rows = Math.ceil(entries.length / columns);
  const cellH = Math.round(cell * 1.25) + capH;
  const W = columns * cell;
  const H = rows * cellH;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, monospace">`);
  out.push(`<rect width="${W}" height="${H}" fill="#101014"/>`);
  entries.forEach((e, k) => {
    const cx = (k - Math.floor(k / columns) * columns) * cell;
    const cy = Math.floor(k / columns) * cellH;
    // The town is drawn to fit the cell's picture box, whole, whatever its proportions.
    const boxW = cell - 12;
    const boxH = cellH - capH - 12;
    const inner = planSvg(e.plan, e.site, { width: boxW, labels: "fbi", furniture: false, bare: true })
      .replace(/^<svg /, `<svg x="${cx + 6}" y="${cy + 6}" preserveAspectRatio="xMidYMid meet" `)
      .replace(/ width="\d+" height="\d+"/, ` width="${boxW}" height="${boxH}"`);
    out.push(inner);
    const cap = sheetCaption(e.plan, e.site, e.seed);
    cap.forEach((line, i) => {
      out.push(`<text x="${cx + 10}" y="${cy + cellH - capH + 16 + i * 16}" font-size="${i === 0 ? 14 : 11}" fill="${i === 0 ? "#eaf1f1" : "#aab8b8"}" font-weight="${i === 0 ? 700 : 400}">${esc(line)}</text>`);
    });
  });
  out.push("</svg>");
  return out.join("\n");
}

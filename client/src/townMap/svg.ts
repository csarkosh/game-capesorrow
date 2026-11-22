/**
 * Draws a town plan as an SVG document. A pure function of a plan and its site: the map page and the
 * contact-sheet test both use it. Not simulation code (it may use any maths); it is for looking.
 *
 * North is up and the sea is to the left, as in the plan's own frame: x to the right, z up.
 */
import type { Building, BuildingKind, District, Street, StreetKind, TownPlan } from "../sim/town/types.js";
import type { TownSite } from "../sim/town/site.js";

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
};

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
};

export const STREET_STROKE: Record<StreetKind, string> = {
  highway: "#9a8d72",
  avenue: "#6d7378",
  main: "#7d8084",
  street: "#4a4e52",
  alley: "#33373a",
  wharf: "#7a6240",
  rail: "#bdbdbd",
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
  const b = plan.bounds;
  let x0 = b.x0 - pad;
  const x1 = b.x1 + pad;
  // Include some sea on the left, so that the shoreline is seen to be a shore.
  x0 = Math.min(x0, Math.min(...site.shoreX) - 60);
  return { x0, z0: b.z0 - pad, x1, z1: b.z1 + pad };
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
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${px}" height="${pxH}" font-family="ui-monospace, monospace">`);
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
    if (s.kind === "rail") {
      out.push(`<line x1="${X(s.a.x)}" y1="${Y(s.a.z)}" x2="${X(s.b.x)}" y2="${Y(s.b.z)}" stroke="#555" stroke-width="${s.width}"/>`);
      out.push(`<line x1="${X(s.a.x)}" y1="${Y(s.a.z)}" x2="${X(s.b.x)}" y2="${Y(s.b.z)}" stroke="${col}" stroke-width="3" stroke-dasharray="9 4"/>`);
      continue;
    }
    out.push(`<line x1="${X(s.a.x)}" y1="${Y(s.a.z)}" x2="${X(s.b.x)}" y2="${Y(s.b.z)}" stroke="${col}" stroke-width="${s.width}"/>`);
  }
  // The seam, emphasised.
  for (const sm of plan.seams) {
    out.push(`<line x1="${X(sm.a.x)}" y1="${Y(sm.a.z)}" x2="${X(sm.b.x)}" y2="${Y(sm.b.z)}" stroke="#ff8c2a" stroke-width="3" stroke-dasharray="14 6"/>`);
  }

  // Buildings.
  for (const b of plan.buildings) {
    const fill = b.state === "vacant" ? "url(#vacant)" : b.state === "ruin" ? "url(#ruin)" : buildingFill(b.kind);
    const stroke = b.state === "ruin" ? "#d04040" : b.state === "vacant" ? "#e8c050" : "#101010";
    out.push(`<polygon points="${poly(footprint(b))}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
  }

  // Landmarks: a marker and a label each, the FBI office the most prominent.
  const labels = options.labels ?? "all";
  if (labels !== "none") {
    for (const l of plan.landmarks) {
      const b = plan.buildings[l.building]!;
      const fbi = l.role === "fbi";
      if (labels === "fbi" && !fbi) continue;
      const fs = fbi ? 20 : 12;
      const lx = b.centre.x;
      const lz = b.centre.z;
      out.push(`<circle cx="${X(lx)}" cy="${Y(lz)}" r="${fbi ? 10 : 4}" fill="${fbi ? "#ff3030" : "none"}" fill-opacity="0.35" stroke="${fbi ? "#ff5050" : "#ffffff"}" stroke-width="${fbi ? 2.5 : 1}"/>`);
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
export function sheetCaption(plan: TownPlan): string[] {
  const h = plan.history;
  const seam = plan.seams[0];
  return [
    `${plan.name} (seed ${plan.seed})`,
    `founded: ${h.founding.purpose} ${h.founding.year}`,
    `waterfront grid ${plan.plats[0]!.bearing.deg}deg (${h.firstPlat.basis}), company grid 0deg${seam ? `, seam ${Math.round(seam.angle)}deg` : ""}`,
    `${h.fire ? `fire ${h.fire.year}` : "no fire"}, ${h.railroad ? "rail" : "no rail"}, mill ${h.mill.fate}${h.countySeat.isSeat ? ", county seat" : ""}`,
    `${plan.counts.blocks} blocks, ${plan.counts.buildings} buildings`,
  ];
}

/** One SVG with several towns side by side, `columns` to a row. */
export function sheetSvg(entries: readonly { plan: TownPlan; site: TownSite }[], columns: number, cell = 560): string {
  const capH = 96;
  const rows = Math.ceil(entries.length / columns);
  const cellH = Math.round(cell * 0.85) + capH;
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
    const cap = sheetCaption(e.plan);
    cap.forEach((line, i) => {
      out.push(`<text x="${cx + 10}" y="${cy + cellH - capH + 16 + i * 16}" font-size="${i === 0 ? 14 : 11}" fill="${i === 0 ? "#eaf1f1" : "#aab8b8"}" font-weight="${i === 0 ? 700 : 400}">${esc(line)}</text>`);
    });
  });
  out.push("</svg>");
  return out.join("\n");
}

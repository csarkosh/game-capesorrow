/**
 * The town plan's map page (served at /town.html in development; not part of the build). Plain DOM and
 * CSS in the dark style of the game's title page, no framework.
 *
 *   /town.html?seed=7                one town, on the real coast of world seed 7: the map (pan with the
 *                                    mouse, zoom with the wheel), the history beside it, a legend and
 *                                    the counts; add &site=synthetic for the synthetic site's coast
 *   /town.html?sheet=12&from=1       a contact sheet: twelve towns from consecutive seeds, each with its
 *                                    name, what it was founded for and its bearings under it
 */
import { planTown } from "../sim/town/plan.js";
import type { TownPlan } from "../sim/town/types.js";
import type { TownSite } from "../sim/town/site.js";
import { realSite } from "./realSite.js";
import { syntheticSite } from "./syntheticSite.js";
import { DISTRICT_FILL, STREET_STROKE, buildingFill, planSvg, sheetCaption } from "./svg.js";

const STYLE = `
  body { font-family: ui-monospace, monospace; }
  .town { display: grid; grid-template-columns: minmax(0, 1fr) 24rem; height: 100%; }
  .town .map { position: relative; min-width: 0; height: 100%; overflow: hidden; background: #0c1822; cursor: grab; }
  .town .map.drag { cursor: grabbing; }
  .town .map svg { display: block; width: 100%; height: 100%; user-select: none; }
  .town aside { overflow-y: auto; padding: 1rem 1.25rem 2rem; box-sizing: border-box; border-left: 1px solid rgba(198, 222, 222, 0.18); }
  h1 { margin: 0 0 0.25rem; font-size: 1.4rem; letter-spacing: 0.06em; color: #eaf1f1; }
  h2 { margin: 1.25rem 0 0.4rem; font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; color: #9fb4b4; }
  .sub { color: #9fb4b4; font-size: 0.8rem; }
  .bar { display: flex; gap: 0.4rem; align-items: center; margin: 0.75rem 0; flex-wrap: wrap; }
  button, input[type=number] {
    font: inherit; color: #eaf1f1; background: rgba(198, 222, 222, 0.10); border: 1px solid rgba(198, 222, 222, 0.30);
    border-radius: 3px; padding: 0.3rem 0.65rem;
  }
  button { cursor: pointer; }
  button:hover { background: rgba(214, 234, 234, 0.20); border-color: rgba(214, 234, 234, 0.58); }
  input[type=number] { width: 7.5rem; }
  label { font-size: 0.8rem; color: #9fb4b4; }
  ol.events { list-style: none; margin: 0; padding: 0; }
  ol.events li { margin: 0 0 0.6rem; font-size: 0.82rem; line-height: 1.35; }
  ol.events b { color: #ffcf7a; margin-right: 0.4rem; }
  .legend { display: grid; grid-template-columns: 1fr 1fr; gap: 0.2rem 0.75rem; font-size: 0.75rem; }
  .legend i { display: inline-block; width: 0.9rem; height: 0.7rem; margin-right: 0.4rem; vertical-align: -0.05rem; border: 1px solid rgba(0,0,0,0.5); }
  table.counts { font-size: 0.8rem; border-collapse: collapse; }
  table.counts td { padding: 0.1rem 0.9rem 0.1rem 0; }
  table.counts td:last-child { color: #eaf1f1; }
  .lm { font-size: 0.78rem; margin: 0 0 0.35rem; line-height: 1.3; }
  .lm b { color: #ffd0d0; }
  .sheet { padding: 1rem 1.25rem 2rem; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .sheet .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 1rem; }
  .sheet figure { margin: 0; background: #0c1014; border: 1px solid rgba(198, 222, 222, 0.18); padding: 0.4rem; }
  .sheet figure a { color: inherit; text-decoration: none; display: block; }
  .sheet figure svg { width: 100%; height: auto; display: block; }
  .sheet figcaption { font-size: 0.72rem; line-height: 1.35; color: #9fb4b4; padding-top: 0.3rem; }
  .sheet figcaption b { display: block; font-size: 0.85rem; color: #eaf1f1; }
  a.plain { color: #8fd0e8; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
}

function params(): URLSearchParams {
  return new URLSearchParams(location.search);
}

function setParams(p: Record<string, string | null>): void {
  const q = params();
  for (const [k, v] of Object.entries(p)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
}

function makePlan(seed: number): { plan: TownPlan; site: TownSite } {
  const site = params().get("site") === "synthetic" ? syntheticSite(seed) : realSite(seed);
  return { plan: planTown(site, "port"), site };
}

/** Pan with the mouse, zoom with the wheel (about the pointer), reset with a double click. */
function panZoom(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const vb0 = (svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ").map(Number) as [number, number, number, number];
  const vb: [number, number, number, number] = [...vb0];
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  const apply = (): void => svg.setAttribute("viewBox", vb.join(" "));
  /** Metres per screen pixel (the viewBox is fitted to the element, so the larger ratio rules). */
  const perPx = (): number => {
    const r = svg.getBoundingClientRect();
    return Math.max(vb[2] / r.width, vb[3] / r.height);
  };
  host.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      const k = perPx();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // The point under the pointer, in viewBox units.
      const px = vb[0] + vb[2] / 2 + (ev.clientX - cx) * k;
      const py = vb[1] + vb[3] / 2 + (ev.clientY - cy) * k;
      const f = ev.deltaY < 0 ? 0.85 : 1 / 0.85;
      const nw = Math.max(40, Math.min(vb0[2] * 1.5, vb[2] * f));
      const s = nw / vb[2];
      vb[2] = nw;
      vb[3] *= s;
      const k2 = perPx();
      vb[0] = px - (ev.clientX - cx) * k2 - vb[2] / 2;
      vb[1] = py - (ev.clientY - cy) * k2 - vb[3] / 2;
      apply();
    },
    { passive: false },
  );
  let last: { x: number; y: number } | null = null;
  host.addEventListener("pointerdown", (ev) => {
    last = { x: ev.clientX, y: ev.clientY };
    host.classList.add("drag");
    host.setPointerCapture(ev.pointerId);
  });
  host.addEventListener("pointermove", (ev) => {
    if (!last) return;
    const k = perPx();
    vb[0] -= (ev.clientX - last.x) * k;
    vb[1] -= (ev.clientY - last.y) * k;
    last = { x: ev.clientX, y: ev.clientY };
    apply();
  });
  const up = (): void => {
    last = null;
    host.classList.remove("drag");
  };
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("dblclick", () => {
    vb[0] = vb0[0];
    vb[1] = vb0[1];
    vb[2] = vb0[2];
    vb[3] = vb0[3];
    apply();
  });
}

function legend(): HTMLElement {
  const box = el("div", { class: "legend" });
  const swatch = (colour: string, label: string, extra = ""): void => {
    const i = el("i");
    i.style.background = colour;
    if (extra) i.style.cssText += extra;
    box.append(el("div", {}, i, label));
  };
  for (const d of Object.keys(DISTRICT_FILL) as (keyof typeof DISTRICT_FILL)[]) swatch(DISTRICT_FILL[d], d);
  const kinds = ["storefront", "hotel", "tavern", "house", "warehouse", "mill shed", "cannery", "port terminal shed", "motel", "big-box store", "church", "school", "hospital", "federal building", "tsunami refuge", "pier"] as const;
  for (const k of kinds) swatch(buildingFill(k), k);
  swatch("repeating-linear-gradient(45deg, #2a2a2e 0 2px, #e8c050 2px 3px)", "vacant");
  swatch("repeating-linear-gradient(-45deg, #1a0e0e 0 2px, #d04040 2px 3px)", "ruin");
  for (const s of Object.keys(STREET_STROKE) as (keyof typeof STREET_STROKE)[]) swatch(STREET_STROKE[s], `${s} (street)`);
  swatch("#ff8c2a", "the seam street");
  swatch("#3a3a30", "made ground (fill)");
  swatch("#e8e0c8", "the quay");
  swatch("#3affa0", "spawn and its facing");
  return box;
}

function showTown(root: HTMLElement, seed: number, opts: { lots: boolean; labels: boolean }): void {
  const { plan, site } = makePlan(seed);
  const t0 = performance.now();
  planTown(site, "port");
  const ms = performance.now() - t0;
  root.replaceChildren();
  const map = el("div", { class: "map" });
  map.innerHTML = planSvg(plan, site, { width: 1600, lots: opts.lots, labels: opts.labels ? "all" : "fbi" });
  const aside = el("aside");

  const input = el("input", { type: "number", value: String(seed) });
  const go = (n: number): void => {
    setParams({ seed: String(n), sheet: null });
    showTown(root, n, opts);
  };
  const prev = el("button", { textContent: "< previous" });
  prev.onclick = () => go(seed - 1);
  const nextB = el("button", { textContent: "next >" });
  nextB.onclick = () => go(seed + 1);
  input.onchange = () => go(Math.floor(Number(input.value) || 1));
  const sheetB = el("button", { textContent: "contact sheet" });
  sheetB.onclick = () => {
    setParams({ sheet: "12", from: String(seed), seed: null });
    render(root);
  };
  const lots = el("input", { type: "checkbox", checked: opts.lots });
  lots.onchange = () => showTown(root, seed, { ...opts, lots: lots.checked });
  const labels = el("input", { type: "checkbox", checked: opts.labels });
  labels.onchange = () => showTown(root, seed, { ...opts, labels: labels.checked });

  const h = plan.history;
  aside.append(
    el("h1", { textContent: plan.name }),
    el("div", { class: "sub", textContent: `a large port - world seed ${seed} - generator ${plan.version}${params().get("site") === "synthetic" ? " - synthetic site" : ""}` }),
    el("div", { class: "bar" }, prev, input, nextB, sheetB),
    el("div", { class: "bar" }, el("label", {}, lots, " lots"), el("label", {}, labels, " all labels")),
  );

  aside.append(el("h2", { textContent: "history" }));
  const ol = el("ol", { class: "events" });
  for (const e of h.events) ol.append(el("li", {}, el("b", { textContent: String(e.year) }), e.text));
  aside.append(ol);

  aside.append(el("h2", { textContent: "form" }));
  const seam = plan.seams[0];
  const rows: [string, string][] = [
    ["old grid", `${plan.plats[0]!.bearing.deg} deg, laid to ${h.firstPlat.basis === "wharf" ? "the line of the wharf" : h.firstPlat.basis === "survey" ? "a railroad's survey" : "the wagon road that became the highway"}`],
    ["made ground", `${plan.fill.length} fill pieces behind a ${Math.round(Math.sqrt((plan.quay.b.x - plan.quay.a.x) ** 2 + (plan.quay.b.z - plan.quay.a.z) ** 2))} m quay`],
    ["company grid", "0 deg (the compass)"],
    ["seam", seam ? `${Math.round(seam.angle)} deg` : "none"],
    ["blocks", `${plan.counts.blocks} (the old plat ${plan.plats[0]!.columns} x ${plan.plats[0]!.rows})`],
    ["lots", String(plan.counts.lots)],
    ["buildings", `${plan.counts.buildings}: ${plan.counts.open} open, ${plan.counts.vacant} vacant, ${plan.counts.ruin} ruin`],
    ["streets", String(plan.counts.streets)],
    ["made in", `${ms.toFixed(1)} ms`],
  ];
  const table = el("table", { class: "counts" });
  for (const [k, v] of rows) table.append(el("tr", {}, el("td", { textContent: k }), el("td", { textContent: v })));
  aside.append(table);

  aside.append(el("h2", { textContent: "landmarks" }));
  for (const l of plan.landmarks) aside.append(el("p", { class: "lm" }, el("b", { textContent: l.name }), ` - ${l.text}`));

  aside.append(el("h2", { textContent: "legend" }), legend());
  root.append(el("div", { class: "town" }, map, aside));
  panZoom(map);
}

function showSheet(root: HTMLElement, count: number, from: number): void {
  root.replaceChildren();
  const sheet = el("div", { class: "sheet" });
  const prev = el("button", { textContent: "< earlier" });
  prev.onclick = () => {
    setParams({ from: String(from - count) });
    render(root);
  };
  const nextB = el("button", { textContent: "later >" });
  nextB.onclick = () => {
    setParams({ from: String(from + count) });
    render(root);
  };
  sheet.append(
    el("h1", { textContent: "Cape Sorrow - towns side by side" }),
    el("div", { class: "sub", textContent: `${count} large ports from seeds ${from} to ${from + count - 1}. Click one to open it.` }),
    el("div", { class: "bar" }, prev, nextB),
  );
  const grid = el("div", { class: "grid" });
  for (let i = 0; i < count; i++) {
    const seed = from + i;
    const { plan, site } = makePlan(seed);
    const cap = sheetCaption(plan);
    const a = el("a", { href: `?seed=${seed}` });
    a.innerHTML = planSvg(plan, site, { width: 480, labels: "fbi", furniture: false, bare: true });
    a.querySelector("svg")?.removeAttribute("height");
    const figcaption = el("figcaption", {}, el("b", { textContent: cap[0]! }), ...cap.slice(1).flatMap((c) => [c, el("br")]));
    grid.append(el("figure", {}, a, figcaption));
  }
  sheet.append(grid);
  root.append(sheet);
}

function render(root: HTMLElement): void {
  const q = params();
  const sheet = q.get("sheet");
  if (sheet !== null) {
    const count = Math.max(1, Math.min(48, Math.floor(Number(sheet) || 12)));
    showSheet(root, count, Math.floor(Number(q.get("from") ?? "1") || 1));
  } else {
    showTown(root, Math.floor(Number(q.get("seed") ?? "1") || 1), { lots: true, labels: true });
  }
}

const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
const app = document.getElementById("app");
if (app) render(app);

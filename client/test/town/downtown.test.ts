import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { segDist } from "../../src/sim/town/geom.js";
import { ensureMunicipal } from "../../src/sim/town/port/places.js";
import { blockNeighbours } from "../../src/sim/town/port/downtown.js";
import type { Building, BuildingKind, TownPlan } from "../../src/sim/town/types.js";
import { planSvg } from "../../src/townMap/svg.js";
import { SEEDS, townFor } from "./sites.js";

/** The sixty-four world seeds the guarantees are held on: the forty of the suite and 37 to 60. */
const SIXTY_FOUR: readonly number[] = [...SEEDS, ...Array.from({ length: 24 }, (_, i) => 37 + i)];

const towns = (seeds: readonly number[] = SEEDS): { seed: number; plan: TownPlan }[] => seeds.map((s) => ({ seed: s, plan: townFor(s).plan }));

/** The block a building stands in (-1 for a pier). */
const blockOf = (plan: TownPlan, b: Building): number => (b.lot < 0 ? -1 : plan.lots[b.lot]!.block);

/** Everything the owner wants in one downtown: shops, offices, taverns and bars, restaurants and cafes, banks, lodging of every kind, apartments, the lodge hall, the school, the hospital, gas stations and garages, big-box stores, the municipal building. */
const DOWNTOWN_KINDS: readonly BuildingKind[] = ["storefront", "office", "tavern", "restaurant", "bank", "hotel", "motel", "boarding house", "apartment", "lodge hall", "school", "hospital", "gas station", "garage", "big-box store", "municipal building"];
const BUSINESS: readonly BuildingKind[] = ["storefront", "office", "bank", "big-box store", "restaurant", "gas station", "garage", "tavern", "hotel", "motel", "boarding house", "lodge hall"];

/**
 * The groups of the facts' second point, and what they counted over `SEEDS` at generator 24 (before the downtown): the town's size is kept to about 15 percent of each.
 * Measured with a throwaway test on the plans of the day; the groups are by kind.
 */
const GROUPS: { name: string; kinds: readonly BuildingKind[]; before: number }[] = [
  { name: "businesses", kinds: ["storefront", "office", "bank", "big-box store", "restaurant", "gas station", "garage", "tavern"], before: 1765 },
  { name: "lodging", kinds: ["hotel", "motel", "boarding house"], before: 229 },
  { name: "civic and institutions", kinds: ["municipal building", "courthouse", "customs house", "depot", "fire hall", "lodge hall", "hospital", "school", "church"], before: 279 },
  { name: "apartments", kinds: ["apartment"], before: 268 },
  { name: "houses", kinds: ["house"], before: 8640 },
  { name: "industry", kinds: ["mill shed", "shake mill", "warehouse", "junkyard", "silo"], before: 232 },
];

function centroidOf(bs: readonly Building[]): { x: number; z: number } {
  return { x: bs.reduce((s, b) => s + b.centre.x, 0) / bs.length, z: bs.reduce((s, b) => s + b.centre.z, 0) / bs.length };
}

/** The number of single-link clusters of buildings at a link distance. */
function clusters(bs: readonly Building[], link: number): number[] {
  const parent = bs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      if (Math.hypot(bs[i]!.centre.x - bs[j]!.centre.x, bs[i]!.centre.z - bs[j]!.centre.z) <= link) parent[find(i)] = find(j);
    }
  }
  const sizes = new Map<number, number>();
  for (let i = 0; i < bs.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  return [...sizes.values()].sort((a, b) => b - a);
}

describe("the downtown: one set of blocks that holds every business", () => {
  it("is one connected set of blocks, each sharing a street with another of the set, that holds the core, the dock block and every block between", () => {
    for (const { seed, plan } of towns(SIXTY_FOUR)) {
      const own = plan.blocks.slice(0, plan.counts.blocks);
      const dt = plan.downtown;
      expect(dt.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(dt.every((id) => id >= 0 && id < own.length), `seed ${seed}: no outskirts parcel is in it`).toBe(true);
      // Connected: from the first block, along blocks that share a street, every block of the set is reached.
      const adj = blockNeighbours(own, plan.streets);
      const seen = [dt[0]!];
      for (let q = 0; q < seen.length; q++) for (const v of adj[seen[q]!]!) if (dt.includes(v) && !seen.includes(v)) seen.push(v);
      expect(seen.length, `seed ${seed}: ${dt.length} blocks, ${seen.length} reached`).toBe(dt.length);
      // The core and the dock are in it; where the town has an old plat there is a dock block.
      for (const b of own) if (b.district === "core" || b.district === "dock") expect(dt, `seed ${seed} block ${b.id} is ${b.district}`).toContain(b.id);
      if (own.some((b) => b.plat === "old")) {
        // The dock block, or the block of the core the quay's row is, stands by the quay.
        const quay = (id: number): number => Math.min(...own[id]!.polygon.map((q) => segDist(q, plan.quay.a, plan.quay.b)));
        expect(Math.min(...dt.map(quay)), `seed ${seed}: a block by the quay`).toBeLessThan(40);
      }
      expect(dt.some((id) => own[id]!.district === "core"), `seed ${seed}`).toBe(true);
    }
  });

  it("is a few blocks, from two to a dozen, and follows the town's size", () => {
    const sizes = towns().map(({ plan }) => plan.downtown.length);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(12);
    expect(new Set(sizes).size, "its size varies from town to town").toBeGreaterThanOrEqual(4);
  });

  it("holds every shop, office, tavern, restaurant, bank, lodging, apartment, the lodge hall, school, hospital, gas station, garage, big-box store and the municipal building, and none of them stands outside it", () => {
    let seen = 0;
    for (const { seed, plan } of towns(SIXTY_FOUR)) {
      for (const b of plan.buildings) {
        if (!DOWNTOWN_KINDS.includes(b.kind)) continue;
        seen++;
        expect(plan.downtown, `seed ${seed} ${b.kind} ${b.id}`).toContain(blockOf(plan, b));
      }
      // Whatever has a business in it stands there too: no unit with a shop's trade is outside (a warehouse's bays are the harbour's).
      for (const use of plan.uses) {
        const b = plan.buildings[use.building]!;
        if (b.kind === "warehouse" || use.units.length === 0) continue;
        expect(plan.downtown, `seed ${seed} building ${b.id} (${b.kind}) holds units`).toContain(blockOf(plan, b));
      }
      // The outskirts hold no business: no gas station, motel, tavern or garage out past the last blocks, and no highway strip anywhere else.
      for (const o of plan.outskirts) expect(DOWNTOWN_KINDS, `seed ${seed}: an outskirts ${plan.buildings[o.building]!.kind}`).not.toContain(plan.buildings[o.building]!.kind);
      for (const bl of plan.blocks) if (bl.district === "highway strip") expect(plan.downtown, `seed ${seed} strip block ${bl.id}`).toContain(bl.id);
      expect(plan.blocks.some((bl) => bl.district === "civic"), `seed ${seed}`).toBe(false);
    }
    expect(seen).toBeGreaterThan(2500);
  });

  it("keeps what is spread out spread out: houses, churches, industry and the fire hall stand as before, outside the downtown", () => {
    let houses = 0;
    let inside = 0;
    for (const { seed, plan } of towns()) {
      for (const b of plan.buildings) {
        if (b.kind === "church" || b.kind === "mill shed" || b.kind === "shake mill" || b.kind === "silo" || b.kind === "junkyard" || b.kind === "fire hall") expect(plan.downtown, `seed ${seed} ${b.kind}`).not.toContain(blockOf(plan, b));
        if (b.kind === "house") {
          houses++;
          if (plan.downtown.includes(blockOf(plan, b))) inside++;
        }
      }
      // The houses and the mill's buildings reach as far out as they did: the farthest house is more than 300 m from the businesses' centre (it was 462 to 736).
      const biz = plan.buildings.filter((b) => BUSINESS.includes(b.kind));
      const c = centroidOf(biz);
      const far = Math.max(...plan.buildings.filter((b) => b.kind === "house").map((b) => Math.hypot(b.centre.x - c.x, b.centre.z - c.z)));
      expect(far, `seed ${seed}`).toBeGreaterThan(300);
      const hs = plan.buildings.filter((b) => b.kind === "house");
      const hc = centroidOf(hs);
      const d = hs.map((b) => Math.hypot(b.centre.x - hc.x, b.centre.z - hc.z)).sort((p, q) => p - q);
      // The median distance of a house from the houses' centre was 207 to 286 m in the facts' four seeds.
      expect(d[Math.floor(d.length / 2)]!, `seed ${seed}`).toBeGreaterThan(150);
    }
    // Residential blocks hold houses only (and the churches, the depot and the refuge, which stay spread out): a few houses stand in the downtown's outer blocks, and they are a small share.
    expect(inside / houses).toBeLessThan(0.1);
    for (const { seed, plan } of towns()) {
      for (const b of plan.buildings) {
        if (b.lot < 0) continue;
        const d = plan.lots[b.lot]!.district;
        if (d === "residential" || d === "mill housing") expect(["house", "church", "tsunami refuge", "depot"], `seed ${seed} building ${b.id} in ${d}`).toContain(b.kind);
      }
    }
  });

  it("makes the businesses one cluster at a link of 150 m, and holds them near their centre", () => {
    for (const { seed, plan } of towns()) {
      const biz = plan.buildings.filter((b) => b.lot >= 0 && BUSINESS.includes(b.kind));
      expect(clusters(biz, 150), `seed ${seed}`).toHaveLength(1);
      const c = centroidOf(biz);
      const d = biz.map((b) => Math.hypot(b.centre.x - c.x, b.centre.z - c.z)).sort((p, q) => p - q);
      // It was a median of 92 to 147 m, a 90th percentile of 231 to 400 m and a farthest of 409 to 937 m in the facts' seeds.
      expect(d[Math.floor(d.length * 0.9)]!, `seed ${seed}`).toBeLessThan(320);
      expect(d[d.length - 1]!, `seed ${seed}`).toBeLessThan(450);
    }
  });

  it("keeps the town about the size it was: the buildings of each group within 15 percent of what the forty seeds held before", () => {
    const rows: string[] = [];
    for (const g of GROUPS) {
      let n = 0;
      for (const { plan } of towns()) n += plan.buildings.filter((b) => g.kinds.includes(b.kind)).length;
      rows.push(`${g.name}: ${g.before} before, ${n} now (${(((n - g.before) / g.before) * 100).toFixed(1)} percent)`);
      expect(n / g.before, rows[rows.length - 1]!).toBeGreaterThanOrEqual(0.85);
      expect(n / g.before, rows[rows.length - 1]!).toBeLessThanOrEqual(1.15);
    }
    console.log(rows.join("\n"));
  });
});

describe("what every town has, open for business, in the downtown", () => {
  it("names the player's office (the municipal building), a lodging, a bar and a cafe, each open, in the downtown, in every one of sixty-four towns", () => {
    for (const { seed, plan } of towns(SIXTY_FOUR)) {
      const { office, lodging, bar, cafe } = plan.places;
      const hall = plan.landmarks.find((l) => l.role === "municipal building")!;
      expect(office, `seed ${seed}`).toEqual({ building: hall.building, unit: null });
      expect(plan.buildings[office.building]!.kind).toBe("municipal building");
      expect(plan.buildings[office.building]!.state, `seed ${seed}: the office is open`).toBe("open");
      for (const [name, place, trades] of [["lodging", lodging, ["hotel", "motel", "rooming house"]], ["bar", bar, ["tavern"]], ["cafe", cafe, ["cafe"]]] as const) {
        const b = plan.buildings[place.building]!;
        expect(plan.downtown, `seed ${seed} ${name}`).toContain(blockOf(plan, b));
        const unit = plan.uses[place.building]!.units[place.unit!]!;
        expect(unit.id, `seed ${seed} ${name}`).toBe(place.unit);
        expect(unit.state, `seed ${seed} ${name} is open`).toBe("open");
        expect(unit.tenant, `seed ${seed} ${name}`).not.toBeNull();
        expect(trades as readonly string[], `seed ${seed} ${name}`).toContain(unit.tenant!.trade);
      }
      expect(["hotel", "motel", "boarding house"], `seed ${seed}`).toContain(plan.buildings[lodging.building]!.kind);
      expect(plan.buildings[bar.building]!.kind, `seed ${seed}: the bar is a tavern`).toBe("tavern");
    }
  });

  it("has one municipal building, a landmark in the downtown, first of the landmarks, with the town's name on its signs", () => {
    for (const { seed, plan } of towns(SIXTY_FOUR)) {
      const halls = plan.landmarks.filter((l) => l.role === "municipal building");
      expect(halls, `seed ${seed}`).toHaveLength(1);
      expect(plan.landmarks[0]!.role).toBe("municipal building");
      expect(halls[0]!.name).toBe(`${plan.name} Municipal Building`);
      expect(plan.buildings.filter((b) => b.kind === "municipal building")).toHaveLength(1);
      const b = plan.buildings[halls[0]!.building]!;
      expect(plan.downtown, `seed ${seed}`).toContain(blockOf(plan, b));
    }
  });
});

describe("the fallback that cannot fail", () => {
  it("makes a building of the downtown the municipal building where the reserved lot gave none", () => {
    for (const { seed, plan } of towns().slice(0, 8)) {
      const lots = plan.lots.map((l) => (l.role === "municipal" ? { ...l, role: null } : l));
      const buildings = plan.buildings.map((b) => (b.kind === "municipal building" ? { ...b, kind: "storefront" as const, state: "vacant" as const } : b));
      expect(buildings.some((b) => b.kind === "municipal building")).toBe(false);
      ensureMunicipal(plan.downtown, lots, buildings);
      const made = buildings.filter((b) => b.kind === "municipal building");
      expect(made, `seed ${seed}`).toHaveLength(1);
      expect(made[0]!.state).toBe("open");
      expect(plan.downtown, `seed ${seed}`).toContain(lots[made[0]!.lot]!.block);
      expect(lots[made[0]!.lot]!.role).toBe("municipal");
      // Where it already stands it changes nothing.
      const before = JSON.stringify(buildings);
      ensureMunicipal(plan.downtown, lots, buildings);
      expect(JSON.stringify(buildings)).toBe(before);
    }
  });
});

describe("the town says nothing of the FBI", () => {
  it("has no sign, landmark, history line or map label that names the FBI, a bureau or a federal agency", () => {
    const bad = /\bFBI\b|bureau|federal agency|resident agency/i;
    for (const { seed, plan } of towns()) {
      const texts: string[] = [plan.name];
      for (const l of plan.landmarks) texts.push(l.name, l.text);
      for (const e of plan.history.events) texts.push(JSON.stringify(e));
      for (const u of plan.uses) {
        for (const s of u.signs) texts.push(...s.lines);
        for (const x of u.units) {
          if (x.tenant) texts.push(x.tenant.name);
          for (const s of x.signs) texts.push(...s.lines);
        }
      }
      for (const t of texts) expect(t, `seed ${seed}`).not.toMatch(bad);
      const svg = planSvg(plan, townFor(seed).site, { width: 800 });
      expect(svg, `seed ${seed}: the map`).not.toMatch(bad);
    }
  });

  it("has no text in the game's source that says FBI, Bureau or federal agency", () => {
    const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(dir + f).isDirectory() ? walk(`${dir}${f}/`) : [dir + f]));
    for (const path of walk(SRC)) {
      if (!/\.(ts|html|css|json)$/.test(path)) continue;
      expect(readFileSync(path, "utf8"), path.slice(SRC.length)).not.toMatch(/\bFBI\b|\bBureau\b|federal agency/i);
    }
  });
});

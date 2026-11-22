import { describe, expect, it } from "vitest";
import { COMPASS, gridAngle } from "../../src/sim/town/bearings.js";
import { contains } from "../../src/sim/town/geom.js";
import { analyseShore, shoreAt } from "../../src/sim/town/shore.js";
import { SEEDS, townFor } from "./sites.js";

const dec = (y: number): number => Math.floor(y / 10) * 10;

describe("the history is drawn from what the research found", () => {
  it("keeps every year and choice within the ranges of the brief", () => {
    for (const seed of SEEDS) {
      const h = townFor(seed).plan.history;
      expect(h.founding.year).toBeGreaterThanOrEqual(1851);
      expect(h.founding.year).toBeLessThanOrEqual(1889);
      expect(h.secondPlat.year).toBeGreaterThanOrEqual(1883);
      expect(h.secondPlat.year).toBeLessThanOrEqual(1892);
      expect(h.secondPlat.year).toBeGreaterThan(h.firstPlat.year);
      if (h.fire) {
        expect(h.fire.year).toBeGreaterThanOrEqual(1889);
        expect(h.fire.year).toBeLessThanOrEqual(1922);
      }
      expect(h.port.year).toBeGreaterThanOrEqual(1911);
      if (h.mill.fate === "closed") {
        expect(h.mill.closedYear).toBeGreaterThanOrEqual(1980);
        expect(h.mill.closedYear).toBeLessThanOrEqual(2009);
      } else {
        expect(h.mill.closedYear).toBeNull();
      }
      expect(h.present.vacantShare).toBeGreaterThan(0);
      expect(h.present.vacantShare).toBeLessThanOrEqual(0.45);
    }
  });

  it("lists dated events in order, each a readable sentence, and none about Native places", () => {
    for (const seed of SEEDS) {
      const { events } = townFor(seed).plan.history;
      expect(events.length).toBeGreaterThanOrEqual(8);
      for (let i = 1; i < events.length; i++) expect(events[i]!.year).toBeGreaterThanOrEqual(events[i - 1]!.year);
      for (const e of events) {
        expect(e.text.length).toBeGreaterThan(30);
        expect(e.text.endsWith(".")).toBe(true);
        expect(e.text).not.toMatch(/\b(native|tribal|tribe|village|burial|indian|reservation)\b/i);
      }
    }
  });
});

describe("form follows history", () => {
  it("a town that burned has a core of the later era and material", () => {
    let burned = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const fire = plan.history.fire;
      if (!fire) continue;
      burned++;
      const core = plan.buildings.filter((b) => b.lot >= 0 && plan.lots[b.lot]!.district === "core");
      expect(core.length).toBeGreaterThan(10);
      for (const b of core) {
        expect(b.era, `seed ${seed} ${b.kind}`).toBeGreaterThanOrEqual(dec(fire.year));
        expect(b.material, `seed ${seed} ${b.kind}`).not.toBe("wood");
      }
    }
    expect(burned).toBeGreaterThan(10);
  });

  it("a town that did not burn keeps an older core, some of it in wood", () => {
    let wood = 0;
    let towns = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      if (plan.history.fire) continue;
      towns++;
      const core = plan.buildings.filter((b) => b.lot >= 0 && plan.lots[b.lot]!.district === "core");
      if (core.some((b) => b.material === "wood")) wood++;
      expect(Math.min(...core.map((b) => b.era))).toBeLessThan(1920);
    }
    expect(towns).toBeGreaterThan(5);
    expect(wood).toBeGreaterThan(0);
  });

  it("the rail line is there when the history has a railroad, and only then", () => {
    let with_ = 0;
    let without = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const rails = plan.streets.filter((s) => s.kind === "rail");
      if (plan.history.railroad) {
        with_++;
        expect(rails.length).toBeGreaterThan(0);
        expect(plan.landmarks.some((l) => l.role === "depot")).toBe(true);
      } else {
        without++;
        expect(rails).toEqual([]);
        expect(plan.landmarks.some((l) => l.role === "depot")).toBe(false);
      }
    }
    expect(with_).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
  });

  it("the rail line runs along the quay and the flats' shore, landward of the water", () => {
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      const rails = plan.streets.filter((s) => s.kind === "rail");
      if (!plan.history.railroad) continue;
      // One piece along the quay, and pieces along the shore of the flats.
      expect(rails.some((r) => r.plat === "old"), `seed ${seed}`).toBe(true);
      expect(rails.some((r) => r.plat === "company"), `seed ${seed}`).toBe(true);
      for (const r of rails) {
        const mid = { x: (r.a.x + r.b.x) / 2, z: (r.a.z + r.b.z) / 2 };
        const onMade = mid.x > shoreAt(site, mid.z) || plan.fill.some((f) => contains(f.polygon, mid, 0.5));
        expect(onMade, `seed ${seed}: the rail stands in the sea`).toBe(true);
      }
    }
  });

  it("a county seat has a courthouse, and no other town has one", () => {
    let seats = 0;
    let others = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const courthouses = plan.buildings.filter((b) => b.kind === "courthouse");
      const landmarks = plan.landmarks.filter((l) => l.role === "courthouse");
      if (plan.history.countySeat.isSeat) {
        seats++;
        expect(courthouses.length).toBe(1);
        expect(landmarks.length).toBe(1);
        expect(landmarks[0]!.building).toBe(courthouses[0]!.id);
      } else {
        others++;
        expect(courthouses).toEqual([]);
        expect(landmarks).toEqual([]);
      }
    }
    expect(seats).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
  });

  it("a closed mill's site has no open mill building, a working mill's has", () => {
    let closed = 0;
    let working = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const sheds = plan.buildings.filter((b) => b.kind === "mill shed");
      expect(sheds.length, `seed ${seed}`).toBeGreaterThan(0);
      const mill = plan.landmarks.find((l) => l.role === "mill");
      expect(mill, `seed ${seed}`).toBeDefined();
      if (plan.history.mill.fate === "closed") {
        closed++;
        for (const s of sheds) expect(s.state, `seed ${seed}`).not.toBe("open");
        expect(plan.buildings[mill!.building]!.state).not.toBe("open");
      } else {
        working++;
        expect(sheds.some((s) => s.state === "open")).toBe(true);
      }
    }
    expect(closed).toBeGreaterThan(0);
    expect(working).toBeGreaterThan(0);
  });

  it("a cleared mill site has fewer buildings than an untouched one", () => {
    let cleared = 0;
    let untouched = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      if (plan.history.mill.fate !== "closed") continue;
      const n = plan.buildings.filter((b) => b.kind === "mill shed" || (b.lot >= 0 && plan.lots[b.lot]!.district === "mill")).length;
      if (plan.history.mill.cleanup) cleared += n;
      else untouched += n;
    }
    expect(cleared).toBeLessThan(untouched * 2); // loosely: per town, cleanup leaves far less; both sums are over unequal counts
  });

  it("the seam exists whenever two plats do and their bearings differ by at least 25 degrees, and is where they actually touch", () => {
    let wide = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      expect(plan.plats.length).toBeGreaterThanOrEqual(2);
      const [a, b] = plan.plats;
      const angle = gridAngle(a!.bearing, b!.bearing);
      // The geometry of the coast allows 12 to 37 degrees between the old grid and the compass.
      expect(angle, `seed ${seed}`).toBeGreaterThanOrEqual(12);
      expect(angle, `seed ${seed}`).toBeLessThanOrEqual(37.5);
      if (angle >= 25) wide++;
      // The two plats touch (the compass blocks wrap the old plat), so there is a seam.
      expect(plan.seams.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      for (const seam of plan.seams) {
        expect(seam.angle).toBeCloseTo(angle, 5);
        expect(plan.streets[seam.street]!.seam, `seed ${seed}`).toBe(true);
      }
      // Company blocks are cut: some have 3, 5 or 6 corners.
      expect(plan.blocks.filter((x) => x.plat === "company" && x.polygon.length !== 4).length, `seed ${seed}`).toBeGreaterThan(0);
    }
    expect(wide).toBeGreaterThan(10);
  });

  it("the old plat is laid to what the history says: the highway's own line, the first wharf or a railroad's survey", () => {
    const bases: string[] = [];
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      const shore = analyseShore(site);
      const f = plan.history.firstPlat;
      bases.push(f.basis);
      expect(plan.plats[0]!.bearing).toEqual(f.bearing);
      expect(plan.plats[1]!.bearing).toEqual(COMPASS);
      const sentence = plan.history.events.find((e) => e.kind === "first plat")!.text;
      if (f.basis === "road") {
        // The highway runs 12 degrees or more off north, and the plat is laid to the triple nearest it.
        expect(Math.abs(shore.roadBearing.deg), `seed ${seed}`).toBeGreaterThanOrEqual(12);
        expect(f.bearing).toEqual(shore.roadBearing);
        expect(sentence).toMatch(/wagon road/);
        // The highway is then the main street: no street of the plat's own is called main.
        expect(plan.streets.some((s) => s.kind === "main")).toBe(false);
      } else {
        // The highway runs near north, so the history says what the plat was laid to instead, 22 to 37 degrees off the compass.
        expect(Math.abs(shore.roadBearing.deg), `seed ${seed}`).toBeLessThan(12);
        expect(Math.abs(f.bearing.deg)).toBeGreaterThanOrEqual(22);
        expect(Math.abs(f.bearing.deg)).toBeLessThanOrEqual(37);
        expect(sentence).toMatch(f.basis === "wharf" ? /wharf/ : /survey/);
        expect(plan.streets.some((s) => s.kind === "main")).toBe(true);
      }
    }
    expect(bases).toContain("road");
    expect(bases.some((b) => b !== "road")).toBe(true);
  });

  it("the core's vacancy is the share the present-day layer names", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const shops = plan.buildings.filter((b) => b.lot >= 0 && plan.lots[b.lot]!.district === "core" && ["storefront", "tavern", "office"].includes(b.kind) && !plan.landmarks.some((l) => l.building === b.id));
      const vacant = shops.filter((b) => b.state === "vacant").length;
      expect(Math.abs(vacant / shops.length - plan.history.present.vacantShare), `seed ${seed}`).toBeLessThanOrEqual(1 / shops.length + 0.001);
    }
  });

  it("a tsunami refuge is on the map when the history has one, and only then", () => {
    let yes = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const refuge = plan.landmarks.some((l) => l.role === "tsunami refuge");
      expect(plan.buildings.some((b) => b.kind === "tsunami refuge")).toBe(refuge);
      if (!plan.history.present.tsunamiRefuge) expect(refuge).toBe(false);
      if (refuge) yes++;
    }
    expect(yes).toBeGreaterThan(5);
  });

  it("the main street is wider after a fire, and one wide avenue is 30 m", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const main = plan.streets.find((s) => s.kind === "main");
      // Where the highway is the old town's main street there is no other; elsewhere it is 24 m after a fire and 20 m before.
      if (main) expect(main.width).toBe(plan.history.fire ? 24 : 20);
      const avenue = plan.streets.filter((s) => s.kind === "avenue");
      expect(avenue.length).toBeGreaterThan(0);
      for (const a of avenue) expect(a.width).toBe(30);
      expect(new Set(plan.streets.filter((s) => s.kind !== "alley" && s.kind !== "wharf" && s.kind !== "rail").map((s) => s.width)).size).toBeLessThanOrEqual(6);
    }
  });
});

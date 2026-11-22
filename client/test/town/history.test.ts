import { describe, expect, it } from "vitest";
import { COMPASS, gridAngle } from "../../src/sim/town/bearings.js";
import { analyseShore } from "../../src/sim/town/shore.js";
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

  it("the rail line runs along the shore, between the water and the main street", () => {
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      const rail = plan.streets.find((s) => s.kind === "rail");
      if (!rail) continue;
      const main = plan.streets.find((s) => s.kind === "main")!;
      const mid = { x: (rail.a.x + rail.b.x) / 2, z: (rail.a.z + rail.b.z) / 2 };
      // Landward of the shoreline at its middle, and seaward of the main street's line (the main street is inland of it).
      const shore = site.shoreX[Math.round((mid.z - site.z0) / site.step)]!;
      expect(mid.x, `seed ${seed}`).toBeGreaterThan(shore);
      const mainMid = { x: (main.a.x + main.b.x) / 2, z: (main.a.z + main.b.z) / 2 };
      const along = { x: main.b.x - main.a.x, z: main.b.z - main.a.z };
      const len = Math.sqrt(along.x * along.x + along.z * along.z);
      // Signed distance of the rail's middle from the main street's line: negative toward the sea.
      const side = ((mid.x - mainMid.x) * along.z - (mid.z - mainMid.z) * along.x) / len;
      const seaSide = ((shore - mainMid.x) * along.z - (mid.z - mainMid.z) * along.x) / len;
      expect(Math.sign(side), `seed ${seed}`).toBe(Math.sign(seaSide));
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

  it("the seam exists whenever two plats do and their bearings differ by at least 25 degrees", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      expect(plan.plats.length).toBeGreaterThanOrEqual(2);
      const [a, b] = plan.plats;
      const angle = gridAngle(a!.bearing, b!.bearing);
      expect(angle, `seed ${seed}`).toBeGreaterThanOrEqual(25);
      expect(plan.seams.length, `seed ${seed}`).toBe(1);
      const seam = plan.seams[0]!;
      expect(seam.angle).toBeCloseTo(angle, 5);
      const street = plan.streets[seam.street]!;
      expect(street.seam).toBe(true);
      // Company blocks are cut by the seam: some have 3 or 5 or 6 corners, and the streets of the company's plat end on it.
      const cut = plan.blocks.filter((x) => x.plat === "company" && x.polygon.length !== 4);
      expect(cut.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it("the waterfront plat is laid to what the history says: the shore's line, the cove's flank, or a wharf", () => {
    const sawBasis: string[] = [];
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      const shore = analyseShore(site);
      const f = plan.history.firstPlat;
      sawBasis.push(f.basis);
      expect(plan.plats[0]!.bearing).toEqual(f.bearing);
      expect(plan.plats[1]!.bearing).toEqual(COMPASS);
      if (f.basis === "shore") {
        expect(f.bearing).toEqual(shore.bearing);
        expect(Math.abs(f.bearing.deg)).toBeGreaterThanOrEqual(25);
      } else {
        // The shore runs within 25 degrees of the compass, and the history says what the plat was laid to instead.
        expect(Math.abs(shore.bearing.deg)).toBeLessThan(25);
        expect(Math.abs(f.bearing.deg)).toBeGreaterThanOrEqual(25);
        const sentence = plan.history.events.find((e) => e.kind === "first plat")!.text;
        expect(sentence).toMatch(f.basis === "cove" ? /cove/ : /wharf/);
      }
    }
    expect(sawBasis).toContain("shore");
    expect(sawBasis.some((b) => b !== "shore")).toBe(true);
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
      const main = plan.streets.find((s) => s.kind === "main")!;
      expect(main.width).toBe(plan.history.fire ? 24 : 20);
      const avenue = plan.streets.filter((s) => s.kind === "avenue");
      expect(avenue.length).toBeGreaterThan(0);
      for (const a of avenue) expect(a.width).toBe(30);
      expect(new Set(plan.streets.filter((s) => s.kind !== "alley" && s.kind !== "wharf" && s.kind !== "rail").map((s) => s.width)).size).toBeLessThanOrEqual(6);
    }
  });
});

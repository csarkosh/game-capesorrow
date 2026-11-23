import { describe, expect, it } from "vitest";
import { OWNER_SURNAMES } from "../../src/sim/town/names.js";
import { GROUPS, MARINE, OSM_GROUP_COUNT, OSM_TOTAL, TRADES, tradeDef } from "../../src/sim/town/port/business/trades.js";
import { STAGE } from "../../src/sim/town/rng.js";
import type { BuildingUse, Furnishing, Trade, TownPlan, Unit } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

const towns = (): TownPlan[] => SEEDS.map((s) => townFor(s).plan);

/** Real brands, chains and franchises that must never appear in a name or a sign (a short deny list: the generator invents its own). */
const DENY = [
  "safeway", "walmart", "wal-mart", "starbucks", "mcdonald", "burger king", "subway", "rite aid", "fred meyer", "ace hardware", "shell", "chevron", "texaco",
  "arco", "dairy queen", "taco bell", "kfc", "domino", "pizza hut", "napa", "o'reilly", "les schwab", "bank of america", "wells fargo", "us bank", "keybank",
  "umpqua", "costco", "target", "dollar tree", "dollar general", "rexall", "kmart", "mobil", "exxon", "union 76", "jackson hewitt", "super 8", "motel 6",
  "best western", "holiday inn", "days inn", "comfort inn", "red lion", "wendy", "jack in the box", "arby", "papa john", "autozone", "carquest", "coca-cola", "pepsi",
];

function everyName(plan: TownPlan): string[] {
  const out: string[] = [];
  for (const u of plan.uses) {
    for (const x of u.units) {
      if (x.tenant) out.push(x.tenant.name);
      for (const p of x.past) out.push(p.name);
    }
  }
  return out;
}

function everyText(plan: TownPlan): string[] {
  const out = everyName(plan);
  for (const u of plan.uses) {
    for (const s of u.signs) out.push(...s.lines);
    for (const x of u.units) for (const s of x.signs) out.push(...s.lines);
  }
  return out;
}

/** The same tests the generator's own placement keeps: the box's bounds in the room's frame. */
function bounds(f: Furnishing): { x0: number; x1: number; z0: number; z1: number } {
  const ex = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
  const ez = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
  return { x0: f.s - ex, x1: f.s + ex, z0: f.d - ez, z1: f.d + ez };
}

const fishes = (plan: TownPlan): boolean =>
  plan.history.port.handles === "seafood" ||
  plan.history.founding.purpose === "cannery" ||
  plan.buildings.some((b) => b.kind === "cannery") ||
  plan.harbour.boats.filter((b) => b.state === "working" && (b.kind === "troller" || b.kind === "gillnetter" || b.kind === "crabber")).length >= 3;

const allUnits = (plan: TownPlan): { use: BuildingUse; unit: Unit }[] => plan.uses.flatMap((use) => use.units.map((unit) => ({ use, unit })));

describe("what is in the buildings: units, tenants, names", () => {
  it("has its own random stream, and one entry for every building, in order", () => {
    const others = Object.entries(STAGE).filter(([k]) => k !== "business").map(([, v]) => v);
    expect(others).not.toContain(STAGE.business);
    for (const plan of towns()) {
      expect(plan.uses.length).toBe(plan.buildings.length);
      plan.uses.forEach((u, i) => expect(u.building).toBe(i));
    }
  });

  it("tiles every building's street front exactly with its units, whose doors and windows lie inside them", () => {
    for (const plan of towns()) {
      for (const use of plan.uses) {
        if (use.units.length === 0) continue;
        const W = use.frame!.width;
        expect(use.units[0]!.s0, `b${use.building} start`).toBe(0);
        expect(use.units[use.units.length - 1]!.s1, `b${use.building} end`).toBe(W);
        use.units.forEach((u, i) => {
          if (i > 0) expect(u.s0, `b${use.building} unit ${i}`).toBe(use.units[i - 1]!.s1);
          expect(u.s1).toBeGreaterThan(u.s0 + 3.5);
          expect(u.door.s - u.door.width / 2).toBeGreaterThanOrEqual(u.s0);
          expect(u.door.s + u.door.width / 2).toBeLessThanOrEqual(u.s1);
          for (const o of u.openings) {
            expect(o.s0).toBeGreaterThanOrEqual(u.s0);
            expect(o.s1).toBeLessThanOrEqual(u.s1);
            expect(o.s1).toBeGreaterThan(o.s0);
            // No opening takes the door's place.
            expect(o.s1 <= u.door.s - u.door.width / 2 + 1e-9 || o.s0 >= u.door.s + u.door.width / 2 - 1e-9, `b${use.building} opening over the door`).toBe(true);
          }
        });
        if (use.stair) {
          const u = use.units.find((x) => use.stair!.s >= x.s0 && use.stair!.s <= x.s1)!;
          expect(u, "the stair door lies in a unit's frontage").toBeDefined();
          expect(Math.abs(use.stair.s - u.door.s)).toBeGreaterThan((use.stair.width + u.door.width) / 2);
          for (const o of u.openings) expect(o.s1 <= use.stair.s - use.stair.width / 2 + 1e-9 || o.s0 >= use.stair.s + use.stair.width / 2 - 1e-9).toBe(true);
        }
      }
    }
  });

  it("gives every open commercial unit a trade, a name, a decade and at least one sign that names it; and a ruin has no units", () => {
    for (const plan of towns()) {
      for (const { use, unit } of allUnits(plan)) {
        const b = plan.buildings[use.building]!;
        expect(b.state, "a ruin has no units").not.toBe("ruin");
        if (unit.state === "open" || unit.state === "closed for the day") {
          expect(unit.tenant, `b${b.id}`).not.toBeNull();
          expect(unit.tenant!.trade).toBeTruthy();
          expect(unit.tenant!.name.length).toBeGreaterThan(2);
          expect(unit.signs.length).toBeGreaterThanOrEqual(1);
          expect(unit.signs.some((s) => !s.mismatch && (s.lines.some((l) => l.toLowerCase().includes(unit.tenant!.name.toLowerCase())) || s.kind === "fascia" || s.kind === "wall" || s.kind === "blade" || s.kind === "pole")), `b${b.id} a sign that names the tenant`).toBe(true);
          expect(unit.lit).toBe(unit.state === "open");
        } else {
          expect(unit.tenant).toBeNull();
          expect(unit.vacantSince).not.toBeNull();
          expect(unit.signs.some((s) => s.kind === "lease"), "a vacant unit has its notice").toBe(true);
          expect(unit.interior.type).toBe("empty");
          expect(unit.lit).toBe(false);
        }
      }
    }
  });

  it("keeps every business name unique in its town, and free of real brands", () => {
    for (const plan of towns()) {
      const names = everyName(plan).map((n) => n.toLowerCase());
      const landmark = plan.landmarks.map((l) => l.name.toLowerCase());
      expect(new Set(names).size, `seed ${plan.seed}: a name is used twice`).toBe(names.length);
      // A landmark's name is its building's tenant's, once; no other business takes it.
      for (const l of landmark) expect(names.filter((n) => n === l).length).toBeLessThanOrEqual(1);
      for (const text of everyText(plan)) {
        const t = text.toLowerCase();
        for (const bad of DENY) expect(t.includes(bad), `seed ${plan.seed}: "${text}" holds the real brand "${bad}"`).toBe(false);
      }
    }
  });

  it("names a few businesses for families that also have a street or a landmark, and not most", () => {
    let towns40 = 0;
    let shared = 0;
    let all = 0;
    for (const plan of towns()) {
      const words = [...plan.streets.map((s) => s.name), ...plan.landmarks.map((l) => l.name), plan.name, plan.history.founding.founder].join(" | ");
      let n = 0;
      for (const { unit } of allUnits(plan)) {
        if (!unit.tenant) continue;
        all++;
        const sn = OWNER_SURNAMES.find((s) => unit.tenant!.name.includes(s) && !unit.tenant!.name.startsWith(s + " Street"));
        if (sn !== undefined && words.includes(sn)) {
          n++;
          shared++;
        }
      }
      if (n >= 1) towns40++;
    }
    expect(towns40, "towns with a business named for a family on a street or a landmark").toBeGreaterThanOrEqual(35);
    expect(shared / all, "the share of businesses so named").toBeLessThan(0.3);
  });
});

describe("trades follow the town's history", () => {
  it("has marine trades only in a fishing port, and bait and tackle and marine supply in every one", () => {
    let fishing = 0;
    for (const plan of towns()) {
      const marine = MARINE as readonly Trade[];
      const found: string[] = [];
      for (const { unit } of allUnits(plan)) {
        if (unit.tenant && marine.includes(unit.tenant.trade)) found.push(unit.tenant.trade);
        for (const p of unit.past) if (marine.includes(p.trade)) found.push(p.trade);
      }
      if (fishes(plan)) {
        fishing++;
        expect(found, `seed ${plan.seed}`).toContain("bait and tackle");
        expect(found, `seed ${plan.seed}`).toContain("marine supply");
      } else expect(found, `seed ${plan.seed}: no fishing, no marine trade`).toEqual([]);
    }
    expect(fishing, "some towns fish and some do not").toBeGreaterThan(5);
    expect(fishing).toBeLessThan(40);
  });

  it("has a union hall in a mill town (founded for the mill, or its mill still working) and in no other", () => {
    for (const plan of towns()) {
      const millTown = plan.history.founding.purpose === "sawmill" || plan.history.mill.fate === "working";
      const n = allUnits(plan).filter((x) => x.unit.tenant?.trade === "union hall").length;
      expect(n, `seed ${plan.seed}`).toBe(millTown ? 1 : 0);
    }
  });

  it("has lawyers and a title company at a county seat, and no title company or bail bondsman elsewhere", () => {
    let seats = 0;
    for (const plan of towns()) {
      const have = (t: Trade): number => allUnits(plan).filter((x) => x.unit.tenant?.trade === t).length;
      const past = (t: Trade): number => allUnits(plan).filter((x) => x.unit.past.some((p) => p.trade === t)).length;
      if (plan.history.countySeat.isSeat) {
        seats++;
        expect(have("title company"), `seed ${plan.seed}`).toBeGreaterThanOrEqual(1);
        expect(have("law office"), `seed ${plan.seed}`).toBeGreaterThanOrEqual(1);
      } else {
        expect(have("title company") + have("bail bonds") + past("title company") + past("bail bonds"), `seed ${plan.seed}`).toBe(0);
      }
    }
    expect(seats).toBeGreaterThan(3);
  });

  it("has kites and taffy only on the tourist road", () => {
    for (const plan of towns()) {
      const n = allUnits(plan).filter((x) => x.unit.tenant?.trade === "kite shop" || x.unit.tenant?.trade === "candy shop" || x.unit.past.some((p) => p.trade === "kite shop" || p.trade === "candy shop")).length;
      if (!plan.history.present.highwayStrip) expect(n, `seed ${plan.seed}`).toBe(0);
    }
  });

  it("opens no trade before it existed, and no tenant before its building", () => {
    for (const plan of towns()) {
      for (const { use, unit } of allUnits(plan)) {
        const b = plan.buildings[use.building]!;
        const eraD = Math.floor(b.era / 10) * 10;
        if (unit.tenant) {
          expect(unit.tenant.opened, `b${b.id} ${unit.tenant.trade}`).toBeGreaterThanOrEqual(eraD);
          expect(unit.tenant.opened).toBeGreaterThanOrEqual(tradeDef(unit.tenant.trade).from);
          expect(tradeDef(unit.tenant.trade).until, `${unit.tenant.trade} is past only`).toBeNull();
        }
        let prevTo = 0;
        for (const p of unit.past) {
          expect(p.from, `b${b.id} past ${p.trade}`).toBeGreaterThanOrEqual(eraD);
          expect(p.to).toBeGreaterThanOrEqual(p.from);
          expect(p.from).toBeGreaterThanOrEqual(prevTo - 10);
          expect(p.from + 9).toBeGreaterThanOrEqual(tradeDef(p.trade).from);
          const until = tradeDef(p.trade).until;
          if (until !== null) expect(p.from).toBeLessThanOrEqual(until);
          prevTo = p.from;
        }
        if (unit.vacantSince !== null) {
          expect(unit.vacantSince).toBeGreaterThanOrEqual(eraD);
          expect(unit.vacantSince).toBeLessThan(2026);
          expect(unit.past.length, "a vacant unit had a last tenant").toBeGreaterThanOrEqual(1);
          expect(unit.past[unit.past.length - 1]!.to).toBe(unit.vacantSince);
        }
      }
    }
  });

  it("gives an old building several tenants in its life", () => {
    let old = 0;
    let withPast = 0;
    let total = 0;
    for (const plan of towns()) {
      for (const { use, unit } of allUnits(plan)) {
        const b = plan.buildings[use.building]!;
        if (b.era > 1910 || !unit.tenant || unit.tenant.opened < 1980) continue;
        old++;
        if (unit.past.length >= 1) withPast++;
        total += unit.past.length;
      }
    }
    expect(old).toBeGreaterThan(100);
    expect(withPast / old).toBeGreaterThan(0.85);
    expect(total / old).toBeGreaterThan(1.8);
  });

  it("has one post office, and the essentials, in every town", () => {
    for (const plan of towns()) {
      const have = (t: Trade): number => allUnits(plan).filter((x) => x.unit.tenant?.trade === t).length;
      expect(have("post office"), `seed ${plan.seed}`).toBe(1);
      expect(have("grocery"), `seed ${plan.seed}`).toBeGreaterThanOrEqual(1);
      expect(have("cafe"), `seed ${plan.seed}`).toBeGreaterThanOrEqual(1);
      expect(have("hardware"), `seed ${plan.seed}`).toBeGreaterThanOrEqual(1);
      expect(have("bank") + have("credit union"), `seed ${plan.seed}`).toBeLessThanOrEqual(5);
    }
  });

  it("follows the counted mix of real coastal towns within a stated tolerance", () => {
    // Over the 40 towns' tenants: each group's share is within 5 points of OSM's. A tavern is fixed by the plan's own tavern
    // buildings (about 7 a town, the plan's, not this stage's) so its tolerance is 7; marine trades are a fishing port's alone, 3.
    const got: Record<string, number> = {};
    let n = 0;
    for (const plan of towns()) {
      for (const { unit } of allUnits(plan)) {
        const g = unit.tenant ? tradeDef(unit.tenant.trade).group : null;
        if (g === null) continue;
        got[g] = (got[g] ?? 0) + 1;
        n++;
      }
    }
    // The business street is a third shorter than it was (the town-size change), so the forty towns hold fewer units: it was 2000.
    expect(n).toBeGreaterThan(1200);
    for (const g of GROUPS) {
      const gen = (100 * (got[g] ?? 0)) / n;
      const osm = (100 * OSM_GROUP_COUNT[g]) / OSM_TOTAL;
      const tol = g === "tavern" ? 7 : g === "marine" ? 3 : 5;
      expect(Math.abs(gen - osm), `${g}: generated ${gen.toFixed(1)}% against counted ${osm.toFixed(1)}%`).toBeLessThanOrEqual(tol);
    }
    // The table's own weights are the counts.
    for (const g of GROUPS) {
      const w = TRADES.filter((d) => d.group === g).reduce((a, d) => a + d.w, 0);
      expect(w, `the weights of ${g} are its count`).toBe(OSM_GROUP_COUNT[g]);
    }
  });
});

describe("signs", () => {
  it("are of the style of their decade, in condition 0 to 1, and lit only by an open unit", () => {
    for (const plan of towns()) {
      for (const use of plan.uses) {
        const sets = [...use.signs.map((s) => ({ s, state: "open" as string })), ...use.units.flatMap((u) => u.signs.map((s) => ({ s, state: u.state })))];
        for (const { s, state } of sets) {
          expect(s.condition).toBeGreaterThanOrEqual(0);
          expect(s.condition).toBeLessThanOrEqual(1);
          // Boards and pole signs may be lit boxes or painted wood whatever their decade (a reader board, a courthouse's carving); the rest follow it.
          if (s.kind !== "ghost" && s.kind !== "banner" && s.kind !== "open" && s.kind !== "board" && s.kind !== "pole" && s.style !== "hand-painted") {
            const expected = s.decade < 1950 ? "hand-painted" : s.decade < 1970 ? "neon and porcelain" : s.decade < 2000 ? "backlit box" : "vinyl";
            expect(s.style, `${s.kind} of ${s.decade}`).toBe(expected);
          }
          if (s.kind === "banner") expect(s.style).toBe("vinyl");
          if (s.lit) expect(state === "open" || state === "closed for the day" ? state : "open", `${s.kind} lit in a ${state} unit`).toBe("open");
          expect(s.lines.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("include ghost signs on old brick, signs that no longer match their trade, and not every kind everywhere", () => {
    const kinds = new Set<string>();
    let ghost = 0;
    let mismatch = 0;
    let units = 0;
    let signs = 0;
    for (const plan of towns()) {
      for (const { use, unit } of allUnits(plan)) {
        const b = plan.buildings[use.building]!;
        units++;
        signs += unit.signs.length;
        for (const s of unit.signs) {
          kinds.add(s.kind);
          if (s.kind === "ghost") {
            ghost++;
            expect(b.material, "a ghost sign is painted on old brick").toBe("brick");
            expect(s.condition).toBeLessThan(0.3);
          }
          if (s.mismatch && s.kind === "fascia") mismatch++;
        }
      }
    }
    for (const k of ["fascia", "blade", "glass", "wall", "pole", "sandwich", "banner", "open", "lease", "ghost"]) expect(kinds.has(k), `a ${k} sign exists`).toBe(true);
    expect(ghost).toBeGreaterThan(20);
    expect(mismatch).toBeGreaterThan(50);
    expect(signs / units, "most units have one or two signs").toBeGreaterThan(1.4);
    expect(signs / units).toBeLessThan(3);
  });

  it("put the right things on the civic buildings, gas stations and motels", () => {
    let church = 0;
    let gas = 0;
    let motel = 0;
    let terminal = 0;
    for (const plan of towns()) {
      for (const use of plan.uses) {
        const b = plan.buildings[use.building]!;
        if (b.kind === "church") {
          church++;
          expect(use.signs.some((s) => s.kind === "board" && s.lines.length >= 2 && /(WORSHIP|SERVICE|MASS)/.test(s.lines.join(" "))), "a church's board gives its name and service times").toBe(true);
        }
        if (b.kind === "school") expect(use.signs.some((s) => s.lines.some((l) => /HOME OF THE/.test(l))) && use.signs.length >= 2).toBe(true);
        if (b.kind === "federal building") expect(use.signs.some((s) => s.lines[0] === "UNITED STATES POST OFFICE")).toBe(true);
        if (b.kind === "fire hall") expect(use.signs.some((s) => /FIRE DISTRICT No\. \d+/.test(s.lines.join(" ")))).toBe(true);
        if (b.kind === "port terminal shed" && b.lot >= 0) {
          terminal++;
          expect(use.signs.some((s) => s.lines.some((l) => l.startsWith("PORT OF")) && s.lines.some((l) => l.startsWith("TENANT:")))).toBe(true);
        }
        if (b.kind === "gas station") {
          for (const u of use.units) {
            if (!u.tenant) continue;
            gas++;
            const pole = u.signs.find((s) => s.kind === "pole" && s.lines.some((l) => l.startsWith("REGULAR")))!;
            expect(pole, "a gas station's price sign").toBeDefined();
            for (const l of pole.lines.filter((x) => /\d\.\d\d9$/.test(x))) {
              const price = Number(l.split(" ").pop());
              expect(price).toBeGreaterThan(4.4);
              expect(price).toBeLessThan(6.1);
            }
          }
        }
        if (b.kind === "motel") {
          for (const u of use.units) {
            if (!u.tenant) continue;
            motel++;
            expect(u.signs.some((s) => s.kind === "pole" && s.lines.some((l) => /VACANCY|WEEKLY RATES/.test(l)))).toBe(true);
          }
        }
      }
    }
    expect(church + gas + motel + terminal).toBeGreaterThan(100);
  });
});

describe("rooms", () => {
  it("keep every piece of furniture inside its room and out of the door's way", () => {
    let boxes = 0;
    let units = 0;
    const counts: number[] = [];
    for (const plan of towns()) {
      for (const { use, unit } of allUnits(plan)) {
        const room = unit.interior;
        expect(room.depth, "the room lies within the building").toBeLessThanOrEqual(use.frame!.depth);
        expect(room.ceiling).toBeGreaterThan(2.4);
        units++;
        counts.push(room.furnishings.length);
        const z0 = unit.door.s - unit.door.width / 2 - 0.45;
        const z1 = unit.door.s + unit.door.width / 2 + 0.45;
        for (const f of room.furnishings) {
          boxes++;
          const b = bounds(f);
          expect(b.x0, `b${use.building} ${f.kind}`).toBeGreaterThanOrEqual(unit.s0);
          expect(b.x1).toBeLessThanOrEqual(unit.s1);
          expect(b.z0).toBeGreaterThanOrEqual(0);
          expect(b.z1).toBeLessThanOrEqual(room.depth);
          expect(!(b.x1 > z0 && b.x0 < z1 && b.z0 < 2.4), `b${use.building} ${f.kind} in the door's way`).toBe(true);
          expect(Math.abs(Math.sqrt(f.dir.x * f.dir.x + f.dir.z * f.dir.z) - 1)).toBeLessThan(1e-9);
        }
        for (const l of room.lights) {
          expect(l.s).toBeGreaterThanOrEqual(unit.s0);
          expect(l.s).toBeLessThanOrEqual(unit.s1);
          expect(l.on).toBe(unit.lit);
        }
        expect(room.lights.length).toBeGreaterThan(0);
        // Something in the window, for a unit with one and an interior to show.
        if (unit.tenant && unit.interior.type !== "empty" && unit.openings.length > 0 && unit.interior.type !== "workshop") {
          const inWindow = room.furnishings.some((f) => f.d < 1.4 && unit.openings.some((o) => f.s >= o.s0 - 0.2 && f.s <= o.s1 + 0.2));
          // An opening beside the door has the span outside the door's zone for a display; a sliver has none.
          const usable = unit.openings.map((o) => o.s1 - o.s0 - Math.max(0, Math.min(o.s1, z1) - Math.max(o.s0, z0)));
          expect(inWindow || usable.every((u) => u < 0.9), `b${use.building} ${unit.tenant.trade}: something in the window`).toBe(true);
        }
        if (unit.interior.type === "empty") expect(room.furnishings.some((f) => f.kind === "ladder" || f.kind === "paint cans")).toBe(true);
      }
    }
    counts.sort((a, b) => a - b);
    expect(boxes).toBeGreaterThan(1000);
    expect(counts[Math.floor(counts.length * 0.1)]!, "a typical unit holds 6 to 40 boxes (tenth percentile)").toBeGreaterThanOrEqual(4);
    expect(counts[Math.floor(counts.length * 0.5)]!).toBeGreaterThanOrEqual(6);
    // The cap rose from 24 to 80 with the rows of tables, the aisles with their endcaps and the checkout lanes (the chairs, the stock and what stands on them are drawn from the anchors, not planned).
    expect(counts[Math.floor(counts.length * 0.9)]!).toBeLessThanOrEqual(40);
    expect(counts[counts.length - 1]!).toBeLessThanOrEqual(80);
    // As above: it was 3000 before the business street was shortened.
    expect(units).toBeGreaterThan(2000);
  });

  it("uses each kind of interior and each kind of furnishing the plan promises", () => {
    const types = new Set<string>();
    const kinds = new Set<string>();
    for (const plan of towns()) for (const { unit } of allUnits(plan)) {
      types.add(unit.interior.type);
      for (const f of unit.interior.furnishings) kinds.add(f.kind);
    }
    for (const t of ["retail aisles", "counter service", "dining room", "bar", "office", "laundromat", "workshop", "lobby", "empty"]) expect(types.has(t), t).toBe(true);
    for (const k of ["shelf run", "counter", "table", "booth", "stool row", "display case", "cooler", "washer row", "desk", "rack", "stacked crates", "ladder", "paint cans", "partition", "endcap", "checkout", "bin", "cart", "couch", "machine", "cabinet", "water cooler", "plant", "sheet"]) expect(kinds.has(k), k).toBe(true);
  });
});

describe("variation comes from each thing's own story, and no two are alike", () => {
  it("has doors where the plan puts them: most are off the middle of their bay", () => {
    let off = 0;
    let n = 0;
    for (const plan of towns()) for (const { unit } of allUnits(plan)) {
      if (unit.s1 - unit.s0 < 5) continue;
      n++;
      if (Math.abs(unit.door.s - (unit.s0 + unit.s1) / 2) > 0.5) off++;
    }
    expect(off / n).toBeGreaterThan(0.55);
  });

  it("hangs the boards of neighbouring fronts at different heights, and varies the units' widths", () => {
    for (const plan of towns().slice(0, 12)) {
      const heights = new Set(allUnits(plan).map((x) => x.unit.fascia));
      expect(heights.size, `seed ${plan.seed}`).toBeGreaterThan(8);
      const widths = new Set(allUnits(plan).map((x) => Math.round(x.unit.s1 - x.unit.s0)));
      expect(widths.size).toBeGreaterThan(5);
    }
    // A building's remodels are in its story: the widened opening is wider than its neighbours, the dropped fascia lower than the age says.
    let widened = 0;
    let dropped = 0;
    for (const plan of towns()) for (const { unit } of allUnits(plan)) {
      if (unit.remodel?.what === "widened window") {
        widened++;
        expect(unit.openings.some((o) => o.widened)).toBe(true);
      }
      if (unit.remodel?.what === "dropped fascia") {
        dropped++;
        expect(unit.fascia).toBeLessThan(3);
      }
      if (unit.remodel) expect(unit.remodel.decade).toBeGreaterThan(1880);
    }
    expect(widened).toBeGreaterThan(20);
    expect(dropped).toBeGreaterThan(20);
  });

  it("papers one window of a vacant unit that closed since the block was built, and boards the rest of a boarded one", () => {
    let lease = 0;
    let boarded = 0;
    for (const plan of towns()) for (const { unit } of allUnits(plan)) {
      if (unit.state === "vacant for lease" && unit.openings.length > 1) {
        lease++;
        expect(unit.openings.filter((o) => o.cover === "papered").length).toBe(1);
      }
      if (unit.state === "vacant boarded") {
        boarded++;
        for (const o of unit.openings) expect(["boarded", "papered", "bricked"]).toContain(o.cover);
      }
    }
    expect(lease).toBeGreaterThan(100);
    expect(boarded).toBeGreaterThan(50);
  });

  it("never makes two units with the same name, sign set and interior", () => {
    for (const plan of towns()) {
      const seen: string[] = [];
      for (const { unit } of allUnits(plan)) {
        const key = JSON.stringify([unit.tenant?.name ?? null, unit.signs.map((s) => [s.kind, s.lines]), unit.interior.furnishings]);
        expect(seen.includes(key), `seed ${plan.seed}: two alike`).toBe(false);
        seen.push(key);
      }
    }
  });

  it("gives each house its own windows: no two fronts match", () => {
    for (const plan of towns().slice(0, 20)) {
      const fronts: string[] = [];
      for (const use of plan.uses) {
        const b = plan.buildings[use.building]!;
        if (b.kind !== "house") continue;
        expect(use.windows.length, `b${b.id}`).toBeGreaterThan(2);
        expect(use.door, "a house has its front door").not.toBeNull();
        for (const w of use.windows) expect(["curtained", "blinds", "lit", "dark", "boarded", "broken"]).toContain(w.state);
        if (b.state === "open") {
          expect(use.windows.some((w) => w.state === "boarded" || w.state === "broken"), "an occupied house is not boarded").toBe(false);
        } else if (b.state === "vacant") expect(use.windows.every((w) => w.state === "boarded" || w.state === "dark")).toBe(true);
        else expect(use.windows.some((w) => w.state === "broken" || w.state === "boarded"), "a ruin has lost its glass or has it boarded").toBe(true);
        fronts.push(JSON.stringify([use.door!.s, use.windows.filter((w) => w.wall === "front")]));
      }
      expect(new Set(fronts).size / fronts.length, `seed ${plan.seed}`).toBeGreaterThan(0.9);
    }
  });

  it("uses the floors above a shop, and tells apart the vacant one", () => {
    const uses = new Set<string>();
    for (const plan of towns()) for (const use of plan.uses) {
      for (const up of use.upper) {
        uses.add(up.use);
        expect(up.windows.length).toBeGreaterThan(1);
        if (plan.buildings[use.building]!.state === "vacant") expect(up.use).toBe("empty");
      }
    }
    for (const u of ["apartments", "offices", "lodge hall", "storage", "hotel rooms", "empty"]) expect(uses.has(u), u).toBe(true);
  });
});

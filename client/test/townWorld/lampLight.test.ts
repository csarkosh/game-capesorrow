// The lamp list: the nearest lit lamps to the eye, none by day, none popping in or out, none of a dead lamp.
import { describe, expect, it } from "vitest";
import { UNTIL_DAWN, nightCode } from "../../src/game/town/hours.js";
import { LAMP_REACH, MAX_LAMPS, emptyLampList, fillLamps, type Lamp } from "../../src/game/town/lampLight.js";

const ON = nightCode(8, UNTIL_DAWN);
const NEVER = nightCode(49, 0);
const lamp = (x: number, code = ON, z = 0): Lamp => ({ x, y: 8, z, r: 1, g: 0.6, b: 0.2, range: 24, strength: 1, code });

describe("the lamp list", () => {
  it("is empty by day, and a dead lamp (a code that is never lit) gives nothing at night", () => {
    const list = emptyLampList();
    fillLamps([lamp(10), lamp(20)], 0, 1.6, 0, 12, list);
    expect(list.count).toBe(0);
    fillLamps([lamp(10, NEVER)], 0, 1.6, 0, 23, list);
    expect(list.count).toBe(0);
    fillLamps([lamp(10), lamp(20, NEVER)], 0, 1.6, 0, 23, list);
    expect(list.count).toBe(1);
    expect(list.col[3] as number).toBeGreaterThan(0.9);
  });

  it("takes the nearest MAX_LAMPS, nearest first, and none beyond the reach", () => {
    const lamps: Lamp[] = [];
    for (let i = 0; i < 60; i++) lamps.push(lamp(3 + i * 2));
    const list = emptyLampList();
    fillLamps(lamps, 0, 1.6, 0, 23, list);
    expect(list.count).toBeLessThanOrEqual(MAX_LAMPS);
    expect(list.count).toBe(MAX_LAMPS);
    for (let k = 1; k < list.count; k++) expect(list.pos[k * 4] as number).toBeGreaterThan(list.pos[(k - 1) * 4] as number);
    const far = emptyLampList();
    fillLamps([lamp(LAMP_REACH + 5)], 0, 8, 0, 23, far);
    expect(far.count).toBe(0);
  });

  it("never pops: the lamp at the cut-off has no strength, and the last one in is nearly none", () => {
    // 30 lamps close together: the 25th, the first left out, sets the cut-off; the 24th is just inside it.
    const lamps: Lamp[] = [];
    for (let i = 0; i < 30; i++) lamps.push(lamp(10 + i));
    lamps[24] = lamp(10 + 23 + 0.001);
    lamps.sort((a, b) => a.x - b.x);
    const list = emptyLampList();
    fillLamps(lamps, 0, 8, 0, 23, list);
    const strengths = Array.from({ length: list.count }, (_, k) => list.col[k * 4 + 3] as number);
    expect(Math.min(...strengths)).toBeLessThan(0.01);
    // Strength falls as the lamps get farther.
    expect(strengths[0]).toBeGreaterThan(0.99);
    // A lamp at exactly the reach is nothing.
    const edge = emptyLampList();
    fillLamps([lamp(LAMP_REACH - 0.0001, ON), lamp(5)], 0, 8, 0, 23, edge);
    for (let k = 0; k < edge.count; k++) if ((edge.pos[k * 4] as number) > 100) expect(edge.col[k * 4 + 3] as number).toBeLessThan(0.001);
  });

  it("follows the lamp's own time: a lamp not yet on adds nothing and one that is on at its fade adds part", () => {
    const list = emptyLampList();
    fillLamps([lamp(10, nightCode(40, UNTIL_DAWN))], 0, 1.6, 0, 18, list);
    expect(list.count).toBe(0);
    fillLamps([lamp(10)], 0, 1.6, 0, 18.14 - 0.5 + 8 / 15, list);
    expect(list.col[3] as number).toBeCloseTo(0.5, 1);
  });

  it("lights a shop's lamp only while its unit is open and it is dark, and never pops one in or out of the list", () => {
    const shop: Lamp = { ...lamp(10), hours: { open: 9, close: 21 } };
    const list = emptyLampList();
    // Dark and shut (23:00), and open but light (12:00): nothing.
    fillLamps([shop], 0, 1.6, 0, 23, list);
    expect(list.count).toBe(0);
    fillLamps([shop], 0, 1.6, 0, 12, list);
    expect(list.count).toBe(0);
    // Dark and open (20:00): lit; the shop shutting at 21:00 takes its light down over the hour's fade, to nothing.
    fillLamps([shop], 0, 1.6, 0, 20, list);
    expect(list.count).toBe(1);
    expect(list.col[3] as number).toBeGreaterThan(0.9);
    fillLamps([shop], 0, 1.6, 0, 21, list);
    expect(list.col[3] as number).toBeCloseTo(0.5, 1);
    // A crowd of open shops: the list keeps the nearest and the one at the cut-off is at no strength.
    const shops: Lamp[] = [];
    for (let i = 0; i < 40; i++) shops.push({ ...lamp(3 + i * 2), hours: { open: 9, close: 23 } });
    fillLamps(shops, 0, 1.6, 0, 20, list);
    expect(list.count).toBe(MAX_LAMPS);
    expect(list.col[(list.count - 1) * 4 + 3] as number).toBeLessThan(0.2);
  });
});

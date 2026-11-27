/**
 * What the municipal building's hall has that the town's room kit has not (`sim/inside/municipal.ts` makes the room): the boards over the two counters
 * with their words, the plate by the office's doorway, the doorways' frames and headers and the shut door's leaf, a notice board, a wall clock, a flag on its
 * stand, and the cork board with a map in the player's office. Drawn last in a whole room (`RoomIn.extras`), simply, from the same quads and boxes the kit uses.
 *
 * The words are real letters: the town's stroke font (`signFont.ts`, the one that letters a street-name blade) laid as quads, one run of lit pixels a quad. A board
 * says "SHERIFF" or "CITY CLERK", the plate "ROOM 3". Nothing here says what the town's other business in the building is.
 */
import { withMat } from "./materials.js";
import { scaled, type Rgb, type Vec3 } from "./meshBuilder.js";
import { BAKED, fbox, shade, wallQuad, xd, xp, type Ctx } from "./roomKit.js";
import { GLYPH_H, textPixels, textRuns } from "./signFont.js";
import { DOORWAY, MUNICIPAL_CEILING, PARTITION, type Municipal } from "../../sim/inside/municipal.js";

const AX = { x: 1, z: 0 };

/** The room's dressing of the municipal building, as the callback `RoomIn.extras` takes. */
export function municipalDecor(m: Municipal): (c: Ctx) => void {
  return (c) => {
    const { marks } = m;
    const hall = (s: number, y: number, off: number): Vec3 => xp(c.xf, s, marks.back - PARTITION / 2 - off, c.floorY + y);
    /** A rectangle on the hall's face of the back partition, `off` out from it, lit by the room. */
    const rect = (s0: number, s1: number, y0: number, y1: number, off: number, albedo: Rgb, glow: number = BAKED): void => {
      const at = (s: number, y: number): Rgb => shade(c, albedo, s, marks.back - PARTITION / 2 - off, y, 0);
      c.out.poly([hall(s0, y0, off), hall(s1, y0, off), hall(s1, y1, off), hall(s0, y1, off)], xd(c.xf, 0, -1), glow === BAKED ? [at(s0, y0), at(s1, y0), at(s1, y1), at(s0, y1)] : albedo, undefined, { glow: glow === BAKED ? 1 : glow });
    };
    /** A text on the partition: its pixels `px` metres square, centred on station `s`, its top at `top` over the floor. */
    const lettering = (text: string, s: number, top: number, px: number, ink: Rgb, off: number): void => {
      const left = s - (textPixels(text) * px) / 2;
      for (const run of textRuns(text)) rect(left + run.c0 * px, left + run.c1 * px, top - run.r1 * px, top - run.r0 * px, off, ink);
    };
    /** A board with a word on it: wood, a pale border and the letters. */
    const board = (text: string, s: number, y: number): void => {
      const px = 0.06;
      const w = textPixels(text) * px + 0.4;
      const h = GLYPH_H * px + 0.26;
      withMat("painted", () => {
        rect(s - w / 2, s + w / 2, y, y + h, 0.03, [0.2, 0.13, 0.08]);
        rect(s - w / 2 + 0.05, s + w / 2 - 0.05, y + 0.05, y + h - 0.05, 0.06, [0.12, 0.2, 0.15]);
      });
      withMat("painted", () => lettering(text, s, y + h - 0.13, px, [0.92, 0.88, 0.72], 0.09));
    };
    board("SHERIFF", marks.sheriffS, 2.45);
    board("CITY CLERK", marks.cityS, 2.45);

    // The plate beside the office's doorway, on the side toward the hall's middle.
    const plateS = marks.officeDoor + DOORWAY / 2 + 0.55;
    withMat("painted", () => {
      rect(plateS - 0.4, plateS + 0.4, 1.5, 1.78, 0.03, [0.35, 0.3, 0.2]);
      rect(plateS - 0.37, plateS + 0.37, 1.53, 1.75, 0.06, [0.1, 0.1, 0.11]);
      lettering("ROOM 3", plateS, 1.7, 0.0165, [0.9, 0.86, 0.7], 0.09);
    });

    // The doorways: a frame and a header over each, up to the ceiling, and a leaf in the one that is shut.
    const paint = scaled(c.paint, 0.72);
    const trim: Rgb = [0.45, 0.4, 0.32];
    const header = 2.2;
    for (const g of [marks.officeDoor, marks.shutDoor]) {
      withMat("painted", () => {
        fbox(c, g, marks.back, header, MUNICIPAL_CEILING - header, DOORWAY / 2, PARTITION / 2, AX, paint, paint);
        for (const sg of [-1, 1]) fbox(c, g + sg * (DOORWAY / 2 + 0.02), marks.back, 0, header, 0.04, PARTITION / 2 + 0.02, AX, trim, trim);
        fbox(c, g, marks.back, header - 0.05, 0.05, DOORWAY / 2 + 0.06, PARTITION / 2 + 0.02, AX, trim, trim);
      });
    }
    withMat("boards", () => {
      const leaf: Rgb = [0.32, 0.22, 0.14];
      fbox(c, marks.shutDoor, marks.back, 0, header - 0.05, DOORWAY / 2 - 0.02, 0.04, AX, leaf, leaf);
    });
    withMat("steel", () => fbox(c, marks.shutDoor + DOORWAY / 2 - 0.14, marks.back - 0.07, 0.95, 0.1, 0.03, 0.03, AX, [0.6, 0.5, 0.2], [0.65, 0.55, 0.25]));

    // A wall clock on the partition between the doorways.
    const clockS = marks.officeDoor + DOORWAY / 2 + 1.7;
    withMat("painted", () => {
      const ring = (r: number): [number, number][] => Array.from({ length: 12 }, (_, i) => [clockS + Math.cos((i / 12) * Math.PI * 2) * r, 2.8 + Math.sin((i / 12) * Math.PI * 2) * r]);
      const poly = (pts: [number, number][], off: number, albedo: Rgb): void => {
        c.out.poly(pts.map(([s, y]) => hall(s, y, off)), xd(c.xf, 0, -1), shade(c, albedo, clockS, marks.back, 2.8, 0), undefined, { glow: 1 });
      };
      poly(ring(0.27), 0.03, [0.12, 0.09, 0.07]);
      poly(ring(0.23), 0.06, [0.9, 0.88, 0.8]);
      rect(clockS - 0.012, clockS + 0.012, 2.8, 3.0, 0.09, [0.08, 0.08, 0.08]);
      rect(clockS, clockS + 0.14, 2.79, 2.81, 0.09, [0.08, 0.08, 0.08]);
    });

    // The notice board on the left wall of the hall, near the front: cork with papers pinned to it.
    withMat("painted", () => {
      wallQuad(c, "left", 1.5, 2.9, 1.25, 2.15, 0.03, [0.3, 0.2, 0.12]);
      wallQuad(c, "left", 1.55, 2.85, 1.3, 2.1, 0.06, [0.55, 0.4, 0.25]);
      const sheets: [number, number, number, number, Rgb][] = [[1.65, 2.05, 1.65, 2.0, [0.9, 0.88, 0.8]], [2.15, 2.55, 1.4, 1.75, [0.85, 0.8, 0.55]], [2.2, 2.75, 1.82, 2.05, [0.88, 0.9, 0.92]], [1.7, 2.0, 1.36, 1.58, [0.8, 0.5, 0.45]]];
      for (const [a0, a1, y0, y1, col] of sheets) {
        wallQuad(c, "left", a0, a1, y0, y1, 0.09, col);
        for (let k = 0; k < 2; k++) wallQuad(c, "left", a0 + 0.05, a1 - 0.05, y1 - 0.05 - k * 0.07, y1 - 0.035 - k * 0.07, 0.12, [0.45, 0.45, 0.42]);
      }
    });

    // The flag on its stand in the hall: a round foot, a pole with a gilt knob, and the flag hung from it in stripes with a field of blue.
    const f = marks.flag;
    const foot = xp(c.xf, f.s, f.d, c.floorY);
    withMat("steel", () => {
      c.out.cylinder(foot[0], foot[2], c.floorY, 0.2, 0.05, 8, [0.18, 0.15, 0.12], [0.22, 0.2, 0.16]);
      c.out.cylinder(foot[0], foot[2], c.floorY + 0.05, 0.016, 2.45, 5, [0.3, 0.22, 0.1], [0.35, 0.27, 0.12]);
      c.out.cylinder(foot[0], foot[2], c.floorY + 2.5, 0.04, 0.08, 6, [0.7, 0.55, 0.15], [0.75, 0.6, 0.2], 0.01);
    });
    // It hangs from the pole as a flag does with no wind: a narrow fall of cloth, the blue field at the top and the stripes running down.
    withMat("cloth", () => {
      const w = 0.36;
      const top = 2.3;
      const fall = 1.15;
      const field = 0.36;
      const stripe = w / 7;
      const at = (x: number, y: number, out: number): Vec3 => xp(c.xf, f.s + 0.03 + x, f.d - out, c.floorY + y);
      for (let k = 0; k < 7; k++) {
        const col: Rgb = k % 2 === 0 ? [0.65, 0.1, 0.1] : [0.9, 0.9, 0.86];
        // Each stripe ends a little lower than the one before, as the cloth's corner hangs.
        const foot = top - fall + (6 - k) * 0.025;
        c.out.poly([at(k * stripe, foot, 0), at((k + 1) * stripe, foot, 0), at((k + 1) * stripe, top - field, 0), at(k * stripe, top - field, 0)], xd(c.xf, 0, -1), shade(c, col, f.s + 0.2, f.d, 1.5, 0), undefined, { glow: 1 });
      }
      c.out.poly([at(0, top - field, 0), at(w, top - field, 0), at(w, top, 0), at(0, top, 0)], xd(c.xf, 0, -1), shade(c, [0.12, 0.16, 0.42], f.s + 0.2, f.d, top - 0.2, 0), undefined, { glow: 1 });
    });

    // The cork board and its map in the player's office, on the left partition's face, over the desk's end.
    const od = (m.depth + marks.back) / 2;
    const cork = (d0: number, d1: number, y0: number, y1: number, off: number, albedo: Rgb): void => {
      const s = marks.officeLeft + PARTITION / 2 + off;
      const at = (d: number, y: number): Vec3 => xp(c.xf, s, d, c.floorY + y);
      c.out.poly([at(d0, y0), at(d1, y0), at(d1, y1), at(d0, y1)], xd(c.xf, 1, 0), shade(c, albedo, s, (d0 + d1) / 2, (y0 + y1) / 2, 0), undefined, { glow: 1 });
    };
    withMat("painted", () => {
      cork(od - 0.8, od + 0.8, 1.15, 2.1, 0.03, [0.3, 0.2, 0.12]);
      cork(od - 0.75, od + 0.75, 1.2, 2.05, 0.06, [0.55, 0.4, 0.25]);
      // The map: a pale sheet, water along its left, the land, a road and a few red pins.
      cork(od - 0.5, od + 0.55, 1.28, 1.98, 0.09, [0.85, 0.82, 0.68]);
      cork(od - 0.5, od - 0.12, 1.28, 1.98, 0.12, [0.5, 0.62, 0.7]);
      cork(od - 0.12, od + 0.55, 1.28, 1.34, 0.12, [0.6, 0.56, 0.42]);
      cork(od - 0.1, od + 0.5, 1.58, 1.61, 0.12, [0.35, 0.33, 0.3]);
      cork(od + 0.12, od + 0.15, 1.3, 1.9, 0.12, [0.35, 0.33, 0.3]);
      for (const [dd, yy] of [[0.0, 1.7], [0.25, 1.5], [0.38, 1.85]] as const) cork(od + dd, od + dd + 0.045, yy, yy + 0.045, 0.15, [0.75, 0.1, 0.08]);
    });
  };
}

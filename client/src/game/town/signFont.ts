/**
 * Letters for signs, drawn as geometry: a 5 by 7 pixel face for A to Z and 0 to 9, each lit pixel a quad (a row's run of pixels
 * one quad). No texture and no canvas, so a sign's words are plain arrays like everything else the town draws, and read the same
 * on every tier. Capitals only (a street-name blade here is in capitals).
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
};

/** A glyph is this many pixels wide and tall, and the space between two letters is one pixel. */
export const GLYPH_W = 5;
export const GLYPH_H = 7;

/** A rectangle of lit pixels: columns [c0, c1) of the text and rows [r0, r1), the first row at the top. */
export type TextRun = { readonly c0: number; readonly c1: number; readonly r0: number; readonly r1: number };

/** The width of a text in pixels. */
export function textPixels(text: string): number {
  return text.length === 0 ? 0 : text.length * (GLYPH_W + 1) - 1;
}

/** The runs of lit pixels of a text, merged along each row, then down identical rows. */
export function textRuns(text: string): TextRun[] {
  const rows: boolean[][] = Array.from({ length: GLYPH_H }, () => []);
  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPHS[(text[i] as string).toUpperCase()];
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) (rows[r] as boolean[])[i * (GLYPH_W + 1) + c] = glyph !== undefined && (glyph[r] as string)[c] === "#";
      if (i < text.length - 1) (rows[r] as boolean[])[i * (GLYPH_W + 1) + GLYPH_W] = false;
    }
  }
  const width = textPixels(text);
  const runs: TextRun[] = [];
  // Per row the runs of pixels; a run that the row below repeats exactly grows downward.
  const open: TextRun[] = [];
  for (let r = 0; r < GLYPH_H; r++) {
    const row = rows[r] as boolean[];
    const here: { c0: number; c1: number }[] = [];
    let c = 0;
    while (c < width) {
      if (!row[c]) {
        c++;
        continue;
      }
      const c0 = c;
      while (c < width && row[c]) c++;
      here.push({ c0, c1: c });
    }
    const next: TextRun[] = [];
    for (const run of here) {
      const above = open.findIndex((o) => o.c0 === run.c0 && o.c1 === run.c1 && o.r1 === r);
      if (above >= 0) {
        const o = open[above] as TextRun;
        next.push({ ...o, r1: r + 1 });
        open.splice(above, 1);
      } else next.push({ c0: run.c0, c1: run.c1, r0: r, r1: r + 1 });
    }
    runs.push(...open);
    open.length = 0;
    open.push(...next);
  }
  runs.push(...open);
  return runs;
}

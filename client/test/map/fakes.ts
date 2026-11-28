/** What the map's tests draw into and read: a context that records, and a window and document that stand in for a page's. */
import type { MapCtx, PathLike } from "../../src/game/map/mapCtx.js";

export type Drawn = { kind: "fill" | "stroke"; colour: string; alpha: number; width: number; arcs: { x: number; y: number; r: number }[]; matrix: number[] };

export type Rec = { drawn: Drawn[]; fillsDrawn: { colour: string; alpha: number }[]; rectColours: string[]; fills: number; strokes: number; rects: number; texts: string[]; transforms: number; paths: number };

/** A recording `MapCtx`: it counts the drawing operations (`ops`) and keeps the words drawn. */
export class RecordingCtx implements MapCtx {
  rec: Rec = { drawn: [], fillsDrawn: [], rectColours: [], fills: 0, strokes: 0, rects: 0, texts: [], transforms: 0, paths: 0 };
  /** Throws on the next drawing operation (a fault in the map). */
  failNext = false;
  get ops(): number {
    return this.rec.fills + this.rec.strokes + this.rec.rects + this.rec.texts.length;
  }
  reset(): void {
    this.rec = { drawn: [], fillsDrawn: [], rectColours: [], fills: 0, strokes: 0, rects: 0, texts: [], transforms: 0, paths: 0 };
  }
  private check(): void {
    if (this.failNext) throw new Error("the context failed");
  }
  newPath(): PathLike {
    this.rec.paths++;
    const arcs: { x: number; y: number; r: number }[] = [];
    return { arcs, moveTo: () => undefined, lineTo: () => undefined, closePath: () => undefined, arc: (x: number, y: number, r: number) => void arcs.push({ x, y, r }), rect: () => undefined } as PathLike;
  }
  /** The transform last set (a, b, c, d, e, f). */
  matrix: number[] = [1, 0, 0, 1, 0, 0];
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
    this.rec.transforms++;
  }
  fillRect(x: number, y: number, w: number, h: number, colour: string): void {
    void [x, y, w, h];
    this.check();
    this.rec.rects++;
    this.rec.rectColours.push(colour);
  }
  fill(path: PathLike, colour: string, alpha = 1): void {
    this.check();
    this.rec.fills++;
    this.rec.drawn.push({ kind: "fill", colour, alpha, width: 0, arcs: (path as unknown as { arcs: { x: number; y: number; r: number }[] }).arcs.slice(), matrix: this.matrix.slice() });
    this.rec.fillsDrawn.push({ colour, alpha });
  }
  stroke(path: PathLike, colour: string, width: number, o?: { alpha?: number }): void {
    this.check();
    this.rec.strokes++;
    this.rec.drawn.push({ kind: "stroke", colour, alpha: o?.alpha ?? 1, width, arcs: (path as unknown as { arcs: { x: number; y: number; r: number }[] }).arcs.slice(), matrix: this.matrix.slice() });
  }
  text(s: string): void {
    this.check();
    this.rec.texts.push(s);
  }
  measure(s: string, size: number, bold?: boolean): number {
    void bold;
    return s.length * size * 0.55;
  }
}

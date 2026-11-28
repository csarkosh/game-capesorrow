/** What the map's tests draw into and read: a context that records, and a window and document that stand in for a page's. */
import type { MapCtx, PathLike } from "../../src/game/map/mapCtx.js";

export type Rec = { rectColours: string[]; fills: number; strokes: number; rects: number; texts: string[]; transforms: number; paths: number };

/** A recording `MapCtx`: it counts the drawing operations (`ops`) and keeps the words drawn. */
export class RecordingCtx implements MapCtx {
  rec: Rec = { rectColours: [], fills: 0, strokes: 0, rects: 0, texts: [], transforms: 0, paths: 0 };
  /** Throws on the next drawing operation (a fault in the map). */
  failNext = false;
  get ops(): number {
    return this.rec.fills + this.rec.strokes + this.rec.rects + this.rec.texts.length;
  }
  reset(): void {
    this.rec = { rectColours: [], fills: 0, strokes: 0, rects: 0, texts: [], transforms: 0, paths: 0 };
  }
  private check(): void {
    if (this.failNext) throw new Error("the context failed");
  }
  newPath(): PathLike {
    this.rec.paths++;
    return { moveTo: () => undefined, lineTo: () => undefined, closePath: () => undefined, arc: () => undefined, rect: () => undefined };
  }
  setTransform(): void {
    this.rec.transforms++;
  }
  fillRect(x: number, y: number, w: number, h: number, colour: string): void {
    void [x, y, w, h];
    this.check();
    this.rec.rects++;
    this.rec.rectColours.push(colour);
  }
  fill(): void {
    this.check();
    this.rec.fills++;
  }
  stroke(): void {
    this.check();
    this.rec.strokes++;
  }
  text(s: string): void {
    this.check();
    this.rec.texts.push(s);
  }
  measure(s: string, size: number): number {
    return s.length * size * 0.55;
  }
}

/** What the map's tests draw into and read: a context that records, and a window and document that stand in for a page's. */
import type { MapCtx, PathLike } from "../../src/game/map/mapCtx.js";

export type Rec = { fillsDrawn: { colour: string; alpha: number }[]; rectColours: string[]; fills: number; strokes: number; rects: number; texts: string[]; transforms: number; paths: number };

/** A recording `MapCtx`: it counts the drawing operations (`ops`) and keeps the words drawn. */
export class RecordingCtx implements MapCtx {
  rec: Rec = { fillsDrawn: [], rectColours: [], fills: 0, strokes: 0, rects: 0, texts: [], transforms: 0, paths: 0 };
  /** Throws on the next drawing operation (a fault in the map). */
  failNext = false;
  get ops(): number {
    return this.rec.fills + this.rec.strokes + this.rec.rects + this.rec.texts.length;
  }
  reset(): void {
    this.rec = { fillsDrawn: [], rectColours: [], fills: 0, strokes: 0, rects: 0, texts: [], transforms: 0, paths: 0 };
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
  fill(_path: PathLike, colour: string, alpha = 1): void {
    this.check();
    this.rec.fills++;
    this.rec.fillsDrawn.push({ colour, alpha });
  }
  stroke(): void {
    this.check();
    this.rec.strokes++;
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

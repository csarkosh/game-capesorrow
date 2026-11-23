/**
 * The atlas the town's lettering is painted on, as a plan of rectangles: pure data, no canvas. The builders ask `place` for a rectangle
 * for each sign face (its size in metres, and a `SignSpec`, what is to be painted on it) and get back the UV rectangle to map their quad
 * to; the renderer's side (`signPaint.ts`, which has a 2D canvas) paints every request into the atlas and uploads it once. Where there is
 * no canvas (a test), the requests are the whole of the result: the lines each sign says, and where.
 *
 * Rectangles are packed in shelves, a sign's size in texels from its size in metres (`texelsPerMetre`: 56 on the full tiers, 36 on low),
 * at most 1024 across and 256 up, with a 2 texel gutter. When the atlas is full a sign is not placed (`null`): the builders draw its
 * board and no face, and `dropped` counts them. V runs from the top of the atlas down, as a canvas does.
 */
import type { SignAtlasLike, SignSpec } from "./townTypes.js";

export type SignRequest = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly spec: SignSpec };

/** The tallest a small face is, texels. */
const SMALL_H = 64;

export class SignAtlas implements SignAtlasLike {
  readonly requests: SignRequest[] = [];
  dropped = 0;
  private x = 0;
  private y = 0;
  private rowH = 0;

  constructor(readonly width = 4096, readonly height = 2048, readonly texelsPerMetre = 56) {
    // A fifth of the atlas's height (at least 64 texels) is the small faces' strip, when the atlas is as tall as the full tier's.
    this.smallTop = height >= 2048 ? height - 384 : height;
    this.smallY = this.smallTop;
  }

  /** The small faces (a notice, a plate, a sticker: up to 64 texels tall) have a strip of their own across the atlas's foot, so that they do not break the shelves of the big signs' rows. */
  private smallX = 0;
  private smallY: number;
  private smallRowH = 0;
  private readonly smallTop: number;

  place(widthM: number, heightM: number, spec: SignSpec): { u0: number; v0: number; u1: number; v1: number } | null {
    const w = Math.max(12, Math.min(1024, Math.round(widthM * this.texelsPerMetre)));
    const h = Math.max(8, Math.min(256, Math.round(heightM * this.texelsPerMetre)));
    if (h <= SMALL_H && this.smallTop < this.height) {
      if (this.smallX + w + 2 > this.width) {
        this.smallY += this.smallRowH + 2;
        this.smallX = 0;
        this.smallRowH = 0;
      }
      if (this.smallY + h + 2 <= this.height) {
        const at = { x: this.smallX, y: this.smallY, w, h, spec };
        this.requests.push(at);
        this.smallX += w + 2;
        this.smallRowH = Math.max(this.smallRowH, h);
        return { u0: at.x / this.width, v0: at.y / this.height, u1: (at.x + w) / this.width, v1: (at.y + h) / this.height };
      }
    }
    if (this.x + w + 2 > this.width) {
      this.y += this.rowH + 2;
      this.x = 0;
      this.rowH = 0;
    }
    if (this.y + h + 2 > this.smallTop) {
      this.dropped++;
      return null;
    }
    const at = { x: this.x, y: this.y, w, h, spec };
    this.requests.push(at);
    this.x += w + 2;
    this.rowH = Math.max(this.rowH, h);
    return { u0: at.x / this.width, v0: at.y / this.height, u1: (at.x + w) / this.width, v1: (at.y + h) / this.height };
  }
}

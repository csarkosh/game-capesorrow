/**
 * The small interface the map draws through, so that a test can give it a recording fake and the game gives it a canvas (`canvasCtx`).
 * A call to `fill`, `stroke`, `fillRect` or `text` is one drawing operation; the paths are built in the caller's own units, and drawn under
 * the transform last set.
 */

/** What a path of the map is built with: the calls of a `Path2D` that the map uses. */
export interface PathLike {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
}

export type StrokeOptions = { readonly dash?: readonly number[]; readonly cap?: "butt" | "round"; readonly alpha?: number };
export type TextOptions = {
  readonly size: number;
  readonly colour: string;
  /** The colour of the outline that keeps the words readable over any ground, or none. */
  readonly halo?: string | null;
  readonly align?: "left" | "center" | "right";
  readonly bold?: boolean;
  /** Turned about its anchor by this many radians. */
  readonly angle?: number;
};

export interface MapCtx {
  newPath(): PathLike;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number, colour: string): void;
  fill(path: PathLike, colour: string, alpha?: number): void;
  stroke(path: PathLike, colour: string, width: number, options?: StrokeOptions): void;
  text(s: string, x: number, y: number, options: TextOptions): void;
  measure(s: string, size: number, bold?: boolean): number;
}

const FONT = "ui-sans-serif, system-ui, 'Segoe UI', sans-serif";

/** A canvas as the map's context. `dpr` is the device pixels to a unit of the screen transform the drawer sets (text turns about its anchor and returns to it). */
export function canvasCtx(ctx: CanvasRenderingContext2D, dpr: () => number): MapCtx {
  const font = (size: number, bold: boolean | undefined): string => `${bold === true ? "600 " : ""}${size}px ${FONT}`;
  return {
    newPath: () => new Path2D(),
    setTransform: (a, b, c, d, e, f) => ctx.setTransform(a, b, c, d, e, f),
    fillRect(x, y, w, h, colour) {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, w, h);
    },
    fill(path, colour, alpha = 1) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colour;
      ctx.fill(path as Path2D);
      ctx.globalAlpha = 1;
    },
    stroke(path, colour, width, o) {
      ctx.globalAlpha = o?.alpha ?? 1;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = o?.cap ?? "butt";
      ctx.lineJoin = "round";
      ctx.setLineDash(o?.dash === undefined ? [] : [...o.dash]);
      ctx.stroke(path as Path2D);
      if (o?.dash !== undefined) ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    },
    text(s, x, y, o) {
      const k = dpr();
      const a = o.angle ?? 0;
      if (a !== 0) ctx.setTransform(k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), k * x, k * y);
      const at = a !== 0 ? { x: 0, y: 0 } : { x, y };
      ctx.font = font(o.size, o.bold);
      ctx.textAlign = o.align ?? "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      if (o.halo !== null && o.halo !== undefined) {
        ctx.strokeStyle = o.halo;
        ctx.lineWidth = Math.max(2.5, o.size * 0.3);
        ctx.strokeText(s, at.x, at.y);
      }
      ctx.fillStyle = o.colour;
      ctx.fillText(s, at.x, at.y);
      if (a !== 0) ctx.setTransform(k, 0, 0, k, 0, 0);
    },
    measure(s, size, bold) {
      ctx.font = font(size, bold);
      return ctx.measureText(s).width;
    },
  };
}

/**
 * The atlas the town's lettering is painted on, as a plan of rectangles: pure data, no canvas. The builders ask `place` for a rectangle
 * for each sign face (its size in metres, and a `SignSpec`, what is to be painted on it) and get back the UV rectangle to map their quad
 * to; the renderer's side (`signPaint.ts`, which has a 2D canvas) paints every request into the atlas and uploads it once. Where there is
 * no canvas (a test), the requests are the whole of the result: the lines each sign says, and where.
 *
 * Rectangles are packed in shelves, a sign's size in texels from its size in metres (`texelsPerMetre`: 56 on the full tiers, 36 on low),
 * at most 1024 across and 256 up, with a 2 texel gutter. V runs from the top of the atlas down, as a canvas does.
 *
 * `place` never refuses: it lays the signs out as they come, in a space as tall as the tier's atlas (`height`, with the small faces' strip at
 * its foot) and, once that is full, in shelves below it. That layout is only where each sign is addressed while the town is built. When the
 * town's build has placed every sign, `fit` packs the same rectangles again, tallest first, into the fewest rows, and the texture is made
 * `fittedHeight` tall: those rows rounded up to a multiple of 64. Only if they would reach past `height` does a sign go: the smallest
 * faces first (a notice, a sticker, a plate), the one placed last first among equals, as few as will bring the rest under `height`;
 * `dropped` counts them, and `carry` takes their faces out of the batches (the builders have drawn the board and the face; the board stays).
 * A quad's U and V, written at placement, are carried to the packed layout by `carry`, and `requests` then holds the packed rectangles
 * of the signs kept, which are what is painted.
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
  /** The height the texture is made at: the whole of `height` until `fit` has run. */
  fittedHeight: number;
  private fitted = false;
  /** Where each request was placed, the addresses a quad was written with; the packed layout's rectangles are `requests` once fitted. */
  private placed: SignRequest[] | null = null;
  private grid = new Map<number, number[]>();

  constructor(readonly width = 4096, readonly height = 2048, readonly texelsPerMetre = 56) {
    // A fifth of the atlas's height (at least 64 texels) is the small faces' strip, when the atlas is as tall as the full tier's.
    this.smallTop = height >= 2048 ? height - 384 : height;
    this.smallY = this.smallTop;
    this.fittedHeight = height;
    this.overY = height;
  }

  /** Where the placed rectangles are, in cells of 64 texels, so that the ones near a point are found at once. Made on first use, when nothing more is placed. */
  private index(): SignRequest[] {
    if (this.placed === null) {
      this.placed = this.requests.slice();
      for (let k = 0; k < this.placed.length; k++) {
        const r = this.placed[k] as SignRequest;
        for (let cy = r.y >> 6; cy <= (r.y + r.h) >> 6; cy++) {
          for (let cx = r.x >> 6; cx <= (r.x + r.w) >> 6; cx++) {
            const key = cy * 4096 + cx;
            const at = this.grid.get(key);
            if (at === undefined) this.grid.set(key, [k]);
            else at.push(k);
          }
        }
      }
    }
    return this.placed;
  }

  /**
   * The polygons of a sign layer's batch (the triangles that share vertices), each with the placed rectangle it lies nearest (the least
   * total distance of its points from it; 0 for a point inside), or -1 where none is near. A face drawn a little past its rectangle's foot
   * (a sagging banner) is that rectangle's, not a neighbour's.
   */
  private polygons(uvs: Float32Array, indices: ArrayLike<number>): { members: number[]; owner: number }[] {
    const placed = this.index();
    const n = uvs.length / 2;
    const root = new Int32Array(n).map((_, k) => k);
    const find = (k: number): number => {
      while (root[k] !== k) {
        root[k] = root[root[k] as number] as number;
        k = root[k] as number;
      }
      return k;
    };
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = find(indices[t] as number);
      for (const o of [1, 2]) {
        const b = find(indices[t + o] as number);
        if (a !== b) root[b] = a;
      }
    }
    const groups = new Map<number, number[]>();
    for (let k = 0; k < n; k++) {
      const g = find(k);
      const at = groups.get(g);
      if (at === undefined) groups.set(g, [k]);
      else at.push(k);
    }
    const w = this.width;
    const h = this.height;
    const out: { members: number[]; owner: number }[] = [];
    for (const members of groups.values()) {
      const near = new Set<number>();
      for (const k of members) {
        const px = Math.floor((uvs[2 * k] as number) * w);
        const py = Math.floor((uvs[2 * k + 1] as number) * h);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const c of this.grid.get(((py >> 6) + dy) * 4096 + (px >> 6) + dx) ?? []) near.add(c);
      }
      let owner = -1;
      let least = Infinity;
      for (const c of near) {
        const r = placed[c] as SignRequest;
        let sum = 0;
        for (const k of members) {
          const px = (uvs[2 * k] as number) * w;
          const py = (uvs[2 * k + 1] as number) * h;
          sum += Math.max(r.x - px, 0, px - r.x - r.w, r.y - py, 0, py - r.y - r.h);
        }
        if (sum < least - 1e-9 || (Math.abs(sum - least) <= 1e-9 && c < owner)) {
          least = sum;
          owner = c;
        }
      }
      out.push({ members, owner });
    }
    return out;
  }

  /** How far a face reaches past each side of its rectangle (a banner's sag): left, top, right, bottom, texels, by request. */
  private spill = new Map<number, [number, number, number, number]>();

  /**
   * Notes how far the faces of a sign layer's batch reach past their rectangles, so that `fit` leaves that much room (kept clear, as
   * the gutter is) around each. Call it for every batch before `fit`.
   */
  reach(uvs: Float32Array, indices: ArrayLike<number>): void {
    const placed = this.index();
    for (const { members, owner } of this.polygons(uvs, indices)) {
      if (owner < 0) continue;
      const r = placed[owner] as SignRequest;
      const at = this.spill.get(owner) ?? [0, 0, 0, 0];
      for (const k of members) {
        const px = (uvs[2 * k] as number) * this.width;
        const py = (uvs[2 * k + 1] as number) * this.height;
        at[0] = Math.max(at[0], r.x - px);
        at[1] = Math.max(at[1], r.y - py);
        at[2] = Math.max(at[2], px - r.x - r.w);
        at[3] = Math.max(at[3], py - r.y - r.h);
      }
      this.spill.set(owner, at);
    }
  }

  /** The packed rectangle of each placed one (null where it was dropped), once fitted. */
  private finals: (SignRequest | null)[] = [];

  /** The rectangle placed sign `k` is painted at, once fitted: null where it was dropped. */
  finalOf(k: number): SignRequest | null {
    return this.finals[k] ?? null;
  }

  /**
   * Packs the rectangles of the signs in `keep` again, tallest first (with the room `reach` found around each), into shelves across the
   * atlas's width: where each lies, by index, and the rows they reach.
   */
  private pack(keep: readonly number[]): { at: Map<number, SignRequest>; rows: number } {
    const was = this.index();
    const room = (k: number): readonly [number, number, number, number] => {
      const q = this.spill.get(k);
      const more = (v: number): number => (v > 0 ? Math.ceil(v) + 1 : 0);
      return q === undefined ? [0, 0, 0, 0] : [more(q[0]), more(q[1]), more(q[2]), more(q[3])];
    };
    const boxH = (k: number): number => {
      const m = room(k);
      return (was[k] as SignRequest).h + m[1] + m[3];
    };
    const order = keep.slice().sort((a, b) => boxH(b) - boxH(a) || a - b);
    const at = new Map<number, SignRequest>();
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const k of order) {
      const r = was[k] as SignRequest;
      const m = room(k);
      const bw = r.w + m[0] + m[2];
      if (x + bw + 2 > this.width) {
        y += rowH + 2;
        x = 0;
        rowH = 0;
      }
      at.set(k, { ...r, x: x + m[0], y: y + m[1] });
      x += bw + 2;
      rowH = Math.max(rowH, boxH(k));
    }
    return { at, rows: order.length === 0 ? 0 : y + rowH };
  }

  /**
   * Packs every rectangle again, into the fewest rows, and takes the height they reach (a multiple of 64). Where they would reach past
   * `height`, signs are dropped until they do not: smallest area first, and among equals the one placed last, as few as will do (found by
   * halving: dropping more never makes the rest taller). Call it once, when nothing more is to be placed.
   */
  fit(): void {
    if (this.fitted) return;
    this.fitted = true;
    const was = this.index();
    const all = was.map((_, k) => k);
    let packed = this.pack(all);
    if (packed.rows > this.height) {
      const dropOrder = all.slice().sort((a, b) => (was[a] as SignRequest).w * (was[a] as SignRequest).h - (was[b] as SignRequest).w * (was[b] as SignRequest).h || b - a);
      let lo = 1;
      let hi = dropOrder.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.pack(all.filter((k) => !dropOrder.slice(0, mid).includes(k))).rows <= this.height) hi = mid;
        else lo = mid + 1;
      }
      const gone = new Set(dropOrder.slice(0, lo));
      packed = this.pack(all.filter((k) => !gone.has(k)));
      this.dropped += gone.size;
    }
    this.fittedHeight = Math.min(this.height, Math.max(64, Math.ceil(packed.rows / 64) * 64));
    this.finals = all.map((k) => packed.at.get(k) ?? null);
    this.requests.length = 0;
    for (const r of this.finals) if (r !== null) this.requests.push(r);
  }

  /**
   * Carries the UV a sign's quads were written with (at placement, as fractions of the planning size) to the packed layout, in place:
   * every point of a polygon keeps its place relative to the rectangle the polygon belongs to (`polygons`). A polygon near no rectangle
   * is left as the planning size has it; the polygons of a sign that was dropped are left out of the indices given back.
   */
  carry(uvs: Float32Array, indices: ArrayLike<number>): ArrayLike<number> {
    const w = this.width;
    const h = this.height;
    const gone = new Uint8Array(uvs.length / 2);
    let removed = false;
    for (const { members, owner } of this.polygons(uvs, indices)) {
      const to = owner < 0 ? undefined : this.finals[owner];
      if (to === null) {
        for (const k of members) gone[k] = 1;
        removed = true;
        continue;
      }
      if (to === undefined) {
        for (const k of members) uvs[2 * k + 1] = (uvs[2 * k + 1] as number) * h / this.fittedHeight;
        continue;
      }
      const from = this.index()[owner] as SignRequest;
      for (const k of members) {
        uvs[2 * k] = ((uvs[2 * k] as number) * w - from.x + to.x) / w;
        uvs[2 * k + 1] = ((uvs[2 * k + 1] as number) * h - from.y + to.y) / this.fittedHeight;
      }
    }
    if (!removed) return indices;
    const kept: number[] = [];
    for (let t = 0; t + 2 < indices.length; t += 3) if (gone[indices[t] as number] === 0) kept.push(indices[t] as number, indices[t + 1] as number, indices[t + 2] as number);
    return Uint32Array.from(kept);
  }

  /** The small faces (a notice, a plate, a sticker: up to 64 texels tall) have a strip of their own across the atlas's foot, so that they do not break the shelves of the big signs' rows. */
  private smallX = 0;
  private smallY: number;
  private smallRowH = 0;
  private readonly smallTop: number;
  /** Where the shelves below the planning space are. */
  private overX = 0;
  private overY: number;
  private overRowH = 0;

  place(widthM: number, heightM: number, spec: SignSpec): { u0: number; v0: number; u1: number; v1: number } {
    if (this.fitted) throw new Error("the sign atlas is fitted: nothing more can be placed");
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
      // The planning space is full: the shelves go on below it.
      if (this.overX + w + 2 > this.width) {
        this.overY += this.overRowH + 2;
        this.overX = 0;
        this.overRowH = 0;
      }
      const over = { x: this.overX, y: this.overY, w, h, spec };
      this.requests.push(over);
      this.overX += w + 2;
      this.overRowH = Math.max(this.overRowH, h);
      return { u0: over.x / this.width, v0: over.y / this.height, u1: (over.x + w) / this.width, v1: (over.y + h) / this.height };
    }
    const at = { x: this.x, y: this.y, w, h, spec };
    this.requests.push(at);
    this.x += w + 2;
    this.rowH = Math.max(this.rowH, h);
    return { u0: at.x / this.width, v0: at.y / this.height, u1: (at.x + w) / this.width, v1: (at.y + h) / this.height };
  }
}

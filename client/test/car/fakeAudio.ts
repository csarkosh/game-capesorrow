/**
 * The smallest AudioContext the car's sound can run on: it counts the nodes made, started, stopped, connected and disconnected, and
 * keeps every value set on each parameter, in the order set, with the time it was set for.
 */
export type Call = { at: number; value: number; kind: "set" | "target" | "ramp" };

export class FakeParam {
  value = 0;
  readonly calls: Call[] = [];
  constructor(public readonly clock: { now: number }, value = 0) {
    this.value = value;
  }
  setValueAtTime(value: number, at: number): this {
    this.calls.push({ at, value, kind: "set" });
    return this;
  }
  setTargetAtTime(value: number, at: number): this {
    this.calls.push({ at, value, kind: "target" });
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.calls.push({ at, value, kind: "ramp" });
    return this;
  }
  cancelScheduledValues(from: number): this {
    for (let i = this.calls.length - 1; i >= 0; i--) if ((this.calls[i] as Call).at >= from) this.calls.splice(i, 1);
    return this;
  }
  /** The last value asked for at or before `at` (the context's clock by default), or the value it was made with. */
  target(at = this.clock.now): number {
    let best: Call | null = null;
    for (const c of this.calls) if (c.at <= at && (best === null || c.at >= best.at)) best = c;
    return best === null ? this.value : best.value;
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode>();
  disconnected = 0;
  started = 0;
  stopped = 0;
  onended: (() => void) | null = null;
  gain: FakeParam;
  frequency: FakeParam;
  detune: FakeParam;
  Q: FakeParam;
  buffer: unknown = null;
  loop = false;
  type = "";
  constructor(readonly kind: string, readonly ctx: FakeContext) {
    this.gain = new FakeParam(ctx, 1);
    this.frequency = new FakeParam(ctx, 350);
    this.detune = new FakeParam(ctx, 0);
    this.Q = new FakeParam(ctx, 1);
  }
  connect(to: FakeNode): FakeNode {
    this.outputs.add(to);
    this.ctx.connects++;
    return to;
  }
  disconnect(): void {
    this.outputs.clear();
    this.disconnected++;
    this.ctx.disconnects++;
  }
  start(): void {
    this.started++;
    this.ctx.starts++;
  }
  stop(): void {
    this.stopped++;
    this.ctx.stops++;
  }
}

export class FakeContext {
  now = 0;
  get currentTime(): number {
    return this.now;
  }
  nodes: FakeNode[] = [];
  connects = 0;
  disconnects = 0;
  starts = 0;
  stops = 0;
  private make(kind: string): FakeNode {
    const n = new FakeNode(kind, this);
    this.nodes.push(n);
    return n;
  }
  createGain = (): FakeNode => this.make("gain");
  createOscillator = (): FakeNode => this.make("oscillator");
  createBiquadFilter = (): FakeNode => this.make("filter");
  createBufferSource = (): FakeNode => this.make("source");
  of(kind: string): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }
}

/** Whether `to` is reached from `from` through the nodes' outputs. */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const walk = (n: FakeNode): boolean => {
    if (n === to) return true;
    if (seen.has(n)) return false;
    seen.add(n);
    for (const o of n.outputs) if (walk(o)) return true;
    return false;
  };
  return walk(from);
}

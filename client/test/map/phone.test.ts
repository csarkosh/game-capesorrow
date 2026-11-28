import { afterEach, describe, expect, it, vi } from "vitest";
import { StandInElement, installStandInDom } from "@csarkosh/engine/testing/standInDom";
import { screenToWorld, worldToScreen, largeView } from "../../src/game/map/mapView.js";
import { PHONE_CSS, createPhone } from "../../src/game/map/phoneScreen.js";
import { BODY_ASPECT, BODY_H_MM, BODY_RADIUS, BODY_W_MM, BORDER, CUTOUT_H, CUTOUT_TOP, CUTOUT_W, DISPLAY_H_PX, DISPLAY_W_PX, NARROW_WINDOW, SHEET_DRAG, SLIDE_SECONDS, phoneLayout, phoneOf, pointerOnCanvas, sheetAfter, sheetHeight } from "../../src/game/map/phoneShape.js";

afterEach(() => vi.unstubAllGlobals());

describe("the phone's proportions", () => {
  it("has the body's aspect of 150.0 by 71.9, a slim even border, strongly rounded concentric corners and a pill cutout at the top, all from the constants", () => {
    expect(BODY_ASPECT).toBeCloseTo(150 / 71.9, 12);
    expect([BODY_H_MM, BODY_W_MM]).toEqual([150, 71.9]);
    for (const h of [300, 704, 792, 1000]) {
      const p = phoneOf(h);
      expect(p.bodyH / p.bodyW).toBeCloseTo(BODY_ASPECT, 9);
      expect(p.inset).toBeCloseTo(BORDER * p.bodyW, 9);
      // The border is even: the same each side and top and bottom.
      expect(p.screenW).toBeCloseTo(p.bodyW - 2 * p.inset, 9);
      expect(p.screenH).toBeCloseTo(p.bodyH - 2 * p.inset, 9);
      // The screen's proportions are the display's, to within 3 percent (the border is a share of the body's width).
      expect(p.screenH / p.screenW / (DISPLAY_H_PX / DISPLAY_W_PX)).toBeGreaterThan(0.97);
      expect(p.screenH / p.screenW / (DISPLAY_H_PX / DISPLAY_W_PX)).toBeLessThan(1.03);
      expect(p.bodyRadius).toBeCloseTo(BODY_RADIUS * p.bodyW, 9);
      expect(p.bodyRadius / p.bodyW).toBeCloseTo(0.17, 9);
      // The screen's corners are concentric with the body's: the radius is the body's less the border.
      expect(p.screenRadius).toBeCloseTo(p.bodyRadius - p.inset, 9);
      // The cutout: 30 percent of the screen's width wide, 8.5 percent tall, its top 3 percent of the width below the screen's top, centred.
      expect(p.cutout.w).toBeCloseTo(CUTOUT_W * p.screenW, 9);
      expect(p.cutout.h).toBeCloseTo(CUTOUT_H * p.screenW, 9);
      expect(p.cutout.y).toBeCloseTo(CUTOUT_TOP * p.screenW, 9);
      expect(p.cutout.x + p.cutout.w / 2).toBeCloseTo(p.screenW / 2, 9);
      expect(p.statusH).toBeGreaterThan(p.cutout.y + p.cutout.h);
    }
    expect([BORDER, CUTOUT_W, CUTOUT_H, CUTOUT_TOP]).toEqual([0.017, 0.3, 0.085, 0.03]);
  });

  it("fits the view at 16:10, 16:9, 4:3 and a narrow window, at the right of the middle on a wide one and at the bottom on a narrow one", () => {
    for (const [w, h] of [[1280, 800], [1920, 1080], [1024, 768], [1440, 900]] as const) {
      const l = phoneLayout(w, h);
      const where = `${w}x${h}`;
      expect(l.place, where).toBe("side");
      expect(l.left, where).toBeGreaterThanOrEqual(w * 0.4);
      expect(l.left + l.bodyW, where).toBeLessThanOrEqual(w);
      expect(l.top, where).toBeGreaterThanOrEqual(0);
      expect(l.top + l.bodyH, where).toBeLessThanOrEqual(h);
      expect(l.bodyH / h, where).toBeGreaterThanOrEqual(0.86);
      expect(l.bodyH / h, where).toBeLessThanOrEqual(0.9);
      expect((l.left + l.bodyW / 2) / w, where).toBeGreaterThanOrEqual(0.62);
      expect((l.left + l.bodyW / 2) / w, where).toBeLessThanOrEqual(0.66);
    }
    for (const [w, h] of [[390, 844], [400, 800], [320, 568], [719, 900]] as const) {
      const l = phoneLayout(w, h);
      const where = `${w}x${h}`;
      expect(w < NARROW_WINDOW).toBe(true);
      expect(l.place, where).toBe("bottom");
      expect(l.left, where).toBeGreaterThanOrEqual(0);
      expect(l.left + l.bodyW, where).toBeLessThanOrEqual(w);
      expect(l.top, where).toBeGreaterThanOrEqual(0);
      expect(l.top + l.bodyH, where).toBeLessThanOrEqual(h);
      expect(l.left + l.bodyW / 2, where).toBeCloseTo(w / 2, 6);
      // The pause panel has the top part of the window.
      expect(l.top, where).toBeGreaterThanOrEqual(h * 0.25);
    }
  });
});

describe("a pointer on the phone's screen", () => {
  it("lands on the map point drawn there, through the phone's transform (a slide, a scale), within a pixel", () => {
    const w = 367, h = 779;
    const view = largeView({ look: 0, lookGoal: 0, night: 0, nightGoal: 0, lcx: -250, lcz: 80, lmpp: 1.3 }, w, h);
    // The canvas on the page: slid down 40 px and drawn at 0.8 of its size.
    for (const rect of [{ left: 600, top: 60, width: w, height: h }, { left: 600, top: 100, width: w * 0.8, height: h * 0.8 }, { left: 10, top: 5, width: w * 1.25, height: h * 1.25 }]) {
      for (const [px, pz] of [[-250, 80], [-180, 140], [-330, 20], [-200, 60]] as const) {
        const drawn = worldToScreen(view, px, pz, { x: 0, y: 0 });
        // Where the page shows that point: through the rectangle.
        const client = { x: rect.left + (drawn.x * rect.width) / w, y: rect.top + (drawn.y * rect.height) / h };
        const on = pointerOnCanvas(rect, w, h, client.x, client.y);
        expect(Math.abs(on.x - drawn.x)).toBeLessThan(1);
        expect(Math.abs(on.y - drawn.y)).toBeLessThan(1);
        const world = screenToWorld(view, on.x, on.y, { x: 0, z: 0 });
        expect(Math.abs(world.x - px) / view.mpp).toBeLessThan(1);
        expect(Math.abs(world.z - pz) / view.mpp).toBeLessThan(1);
      }
    }
  });
});

describe("the bottom sheet", () => {
  it("opens on a tap or a drag up of 18 px, closes on a drag down of that much, and a short move is a tap", () => {
    expect(sheetAfter("collapsed", 0)).toBe("expanded");
    expect(sheetAfter("expanded", 0)).toBe("collapsed");
    expect(sheetAfter("collapsed", -SHEET_DRAG)).toBe("expanded");
    expect(sheetAfter("expanded", -SHEET_DRAG - 40)).toBe("expanded");
    expect(sheetAfter("expanded", SHEET_DRAG)).toBe("collapsed");
    expect(sheetAfter("collapsed", SHEET_DRAG + 60)).toBe("collapsed");
    expect(sheetAfter("collapsed", 5)).toBe("expanded");
    expect(sheetHeight("collapsed", 4)).toBeLessThan(sheetHeight("expanded", 4));
    expect(sheetHeight("collapsed", 4)).toBe(22 + 54 + 20);
    expect(sheetHeight("expanded", 4)).toBe(22 + 4 * 54 + 20);
  });

  it("is moved by presses of its handle, and shows only the nearest place while collapsed", () => {
    const doc = installStandInDom();
    const calls: string[] = [];
    const places = [{ id: 1, name: "A", kind: "bar" as const }, { id: 2, name: "B", kind: "cafe" as const }];
    const phone = createPhone(doc as unknown as Document, places, { zoomIn: () => calls.push("in"), zoomOut: () => calls.push("out"), centre: () => calls.push("centre"), clear: () => calls.push("clear"), pick: (id) => calls.push(`pick ${id}`) }, (fn) => fn);
    const root = phone.root as unknown as StandInElement;
    const handle = root.querySelector("button.handle") as StandInElement;
    const sheet = root.querySelector("div.sheet") as StandInElement;
    const stop = { stopPropagation: () => undefined };
    expect(phone.sheet()).toBe("collapsed");
    expect(sheet.classList.contains("collapsed")).toBe(true);
    const press = (from: number, to: number): void => {
      handle.dispatch("pointerdown", { ...stop, clientY: from, pointerId: 1 } as never);
      handle.dispatch("pointerup", { ...stop, clientY: to, pointerId: 1 } as never);
    };
    press(500, 500);
    expect(phone.sheet()).toBe("expanded");
    expect(sheet.classList.contains("collapsed")).toBe(false);
    expect(Number.parseFloat(sheet.style.height as string)).toBe(sheetHeight("expanded", 2));
    press(500, 540);
    expect(phone.sheet()).toBe("collapsed");
    press(500, 470);
    expect(phone.sheet()).toBe("expanded");
    // The floating buttons stand over the sheet, and its rows act.
    phone.setSheet("collapsed");
    expect(Number.parseFloat((root.querySelector("div.floaters") as StandInElement).style.bottom as string)).toBe(sheetHeight("collapsed", 2) + 12);
    (root.querySelectorAll("button").find((b) => b.classList.contains("row")) as StandInElement).dispatch("click", stop as never);
    expect(calls).toEqual(["pick 1"]);
  });
});

describe("how the phone arrives and what it says", () => {
  it("slides up over 0.3 s and back down, and fades instead where motion is reduced", () => {
    expect(SLIDE_SECONDS).toBe(0.3);
    expect(PHONE_CSS).toMatch(/\.capephone\.in \{ animation: phone-in 300ms/);
    expect(PHONE_CSS).toMatch(/\.capephone\.out \{ animation: phone-out 300ms[^}]*forwards/);
    expect(PHONE_CSS).toMatch(/@keyframes phone-in \{ from \{ transform: translateY\(110%\); \} to \{ transform: none; \} \}/);
    expect(PHONE_CSS).toMatch(/@keyframes phone-out \{ from \{ transform: none; \} to \{ transform: translateY\(110%\); \} \}/);
    expect(PHONE_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.capephone\.in \{ animation: phone-fade-in[^}]*\}\s*\.capephone\.out \{ animation: phone-fade-out/);
  });

  it("sets nothing smaller than 11 px, and draws the frame, the cutout, the buttons on the edges and the home indicator", () => {
    for (const m of PHONE_CSS.matchAll(/font(?:-size)?: (?:[\d ]+ )?(\d+(?:\.\d+)?)px/g)) expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(11);
    const doc = installStandInDom();
    const phone = createPhone(doc as unknown as Document, [], { zoomIn: () => undefined, zoomOut: () => undefined, centre: () => undefined, clear: () => undefined, pick: () => undefined }, (fn) => fn);
    const root = phone.root as unknown as StandInElement;
    const sides = root.children.filter((c) => c.className.startsWith("side"));
    // On the right a long button (upper third) and a short one lower down; on the left two volume buttons and a short one above them.
    expect(sides.filter((c) => c.className.includes("right"))).toHaveLength(2);
    expect(sides.filter((c) => c.className.includes("left"))).toHaveLength(3);
    const right = sides.filter((c) => c.className.includes("right")).map((c) => [Number.parseFloat(c.style.top as string), Number.parseFloat(c.style.height as string)]);
    expect(right[0]![1]).toBeGreaterThan(right[1]![1] as number);
    expect(right[0]![0]).toBeLessThan(100 / 3);
    expect(right[1]![0]).toBeGreaterThan(right[0]![0] as number);
    const left = sides.filter((c) => c.className.includes("left")).map((c) => [Number.parseFloat(c.style.top as string), Number.parseFloat(c.style.height as string)]);
    expect(left[0]![0]).toBeLessThan(left[1]![0] as number);
    expect(left[0]![1]).toBeLessThan(left[1]![1] as number);
    const screen = phone.screen as unknown as StandInElement;
    expect(screen.querySelector("div.cutout")).not.toBeNull();
    expect(screen.querySelector("div.homebar")).not.toBeNull();
    expect(screen.querySelector("div.statusbar")?.querySelector("span.clock")).not.toBeNull();
    expect(screen.querySelector("div.statusbar")?.querySelectorAll("path").length).toBeGreaterThanOrEqual(4);
    // The frame: a thin lighter rim with a faint highlight.
    expect(PHONE_CSS).toMatch(/\.capephone \{[^}]*inset 0 0 0 2px #8f9398[^}]*inset 0 2px 2px 1px rgba\(255, 255, 255, 0\.28\)/);
    // The screen's clip: rounded, hiding what lies beyond.
    expect(PHONE_CSS).toMatch(/\.capephone \.pscreen \{[^}]*overflow: hidden/);
  });
});

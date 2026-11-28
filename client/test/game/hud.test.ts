import { afterEach, describe, expect, it, vi } from "vitest";
import { StandInElement, asHtml, installStandInDom } from "@csarkosh/engine/testing/standInDom";
import { createWalkHud } from "../../src/hud.js";
import { PAUSE_LABEL } from "../../src/game/words.js";

afterEach(() => vi.unstubAllGlobals());

const made = (hooks: { onPause(): void } | null = null): { container: StandInElement; hud: ReturnType<typeof createWalkHud> } => {
  const doc = installStandInDom();
  const container = doc.createElement("div");
  doc.body.append(container);
  return { container, hud: createWalkHud(asHtml(container), hooks) };
};

describe("the HUD's Pause button, as Day Hike's is", () => {
  it("shows the bars and the key that pauses, pauses when pressed, and goes on null", () => {
    let paused = 0;
    const { container, hud } = made({ onPause: () => paused++ });
    const pause = container.querySelector("button.pause") as StandInElement;
    expect(pause.getAttribute("aria-label")).toBe(PAUSE_LABEL);
    expect(pause.classList.contains("shown")).toBe(false);
    expect(hud.pause()).toBeNull();
    hud.setPause({ key: "Esc" });
    expect(pause.classList.contains("shown")).toBe(true);
    expect(pause.querySelector("span.key")?.textContent).toBe("Esc");
    expect(pause.querySelector("svg")).not.toBeNull();
    expect(hud.pause()).toEqual({ key: "Esc" });
    pause.click();
    expect(paused).toBe(1);
    hud.setPause(null);
    expect(pause.classList.contains("shown")).toBe(false);
    expect(hud.pause()).toBeNull();
    hud.dispose();
  });

  it("has no old text button at the top right, and the rules Day Hike's carry: top left under the mute button, round, faint, up under the pointer", () => {
    const { container, hud } = made({ onPause: () => undefined });
    const css = (container.children[0] as StandInElement).textContent;
    expect(css).toContain("top: calc(68px + env(safe-area-inset-top, 0px))");
    expect(css).toContain("left: calc(14px + env(safe-area-inset-left, 0px))");
    expect(css).toMatch(/\.walk-hud \.pause \{[^}]*height: 44px[^}]*border-radius: 22px[^}]*opacity: 0\.35/);
    expect(css).toContain(".walk-hud .pause:hover, .walk-hud .pause:focus-visible { opacity: 1; }");
    expect(css).not.toMatch(/\.walk-hud button \{/);
    expect(css).not.toContain("right: 12px");
    expect(container.querySelector("button.pause")?.textContent).toBe("");
    hud.dispose();
  });

  it("is pressed without a hook to no effect, and a status line alone has neither control", () => {
    const { container, hud } = made(null);
    expect(container.querySelector("button.pause")).toBeNull();
    expect(container.querySelector("div.lamp")).toBeNull();
    hud.setPause({ key: "Esc" });
    expect(hud.pause()).toBeNull();
    hud.dispose();
  });
});

describe("the HUD's lamp hint, as Day Hike's is", () => {
  it("sits at the bottom left, lit with the lamp, in Day Hike's rules", () => {
    const { container, hud } = made({ onPause: () => undefined });
    const css = (container.children[0] as StandInElement).textContent;
    expect(css).toContain("bottom: calc(14px + env(safe-area-inset-bottom, 0px))");
    expect(css).toMatch(/\.walk-hud \.lamp \{[^}]*padding: 6px 10px 6px 8px[^}]*border-radius: 22px[^}]*opacity: 0\.35/);
    expect(css).toContain(".walk-hud .lamp.lit { opacity: 1; box-shadow: 0 0 0 1px #ffd24d; }");
    hud.dispose();
  });

  it("shows only when the shell wants it and the game says which lamp it is, with the key, lit while the lamp is on, and goes on null", () => {
    const { container, hud } = made({ onPause: () => undefined });
    const lamp = container.querySelector("div.lamp") as StandInElement;
    expect(hud.lamp()).toBeNull();
    // The shell asks for the hint; the game has not said which lamp F switches, so none shows.
    hud.setLamp({ key: "F", on: false });
    expect(lamp.classList.contains("shown")).toBe(false);
    hud.setLampKind("headlights");
    expect(lamp.classList.contains("shown")).toBe(true);
    expect(lamp.classList.contains("lit")).toBe(false);
    expect(lamp.querySelector("span.key")?.textContent).toBe("F");
    expect(hud.lamp()).toEqual({ kind: "headlights", key: "F", on: false });
    hud.setLamp({ key: "F", on: true });
    expect(lamp.classList.contains("lit")).toBe(true);
    expect(hud.lamp()).toEqual({ kind: "headlights", key: "F", on: true });
    hud.setLamp(null);
    expect(hud.lamp()).toBeNull();
    hud.setLamp({ key: "F", on: true });
    hud.setLampKind(null);
    expect(lamp.classList.contains("shown")).toBe(false);
    expect(lamp.classList.contains("lit")).toBe(false);
    hud.dispose();
  });

  it("swaps the torch for the car's headlights when the kind changes, and back, drawing each once", () => {
    const { container, hud } = made({ onPause: () => undefined });
    const lamp = container.querySelector("div.lamp") as StandInElement;
    hud.setLamp({ key: "F", on: false });
    hud.setLampKind("lamp");
    const torch = lamp.querySelector("svg") as StandInElement;
    expect(torch.querySelector("path")?.getAttribute("d")).toContain("M8.5 3h7");
    hud.setLampKind("headlights");
    const beams = lamp.querySelector("svg") as StandInElement;
    expect(beams).not.toBe(torch);
    // The same strokes as the engine's icons, and three beams leaving a housing.
    for (const [k, v] of [["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.6"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"]] as const) {
      expect(beams.getAttribute(k), k).toBe(v);
      expect(torch.getAttribute(k), k).toBe(v);
    }
    expect(beams.descendants().filter((e) => e.tagName === "PATH")).toHaveLength(4);
    expect(lamp.querySelectorAll("svg")).toHaveLength(1);
    expect(lamp.querySelector("span.key")?.textContent).toBe("F");
    hud.setLampKind("lamp");
    expect(lamp.querySelector("svg")).toBe(torch);
    hud.dispose();
  });
});

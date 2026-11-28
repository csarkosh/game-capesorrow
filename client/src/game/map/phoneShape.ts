/**
 * The phone the player takes out when the game is paused: its proportions, how it sits in the view, and how its bottom sheet moves. Pure: no DOM.
 *
 * It is a modern flagship phone of the long, narrow kind: a body 150.0 mm tall by 71.9 mm wide, a 6.3 inch display of 2622 by 1206 pixels, a slim even black border round the
 * screen, strongly rounded corners, and a pill-shaped camera cutout at the top of the screen. It is called only "the phone" everywhere in the game.
 */

/** The body's size in millimetres, and so its proportions. */
export const BODY_W_MM = 71.9, BODY_H_MM = 150.0;
export const BODY_ASPECT = BODY_H_MM / BODY_W_MM;
/** The display's pixels, for its proportions (the screen is a little narrower than the body by the border). */
export const DISPLAY_W_PX = 1206, DISPLAY_H_PX = 2622;
/** The black border round the screen, as a share of the body's width, each side. */
export const BORDER = 0.017;
/** The body's corner radius, as a share of its width; the screen's corners are concentric with them. */
export const BODY_RADIUS = 0.17;
/** The camera cutout, as shares of the screen's width: its width, its height, and how far its top is below the screen's top edge. */
export const CUTOUT_W = 0.30, CUTOUT_H = 0.085, CUTOUT_TOP = 0.03;
/** How much of the view's height the body takes on a wide window, and where its middle is across (the pause panel stays readable on the left of it). */
export const FILL_WIDE = 0.88, CENTRE_WIDE = 0.64;
/** On a narrow window: how much of the view's height the body takes at the most (it stands at the bottom, and the pause panel goes above it), and the margin. */
export const FILL_NARROW = 0.70, MARGIN_NARROW = 12;
/** Under this many pixels wide, a window is narrow. */
export const NARROW_WINDOW = 720;
/** How long the phone takes to slide up into place, and down, seconds. */
export const SLIDE_SECONDS = 0.3;

export type PhoneLayout = {
  /** The body's place and size in the view, pixels. */
  readonly left: number;
  readonly top: number;
  readonly bodyW: number;
  readonly bodyH: number;
  /** The border's width, the screen's size and its corner radius, the body's corner radius. */
  readonly inset: number;
  readonly screenW: number;
  readonly screenH: number;
  readonly screenRadius: number;
  readonly bodyRadius: number;
  /** The camera cutout in the screen's own pixels. */
  readonly cutout: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Where the screen's status bar ends (the cutout's bottom and a little more), in the screen's pixels. */
  readonly statusH: number;
  /** `side`: beside the pause panel on the right of the view; `bottom`: at the bottom of a narrow window, the pause panel above it. */
  readonly place: "side" | "bottom";
};

/** The phone's body of a given height, in all its proportions: built from the constants and nothing else. */
export function phoneOf(bodyH: number): Omit<PhoneLayout, "left" | "top" | "place"> {
  const bodyW = bodyH / BODY_ASPECT;
  const inset = BORDER * bodyW;
  const screenW = bodyW - 2 * inset;
  const screenH = bodyH - 2 * inset;
  const w = CUTOUT_W * screenW;
  return {
    bodyW, bodyH, inset, screenW, screenH,
    bodyRadius: BODY_RADIUS * bodyW,
    screenRadius: BODY_RADIUS * bodyW - inset,
    cutout: { x: (screenW - w) / 2, y: CUTOUT_TOP * screenW, w, h: CUTOUT_H * screenW },
    statusH: (CUTOUT_TOP + CUTOUT_H) * screenW + 6,
  };
}

/**
 * The phone in a view `vw` by `vh` pixels: on a wide window upright at the right of the middle (body 88 percent of the height, its middle at 64 percent across), and on a narrow one
 * (under 720 px) as tall as the width allows, at the bottom, centred. It never leaves the view.
 */
export function phoneLayout(vw: number, vh: number): PhoneLayout {
  if (vw >= NARROW_WINDOW) {
    let h = FILL_WIDE * vh;
    // Never wider than the room to the right of 40 percent of the view.
    h = Math.min(h, (vw * 0.58 - 8) * BODY_ASPECT);
    const p = phoneOf(h);
    const left = Math.min(vw - p.bodyW - 8, vw * CENTRE_WIDE - p.bodyW / 2);
    return { ...p, left, top: (vh - h) / 2, place: "side" };
  }
  const h = Math.min(FILL_NARROW * vh, (vw - 2 * MARGIN_NARROW) * BODY_ASPECT);
  const p = phoneOf(h);
  return { ...p, left: (vw - p.bodyW) / 2, top: vh - h - MARGIN_NARROW, place: "bottom" };
}

/** The bottom sheet: collapsed to a handle and the nearest place, or open to all of them. */
export type Sheet = "collapsed" | "expanded";

/** How far a drag of the handle must go to move the sheet, pixels. */
export const SHEET_DRAG = 18;

/**
 * What the sheet becomes after the handle is pressed and let go: a drag up of `SHEET_DRAG` or more opens it, a drag down of that much closes it, a short move is a tap and flips it.
 * `dy` is how far the pointer went down the screen (negative is up).
 */
export function sheetAfter(sheet: Sheet, dy: number): Sheet {
  if (dy <= -SHEET_DRAG) return "expanded";
  if (dy >= SHEET_DRAG) return "collapsed";
  return sheet === "collapsed" ? "expanded" : "collapsed";
}

/** The sheet's height in pixels: a handle, the rows it shows, and room for the home indicator. */
export function sheetHeight(sheet: Sheet, rows: number): number {
  return 22 + (sheet === "collapsed" ? Math.min(1, rows) : rows) * 54 + 20;
}

/**
 * Where a pointer at (`clientX`, `clientY`) is on a canvas whose css size is `w` by `h` and which the page shows in `rect` (its bounding box now, which carries the phone's
 * transform, as a slide or a scale): in the canvas's own pixels.
 */
export function pointerOnCanvas(rect: { left: number; top: number; width: number; height: number }, w: number, h: number, clientX: number, clientY: number): { x: number; y: number } {
  return { x: ((clientX - rect.left) * w) / (rect.width > 0 ? rect.width : w), y: ((clientY - rect.top) * h) / (rect.height > 0 ? rect.height : h) };
}

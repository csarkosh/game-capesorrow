/**
 * How the engine's roster (the party: `.roster` on the page's body, `roster.ts`) looks while the game is played and while it is paused, and
 * the small connection mark at the right of each row.
 *
 * Playing, the engine marks the roster `subdued`: this restyles it from the game's stylesheet into the bare rows, one a player, right
 * aligned over the map in the corner, in small type with a soft shadow and at about half strength, with no panel, heading, invite or
 * border behind them. Paused, the engine's full roster shows as it does, moved to the bottom left so that it does not lie under the large map.
 * The rules lean on the engine's class names (`roster`, `subdued`, `hidden`, `head`, `invite`, `stage`, `stalled`, `bar`, `note`, `error`,
 * `mark`, `self`); `client/test/map/party.test.ts` reads the engine's source and fails if one is gone.
 *
 * The mark is the game's own small element in each row (the engine's rows carry no connection state): a few rising bars, filled by the
 * link's round trip. The game can read only its own (a joined player's `stats.rttMs`; the host's own is 0): another player's row shows the
 * bars unfilled, never a guess.
 */

export const PARTY_CSS = `
body .roster.subdued {
  left: auto; right: calc(12px + env(safe-area-inset-right, 0px)); top: calc(12px + env(safe-area-inset-top, 0px)); bottom: auto;
  width: 220px; min-width: 0; max-width: none; box-sizing: border-box;
  padding: 0; background: none; border: none; border-radius: 0; box-shadow: none; backdrop-filter: none; opacity: 0.55;
  font-size: 0.72rem;
}
body .roster.subdued .head, body .roster.subdued .invite, body .roster.subdued .stage, body .roster.subdued .stalled,
body .roster.subdued .bar, body .roster.subdued .note, body .roster.subdued .error { display: none; }
body .roster.subdued ul { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
body .roster.subdued li { justify-content: flex-end; gap: 0.35rem; padding: 0 2px; background: none; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.55); }
body .roster.subdued li .mark { display: none; }
body .roster li .link { display: inline-flex; align-items: flex-end; gap: 1px; height: 11px; margin-left: 0.25rem; flex: none; }
body .roster li .link i { display: block; width: 2px; border-radius: 1px; background: #8fe3a0; box-shadow: 0 0 2px rgba(0, 0, 0, 0.7); }
body .roster li .link i:nth-child(1) { height: 3px; }
body .roster li .link i:nth-child(2) { height: 6px; }
body .roster li .link i:nth-child(3) { height: 8px; }
body .roster li .link i:nth-child(4) { height: 11px; }
body .roster li .link[data-n="2"] i { background: #ffd24d; }
body .roster li .link[data-n="1"] i { background: #ff8a7d; }
body .roster li .link[data-n="3"] i:nth-child(4), body .roster li .link[data-n="2"] i:nth-child(n+3), body .roster li .link[data-n="1"] i:nth-child(n+2), body .roster li .link[data-n="0"] i { opacity: 0.25; }
/* The large map open by the console's word while the game is played: the compact rows would lie over its edge. */
body.capemap-open .roster.subdued { display: none; }
@media (min-width: 720px) {
  body.capemap-open .roster:not(.subdued):not(.hidden) { left: 12px; right: auto; bottom: 12px; }
}
`;

/** How many of the four bars a round trip fills: 4 under 60 ms, 3 under 120, 2 under 200, else 1; 0 where it is not known. */
export function barsFor(rttMs: number | null): number {
  if (rttMs === null || !Number.isFinite(rttMs)) return 0;
  return rttMs < 60 ? 4 : rttMs < 120 ? 3 : rttMs < 200 ? 2 : 1;
}

export type Party = {
  /** Keeps the marks in the rows: the local player's round trip in milliseconds, or null where it is not known. Cheap: the page is looked at twice a second. */
  update(ownRttMs: number | null, now: number): void;
  dispose(): void;
};

export function createParty(doc: Document): Party {
  let roster: Element | null = null;
  let observer: MutationObserver | null = null;
  let own: number | null = null;
  let at = -Infinity;
  const mark = (): void => {
    if (roster === null) return;
    for (const li of Array.from(roster.querySelectorAll("li"))) {
      let link = li.querySelector("span.link");
      if (link === null) {
        link = doc.createElement("span");
        link.className = "link";
        for (let i = 0; i < 4; i++) link.append(doc.createElement("i"));
        li.append(link);
      }
      const n = String(li.classList.contains("self") ? barsFor(own) : 0);
      if (link.getAttribute("data-n") !== n) link.setAttribute("data-n", n);
    }
  };
  const attach = (el: Element | null): void => {
    if (el === roster) return;
    observer?.disconnect();
    observer = null;
    roster = el;
    if (el !== null && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(mark);
      observer.observe(el, { childList: true });
    }
  };
  return {
    update(rtt, now) {
      own = rtt;
      if (now - at < 0.5) return;
      at = now;
      attach(doc.querySelector(".roster"));
      mark();
    },
    dispose() {
      observer?.disconnect();
      roster = null;
    },
  };
}

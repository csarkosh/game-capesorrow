/**
 * How big the town is for the houses it holds: every number the "town fits its houses" change (the owner's check, 2026-11) authored, in
 * one place. EVERY NUMBER HERE IS AUTHORED, NOT RESEARCHED: the research found no figure for how far a town's grid reaches past its
 * houses, how long a business street is for so many dwellings, or how a street is cut back; they were set by looking at the plans
 * (`client/test/town/townSize.test.ts` asserts what they are for) and by one real ratio, the counted towns' tavern share
 * (`business/trades.ts`: 31 of 846 storefront businesses). Changing any of them changes the plan: raise `TOWN_GEN`.
 *
 * The aim: about 3.5 dwellings or more to each shop unit (a real town has perhaps 15 to 25; the condensed map cannot hold that), the
 * game's town of 200 to 260 houses in 299 buildings or fewer, and no more than about a tenth of the streets with no building near.
 */
export const SIZING = {
  // ---- How many lots the grid takes (`growth.ts`): growth stops when the blocks taken hold this many lots, whatever the block budget says.
  /** The area of block, m2, a lot takes (a block's lots are about 490 m2 of lot and a share of the alley and the corners). */
  LOT_AREA: 520,
  /** The lots the history's smallest budget lets the grid hold, and the lots each block of budget over the smallest adds. */
  LOTS_BASE: 330,
  LOTS_PER_BLOCK: 3,

  // ---- The business street (`layout.ts`).
  /** The share of the compass plat's blocks beside the highway that become the highway strip: it was 0.65. */
  STRIP_SHARE: 0.3,
  /** The dock district is the one block of the quay's row at least this many and under this many columns past the wharf street (it was every one from 1.5 on). */
  DOCK_FROM: 1.5,
  DOCK_TO: 2.5,

  // ---- What stands in the blocks (`buildings.ts`, `business/`).
  /** The town's fill raises every district's chance of a building until this many stand, or this share of the grid's lots, whichever is more. */
  MIN_BUILDINGS: 280,
  FILL: 0.88,
  /** Past a random cap in this range, houses thin out, one a lot (it was 330 to 430, over a town that held about 300). */
  HOUSE_CAP: [340, 420] as readonly [number, number],
  /** The weight of a tavern among the core's and the dock's building kinds (it was 6 and 25 of about 100 each), and of a tavern's trade in the dock's bays (it was 1.5). */
  TAVERN_CORE: 1.2,
  TAVERN_DOCK: 7,
  TAVERN_TRADE_DOCK: 0.7,
  /** The highway strip's weights of a motel, a gas station and a shop strip (they were 26, 24 and 14), and the most bays a strip of shops has (it was 6). */
  STRIP_MOTEL: 16,
  STRIP_GAS: 18,
  STRIP_SHOPS: 8,
  STRIP_BAYS_MAX: 3,

  // ---- Streets cut back to what they serve (`trim.ts`).
  /** A street serves a building whose wall stands within this of it, metres, and a building on a lot of more than `GROUND` m2 is served by every street along the lot. */
  SERVE: 20,
  GROUND: 2500,
  /** A street keeps this far past its last served stretch (a shop front is up to 24 m wide), metres; an alley with under this share of its length beside a building is dropped. */
  MARGIN: 10,
  ALLEY_SERVES: 0.55,

  // ---- Shops' sidewalks (`edges.ts`).
  /** A shop's sidewalk runs on past its frontage to the nearest junction or run, but no further than this, metres. */
  SHOP_WALK_REACH: 60,

  // ---- The downtown (`downtown.ts`). AUTHORED, NOT RESEARCHED: every business, lodging, apartment, the school, the hospital and the municipal building stand in one connected set of blocks.
  /** The area of block, m2, a downtown building takes (core lots are 7.6 to 15 m wide and about 25 m deep, a share of the alley and the corners). */
  DT_LOT: 300,
  /** The downtown grows until its blocks hold this many lots more than the blocks the old plan gave to shops, the dock and the highway strip (it makes room for the apartments, the school, the hospital and the courthouse the old plan spread over the town). */
  DT_EXTRA: 2,
  /** Two blocks are neighbours when they stand beside one street and no more than this far apart (a street's width, a cross street and a corner), metres. */
  DT_LINK: 30,
  /** The highway joins blocks too: a block is beside it within this far of its centre line, and two blocks across it are neighbours within this far apart, metres (the railroad's corridor and the highway lie between). */
  DT_BESIDE_HIGHWAY: 45,
  DT_LINK_HIGHWAY: 60,
  /** A block of fewer m2 than this is never added to the downtown (a sliver the land left). */
  DT_MIN_AREA: 1500,
  /** An added block within this of the highway, metres, is the highway strip (motels, gas stations, a big-box store, garages): as many as the old plan drew, at most this many. */
  DT_STRIP_NEAR: 60,
  DT_STRIP_MAX: 2,
  /** In an outer block of the downtown (one added past the old core and the dock, with a street to a block that is no part of it): the chance of a building on a lot, and the weights of a house and an apartment among its kinds. */
  DT_EDGE_OCC: 0.7,
  /** A strip block's chance of a building on a lot, and how near the highway's centre line, metres, a lot's middle stands for it to be on the strip's highway side. */
  DT_STRIP_OCC: 0.85,
  /** The share of a downtown block's lots built, at the least (a vacant or boarded building counts), and the fewest lodging and apartment buildings the downtown holds. */
  DT_BUILT: 0.65,
  /** The most buildings a town keeps before the houses of its hill blocks (the company's plat inland of the highway, 6500 m2 and more, near the town) are taken down. */
  TOWN_CAP: 296,
  /** ... and no more than this many are taken down (a larger town stays larger). */
  TOWN_CAP_MOST: 8,
  DT_LODGING_MIN: 8,
  DT_APARTMENT_MIN: 8,
  DT_HIGHWAY_SIDE: 50,
  /** The weight of a boarding house among the kinds of an outer block. */
  DT_EDGE_BOARDING: 8,
  DT_EDGE_HOUSE: 12,
  DT_EDGE_SHOP: 40,
  DT_EDGE_APARTMENT: 45,
  DT_EDGE_GARAGE: 4,
  /** The weight of a boarding house among the kinds of a block of the downtown. */
  DT_BOARDING: 3,
  /** The weight of an apartment among the kinds of an inner block (a shop is 86): on a lot of 12 m or more. */
  DT_CORE_APARTMENT: 60,

  // ---- The thin edge of the town (`outskirts.ts`): how far the highway's single buildings reach past the last block, metres (it was 560).
  OUT_REACH: 300,
} as const;

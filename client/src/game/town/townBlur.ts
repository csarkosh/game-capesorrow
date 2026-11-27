/**
 * A shop's room seen through its glass, out of focus: the further behind the pane a thing stands, the softer it is drawn.
 *
 * On a tier whose renderer keeps the frame as the opaque draws left it (the engine's `RenderMakeLate.behind`: the colour and the depth,
 * kept where the scene's pass is broken before the glass), a pane marked for it (`PaneLook.through`, a seed of 4 to 5) does not let the
 * room show through by blending. It reads the room from the kept frame instead, and reads it blurred by how far behind the glass each
 * place is: sharp at the pane, soft from `BLUR_FROM` metres in, as soft as it gets by `BLUR_FULL`. A place's distance behind the pane is
 * measured from the kept depth; its blur is `TAPS` reads of the kept colour over a disc whose radius is `BLUR_M` metres there, in the
 * frame's pixels. A read counts by how soft the place it lands on is itself, so a sharp thing at the window does not smear into the soft
 * room behind it, and a read that lands in front of the pane's own plane (the window's frame, the wall) does not count at all. The disc
 * is turned by a different angle at every pixel and every frame, which the renderer's blending of frames in time smooths.
 *
 * So the room is one thing to the eye, from the glass to its back wall: there is no sheet and no haze on this tier (`roomGeometry.ts`
 * draws the room whole), and what moves past the window moves as a room does. The pane then lays its film, its dirt and the sky's
 * reflection over what it read, and writes the whole pixel: `townGlassC` is taken by the glass's own alpha, and what was read is added
 * after the air's haze, which the kept frame carries already.
 *
 * A marked pane is an opaque draw (`townParts.ts`: a layer of its own, `through`, drawn first after the break), so it writes its own depth,
 * the plane of the glass, and the frame's alpha is its own to write: it says how much of the lines behind it it hides, which is how out of
 * focus it has read the place (`tbK`: 0 at the glass, 1 where the blur is whole). The ink line is drawn from the depth, which at the pane
 * is the pane's, so the engine's far softening (`finish.lineThrough`, `look.ts`) draws the lines of what is behind it from the depth the
 * first half left, and takes from each what this alpha hides: a thing at the glass keeps its line, a thing out of focus has less, by
 * degrees, and a thing whose picture is whole has none. Every pixel of a marked pane is composed here: the glass's own code makes every one
 * of them glass (a marked pane is clear glass in all its vertices), and one that was not would be the kept frame's own, sharp, and hide nothing.
 *
 * All three tiers keep the frame (the town's side says `keepsFrame`; the low tier, which has no post chain, breaks its scene's pass itself and its own line pass
 * runs the same rule). The low tier reads 16 times a pixel (`TAPS_LOW`) over a smaller disc (`BLUR_M_LOW`) where the others read 28, and turns the disc by the pixel alone: it has
 * no blending of frames in time, so a disc that turned every frame would shimmer. It reads the display's colour, not the chain's linear one, and lifts it (`ROOM_GAMMA_LOW`).
 * Its rooms are its coarse ones, drawn whole.
 *
 * **An open doorway** (`PaneLook.open`, a seed of 6 to 7; `frontGeometry.ts`): the opening of a shop's door whose leaf swings has a marked pane of its own, fixed to the doorway just behind the shut
 * leaf's inner face (`OPEN_BEHIND`), so the shut leaf, its glass, its plates and its lettering are all in front of it and it is hidden. It reads the room as any marked pane does, out of focus by how far
 * behind it each place is, and writes its depth and what it hides of the lines in the same way, but it is not glass: `townAlphaCode` makes it nothing of its own (no film, no dirt, no streaks, no
 * reflection: alpha 0 and no colour), so what comes out is the room as read and nothing else. The leaf, swinging into the room, goes behind it and is read through it (sharp at its hinge, softer toward
 * its free edge), a walker in the doorway is sharp at the threshold and softer the deeper they go, and one in front of its plane is not behind it and is untouched.
 *
 * The cost is the reads: 2 a tap (the colour and the depth) on every pixel of a marked pane. Lettering
 * is drawn after the glass on this tier (`townParts.ts`), since a pane now covers what was drawn before it.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import { FRAME_BLOCK, FRAME_PROJECTION_NAME } from "@csarkosh/engine/game/lite/frameBlock";
import { THROUGH_SEED } from "./buildingKit.js";
import { TOWN_VARYING } from "./townMaterial.js";

/** Where behind the pane the blur begins and where it is whole, metres. */
export const BLUR_FROM = 0.25;
export const BLUR_FULL = 1.3;
/** The radius of the blur where it is whole, metres at the place read. */
export const BLUR_M = 0.45;
/** The most the radius is, in the frame's pixels: a room seen from a step away would otherwise be read over a disc too wide for its taps. */
export const BLUR_MAX_PX = 80;
/** How much brighter a place deep in the room is read than it is, and the haze laid over it: its colour, how much of the place it takes, and by how much of the place's own brightness the haze is lit (a dark room has none). */
export const GLOW = 0.7;
export const HAZE: readonly [number, number, number] = [0.62, 0.59, 0.52];
export const HAZE_SHARE = 0.3;
export const HAZE_BY = 4;
/** Reads of the frame for one pixel. */
export const TAPS = 28;
/**
 * The low tier's reads of the frame for one pixel. That tier has no blending of frames in time to smooth a disc that turns every frame, so its disc is turned
 * by the pixel alone (the same turn every frame: nothing crawls), and it has fewer reads.
 */
export const TAPS_LOW = 16;
/** The low tier's disc: smaller than the others', since each of its reads is wider apart with so few of them (the same measure otherwise). */
export const BLUR_M_LOW = 0.34;
export const BLUR_MAX_PX_LOW = 50;
/**
 * What the low tier reads is not the chain's linear colour but the display's (the materials grade themselves there: tone mapped, the night's grade in the exposure), so a lit room read
 * from it is darker than the other tiers' at noon and far darker at night (the glow of a lamp is squeezed to nothing). Its read is lifted before the glow and the haze take it:
 * `ROOM_GAIN_LOW` times it to the power `ROOM_GAMMA_LOW`, which raises the dark more than the light, so a shut shop (almost black) stays dark; by how out of focus it is (`tbK`), so a thing at the glass is read as it is.
 */
export const ROOM_GAMMA_LOW = 0.5;
export const ROOM_GAIN_LOW = 0.76;

/** The frame behind the glass, as the engine keeps it. */
export type FrameBehind = { colour(): Texture2D; depth(): Texture2D };

const f = (n: number): string => n.toFixed(4);

const DEFINITIONS = [
  "var<private> townBehindC:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
  // How much of the lines behind the pane it hides, 0 to 1: written into the frame's alpha, the last thing the shader does.
  "var<private> townHide:f32=0.0;",
  // A number 0 to 1 from a pixel and the frame's clock: the turn of that pixel's disc.
  "fn townBlurTurn(p:vec2<f32>,t:f32)->f32{return fract(52.9829189*fract(dot(p+vec2<f32>(t*37.0,t*17.0),vec2<f32>(0.06711056,0.00583715))));}",
].join("");

/** After the glass's own colour and alpha are made (`townAlphaCode`): the room behind a marked pane, read out of focus, and how much of its lines the pane hides. */
function blurCode(low: boolean): string {
  const taps = low ? TAPS_LOW : TAPS;
  const P = `${FRAME_BLOCK}.${FRAME_PROJECTION_NAME}`;
  return [
    `let tbSeed=input.${TOWN_VARYING}.z;`,
    // The pane's own distance along the view and how it changes across the screen: the pane's plane at a neighbouring pixel.
    `let tbZp=${P}[3].z/(input.clipPos.z-${P}[2].z);`,
    "let tbGx=dpdx(tbZp);let tbGy=dpdy(tbZp);",
    `if(tbSeed>${f(THROUGH_SEED - 0.5)}){`,
    "let tbDims=vec2<f32>(textureDimensions(townKept));",
    "let tbMax=vec2<i32>(tbDims)-vec2<i32>(1,1);",
    "let tbHere=input.clipPos.xy;",
    "let tbCentre=textureSampleLevel(townKept,townKeptSmp,tbHere/tbDims,0.0).rgb;",
    // A marked pane is all glass, so this is the way of every pixel of one. A pixel that is not glass (the glass's code makes none) is the kept frame's own, sharp: none of the glass's colour, all of what was read.
    "if(townGlassA>0.5){",
    `let tbZb=${P}[3].z/(textureLoad(townKeptDepth,clamp(vec2<i32>(tbHere),vec2<i32>(0,0),tbMax),0).r-${P}[2].z);`,
    // Metres into the room, square to the pane, a metre of view distance behind it: the ray's length a metre of view distance, by how square the ray meets the pane.
    "let tbToEye=scene.vEyePosition.xyz-input.worldPos;",
    "let tbRayLen=length(tbToEye);",
    "let tbIn=tbRayLen/max(tbZp,0.001)*abs(dot(N,tbToEye/max(tbRayLen,0.001)));",
    "let tbDeep=max(0.0,(tbZb-tbZp)*tbIn);",
    `let tbK=smoothstep(${f(BLUR_FROM)},${f(BLUR_FULL)},tbDeep);`,
    // The disc's radius in the frame's pixels: the blur's metres at the place read, through the frame's own lens.
    `let tbFocal=abs(${P}[1].y)*tbDims.y*0.5;`,
    `let tbR=min(${f(low ? BLUR_MAX_PX_LOW : BLUR_MAX_PX)},${f(low ? BLUR_M_LOW : BLUR_M)}*tbK*tbFocal/max(tbZb,0.2));`,
    "var tbSum=vec3<f32>(0.0,0.0,0.0);var tbW=0.0;",
    // The turn differs by pixel and, off the low tier, by frame (which the renderer's blending of frames in time smooths); on the low tier it is the pixel's alone.
    `let tbTurn=townBlurTurn(tbHere,${low ? "0.0" : `${FRAME_BLOCK}.moteClock`})*6.2831853;`,
    `for(var tbI:i32=0;tbI<${taps};tbI++){`,
    `let tbF=(f32(tbI)+0.5)/${taps.toFixed(1)};`,
    "let tbA=f32(tbI)*2.3999632+tbTurn;",
    "let tbOff=vec2<f32>(cos(tbA),sin(tbA))*sqrt(tbF)*tbR;",
    "let tbQ=tbHere+tbOff;",
    `let tbZq=${P}[3].z/(textureLoad(townKeptDepth,clamp(vec2<i32>(tbQ),vec2<i32>(0,0),tbMax),0).r-${P}[2].z);`,
    // How far behind the pane's own plane the place read is; in front of it (the frame, the wall) it does not count.
    "let tbBehind=(tbZq-(tbZp+tbGx*tbOff.x+tbGy*tbOff.y))*tbIn;",
    `let tbWq=step(0.03,tbBehind)*max(0.04,smoothstep(${f(BLUR_FROM)},${f(BLUR_FULL)},tbBehind));`,
    "tbSum+=textureSampleLevel(townKept,townKeptSmp,tbQ/tbDims,0.0).rgb*tbWq;tbW+=tbWq;",
    "}",
    "var tbRoom=tbCentre;",
    "if(tbW>0.001){tbRoom=mix(tbCentre,tbSum/tbW,tbK);}",
    ...(low ? [`tbRoom=mix(tbRoom,pow(max(tbRoom,vec3<f32>(0.0,0.0,0.0)),vec3<f32>(${f(ROOM_GAMMA_LOW)}))*${f(ROOM_GAIN_LOW)},tbK);`] : []),
    // A lit room out of focus glows: what is read is brighter the further in it is, and a little of it is the room's own light spread
    // over everything, as a steamed pane spreads it. Both by the room's own brightness, so a shut shop stays dark.
    `let tbLum=dot(tbRoom,vec3<f32>(0.2126,0.7152,0.0722));`,
    `tbRoom=tbRoom*(1.0+${f(GLOW)}*tbK);`,
    `tbRoom=mix(tbRoom,vec3<f32>(${HAZE.map(f).join(",")})*clamp(tbLum*${f(HAZE_BY)},0.0,1.0),${f(HAZE_SHARE)}*tbK);`,
    // The pane writes the whole pixel: its own colour by its alpha, and what it read by the rest. What it hides of the lines behind it is how soft it read them.
    "townBehindC=tbRoom*(1.0-alpha);",
    "townGlassC=townGlassC*alpha;",
    "townHide=tbK;",
    "alpha=1.0;",
    "}else{",
    "townBehindC=tbCentre;",
    "townGlassC=vec3<f32>(0.0,0.0,0.0);",
    "townGlassA=1.0;",
    "alpha=1.0;",
    "}",
    "}",
  ].join("");
}

/** The plugin a glass material wears beside the town's own, after it, where the frame behind the glass is kept. */
export function townBlurPlugin(behind: FrameBehind, shared: PluginUniformBlock, low = false): MaterialPlugin {
  return {
    name: "TownBlur",
    priority: 210,
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: DEFINITIONS, CUSTOM_FRAGMENT_BEFORE_LIGHTS: blurCode(low), CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "color+=townBehindC;alpha=townHide;" }
        : {},
    getUniformBlocks: () => [shared],
    getSamplers: () => [{ texture: "townKept", sampler: "townKeptSmp" }, { texture: "townKeptDepth", sampleType: "unfilterable-float" as const }],
    // The passes' own, as they stand when the bindings are made: never counted among the material's.
    bindTextures(out) {
      out.push({ texture: behind.colour() }, { texture: behind.depth(), sampler: false });
    },
  };
}

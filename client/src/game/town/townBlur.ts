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
 * reflection over what it read, and writes the whole pixel: `townGlassC` is taken by the glass's own alpha and the alpha set to 1, and
 * what was read is added after the air's haze, which the kept frame carries already.
 *
 * The cost is the reads: 2 a tap (the colour and the depth) on every pixel of a marked pane, on the tiers that keep the frame. Lettering
 * is drawn after the glass on this tier (`townParts.ts`), since a pane now covers what was drawn before it.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import { FRAME_BLOCK, FRAME_PROJECTION_NAME } from "@csarkosh/engine/game/lite/frameBlock";
import { THROUGH_SEED } from "./buildingKit.js";
import { TOWN_VARYING } from "./townMaterial.js";

/** Where behind the pane the blur begins and where it is whole, metres. */
export const BLUR_FROM = 0.35;
export const BLUR_FULL = 2.2;
/** The radius of the blur where it is whole, metres at the place read. */
export const BLUR_M = 0.3;
/** The most the radius is, in the frame's pixels: a room seen from a step away would otherwise be read over a disc too wide for its taps. */
export const BLUR_MAX_PX = 56;
/** How much brighter a place deep in the room is read than it is, and the haze laid over it: its colour, how much of the place it takes, and by how much of the place's own brightness the haze is lit (a dark room has none). */
export const GLOW = 0.7;
export const HAZE: readonly [number, number, number] = [0.62, 0.59, 0.52];
export const HAZE_SHARE = 0.3;
export const HAZE_BY = 4;
/** Reads of the frame for one pixel. */
export const TAPS = 20;

/** The frame behind the glass, as the engine keeps it. */
export type FrameBehind = { colour(): Texture2D; depth(): Texture2D };

const f = (n: number): string => n.toFixed(4);

const DEFINITIONS = [
  "var<private> townBehindC:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
  // A number 0 to 1 from a pixel and the frame's clock: the turn of that pixel's disc.
  "fn townBlurTurn(p:vec2<f32>,t:f32)->f32{return fract(52.9829189*fract(dot(p+vec2<f32>(t*37.0,t*17.0),vec2<f32>(0.06711056,0.00583715))));}",
].join("");

/** After the glass's own colour and alpha are made (`townAlphaCode`): the room behind a marked pane, read out of focus. */
function blurCode(): string {
  const P = `${FRAME_BLOCK}.${FRAME_PROJECTION_NAME}`;
  return [
    `let tbSeed=input.${TOWN_VARYING}.z;`,
    // The pane's own distance along the view and how it changes across the screen: the pane's plane at a neighbouring pixel.
    `let tbZp=${P}[3].z/(input.clipPos.z-${P}[2].z);`,
    "let tbGx=dpdx(tbZp);let tbGy=dpdy(tbZp);",
    `if(tbSeed>${f(THROUGH_SEED - 0.5)}&&townGlassA>0.5){`,
    "let tbDims=vec2<f32>(textureDimensions(townKept));",
    "let tbMax=vec2<i32>(tbDims)-vec2<i32>(1,1);",
    "let tbHere=input.clipPos.xy;",
    `let tbZb=${P}[3].z/(textureLoad(townKeptDepth,clamp(vec2<i32>(tbHere),vec2<i32>(0,0),tbMax),0).r-${P}[2].z);`,
    // Metres into the room, square to the pane, a metre of view distance behind it: the ray's length a metre of view distance, by how square the ray meets the pane.
    "let tbToEye=scene.vEyePosition.xyz-input.worldPos;",
    "let tbRayLen=length(tbToEye);",
    "let tbIn=tbRayLen/max(tbZp,0.001)*abs(dot(N,tbToEye/max(tbRayLen,0.001)));",
    "let tbDeep=max(0.0,(tbZb-tbZp)*tbIn);",
    `let tbK=smoothstep(${f(BLUR_FROM)},${f(BLUR_FULL)},tbDeep);`,
    // The disc's radius in the frame's pixels: the blur's metres at the place read, through the frame's own lens.
    `let tbFocal=abs(${P}[1].y)*tbDims.y*0.5;`,
    `let tbR=min(${f(BLUR_MAX_PX)},${f(BLUR_M)}*tbK*tbFocal/max(tbZb,0.2));`,
    "let tbCentre=textureSampleLevel(townKept,townKeptSmp,tbHere/tbDims,0.0).rgb;",
    "var tbSum=vec3<f32>(0.0,0.0,0.0);var tbW=0.0;",
    `let tbTurn=townBlurTurn(tbHere,${FRAME_BLOCK}.moteClock)*6.2831853;`,
    `for(var tbI:i32=0;tbI<${TAPS};tbI++){`,
    `let tbF=(f32(tbI)+0.5)/${TAPS.toFixed(1)};`,
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
    // A lit room out of focus glows: what is read is brighter the further in it is, and a little of it is the room's own light spread
    // over everything, as a steamed pane spreads it. Both by the room's own brightness, so a shut shop stays dark.
    `let tbLum=dot(tbRoom,vec3<f32>(0.2126,0.7152,0.0722));`,
    `tbRoom=tbRoom*(1.0+${f(GLOW)}*tbK);`,
    `tbRoom=mix(tbRoom,vec3<f32>(${HAZE.map(f).join(",")})*clamp(tbLum*${f(HAZE_BY)},0.0,1.0),${f(HAZE_SHARE)}*tbK);`,
    // The pane writes the whole pixel: its own colour by its alpha, and what it read by the rest.
    "townBehindC=tbRoom*(1.0-alpha);",
    "townGlassC=townGlassC*alpha;",
    "alpha=1.0;",
    "}",
  ].join("");
}

/** The plugin a glass material wears beside the town's own, after it, where the frame behind the glass is kept. */
export function townBlurPlugin(behind: FrameBehind, shared: PluginUniformBlock): MaterialPlugin {
  return {
    name: "TownBlur",
    priority: 210,
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: DEFINITIONS, CUSTOM_FRAGMENT_BEFORE_LIGHTS: blurCode(), CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "color+=townBehindC;" }
        : {},
    getUniformBlocks: () => [shared],
    getSamplers: () => [{ texture: "townKept", sampler: "townKeptSmp" }, { texture: "townKeptDepth", sampleType: "unfilterable-float" as const }],
    // The passes' own, as they stand when the bindings are made: never counted among the material's.
    bindTextures(out) {
      out.push({ texture: behind.colour() }, { texture: behind.depth(), sampler: false });
    },
  };
}

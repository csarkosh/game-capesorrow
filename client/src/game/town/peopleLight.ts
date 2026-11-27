/**
 * The town's lamps' light on the people, per pixel. A person's body is the engine's skinned model, whose instances carry a matrix and a place
 * in a clip and nothing else, so there is no colour a body can be handed to add to its lit colour; the light is added in the body's material by
 * a plugin of ours instead, from the same list of nearest lamps the town's surfaces are lit by (`lampLight.ts`, written once a frame by
 * `townParts.ts`), with the same falloff and the same soft wrap (`townMaterial.ts`, `LAMP_CODE`). A person under a street lamp or outside a lit
 * window takes the light a wall beside them does, and a figure is not black on lit pavement. The day pays nothing: no lamp lit, no loop.
 *
 * The uniforms are this plugin's own (`people...`), so the materials of the people and the town's do not share a name.
 */
import type { MaterialPlugin } from "@babylonjs/lite";
import { uniformFields, writeUniforms, type UniformField } from "@csarkosh/engine/game/lite/pluginUniforms";
import { MAX_LAMPS, type LampList } from "./lampLight.js";
import { LAMP_FULL, LAMP_GAIN, LAMP_WRAP } from "./townMaterial.js";

/** The uniforms: how many lamps (0 by day), what a glow is multiplied by at the hour (as the town's glows are), and the list. */
export type PeopleLamps = { peopleLamps: number[]; peopleGlow: number[] } & Record<string, number[]>;

export function emptyPeopleLamps(): PeopleLamps {
  const r: PeopleLamps = { peopleLamps: [0], peopleGlow: [1] };
  for (let i = 0; i < MAX_LAMPS; i++) {
    r[`peopleLampP${i}`] = [0, 0, 0, 0];
    r[`peopleLampC${i}`] = [0, 0, 0, 0];
  }
  return r;
}

/** Copies a lamp list into the uniforms, with the hour's glow gain. */
export function writePeopleLamps(ready: PeopleLamps, list: LampList, glow: number): void {
  ready.peopleLamps[0] = list.count;
  ready.peopleGlow[0] = glow;
  for (let i = 0; i < list.count; i++) {
    const p = ready[`peopleLampP${i}`] as number[];
    const c = ready[`peopleLampC${i}`] as number[];
    for (let k = 0; k < 4; k++) {
      p[k] = list.pos[i * 4 + k] as number;
      c[k] = list.col[i * 4 + k] as number;
    }
  }
}

/** How much more than a wall the lamps light a person: a body is small and dark clothed, and the same sum left a figure black at a door that lit its wall. */
export const PEOPLE_GAIN = 3;
const FIELDS: readonly UniformField[] = uniformFields(emptyPeopleLamps());
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The WGSL at `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`: the same sum as `LAMP_CODE`'s, kept in a private glow added to the colour before the fog. */
export const PEOPLE_LAMP_CODE = [
  "if(material.peopleLamps>0.5){",
  `var plP:array<vec4<f32>,${MAX_LAMPS}>;var plC:array<vec4<f32>,${MAX_LAMPS}>;`,
  ...Array.from({ length: MAX_LAMPS }, (_, i) => `plP[${i}]=material.peopleLampP${i};plC[${i}]=material.peopleLampC${i};`),
  "var plSum=vec3<f32>(0.0);",
  "for(var li:i32=0;li<i32(material.peopleLamps+0.5);li=li+1){",
  "let lp=plP[li];let lc=plC[li];let ld=lp.xyz-input.worldPos;let lr=length(ld);",
  "if(lr<lp.w){",
  `let lq=clamp((lr-lp.w*${f(LAMP_FULL)})/(lp.w*${f(1 - LAMP_FULL)}),0.0,1.0);let lf=1.0-lq*lq*(3.0-2.0*lq);`,
  `let lw=clamp((dot(N,ld/max(lr,0.001))+${f(LAMP_WRAP)})/${f(1 + LAMP_WRAP)},0.0,1.0);`,
  "plSum=plSum+lc.rgb*(lc.w*lf*lw*lw);}",
  "}",
  `peopleLit=baseColor*plSum*${f(LAMP_GAIN)}*${f(PEOPLE_GAIN)};`,
  "}",
].join("");

/** The plugin. Its priority is under the air's (900), so the light is added before the fog. */
export function peopleLampPlugin(ready: PeopleLamps): MaterialPlugin {
  return {
    name: "PeopleLamps",
    priority: 200,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: "var<private> peopleLit:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
          CUSTOM_FRAGMENT_UPDATE_DIFFUSE: PEOPLE_LAMP_CODE,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "color=color+peopleLit*material.peopleGlow;",
        }
        : null,
    getUniforms: () => ({ ubo: [...FIELDS] }),
    writeUbo(data, offsets) {
      writeUniforms(data, offsets, ready);
    },
  };
}

/**
 * The material plugin that makes each parked vehicle its own: on Babylon Lite's PBR material, over the model's own maps, it wears what
 * the vehicle's plan record says (`vehicleLook.ts`), by instance. The numbers ride in the mesh's plugin instance data, eight floats
 * (`FLEET_DATA_FLOATS`): `vehA` = the paint (rgb, linear) and the road grime; `vehB` = the dust on the glass, the algae and leaf litter, a
 * seed that offsets the noise, and how far the clear coat has gone. The vertex stage hands them on with the vertex's height in the model
 * (`vVehY`, metres over the tyres' lowest point).
 *
 * What a part does with them, by its role (the glTF's material name, which `tools/models/build.py` gives):
 *
 * - `paint` takes its colour from the vehicle (the file's paint has no texture): mottled a little in world-space noise that the seed moves,
 *   paler and rougher on what faces up and where the clear coat has gone, with road grime thick at the rocker and fading by about 0.8 m,
 *   and, for a vehicle that never moves, algae along the low and the up-facing and leaves caught in it.
 * - `body` (the worn models, whose colour is their own texture) takes the grime and the algae over it, a little.
 * - `tyre` and `under` are dusted with the road, `lamp` and `plate` a little.
 * - `glass` is dusted: it goes paler, rougher and less clear in patches, more near the base of the window than the top.
 * - `interior` is as it is.
 */
import type { MaterialPlugin } from "@babylonjs/lite";

/** The numbers an instance carries, and the attribute names. */
export const VEHICLE_ATTRIBUTES = [
  { name: "vehA", type: "vec4<f32>", format: "float32x4" as const, stride: 48, offset: 0 },
  { name: "vehB", type: "vec4<f32>", format: "float32x4" as const, stride: 48, offset: 16 },
  { name: "vehC", type: "vec4<f32>", format: "float32x4" as const, stride: 48, offset: 32 },
];

/** Where the parts of a model are, in its own metres (read off the parts by `vehicleParts.ts`): the axles' x (rear, front) and the wheels' radius, the side glass's lowest and highest y, and the windscreen's nose-most edge, its lowest and highest y and half width. */
export type VehicleGeom = {
  readonly axles: readonly [number, number];
  readonly wheel: number;
  readonly glass: readonly [number, number];
  readonly screen: { readonly x: number; readonly y0: number; readonly y1: number; readonly zh: number };
};
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : n.toFixed(4));

const DEFINITIONS = [
  "fn vhHash(c:vec3<i32>)->f32{",
  "var h=bitcast<u32>(c.x)*374761393u+bitcast<u32>(c.y)*668265263u+bitcast<u32>(c.z)*2147483647u;",
  "h=(h^(h>>13u))*1274126177u;h=h^(h>>16u);",
  "return f32(h&16777215u)/16777216.0;}",
  "fn vhValue(p:vec3<f32>)->f32{",
  "let i=floor(p);let q=fract(p);let s=q*q*(3.0-2.0*q);let c=vec3<i32>(i);",
  "let a=mix(mix(vhHash(c),vhHash(c+vec3<i32>(1,0,0)),s.x),mix(vhHash(c+vec3<i32>(0,1,0)),vhHash(c+vec3<i32>(1,1,0)),s.x),s.y);",
  "let b=mix(mix(vhHash(c+vec3<i32>(0,0,1)),vhHash(c+vec3<i32>(1,0,1)),s.x),mix(vhHash(c+vec3<i32>(0,1,1)),vhHash(c+vec3<i32>(1,1,1)),s.x),s.y);",
  "return mix(a,b,s.z);}",
].join("");

/** What every role reads: the vehicle's numbers, the noise at three scales, how low the point is, and the road film, mud, rust and moss there. */
function prelude(m: VehicleGeom): string {
  const [rear, front] = m.axles;
  const w = m.wheel;
  return [
    "let vhA=input.vVehA;let vhB=input.vVehB;let vhC=input.vVehC;let vhM=input.vVehP;let vhY=vhM.y;",
    "let vhP=input.worldPos+vec3<f32>(vhB.z*173.0,vhB.z*59.0,vhB.z*311.0);",
    "let vhN1=vhValue(vhP*1.3);let vhN2=vhValue(vhP*5.1+vec3<f32>(7.0,3.0,1.0));let vhN3=vhValue(vhP*19.0);",
    "let vhUp=clamp(N.y,0.0,1.0);",
    "let vhLow=1.0-smoothstep(0.2,1.0,vhY);",
    // Road film: a tide line that climbs the doors to the handles on a dirty car, ragged with the noise and streaked by the rain.
    "let vhTop=0.3+0.75*vhA.w*(0.6+0.8*vhN1);",
    "let vhFilm=1.0-smoothstep(vhTop-0.4,vhTop,vhY+0.12*vhValue(vec3<f32>(vhM.x*9.0,vhY*1.2,vhM.z*9.0)));",
    "let vhGrime=clamp(vhFilm*(0.75+0.7*vhN2)*(0.65+0.6*vhA.w)+vhA.w*0.12*vhN1,0.0,0.95);",
    "let vhGrimeC=vec3<f32>(0.15,0.122,0.088)*(0.75+0.5*vhN3);",
    // Mud thrown up behind each wheel: from the axle back along the sill and the lower door, in spatter.
    `let vhD0=${f(rear)}-vhM.x;let vhD1=${f(front)}-vhM.x;`,
    "let vhB0=smoothstep(-0.3,0.0,vhD0)*(1.0-smoothstep(0.35,1.1,vhD0));let vhB1=smoothstep(-0.3,0.0,vhD1)*(1.0-smoothstep(0.35,1.1,vhD1));",
    "let vhMud=clamp(vhC.w*(vhB0+vhB1)*(1.0-smoothstep(0.35,0.85,vhY))*smoothstep(0.25,0.6,vhN2*0.6+vhN3*0.4+0.2),0.0,0.95);",
    // Rust rings each arch and runs along the sill, in patches.
    `let vhR0=length(vec2<f32>(vhM.x-${f(rear)},vhY-${f(w)}));let vhR1=length(vec2<f32>(vhM.x-${f(front)},vhY-${f(w)}));`,
    `let vhArch=(1.0-smoothstep(${f(w + 0.04)},${f(w + 0.2)},min(vhR0,vhR1)))*(1.0-smoothstep(0.5,0.75,vhY));`,
    "let vhSill=1.0-smoothstep(0.16,0.34,vhY);",
    "let vhRust=clamp(vhC.x*(vhArch+vhSill*0.9)*smoothstep(0.25,0.5,vhN2*0.55+vhN3*0.45),0.0,0.95);",
    // Algae along what is low and what faces up, in patches; leaves caught on what is nearly flat.
    `let vhChan=(smoothstep(${f(m.glass[0] - 0.1)},${f(m.glass[0] - 0.02)},vhY)*(1.0-smoothstep(${f(m.glass[0])},${f(m.glass[0] + 0.05)},vhY)))*(1.0-smoothstep(0.5,0.9,vhUp));`,
    "let vhAlgae=clamp(vhB.y*(vhUp*0.8+vhLow*0.7)*smoothstep(0.38,0.62,vhN1*0.5+vhN2*0.5),0.0,0.85);",
    "let vhChannel=clamp(vhB.y*vhChan*smoothstep(0.25,0.5,vhN2*0.7+vhN3*0.3),0.0,0.95);",
    "let vhLeaf=vhB.y*step(0.78,vhN3)*smoothstep(0.55,0.9,vhUp);",
  ].join("");
}

const MOSS = "baseColor=mix(baseColor,vec3<f32>(0.04,0.065,0.022),vhAlgae*0.85);baseColor=mix(baseColor,vec3<f32>(0.11,0.065,0.028),vhLeaf*0.8);baseColor=mix(baseColor,vec3<f32>(0.03,0.07,0.02),vhChannel);roughness=mix(roughness,0.95,max(max(vhAlgae,vhLeaf),vhChannel));";
const MUD = "baseColor=mix(baseColor,vec3<f32>(0.09,0.065,0.04),vhMud*0.9);roughness=mix(roughness,0.95,vhMud);";
const RUST = "baseColor=mix(baseColor,mix(vec3<f32>(0.2,0.075,0.03),vec3<f32>(0.1,0.04,0.02),vhN3),vhRust);roughness=mix(roughness,0.95,vhRust);metallic=0.0;";

function paintCode(m: VehicleGeom): string {
  const [rear, front] = m.axles;
  return [
    "var vhC2=vhA.rgb*(0.9+0.2*vhN1)*(0.94+0.12*vhN3);",
    // The sun takes the clear coat of what faces up first: pale, chalky and rough on roofs and bonnets.
    "let vhOx=vhUp*vhB.w*(0.55+0.6*vhN2);",
    "vhC2=mix(vhC2,vhC2*0.45+vec3<f32>(0.2,0.195,0.18)*(0.35+vhA.r),clamp(vhOx,0.0,1.0)*0.7);",
    // A primer-grey panel on one side: a door or a wing, its edge ragged.
    `let vhPx=${f(rear + 0.45)}+(${f(front - rear - 0.9)})*vhC.y;`,
    "let vhSide=select(-1.0,1.0,fract(vhC.y*13.7)>0.5);",
    `let vhPan=step(0.001,vhC.y)*smoothstep(0.0,0.06,0.5-abs(vhM.x-vhPx)+0.05*vhN3)*step(0.0,vhM.z*vhSide)*smoothstep(0.38,0.46,vhY)*(1.0-smoothstep(${f(m.glass[0] - 0.05)},${f(m.glass[0])},vhY));`,
    "vhC2=mix(vhC2,vec3<f32>(0.13,0.13,0.125)*(0.85+0.3*vhN2),vhPan);",
    // Rain runs: a faint darker streak down the sides.
    "let vhStreak=vhValue(vec3<f32>((vhP.x+vhP.z)*8.0,vhP.y*0.5,1.0));",
    "vhC2=mix(vhC2,vhC2*0.78,0.3*vhStreak*(1.0-vhUp));",
    "baseColor=mix(vhC2,vhGrimeC,vhGrime);",
    "roughness=clamp(mix(0.38+vhB.w*0.4+clamp(vhOx,0.0,1.0)*0.35,0.92,vhGrime),0.05,1.0);",
    "roughness=mix(roughness,0.85,vhPan);",
    "metallic=0.0;",
    MUD,
    RUST,
    MOSS,
  ].join("");
}

const BODY = `baseColor=mix(baseColor,baseColor*vec3<f32>(0.72,0.7,0.64),vhGrime*0.7);${MUD}${RUST}${MOSS}`;
// The wheel's texture carries red calipers and bright rotors and hub plates: the calipers go dark iron and the bright metal dull steel, whatever the file's colours.
const TYRE = [
  "let vhL=dot(baseColor,vec3<f32>(0.2126,0.7152,0.0722));",
  "let vhRed=clamp((baseColor.r-max(baseColor.g,baseColor.b))*4.0,0.0,1.0);",
  "baseColor=mix(baseColor,vec3<f32>(0.03,0.026,0.024)+vec3<f32>(vhL*0.2),vhRed);",
  "baseColor=mix(baseColor,vec3<f32>(0.04,0.038,0.035)+baseColor*0.1,smoothstep(0.05,0.2,vhL));",
  "baseColor=mix(baseColor,vec3<f32>(0.1,0.085,0.065),vhGrime*0.55+vhMud*0.4);",
].join("");
const LAMP_PLATE = "baseColor=mix(baseColor,vec3<f32>(0.12,0.1,0.08),vhGrime*0.5);";
const UNDER = "baseColor=mix(baseColor,vec3<f32>(0.1,0.085,0.065),vhGrime*0.8);";
function lampCode(m: VehicleGeom): string {
  // One headlamp of a car that has aged is dull: yellowed and hazed, the other as it was.
  return [
    "baseColor=mix(baseColor,vec3<f32>(0.12,0.1,0.08),vhGrime*0.5);",
    `let vhDull=step(${f(m.axles[1] + 0.1)},vhM.x)*step(0.5,abs(vhC.z))*step(0.0,vhM.z*vhC.z);`,
    "baseColor=mix(baseColor,vec3<f32>(0.2,0.17,0.1)*0.55,vhDull*0.8);roughness=mix(roughness,0.9,vhDull);",
  ].join("");
}
function glassCode(m: VehicleGeom): string {
  const sc = m.screen;
  const pz = sc.zh * 0.12;
  const arm = sc.zh * 0.95;
  return [
  "let vhDust0=clamp(vhB.x*(0.3+0.7*vhN1)*(0.55+0.45*(1.0-smoothstep(0.5,1.5,vhY))),0.0,1.0);",
  // The windscreen: two blades pivot near its middle at the lower edge and sweep outward and up; what they reach is wiped, with a clean edge at the arc's end.
  `let vhScr=step(${f(sc.x - 0.06)},vhM.x)*step(abs(vhM.z),${f(sc.zh + 0.03)})*step(${f(sc.y0 - 0.03)},vhY);`,
  `let vhQ=vec2<f32>(abs(vhM.z)-${f(pz)},vhY-${f(sc.y0 + 0.03)});`,
  "let vhRr=length(vhQ);let vhAng=atan2(vhQ.y,vhQ.x);",
  `let vhWipe=vhScr*(1.0-smoothstep(${f(arm - 0.05)},${f(arm)},vhRr))*smoothstep(0.06,0.14,vhAng)*(1.0-smoothstep(1.2,1.34,vhAng))*step(0.03,vhRr);`,
  "let vhDust=vhDust0*(1.0-vhWipe*0.92);",
  "baseColor=mix(baseColor,vec3<f32>(0.2,0.19,0.17),vhDust*0.75);",
  "roughness=mix(roughness,0.8,vhDust);",
  `baseColor=mix(baseColor,vec3<f32>(0.04,0.065,0.022),vhAlgae*0.4);`,
  `baseColor=mix(baseColor,vec3<f32>(0.03,0.07,0.02),vhB.y*(1.0-smoothstep(${f(m.glass[0])},${f(m.glass[0] + 0.1)},vhY))*0.7*smoothstep(0.3,0.55,vhN2));`,
  ].join("");
}

const ROLES = ["paint", "body", "tyre", "under", "lamp", "plate", "glass"];

/** The fragment code for a role at the surface's point, or null for a role that wears nothing. */
export function vehicleSurfaceCode(role: string, m: VehicleGeom): string | null {
  const r = role.replace(/\d+$/, "");
  const body = { paint: paintCode(m), body: BODY, tyre: TYRE, under: UNDER, lamp: lampCode(m), plate: LAMP_PLATE, glass: glassCode(m) }[r as "paint"];
  return body === undefined ? null : prelude(m) + body;
}

/** The plugin for a part of a role, or null where the role wears nothing (the interior). */
export function vehiclePlugin(role: string, m: VehicleGeom): MaterialPlugin | null {
  const surface = vehicleSurfaceCode(role, m);
  if (surface === null) return null;
  const glass = role === "glass";
  return {
    name: "Vehicle",
    priority: 200,
    defines: { role: ROLES.indexOf(role.replace(/\d+$/, "")) },
    getCustomCode: (stage) =>
      stage === "fragment"
        // The glass's alpha is the dust's too: the clear glass the file gave it, less clear where it is dusty.
        ? { CUSTOM_FRAGMENT_DEFINITIONS: DEFINITIONS, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: surface, ...(glass ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: "alpha=clamp(alpha+vhDust*0.45,0.0,0.96);" } : {}) }
        : { CUSTOM_VERTEX_MAIN_END: "out.vVehA=vehA;out.vVehB=vehB;out.vVehC=vehC;out.vVehP=position.xyz;" },
    getInstanceAttributes: () => VEHICLE_ATTRIBUTES,
    getVaryings: () => [{ name: "vVehA", type: "vec4<f32>" }, { name: "vVehB", type: "vec4<f32>" }, { name: "vVehC", type: "vec4<f32>" }, { name: "vVehP", type: "vec3<f32>" }],
  };
}

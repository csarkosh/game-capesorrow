/* The film's window light, spliced into the night branch of the hours decode (`townMaterial.ts`, `hoursCodeFor`), after the night share has scaled the glow.
   A lit window is a night code (this branch) whose glow is above 0 and at most WINDOW_GLOW_MAX (`windowNight.ts`); every lens, porch light and boat light glows more.
   With `townWindowLight.w` at 0 (play) nothing here runs; with a gain above 0 the window's glow colour is `townWindowLight.rgb`, times its own glow and the gain, still by the night share. */
let isLitWindow=tsSurf.w>0.001&&tsSurf.w<=__WINDOW_GLOW_MAX__;
if(isLitWindow&&material.townWindowLight.w>0.0){townGlowC=material.townWindowLight.xyz*tsSurf.w*material.townWindowLight.w*nsh;}

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { enginePreset } from "@csarkosh/engine/vite/preset";
import { timeLimit } from "@csarkosh/engine/vite/timeLimit";

/**
 * The pages the build makes. `title.html`, the title film's page (`src/film/titleFilm.ts`), is an input only of the film build
 * (`vite build --mode film`, `npm run recording:build`): production's has none, so it is never deployed to the site.
 */
export function buildInputs(mode: string): Record<string, string> {
  const dir = dirname(fileURLToPath(import.meta.url));
  return {
    main: resolve(dir, "index.html"),
    ...(mode === "film" ? { title: resolve(dir, "title.html") } : {}),
  };
}

export default defineConfig(({ mode }) => mergeConfig(
  enginePreset(),
  defineConfig({
    // The web build lives under games.csarko.sh/portashton. The deploy script sets PORTASHTON_BASE
    // (`tools/deploy/lib/buildClient.mjs`) and the engine's router reads the result back from
    // import.meta.env.BASE_URL, so no route code spells the prefix. Development serves at the root,
    // so the dev URL is http://localhost:5174/.
    base: process.env.PORTASHTON_BASE ?? "/",
    server: {
      port: 5174,
      proxy: {
        // Keeps the WebSocket same-origin in development, so there is no CORS or mixed-content
        // surprise. The path is passed through rather than rewritten.
        "/ws": { target: "ws://localhost:8080", ws: true },
        // The telemetry route, for a dev page started with `?telemetry=on`: the dev server process
        // serves both roles (the engine's server `src/index.ts`).
        // Exact: a bare "/t" would also take /town.html (the town plan's map page) for the telemetry route.
        "^/t(\\?.*)?$": { target: "http://localhost:8080" },
      },
    },
    build: {
      // Source maps, written beside the chunks but not referenced by them: the engine's site deploy
      // leaves `.map` files out of the site.
      sourcemap: "hidden",
      rollupOptions: { input: buildInputs(mode) },
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      setupFiles: ["test/setup/identity.ts"],
      // A test here makes a real world from a seed, which takes seconds on a loaded machine, so the
      // limits are the empty game's own 120 s, scaled by TEST_TIME_SCALE like every explicit limit.
      // Only under vitest, which sets VITEST before it loads this file: `vite dev` and `vite build`
      // load it too, and must not read or validate TEST_TIME_SCALE.
      ...(process.env.VITEST ? { testTimeout: timeLimit(120_000), hookTimeout: timeLimit(120_000) } : {}),
      tags: [
        {
          // Tests whose assertion is a bar on elapsed time, meaningful only on a quiet machine.
          // The cloud's test job leaves them out (`--tags-filter=!wall-clock`, .github/workflows/test.yml),
          // as the engine's push gate does for the files it names (tools/gate.mjs); a local `npm test`
          // runs them.
          name: "wall-clock",
          description: "asserts on elapsed time; meaningful only on a quiet machine",
        },
      ],
    },
  }),
));

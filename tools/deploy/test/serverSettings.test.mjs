import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Port Ashton's server is the engine's (`@csarkosh/engine-server`), run from its release. What is
// the game's is its settings file, `server/game.json`, and the image that runs the package; this
// holds each to its value, and to what the installed package expects of it. No server is deployed yet.
import { parseGameSettings } from '../../../node_modules/@csarkosh/engine-server/dist/gameSettings.js';

const path = (relative) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const SETTINGS_PATH = path('server/game.json');
const SETTINGS_TEXT = readFileSync(SETTINGS_PATH, 'utf8');
const DOCKERFILE = readFileSync(path('server/Dockerfile'), 'utf8');

describe("Port Ashton's server settings (server/game.json)", () => {
  it('holds the app, dataset, bucket and the two origins in order', () => {
    // The app, dataset and bucket keep the game's former name (capesorrow) on purpose: the data and the GCP resources are stored under it.
    expect(JSON.parse(SETTINGS_TEXT)).toEqual({
      app: 'game-capesorrow',
      telemetryDataset: 'capesorrow_telemetry',
      telemetryBucket: 'capesorrow-telemetry',
      allowedOrigins: ['https://games.csarko.sh', 'http://localhost:5174'],
    });
  });

  it("is accepted by the installed server's own parser", () => {
    const settings = parseGameSettings(SETTINGS_TEXT, SETTINGS_PATH);
    expect(settings.app).toBe('game-capesorrow');
    expect(settings.allowedOrigins).toEqual(['https://games.csarko.sh', 'http://localhost:5174']);
  });

  it('lets the dev server reach the server: the origin is the one the client serves at', () => {
    const config = readFileSync(path('client/vite.config.ts'), 'utf8');
    expect(config).toMatch(/port: 5174/);
  });
});

describe("the server's image (server/Dockerfile)", () => {
  it('copies the settings and runs the installed server, with no saved queries to copy', () => {
    expect(DOCKERFILE).toMatch(/^COPY server\/game\.json \.\/server\/game\.json$/m);
    expect(DOCKERFILE).toMatch(/^CMD \["node", "node_modules\/@csarkosh\/engine-server\/dist\/index\.js"\]$/m);
    expect(DOCKERFILE).not.toMatch(/queries/);
  });

  it('installs the server and the root only, from the repository root, never the client', () => {
    expect(DOCKERFILE).toMatch(/^RUN npm ci --omit=dev --workspace server --include-workspace-root$/m);
    expect(DOCKERFILE).toMatch(/^COPY package\.json package-lock\.json \.\/$/m);
  });
});

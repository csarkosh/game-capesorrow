// The production client build: the real `npm run build`, under the production base and with the
// addresses the bundle bakes in (`buildEnv.mjs`).
import { productionEnv } from './buildEnv.mjs';
import { buildTag, production, runLoud } from './preconditions.mjs';

/** Builds the client; returns the environment it was built with. */
export function buildClient() {
  const env = productionEnv(production(), buildTag());
  for (const [k, v] of Object.entries(env)) console.log(`→ ${k.padEnd(18)} ${v}`);
  if (env.VITE_SIGNALING_URL === undefined) console.log('→ no signaling address: this build cannot play, and its title page says so');
  runLoud('npm', ['run', 'build'], { env: { ...process.env, ...env } });
  return env;
}

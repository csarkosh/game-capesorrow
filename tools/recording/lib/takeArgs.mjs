// The arguments of `npm run recording:take`, and of the three commands it runs, as data.
// Pure: no process, no files, so a test can hold every case.

export const TAKE_USAGE = 'Usage: npm run recording:take -- --out <frames dir> [--remote <port>] [--fresh]';

/** The engine's recorder and encoder, from the repository root. */
export const RECORD_SCRIPT = 'node_modules/@csarkosh/engine/tools/recording/record.mjs';
export const ENCODE_SCRIPT = 'node_modules/@csarkosh/engine/tools/recording/encode.mjs';

/** Where the title page reads its film and still from (`client/src/game/titleAssets.ts`). */
export const VIDEO_FILE = 'client/assets/video/title.mp4';
export const STILL_FILE = 'client/assets/video/title.still.webp';

/**
 * `{ out, remote, fresh }` from the arguments after the script's name, or `{ error }`. `--out` is where the frames go (on the external
 * disk: the encoder reads them from there); `--remote` is the port of the rig's Chrome; `--fresh` clears frames already there.
 *
 * @param {readonly string[]} argv
 * @returns {{ out: string, remote: number | null, fresh: boolean } | { error: string }}
 */
export function parseTakeArgs(argv) {
  let out = null;
  let remote = null;
  let fresh = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fresh') {
      fresh = true;
    } else if (arg === '--out' || arg === '--remote') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      i++;
      if (arg === '--out') out = value;
      else {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) return { error: '--remote needs a port number' };
        remote = Number(value);
      }
    } else {
      return { error: `unknown argument ${JSON.stringify(arg)}` };
    }
  }
  if (out === null) return { error: '--out is required' };
  return { out, remote, fresh };
}

/**
 * The film page's address from what `recording:channel` printed: its last address is the channel's address of this game, and the page is
 * `title.html` under it. Null when it printed none.
 *
 * @param {string} output
 * @returns {string | null}
 */
export function filmUrlFrom(output) {
  const found = output.split('\n').map((line) => line.trim()).filter((line) => /^https:\/\/\S+$/.test(line));
  const last = found[found.length - 1];
  return last === undefined ? null : `${last.replace(/\/+$/, '')}/title.html`;
}

/** The recorder's arguments. */
export function recordArgs({ url, out, remote, fresh }) {
  return [RECORD_SCRIPT, '--url', url, '--out', out, ...(remote === null ? [] : ['--remote', String(remote)]), ...(fresh ? ['--fresh'] : [])];
}

/** The encoder's arguments: the frames the recorder wrote, into the committed video and still. */
export function encodeArgsFor({ out }) {
  return [ENCODE_SCRIPT, '--frames', out, '--out', VIDEO_FILE, '--still', STILL_FILE];
}

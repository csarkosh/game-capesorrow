// The command line of `npm run deploy:client [-- --channel <name>] [-- --dry-run]`, as data.
// Pure: no process, no files, so a test can hold every case.

export const USAGE = 'Usage: npm run deploy:client [-- --channel <name>] [-- --dry-run]';

/**
 * `{ channel, dryRun }` from the arguments after the script's name, or `{ error }` naming what is
 * wrong with them (an unknown option, a channel with no name or given twice).
 *
 * @param {readonly string[]} argv
 * @returns {{ channel: string | null, dryRun: boolean } | { error: string }}
 */
export function parseDeployArgs(argv) {
  let channel = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--channel') {
      const name = argv[i + 1];
      if (name === undefined || name.startsWith('--')) return { error: '--channel needs a name' };
      if (channel !== null) return { error: '--channel is given twice' };
      channel = name;
      i++;
    } else if (arg.startsWith('--channel=')) {
      const name = arg.slice('--channel='.length);
      if (name === '') return { error: '--channel needs a name' };
      if (channel !== null) return { error: '--channel is given twice' };
      channel = name;
    } else {
      return { error: `unknown argument ${JSON.stringify(arg)}` };
    }
  }
  return { channel, dryRun };
}

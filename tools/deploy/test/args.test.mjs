import { describe, it, expect } from 'vitest';
import { parseDeployArgs, USAGE } from '../lib/args.mjs';

describe('parseDeployArgs', () => {
  it('is a production deploy with no arguments', () => {
    expect(parseDeployArgs([])).toEqual({ channel: null, dryRun: false, mode: null });
  });

  it('takes a channel and a dry run, in either order and either spelling', () => {
    expect(parseDeployArgs(['--channel', 'try-it'])).toEqual({ channel: 'try-it', dryRun: false, mode: null });
    expect(parseDeployArgs(['--channel=try-it'])).toEqual({ channel: 'try-it', dryRun: false, mode: null });
    expect(parseDeployArgs(['--dry-run'])).toEqual({ channel: null, dryRun: true, mode: null });
    expect(parseDeployArgs(['--dry-run', '--channel', 'a'])).toEqual({ channel: 'a', dryRun: true, mode: null });
    expect(parseDeployArgs(['--channel', 'a', '--dry-run'])).toEqual({ channel: 'a', dryRun: true, mode: null });
  });

  it('refuses an unknown option, a channel with no name and a channel twice', () => {
    expect(parseDeployArgs(['--prod'])).toEqual({ error: 'unknown argument "--prod"' });
    expect(parseDeployArgs(['staging'])).toEqual({ error: 'unknown argument "staging"' });
    expect(parseDeployArgs(['--channel'])).toEqual({ error: '--channel needs a name' });
    expect(parseDeployArgs(['--channel', '--dry-run'])).toEqual({ error: '--channel needs a name' });
    expect(parseDeployArgs(['--channel='])).toEqual({ error: '--channel needs a name' });
    expect(parseDeployArgs(['--channel', 'a', '--channel', 'b'])).toEqual({ error: '--channel is given twice' });
  });

  it('passes --mode through to the build, in either spelling', () => {
    expect(parseDeployArgs(['--channel', 'film', '--mode', 'film'])).toEqual({ channel: 'film', dryRun: false, mode: 'film' });
    expect(parseDeployArgs(['--mode=film'])).toEqual({ channel: null, dryRun: false, mode: 'film' });
    expect(parseDeployArgs(['--mode'])).toEqual({ error: '--mode needs a name' });
    expect(parseDeployArgs(['--mode', '--dry-run'])).toEqual({ error: '--mode needs a name' });
    expect(parseDeployArgs(['--mode', 'a', '--mode', 'b'])).toEqual({ error: '--mode is given twice' });
  });

  it('has a usage line that names both options', () => {
    expect(USAGE).toContain('--channel <name>');
    expect(USAGE).toContain('--dry-run');
    expect(USAGE).toContain('--mode <name>');
  });
});

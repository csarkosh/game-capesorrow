import { describe, expect, it } from 'vitest';
import { encodeArgsFor, ENCODE_SCRIPT, filmUrlFrom, parseTakeArgs, RECORD_SCRIPT, recordArgs, STILL_FILE, VIDEO_FILE } from '../lib/takeArgs.mjs';

describe('parseTakeArgs', () => {
  it('needs --out and takes a port and --fresh', () => {
    expect(parseTakeArgs(['--out', '/Volumes/x/title'])).toEqual({ out: '/Volumes/x/title', remote: null, fresh: false });
    expect(parseTakeArgs(['--remote', '9333', '--out', 'd', '--fresh'])).toEqual({ out: 'd', remote: 9333, fresh: true });
  });
  it('refuses what it cannot use', () => {
    expect(parseTakeArgs([])).toEqual({ error: '--out is required' });
    expect(parseTakeArgs(['--out'])).toEqual({ error: '--out needs a value' });
    expect(parseTakeArgs(['--out', '--fresh'])).toEqual({ error: '--out needs a value' });
    expect(parseTakeArgs(['--out', 'd', '--remote', 'nine'])).toEqual({ error: '--remote needs a port number' });
    expect(parseTakeArgs(['--out', 'd', '--remote', '70000'])).toEqual({ error: '--remote needs a port number' });
    expect(parseTakeArgs(['--out', 'd', '--live'])).toEqual({ error: 'unknown argument "--live"' });
  });
});

describe('the film page from the channel deploy', () => {
  it("is title.html under the last address the deploy printed", () => {
    const out = 'released 1 to channel film\n3 new, 0 changed\nhttps://fps-csarko--film-abc.web.app/portashton\n';
    expect(filmUrlFrom(out)).toBe('https://fps-csarko--film-abc.web.app/portashton/title.html');
    expect(filmUrlFrom('https://a.example.invalid/x/\n')).toBe('https://a.example.invalid/x/title.html');
  });
  it('is null when no address was printed', () => {
    expect(filmUrlFrom('released 1 to channel film\n')).toBe(null);
    expect(filmUrlFrom('')).toBe(null);
  });
});

describe('the commands it runs', () => {
  it("records the film page into --out, over the rig's port when given", () => {
    expect(recordArgs({ url: 'https://u/title.html', out: 'd', remote: 9333, fresh: false })).toEqual([RECORD_SCRIPT, '--url', 'https://u/title.html', '--out', 'd', '--remote', '9333']);
    expect(recordArgs({ url: 'u', out: 'd', remote: null, fresh: true })).toEqual([RECORD_SCRIPT, '--url', 'u', '--out', 'd', '--fresh']);
  });
  it('encodes the frames into the committed video and still', () => {
    expect(encodeArgsFor({ out: 'd' })).toEqual([ENCODE_SCRIPT, '--frames', 'd', '--out', 'client/assets/video/title.mp4', '--still', 'client/assets/video/title.still.webp']);
    expect(VIDEO_FILE).toBe('client/assets/video/title.mp4');
    expect(STILL_FILE).toBe('client/assets/video/title.still.webp');
  });
});

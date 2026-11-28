import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Every kind of shipped binary goes through Git LFS, or its first commit puts the whole file into
// git's history. The repository has none yet; the first model or texture lands in LFS because of
// these lines, which the github-push skill's check refers to.
const ATTRIBUTES = readFileSync(new URL('../../../.gitattributes', import.meta.url), 'utf8');
const lfs = (ext) => new RegExp(`^\\*\\.${ext}\\s+filter=lfs diff=lfs merge=lfs -text$`, 'm');

describe('.gitattributes', () => {
  it('tracks every shipped binary kind through LFS: models, images, sounds, film, wasm and icons', () => {
    for (const ext of ['glb', 'webp', 'ktx2', 'mp3', 'mp4', 'wasm', 'png', 'jpg', 'ico']) expect(ATTRIBUTES, ext).toMatch(lfs(ext));
  });

  it('tracks the title film directory too', () => {
    expect(ATTRIBUTES).toMatch(/^client\/assets\/video\/\*\s+filter=lfs diff=lfs merge=lfs -text$/m);
  });

  it('keeps text on LF line endings', () => {
    for (const ext of ['json', 'md', 'ts', 'mjs']) expect(ATTRIBUTES, ext).toMatch(new RegExp(`^\\*\\.${ext}\\s+text eol=lf$`, 'm'));
  });
});

/**
 * The title page's film and still, through Vite's glob: the hashed urls of `assets/video/title.mp4`
 * and `assets/video/title.still.webp`, or null until each is recorded and committed. A title page
 * without them is the ordinary case until then: it draws no video and no still, and nothing is
 * fetched. The globs name the files exactly, so a stray file beside them is never served as the film.
 */
const VIDEO = import.meta.glob("../../assets/video/title.mp4", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const STILL = import.meta.glob("../../assets/video/title.still.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const only = (glob: Record<string, string>): string | null => Object.values(glob)[0] ?? null;

/** The title page's loop, or null until it ships. */
export function titleVideoUrl(): string | null {
  return only(VIDEO);
}

/** The title page's still, the loop's first frame, or null until it ships. */
export function titleStillUrl(): string | null {
  return only(STILL);
}

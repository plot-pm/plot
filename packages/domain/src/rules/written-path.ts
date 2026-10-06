/**
 * Whether a board role's `written` hand-back names a path inside the
 * repository it ran in.
 *
 * A board role hands back a path it wrote, not a reading of the filesystem —
 * so this is the gate between that claim and the route trusting it enough to
 * read the file. `written: '../../etc/passwd'` and an absolute path outside
 * the repository are both refused; a run naming no file, or a path that does
 * not resolve inside the root, is a FAILED run, never a silent success.
 *
 * It is string work: no path it returns need exist, and it reaches no
 * filesystem. The domain may import `zod` and nothing else outside
 * `adapters/`, so the composition here is plain string handling rather than
 * `node:path`.
 *
 * Paths are POSIX, matching {@link deskRoot}'s own assumption.
 *
 * @concept written-path
 */

/** A `written` path, resolved against the repository root. */
export type WrittenPathResolution =
  | { readonly inside: true; readonly resolved: string }
  | { readonly inside: false; readonly reason: string };

/** Splits a path into segments, dropping empty ones (`//`, leading/trailing `/`). */
const segmentsOf = (p: string): string[] => p.split('/').filter((s) => s !== '');

/**
 * Resolves `written` against `repoRoot`, collapsing `.` and `..` segments
 * without touching the filesystem, and reports whether the result stays
 * inside the root.
 *
 * `written` is read as repository-relative unless it starts with `/`, in
 * which case it is taken as already absolute — and checked against the root
 * exactly as a relative one would be, so `/etc/passwd` is refused the same
 * way `../../etc/passwd` is.
 *
 * @param written - the hand-back's `written` field, verbatim; `''` refuses.
 * @param repoRoot - the repository root the run worked in, absolute.
 * @returns the resolved absolute path and `inside: true` where `written`
 *   stays inside `repoRoot`; `inside: false` with why otherwise.
 */
export const writtenPathResolution = (written: string, repoRoot: string): WrittenPathResolution => {
  if (written.trim() === '') return { inside: false, reason: 'the hand-back named no file' };

  const rootSegments = segmentsOf(repoRoot);
  const stack = written.startsWith('/') ? [] : [...rootSegments];
  for (const segment of segmentsOf(written)) {
    if (segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  const resolved = `/${stack.join('/')}`;
  const rootPrefix = `/${rootSegments.join('/')}`;
  const withinRoot = resolved === rootPrefix || resolved.startsWith(`${rootPrefix}/`);
  if (!withinRoot) return { inside: false, reason: `'${written}' resolves outside the repository (${resolved})` };
  return { inside: true, resolved };
};

/**
 * A version's canonical spelling, and nothing else.
 *
 * A MODULE OF ITS OWN, and the reason is a bundle size. This function lived in
 * `release.ts` beside the `Release` entity, whose schemas import `zod` at
 * module scope. `transitions/plan.ts` imports it as a VALUE rather than a type,
 * so a bundle taking one transition took `zod` with it: measured 2026-09-02,
 * `plot-transition.mjs` built at **324 KB** for four lines of string handling,
 * against the 1 KB `plot-verdicts.mjs` reaches by importing types only.
 *
 * `release.ts` re-exports it, so every caller keeps its import and there is
 * still one implementation. Only the module boundary moved.
 */

/**
 * Normalizes a recorded version to the canonical `vN.N.N` spelling.
 *
 * Both spellings appear in one field across this estate — 70 `Released:` lines
 * carry the `v` and 40 do not — while every git tag carries it, so a consumer
 * matching the recorded string against `git tag` resolves 70 and misses 40.
 *
 * @param version - the version as recorded, with or without the prefix.
 * @returns the version prefixed with `v`; `''` stays empty.
 */
export const normalizeVersion = (version: string): string => {
  const trimmed = version.trim();
  if (trimmed === '') return '';
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
};

/**
 * Compares two `vN.N.N` tags by their numeric parts, oldest first.
 *
 * `sort -V`'s ordering, reimplemented rather than shelled out to: the release
 * tag rule needs the FIRST tag by version among several containing one commit,
 * and a string sort would place `v2.9.0` after `v2.10.0`.
 *
 * A tag that does not match `vN.N.N` sorts as `0.0.0`, so a malformed entry
 * never displaces a real version to the front — the caller is expected to have
 * filtered to `vN.N.N` already.
 *
 * @param a - a tag, such as `v2.10.0`.
 * @param b - another tag.
 * @returns negative when `a` is the older version, positive when `b` is,
 *   `0` when they are equal.
 */
export const compareVersions = (a: string, b: string): number => {
  const parts = (tag: string): readonly number[] => {
    const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const [aMajor, aMinor, aPatch] = parts(a);
  const [bMajor, bMinor, bPatch] = parts(b);
  return (aMajor as number) - (bMajor as number) || (aMinor as number) - (bMinor as number) || (aPatch as number) - (bPatch as number);
};

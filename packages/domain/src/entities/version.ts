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

/** A version's parts: three numbers and the pre-release identifiers, empty for a release. */
interface SemverParts {
  readonly core: readonly [number, number, number];
  readonly pre: readonly string[];
}

const parseSemver = (version: string): SemverParts | null => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizeVersion(version));
  if (match === null) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] === undefined ? [] : match[4].split('.') };
};

const comparePre = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [x, y] = [a[i]!, b[i]!];
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (!xn && x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
};

/**
 * Whether a version reads as semver, with or without its `v`.
 *
 * @param version - a version, such as `2.35.0`, `v2.35.0` or `v1.0.0-beta.3`.
 * @returns true where {@link compareSemver} orders it by its parts.
 */
export const isSemver = (version: string): boolean => parseSemver(version) !== null;

/**
 * Compares two versions by semver precedence, oldest first.
 *
 * Both sides go through {@link normalizeVersion}, so `2.35.0` equals `v2.35.0`. A pre-release
 * sorts below its release (`v1.0.0-beta.3` < `v1.0.0`). A version that does not parse sorts
 * below every one that does.
 *
 * @param a - a version.
 * @param b - another version.
 * @returns negative where `a` is older, positive where `b` is, `0` where they are equal.
 */
export const compareSemver = (a: string, b: string): number => {
  const [pa, pb] = [parseSemver(a), parseSemver(b)];
  if (pa === null || pb === null) return (pa === null ? 0 : 1) - (pb === null ? 0 : 1);
  return pa.core[0] - pb.core[0] || pa.core[1] - pb.core[1] || pa.core[2] - pb.core[2] || comparePre(pa.pre, pb.pre);
};

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

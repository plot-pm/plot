/**
 * THE BUNDLES `build.mjs` EMITS — GENERATED, NEVER EDITED BY HAND.
 *
 * Written by `packages/board/build.mjs` from its own shipped-bundle
 * declarations, which are what an author writes when adding a bundle. Edit the
 * build; run `pnpm build:board`; this file follows.
 *
 * ## Why this file exists rather than a list in the contract
 *
 * The list was typed out in `contract/schema.ts` and drifted three times in one
 * evening — 9, then 10, then 11 entries against a build emitting one more each
 * time. Every drift surfaced as an UNRELATED branch's CI failing on a bundle it
 * never touched, which is the failure this removes: a bundle added in one PR
 * must not be able to fail another branch's CI.
 *
 * ## Why generated rather than derived at import time
 *
 * The contract is bundled INTO the artifacts it describes, and a bundle must not
 * read the repository to load. `src/server/stuck.ts` and `src/server/resolver.ts`
 * both consume this inside the served bundle, so the value has to be a
 * compile-time constant. Making the contract `import('../../build.mjs')` would
 * drag esbuild's config into the served bundle, which is the one thing this
 * change may not do.
 *
 * ## Why committed rather than ignored
 *
 * `pnpm run typecheck` runs `tsc --noEmit` with no build, and CI runs it BEFORE
 * `build:board`. An ignored file would fail typecheck on a fresh clone. Being
 * committed, its freshness is asserted by
 * `test/reconcile/resolveartifact.test.mjs`, which compares this file, the
 * shell's `bundle_set` and `build.mjs` as SETS — the same test that used to
 * assert somebody had remembered, now asserting the derivation ran.
 *
 * ## It is a bundle INPUT, not a bundle output
 *
 * So it carries no `-merge` mark. `.gitattributes` marks the twelve `.mjs`
 * artifacts, whose licence is a deterministic rebuild that overwrites whichever
 * side a merge kept. This is TypeScript source holding one sorted array; a
 * conflict here is a real conflict about which bundles exist, and reading it is
 * the correct resolution.
 */
export const BOARD_ARTIFACT_PATHS: readonly string[] = [
  'skills/plot/scripts/board/board-server.mjs',
  'skills/plot/scripts/board/plot-adopt.mjs',
  'skills/plot/scripts/board/plot-agent-state.mjs',
  'skills/plot/scripts/board/plot-ask.mjs',
  'skills/plot/scripts/board/plot-branch-state.mjs',
  'skills/plot/scripts/board/plot-delta.mjs',
  'skills/plot/scripts/board/plot-landed.mjs',
  'skills/plot/scripts/board/plot-movable.mjs',
  'skills/plot/scripts/board/plot-prompt.mjs',
  'skills/plot/scripts/board/plot-propose-stack.mjs',
  'skills/plot/scripts/board/plot-registryd.mjs',
  'skills/plot/scripts/board/plot-slice-pr.mjs',
  'skills/plot/scripts/board/plot-sprint-score.mjs',
  'skills/plot/scripts/board/plot-sprint-transition.mjs',
  'skills/plot/scripts/board/plot-standing.mjs',
  'skills/plot/scripts/board/plot-task.mjs',
  'skills/plot/scripts/board/plot-transition.mjs',
  'skills/plot/scripts/board/plot-verdicts.mjs',
];

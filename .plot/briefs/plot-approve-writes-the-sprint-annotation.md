## Implementation brief — plot-approve-writes-the-sprint-annotation

- **Plan (canonical):** `docs/plans/2026-11-04-plot-approve-writes-the-sprint-annotation.md` on `main`
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3132 merged
- **Branch:** `bug/plot-approve-writes-the-sprint-annotation` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (plot-review app, auto-review on)

The slice waits for `bug/plot-approve-reads-the-plan-from` (PR #3112, open at dispatch). It edits none of #3112's files, and it starts after #3112 merges so no rebase reconciles the approve workflow's sprint step.

### What to build

`withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:221-243`) matches by `line.includes('[slug]')`. On a sprint file where a Could item is followed by a `### Scope Changes` log line and a `### Deferred` `- [ ] [slug]` line, it annotates all three. With `tick: true` (the deliver workflow) it also ticks the Deferred box, and sprint scoring reads a ticked box as delivered. The board's approve path was fixed by `0ef7e8a2b` (v2.30.0); this writer was not, and no `packages/*/src` file imports `perform-fs` today, so the defect is latent.

Change: import `memberLineIndex` from `../rules/sprint-membership.js`, compute `memberLineIndex(text, plan)`, return `{ text, wrote: false }` on `-1` (no substring fallback), and apply the existing transform (tick, `annotateExisting` or new `<!-- … -->`, the nothing-to-record guard) to `lines[index]` only. Update the TSDoc to say the item line is found by `memberLineIndex`. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **Delegate to `annotateSprintItem` / `tickSprintItem`? No.** They take a non-null `pr` and return a different outcome shape. The shared rule is `memberLineIndex`, and that is the one rule the plan requires.
- **Fall back to substring when `index === -1`? No.** That fallback is the defect.
- **Change a caller? No.** `workflows/approve.ts`, `workflows/deliver.ts`, `perform-fs.ts`, `entry/approve.ts`, `entry/deliver.ts` stay untouched. If a test fails for a reason other than the fixture update, fix `withSprintAnnotation` or `memberLineIndex` in the domain only.
- **Board, shell, tracker:** no board source imports `withSprintAnnotation` (`git grep` on `packages/board/src` finds nothing), no shell changes, nothing written to the tracker.
- **Rule carried over:** absent is not false. A sprint file with no member line is `wrote: false`, never an error and never a guess.
- Style: any function you write is an arrow, including test helpers (the `MUST` helper, as in `packages/domain/test/sprint-tick.test.ts:6`).

### Done when

The plan's `## Done when` and test table are the specification. Lifted assertions:

- Fixture is the issue's shape (Could member line, then `## Notes` / `### Scope Changes` log line, then `### Deferred` `- [ ] [slug]`). Each new test compares `split('\n')` arrays with the member index removed, so a stray write to any other line fails it. A test that asserts only the member line would pass without the fix.
- `tick: true` test: the Deferred box stays `- [ ]`. This is the scoring-relevant case.
- Slug only under `### Scope Changes`: `wrote: false`, text byte-identical.
- `annotateSprintItem` on the fixture: `outcome: 'updated'`, other lines identical. This is a regression hold, not a red test; prove it can fail by restoring `git show 0ef7e8a2b^:packages/domain/src/rules/sprint-annotation.ts`, running the one test, then `git checkout HEAD -- packages/domain/src/rules/sprint-annotation.ts`, and record that in the PR body.
- Existing `withSprintAnnotation` tests at `packages/domain/test/rendering.test.ts:180-288` turn red because bare item lines have no tier heading. Wrap each input in `### Must Have`. That red is expected.

Plus: add `.changeset/plot-approve-writes-the-sprint-annotation.md` (package `'plot': patch`, description first, then the comment block with `plan:` and `bumps: skills: plot-deliver: patch`). Run `env -u PLOT_REPO_ROOT -u PLOT_UNATTENDED node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to ratchet; if that changes, growth is paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. PR body carries `Refs #2532`, names `0ef7e8a2b` as the board-path fix and this slice as the domain-wide fix. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/domain/src/workflows/rendering.ts`, `packages/domain/test/rendering.test.ts`, `packages/domain/test/rules-sprint-annotation.test.ts`, the changeset. In flight: PR #3112 (`bug/plot-approve-reads-the-plan-from`) holds `packages/board/src/server/entry/approve.ts`, `packages/domain/src/workflows/approve.ts`, `packages/board/test/unit/approve.test.ts`, `packages/domain/test/workflows-approve.test.ts`; do not touch them. Out of scope: the `pr: #0` an in-session approval records (`entry/approve.ts:902`, `:1098`), filed as #3140.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — sprint-release-gate-and-sprint-readers (wave 1: Release gate)

- **Plan (canonical):** `docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2513 merged
- **Branch:** `bug/sprint-release-gate-ignores-withdrawn-and-partial-reads` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has four waves and each edits different files, so this branch collides with none of them. Take the wave from `main`; no wave waits on this one.

### What to build

The Jira Release drift gate answers `checked: true` on input it did not fully read. Two defects, both in `packages/board/src/server/entry/sprint-release-gate.ts`, plus one in the domain:

1. `tierItemsFrom` (around `:154`) builds each item from `text` and `resolveItemKey(...)` only. The collector (`plot-sprint-release.sh:294`) already writes `state` (`done | open | disputed | withdrawn`) on every item, and the entry drops it. A withdrawn Must-have therefore counts as missing from the Release. Keep the state on the item and skip withdrawn Must-haves in `missingFromRelease` and `notCompared`.
2. `sprintVerdict` (around `:243`) ignores `VersionRead.complete` (`ports/tracker.ts:157`, `:180`). A Release read cut at 200 issues reports `checked: true` with false drift. When `complete` is false, return not checked with a reason that names the cut, never a drift list.
3. `resolveItemKey` in `packages/domain/src/rules/sprint-release.ts:112` tests the unanchored `JIRA_KEY` on the `ticket:` value and returns the whole trimmed string, so a URL or quoted value becomes the key. Return the matched key (`match[0]`).

Low findings in the same files: remove the unreachable `{ checked: false }` arm of `SprintVerdict`; remove the `limit` that `inputFrom` reads and no collector writes (or state why it stays); correct the `issueLineKeys` docstring; correct the comment at `release-gate.ts:115`. Decide the `scripts/check-script-names.sh` ratchet (`ALLOWED=19`): move the config read to an adapter and lower the number, or record in the comment why it stays. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **State is read from the collector, not recomputed.** The gate must not re-derive withdrawn from plan files; `plot-sprint-release.sh` owns that, and `item_state` has a corpus pair (`packages/domain/corpus/sprint-score.corpus.test.ts`). A second reader would be an undeclared duplicate.
- **Not checked, never partial drift.** A read that stopped has not told the caller what the Release lacks (`ports/tracker.ts:288`). Absent is not false: do not compare against a truncated list.
- **`withdrawn` is not `open`.** Only Must-haves are required to ship; a withdrawn one is a promise the sprint dropped. `missingFromSprint` still reads every tier, so a withdrawn item's key still accounts for a Release issue.
- **Open question 3 binds you:** re-check each cited line against `main` at slice start. The plan's line numbers (`:157`, `:253`, `:121`) have already moved; the code above is at the lines shown today.

### Done when

The plan's `## Slices` entry and `## Design` Release-gate bullet are the specification. Every MEDIUM fix lands with a test that fails against the unfixed code:

- A withdrawn Must-have is absent from `missingFromRelease` and `notCompared` (catches: a fix that only filters the display).
- `complete: false` returns not checked and no drift lists (catches: a fix that sets `checked: true` and an empty list).
- `resolveItemKey` with `ticket: "https://x/browse/ABC-12"` returns `ABC-12`, and a quoted value returns the key (catches: returning the trimmed input).
- Prove each test red against the unfixed code before the fix.

Tests live in `packages/board/test/unit/sprint-release-gate.test.ts` and `packages/domain/test/sprint-release.test.ts`. Write new helpers as arrow functions.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Do not commit the board artifact (`board-server.mjs`, `skills/plot/scripts/board/*.mjs` bundles); `scripts/check-no-bundle-diff.sh` refuses it. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base; this slice should touch no `.sh` file, and if it does, pay for the growth in the same change. A changed `scripts/check-script-names.sh` ratchet must match a measured count.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/sprint-release-gate.ts`, `packages/board/src/server/entry/release-gate.ts` (comment only), `packages/domain/src/rules/sprint-release.ts`, their two test files, `scripts/check-script-names.sh` and one changeset. The other three waves hold: `entities/sprint.ts`, `board.ts` and `plot-review-status.sh` (Sprint readers); `plot-story-lint.sh` and `plot-plan-meta.sh` (Story lint); `skills/plot-sprint/SKILL.md` and `promptfooconfig.sprint-gate.yaml` (Sprint skill). If you find something the plan did not anticipate, report it rather than improvising outside scope.

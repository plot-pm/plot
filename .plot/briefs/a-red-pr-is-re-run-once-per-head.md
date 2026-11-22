## Implementation brief — a-refused-start-is-retried-and-named (wave 5: CI re-run)

- **Plan (canonical):** `docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3614 merged
- **Branch:** `bug/a-red-pr-is-re-run-once-per-head` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the last wave of the plan. It waits on nothing: both branches it named merged (#3600 and #3603 `39cd0b4da`). `feature/the-review-reads-the-fixer-scope` of the sibling fixer plan also edits `slice-pr-next.ts`; whichever merges second merges the other's change.

### What to build

fleetd re-runs the failed CI jobs of an open PR once per head before it starts a CI-red fixer on that head. A second red on the same head goes to the fixer, not to a person. Today the only `rerunFailed` caller is the main-repair arm (`packages/fleet/src/shared/repair-start.ts:149`). Measured 2026-11-04: PR #3110 was red from 01:31Z to 18:05Z and #3111 from 10:24Z to 18:05Z on one flaky test. On each, the fixer spent both CI attempts, pushed nothing, and named a re-run as the next step for a person (#3125).

The mechanism: `ciRerunArm` goes into the `fixerPrNext` walk (`packages/domain/src/rules/slice-pr-next.ts:589`) between `conflictArm` and `ciRedArm`, so the walk reads `[reviewRunArm, fixerInFlightArm, highArm, conflictArm, ciRerunArm, ciRedArm]`. `fixerTick` carries out the new `rerun` step with the existing `BuildPort.rerunFailed` (`packages/domain/src/ports/build.ts:144`). The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The arm sits after `conflictArm`, not before.** GitHub runs no `pull_request` checks for a conflicting merge ref, so a re-run on a conflicting PR re-runs nothing. `conflictArm` answers first.

**Fire on every first CI red per head, not only where the failing job touches no file of the diff.** Operator decision 2026-11-21. A file-reading test needs per-job file data the PR index does not carry.

**Use `deskGone`, as `ciRedArm` does** (`slice-pr-next.ts:353`). Operator decision 2026-11-21: a PR whose desk agent is alive gets no re-run, because that agent may be pushing.

**The re-run goes before the fixer, not after it.** #3125 asks for a re-run after a fixer reports a failure as unrelated. That costs one agent per flake. A re-run first costs one CI call, and a second red goes to the fixer. The PR index carries no run id, so the record keys the re-run by head, never by run.

**A `failing` row read right after the re-run is not a second red.** The row was read before the re-run took effect. Measured by the plan's panel: without a guard, the next tick reads the same stale `failing` row and starts a fixer at once. So the arm answers `hold('rerun-running')` while the record holds a re-run for this head with `answer: 'asked'` and no `cleared` time. The tick sets `cleared` the first time it reads `pending` or `green` on that head after the re-run. The arm's answers:
- no re-run recorded for this head, row `failing` on `checksSha === headSha`, CI-red budget not spent, `deskGone` → `{ step: 'rerun', head }`
- `asked`, not cleared, inside `Checks wait` → `hold('rerun-running')`
- cleared, or answer `failed` or `unaskable` → `none('rerun-done')`; `ciRedArm` then starts the fixer on the next `failing` row
- `Checks wait` passed since `at` with no cleared reading → `none('rerun-unseen')`, so a re-run that never started cannot hold the PR for ever
- otherwise `none('no-ci-red')`

**Write the record first, then call.** The tick writes `answer: 'asked'`, then calls `rerunFailed(row.head, head)`. An `unaskable` answer (Jenkins at `build-jenkins.ts:215`, no build at `build-none.ts:36`) rewrites the entry as `unaskable`; a failed call rewrites it as `failed`. Both end the re-run round for that head. A crash between the two leaves `asked`, never a second call.

**A re-run spends no fixer attempt.** `FIXER_ATTEMPTS_VERSION` stays 1, as in the conflict slice. An older build reads a record with `reruns` as unreadable, and an unreadable record holds every fixer on that PR — safe, not silent. `markRerun` creates a v1 record with `attempts: []` where the PR has none (`auto-fixer.ts:466` reads `attempts === 'none'` today).

**The fixer brief tells the truth about the re-run.** `fixerPrompt` for CI-red evidence (`fixer-start.ts`) says "the failed jobs were re-run once on this head and failed again" only where the head's re-run answered `asked`. For `failed` and `unaskable` it says no re-run ran, so the fixer may still name a re-run as the next step for a person.

**Not in this branch:** the Delivery row's fixer cell. A re-run is not an attempt, so the row shows no fixer activity during the re-run round. The run log names each re-run with the PR, the head and the answer. A row word waits for a follow-up.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc — no decision history in comments; that goes in the commit message.
- Absent is not false: a missing `reruns` field means no re-run recorded, and an unreadable record holds.
- The index never says no: the arm reads the row's `ciChecks` and `checksSha`, and re-asks nothing itself.
- No consumer of `SlicePrStep` switches over it exhaustively (`auto-merge.ts`, `auto-review.ts`, `auto-ticket.ts`, `auto-fixer.ts`), so the new variant changes no other arm. Confirm that by typecheck, not by assumption.

### Done when

The plan's `## Slices` entry for this branch and its **Tests** paragraph are the specification: `ciRerunArm` with its `rerun-running` hold, the `reruns` field and its two store methods (`markRerun`, `markRerunCleared`), the `rerun` step, the tick's `rerunFailed` call with its `failed` and `unaskable` paths, the brief's re-run line for `asked` only, and the tests. Lift these assertions because a naive implementation passes without them:

- A re-run recorded `asked` with the row still `failing` and no cleared reading holds `rerun-running` and starts no fixer. Catches an arm that reads the stale row as a second red.
- A tick right after the re-run that reads the same stale `failing` row starts no fixer (`auto-fixer.test.ts`). Catches the same defect at the tick.
- The `rerun` step writes the record before it calls `rerunFailed`, once, with the branch and head. Catches call-then-write, which re-runs twice after a crash.
- A second tick on the same head makes no second call. Catches a missing per-head key.
- A new head answers `rerun` again. Catches a per-PR key.
- `Checks wait` passed with no cleared reading answers `rerun-unseen`. Catches a PR held for ever by a re-run that never started.
- A re-run on a PR with no record writes a v1 record with `attempts: []` (`fixer-attempts-file.test.ts`).
- A conflicting row answers the conflict arm first; a spent CI budget and a live desk each answer `none`.
- The brief carries the re-run line for `asked` only.

Plus: the plan's test files are `packages/domain/test/slice-pr-next.test.ts`, `packages/domain/test/fixer-attempts.test.ts`, `packages/domain/test/fixer-attempts-file.test.ts` and `packages/fleet/test/unit/auto-fixer.test.ts`. Add a changeset (description first, `bumps:` block last). Run `pnpm build:board` only to test locally and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns:

- `packages/domain/src/entities/fixer-attempts.ts`, `ports/fixer-attempts.ts`, `adapters/fixer-attempts/fixer-attempts-file.ts`
- `packages/domain/src/rules/fixer-attempts.ts`, `rules/slice-pr-next.ts`, `rules/fixer-start.ts`
- `packages/fleet/src/shared/auto-fixer.ts`
- the four test files above, plus a changeset

In flight: `feature/the-fixer-row-names-its-finding` (Delivery row's fixer cell) and `feature/the-review-reads-the-fixer-scope` (also edits `slice-pr-next.ts`) — verify both before you push. The four earlier waves of this plan touch the brief ask, `start-command`, the write probe and the worker loop; none touches the fixer pass.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

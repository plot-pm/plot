# /plot-approve writes the sprint annotation onto scope-change log lines that name the slug

> Plot 2.28.0's `/plot-approve` wrote the sprint annotation `<!-- pr: #N, branch: B -->` onto every line that names `[slug]`, including a `### Scope Changes` log line. Commit `0ef7e8a2b` fixed the approve path; the domain still holds a second, tier-unaware writer, `withSprintAnnotation`, and this plan routes it through the same rule.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #2532
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The sprint annotation and the delivery tick go onto the sprint's Must, Should or Could item only, never onto a `### Scope Changes`, `## Notes` or `### Deferred` line that names the same slug.

<!-- Board impact: none. No plan format, template or layout change. The slice changes `withSprintAnnotation` in `packages/domain/src/workflows/rendering.ts`, which no board source imports (`git grep withSprintAnnotation origin/main -- packages/board/src` finds nothing); `main` rebuilds the bundles after the merge. -->

## Motivation

Issue #2532 reports, for Plot 2.28.0 on `docs/sprints/2026-W43-bb-pr-reads.md`, that approving `bb-pr-merge-match-head` through `POST /api/approve` annotated two lines: the Could item and the scope-change log line `- 2026-10-23: Added [bb-pr-merge-match-head] to Could — …`. The log line follows the documented format `- YYYY-MM-DD: Added [slug] to Must/Should/Could — <reason>`, so every logged scope change received an annotation meant for a tier item.

The cause is in git. At `v2.28.0`, `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts:39`) annotated every line where `line.includes('[slug]')` was true. The body was unchanged up to `0ef7e8a2b^`. Commit `0ef7e8a2b` (2026-11-01, "plot-approve, plot-deliver: find the sprint by rule, not by directory scan", first shipped in v2.30.0) moved `annotateSprintItem` and `tickSprintItem` to `memberLineIndex` (`packages/domain/src/rules/sprint-membership.ts:125`), which returns the first `- [ ] [slug]` or `- [x] [slug]` line under a `### Must Have`, `### Should Have` or `### Could Have` heading and ends tier scope at the next `##` or `###` heading. So the board's approve path (`packages/board/src/server/entry/approve.ts:754`) and the `sprint-member` transition (`packages/domain/src/transitions/sprint-member.ts:229`) are fixed from v2.30.0.

That commit added `packages/domain/test/rules-sprint-annotation.test.ts:72` ("never on a log line naming the slug elsewhere"). The test puts the log line before the tier and has no member line, so it asserts `missing`. It does not cover the issue's shape: a member line first, then a log line naming the same slug, where the log line must stay byte-identical after an `updated` write.

A second writer of the same annotation still matches by substring. `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:221-243`) rewrites every line where `line.includes('[slug]')` is true (`:230`), and with `tick: true` it replaces `[ ]` with `[x]` on each such line (`:231`). It renders the `sprint-annotation` write that the approve workflow (`packages/domain/src/workflows/approve.ts:384-393`, `tick: false`) and the deliver workflow (`packages/domain/src/workflows/deliver.ts:243-254`, `tick: true`) emit, and `performDecision` applies it through `packages/domain/src/adapters/performer/perform-fs.ts:164-174`. No file under `packages/*/src` imports `perform-fs` today; its callers are domain tests and the sandbox tier. The defect is therefore latent, and the deliver arm is the larger risk: it can tick a `- [ ] [slug]` line under `### Deferred`, and a ticked box is what sprint scoring reads as delivered.

So the domain holds two implementations of "which line is the plan's sprint item", one tier-aware and one not, and no test pairs them. This plan leaves one rule.

## Design

### Approach

Route `withSprintAnnotation` through `memberLineIndex`:

1. In `packages/domain/src/workflows/rendering.ts`, import `memberLineIndex` from `../rules/sprint-membership.js`.
2. `withSprintAnnotation` computes `const index = memberLineIndex(text, plan)`. When `index === -1` it returns `{ text, wrote: false }`. It never falls back to a substring match.
3. It applies its existing per-line transform (tick, then `annotateExisting` or a new `<!-- … -->`, and the "nothing to record" guard) to `lines[index]` only, and leaves every other line byte-identical.
4. The TSDoc block states that the item line is found by `memberLineIndex`, and drops nothing else.

The slice changes no caller: `workflows/approve.ts`, `workflows/deliver.ts`, `perform-fs.ts`, `entry/approve.ts` and `entry/deliver.ts` stay as they are. It writes no shell, no board source and no board test. `withSprintAnnotation` does not delegate to `annotateSprintItem` and `tickSprintItem`, because those take a non-null `pr` and return a different outcome shape; the shared rule is `memberLineIndex`, and that is the one rule this plan requires.

If a test below fails after the change for a reason other than the fixture update, the slice fixes `withSprintAnnotation` or `memberLineIndex` in the domain only, never a caller.

### Fixture

Every new test uses the issue's file shape, built in the test file:

```
### Could Have

- [ ] [approve-me] the plan

## Notes

### Scope Changes

- 2026-10-23: Added [approve-me] to Could — issue filed during the sprint

### Deferred

- [ ] [approve-me] an earlier attempt
```

Each test asserts that every line except the Could member line is byte-identical to the input, by comparing `split('\n')` arrays with the member index removed.

### Tests

All tests are pure domain vitest under `packages/domain/test/`. None starts a board, fleetd, a bundle or a host call.

| File | Test | On `main` | After the slice |
|---|---|---|---|
| `rendering.test.ts` | `withSprintAnnotation` with `tick: false`, `pr: 42`, `branch: 'feature/x'` on the fixture: only the Could line gains the annotation | fails (the log and Deferred lines gain it) | passes |
| `rendering.test.ts` | `withSprintAnnotation` with `tick: true`, `pr: null`, `branch: ''` on the fixture: only the Could line becomes `- [x]`; the Deferred box stays `- [ ]` | fails (the Deferred box is ticked) | passes |
| `rendering.test.ts` | `withSprintAnnotation` on a file with the slug only under `### Scope Changes`: `wrote: false`, text unchanged | fails (the log line is annotated) | passes |
| `rules-sprint-annotation.test.ts` | `annotateSprintItem` on the fixture: `outcome: 'updated'`, every other line byte-identical | passes (regression hold) | passes |

The `annotateSprintItem` test is a regression hold, not a red test. The slice shows it fails against `0ef7e8a2b^` and records that in the PR body: `git show 0ef7e8a2b^:packages/domain/src/rules/sprint-annotation.ts` into the working file, run the one test, observe the failure, then `git checkout HEAD -- packages/domain/src/rules/sprint-annotation.ts`.

The existing `withSprintAnnotation` tests in `packages/domain/test/rendering.test.ts:180-288` pass bare item lines with no tier heading. After the change those inputs have no member line, so they turn red. The slice wraps each input in a `### Must Have` heading, with a `MUST` helper written as an arrow function the way `packages/domain/test/sprint-tick.test.ts:6` does. That red is expected and is not a regression. The `workflows-approve.test.ts` and `workflows-deliver.test.ts` suites assert the emitted `Write` and do not render it, so they do not change.

### Gates

Before push, the slice runs `env -u PLOT_REPO_ROOT -u PLOT_UNATTENDED node skills/plot/scripts/board/plot-local-checks.mjs` and runs what it prints. For this change that is:

- `pnpm --filter @plot-pm/domain exec vitest related --run packages/domain/src/workflows/rendering.ts packages/domain/test/rendering.test.ts packages/domain/test/rules-sprint-annotation.test.ts`
- `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`
- `node --test test/reconcile/*gate*.test.mjs` and the `scripts/check-*.sh` list from the `Local checks` key.

No shell changes, so `scripts/check-shell-lines.sh` has nothing to ratchet. No board type changes, so `pnpm run typecheck` is not required.

The slice adds one changeset, `.changeset/plot-approve-writes-the-sprint-annotation.md`, package `'plot': patch`, description first, then a comment with `plan: docs/plans/2026-11-04-plot-approve-writes-the-sprint-annotation.md` and `bumps: skills: plot-deliver: patch`, because the deliver workflow's tick is the behaviour that changes most.

### Tracker

The slice writes nothing to the tracker. The PR body names `0ef7e8a2b` as the board-path fix and this slice as the domain-wide fix, and carries `Fixes #2532`, so the issue closes when the PR merges.

### Seam with PR #3112

Open PR #3112 (`bug/plot-approve-reads-the-plan-from`) edits `packages/board/src/server/entry/approve.ts`, `packages/domain/src/workflows/approve.ts`, `packages/board/test/unit/approve.test.ts` and `packages/domain/test/workflows-approve.test.ts`. This slice touches none of them, so a textual conflict is not expected. The slice still waits for #3112, so a rebase never has to reconcile a change to the approve workflow's sprint step.

### Open Questions

- [x] Does any writer other than `annotateSprintItem` touch a sprint file on approve? — Yes, one: `withSprintAnnotation` (`rendering.ts:221`), through the approve and deliver workflows and `perform-fs.ts:164`. `plot-approve.sh` is a launcher with no sprint text, and `plot-sprint-member` does not exist; the member write is `transitions/sprint-member.ts:229`, which calls `annotateSprintItem`. This slice fixes `withSprintAnnotation`.
- [x] Does a line that begins `- [ ] [slug]` outside the tiers (under `## Notes` or `### Deferred`) stay unannotated? — For `annotateSprintItem` and `tickSprintItem`, yes: `memberLineIndex` sets `inTier = false` on any `##` or `###` heading that is not a tier heading (`sprint-membership.ts:130-133`). For `withSprintAnnotation`, no on `main`, and yes after this slice; the second `rendering.test.ts` test above holds it.

## Slices

### Reproduce and hold

- `bug/plot-approve-writes-the-sprint-annotation` <!-- waits: bug/plot-approve-reads-the-plan-from --> — route `withSprintAnnotation` through `memberLineIndex`, add the issue-shape tests for `withSprintAnnotation` and `annotateSprintItem`, and wrap the existing `rendering.test.ts` fixtures in `### Must Have`

## Notes

- Source: tracker issue #2532, https://github.com/plot-pm/plot/issues/2532. Nothing was written to the tracker.
- Out of scope: the `pr: #0` an in-session approval records (`entry/approve.ts:902`, `:1098`) is filed as #3140.
- Panel: `.plot/panels/2026-11-04-plot-approve-writes-the-sprint-annotation/panel.md`.

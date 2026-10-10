## Implementation brief — the-controllers-close-their-review-findings (wave: The approval asks the domain)

- **Plan (canonical):** docs/plans/2026-10-10-the-controllers-close-their-review-findings.md on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1498 merged
- **Branch:** `bug/the-approval-asks-the-domain` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This branch is first in its plan's slice order and is not part of a wave — the plan runs every slice as its own wave, one at a time, because the first two slices both touch `packages/board/src/server/entry/approve.ts` and would conflict if run in parallel.

### What to build

`packages/board/src/server/entry/approve.ts` repeats, in its own `switch` statements at `:457-469` (phase) and `:475-492` (review channel), the same refusal logic that `packages/domain/src/workflows/approve.ts:143`'s `approve()` function already decides. That domain function has zero production callers today — only `packages/domain/test/workflows-approve.test.ts` and `transitions.test.ts` import it (confirmed by `grep -rln "workflows/approve" packages/ --include="*.ts"`). This is finding #1447 M2.

Build `ApproveReadings` from the plan record and the PR the entry already reads (`readPlanPr`, `:198-217`), call `approve()` before the entry's existing `pr-ready` and `pr-merge` host calls, and map each `ApproveRefusal` value it can return (`plan-not-found`, `plan-unparseable`, `state-terminal`, `state-unreadable`, `state-wrong`, `review-human`, `reviewer-undeclared`, `review-unrecognised`, `slice-unnamed`, `pr-closed`, `pr-absent`) to the exact sentence the current switches throw today. Delete both switches once the domain call replaces them — the plan says "it adds no new rule," meaning don't add a twelfth refusal path; every message the entry prints today must still print.

The `PLOT_UNATTENDED` check for `Review: in-session` (`:473-475` in the current `review` switch) stays in the entry — it reads `process.env`, which the domain has no business touching. Everything else in the two switches moves.

### The decisions the plan settles — do not re-derive them

**The merge pin has no test today, and the stub is why.** `pr.headSha` already exists (`approve.ts:121`, populated at `:218` from `readPlanPr`), and `approve.ts:558` already does `const pin = pr.headSha ? ['--match-head', pr.headSha] : []` before calling `host(['pr-merge', ...])`. The mechanism is not missing — the proof is. `test/reconcile/approve-entry.test.mjs`'s stub `gh.mjs` (written in `before()`, around `:69-73`) answers `gh pr view` with `{number, state, isDraft, url, mergeCommit}` and no `headRefOid`. `plot-host.sh:3577` reads `headRefOid` via `jq` and exposes it as `headSha` — so against this stub, `headSha` always reads `""` and `--match-head` is never passed. This is #1483 M1. Fix it by adding `headRefOid` to the stub's `pr view` response and asserting the `calls.log` records `pr merge <n> --match-head <sha> ...` — a test that reverts `approve.ts:558` back to an unconditional `host(['pr-merge', ...])` (no pin) must fail.

**Why this is two findings in one slice.** Both #1447 M2 and #1483 M1 sit in `approve.ts`'s merge path and the plan deliberately orders the two entry-touching slices first and second rather than running them in parallel — a second slice editing the same file concurrently would conflict. Do not split this slice's two findings into separate PRs.

**Scope discipline: no gate work here.** `the-gates-are-launchers` (branch `feature/the-controller-gate-is-a-launcher`) owns `plot-controller-gate.sh` and `rules/ci-suite.ts` — three findings that originally measured against this plan's territory (#1458 M1, #1458 L1, #1483 L5) were moved there on 2026-10-10 specifically so this plan's slices never touch those two files. If your diff touches either file, stop — that work belongs on the other branch.

### Done when

The plan's `## Done when` is implicit in its Changelog line: *"`plot-approve.mjs` asks the domain's `approve` workflow before it merges a plan PR, so the phase and review-channel refusals come from one rule, and its tests prove that the merge is pinned to the head the approval read."* Concretely:

- Every existing refusal-text test in `test/reconcile/approve-entry.test.mjs` still passes unchanged — the sentences are the same, only their source moved.
- A new test proves the merge call carries `--match-head <40-char-sha>` when the stub supplies `headRefOid`; reverting `approve.ts:558` to drop the pin must fail that test (this is the assertion that catches a naive implementation — one that calls `approve()` but leaves the merge unpinned would pass every other test).
- `workflows/approve.ts`'s `approve()` gains its first production caller; `packages/domain/test/workflows-approve.test.ts` and `transitions.test.ts` still pass unmodified (you're calling existing domain logic, not changing its contract).
- No edit touches `plot-controller-gate.sh` or `packages/domain/src/rules/ci-suite.ts`.

Plus: the repo's gates — a changeset for `plot` (description first, `bumps:` block last, per `CLAUDE.md` Versioning), and the board rebuilds if `entry/approve.ts` changed (no bundle committed — `scripts/check-no-bundle-diff.sh` refuses one). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — do not run the full CI suite list (`test:e2e`, `test:contracts` in full, etc.) locally; `plot-local-checks.mjs` scopes to what your diff touched. A failure in the suites CI runs on the PR comes back as a correction.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base — this slice shouldn't touch any `.sh` file, so this should be a non-issue, but if it does, growth must be paid for by removing shell elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once you have a first commit:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Push your first real commit as soon as it exists — don't wait for the whole slice to be done before the branch has any history.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### The approval asks the domain` heading.

### Scope guard

This branch owns: `packages/board/src/server/entry/approve.ts` (the two switches and the merge-pin path), `packages/domain/src/workflows/approve.ts` (read-only — call it, don't change its signature unless the mapping genuinely can't work without it, and if so, note why in the PR), `test/reconcile/approve-entry.test.mjs`.

Other branches in this plan, not yet dispatched as of this brief: `bug/the-entries-write-through-a-port` (touches `approve.ts` again — the `node:fs` writes at `:285,292,302,323` and the `.git`-parsing helpers — but runs only after this slice merges, per the plan's "no two slices run in parallel" rule), `bug/the-implement-lock-lives-on-disk` (fleet/implement-run, no overlap), `bug/the-merge-reads-what-it-claims` (`entry/merge.ts`, `workflows/merge.ts`, no overlap). Since every slice here is its own wave, do not expect any of these to be running concurrently with this one — if you observe one is, that's a dispatch-gate finding, not something to work around.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

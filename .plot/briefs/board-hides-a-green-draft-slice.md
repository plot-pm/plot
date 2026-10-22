## Implementation brief — board-hides-a-green-draft-slice (wave 1: Show the green draft)

- **Plan (canonical):** docs/plans/2026-10-22-board-hides-a-green-draft-slice.md on main
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2320 merged
- **Branch:** `bug/board-hides-a-green-draft-slice` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention; open the PR through `plot-open-pr.sh`

This is the only slice of the plan. Nothing waits on it.

### What to build

Slice PR #2310 (`bug/reconcile-on-bitbucket-reads-merged-branches`) was a draft with four green checks on head `1173b7f34`. The board showed it nowhere: no *Waiting on you* row, no *Working* row (the desk had finished), and the payload held it under `prs[]` with `checks: "pending"` while GitHub reported green. Two defects follow.

1. **Placement.** A slice PR that is a draft, has green checks and has no live agent gets a *Waiting on you* row with the action "mark ready". Decide it in `packages/domain`, not in `.tsx` (CLAUDE.md, *Every rendered state is a domain property*). A unit test asserts the section with no browser. One browser test then proves the row shows.
2. **Checks reading.** `prs[].checks` must follow the host on the same head.

The plan is canonical; this brief orients.

### Settled decisions and leads

**Reproduce the checks defect before fixing it.** The plan leaves the cause open. One lead from reading the code on 2026-10-22: `pendingOpenPrNumbers` (`packages/domain/src/rules/pr-index.ts:290`) selects rows to re-ask with `row.state === 'OPEN' && !row.draft && checks is pending or failing`. A draft row stored as `pending` is never re-asked, so it stays `pending` after the host turns green. Confirm this against the stored index row for a draft PR before relying on it. If a different cause shows, say so in the PR.

**The index never says no.** Carried over from *A Decision Reads The Index*: a missing row or a stale row means ask the host. Do not turn a stored `pending` into a verdict. `pr-refresh.ts` is the only writer of the PR index (`foldPrIndex`); do not add a second writer.

**Rate cost.** Re-asking draft rows spends host questions. Bound the change to open draft rows whose checks are non-terminal, and state the added cost per pass in the PR. Do not widen the refresh to all drafts without a measurement.

**Open questions in the plan, answer each in the PR description.**
- Which process states count as "no live agent"? Name them. #2310 had a finished desk, so `finished` and `none` count at least.
- Does a draft with red or pending checks need a row? The issue names only the green one. Do the green one. Add the others only if the plan's changelog still holds, and record the choice.

**Terminology.** Use Agent for the actor and Slice for one branch (CLAUDE.md, *The Domain Package*). Add no new `Wave` where `Slice` is meant. New functions are arrows.

### Done when

The plan's changelog is the specification:
- A draft slice PR with green checks and no live agent appears in *Waiting on you* with the action "mark ready".
- The payload's `checks` for such a PR follows the host.

Assertions a naive implementation passes without:
- A test built from the #2310 shape (draft, four green checks, finished desk, stored `pending`). It catches a fix that changes placement but leaves the stale reading.
- A negative case: a draft whose agent is live gets no row. It catches a row for every draft.
- A negative case: a non-draft green PR gets no "mark ready" action.
- A case where the stored row is `pending` and the host says green. The test must make the two arms disagree.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there returns as a correction. Add a changeset (description first, `bumps:` block last). Do not commit the rebuilt board bundle. `scripts/check-shell-lines.sh` refuses growth in shipped shell; this slice should touch no `.sh` file.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the placement rule in `packages/domain`, its view wiring in `packages/board/src/app/lib/agent-rows/`, the PR refresh selection in `packages/domain/src/rules/pr-index.ts` and `packages/fleet/src/shared/pr-refresh.ts`, and their tests. No other branch of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.

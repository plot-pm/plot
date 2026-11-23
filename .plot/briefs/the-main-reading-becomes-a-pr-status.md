## Implementation brief — github-refuses-a-merge-into-a-red-main (slice: the main reading becomes a PR status)

- **Plan (canonical):** docs/plans/2026-11-23-github-refuses-a-merge-into-a-red-main.md on main
- **Approved:** 2026-11-23, jwloka, plan-PR #3691 merged
- **Branch:** `feature/the-main-reading-becomes-a-pr-status` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice has no wave dependency. The plan's second slice, `docs/the-repository-requires-plot-main`, waits on this one: it documents the ruleset that requires the context this slice writes. Keep the context name and the description wording stable, because that document quotes them.

### What to build

On 2026-11-23 the operator merged #3682 on GitHub at 10:54 UTC while fleetd read main settled red on `17a7fc438`. Both Plot merge paths (`plot-ask.mjs merge`, fleetd's merge arm) would have refused it as `default-branch-red`. GitHub never saw the hold, because `main` has no branch protection and Plot writes nothing GitHub reads. This slice makes the hold visible to GitHub as a `plot/main` commit status on the head of every open PR into the default branch.

Two pieces:

1. **A domain rule, `mainHoldStatus(reading, repair, pr, now, checksWaitMs)`** in `packages/domain/src/rules/` (an arrow function, with factual TSDoc per the domain-package rules). It returns `{ state, description }` for one open PR:
   - `failure`, with a description naming the red commit (`main is red on 17a7fc438; merge the repair PR first`), where `defaultBranchRed(reading, now, checksWaitMs)` holds, `holdsApply(pr.base, defaultName)` holds, and `repairMergeVerdict` does not admit the PR.
   - `success`, description `repair PR for 17a7fc438`, for the admitted repair PR.
   - `success` for every PR while the reading is not red, including a reading older than `Checks wait` (`defaultBranchRed` already counts it as no reading).
   - No status at all (a distinct "none" answer, not `success`) for a PR into another base, such as a `sprint/*` branch. `base-branch-red` and the sprint base's own reading are out of scope here.
2. **A fleetd pass** that, for each open PR row in the PR index, computes the wanted status, compares it with the last status written for that head, and writes the difference through the existing `Host.commitStatus` port (`packages/domain/src/ports/host.ts:531`, `CommitStatusWrite` at `:202`). Model it on `runAutoTicketPass` (`packages/fleet/src/shared/auto-ticket.ts:303`): a `world` of ports a test replaces, a `read` that returns rows and readings, and a `logged` set for refusals. Wire it into `fleetAutoWrites` (`packages/fleet/src/shared/auto-writes.ts`) beside the ticket pass, which also starts no agent and so is not skipped by `stopped()`.

A write is due where the settled state changes, the repair record names a new PR, or a PR gets a new head. On an unchanged tick the pass writes nothing. At 12 open PRs a red episode costs about 24 writes: one to fail, one to clear.

### Decisions the plan settles — do not re-derive them

**One decision, not a copy.** `mainHoldStatus` calls `defaultBranchRed`, `holdsApply` and `repairMergeVerdict` (`packages/domain/src/rules/default-branch.ts:343,365`, `rules/repair-pr.ts:182`) rather than restating them. The status and `mergeAt` (`workflows/merge.ts:394`) must read one decision. A second implementation of the hold would be a declared-duplicate case under *A Shell Script Asks The Domain*, and this slice has no need for one: both sides are TypeScript.

**Write on change, not per tick.** The alternative, rewriting every PR's status each tick, costs one request per open PR per tick and spends the Review app installation's budget for no change in outcome. Hold the last-written `(head, state, description)` per PR and compare. Decide where that memory lives: in memory for the daemon's life is acceptable only if a restart re-writes at most once per open PR and the write is idempotent (`CommitStatusWrite`'s doc says a repeat write on the same context overwrites). If you persist it, put it under `.plot/state/` like the other fleetd files. Say which you chose in the PR.

**The writer is the `Review app` identity**, through `Host.commitStatus`, the same port `plot/review` uses (`auto-ticket.ts:204`). Do not add a second connector or a direct `gh api` call, and do not spawn a process: the outer boundary ratchet (*One place reaches a process*, `ci.yml`) fails when the spawn count grows.

**A reading is an answer, a status is a verdict.** The status is derived from the reading each pass and is never read back as input to a decision. `plot/main` is a mirror for GitHub; `mergeAt` keeps reading `.plot/state/default-branch.json`. Do not make Plot's own merge refuse on the host's `plot/main`. *Answers, never verdicts* in `CLAUDE.md` stays true.

**A status does not expire; the plan's Open Questions are open and this slice does not close them.** The plan recommends (a) accept it, plus (c) name the reading's time in the description. Write nothing for `plot-fleet --stop` (option (b) is rejected in the plan's recommendation: a hold that lifts when its writer stops is not a hold). If the Open Questions `[question-new-pr-head]`, `[question-bitbucket]` and `[question-rate]` need an answer to build, stop and report it. Do not guess. Bitbucket: the plan recommends the same pass on both hosts, and `commit-status` already writes a Bitbucket build status. Build the rule host-neutral and write through the port, so Bitbucket needs no second pass. If the Bitbucket write path needs work beyond the port, report it as a finding.

**Rules carried over unchanged.** Absent is not red: a missing, unparseable or other-version `default-branch.json` yields `success`, never `failure` (`defaultBranchRed` returns false for `null`). A failed `commitStatus` write is logged and retried next pass; it never blocks the pass and never marks the head as written. Read the exit state of the write, not the emptiness of its output.

### Done when

The plan's slice line is the specification: `mainHoldStatus` decides `plot/main` for each open PR into the default branch, and a fleetd pass writes it through `Host.commitStatus` when the wanted status differs from the last one written for that head.

Tests, named by the plan:
- `mainHoldStatus`: red with no admitted PR → `failure`, description names the 9-character-or-longer short SHA of the red commit; the repair PR → `success`; green → `success`; a reading older than `Checks wait` → `success`; a PR into a sprint base → none.
- The pass writes once per change and nothing on an unchanged tick.

Lift these, because a naive implementation passes without them:
- A repair PR whose episode is closed, or whose head branch is not `bug/main-repair-<12 hex of lastGreenSha>`, gets `failure`, not `success`. This catches an implementation that admits on `repairPr` alone and skips `repairMergeVerdict`.
- A PR gets a new head while main stays red: the pass writes `failure` on the new head once, and writes nothing on the old one. This catches a memory keyed by PR number.
- Main goes red, then green: every open PR's `plot/main` turns `success` in one pass, and the next tick writes nothing. This catches a clear that never fires.
- A failed `commitStatus` write leaves the head unmarked, so the next pass retries. This catches a memory updated before the write answers.
- The pass makes no host call when the wanted state equals the memory. Assert the call count on the fixture (`commitStatuses` in `host-fixture.ts`), not the state alone.

Plus the repo's gates: a changeset in `.changeset/*.md` for package `plot` (description first, `bumps:` block last, optional `plan:` line naming the plan file); and `node skills/plot/scripts/board/plot-local-checks.mjs` before each push — run what it prints. It prints the tests that name a changed file, the related tests and typecheck for `packages/domain` and `packages/fleet`, and the gate tests and `scripts/check-*.sh`. The suites in the `CI suites` key run in CI only. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of commands elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, stores no number and has no override.

If the change touches `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`. The slice has no reason to, except to name the new status under *A Decision Reads The Index* if a person asks.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

When the PR is created, append `→ #<number>` to this branch's line under `### Status` in the plan's `## Slices` section.

### Scope guard

This branch owns: the new rule file and its test under `packages/domain/src/rules/`, its export from the domain index, the new pass file and its test under `packages/fleet/src/shared/`, the one-line wiring in `auto-writes.ts`, and a changeset. It writes no document under `docs/` — the rollout slice owns `docs/review-status-rollout.md`'s `plot/main` section. It changes no repository setting; a person sets the ruleset.

Open PRs verified at dispatch (2026-11-23) that touch neighbouring ground: none names `auto-writes.ts`, `default-branch.ts` or `repair-pr.ts` (#3687 moves the pulse lookup into the domain; #3637, #3633, #3634, #3635, #3631, #3633 are infra and docs). Expect no collision. If you find something the plan did not anticipate, report it rather than improvising outside scope.

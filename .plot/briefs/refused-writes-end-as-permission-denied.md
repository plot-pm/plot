## Implementation brief — an-agent-refused-every-write-ends (wave 1: Classify)

- **Plan (canonical):** `docs/plans/2026-10-24-an-agent-refused-every-write-ends.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2509 merged
- **Branch:** `bug/refused-writes-end-as-permission-denied` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2 (`bug/loop-writes-blocker-for-refused-agent`) and wave 4 (`bug/claim-only-branch-returns-to-queue`) both wait on this branch. Wave 3 (`bug/fleet-start-probes-worker-writes`) does not.

### What to build

A dispatched agent whose harness refused every Edit, Write and Bash call ends with `{"reason":"nothing-done","actor":"agent"}` and exit `0`. Observed 2026-10-23 in ewz-kus-portal: three slices, 13, 5 and 4 refused calls, and the board read "worker finished — review it". `nothing-done` means *the agent had nothing to do*, and `endingAction` answers it `release-claim`, so the cause is lost.

Add a seventeenth `EndingReason`, `permission-denied`, and make the loop end with it where the turn shows permission denials and no tool call changed the worktree. Today the arm is `packages/domain/src/workflows/agent-loop.ts` near `:850` (`readings.commitBeyondClaim === 'no'`, ends `nothing-done`). Render it on the board as "agent was refused every write — check the worker command's permissions".

The places a new reason touches, found by grepping `nothing-done` and `spend-limit` on 2026-10-24:

1. `packages/domain/src/entities/ending.ts` — `EndingReasonSchema` and the doc list above it. The doc says which reasons are agent-actor; add the new one there too.
2. `packages/domain/src/transitions/agent.ts:460` — the actor check lists the reasons that may name `agent`. A `permission-denied` ending with actor `agent` is refused until it is added.
3. `packages/domain/src/rules/ending-action.ts` — `endingTableAnswer` falls to `if (readings.ending !== 'nothing-done') return 'leave'` for any unknown reason. Decide the answer deliberately and test it; do not let it fall through to `leave` by accident. `NEEDS_PERSON_ENDINGS` (`:211`) and `needsPersonMarker` (`:505`) are where a reason that goes straight to a person lives, and `spend-limit` is the model: a fresh session reads the same refused permissions.
4. `packages/board/src/server/fleet.ts` and the board's ended-desk rendering — the plan's Board impact note names `ended-desks.ts` and `schema.ts`; `ended-desks.ts` does not exist under that name (the rule is `rules/ended-desk.ts`), so find the real readers by grepping `EndingReasonSchema`.
5. The rebuilt board artifact. Do not commit it: `scripts/check-no-bundle-diff.sh` refuses a bundle in a PR diff, and `main` builds it after the merge.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Layering.** The classification is a domain reading, not an adapter decision: controller → domain → port ← adapter. The loop takes the denial signal as a value in `readings`, as `commitBeyondClaim` already is. It must not read a transcript from the domain.

**Denial plus no worktree change.** The plan requires both. Denials alone are not enough: an agent that was refused one Bash call and then committed through Edit did work. `commitBeyondClaim === 'no'` already carries the no-work half; keep that guard, and add a test where denials exist and a commit exists, which must NOT end `permission-denied`.

**Do not route around the refusal.** The agents in the observed run did not, and could not write `PLOT-BLOCKED.md` either. That is why slice 2 exists; do not write a marker from this slice.

### Open question this slice must answer, and say so in the PR

The plan leaves one question open that decides the shape of this slice: *is the permission-denial signal read from the harness's JSON result or from the session transcript?* The plan notes the transcript path is a machine-local detail the domain should not import. I did not find any existing reader of `permission_denials` or a `--output-format` flag in `packages/` or the shell scripts (grep, 2026-10-24), and `PromptExitInput.output` (`rules/prompt-exit.ts:48`) holds only *the last lines of the prompt's output*. So the signal has no source yet. Before writing the rule, read what the `Worker command`'s output actually contains for a refused run, and put the answer in the PR description. If neither source can be read without an adapter change, report that in a `PLOT-BLOCKED` marker rather than inventing a parse of free text.

### Done when

The plan's `## Done when` does not exist in this plan; its Changelog line is the specification: *a fleet agent whose every write the harness refused now ends as `permission-denied`, and the board names the cause.* Assertions that a naive implementation would pass without:

- An ending read off disk with reason `permission-denied` and actor `agent` parses. Catches the `transitions/agent.ts:460` check being forgotten.
- A turn with denials and a commit beyond the claim does not end `permission-denied`. Catches a classifier that reads denials alone.
- A turn with no denials and no commit still ends `nothing-done` and still answers `release-claim`. Catches a change that widens the old arm.
- `endingAction` answers the new reason with a named verdict, not the `leave` fall-through. Catches the silent default.
- A board render test shows the new wording for a `permission-denied` desk. Catches a reason the schema accepts and the view cannot name.

Plus: add a changeset (`'@plot-pm/board'` and/or `plot`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Domain code is arrow functions with factual TSDoc and no decision history. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file, and if it does, remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Classify` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/entities/ending.ts`, `packages/domain/src/transitions/agent.ts`, `packages/domain/src/rules/ending-action.ts`, the arm in `packages/domain/src/workflows/agent-loop.ts`, the board's ended-desk rendering, and their tests.

Not this branch: writing `PLOT-BLOCKED.md` from the loop (`bug/loop-writes-blocker-for-refused-agent`), the start-time probe in `plot-fleet` (`bug/fleet-start-probes-worker-writes`), and any claim release, ref pruning or desk reaping (`bug/claim-only-branch-returns-to-queue`). Slice 4 touches a destructive path and must read `mergedAt`; keep it out of this change.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

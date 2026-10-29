## Implementation brief — a-dead-desk-gets-a-fixer (wave 1: The dead desk reads unreadable)

- **Plan (canonical):** `docs/plans/2026-10-29-a-dead-desk-gets-a-fixer.md` on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2915 merged
- **Branch:** `feature/a-dead-desk-reads-unreadable` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waits on `feature/fleetd-reviews-slice-prs` (#2900), which builds `deskDead` (`packages/domain/src/rules/desk-dead.ts`). Measured at brief time: `origin/main` has no `desk-dead.ts`, and the branch is not pushed. Start the work after #2900 merges and rebase onto `main`. Do not write a second copy of the dead-desk reading from `loopAlive` and the marker; the plan's open question names that as the alternative it rejects. Wave 2 (`feature/holding-work-reads-the-merge`) edits the same four files, so it waits on this wave.

### What to build

A dead desk that the fleet launched, whose worker exited 0 or left no exit record, writes no ending today. `killedWorkerEnding` answers `null` for both (`packages/domain/src/rules/ending-action.ts:632-635`), the table answers `leave`, and the desk waits for a person although its branch holds work and has no pull request. This wave gives `killedWorkerEnding` a second arm that composes the existing `unreadable` ending, actor `supervisor`. The existing bound arm then starts one fresh session and asks a person after the second ending. No new verdict, record or route.

The arm composes only where every reading holds:

- `.plot-worker.pid` is present and holds a positive integer (read through the `deskFile` port `killedWorkerEndings` already takes).
- The ending file is `absent`. An unparseable ending and any written ending, a person's `stopped` among them, stay as they are.
- The exit record holds `0`, or there is none.
- `deskDead` answers `{ dead: true }`.
- The desk names a branch.
- `Trees.commitBeyondClaim` answers `yes` (`registryd-main.ts`, the `commitBeyondClaim` ask near `:1800`); `no` and `unanswerable` compose nothing.
- The host's `prState` for the branch answers `null` (no pull request in any state), through the same `hostShell(context).prState` read near `registryd-main.ts:1804`. OPEN, MERGED, CLOSED and a failed call compose nothing.

`killedWorkerEndings` (`registryd.ts:794`) is synchronous today and takes `deskFile` and `loopAlive`. It becomes async and takes the git and host reads as ports. It reads the launch record, the ending file and the exit record first, then asks `deskDead`, git and the host in that order, only for a desk that passed the earlier readings, and stops at the first reading that composes nothing. The non-zero-exit arm reads exactly what it reads today. `startFreshAgents` (`registryd.ts` near `:850`) awaits it and writes each ending as it does now, before `readFreshAgentCandidates` runs, so the reader sees a bound ending and asks `prMerged`, `commitBeyondClaim` and `prOpen` for real.

The `detail` names what was read: `the worker exited 0 and wrote no ending; its branch holds work and no pull request` for an exit of 0, and `the worker left no exit record and no ending; its branch holds work and no pull request` for a missing record. Never print an exit code that was not read.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The launch record gates everything, and it is read first.** A worktree a person or the master session cuts by hand on a slice branch is plan-named, has no manifest, no ending, no exit record and no loop, and `commitBeyondClaim` counts its real commits. Without `.plot-worker.pid` it passes every other reading and fleetd would start a second writer in that person's folder. Only a fleet launch writes the file (`plot-dispatch.sh:1503-1507`, `continuation.ts:1407`, `desk-fs.ts:42`), and `.gitignore:63` keeps git from carrying it into a new worktree. A desk without it composes nothing and the tick makes no `deskDead`, git or host call for it. A test proves both.

**"No pull request" is the host's `prState`, never the PR index.** The index can supply `pr: 'MERGED'` and never `pr: 'none'` (*A Decision Reads The Index*). An absent row, an old index and a failed host call all compose nothing. Measured 2026-10-08: an empty result read as no PRs refused four fully-merged plans.

**A branch with a pull request is asked about once.** `prState` never answers `null` again for it. fleetd keeps an in-process set keyed by worktree path and the text of `.plot-worker.pid`. OPEN, MERGED or CLOSED adds the key. A failed call adds nothing, so the next tick asks again. A new launch writes a new pid and so a new key. A fleetd restart empties the set. A `MERGED` row in the PR index may add the key with no host call.

**The fixer and the restart verdict are out of this plan.** Round 2 measured 33 fresh sessions and 10 second endings (2026-10-09 to 2026-10-28): 0 and 0 were on a desk with no pull request. Do not add `start-fixer`, `restart`, a restart record or a call into `restartBranch`. A desk with a pull request belongs to #2903; the 7 `blocked` second endings belong to #2901.

**A person's stop stays a stop.** `stopped`, `spent` and `limited` endings are never overwritten. A person who takes over a desk the fleet launched writes a marker or `--stop`; `deskDead` and the `PLOT-BLOCKED` marker hold that desk back.

Carried-over rules: absent is not false, and a failed read composes nothing. A desk on another machine reads `elsewhere` and `deskDead` composes nothing for it. The contract `fresh-agent-tick.test.ts:410` pins stays: a second fresh-session ending on a desk whose pull request has not merged answers `needs-a-person` with a marker.

### Done when

The plan's `## Done when` list, here the slice's `tests:` clause, is the specification. The assertions that exist because a naive implementation would pass without them:

- **Domain row, every other reading set to compose, no launch record → `null`.** Catches an arm that checks the readings and forgets the gate.
- **Each reading flipped in turn** (live loop, marker, `elsewhere`, `unread`, no branch, `commitBeyondClaim` `no`/`unanswerable`, `prState` OPEN/MERGED/CLOSED/failed) **→ `null`.** Catches an arm that treats an unanswered read as a yes.
- **Existing rows for a `stopped` ending and an unparseable ending stay green.** Catches an arm that overwrites a person's account.
- **Fleet unit, hand-cut worktree** on a plan-named slice branch with commits beyond its claim, no `.plot-worker.*` file and no pull request: no ending, no fresh session, verdict `leave`, and zero `deskDead`, git and host calls. Catches the second writer in a person's folder.
- **Fleet unit, dead desk with a launch record, work and no PR** gets the ending and `start-fresh` in one tick; a second ending after the fresh session asks a person.
- **Host answer OPEN is asked once across two ticks; a failed call is asked again.** Catches both a per-tick host call and a cached failure.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Add a changeset with the description first and the `bumps:` block last; do not edit versions by hand. Do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change by removing shell elsewhere or writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines, and has no override.

New functions are arrows. TSDoc states what an export does, its parameters, its return and how it fails, and does not narrate the decision; the reasoning goes in the commit message. The domain imports no adapter, and the controller calls the domain and spawns nothing.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ending-action.ts`, `packages/domain/test/rules-ending-action.test.ts`, `packages/fleet/src/server/entry/registryd.ts`, `packages/fleet/src/server/entry/registryd-main.ts` (the port wiring only) and `packages/fleet/test/unit/fresh-agent-tick.test.ts`, plus its changeset.

In flight: `feature/holding-work-reads-the-merge` (wave 2 of this plan) edits the same files, so it waits on this branch. `feature/fleetd-reviews-slice-prs` (#2900) builds `rules/desk-dead.ts`; this branch only reads it. `feature/fleetd-starts-the-fixer` (#2903) owns every fixer start on a desk with a pull request. `feature/fleetd-answers-a-question` (#2901) answers `PLOT-BLOCKED`. `feature/the-loop-keeps-a-run-log` (#2899) owns the run log.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

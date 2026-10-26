## Implementation brief — an-idle-board-and-fleetd-spend (wave 1: Ask Only Where It Decides)

- **Plan (canonical):** `docs/plans/2026-10-26-an-idle-board-and-fleetd-spend.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2716 merged
- **Branch:** `bug/nothing-done-asks-pr-state-only-where-it-decides` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `feature/the-tick-reads-merged-prs-as-an-index-delta`, waits on this wave. Both edit `registryd-main.ts` and both touch the `tally`; cut wave 2 from `main` after this merges.

### What to build

fleetd's nothing-done step asks the host for the PR state of every leftover plan-named worktree on every tick, also where the verdict does not read the answer. Measured 2026-10-26 with a `ps` sample every 0.25 s for 200 s: two desks, both ending `blocked`, cost exactly 2 `pr-state` calls per tick. One of them has held that ending since 2026-10-23, about 3,000 requests on an answer nobody reads. Overnight the idle fleetd recorded about 618 GitHub GraphQL lines per hour, and this step is about 430 of them. No counter reports the calls: `mine=` shows the merged-list call and nothing after the spend reading.

Three changes, all in `packages/fleet/src/server/entry/registryd.ts`, `registryd-main.ts` and `shared/release-claim-reader.ts`:

1. **Ask only where the answer decides.** In `nothingDoneDecisions` (`registryd.ts:1374`) call `commitBeyondClaim` only for a candidate whose ending is `nothing-done`, and `prOpen` only for one with ending `nothing-done` and `commitBeyondClaim === 'no'`. Every other candidate gets the filler `'unanswerable'` for both readings. The filler takes the same arm as `'yes'` and `true`, so `endingAction` returns the same verdict. The comment at `registryd.ts:1403` already describes a filler the code does not apply; this change makes the comment true.
2. **Count every call the step makes.** Extract the ports at `registryd-main.ts:2475-2490` into a builder that takes `tally`, the shape `freshAgentDeskReads` (`registryd-main.ts:1534`) already has. Its `prOpen` port adds 1 per host call. `releaseClaimOf` (`registryd-main.ts:2151`) takes `tally` too and adds 1 per host call `prReading` makes (`release-claim-reader.ts:72`, `:74`): 2 when the state answers, 1 when it does not. The fresh-agent step shares `releaseClaimOf`, so its releases count too.
3. **Reset the tally where a reading takes it.** Today the loop sets `tally.calls = 0` at the top of the tick (`registryd-main.ts:2366`), and `spendForTick` reads it at `:2422`, before the fresh-agent and nothing-done steps run, so their calls are cleared unread. Move the reset to directly after the spend reading. A tick that throws (the `continue` at `:2410`) or is incomplete takes no reading, and the next tick resets at its top as today. So no reading counts two intervals. Update the `HostTally` TSDoc (`:358-364`) and the comment at `:2367` to say this.

### Decisions the plan settles — do not re-derive them

**The verdict is not re-derived.** `endingAction` reads `commitBeyondClaim` and `prOpen` in one row on this path: ending `nothing-done` (`ending-action.ts:345`), then `commitBeyondClaim` (`:346`), then `prOpen` (`:347`). The other rows return before it. `endingReleaseBranch` (`:393`) reads `ending`, `refusedAssignment` and `branch`, not `prOpen`. A `bound` ending reads both through `boundBranchHoldsWork` (`:199`), but `nothingDoneDecisions` answers `leave` for a bound ending before it builds readings. Do not widen the asked set "to be safe": that is the spend this slice removes.

**Do not cache the answer across ticks instead.** An earlier shape answered the nothing-done `prOpen` from an OPEN index row. Panel round 1 found 0 of 184 recorded endings are `nothing-done` (65 `checks-unanswered`, 31 `unregistered`, 31 `blocked`, 24 `unreadable`, 12 `holding-work`, 12 `corrections-spent`, 5 `unstarted`, 4 `quiet`), so it would have saved close to nothing, and it needed an OPEN-row exception to CLAUDE.md *A Decision Reads The Index*. The operator withdrew it. Add no memo and no index read here.

**`mine=` keeps its formula.** `boardSharePerHour` multiplies a tick's calls by 60 s (`cadence.ts:72`), and the real tick period is about 84 s. A per-hour comparison of `mine=` with `budget.tsv` cannot pass, and changing the formula changes a field every tick line prints. It is out of scope; the acceptance is per tick.

**The record under-counts pages, and that is not this slice.** `budget_record_call` writes one line per `gh` process, so a paged `pr-list` is one line and several requests (#2717). `tally` counts host calls, not pages.

**Carried-over rules.** Absent is not false: `'unanswerable'` is a filler that points away from `release-claim`, and it must never read as "no PR". Read the exit code, not the emptiness. `tally` is a number on the tick line; no decision reads it.

### Done when

The plan's `## Slices` entry and `### Approach` points 1–3 are the specification. Plus the tests the plan lists, and the assertions that exist because a naive implementation would pass without them:

- **One candidate per ending** through the builder: `null`, `nothing-done` with `commitBeyondClaim` `'no'`, `'yes'` and `'unanswerable'`, `holding-work` with and without a refused assignment, every fresh-session ending, every outright-person ending. Assert exactly 1 `prOpen` host call for `nothing-done` with no commit beyond the claim and 0 for every other candidate, 1 `commitBeyondClaim` call per `nothing-done` candidate and 0 for the others, and `tally` equal to the number of host calls. A count that only checks the `blocked` case passes with `prOpen` asked for `holding-work` too.
- **Verdict equivalence.** A second test asserts the verdicts equal the current code's verdicts for the same readings. This catches a filler that takes the wrong arm. `nothing-done-tick.test.ts:179` keeps passing unchanged.
- **Release counting.** A release through `releaseClaimOf` with a stubbed host adds 2 to `tally`, and 1 when `prState` does not answer.
- **Reset placement.** A `run()` test with a stubbed tick runs a complete tick, a tick that throws, and a complete tick, and asserts the third reading counts only the third tick's own calls. A reset left at the top of the tick still passes the first two ticks and fails only here.
- **Acceptance, per tick:** with N leftover worktrees and no manifest, of which M hold `nothing-done` with no commit beyond the claim, the step makes M `pr-state` calls per tick against N before; `mine=` for a tick equals 60 × the host calls counted since the previous reading.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `test:e2e`. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play. Add a changeset for package `plot` with the plan's first Changelog line as the description, description first and any `bumps:` block last, and run `./scripts/check-changeset-packages.sh`.

Fleet code is new code under the arrow-function rule: a function you write or rewrite is an arrow; leave the neighbouring declarations alone.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Never write `State:` by hand.

### Scope guard

This branch owns `packages/fleet/src/server/entry/registryd.ts`, `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/shared/release-claim-reader.ts`, their tests under `packages/fleet/test/unit/`, and one changeset. In flight, verified at dispatch (2026-10-26):

- `bug/a-bitbucket-listing-reads-every-page` edits `registryd-main.ts` (22 lines), `queue-reading.ts`, `pr-refresh.ts` and the domain's `rules/pr-index.ts`. Expect a textual conflict only if you touch the same hunks; the merged-set code is wave 2's, not yours.
- `feature/fleetd-holds-the-pr-index-lock` and `feature/pr-index-lock-beside-the-index` belong to `one-pr-reader-per-machine-and`; neither has pushed a diff against `main` yet.

Not yours: the merged listing (`mergedBranches`, `registryd-main.ts:780`) and the CLAUDE.md paragraph are wave 2. The scan's `pr-list --state all --limit 3000` is #2720. The missing `ending.branch === tree.branch` guard in `readNothingDoneCandidates` (`registryd.ts:1290`) is a pre-existing follow-up the plan names and does not file; do not fix it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

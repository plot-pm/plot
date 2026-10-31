## Implementation brief — a-red-main-is-reverted (wave: Breaking merge revert)

- **Plan (canonical):** [docs/plans/2026-10-29-a-red-default-branch-is-repaired.md](../../docs/plans/2026-10-29-a-red-default-branch-is-repaired.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2910 merged
- **Branch:** `feature/a-red-main-is-reverted` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `#2900`'s `startReview` — this slice itself starts the review of the PRs it opens

All three branches this slice waits on are merged: `feature/the-repair-record` (#2936), `feature/merge-admits-the-repair-pr` (#2966), `feature/fleetd-starts-main-repair` (#2973), `feature/fleetd-reviews-slice-prs` (#2958) and `feature/an-unfixed-high-is-ticketed` (#2975). This is the plan's last open slice.

### What to build

`redMainStep` (`packages/domain/src/rules/repair.ts:237`) already answers `revert`, `close-prs` and `exhausted`. Nothing acts on those three answers yet — `packages/fleet/src/shared/repair-start.ts:65` says so explicitly: *"`revert`, `close-prs` and `exhausted` are left to their own callers."* This slice is that caller, mirroring `repairStartTick`'s shape:

1. On `revert`: re-run the last green SHA once (the record's `revertRerun` field already exists for this), re-ask the first red SHA's runs, confirm the breaking commit is still on main and not already reverted, make the revert (a new port operation), claim `bug/revert-<pr>`, open the revert PR, and start its review through `startReview`.
2. On `close-prs`: close the open fix PR and the open revert PR the record names, through a new close-PR port operation.
3. After a revert merges: write a ticket naming the plan and the reverted PR.

### The decisions the plan settles, and what is already built — do not re-derive either

**The picker is built and is not this slice's job.** `redMainPicker` and `candidatesFromLine` (`packages/domain/src/rules/repair.ts:23-138`) are complete, tested, and already read by `redMainStep` via `RedMainStepInput.pickerAnswer`. This slice only has to *supply* that input — read the record's candidates, the host's `prMerged`/`mergeCommit` per candidate, each candidate's settled-red state, and whether it touches a `State:` line — then hand the picker's answer to `redMainStep`. `repairStartTick` currently hardcodes `pickerAnswer: 'unknown'` (`repair-start.ts:125`) because nothing needed it before now; this slice's own tick computes it for real.

**The merge exception for a revert PR is already wired — do not touch `merge()` or `slicePrNext`.** `feature/merge-admits-the-repair-pr` (#2966) built `repairMergeVerdict`, `repairEpisode`, `repairRoleOf`, `repairBranchMatches`, `isRevertBranch` and `mainRepairBranchOf` in `packages/domain/src/rules/repair-pr.ts`, and `merge.ts` already calls `repairMergeVerdict` on a red reading (`workflows/merge.ts:227`). A revert PR from `bug/revert-<pr>` that the record names as `revertPr` already merges through the ordinary `merge()` call with no further change. Confirmed by reading `merge.ts` and `repair-pr.ts` directly — the plan's design section 5 reads as still-to-build, and it is not.

**The revert branch name is already a parsed shape, not a format string to invent.** `isRevertBranch` (`repair-pr.ts:39`) is `/^bug\/revert-[1-9][0-9]*$/` — the branch is `bug/revert-<reverted-pr-number>`, decided at the point the revert PR is opened (you need the reverted PR's number before the branch can be named, unlike the deterministic `bug/main-repair-<sha12>`). Claim it the same way `repairStartTick` claims the fix branch: an empty `plot: claim <branch>` commit (`agent-loop.ts:723-724`, judged by `claimTip`), pushed before the revert commit is made — not after.

**The revert operation is new, on a port, on both drives.** No port has anything close today: `ports/trees.ts` has `commit`/`push` only (no revert-of-a-merge), `ports/host.ts` has no close-PR, `ports/build.ts` (built by the sibling slice, not `Host` as the plan's prose assumed) has `rerunFailed(branch, sha)` but nothing for a revert or a close. Build the revert as a new git operation — likely on `Trees` or a new port, your call to make and record, since none of the three sibling slices had to choose this — that produces a revert commit of the breaking merge on the claimed `bug/revert-<pr>` branch, pushed, ready for `plot-open-pr.sh`. `scripts/check-host-cli-callers.sh` and the purity/outer-boundary gates (see repo `CLAUDE.md` § The Layering Rule) apply as they did to the sibling slices' new operations.

**The close-PR operation is new too, on `Host`, on both drives.** `plot-host.sh` has `pr-create`, `pr-merge`, `pr-ready`, `pr-list` (verified: no `pr-close` substring anywhere in the file). Build it the same way the sibling slice built `rerunFailed` — a new `Host` port method plus both drive implementations, gated by `scripts/check-host-cli-callers.sh`.

**The ticket writer from #2975 is real, but it answers a different question — read before assuming it drops in whole.** `packages/domain/src/rules/ticket.ts`, `ports/ticket-record.ts`, `entities/ticket-record.ts` and `packages/fleet/src/shared/auto-ticket.ts` (merged under branch name `feature/an-unfixed-high-is-ticketed`, PR #2975) write a tracker issue for an unfixed HIGH finding on a *slice* PR, keyed by that PR's number, sourced from a review-verdict file. The plan's step 10 wants a ticket "naming the plan and the reverted PR" — same underlying primitives (`Tracker.issueOpen`/`issueComment`, `TicketRecordStore` keyed by PR number), different trigger and different body. Reuse the port and the record shape; do not assume `ticketTick` or `putOnTicket` already covers a revert, because they read a review-verdict file this event has none of. This is a decision this slice has to make, not one already made for it.

**One repair record, two roles, driven by one rule's answer.** `redMainStep`'s inputs (`RedMainStepInput`) already named `lastGreenRerunSettled` and `pickerAnswer` for exactly this slice — they are plumbed through the rule but nothing upstream supplies real values yet (`repair-start.ts:128` passes `'none'` for the former). Do not add a second rule or a second record for the revert path; extend the same tick-shaped caller, reading the one record `RepairRecordStore` already serves.

**A conflicting revert, a red revert PR, a HIGH on the revert PR, and the picker answering `unknown` all go to `exhausted` inside `redMainStep` already** (`repair.ts:265-272`) — this slice's caller does not re-decide any of those; it reads the rule's answer and, on `exhausted`, notifies once and starts nothing more.

### Done when

The plan's `## Done when` is implicit in Design section 8–10 and the Decisions list (no separate `## Done when` heading):

- A conflicting revert, a red revert PR, a HIGH on the revert PR, or `unknown` from the picker ends the episode at `exhausted` with one notification and no second attempt.
- The revert is attempted against a merge-commit landing and a squash landing alike, and a conflict is detected rather than silently producing a bad commit (adapter test on a temp git repo, named in the plan's Notes for this slice).
- `close-prs` closes both the fix PR and the revert PR the record names, through the new close-PR operation on both drives.
- A merged revert writes a ticket naming the plan and the reverted PR, keyed by that PR.
- The multi-tick fake-clock anti-goal test (head moving every 12 min, a bundle-bot push after the breaking merge) proves the whole episode — rerun, repair-or-revert, merge — completes within `Main repair bound` plus one re-run, one review and one merge round.

Plus: the repo's gates — build artifacts (no committed `board-server.mjs` diff), a changeset naming `plot` or `@plot-pm/board`, and the usual TypeScript/domain gates. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds a close-PR operation on `plot-host.sh` — pay for any growth there in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;`/`&&` is not a payment.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/a-red-main-is-reverted` under `### Breaking merge revert`).

### Scope guard

This branch owns: the revert git operation (new port method, both drives), the close-PR operation (new `Host` method, both drives), the fleet-side caller that drives `redMainStep`'s `revert`/`close-prs`/`exhausted` arc (the picker's input readings, the pre-revert re-run, the claim push onto `bug/revert-<pr>`, the revert commit, opening and reviewing the revert PR), and the ticket write after a merged revert.

It does not own: the repair record, its lifecycle, `redMainStep`, the picker (`redMainPicker`/`candidatesFromLine`), or the `Main repair bound` parser (all `feature/the-repair-record`, merged); the merge exception in `merge()`/`slicePrNext` or any of `repair-pr.ts` (`feature/merge-admits-the-repair-pr`, merged — confirmed already handles a revert-role PR, nothing to add there); the re-run port operation, `main-repair` role start, or the fix-PR caller (`feature/fleetd-starts-main-repair`, merged); `startReview` itself (`feature/fleetd-reviews-slice-prs`, merged); the slice-PR HIGH ticket writer's own trigger and body (`feature/an-unfixed-high-is-ticketed`, merged — reuse its port and record shape, not its trigger).

If you find something the plan did not anticipate, report it rather than improvising outside scope.

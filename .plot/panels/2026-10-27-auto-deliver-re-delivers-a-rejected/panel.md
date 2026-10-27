# Panel round 1 — moderation

Subject: `docs/plans/2026-10-27-auto-deliver-re-delivers-a-rejected.md` (plan PR #2760, issue #2713).

Gate: `plot-panel.mjs check Position proceed,amend,reject` committed all four files. Reconcile: `unanimous amend rootcause,code,safety,tests`.

## What each juror looked at

- **rootcause** ran `git log`/`git show` on the #2400 plan, ran `planAutoDeliver` from an esbuild bundle against the plan's row in `last-pulse.json` (it returns the plan), ran `gh pr view 2422`, and ran `plot-undeliver.sh` on a scratch copy of the plan (its `refs-swept` refusal never fires). It read the deliver log of the incident.
- **code** ran `gh pr view 2422 --json files,commits,mergedAt` and `git show --stat`, and read `isDeliverable`, `carriedWorkOf`, `emptySlices`, the pulse schema and the ports.
- **safety** ran `gh pr view` on #1816, #1823 and #2422, `git log` on both plans with a `Rejected:` record, `git ls-remote` for the swept ref, and the first-parent diff of merge `eede90c78`. It built the two-precedent table that tests both directions.
- **tests** ran `gh pr view 2422`, the first-parent diff of `eede90c78`, and the tree-against-parent check on both PR commits. It read the auto-deliver test suites (64 and 43 tests) and `deliverable.corpus.test.ts`.

## Agreed by all four

1. **The account holds.** `isDeliverable` (`rules/auto-deliver.ts:340-395`) reads no `Rejected:` record and nothing about what a merged PR changed. rootcause reproduced the re-delivery by running the rule.
2. **`.plot/claims/` does not exist.** A claim is an empty commit titled `plot: claim …` (`rules/empty-claim.ts`). A test built on the plan's predicate never fires on a real PR.
3. **The "merge watcher's definition" does not exist.** All four grepped for it and found nothing.
4. **PR #2422 changed zero files**, and its second commit `f576060de` is empty with a non-claim subject. So `isEmptyClaim`/`realCommits` count it as work and miss the incident (tests and safety ran this). The working predicate is file-based: the merge commit's first-parent diff, or the host's PR file list.
5. **The pulse carries neither input.** `PlanSchema` (`entities/fleet.ts:695-722`) holds `file`, `phase`, `tracer` and `slices`. "Board impact: none" and "adds no plan field" hold only if the readings come from outside the pulse.
6. **Both holds are auto-only.** `/plot-deliver` and the board keep "Delivery continues" for an empty slice, per the recorded 2026-09-08 decision at `workflows/deliver.ts:96-110` (3 of 7 claim-only PRs belonged to slices finished under another PR). The precedent for a stricter auto path is `landedBranches` (`auto-deliver.ts:370-389`), because auto-deliver chains to `plot-release-refs.sh --yes`.
7. **A date-only `Rejected:` record cannot resolve the incident.** The merge (14:19:47Z) and the rejection (14:38:04Z) fall on one day. `>` holds a later same-day fix forever; `>=` re-delivers the incident.
8. **Approach 3 (corpus pair) has no subject.** No shell twin of carried work exists. tests adds that `deliverable.corpus.test.ts` already excludes `planAutoDeliver` and needs one line naming the holds.
9. **Every `unknown` holds the auto path**, and a hold is never counted as carried work.

## Disagreements

**1. What lifts the rejection hold.** rootcause: never auto-deliver an Approved plan that carries `Rejected:`; a person delivers it, on the precedent at `auto-deliver.ts:370-389`. code: release on a merge whose host `mergedAt` is later than the commit that wrote `Rejected:` (`Refs.recordCommit`), read from a MERGED PR-index row. safety: an instant comparison, or rootcause's rule as the fallback. tests: requires a hold-lifts fixture. safety's own precedent decides the weight: on `a-lifecycle-micro-pr-merged-past`, the fix landed under a new slice heading and the hollow branch stayed non-deferred, so the claim-only hold keeps that plan held whatever slice 1 does. The lift machinery therefore buys little. The evidence supports rootcause's rule: it has no timestamp source to build, and the held plan only waits for a person.

**2. How slice 1 receives the record.** rootcause and code read the plan file in the fleet adapter for candidate plans only, through `PlanStore`, and pass it as a value. This costs no shell lines and keeps the rule pure. tests adds a pulse field filled by `plot-fleet-scan.sh` and a scan-level emission test. safety accepts either. The evidence supports the adapter read: the pulse route costs lines under `check-shell-lines.sh`, changes the board's schema, and needs its own emission test to avoid shipping an unfilled field.

**3. Where "rejected" is read.** safety: phase `approved` plus any `Rejected:` record, because the two writers differ: `/plot-reject` replaces `Delivered:` in place, while `plot-undeliver.sh` rewrites `State:`, inserts `Rejected:` after it and keeps `Delivered:`. tests reads `plot-undeliver.sh:124-157` as removing `Delivered:`. The script on main (`plot-undeliver.sh:117-157`) has no line that removes `Delivered:`; safety is right, and "latest Status record" by position does not fire after `plot-undeliver.sh`. tests' point about a later `Started:` record stays open under any rule other than safety's.

**4. Whether a marker-only PR is work.** code and rootcause reuse `carriedWorkOf`, whose `isMarker` ignores a root `PLOT-BLOCKED*` file. tests asks that a `PLOT-BLOCKED.md`-only PR count as work, or that the plan says it does not. safety counts any changed file as work. The existing definition (`deliverability.ts:211-238`) already answers it; moving it into the domain gives one definition for board and fleet, which is what the plan asks.

**5. Scope beyond fleetd.** rootcause alone names `skills/ralph-plot-sprint/SKILL.md:142,239`, which run `/plot-deliver` unattended with neither check, and the upstream cause: `/plot-reject` hand-edits the plan and does not call `plot-undeliver.sh`, whose `refs-swept` refusal parses `(Branch: …` (`:79`) and never fires on current plans (ran). The Changelog line over-claims unless the scope widens or the line narrows to fleetd.

## Shared blind spot

All four designed a forward fix and none asked what happens to #2400 itself. On main, `docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md` still reads `State: Delivered` with `Rejected:` above a second `Delivered: 2026-10-26`, the `delivered/` symlink exists, and the sprint item in `2026-W43-bugfix-2-28-2.md:31` is ticked. The next release publishes its Changelog line for paging that is not on main, which is the harm the plan's Motivation names. A repair cannot come first: fleetd re-delivered within 43 seconds the last time, and it does so again until slice 1 ships or auto-deliver is off. The plan needs a step that orders the repair (stop auto-deliver or land slice 1, then reject #2400 through `plot-undeliver.sh`, then untick the sprint item) and states that no release cuts before it.

## Named amendments for the plan

1. Replace the claim-only predicate: the merge commit's first-parent diff (`Host.prMergeCommit` then `Refs.commitFiles`) changes no path outside a root `PLOT-BLOCKED*` marker. Move `carriedWorkOf`'s classification into a domain rule that board and fleet both call. Forbid `Refs.changedFiles` (three-dot, empty after a true merge) and `isEmptyClaim`/`realCommits`.
2. Delete the `.plot/claims/` wording and the merge-watcher reference.
3. Cite the 2026-09-08 `emptySlices` decision and state that both holds are auto-only, beside `landedBranches` in `isDeliverable`. `allSlicesMerged`, the board, `/plot-deliver` and the scan's slice verdict stay unchanged.
4. Decide disagreement 1. Recommended: an Approved plan carrying any `Rejected:` record is not auto-delivered; a person delivers it. Drop Open Question 1.
5. Define "rejected" as phase `approved` plus a `Rejected:` record, not "latest Status record".
6. Read the record and the carried-work reading in the fleet adapter for candidate plans only; cache the carried-work answer per merged branch, since a merge commit is terminal. If a pulse field is chosen instead, state the shell-line cost, correct "Board impact: none", and add a scan-level emission test.
7. A hold is a skip in `isDeliverable`: no in-flight mark, no failure record, no "failed 3 consecutive deliveries". Every `unknown` holds, and the board names the hold.
8. Slice 1 fixtures: the incident's same-day timings, a plan with no `Rejected:`, a pre-change pulse, and a `plot-undeliver.sh`-layout plan that keeps `Delivered:`.
9. Slice 2 fixtures: #2422's shape (empty claim commit plus empty non-claim commit), a marker-only diff, one real file, a true merge whose tip equals its merge base, a swept ref, and `unknown`.
10. Drop Approach 3; add one line to the exclusion comment in `deliverable.corpus.test.ts`.
11. Decide disagreement 5: add `ralph-plot-sprint` to scope or narrow the Changelog to fleetd; file the `/plot-reject` and `plot-undeliver.sh:79` defects as their own issue.
12. Add the #2400 repair step from the blind spot, ordered after slice 1 or after auto-deliver is stopped, and before any release.
13. Correct "first delivery 14:19 UTC" to 14:21 UTC; 14:19:47Z is PR #2422's merge.

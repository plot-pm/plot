# Sprint: Plot observes and recovers its own fleet

> Six defects, every one found by operating the fleet rather than by reading it. Four are gaps in what Plot can see or undo about its own agents; two are gates that pass while the thing they guard is broken.

## Status

- **State:** Planning
- **Start:** 2026-09-28
- **End:** 2026-10-12
- **Release:** 2.21.1

## Sprint Goal

**An operator can tell what the fleet is doing, undo what it got wrong, and trust that a gate which reports green actually ran.**

Every item here was found by using the fleet on 2026-09-27/28 — dispatching, reaping, panelling and releasing — not by reading the code. That is the sprint's organising fact: each defect is invisible from a passing test suite, and four of the six were found by an agent or a juror rather than a person.

Three conditions, and all must hold.

**Observable.** A person reading the board can tell a desk the fleet is about to serve from one it has given up on, and a slice handed out twice is visible before an agent's work is lost.

**Recoverable.** Work that exists in one checkout is not removed by a reaper acting on a merge the host reports, and a panel invoked from the board produces a verdict rather than a refusal.

**Honestly gated.** A required check that never runs is not reported as passing, and a plan whose branch the parser cannot read does not read as a plan with no work.

## Must Have

- [ ] [#1035](https://github.com/plot-pm/plot/issues/1035) — **The Interrogate button can never produce a panel.** `composeInterrogatePrompt` (`interrogate.ts:114`) supplies only the subject; `/plot-panel` takes four parameters and its unattended rule refuses when one is missing (`SKILL.md:104`). Measured on its first real use: `202`, then `done`, then no juror files, no moderation, no `Rounds:` increment. The route, the spawn, the status read-back and the button all work — only the prompt is short. **Must, because the capability shipped, was configured this sprint, and produces nothing.**
- [ ] [#1038](https://github.com/plot-pm/plot/issues/1038) — **A commit made after a squash merge is not protected from the reaper.** `desk_unpushed` subtracts the merged head from `rev-list HEAD --not --remotes`; where the desk does not contain that head — a squash merge, or a host answer carrying none — there is nothing to subtract and the host's merge answer is taken as decisive. Found by two delivery jurors who built the worktree and watched `plot-reap.sh` remove it. **Must, because it is the one item here that loses work.**
- [ ] [#1031](https://github.com/plot-pm/plot/issues/1031) — **A backticked branch name in a wave heading parses to zero branches, silently and permissively.** Nothing reads zero branches as *unparseable*: the fleet never dispatches, and `plot-deliver.sh`'s branch gate would pass an unbuilt plan. Four plans written on 2026-09-27 had it and none was caught by a test. **Must, because it fails in the permissive direction and a delivery gate rests on it.**

## Should Have

- [ ] [#1039](https://github.com/plot-pm/plot/issues/1039) — **The only cross-tick assignment lock is the claim ref, and the queue never reads manifests.** `matchQueue` is airtight within a pass and `isAgentFree` closes the window on the agent side, so the remaining candidate needs the manifest write to be slow or to have failed — which is not measured. The structural fact stands: between decision and push, the assignment lives in a manifest nothing in the queue path reads. **Should rather than Must because the measurement that would size it does not exist yet**, and the issue names the two that would settle it.
- [ ] [#1040](https://github.com/plot-pm/plot/issues/1040) — **The release PR's push-triggered `validate` never reports.** All four runs on `changeset-release/main` sit at `action_required`, so the remedy in `ci.yml:16-21` does not work and every release to date has merged with `--admin`. v2.21.0 included, knowingly. It did not bite because the branch was 0 commits behind main and CI was green on the identical tree — luck, not design, and nothing enforces that property. **A required check that has never gated a release is a gate in name only.**
- [ ] [#1041](https://github.com/plot-pm/plot/issues/1041) — **Reporting `idle` from the supervisor's tick needs persistent state the daemon does not have.** The merged half shipped in v2.21.0 (#741), taking a dispatched agent from four resident processes to three. The second half is a design question the brief does not settle: three options, each breaking something the design states explicitly. **This one needs a decision before it needs a plan**, which is why it is not a Must.

## Could Have

- [ ] **Declare a `Tracker` in Plot Config**, so a released plan closes its own issue. Found while scoping this sprint: **7 of 15 open issues had already shipped** — six in v2.21.0 — and stayed open because `plot-issue-status.sh` answers `tracker=none` with no tracker declared. `a-released-plan-tells-its-tracker` is Released and the write path exists; it was never pointed at GitHub. One config key, and the seven were closed by hand on 2026-09-28. **Could rather than Should because it is a configuration change whose blast radius on a live tracker is worth thinking about first.**

## Deferred

- [#1027](https://github.com/plot-pm/plot/issues/1027) — **A dispatch says what it started.** Its plan is Draft, panelled twice, and its own amended text says what remains of it may be a field on #1030 rather than a plan of its own. #1030 shipped in v2.21.0. **Deferred until someone checks whether anything is left**, which the plan's slice is already instructed to do.
- [#1017](https://github.com/plot-pm/plot/issues/1017) — **A scan takes 21-37s on 27 plans.** Its plan (`a-parsed-plan-joins-the-index`) was **rejected** by a panel: the batching it proposed already exists at `plot-fleet-scan.sh:2916`. The symptom was measured correctly and the mechanism was not. **Deferred pending a diagnosis that opens the file.**

## Notes

**Four of six were found by an agent or a juror, not a person.** #1038 by two delivery jurors who built the failing worktree; #1035 by the first real click of a button configured the same evening; #1041 by an implementing agent that declined to improvise and wrote a `PLOT-BLOCKED` question instead; #1031 while verifying four plans I had just written. That is the shape this sprint is named for: the fleet finds its own defects when it is operated, and not when it is read.

**#1038 and #1031 are both failures in the permissive direction.** A reaper that removes a desk it should keep, and a parser that reports no branches where a plan names one. Neither has a test that fails; both are found only by the thing going wrong.

## Scope Changes

- 2026-09-28: Sprint opened with six items, after a reconcile sweep closed seven already-shipped issues (15 open → 8).

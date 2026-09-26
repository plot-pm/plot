# Sprint: Plot works in the repos that adopt it

> Five defects, all found by using Plot in a repository other than this one. Three stop a team outright: `/plot-fleet` cannot run where Plot is a plugin, a healthy Jenkins reports as unauthenticated, and a sprint of lightweight tasks cannot be committed. None is reproducible here, and that is what let them ship.

## Status

- **State:** Active
- **Start:** 2026-09-24
- **End:** 2026-10-08
- **Release:** 2.21.0

## Sprint Goal

**A team adopting Plot in their own repository can run the fleet, read their build status, and commit a sprint — without building Plot, without knowing a config key's parsing rules, and without a refusal that points at the wrong thing.**

Every item here was reported from outside this checkout. That is the sprint's organising fact rather than a coincidence: this repository builds its own board, authenticates its own host, and writes every sprint item as a plan reference, so it exercises none of the paths below. **The defects are not obscure; they are invisible from here.**

Three conditions, and all must hold.

**Runnable.** `/plot-fleet` and `/plot-board-setup` work in a repository that consumes Plot as a plugin. Today the first resolves its artifact against the consumer's checkout and tells them to run a script that does not exist there.

**Legible.** A refusal names the thing that is actually wrong. Two items are refusals that blame the wrong party — a sprint's headings when the problem is its item form, and a juror's verdict when the problem is the caller's argument.

**Separable.** WAITING ON YOU answers one question at a time. Measured on an adopting repository: **18 rows, of which 2 were actionable.**

### Must Have
- [ ] [fleet-control-finds-its-own-artifact](../plans/2026-09-24-fleet-control-finds-its-own-artifact.md) — [#969](https://github.com/plot-pm/plot/issues/969). `plot-fleetctl.sh:89` resolves `plot-registryd.mjs` against the consumer's repo root, so `/plot-fleet` cannot run in any repository that consumes Plot without also building it. Both lines of the error mislead: the artifact is not missing, and the `pnpm build:board` it suggests does not exist there. `plot-boardctl.sh` resolves the same class of artifact correctly, through `plot-board-probe.sh` — so the fix has a working sibling to follow.
- [ ] [the-probe-asks-jenkins-by-its-slug](../plans/2026-09-24-the-probe-asks-jenkins-by-its-slug.md) — [#968](https://github.com/plot-pm/plot/issues/968). `plot-board-probe.sh` hands the whole `Jenkins instance` value to `jen -I` instead of splitting at the first `/`, reporting a correctly authenticating instance as `auth: failed`. The probe's own `job` field is parsed correctly from the same value, so one value is split two ways in one script.
- [ ] [a-broken-caller-is-not-a-hedging-juror](../plans/2026-09-24-a-broken-caller-is-not-a-hedging-juror.md) — [#965](https://github.com/plot-pm/plot/issues/965). `plot-panel.mjs check` given a `|`-separated positions list reports every juror as uncommitted (exit 3) instead of an unusable argument (exit 2), blaming the juror for the caller's mistake. Exit 3 triggers step 4's re-ask, so a broken caller looks like a hedging panel and the re-ask cannot help.
- [ ] [a-burst-keeps-the-states-that-answered](../plans/2026-09-24-a-burst-keeps-the-states-that-answered.md) — [#970](https://github.com/plot-pm/plot/issues/970). A burst refusal on a Bitbucket host discards rows the host **already answered**: the scan reports `secondary`, every branch falls back to local evidence, and none is offered to `--next`, even where per-state calls succeeded before the refusal. Filed 2026-09-24, after this sprint was drafted. Same class as the four above — a Bitbucket estate of 28 branches in one `pr-list`, which this repository's host never produces.
- [ ] [the-fleet-sees-a-plan-on-its-own-branch](../plans/2026-09-24-the-fleet-sees-a-plan-on-its-own-branch.md) — [#972](https://github.com/plot-pm/plot/issues/972). A plan created with `Impl: same branch` is read by the Board tab and invisible to the Fleet tab: `board.ts:810` walks every branch's tree, `plot-fleet-scan.sh:122` enumerates from `origin/<main>` only. **The board already does it right**, dedup included.
- [ ] [a-plan-less-row-is-not-a-nameless-plan](../plans/2026-09-24-a-plan-less-row-is-not-a-nameless-plan.md) — [#973](https://github.com/plot-pm/plot/issues/973). `groupByPlan` keys on `row.plan`, so every plan-less row folds into one group keyed `''`, renders as a nameless `PLAN` head and is counted as a plan — in a section whose hint promises *approved* work. Visible on this repository's board right now.

- [ ] [the-skills-say-slices](../plans/2026-09-15-the-skills-say-slices.md) — [#914](https://github.com/plot-pm/plot/issues/914). The skills say Slices
- [ ] [the-supervisor-log-has-a-ceiling](../plans/2026-09-15-the-supervisor-log-has-a-ceiling.md) — [#916](https://github.com/plot-pm/plot/issues/916). The supervisor log has a ceiling
- [ ] [the-inbox-says-what-it-is-showing](../plans/2026-09-17-the-inbox-says-what-it-is-showing.md) — [#928](https://github.com/plot-pm/plot/issues/928). The inbox says what it is showing
- [ ] [a-released-plan-tells-its-tracker](../plans/2026-09-24-a-released-plan-tells-its-tracker.md) — [#935](https://github.com/plot-pm/plot/issues/935). A released plan tells its tracker
- [ ] [a-stop-that-reports-failure-does-not-exit-zero](../plans/2026-09-24-a-stop-that-reports-failure-does-not-exit-zero.md) — A stop that reports failure does not exit zero
- [ ] [a-supervisor-that-stopped-ticking-is-not-running](../plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md) — A supervisor that stopped ticking is not running
- [x] [adoption-notices-a-stale-default-branch](../plans/2026-09-24-adoption-notices-a-stale-default-branch.md) — [#971](https://github.com/plot-pm/plot/issues/971). Adoption notices a stale default branch
- [x] [the-board-shows-me-only-my-work](../plans/2026-09-24-the-board-shows-me-only-my-work.md) — [#967](https://github.com/plot-pm/plot/issues/967). The board shows me only my work
- [ ] [the-parser-reads-an-assignee-wherever-it-is](../plans/2026-09-24-the-parser-reads-an-assignee-wherever-it-is.md) — The parser reads an assignee wherever it is
- [x] [two-readers-disagree-about-a-sprint-item](../plans/2026-09-24-two-readers-disagree-about-a-sprint-item.md) — [#966](https://github.com/plot-pm/plot/issues/966). Two readers disagree about a sprint item
- [x] [a-merged-pr-is-not-asked-for-its-checks](../plans/2026-09-25-a-merged-pr-is-not-asked-for-its-checks.md) — A merged PR is not asked for its checks
- [x] [a-plugin-install-finds-its-own-scripts](../plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md) — [#980](https://github.com/plot-pm/plot/issues/980). A plugin install finds its own scripts
- [x] [a-record-is-written-where-it-can-be-read](../plans/2026-09-25-a-record-is-written-where-it-can-be-read.md) — [#981](https://github.com/plot-pm/plot/issues/981). A record is written where it can be read
- [x] [a-throttled-host-is-not-a-missing-pr](../plans/2026-09-25-a-throttled-host-is-not-a-missing-pr.md) — [#985](https://github.com/plot-pm/plot/issues/985). A throttled host is not a missing PR
- [x] [one-word-answers-two-questions-about-a-wave](../plans/2026-09-25-one-word-answers-two-questions-about-a-wave.md) — [#994](https://github.com/plot-pm/plot/issues/994). One word answers two questions about a wave

### Should Have

- [ ] [a-stop-that-reports-failure-does-not-exit-zero](../plans/2026-09-24-a-stop-that-reports-failure-does-not-exit-zero.md) — `/plot-fleet --stop` printed *"supervisor did NOT unload"* and exited 0. Panelled 2026-09-24, unanimous `amend`, amended: the mechanism is recorded as undetermined and the fix is correct under all three candidates.
- [ ] [a-supervisor-that-stopped-ticking-is-not-running](../plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md) — `--status` reported `running` over a daemon silent for 25 hours. Panelled the same day; its harm claim was refuted from its own numbers and the plan now records the refutation. Two slices, the second carrying the reading to the board.
- [ ] `feature/one-monitor-watches-the-slice` — **work in flight that no plan names.** 5 commits and 13 code files, pushed 2026-09-24 after sitting unpushed on one laptop for 17 days. Its first half is built: the AgentMonitor and BuildMonitor are one loop, taking a dispatched agent from four resident processes to three. It stopped at a `PLOT-BLOCKED.md` posing a real design question — moving `idle` to the supervisor's tick needs persistent state, which `supervisor.ts:49` names as the one property the daemon does not have. **It owes a plan before it owes code**, and the blocked question is a decision, not an implementation task.

### Could Have

- [ ] Close [#935](https://github.com/plot-pm/plot/issues/935) — its work shipped in 2.19.0 (`a-gate-matches-an-invocation`, PR #942) and the ticket is still open. **Not backlog: a stale tracker entry.** It is listed so the sweep that found it does not have to find it again; closing is one call and needs no plan.
- [ ] [a-released-plan-tells-its-tracker](../plans/2026-09-24-a-released-plan-tells-its-tracker.md) — why #935 stayed open: the tracker write is implemented in both connectors and `plot-host.sh`, and no lifecycle step calls it. Measured 22 released plans naming an issue, one left open. **Could rather than Must, because its own Open Question asks whether one miss justifies a write path** — its first slice answers the same need read-only.

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

**This sprint commits cleanly — an earlier note here predicted otherwise and was wrong.** Tested 2026-09-24 against a sandbox copy: `plot-sprint-state.sh … Committed` exits 0 and writes `State: Committed`. The prediction assumed #966 fires on any item without a `[slug]` plan link; it does not fire on these, because a markdown link of any kind satisfies the parser and every Must here links its issue.

**What #966 actually needs is a BARE item**, and that was reproduced in the same sandbox by varying one thing: `- [ ] rename the deploy step` under a correct `### Must Have` heading is refused with *"names no Must"*, and the identical item written `- [ ] [some-slug](../plans/x.md) — rename the deploy step` commits. The discriminator is the bracket, not the heading the issue's title blames.

**#935 is a Could Have and deliberately not a Must.** It is open on the tracker and its work shipped: `2026-09-17-a-gate-matches-an-invocation.md` is `Released` via PR #942. Making it a Must would arm the release gate against work already done; leaving it out entirely means the next sweep rediscovers it. So it is listed as the one thing it needs — a close.

**None of the five has a plan yet.** Each Must is an issue reference, so `/plot-idea` runs before `/plot-implement` for all of them. #969, #968 and #965 are each diagnosed to a line in their issue body and should be quick; #967 is a design change to a whole section and is the one that could consume the timebox.

**What was checked and left out, so the next sweep need not re-derive it.** Every open ticket (7), every unfinished plan (3), and every remote branch carrying unlanded code (5) were cross-checked against this sprint on 2026-09-24.

- `bug/the-index-is-read-once` — 6 commits ahead and **not** unfinished: PR #948 merged and its plan is Released. A surviving ref, already reported by the reconcile sweep's section 20. It wants `plot-release-refs.sh`, not a sprint item.
- `fork/worktree-plot-skills-impl`, `fork/worktree-plot-skills-review`, `fork/worktree-plot-status-board` — one code file each, named by no plan and carried by no PR. Experiments rather than backlog; a person decides whether they are anything.

### Scope Changes

- 2026-09-24: Added #970 as a Must — filed after this sprint was drafted, same class as the other four.
- 2026-09-24: Added `feature/one-monitor-watches-the-slice` as a Should — work in flight that no plan names.
- 2026-09-24: Added #935 as a Could — a close, not an implementation.
- 2026-09-24: Added [a-released-plan-tells-its-tracker] as a Could — the cause behind #935 staying open.
- 2026-09-24: Five Musts now name plans rather than bare issues (#965, #966, #968, #969, #970).
- 2026-09-24: Added #971, #972, #973 as Musts — filed after the sprint was drafted, same class as the rest.
- 2026-09-24: #967 now names `the-board-shows-me-only-my-work`, which was already a Could. The issue and that plan are one feature found from opposite ends, so the Could entry is removed rather than duplicated — EVERY Must now names a plan.

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

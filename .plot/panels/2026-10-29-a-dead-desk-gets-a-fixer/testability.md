# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2906 (`gh issue view`), DESIGN-delivery-loop.md (*Constraints*, *What exists today*, *The loop*, *A dead or stuck desk*, *Role agents*, *Decided*, *Calls made*), sibling plans #2903 (`a-high-finding-is-fixed-before`), #2898 (`fleet-roles-are-declared-agents`) and #2900 (`fleetd-reviews-every-slice-pr-in`, grep only). Read `rules/fresh-agent.ts`, `ports/fresh-agent-record.ts`, `rules/ending-action.ts`, `rules/agent-state.ts`, `rules/restart-offer.ts`, `rules/dead-claim.ts`, `rules/claim.ts:77`, `workflows/dispatch.ts:36-46`, `workflows/dispatch-verbs.ts:124-260`, `fleet/src/shared/restart-command.ts`, `fleet/src/server/entry/restart-command.ts:37,89`, `board/src/server/restart.ts:68`, `fleet/src/server/entry/registryd.ts:660-663,1139-1196`, `fleet/test/unit/fresh-agent-tick.test.ts`. Ran: domain vitest `rules-ending-action`, `fresh-agent`, `restart-offer`, `dead-claim`, `restart-reads` (5 files, 129 passed); fleet vitest `fresh-agent-tick`, `restart-command` (2 files, 123 passed); one esbuild-bundled probe (`juror-2906-testability/probe.ts`) that calls `endingAction`, `agentState`, `restartOffered` and `restartWorker` on the readings below. Nothing in the plan worktree was changed except this file.

## (a) Problem statement

1. **The decision the plan replaces is not in the files it names.** `rules/fresh-agent.ts:52-75` only composes text (`freshAgentAnswer`), and `ports/fresh-agent-record.ts:4-18` records when a fresh session STARTED, not that it failed. The *second failure asks a person* step is `endingTableAnswer` in `rules/ending-action.ts:347-370`: `priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh'` at :351, :354 and :361, applied by `applyFreshAgentDecisions` → `askAPerson` in `registryd.ts:1175-1177`. "The fresh session failed" is not a recorded fact; it is derived as *a new ending on a slice with `priorFreshSessions > 0`*. The plan must name `ending-action.ts` and `registryd.ts` as the code it changes, or the builder writes a second rule beside `endingAction` and both answer for the same desk.
2. **`needs-a-person` covers more than a failed fresh session.** The probe confirms it answers `needs-a-person` for the second reach of `corrections-spent`, `turn-limit`, `unreadable`/`bound`/`quiet` and after-prompt `holding-work`, and outright (no prior session) for `blocked`, `spend-limit`, `run-limit`, `checks-unanswered`, `unstarted` and `permission-denied`. The plan does not say which rows become *start the fixer*. A fixer on `spend-limit` defeats the budget; `blocked` belongs to #2901's unblocker.
3. **`dispatch.ts:42` is `packages/domain/src/workflows/dispatch.ts:42`**, the `'unattended'` member of the refusal union. The plan's sentence places it after the board path. The refusal itself is `workflows/dispatch-verbs.ts:194-198`. The flag is read in three entries: `board/src/server/restart.ts:68`, `fleet/src/server/entry/restart-command.ts:89`, and passed through `fleet/src/shared/restart-command.ts:41,138`.
4. **The restartable set is four states, not three.** `restart-offer.ts:2` and `restartWorker` accept `stalled`, `failed`, `ended`, `none`. The plan lists three and does not say why `stalled` (uncommitted work on the desk) is left out.

## (b) Approach

1. **The restart rule as written restarts a desk a person stopped.** Probe: a worker stopped by signal (exit `143`, no PR) reads `agentState` = `failed`; `endingAction` answers `leave` for ending `stopped`; `restartWorker` with the refusal lifted answers `worker-start`. The rule's inputs (worker `failed`/`ended`/`none`, no PR, no marker) all hold, so fleetd undoes `plot-dispatch.sh --stop`. The same holds for `spent`, `limited`, and any `needs-a-person` ending after the person removed the marker (`endingAsked` → `leave`). The restart rule must read the ending and act only where no ending exists, or where `endingAction` owns none.
2. **The restart population overlaps `endingAction`'s.** `killedWorkerEnding` (`ending-action.ts:632`) writes `unreadable` for every non-zero exit with no ending, so a `failed` desk already reaches `endingAction` (start-fresh, release-claim, needs-a-person or leave). Two rules on one desk in one tick can start two agents on one branch, which the design's *One writer per branch* forbids. The plan must state the partition: which readings go to `endingAction`, which to `deadClaim` (`dead-claim.ts:31`, claim-only branches), and which to the new restart rule.
3. **Slice 1 duplicates #2903's fourth arm.** #2903 builds *CI red, desk dead or corrections spent → start fixer* in `rules/slice-pr-next.ts`, counted per PR. A failed fresh session after `corrections-spent` with an open PR is exactly that row. Where no PR exists (`turn-limit`, `holding-work`, `unreadable` with a commit and no PR), the fixer role has no PR to commit to (design *Role agents*: "commits on the PR's branch") and #2903's per-PR counter has no key. The plan must say whether slice 1 hands the PR case to #2903's arm and keeps only a non-PR case, or drops the fixer start for the non-PR case.
4. **The refusal lift belongs to #2898.** #2898's slice `feature/fleetd-caller-identity` lifts the unattended refusal of `continue`, `restart` and `merge` for fleetd. This plan describes the same lift; two branches would edit `dispatch-verbs.ts:194`. This plan should only call `restart` with the identity.
5. **No bound on restarts.** `restart-command.ts` appends no record (grep: no `append` or `fresh-agents` in the file), and `endingAction`'s budget counts only fresh sessions. A desk whose worker dies on every start is restarted on every tick. The design's *Stalls* section requires a bound and a notification; the plan has neither.
6. **`RESTART_ANSWER`** (`restart-command.ts:19-20`) tells the new worker "A person restarted this worker". A fleetd restart needs its own text, or the worker reads a false statement.
7. Layering, the shell ratchet and the vocabulary sections are correct as stated: both rules fit `packages/domain/src/rules/`, and the tick already calls through ports (`FreshAgentPorts`).

## (c) Slices

- The cut into two slices is right, but the prerequisites are incomplete. Slice 1 needs #2900 as well (`slice-pr-next.ts` is #2900's), because #2903 depends on it.
- Slice 1 changes a contract that a test holds: `fresh-agent-tick.test.ts:410-425` asserts that every second reach answers `needs-a-person` with a marker. The slice must name that test as changed and keep the outright half of its table.
- The two slices are not independent at runtime. Without the partition in (b)2, slice 2 can restart a desk on which slice 1 starts a fixer.

## (d) Open questions

- **Restart counts as a fixer attempt?** Agree: no. But a restart needs its own count. Add a question: which record bounds restarts, and what notifies the person when it is spent?
- **Which record holds the fixer count?** #2903's per-PR file. That answer only works where a PR exists, so it also decides that slice 1 cannot start a fixer on a desk with no PR.
- **How long with no live worker?** Answerable without a measurement: `ORPHANED_CLAIM_AGE_MS = 60_000` (`claim.ts:77`) is the launch-window bound `deadClaim` already uses for the same race (a claim pushed before the manifest names it). `endingAction` guards the same race with `hasManifest` (`ending-action.ts:27-33`). `Claim stale after` (24 hours) is the reaper's bound and would leave a dead desk for a day. Recommend: reuse `ORPHANED_CLAIM_AGE_MS` plus the `hasManifest` reading, and drop "measure it before approval".
- **Fixer on an `elsewhere` desk?** It cannot arise: the tick's candidates are this machine's worktrees, filtered by `!isMain && !registered && planNamed` (`registryd.ts:660-663`). State that as the answer.
- New: which `needs-a-person` rows become *start the fixer*, and which stay a question (see (a)2)?
- New: does a fleetd restart honour a `stopped` ending (see (b)1)?

## (e) Tests

Both slices are checkable without a live fleet, a live host or a browser. The existing seams take readings as values and actions through fake ports, as the runs above show.

**Slice 1: fixer on a failed fresh session**
- Domain unit, `packages/domain/test/rules-ending-action.test.ts`: a table over `ending` × `priorFreshSessions` ∈ {0, 1} × `fixerAttempts` ∈ {0, 1, 2} × `prOpen` ∈ {true, false, 'unanswerable'}. Assert the new verdict only for the rows the plan names, with `priorFreshSessions: 1` and attempts below 2. Assert `needs-a-person` at 2 attempts. Assert that the six outright endings stay `needs-a-person`. Assert that `endingAsked: true` still answers `leave`.
- Fleet unit, `packages/fleet/test/unit/fresh-agent-tick.test.ts`: `freshAgentDecisions` with the existing reading fixture (`priorFreshSessions: 1`, `ending: 'corrections-spent'`) answers the fixer verdict with an empty `markerText`. `applyFreshAgentDecisions` with fake ports calls the agent-run fake once with role `fixer`, and calls neither `ask` nor the marker write. Amend the table test at :410.
- One-writer test at the fleet unit tier: one tick reading in which `slice-pr-next` (#2903 arm 4) and this rule both see the desk. Assert exactly one fixer start.

**Slice 2: restart of a dead desk**
- Domain unit for the new rule: readings {worker state, ending reason or null, PR reading, marker, `hasManifest`, claim age, prior restarts}. Assert *restart* for `none` and `ended` with no ending, age past `ORPHANED_CLAIM_AGE_MS`, no PR. Assert no restart for: ending `stopped`, `spent`, `limited`; any ending `endingAction` answers for; PR `unanswerable`; age under the bound; `hasManifest: true`; restarts spent. The `stopped` case fails against the plan's rule as written (probe above).
- Domain unit, `restartWorker` (the dispatch-verbs test): unattended with the fleetd caller → `decided` with one `worker-start`; unattended with any other caller → `refused('unattended')`. This belongs to #2898 if the lift moves there.
- Fleet unit, `restart-command.test.ts`: keep the test at :138 (unattended refused); add the fleetd caller case and assert the restart answer text names fleetd, not a person.
- Board unit, `restart-route.test.ts`: the route still refuses under `PLOT_UNATTENDED=1` with no fleetd identity.
- Fleet unit for the tick: fake readers for the PR and process ports; assert one `restartBranch` call per qualifying desk and none on the tick that follows a start.

**Acceptance criteria.** The plan has no acceptance criteria beyond the two changelog lines. Each slice needs a criterion in the form *the rule answers X for readings Y*, so a domain unit test proves it. The step "measure it before approval" is the only item that needs live data; the `ORPHANED_CLAIM_AGE_MS` answer above removes it.

## Amendments

1. Name `rules/ending-action.ts` (`endingTableAnswer`, :347-370) and `registryd.ts` `applyFreshAgentDecisions`/`askAPerson` (:1139-1196) as the code slice 1 changes. Add the fixer as a verdict of `endingAction`, not as a second rule beside it.
2. List the `needs-a-person` rows that become *start the fixer*. Keep the six outright endings as a question.
3. Hand the PR case to #2903's `slice-pr-next` arm 4, and state what happens on a desk with no PR. Add #2900 to the prerequisites.
4. Remove the refusal lift from this plan's scope and cite #2898's `feature/fleetd-caller-identity`. Slice 2 only calls `restart` with the identity.
5. Define the restart rule's readings so that it excludes every desk `endingAction` answers for and every `stopped`, `spent` or `limited` ending. Add a restart bound with its record and a stall notification.
6. Replace the `Claim stale after` recommendation with `ORPHANED_CLAIM_AGE_MS` (`claim.ts:77`) plus `hasManifest`. Answer the `elsewhere` question from `registryd.ts:660-663`.
7. Correct the citation to `workflows/dispatch.ts:42` and `dispatch-verbs.ts:194`. Name the three entries that read `PLOT_UNATTENDED`. Say why `stalled` is left out.
8. Give fleetd's restart its own answer text in place of `RESTART_ANSWER`.
9. Add per-slice acceptance criteria as rule-level statements, and name `fresh-agent-tick.test.ts:410` as a test the slice changes.

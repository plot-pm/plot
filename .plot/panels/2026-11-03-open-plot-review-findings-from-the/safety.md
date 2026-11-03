# Safety juror — open-plot-review-findings-from-the

Position: amend

Lens: what each slice could make the fleet do wrongly that it does not do today (merge, revert, close, discard work, start a second writer, skip a fixer), and which slices must land first or together. Source read at `origin/main` `a518552f1` (the plan cites `321966041`; the lines I checked have not moved materially).

## Summary

The plan fixes real defects, and most of them make the fleet safer. Four slice lines, as written, let an unattended Sonnet agent pick an option that makes the fleet do something dangerous that it does not do today: merge an unreviewed PR, start a fresh agent on a merged desk, close a person's repair PR, revert an innocent PR, or accept an HTTP caller as a person. Each needs one pinned decision in the plan. Two slices (release approval, reviewer role) need a person or a Design phase before an agent builds them.

## Findings

### 1. Merge gate: `bypass` and the opt-in can open fleetd's auto-merge (HIGH risk if built as written)

- `merge()` serves three callers: `person`, `unattended` (refused first, `merge.ts:~180`) and `fleetd` (`packages/fleet/src/shared/auto-merge.ts:170`, `caller: 'fleetd'`). `review-not-passed` (`merge.ts:209-213`) is the last guard between fleetd's merge arm and an unreviewed head.
- `PrReviewReading.bypass` (`ports/host.ts:159-160`) is true when any PR comment starts with `review-bypass:`. Today it only feeds an after-the-fact audit (`rules/review-bypass.ts:36-56`). Any account that can comment can set it, a desk agent with `gh` included.
- The slice line says "`review-not-passed` honours the review opt-in and `bypass`" and names no caller. If an agent applies it to every caller, a desk agent can post `review-bypass:` on its own PR and fleetd merges it unreviewed. The same holds for the opt-in: an estate with `Review required since` absent would let fleetd merge with no review.
- Amendment A1: the relaxation applies to `caller === 'person'` only. `fleetd` keeps the current refusal on every head without `success`. A test asserts `fleetd` + `bypass: true` + `state: absent` still refuses `review-not-passed`.

### 2. Merge gate: the no-retry memory option strands PRs (zero-intervention regression)

- `mergeTick` records refusals in `refused` keyed by (PR, head) for the daemon's life (`auto-merge.ts:~115-117`) and skips that pair on every later pass.
- The slice line offers "or the no-retry memory covers `default-branch-unsettled`". `default-branch-unsettled` is transient: main settles and the same head becomes mergeable. Recorded per (PR, head), fleetd never retries that PR until a new push or a fleetd restart, so a person must intervene.
- Amendment A2: pin the first option (read the tip before `prState`/`prReview` in `mergeAt`, `merge.ts:360-367`). If the memory option is kept, its key must include the default branch's tip and settled SHA, so a settled main clears it. A test: refuse unsettled, then settle main, then the same (PR, head) merges on the next tick.

### 3. Merge gate: the `unknown` bound must not lift a red hold or reach fleetd

- `advanceSettled` keeps the previous settled reading on `unknown` (`rules/default-branch.ts:110-115`), which can be `red` on an older SHA. `merge.ts` checks `settled.state === 'red'` before the tip check, so a red older settled reading refuses `default-branch-red` regardless.
- Risk: an agent "bounds" `unknown` by advancing `settled` to the head as if green. That lifts the red hold for every caller, fleetd's merge arm and the review/repair rules included, and an `unknown` that means "CI queued but not reported yet" becomes a pass.
- Amendment A3: the bound changes only the `default-branch-unsettled` decision in `merge()` for `caller === 'person'`, after `Checks wait` has passed since the head was first read `unknown`. It never writes `settled`, never lifts `default-branch-red`, and never applies to `fleetd`.

### 4. Fixer attempts: positive, with one trap and one race to name

- Positive: today two CI-red attempts exhaust the shared budget (`rules/fixer-attempts.ts:26-37`), and `highArm` then tickets and writes `success` with `ticket-accepted` (`slice-pr-next.ts:~228-231`), after which `mergeArm` merges a head carrying a HIGH that no fixer ever touched. This slice closes a real unsafe merge path. It should land before slice 1 relaxes anything.
- Trap: the record already carries `finding.kind: 'high' | 'ci'` (`entities/fixer-attempts.ts:21-23`), so splitting the count needs no schema change. A `FIXER_ATTEMPTS_VERSION` bump would make every existing record `unreadable`, and `fixerInFlight` reads `unreadable` as in flight (`fixer-attempts.ts` `fixerInFlight`), so every PR with a record holds `fixer-in-flight` forever and nothing merges. Amendment A4: the slice keeps the record version and counts by `finding.kind`; a test decodes a record written by the current schema.
- Race: "give a red head that a fixer pushed to the fixer arm" relaxes the "desk gone" precondition in `ciRedArm` (`slice-pr-next.ts:264-266`). `deskDeadFromWorkerState` maps `elsewhere` to not-dead (`auto-fixer.ts:163-174`); `elsewhere` means the desk may run on another machine. Amendment A5: the new condition is "the fixer-attempts record names this exact `headSha` as a fixer's push and no fixer is in flight". It never reads `elsewhere` or `live` as gone. A test: red head pushed by the desk (not in the record) with desk `elsewhere` still answers `none('desk-alive')`.
- Moving `restatusArm` after `highArm` (`slice-pr-next.ts:385`): safe direction; the arm order docstring at `:372-376` must change with it.

### 5. Red main: two options with different blast radius; the revert re-ask must not weaken

- `close-prs` is destructive: `closePrs` (`revert-start.ts:400-430`) closes the PRs named as `repairPr` and `revertPr`, a person's recorded fix included, and records `done`. The slice line offers "reads the settled state before `close-prs`, or the refresh opens a new episode". The second option replaces the record and drops a person's `repairPr` (`keepsRepairRecord` docstring, `rules/repair-pr.ts:190-207`).
- Amendment A6: pin the first option. `redMainStep` answers `close-prs` from a green re-run only while the current settled reading is green; with a green re-run of `firstRedSha` and a red settled reading on a later SHA it answers a repair step and closes nothing. A test asserts no `prClose` call in that case.
- Revert re-ask (`revert-start.ts:335`): the re-ask of `firstRedSha` is what stops a revert of a PR whose red was a flake. The breaking PR is picked from `firstRedSha`. Replacing that re-ask with a re-ask of the settled SHA lets the fleet revert an innocent PR when a later commit broke main. Amendment A7: re-ask both, and revert only when both read red; a test with `firstRedSha` green on re-run and settled red asserts no revert PR.
- Revert branch number: the docstring says "the record holds no number for the reverted PR" (`repair-pr.ts:31-33`), but `RepairRecord.revertedPr` exists (`entities/repair-record.ts:136`) and `revert-start.ts` writes it. The plan should say so, so the agent compares `bug/revert-<n>` with `revertedPr` and fixes the stale docstring. The check must refuse (`repair-branch-mismatch`) when `revertedPr` is absent rather than fall back to the shape check. Note: the plan's own threat ("a process that writes the record chooses the branch") is not closed by this, because `revertedPr` lives in the same record; the plan should state that the slice narrows the shape, not the trust boundary.

### 6. Desk endings: the obvious fix starts a fresh agent on a merged desk (HIGH risk if built as written)

- `endingTableAnswer` (`ending-action.ts:350-353`): with `holding-work`, if the `merged && dirtyTree === 'no'` guard fails, it falls through to `start-fresh` when `priorFreshSessions === 0`.
- The slice line says "the merge guard also requires no commit ahead of upstream". Built literally, a merged PR plus an unpushed commit now answers `start-fresh`: a fresh agent on a desk whose PR merged, which can push the stale commit and open a second PR. That is the #2925 HIGH class (a finished desk gets a fresh agent) that `c78164a5a` guards against.
- Amendment A8: merged plus unpushed commit (or merged plus an unanswerable upstream reading, which is common because merged branches lose their remote ref) answers `needs-a-person`, never `start-fresh` and never `leave`. `EndingActionReadings` has no unpushed field today (`ending-action.ts:19-116`); the slice adds one, and `unanswerable` must ask a person. The fleet test asserts `needs-a-person` and no new agent.

### 7. Release approval: two changes need a person, one widens a hole

- Board caller: `deliver.ts:791` and `restart.ts:70` derive the caller from the board's own `PLOT_UNATTENDED`. HTTP carries no identity. The controller gate allows a desk's own calls (`board/src/server/entry/gate.ts:~932`, "a linked worktree (a desk) is a worker's own call and is allowed"). "Pass the clicking person as caller" with no mechanism means any POST to a fleetd-started board is a `person`, so an unattended desk agent with `curl` can release or restart. Today the unattended board refuses that. A person must choose the identity mechanism (for example a per-board token only the served page holds) before an agent builds it, or the slice drops this LOW.
- `release-approve` refusal of a master agent: `Caller` is `'person' | 'unattended' | 'fleetd'` (`workflows/decision.ts:23`). Nothing distinguishes a master agent from a person. This is the plan's open question 2 and belongs to a person; an agent cannot build an enforcement with no signal.
- `releaseFinish` booking plans outside the sprint is a `State:` write. Deciding that a plan's changesets "ship under the tag" needs the optional `plan:` link or a Frontier semantic match. Amendment A9: book only plans named by a changeset's `plan:` line; name every other candidate and book nothing for it.

### 8. Reviewer role: a failure here stops every merge

- `review-not-passed` refuses every head without `success`. If the reviewer stops starting after the move onto the role builder (`review.ts:345`), no PR merges and the sprint stalls with no refusal that names the cause. Open question 3 is right: this slice needs a Design phase, and its test must prove a review run still writes `plot/review` on a head end to end.

### 9. Low-risk slices

- Idle slice, plan comment, review comment tests: no merge, revert, close or discard path. The `\r\n`, lock and atomic-write fixes move in the safe direction. `finishReview` posting for a second `ReviewIssueDecision` value changes only a comment.

## Ordering

The plan says "the reader decides whether to order them". For safety the plan should decide:

1. `bug/a-high-gets-its-own-fixer-attempts` lands before `bug/the-merge-gate-reads-adoption`. Relaxing the merge gate while a HIGH can still be ticket-accepted with no fixer run widens an unsafe merge path.
2. `bug/a-red-main-stays-acted-on` lands as one PR: the `close-prs` guard and the revert re-ask change touch the same episode and must be reviewed together.
3. `feature/the-reviewer-is-a-role-agent` waits for Design and lands alone, after the merge gate slice, so a broken reviewer is not confused with a gate change.
4. The board-caller part of `bug/the-release-books-what-it-ships` waits for a person's decision.

Add `waits:` markers for 1 and 3.

## Required amendments

- A1: `bypass` and the opt-in relax `review-not-passed` for `person` only; fleetd unchanged; test included.
- A2: pin "tip read first"; or key the memory by main's tip; test that a settled main lets the same head merge.
- A3: the `unknown` bound affects only `default-branch-unsettled` for `person`, never writes `settled`, never lifts red.
- A4: no fixer-attempts version bump; count by `finding.kind`.
- A5: a fixer-pushed head is proven from the record's `headSha`; `elsewhere`/`live` never read as gone.
- A6: pin the "read settled state before `close-prs`" option; no `prClose` while settled is red.
- A7: the revert re-asks both `firstRedSha` and the settled SHA.
- A8: merged plus unpushed (or unanswerable) answers `needs-a-person`.
- A9: `releaseFinish` books only `plan:`-linked plans; names the rest.
- Ordering and `waits:` markers as above.

## Decisions for a person

- Open question 1: resolved by A1 for safety; the person still chooses opt-in key, `bypass`, or both, for the person caller.
- Open question 2: whether `release-approve` can tell a master agent from a person at all; no signal exists today.
- Board caller identity mechanism for `POST /api/release` and `/api/restart`.
- Open question 3: yes, Design phase for the reviewer role slice.

## What I ran versus read

- Ran: `git fetch origin main`; `git show origin/main:<file>` excerpts of `merge.ts`, `ports/host.ts`, `rules/review-bypass.ts`, `rules/default-branch.ts`, `auto-merge.ts`, `slice-pr-next.ts`, `rules/fixer-attempts.ts`, `entities/fixer-attempts.ts`, `auto-fixer.ts`, `rules/repair.ts`, `rules/repair-pr.ts`, `revert-start.ts`, `ending-action.ts`, `agent-loop.ts`, `plot-worker-state.sh`, `board/.../deliver.ts`, `restart.ts`, `gate.ts`, `controller-gate.ts`; `git grep` for `bypass`, `caller:`, `close-prs`, `revertedPr`, `PLOT_UNATTENDED`; `gh issue view 3069` (title only).
- Read only: the plan and the brief. I ran no test, no build, and no fleet, board or host write command. The failure scenarios above are reasoned from the source, not executed.

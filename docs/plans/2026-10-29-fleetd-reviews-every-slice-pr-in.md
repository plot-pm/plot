# fleetd reviews every slice PR in the sprint

> fleetd starts `plot-review` on every green slice PR of the active sprint whose head has no review, and a review opens no follow-up issue for any finding: every finding goes into one marked PR comment.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2900
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2917 merged
- **Started:** 2026-10-29, Jan Wloka, `feature/a-review-opens-no-issue`
- **Started:** 2026-10-30, Jan Wloka, `feature/the-index-records-the-review`
- **Started:** 2026-10-30, Jan Wloka, `feature/the-scope-is-read-from-git`
- **Started:** 2026-10-30, Jan Wloka, `feature/the-review-run-is-locked`

## Changelog

- `plot-review` opens no follow-up issue for any finding. It writes every finding, HIGH included, into one marked comment per PR and edits that comment on each new head. The 22 findings issues open on 2026-10-29 stay open.
- On Bitbucket, where a PR comment cannot be written, `plot-review` keeps the findings in its local verdict file and says so in its output.
- Two `plot-review` runs on one PR head cannot both run: the second refuses before it touches a file of the first. A run writes `plot/review=pending` with its run id at the start and writes its final status only while its own `pending` is the newest. No run replaces a `failure` on the same head.
- The PR index records, per open PR on the GitHub rollup arm, the `plot/review` state, the commit it names and its start time, and a CI colour that leaves `plot/review` out. fleetd re-asks a green PR whose review is missing or pending, so a written status reaches the index within one re-ask.
- fleetd reads the delivery scope from the active sprint file on `origin/<default>`: a person's scope change adds or removes plans, and a struck item drops out. Zero or two active sprints give no scope, and fleetd starts no review.
- With `Auto-review: true`, fleetd starts `plot-review` on every open slice PR of the scope whose CI is green on its head and whose head has no review. It starts at most one review per head, at most three per head with backoff, and keeps the count across restarts.

<!-- Board impact: the PR index row gains `plotReview`, `plotReviewSha`, `plotReviewAt` and `ciChecks` under a `PR_INDEX_VERSION` bump from 5 to 6; board readers of the index decode the new version, and the existing `checks` and `review` fields keep their meaning. The plan format, template and docs/plans layout do not change. The sprint parser `sprintFrom` moves from the board into the domain; the board keeps its callers on the moved function. -->

## Motivation

No slice PR merges into `main` without a `plot/review` status: the ruleset requires it since 2026-10-15 and pins it to the `Review app` (integration 5317669). Only a master agent runs `plot-review` today, and no file under `packages/fleet/src` names it. From 2026-10-16 to 2026-10-29 the master agent ran every review from a watcher script. When that session ends, no PR gets a review and delivery stops. [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka, 2026-10-29) gives this step to fleetd. Sections: *The scope*, *The loop*, *Tickets*. The decisions below correct two of its claims: the scope moves with a person's scope change, and a HIGH ticket exists only after the fixer attempts.

The panel of round 1 measured four facts that the first draft did not name:

1. **A review opens an issue for every severity, HIGH included.** The decision is `review.ts:486` (`if (findings !== 0)`, where `findings` counts HIGH, MEDIUM and LOW) and the writer is `openFollowUp` at `review.ts:269`. The TSDoc at `review.ts:57-68` describes it. The design says a HIGH ticket exists only after the fixer attempts fail, so the review-time issue for HIGH also goes.
2. **The PR index holds no review record, and its CI colour already contains the review.** `PrIndexRow.review` (`packages/domain/src/entities/pr-index.ts:41`) is GitHub's `reviewDecision`, empty on all 1023 rows of the live index (v5). `plot/review` is a status context that `checks_of` folds into `checks` with every other rollup entry (`skills/plot/scripts/plot-host.sh:702-707`). Executed on sample rollups: a HIGH review reads `checks: failing`, and "no review" and "review success" both read `green`. So the index cannot tell CI red from a HIGH, nor an unreviewed head from a clean one. The only per-head reading today is `Host.prReview` (`packages/domain/src/ports/host.ts:408`), one host call per PR, which *A Decision Reads The Index* keeps out of a decision.
3. **The reviewer cannot start as a bare `agent-run` call.** `reviewPr` (`packages/board/src/server/entry/review.ts:395`) re-asks the head, builds the worktree, writes the diff, runs the agent for up to `REVIEW_BOUND_SECONDS = 3600` (`review.ts:100`), parses the verdict and writes the status. A tick that called `agentRun` directly would write no status and would wait up to an hour. `reviewPr` lives in the board package, and `@plot-pm/fleet` depends only on `@plot-pm/domain`. auto-verify solves the decision half of the same shape: `verifyStart` (`packages/domain/src/rules/auto-verify.ts:162`) decides, and an in-flight file (`packages/fleet/src/shared/auto-verify.ts:153`) marks the run. Its start does not fit: `startBoardRun` (`packages/fleet/src/shared/board-run.ts:184`) starts a board **role** through `agentRun` (`board-run.ts:170-171`) and refuses under `leaveBoardRunsToTheBoard` (`board-run.ts:199-205`). It starts no node entry such as `plot-review.mjs`.
4. **Two reviews of one head corrupt the first.** Executed: the second run removes the first run's verdict and diff files (`review.ts:424-425`) before its worktree add refuses (`review.ts:430-431`). The first reviewer then has no diff to read, and a diff over 98,304 bytes lives only in that file, yet it can still write `success`. The status is last-writer-wins per context and SHA (`host.ts:122-130`, `CommitStatusWrite`), so a later run can replace a HIGH `failure` with `success`. A run that writes no status (a failed write, a refused verdict, a leftover worktree) reads as "no review" on the next pass and starts another full review every pass.

The panel of round 2 measured three more:

5. **A written status does not reach the index.** A completed check does not move `updatedAt` (`packages/fleet/src/shared/pr-refresh.ts:1618-1622`), and a delta re-asks only open rows stored `pending` or `failing` (`pendingOpenPrNumbers`, `packages/domain/src/rules/pr-index.ts:295-301`). A head waiting for review folds to `green`, so its row is not re-asked, and the reviewer's `pending` and `success` stay out of the index until the next full read, up to `PR_FULL_READ_MS` = 24 h (`pr-refresh.ts:348`). The review arm would then start a review on every pass, and #2902's merge arm would never see `success`.
6. **The run id is not in the rollup.** The rollup's `StatusContext` carries `context`, `state`, `startedAt` and `targetUrl` and no description (read on merged PR #2895). `PrReviewReading` (`host.ts:143-150`) carries `sha`, `state` and `bypass` and no description or time. Only a widened per-PR `Host.prReview` can read a run id back.
7. **The GitHub + Jenkins arm requests no rollup.** `plot-host.sh:4744-4749`: on `CI: jenkins` the GitHub `pr-list` does not request `statusCheckRollup`, and `checksSha` is absent for Jenkins, the plain listing and Bitbucket (`pr-index.ts:75-79`). `merge()` already refuses a colour that names no commit (`checks-unbound`, `packages/domain/src/workflows/merge.ts:114-116`).

The scope, measured: sprint `follow-ups-2-29-1` held 2 plans at its `sprint: start` commit `f92415d23` and 11 at close, added by three `sprint: scope change` commits a person made. A freeze at the start commit would have kept 2 of 11, and 9 delivered plans would have had no fleet review.

## Design

### Approach

The spec's *Decided* and *Calls made* lists bind this plan where the decisions below do not correct them.

- **No issue at review time.** `reviewPr` opens no follow-up issue for any severity. Every finding goes into the one marked PR comment: `findingsMarker(pr)` (`review.ts:358`) with `Host.prComment(pr, body, marker)` edits one comment per PR in place (`host.ts:376-397`, covered at `review.test.ts:608`), and the body names the head and the run. The decision "which findings open an issue" goes into `rules/review-issue.ts` as a pure function `reviewIssue(counts: ReviewCounts)` that answers `none` for every count. The file's existing exports `reviewIssueTitle`, `findOpenReviewIssue` and `REVIEW_ISSUE_LABEL` (`rules/review-issue.ts:4-32`) stay for #2903's ticket and get no new caller here. A recorded `<pr>-<sha>.issue` from an earlier run gets no further comment. Exit code 4 (`EXIT.issueNotOpened`) then means only "findings not posted". A HIGH still writes `failure`, which blocks the merge until #2903 fixes it or tickets it. No path this plan adds writes `failure` for anything but a HIGH (`review.ts:494`).
- **Bitbucket.** `pr-comment` exits 4 on Bitbucket (`plot-host.sh:6061`), and `prComment` answers `unaskable` (`packages/domain/src/adapters/host/host-shell.ts:505-512`). There the findings stay in the local verdict file, and the output line at `review.ts:506` names that file. The status description says the findings were not posted.
- **The review run lock.** `reviewPr` takes an exclusive lock `<common git dir>/plot/state/reviews/<pr>-<sha>.lock` before its first `removeFile` (`review.ts:424`) and releases it after the status write. The lock is written whole and published with `link`, because `wx` alone publishes the name before the content (measured at `packages/domain/src/adapters/slots/slots-file.ts:157-162`). The lock holds the run's pid and run id. A second run on the same PR and head refuses `review-running` and touches no file. A lock whose pid is dead is moved aside and the take is tried once more, and a leftover review worktree with no live lock owner is removed before the next start. Every run, a person's included, takes the lock, so no caller identity is needed.
- **The run id and the newest pending.** After the lock, `reviewPr` writes `plot/review=pending` on the head with the description `run <run id>`. Before the final write it re-asks `Host.prReview`, widened to carry the newest `plot/review` description and its time. It writes the final status only while the newest `plot/review` on the head is `pending` with its own run id; a superseded run writes nothing and says so. No `reviewPr` replaces a `failure` on the same head, whoever runs it. A person overrides a `failure` through #2903's accepted `success` or the existing `review-bypass:` comment.
- **The re-status run.** `plot-review.mjs <pr> --status-only` takes the same lock, reads the verdict file `reviews/<pr>-<sha>.md` through `reviewVerdict` (`packages/domain/src/rules/review-verdict.ts:27`), and writes the status from it under the same two guards. It starts no agent. This is the run for a head whose verdict file exists (written at `review.ts:472`) but whose status write failed (`review.ts:512`).
- **The review in the index.** `pr-refresh.ts`, the index's one writer, stores four new optional fields per open row under a `PR_INDEX_VERSION` bump from 5 to 6 (`pr-index.ts:12`). See *Index fields*. `checks` keeps `plot/review` in its fold, because `pendingOpenPrNumbers` and every reader of `checks` key on it. On the plain GitHub arm the rich `pr-list` already requests `statusCheckRollup` (`plot-host.sh:4798`), so the fields ride the same call.
- **The re-ask.** A new rule `reviewReaskPrNumbers(held, branches)` in `rules/pr-index.ts` answers the open, non-draft rows on the scope's slice branches whose `ciChecks` is `green` on `checksSha === headSha` and whose `plotReview` is `absent`, `pending`, or names an older SHA. The delta pass unions it with `pendingOpenPrNumbers` (`pr-refresh.ts:1628`) under the same streak bound (`PR_PENDING_REASK_LIMIT = 5`, `pr-refresh.ts:281`) and slow cadence (`PR_PENDING_REASK_SLOW_MS`, `pr-refresh.ts:284`). The re-ask is the one `pr-list --rich --state open` call the pass already makes (`pr-refresh.ts:1654`), so a re-asked number adds no request. The reviewer's `pending` and its final status reach the index within one re-ask.
- **Jenkins and Bitbucket.** On the GitHub + `CI: jenkins` arm and on Bitbucket the writer stores no `plotReview` fields ("not asked") and no `checksSha`, and `ciChecks` equals `checks`, which holds no `plot/review` there. The review arm answers `none` with the reason `checks-unbound` on such a row, as `merge()` refuses one (`merge.ts:114-116`). This plan makes no per-row `pr-review` call, so it adds no Bitbucket request.
- **The scope reader.** See *Scope answer*. A pure domain rule `sprintScope` reads the active sprint file's text from `origin/<default>` and answers a discriminated union. An adapter reads the text from git. The sprint parser `sprintFrom` moves from `packages/board/src/server/entry/sprint-transition.ts:162` into the domain beside `sprintMembers` (`packages/domain/src/entities/sprint.ts:150`), and the board keeps its callers. The reader adds no third parser: `parseSprintContent` (`packages/board/src/server/board.ts:1597`) stays the board's card parse, and `sprintReleaseFactsShell` (`packages/domain/src/adapters/sprint-release.ts:18`) stays the release collector, which reads the working tree, not a ref. No state file holds the scope.
- **`rules/slice-pr-next.ts`.** See *Next-step rule*. This plan creates the file, fixes its input record and step union, owns the composition order of every arm, and builds the guard, the review-run, re-status and review arms.
- **The desk reading.** A new rule `deskDead(readings)` in `rules/desk-dead.ts` answers whether a slice's desk is dead. It reads the same values as `agentState` (`packages/domain/src/rules/agent-state.ts:62-136`) and answers `{ dead: true }` or `{ dead: false, why }` with `why` one of `live`, `waiting`, `elsewhere` or `unread`. A desk that holds a `PLOT-BLOCKED` marker answers `waiting` and is not dead. A desk on another machine answers `elsewhere` and is not dead. A failed read answers `unread`, which holds. #2901, #2903 and #2906 read this one rule and define no copy.
- **The start.** A new adapter `adapters/review-start/review-start-node.ts` exports `startReview(pr, head, opts)`. It starts `plot-review.mjs <pr>` (or `--status-only`) through the existing `Detached` port (`packages/domain/src/ports/detached.ts:10`, `detachedNode` at `adapters/detached/detached-node.ts:10`) and writes the in-flight entry `{ pr, head, pid, startedAt, mode }` to `.plot/state/review-in-flight.json`. Its refusals are `review-in-flight` (a live entry for the same PR and head), `at-capacity` (the concurrency bound, counted against fleet headroom as `verifyStart` counts) and `start-failed`. A liveness reading `reviewRunLive(entry, pidLiveness, now)` answers live for a live pid, or for a dead pid younger than a start grace of 30 s. The review needs its own liveness reading because it starts a node entry, not a role; #2898's role liveness reading does not see it. #2907 starts the release PR's review through `startReview`, not through #2898's role start.
- **The start budget.** A per-head start record `{ pr, head, count, lastAt }` lives in `.plot/state/review-starts.json`, so a fleetd restart keeps it. A head gets at most 3 starts; the second waits 15 min after the first, the third 60 min after the second. Past the budget the rule answers `none` with the reason `budget-spent`, and the head stays as the last run left it. #2899's idle-slice rule (`feature/an-idle-slice-notifies`) is the only signal a person gets for such a head; this plan writes no run-log line.
- **`Auto-review`.** A config key `Auto-review` (default `false`) turns the review arm on. With it off, the rule answers `none` with the reason `auto-review-off`.
- **The decision reads the index** (*A Decision Reads The Index*): the rule reads stored rows and local records and calls no host. `reviewPr` re-asks the head and its `plot/review` before it starts and before it writes, so the index selects and the controller confirms. See *Index paragraph*.

### Index fields

`PrIndexRow` (`pr-index.ts`) gains four optional fields. `review` stays GitHub's `reviewDecision`.

| Field | Values | Meaning |
|---|---|---|
| `plotReview` | `success` · `failure` · `pending` · `error` · `absent` | The newest `plot/review` state in the rollup. `absent` means "asked, no `plot/review` status". The field missing means "not asked". |
| `plotReviewSha` | a commit SHA | The commit the rollup names for `plot/review`. Missing with `plotReview: absent`. |
| `plotReviewAt` | ISO time | The `StatusContext.startedAt` of that status. The rule reads a `pending` older than `REVIEW_BOUND_SECONDS` as not in flight. |
| `ciChecks` | `green` · `pending` · `failing` · `none` · `unknown` | The rollup folded as `checks_of` folds it, without the `plot/review` context. Bound to `checksSha`. A head with only `plot/review` and no CI run reads `none` and gets no review. |

A row that the writer could not ask, or an adapter that answers no rollup, carries none of the four fields, and every arm reads it as "not asked". A failed or partial read never writes `absent`.

### Scope answer

`sprintScope(input)` answers `{ read: 'scope', sprint, slugs, branches }` or `{ read: 'none', why }`.

- **The ref.** The adapter reads `refs/remotes/origin/<default>` as fleetd's last fetch left it: `git ls-tree` over the `Sprint directory` config's `active/` index, then `git show` of the one active sprint file. fleetd's local checkout is never read.
- **The slugs.** The plan slugs of every MoSCoW item that is not struck (`~~`), through `sprintFrom` and `sprintMembers`.
- **The branches.** A PR branch maps to a scope plan through the fleet pulse: `FleetReading.plans[].slices[].branches[].branch` (`packages/domain/src/entities/fleet.ts:175,773`) of each plan whose slug is in `slugs`. A branch that no scope plan names is not in the scope.
- **No scope.** Zero active sprints, two or more active sprints (the same rule `plot-sprint-release.sh:4-5` keeps), an unreadable ref or file, and a sprint with no unstruck item each answer `none` with a `why`. #2907's "every scope plan is Delivered" reads `none` as "hold", never as an empty scope that is vacuously delivered. fleetd logs the `why` once per change of answer.

### Next-step rule

`slicePrNext(readings: SlicePrReadings): SlicePrStep` answers one step per open PR.

**The input record.** Fields marked with a plan number are optional until that plan builds its arm; once built, the tick always passes them.

| Field | Type | Source |
|---|---|---|
| `row` | `PrIndexRow \| null` | this PR's OPEN row; `null` for a missing or undecodable store |
| `newestMerged` | `{ mergedAt } \| null` | the newest MERGED row of the index, for #2902's `merge-in-flight` hold |
| `scope` | the *Scope answer* | `sprintScope` |
| `reviewRun` | `{ head, pid, startedAt, live } \| null` | `review-in-flight.json` with `reviewRunLive` |
| `reviewStarts` | `{ head, count, lastAt } \| null` | `review-starts.json` |
| `verdict` | `{ read: 'verdict', state, description } \| { read: 'absent' } \| { read: 'unread' }` | `reviews/<pr>-<headSha>.md` through `reviewVerdict` |
| `defaultBranch` | `DefaultBranchReading \| null` | `.plot/state/default-branch.json` |
| `desk` | the `deskDead` answer | `rules/desk-dead.ts` |
| `fixer` (#2903) | the attempts record with its in-flight mark, or `unread` | #2903's `feature/the-fixer-attempts-record` |
| `ticket` (#2903) | the ticket record, or `unread` | #2903's `feature/an-unfixed-high-is-ticketed` |
| `repair` (#2904) | the repair record, or `unread` | #2904's `feature/the-repair-record` |
| `config` | `{ autoReview, reviewBoundMs, startBudget, checksWaitMs }` | `## Plot Config` and constants |
| `now` | epoch ms | the tick |

**The step union.**

- `{ step: 'none', why }`
- `{ step: 'review', head }`
- `{ step: 'write-status', head, state, description, why: 'verdict-unwritten' | 'ticket-accepted' }`
- `{ step: 'merge', head }`
- `{ step: 'hold', reason }`, with `reason` an open string set: `review-in-flight`, `fixer-in-flight`, `ci-red-attempts-spent`, `default-branch-red`, `default-branch-stale`, `default-branch-unread`, `merge-in-flight`, `conflicting`, and `unread` for any sibling field that reads `unread`
- `{ step: 'fixer', head, evidence: 'high' | 'ci-red' }`
- `{ step: 'ticket', head }`

**The composition order.** Each arm is an exported function with its own test file. `slicePrNext` calls them in this order and returns the first answer that is not `none`; with no answer it returns the guard's `none`.

1. **Guard** (#2900): `row` is `null`, not OPEN or a draft; `scope` reads `none`; or the branch is not in `scope.branches` → `none` with that `why`.
2. **Review run** (#2900): `reviewRun` is live on `headSha` → hold `review-in-flight`.
3. **Re-status** (#2900): `verdict` reads a verdict, and `plotReview` is not that state on `headSha` → `write-status` `verdict-unwritten`.
4. **Fixer in flight** (#2903 arm 3) → hold `fixer-in-flight`.
5. **HIGH** (#2903 arms 1, 4, 5) → `fixer` with `high`, `ticket`, or `write-status` `ticket-accepted`.
6. **CI red** (#2903 arms 2, 7) → `fixer` with `ci-red` when `desk` reads dead or corrections are spent, or hold `ci-red-attempts-spent`.
7. **Review** (#2900) → `review`, as below.
8. **Merge** (#2902, with #2904's repair exception inside it) → `merge`, or hold with #2902's reasons.

The order follows one principle: an arm that writes or holds on the current head comes before an arm that starts new work on it. A live fixer makes the head temporary, so step 4 comes before the review. Merge comes last, because it needs `success` on the head, and every earlier arm answers only on a head without one. A red or stale default branch holds merges and never holds a review.

**The review arm.** It answers `review` when all of these hold, and `none` with the first failed reason otherwise: `config.autoReview` (`auto-review-off`); `plotReview` is present (`not-asked`); `ciChecks` is `green` and `checksSha` equals `headSha` (`checks-unbound` or `ci-not-green`); `plotReview` is `absent` or `error`, names an older SHA, or is a `pending` whose `plotReviewAt` is older than `reviewBoundMs` (`reviewed`); `verdict` reads `absent` (`verdict-unwritten` is step 3's); `reviewStarts` for this head is under `startBudget` and past its backoff (`budget-spent`, `backoff`). A `null` store and a row with no `plotReview` both answer `none`, because the index never says no.

### Index paragraph

This plan adds this paragraph to CLAUDE.md's *A Decision Reads The Index*, in `feature/fleetd-reviews-slice-prs`:

> **One rule reads a non-terminal answer from the index to select, and a controller confirms it: the review arm.** `slicePrNext` (`packages/domain/src/rules/slice-pr-next.ts`) reads `plotReview`, `plotReviewSha`, `plotReviewAt` and `ciChecks` from the OPEN row to choose which PR gets a review. These answers are not terminal: a review written after the row's read leaves it stale. Three things bound that. The delta re-asks every open in-scope row whose CI is green and whose review is absent or pending on its head (`reviewReaskPrNumbers`), so a written status reaches the store within one re-ask. A row whose review was never asked carries no review field and selects nothing, so the index never says "no review". And `reviewPr` re-asks the head and its `plot/review` before it starts and before it writes, so a stale row costs one refused start and never a second writer. #2902's merge arm and #2903's HIGH arms read the same fields under the same bound, and their controllers re-ask the host before they act.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-fleetd-reviews-every-slice-pr-in/panel.md`):

- [x] D1 Refusals: `plot-review.mjs` is not one of the refused controllers, and this plan builds no caller identity. The `caller` reading and the `merge`, `continue` and `release` refusals are #2898's (`feature/unattended-callers-are-refused`).
- [x] D2 HIGH route: a review opens no issue for any severity. Every HIGH goes to a fixer, two attempts per PR, and only then to a ticket; both are #2903's. Between this plan and #2903, a HIGH holds the PR at `plot/review=failure` with no ticket, which is the safe side.
- [x] D3 Scope: the scope is the active sprint file read from git at its latest commit. A person's `sprint: scope change` commit moves the scope; nothing else does. Struck items drop out. No state file.
- [x] D4 Merger app: fleetd merges on GitHub only as the declared `Merger app`, never through the ruleset's `always` bypass actors (the admin role and integration 5173644). The merge and the armed auto-merge case are #2902's; this plan writes the status #2902 reads.
- [x] D5 Role form: the reviewer's definition and per-role settings are #2898's (`feature/role-agent-definitions`), loaded from the default branch's copy. This plan starts `plot-review.mjs`, which runs the reviewer through the runner #2898 changes. `reviewPr` creates the review worktree (`review.ts:430`).
- [x] Slice order: Tickets, then the index, then the scope, then the run lock, then the rule and the start, so no unscoped review runs, no review opens an issue at fleet volume, and no fleet start runs before two runs of one head exclude each other.
- [x] Open question 2 (one comment or one per head): one marked comment per PR, edited per head, through the existing `findingsMarker` and `prComment`.

A second panel round ran on 2026-10-29 (`r2-safety.md`, `r2-seams.md`, both `amend`). Folded from it:

- [x] The re-ask: the delta re-asks green open in-scope rows whose review is absent or pending, so the index receives the review status. The new fields are `plotReview`, `plotReviewSha`, `plotReviewAt` and `ciChecks`; `checks` and `review` keep their meaning. "Not asked" (field missing) stays apart from "asked, no review" (`absent`).
- [x] The lock and both guards (newest own `pending`, no `failure` replaced) apply to every caller and get their own slice, `feature/the-review-run-is-locked`, before the review start.
- [x] The start budget lives in `.plot/state/review-starts.json`; the verdict file is an input and `write-status` a step.
- [x] `slicePrNext` publishes its input record, its step union with `write-status` and a `hold` reason, and the composition order of every arm, siblings' included.
- [x] `deskDead` is the one named desk reading, with a `PLOT-BLOCKED` marker reading `waiting`.
- [x] The scope answer is a discriminated union read from `origin/<default>`, and `none` holds #2907.
- [x] The start is a new adapter export `startReview` over the `Detached` port; `startBoardRun` starts an agent role and is not used.
- [x] GitHub + Jenkins and Bitbucket store no review fields and answer `checks-unbound`, so this plan reviews on the GitHub rollup arm only.

### Open Questions

- [ ] `plot-review-status.sh` answers `needs_review` per sprint item from a sprint annotation `review_sha` and `git ls-remote`, a second review record beside `plot/review`. Does `feature/fleetd-reviews-slice-prs` shrink it to a launcher that asks `slicePrNext`, or declare it a duplicate with a corpus test (*A Shell Script Asks The Domain*)? Either form reads `pending` as "not reviewed".
- [ ] Bitbucket: does a later plan add a verified `bb` PR comment write, or keep a tracker issue on Bitbucket only, so the findings reach a reader on ewz-kus-portal?
- [ ] Bitbucket and GitHub + Jenkins: which later plan binds the CI colour to a commit there, so the review arm and `merge()` can act on those hosts?
- [ ] Cost: a sprint of 30 slices with two pushes each starts 60 opus reviews before re-reviews after fixes. Does `Auto-review` need a per-sprint review budget beside the per-head one? `review-starts.json` is the record such a budget would count.

## Slices

### Findings comment

- `feature/a-review-opens-no-issue` — `review.ts` opens no follow-up issue for any severity; every finding goes to the one marked PR comment; `reviewIssue` in `rules/review-issue.ts` answers none for every count; Bitbucket keeps the findings in the verdict file and says so; tests: board unit `review.test.ts` with `host-fixture` (HIGH 1 and MEDIUM 2 open no issue, post one marked comment, write `failure`; a second head edits the same comment; Bitbucket `unaskable` names the verdict file, the exit code and the status description), domain unit `reviewIssue` answers none for every count <!-- builds: reviewIssue answering none for every count, the all-severity findings comment --> → #2928

### Indexed review state

- `feature/the-index-records-the-review` — `plotReview`, `plotReviewSha`, `plotReviewAt` and `ciChecks` on `PrIndexRow` under `PR_INDEX_VERSION` 6, written by `pr-refresh.ts` on the GitHub rollup arm; `checks` unchanged; `reviewReaskPrNumbers` and its union with the delta's re-ask; Jenkins and Bitbucket rows carry no review field; tests: domain unit on the fold with the executed rollups as fixtures (CI pass and no review → `absent` and `green`; `pending` with its `startedAt`; `failure` → `ciChecks` `green`; review only → `none`), `checks` unchanged, a v5 file decodes to `null` in v6 code, the Jenkins arm carries no review field; domain unit `reviewReaskPrNumbers`; fleet unit: a delta pass re-asks a green row with an absent review, and `pending` then `success` reach the store within one re-ask <!-- builds: the review state, review SHA, review time and review-free CI colour on PrIndexRow, reviewReaskPrNumbers --> → #2939

### Sprint scope

- `feature/the-scope-is-read-from-git` — `sprintScope` and its discriminated answer; the git adapter that reads the active sprint from `origin/<default>`; `sprintFrom` moved into the domain; the branch map through the pulse; tests: domain unit over sprint texts (struck item out; zero, one and two active sprints; no unstruck item → `none`; a branch no scope plan names is out), one adapter test on a temp git repo whose local checkout lags the named ref <!-- builds: sprintScope and the git adapter that reads the sprint text --> → #2948

### Review run lock

- `feature/the-review-run-is-locked` — `reviewPr` takes the `<pr>-<sha>` lock before any `removeFile`, writes `pending` with a run id, writes its final status only while its own `pending` is the newest, never replaces a `failure` on the same head, and removes a leftover worktree with no live lock owner; `Host.prReview` carries the newest description and time; `plot-review.mjs --status-only`; tests: board unit (round 1's concurrent probe as a regression test: the second run refuses `review-running` and removes neither file of the first; a superseded run writes no status; no run replaces a `failure`; a lock with a dead pid is moved aside; `--status-only` writes the verdict file's state and starts no agent) <!-- builds: the review run lock, the run id, the newest-pending and failure guards, the status-only run --> → #2955

### Review start

- `feature/fleetd-reviews-slice-prs` — creates `rules/slice-pr-next.ts` with its input record, step union, composition order, guard, review-run, re-status and review arms; `deskDead` in `rules/desk-dead.ts`; `startReview` over the `Detached` port with `review-in-flight.json` and `reviewRunLive`; the per-head budget in `review-starts.json`; `Auto-review`; the CLAUDE.md paragraph; tests: domain table test of the arms with readings as values (`null` store → `none`; no `plotReview` → `none`; green on head and `absent` → `review`; older SHA → `review`; live run → hold; stale `pending` → `review`; budget spent → `none`; red main → still `review`; verdict file with no status → `write-status`), a precedence test with a live fixer mark on a green new head, domain unit `deskDead` (a `PLOT-BLOCKED` marker → `waiting`; `elsewhere`; a failed read → `unread`), fleet unit: two ticks over one in-flight entry start one review and a restart keeps the start count; the CI spawn ratchet does not grow outside `adapters/` <!-- builds: slicePrNext, deskDead, startReview, the review in-flight and start-count files -->

## Notes

- Raised from tracker issue #2900; plan PR #2917. The plan's `Issue:` field is the only link; nothing was written to the tracker.
- Siblings: #2898 owns the reviewer's role definition and the runner inside `review.ts`, and the unattended refusals. #2899 owns the run log; this plan writes no run-log line, and #2899's idle-slice rule is the only signal for a head past its start budget. #2902 (`feature/fleetd-merges-one-at-a-time`), #2903 (`feature/fleetd-starts-the-fixer`) and #2907 (`feature/fleetd-prepares-the-release`) wait on `feature/fleetd-reviews-slice-prs`. #2901, #2903 and #2906 read `deskDead` from that slice.
- The scope admits slice PRs of scope plans only. The main-repair and revert PRs are #2904's (`feature/fleetd-starts-main-repair`, `feature/a-red-main-is-reverted`), and the release PR is #2907's (`feature/fleetd-prepares-the-release`): each calls `startReview` on its own PR, and each needs `<!-- waits: feature/fleetd-reviews-slice-prs -->`.
- Plan PRs (`idea/*`) also need `plot/review` to merge into `main`; this plan does not review them.
- The fixer, the ticket and the accepted `success` naming the ticket are #2903's (`feature/fleetd-starts-the-fixer`, `feature/an-unfixed-high-is-ticketed`); the accepted `success` is the `write-status` step with `ticket-accepted`.
- Amended 2026-10-29 after panel round 1, and again after panel round 2.

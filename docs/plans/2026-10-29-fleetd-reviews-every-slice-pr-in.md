# fleetd reviews every slice PR in the sprint

> fleetd starts `plot-review` on every green slice PR of the active sprint whose head has no review, and a review opens no follow-up issue for any finding: every finding goes into one marked PR comment.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2900
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `plot-review` opens no follow-up issue for any finding. It writes every finding, HIGH included, into one marked comment per PR and edits that comment on each new head. The 22 findings issues open on 2026-10-29 stay open.
- On Bitbucket, where a PR comment cannot be written, `plot-review` keeps the findings in its local verdict file and says so in its output.
- The PR index records the `plot/review` state of each open PR with the commit it applies to, and a CI colour that leaves `plot/review` out.
- fleetd reads the delivery scope from the active sprint file at its latest commit: a person's scope change adds or removes plans, and a struck item drops out.
- With `Auto-review: true`, fleetd starts `plot-review` on every open slice PR of the scope whose CI is green and whose head has no review. It marks the head `plot/review=pending` at the start, starts at most one review per head, and stops retrying a head after its start budget.

<!-- Board impact: the PR index row gains a review state, its SHA and a CI colour without `plot/review`, under a `PR_INDEX_VERSION` bump; board readers of the index decode the new version. The plan format, template and docs/plans layout do not change. The sprint parser moves from the board into the domain; the board keeps its callers on the moved function. -->

## Motivation

No slice PR merges into `main` without a `plot/review` status: the ruleset requires it since 2026-10-15 and pins it to the `Review app` (integration 5317669). Only a master agent runs `plot-review` today, and no file under `packages/fleet/src` names it. From 2026-10-16 to 2026-10-29 the master agent ran every review from a watcher script. When that session ends, no PR gets a review and delivery stops. [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka, 2026-10-29) gives this step to fleetd. Sections: *The scope*, *The loop*, *Tickets*. The decisions below correct two of its claims: the scope moves with a person's scope change, and a HIGH ticket exists only after the fixer attempts.

The panel of round 1 measured four facts that the first draft did not name:

1. **A review opens an issue for every severity, HIGH included.** The decision is `review.ts:486` (`if (findings !== 0)`, where `findings` counts HIGH, MEDIUM and LOW) and the writer is `openFollowUp` at `review.ts:269`. The TSDoc at `review.ts:57-68` describes it. The design says a HIGH ticket exists only after the fixer attempts fail, so the review-time issue for HIGH also goes.
2. **The PR index holds no review record, and its CI colour already contains the review.** `PrIndexRow.review` (`packages/domain/src/entities/pr-index.ts:41`) is GitHub's `reviewDecision`, empty on all 1023 rows of the live index (v5). `plot/review` is a status context that `checks_of` folds into `checks` with every other rollup entry (`skills/plot/scripts/plot-host.sh:702-707`). Executed on sample rollups: a HIGH review reads `checks: failing`, and "no review" and "review success" both read `green`. So the index cannot tell CI red from a HIGH, nor an unreviewed head from a clean one. The only per-head reading today is `Host.prReview` (`packages/domain/src/ports/host.ts:408`), one host call per PR, which *A Decision Reads The Index* keeps out of a decision.
3. **The reviewer cannot start as a bare `agent-run` call.** `reviewPr` (`packages/board/src/server/entry/review.ts:395`) re-asks the head, builds the worktree, writes the diff, runs the agent for up to `REVIEW_BOUND_SECONDS = 3600` (`review.ts:100`), parses the verdict and writes the status. A tick that called `agentRun` directly would write no status and would wait up to an hour. `reviewPr` lives in the board package, and `@plot-pm/fleet` depends only on `@plot-pm/domain`. auto-verify already solves the same shape: `verifyStart` (`packages/domain/src/rules/auto-verify.ts:162`) decides, and `startBoardRun` (`packages/fleet/src/shared/board-run.ts:184`) starts a board entry detached with an in-flight file (`packages/fleet/src/shared/auto-verify.ts:153`).
4. **Two reviews of one head corrupt the first.** Executed: the second run removes the first run's verdict and diff files (`review.ts:424-425`) before its worktree add refuses (`review.ts:430-431`). The first reviewer then has no diff to read, and a diff over 98,304 bytes lives only in that file, yet it can still write `success`. The status is last-writer-wins per context and SHA (`host.ts:122-130`, `CommitStatusWrite`), so a later run can replace a HIGH `failure` with `success`. A run that writes no status (a failed write, a refused verdict, a leftover worktree) reads as "no review" on the next pass and starts another full review every pass.

The scope, measured: sprint `follow-ups-2-29-1` held 2 plans at its `sprint: start` commit `f92415d23` and 11 at close, added by three `sprint: scope change` commits a person made. A freeze at the start commit would have kept 2 of 11, and 9 delivered plans would have had no fleet review.

## Design

### Approach

The spec's *Decided* and *Calls made* lists bind this plan where the decisions below do not correct them.

- **No issue at review time.** `reviewPr` opens no follow-up issue for any severity. Every finding goes into the one marked PR comment: `findingsMarker(pr)` (`review.ts:358`) with `Host.prComment(pr, body, marker)` edits one comment per PR in place (`host.ts:376-397`, covered at `review.test.ts:608`), and the body names the head and the run. The decision "which findings open an issue" moves into `rules/review-issue.ts` as a pure function of `ReviewCounts`, and it answers "none" for every count. A recorded `<pr>-<sha>.issue` from an earlier run gets no further comment. Exit code 4 (`EXIT.issueNotOpened`) then means only "findings not posted". A HIGH still writes `failure`, which blocks the merge until #2903 fixes it or tickets it.
- **Bitbucket.** `pr-comment` exits 4 on Bitbucket (`plot-host.sh:6061`), and `prComment` answers `unaskable` (`packages/domain/src/adapters/host/host-shell.ts:505-512`). There the findings stay in the local verdict file, and the output line at `review.ts:506` names that file. The status description says the findings were not posted.
- **The review in the index.** `pr-refresh.ts`, the index's one writer, stores per open row the `plot/review` state, the SHA it applies to, and a CI colour folded without `plot/review`, under a `PR_INDEX_VERSION` bump from 5 (`pr-index.ts:12`). On GitHub the rich `pr-list` arm already fetches `statusCheckRollup`, so the fields cost no extra host call. On Bitbucket the writer asks `pr-review` per open slice row. Where the adapter supplies no `failing_checks` or sets `checksLookup`, the CI colour reads `unknown`, never `green`.
- **The scope reader.** A pure domain rule `sprintScope` reads the active sprint file's text at its latest commit and answers its plan slugs, without struck (`~~`) items. An adapter reads the text from git. The sprint parser `sprintFrom` moves from `packages/board/src/server/entry/sprint-transition.ts:162` into the domain beside `sprintMembers` (`packages/domain/src/entities/sprint.ts:150`), and the board keeps its callers. No state file holds the scope. Zero or two active sprints give an empty scope and a reason.
- **`rules/slice-pr-next.ts`.** One pure rule takes readings as values and answers one next step per open PR: the index row, the scope, the in-flight marks, the per-head start counts and the default-branch reading. This plan fixes the input record and the step union, `none | review | merge | hold | fixer | ticket`, and builds only `none` and `review`. #2902 adds `merge` and `hold`, and #2903 adds `fixer` and `ticket`. A red or stale default branch holds merges and never holds a review. The review arm answers `review` for an open, non-draft slice PR of a scope plan whose CI colour without `plot/review` is green on its head SHA, whose recorded review is absent or on an older SHA, which has no live in-flight mark, and whose start count is under the budget.
- **The start.** fleetd starts `plot-review.mjs <pr>` detached through an adapter, as `startBoardRun` starts a verify run, and records pid, PR, head and start time in an in-flight file read with pid liveness and a start grace. Before the agent starts, the run writes `plot/review=pending` on the head with a run id: every machine sees the mark, and a pending status younger than `REVIEW_BOUND_SECONDS` reads as in flight. `reviewPr` refuses before it removes any file when another run holds the same PR and head. An unattended run never replaces a `failure` on the same head; only #2903's ticket step writes the accepted `success`. A head gets a start budget with backoff; past it, the rule answers `none` and the head stays pending for a person. When a verdict file for the head exists and only the status write failed, the next step writes the status again and starts no review. A leftover review worktree with no live owner is removed before the next start. A config key `Auto-review` (default `false`) turns the arm on, and a concurrency bound counts reviews against fleet headroom, as `verifyStart` does.
- **The decision reads the index** (*A Decision Reads The Index*): the rule reads stored rows and calls no host. `reviewPr` re-asks the head and its `plot/review` before it starts, so the index selects and the controller confirms.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-fleetd-reviews-every-slice-pr-in/panel.md`):

- [x] D1 Refusals: `plot-review.mjs` is not one of the refused controllers, and this plan builds no caller identity. The `caller` reading and the `merge`, `continue` and `release` refusals are #2898's (`feature/unattended-callers-are-refused`).
- [x] D2 HIGH route: a review opens no issue for any severity. Every HIGH goes to a fixer, two attempts per PR, and only then to a ticket; both are #2903's. Between this plan and #2903, a HIGH holds the PR at `plot/review=failure` with no ticket, which is the safe side.
- [x] D3 Scope: the scope is the active sprint file read from git at its latest commit. A person's `sprint: scope change` commit moves the scope; nothing else does. Struck items drop out. No state file.
- [x] D4 Merger app: fleetd merges on GitHub only as the declared `Merger app`, never through the ruleset's `always` bypass actors (the admin role and integration 5173644). The merge and the armed auto-merge case are #2902's; this plan writes the status #2902 reads.
- [x] D5 Role form: the reviewer's definition and per-role settings are #2898's (`feature/role-agent-definitions`), loaded from the default branch's copy. This plan starts `plot-review.mjs`, which runs the reviewer through the runner #2898 changes, and creates the review worktree itself.
- [x] Slice order: Tickets, then the index, then the scope, then the rule and the start, so no unscoped review runs and no review opens an issue at fleet volume.
- [x] Open question 2 (one comment or one per head): one marked comment per PR, edited per head, through the existing `findingsMarker` and `prComment`.

### Open Questions

- [ ] `plot-review-status.sh` answers `needs_review` per sprint item from a sprint annotation `review_sha` and `git ls-remote`, a second review record beside `plot/review`. Does slice 4 shrink it to a launcher that asks `slicePrNext`, or declare it a duplicate with a corpus test (*A Shell Script Asks The Domain*)?
- [ ] Bitbucket: does a later plan add a verified `bb` PR comment write, or keep a tracker issue on Bitbucket only, so the findings reach a reader on ewz-kus-portal?
- [ ] Cost: a sprint of 30 slices with two pushes each starts 60 opus reviews before re-reviews after fixes. Does `Auto-review` need a per-sprint review budget beside the per-head one?

## Slices

### Findings comment

- `feature/a-review-opens-no-issue` — `review.ts` opens no follow-up issue for any severity; every finding goes to the one marked PR comment; the severity decision moves to `rules/review-issue.ts`; Bitbucket keeps the findings in the verdict file and says so <!-- builds: reviewIssue answering none for every count, the all-severity findings comment -->

### Indexed review state

- `feature/the-index-records-the-review` — the PR index records the `plot/review` state with its SHA and a CI colour without `plot/review`, through `pr-refresh.ts` with a `PR_INDEX_VERSION` bump <!-- builds: the review state, review SHA and review-free CI colour on PrIndexRow -->

### Sprint scope

- `feature/the-scope-is-read-from-git` — the domain scope reader: the active sprint file at its latest commit, struck items out, the sprint parser moved into the domain <!-- builds: sprintScope and the git adapter that reads the sprint text -->

### Review start

- `feature/fleetd-reviews-slice-prs` — creates `rules/slice-pr-next.ts` with its input record, step union and review arm; starts `plot-review.mjs` detached with an in-flight mark (`plot/review=pending`), a per-head budget and backoff, behind `Auto-review`; an unattended run never overwrites a `failure`; a desk holding a `PLOT-BLOCKED` marker is not dead <!-- builds: slicePrNext, the detached review start, the review in-flight file -->

## Notes

- Raised from tracker issue #2900; plan PR #2917. The plan's `Issue:` field is the only link; nothing was written to the tracker.
- Siblings: #2898 owns the reviewer's role definition and the runner inside `review.ts`, and the unattended refusals. #2899 owns the run log; this plan does not depend on it, because the in-flight mark is the host-visible `plot/review=pending`. #2902 (`feature/fleetd-merges-one-at-a-time`), #2903 (`feature/fleetd-starts-the-fixer`) and #2907 (`feature/fleetd-prepares-the-release`) wait on `feature/fleetd-reviews-slice-prs`.
- The scope admits slice PRs of scope plans only. The main-repair and revert PRs are #2904's (`feature/fleetd-starts-main-repair`, `feature/a-red-main-is-reverted`), and the release PR is #2907's (`feature/fleetd-prepares-the-release`): each starts the reviewer on its own PR through the detached start this plan builds.
- Plan PRs (`idea/*`) also need `plot/review` to merge into `main`; this plan does not review them.
- The fixer, the ticket and the accepted `success` naming the ticket are #2903's (`feature/fleetd-starts-the-fixer`, `feature/an-unfixed-high-is-ticketed`).
- Amended 2026-10-29 after panel round 1.

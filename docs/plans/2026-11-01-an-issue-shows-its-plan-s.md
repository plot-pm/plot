# An issue shows its plan's state on every surface

> An issue's lane, label and open or closed state follow its plan's phase on every surface that reads the issue, from the plans on the default branch and through the controllers that own each write.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2997
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2998 merged
- **Started:** 2026-11-01, Jan Wloka, `bug/an-issue-reads-its-plan-from-main`

## Changelog

- The Stories lanes, the *Waiting on you* inbox and the `/api/idea` already-planned check read the plans on the default branch (`origin/<default>`) and the open draft plans, so an issue whose plan merged counts as planned with no pull of the local checkout. An issue that only a Released plan names still counts as planned.
- An open issue that a plan names sits in *In progress* while the least advanced plan that names it is Approved. It sits in *Open* while that plan is Draft or Design, in *Done* while that plan is Delivered, and in *Open* when every plan that names it is Released, Rejected or Superseded.
- Every closed issue that only Released plans name carries `plan:released`. `plot-released-labels.mjs` writes the label and nothing else; it runs as a dry run by default, writes with `--yes`, and refuses `PLOT_UNATTENDED=1`. `/plot-reconcile` reports new drift and prints that command.
- A commit that adds an issue to the `Issue:` line of an Approved, Delivered or Released plan is refused until `plot-plan-state.sh --only-issue <issue>` has written the plan's phase to that issue.
- A `plot-review: findings on PR #N` ticket closes only when a recorded verdict reads every one of its findings settled. A merge never closes one. A ticket that stays open carries one marked comment that names its open findings, and the comment is edited in place.
- The plan comment stays one comment per issue across writers and accounts: a writer that did not take the issue lock leaves the lock alone, a failed read-back fails the write, the marked-comment lookup matches a comment from any account, and a Delivered or Released write keeps the progress line.
- A slice row shows the checks of the head its branch's remote-tracking ref names. While the PR index's `checksSha` differs from that head, the row reads `new head, checks not yet read` and is not in *Waiting on you*.

<!-- Board impact: yes. Gap 1 changes packages/board/src/server/fleet.ts (planMetasOf, referencedIssues, ticketPlansOf, ticketLaneData), packages/board/src/server/idea.ts (referencedIssues) and packages/domain/src/rules/ticket-lane.ts and ticket-lanes.ts. Gap 5 changes packages/domain/src/rules/pr-row.ts and its three callers in fleet.ts. A PR carries no generated bundle (scripts/check-no-bundle-diff.sh). -->

## Motivation

A plan's issue does not always show the plan's state. Five gaps were measured on 2026-11-01 against `origin/main` 68fde7aa8.

1. **The Stories lanes, the inbox and the idea check read plans from the local checkout.** `ticketLane` (`packages/domain/src/rules/ticket-lane.ts:52`) puts an open issue in *In progress* when `namedByPlan` is true. `ticketLanes` (`packages/domain/src/rules/ticket-lanes.ts:184`) passes that flag at `:157`. The set comes from `referencedIssues` (`packages/board/src/server/fleet.ts:1558`), which reads `planMetasOf` (`:1583`). `planMetasOf` lists the plan directory with `fs.readdirSync` in the main checkout's working tree and adds the plans of open idea PRs through `draftPlanFiles` (`:1676`). `ticketPlansOf` (`:1634`) reads the same metas for the inbox (`:2158`, `:2253`, `:2319`). `packages/board/src/server/idea.ts:401` holds a second `referencedIssues` with its own `fs.readdirSync`, and `/api/idea` refuses `already-planned` from it (`:546`, `:555`). When a plan PR merges, the plan leaves the idea branch and lands on `origin/main`; until someone moves the main checkout, no plan names the issue on any of these three surfaces. Measured: #2993 (plan PR #2994 merged, slice PR #2996 open) showed *Open* on the Stories tab while the plan cards and the Delivery tab, which read `origin/main`, showed the plan in progress. The main checkout was 10 commits behind. The pulse is not a valid source: it holds the release scope and drops released plans, and `fleet.ts:1540-1547` states why `referencedIssues` must keep them.
2. **114 closed issues of Released plans carry no `plan:released`.** Query: parse every `docs/plans/*.md` on `origin/main` with `plot-plan-meta.sh` (623 plans, 578 Released), collect every issue number on the `Issue:` line of a Released plan (342 issues), and join them against `gh issue list --state all --limit 4000 --json number,state,labels` (1078 issues). 228 of the 342 carry `plan:released`; 114 do not, all 114 are closed, none carries another `plan:*` label, and none is named by a Draft, Design, Approved or Delivered plan. 82 of the 114 are #1000 or higher. No issue carries `plan:released` without a Released plan. Three of the 114 (#2697, #2705, #2714) belong to `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md`, released in v2.29.0 after the release write existed. Their cause: the plan's `Issue:` line named only #2757 at approval (8e04f84d3), delivery (3c7cf5e78) and release (6ebc5553b), so every phase write labelled only #2757. Commit 0e8c71e28 added #2697, #2705 and #2714 to the line on 2026-10-28 at 11:06 UTC, after the release, and a person closed the three by hand one minute later. No write runs when an issue joins the `Issue:` line of a plan that is already past Draft.
3. **The `plot-review: findings on PR #N` tickets have no closing rule.** 196 such tickets are open and 166 closed (same query, by title). `plot-review` opens no ticket since 7f277875e (2026-10-29, "plot-review: a review opens no follow-up issue"): `reviewIssue` answers `none` for every count (`packages/domain/src/rules/review-issue.ts:20`). The newest ticket is #2935, created 2026-10-29T23:03Z. The one writer left is `putOnTicket` (`packages/fleet/src/shared/auto-ticket.ts:87`), which opens a ticket with the same title (`:112-116`) for a HIGH finding whose fixer attempts are spent; `writeAccepted` (`:168`) then writes `plot/review=success`, so that PR merges with the HIGH open. It has opened none on this estate. So a merge is the moment an unfixed finding reaches the default branch, and a merge-triggered close would close exactly the tickets that must stay open. #2935 and #2924 are open tickets of this kind, and their findings are gap 4.
4. **The plan-state comment write has four open defects, and no sprint item owns them.** The comment came from `tickets-follow-the-delivery-loop`, slice `feature/the-plan-comment-renders-records` (#2932, Delivered plan). Its review tickets record: `withIssueLock` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:127`) returns a release that unlinks the lock (`:153-155`) also when the wait timed out or `link()` failed, so it can delete another writer's lock (#2935); a non-zero `issue-comment-read` reads as "no comment" (`:192-193`) and the write erases the comment's ticket and progress lines (#2935); `gh_marker_comment_id` (`skills/plot/scripts/plot-host.sh:700`) matches only comments of the current `gh api user` login, so a second account posts a second plan comment (#2924); and a Delivered or Released write has no named source for the progress line, while `auto-progress.ts` can write `approved` after a delivery (#2924). `docs/sprints/2026-W44-delivery-loop.md` names neither ticket, and no plan on `origin/main` names #2935 or #2924.
5. **A slice row kept the old head's failing checks for about 7 minutes after a push.** Slice `feature/a-plan-reference-is-decided-once` (PR #2996) failed CI on head `dc98f4a02` at 12:44 UTC on 2026-11-01. The desk pushed `75da18f94` at 13:03. The Delivery row read *Waiting on you*, "PR #2996, checks failing", until about 13:10. The board fills its PR records only from the PR index (`readPrsFromStore`, `fleet.ts:2495`). The index row for #2996 reads `headSince` `2026-11-01T13:09:35.183Z` for `75da18f94`, so the index first saw the new head at 13:09:35; its `updatedAt` 13:02:59 is the host's time, not the index's read time. The reader state (`github.reader.json`) read `prNextAt − at` at about 477 s, which is the index's cadence (`prRefreshMsFor`, `packages/fleet/src/shared/pr-refresh.ts:747`). The row section comes from `prRowPlacement` (`packages/domain/src/rules/pr-row.ts:38`), which reads `mergeable` and `checks` and no commit, through `prEvidence` (`fleet.ts:3618`) and two more calls (`:4151`, `:5126`); `ci-failing` comes from `stuck.ts:300-302`. The scan fetches every head on each pass (`plot-fleet-scan.sh:387-388`), so the local `refs/remotes/origin/<branch>` names the new head before the index does, and nothing compares the two.

**What already works**, so the plan does not re-build it: `/api/approve` writes `plan:approved` and the plan-link comment (`packages/board/src/server/entry/approve.ts:1177`); delivery and release write `plan:delivered` and `plan:released` (`packages/board/src/server/entry/deliver.ts:546`, `:969`); fleetd writes the slice progress line (`packages/fleet/src/shared/auto-progress.ts:39`). `planStateWrites` (`packages/domain/src/rules/issue-status.ts:89`) owes one write for every issue the plan names at the time of the write.

**Required behaviour**, from the issue:

1. An open issue that a plan on the default branch names shows in *In progress* while that plan is Approved (started and not delivered), with no change to the local checkout.
2. Every closed issue of a released plan carries `plan:released`, including an issue added to the plan after its release.
3. A review finding ticket closes when its findings are settled, and otherwise says once why it stays open. A merge does not close it.
4. The plan comment stays one comment with its ticket and progress lines, across writers and accounts.
5. A slice row shows the CI state of the head its branch names, from the first board PR read after the branch ref moves.

## Design

### Approach

**Gap 1: one plan reader over the default branch.** One board helper, `planMetasAtDefault`, replaces the body of `planMetasOf` and feeds `ticketPlansOf`, the lanes and the `idea.ts` precondition.

- It resolves `origin/<default>` once to an oid, lists the plan directory at that oid with one `Refs.listBlobs` call (`git ls-tree`), and reads every plan blob with one `Refs.readBlobs` call (`git cat-file --batch`). This is the pattern `readPlansFromRef` (`packages/board/src/server/board.ts:716`) already uses for the cards, and the Refs adapter is the only place that runs git. The blobs and the open draft plans (`draftPlanFiles`) are staged to one scratch directory and parsed in the one existing `planMeta` call, because `plot-plan-meta.sh` takes paths.
- Where `origin/<default>` does not resolve, it reads the working tree's plan directory, the estate stage's rule (`packages/domain/src/workflows/plan-walk-estate.ts:71-73`). Where the ref resolves and the listing, a blob read or the parse fails, it answers `null`, never an empty list (`fleet.ts:1553-1556`), and every caller keeps its existing null branch.
- It keeps Released, Rejected and Superseded plans. It never reads the pulse.
- Cost, measured 2026-11-01 on this machine over 623 plans: the working-tree parse that runs today takes 598 to 673 ms, not the 132 ms the comment at `fleet.ts:1550` records for 59 plans. `ls-tree` plus `cat-file --batch` take 63 ms for 623 blobs (7.5 MB); the parse of the staged blobs takes about 780 ms. That is more than 132 ms, so the helper caches its answer in the board's cache entry under a key of the resolved `origin/<default>` oid plus the tip oid of each draft branch it read, never under a ref name. A request whose key matches spawns only the `rev-parse` and `for-each-ref` that compute the key. The slice corrects the comment at `fleet.ts:1549-1551` with the new figures.
- `idea.ts:401` keeps its exported name and its injectable `deps.referenced` and calls the same helper, so the two readers cannot drift again. It then also counts open draft plans, which closes a second `/plot-idea` for an issue whose plan is still under review.
- No wait on the plan walk. The layering juror's alternative, `readEstate` with `PlanRecord.issues`, is a later option (Notes).

**Behaviour 1: the lane follows the plan phase.** `ticketLane` takes the plans that name the issue instead of a boolean. `TicketLaneReading.namedByPlan: boolean | null` becomes `plans: readonly TicketPlan[] | null` (the `TicketPlan` of `rules/ticket-phase.ts`), and `TicketLanesReading.named: ReadonlySet<string> | null` becomes `plans: ReadonlyMap<string, readonly TicketPlan[]> | null`. `ticketLaneData` passes `ticketPlansOf`'s map, so the lanes and the phase badge read one answer, and `referencedIssues` in `fleet.ts` goes.

- A Jira `statusCategory` that the tracker states still wins first, and a closed issue still goes to *Done* or hidden by `closedAt`, as today.
- For an open issue, the least advanced placed plan decides, with the order `ticketPhase` (`rules/ticket-phase.ts:51`) uses: `draft` and `design` give *Open*, `approved` gives *In progress*, `delivered` gives *Done*. An issue whose plans are all `released`, `rejected` or `superseded` gives *Open*: a person reopened it, or no live plan answers it. No plan gives *Open*.
- Today the rule puts every named open issue in *In progress*; measured 2026-11-01, 13 open issues of Delivered plans (#2898 to #2907, #2970, #2974, #2978) sit there, and #2980 and #2993 are the two of Approved plans.

**Gap 2: a label-only backfill and a gate on added issues.**

- `packages/domain/src/rules/released-labels.ts`, `releasedLabelTargets(plans, issues)`, takes the plans' phases and issue numbers and the tracker rows with state and labels. It answers `{ write, skip }`: `write` holds every issue that a Released plan names, that is closed, that lacks `plan:released`, and that no Draft, Design, Approved or Delivered plan names; `skip` holds each other candidate with its reason (`open`, `live-plan`, `already-labelled`). Rejected and Superseded plans do not block: #333 and #912 are each named by a Released and a Rejected plan and are in `write`.
- `skills/plot/scripts/board/plot-released-labels.mjs` is an operator entry. It refuses `PLOT_UNATTENDED=1` with exit 2. It reads the plans through `planMetasAtDefault`'s parser call and the closed issues with their labels through the Tracker port's `issueListClosed`, whose GitHub rows gain `labels` (one field added to the `gh_json` closed read at `plot-host.sh:5484`, no new line). Without `--yes` it prints the `write` and `skip` sets with reasons and the host calls a `--yes` run makes, and writes nothing. With `--yes` it writes each issue through a new label-only Tracker operation, `issueLabel(issue, add, remove)`, which `tracker-github` runs as the existing `plot-host.sh issue-label` (`:5770`) with `planStateLabelsToRemove('released')` (`tracker-plan-state.ts:29`). It posts no comment, closes and reopens nothing, and adds no `gh` caller (`scripts/check-host-cli-callers.sh`). It stops and prints the unwritten rest when the connector's `limit()` reports fewer than 1000 requests left.
- Host calls: the read is 9 pages for 842 closed issues on 2026-11-01. Each write is one `issue-label` call, which makes three `gh` invocations (`gh issue view`, `gh label create`, `gh issue edit`), so at least 3 requests per issue and at least 342 for the 114, about 351 in total. The core budget is 5000 an hour, which fleetd shares.
- `/plot-reconcile` gains a section that asks `plot-released-labels.mjs` in its dry-run form, prints the count and the `--yes` command, and writes nothing.
- The fix for the v2.29.0 miss is a gate, beside the `Spike approved:` gate. `issueTransitionOf` in `packages/domain/src/rules/state-transition.ts` answers, for a commit that changes a plan file, every issue key that the `Issue:` line gains while the plan's `State:` after the commit is Approved, Delivered or Released. Each gained key needs a receipt filed under `<plan path>#Issue <key>`, the form of `spikeReceiptKey` (`:70`). `plot-state-gate.sh` (through `board/plot-gate.mjs`) refuses the commit without it and prints the command. `plot-plan-state.mjs` gains `--only-issue <key>`: it writes the plan's phase to that one issue, which the plan must name, and on a `written` outcome leaves the receipt. At `released` it applies `releaseIssueDecisions` (`rules/issue-status.ts:130`) for that issue, as the release arm of `entry/deliver.ts` does. A key removed from the line and a Draft or Design plan need no receipt.

**Gap 3: a one-off triage and a rule for HIGH tickets.**

- `reviewTicketSettled(ticket, verdict)` in `packages/domain/src/rules/review-issue.ts`, beside `findOpenReviewIssue`, answers `settled`, `open` or `unjudged`. The verdict is a named record, `.plot/state/ticket-verdicts/<issue>.md`, with a `Default:` line naming the default-branch commit it was judged at and one line per finding: `- <finding title>: fixed | not-reproduced | wont-fix | still-true`. `settled` needs a verdict whose finding count equals the ticket's `Findings: HIGH a, MEDIUM b, LOW c` total and whose every line is `fixed`, `not-reproduced` or `wont-fix`. A `still-true` line gives `open`. A missing verdict, a count that differs, or an unreadable line gives `unjudged`. A merge, a `MERGED` index row and a closed PR are not inputs.
- A re-review writes the verdict: one `claude -p --model sonnet` run per ticket (Mid tier: it checks a written finding against named code), given the ticket body and the default branch at one commit. A person may edit a line to `wont-fix`. No cost per ticket was measured; the triage's dry run runs the re-review on its first 5 tickets, prints their token usage and the projection for the 196, and starts no further run without `--yes`.
- `skills/plot/scripts/board/plot-finding-tickets.mjs` is the operator entry: dry run by default, `--yes` to write, refuses `PLOT_UNATTENDED=1`. It lists the open tickets with one `issueListWithTitle('ai-generated', 'plot-review: findings on', …)` read (`ports/tracker.ts:306`; 2 pages for 196), reads each verdict and prints `settled`, `open` and `unjudged` sets. With `--yes` it closes each `settled` ticket through a new Tracker operation `issueClose(id)` (`plot-host.sh issue-close`, `:5771`) and writes one comment marked `<!-- plot:ticket-triage -->` on each `open` ticket, naming its `still-true` findings. The comment goes through the marked-comment write that gap 4 fixes, is edited in place, and is written only when its text changes (a hash per ticket, as the plan-state write keeps). An `unjudged` ticket gets nothing. Host calls: 2 read pages, then 1 close per settled ticket or 1 comment lookup plus 1 write per changed open ticket.
- The same predicate and entry decide the HIGH tickets `putOnTicket` opens. A merge never settles one; its HIGH line needs its own verdict line.
- #2935 and #2924 stay open until the gap 4 slice merges; their verdicts come from that slice's re-check.

**Gap 4: one writer for the plan comment.** The slice changes `withIssueLock` to return a no-op release when it did not take the lock, and to fail the write instead of running unlocked after `LOCK_WAIT_MS`; it fails the write on a non-zero `issue-comment-read` and falls back only on exit 0 with empty output; it makes `gh_marker_comment_id` (`plot-host.sh:700`) match a marked comment from any account, the first by creation, with no new shell lines net (`scripts/check-shell-lines.sh`); and it reads the phase inside the issue lock for the progress write, so `auto-progress.ts` cannot write `approved` after a delivery. `filled` (`packages/domain/src/rules/plan-issue-comment.ts:112`) already keeps a prior progress line when the read succeeds; the slice re-checks that finding against the code and closes it or fixes it. The acceptance is the MEDIUM findings of #2935 (2) and #2924 (3), each re-checked against the code at the slice's base, each answered by a failing test or by a recorded reason it no longer holds.

**Gap 5: the row compares the checks' commit with the branch tip.** The slice starts with a root-cause step: it confirms from the index rows and the scan log that the index cadence alone explains the 13:03 to 13:10 lag, and it names the file the fix lands in.

- `prRowPlacement`'s readings gain `checksSha?: string` and `tip?: string`. The tip is the local `refs/remotes/origin/<branch>` oid, read through `Refs.branchTips` (the call `board.ts:986` already makes), with zero host calls.
- Rule, after the `conflicting` check: where both are present and `checksSha !== tip`, the answer is `{ group: 'waiting-on-machine', clause: 'new head, checks not yet read' }`. Where `checksSha === tip`, the rule answers as today. Where `checksSha` is absent (Jenkins, Bitbucket and the plain listing, `entities/pr-index.ts:74-79`) or no tip was read, the rule answers as today, so a real failure on those hosts stays visible.
- The rule decides by commit, never by `updatedAt`, and never by which reading is newer. `stuck.ts` reads the same answer, so `ci-failing` does not fire on a stale reading.
- Bound: the row leaves *checks failing* on the first board PR read after the scan's fetch moves the local ref, and it shows the new head's checks on the first read after the index row's `checksSha` reaches that head, which is one PR index pass (`prRefreshMsFor`, `pr-refresh.ts:747`; 477 s on 2026-11-01).
- A faster index refresh after a push is a cadence change in `pr-refresh.ts` and is not in this plan.

### Decisions

Decided 2026-11-01 by the moderator after panel round 1 (`.plot/panels/an-issue-shows-its-plan-s/panel.md`):

- [x] **Gap 1 source:** the board reads `origin/<default>` itself, one listing and one batched blob read, with no wait on the plan walk (seams juror). The layering juror's `readEstate` with `PlanRecord.issues` is recorded as a later option.
- [x] **Gap 1 scope:** one helper feeds the lanes, the inbox (`ticketPlansOf`) and `/api/idea`'s precondition, each with its own assertion (testability and seams jurors).
- [x] **Behaviour 1:** the lane takes the plan phase, in the domain, with the precedence `ticketPhase` already uses, so the lane and the badge agree (all four jurors found the rule ignores the phase).
- [x] **Gap 2:** a one-off label-only operator entry, a read-only reconcile report for later drift, and a commit gate for the cause of the v2.29.0 miss. No standing writer, because the released write also closes the issue and removes other `plan:*` labels (safety juror).
- [x] **Gap 3:** a one-off triage of the 196 open tickets plus the same rule for `auto-ticket.ts` tickets; settled is a domain predicate over a named verdict; a merge never closes a ticket (safety juror). It waits on gap 4 because its comment goes through the marked-comment lookup gap 4 fixes.
- [x] **Gap 4:** this plan owns it as its own slice, because no sprint item or plan owns #2935 or #2924 (safety and seams jurors).
- [x] **Gap 5:** stays in this plan as its own slice with a root-cause step first; the rule compares `checksSha` with the branch tip (layering and safety jurors); the seams juror's own plan is not taken.

### Open Questions

- [x] Gap 1: does `referencedIssues` read the plan walk's resolved set, or a shared index? Neither. One board helper reads `origin/<default>` directly; the walk's pulse drops released plans and its `PlanRecord` carries no issues.
- [x] Gap 2: one-off migration or standing reconcile section? A one-off label-only operator entry, plus a reconcile section that reports and writes nothing, plus a gate that stops an added issue from missing its label.
- [x] Gap 3: what counts as settled? A recorded verdict per finding, from a re-review against the default branch or a person's `wont-fix`, that covers every finding and names none `still-true`.
- [x] Gap 5: which read is stale, and which reading wins? The PR index, by its cadence; the board's records are the index's. The row takes the index's checks only where `checksSha` equals the branch tip.
- [x] Gap 4: own slices or external dependency? This plan's own slice, `bug/the-plan-comment-has-one-writer`.

## Done when

Domain rows run in `pnpm --filter @plot-pm/domain exec vitest run <file>`, board rows in `pnpm --filter @plot-pm/board exec vitest run <file>`, and `test/reconcile` rows in `node --test <file>`.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| A merged plan names its issue with a stale checkout | git sandbox whose `origin/main` is one commit ahead of the checkout, the new commit adding a plan that names #7 | `ticketLaneData` lanes #7 by its plan's phase; old code lanes it *Open* | `packages/board/test/unit/fleet.test.ts` | Plan source |
| The inbox sees the same plan | the same sandbox, issue #7 open | #7 is not in *Waiting on you* as unplanned | `packages/board/test/unit/offline-issue-rows-into.test.ts` | Plan source |
| `/api/idea` refuses a planned issue | the same sandbox, `POST /api/idea` for #7 | `409 already-planned`; old code starts the idea command | `packages/board/test/unit/idea-route.test.ts` | Plan source |
| A released plan keeps its issue named | sandbox plan `State: Released` naming #8 | #8 counts as planned | `packages/board/test/unit/fleet.test.ts` | Plan source |
| An unreadable ref is not "nothing planned" | `origin/main` resolves, `cat-file` fails | helper answers `null`; lanes keep their last answer | `packages/board/test/unit/fleet.test.ts` | Plan source |
| No remote reads the checkout | repo with no `origin/main` | plans read from the working tree | `packages/board/test/unit/fleet.test.ts` | Plan source |
| The cache keys on the oid | two reads at one oid, then a new commit | one parse for the first two, a second parse after the commit | `packages/board/test/unit/fleet.test.ts` | Plan source |
| Lane per phase | open issue named by one plan in `draft`, `design`, `approved`, `delivered`, `released`, `rejected`, `superseded` | *Open*, *Open*, *In progress*, *Done*, *Open*, *Open*, *Open* | `packages/domain/test/ticket-lane.test.ts` | Plan source |
| Lane with several plans | `draft` + `approved`; `approved` + `delivered`; `released` + `approved` | *Open*; *In progress*; *In progress* | `packages/domain/test/ticket-lane.test.ts` | Plan source |
| A stated category and a closed issue win | Jira `Done`; GitHub issue closed today, plan `approved` | *Done*; *Done* | `packages/domain/test/ticket-lane.test.ts` | Plan source |
| Unreadable plans keep the kept lanes | `plans: null` | `plansUnreadable: true`, kept lanes | `packages/domain/test/ticket-lanes.test.ts` | Plan source |
| Backfill targets | Released plan names #1 (closed, no label), #2 (closed, labelled), #3 (open); #4 named by Released and Approved; #333 named by Released and Rejected | `write`: #1, #333; `skip`: #2 `already-labelled`, #3 `open`, #4 `live-plan` | `packages/domain/test/released-labels.test.ts` | Released labels |
| The backfill writes the label only | tracker fixture, `--yes` over #1 | one `issueLabel(1, 'plan:released', …)`, no comment, no close | `packages/board/test/unit/released-labels-entry.test.ts` | Released labels |
| The dry run writes nothing | no `--yes` | both sets printed with reasons and the call count; zero tracker writes | `packages/board/test/unit/released-labels-entry.test.ts` | Released labels |
| An unattended caller is refused | `PLOT_UNATTENDED=1` | exit 2, zero tracker calls | `packages/board/test/unit/released-labels-entry.test.ts` | Released labels |
| Reconcile reports and writes nothing | estate with one drifted issue | the section prints `1` and the `--yes` command; zero writes | `test/reconcile/reconcile-released-labels.test.mjs` | Released labels |
| An added issue owes its phase | commit 0e8c71e28's shape: Released plan, `Issue: #2757` → `#2757, #2697` | one transition for `2697` with key `<plan>#Issue 2697`; old code: none | `packages/domain/test/state-transition.test.ts` | Added issues |
| No receipt is owed on a Draft plan or a removed key | Draft plan gains #9; Released plan loses #9 | no transition | `packages/domain/test/state-transition.test.ts` | Added issues |
| `--only-issue` writes one issue and leaves a receipt | Released plan naming #A, #B; `--only-issue B` | one `planStateWrite` for B at `released`; receipt `<plan>#Issue B` | `packages/board/test/unit/plan-state.test.ts` | Added issues |
| The gate refuses without the receipt | `git commit` of the added key, no receipt | exit 2, the message names the `plot-plan-state.sh --only-issue` command | `test/reconcile/state-gate.test.mjs` | Added issues |
| Settled needs every finding | verdict with 6 lines for `Findings: HIGH 0, MEDIUM 2, LOW 4`, all `fixed` or `wont-fix` | `settled` | `packages/domain/test/review-issue.test.ts` | Finding tickets |
| One `still-true` keeps a ticket open | the same with one `still-true` | `open` | `packages/domain/test/review-issue.test.ts` | Finding tickets |
| A short or missing verdict decides nothing | 5 lines for 6 findings; no file | `unjudged`; `unjudged` | `packages/domain/test/review-issue.test.ts` | Finding tickets |
| A merge is no input | merged PR, no verdict | `unjudged`, and no close | `packages/domain/test/review-issue.test.ts` | Finding tickets |
| The stay-open comment is written once | two `--yes` runs with one unchanged `open` verdict | one comment write, then none | `packages/board/test/unit/finding-tickets-entry.test.ts` | Finding tickets |
| The triage closes only settled tickets | one ticket each `settled`, `open`, `unjudged`; `--yes` | one `issueClose`, one marked comment, nothing for the third | `packages/board/test/unit/finding-tickets-entry.test.ts` | Finding tickets |
| A lock not taken is not released | lock held by a live foreign writer past `LOCK_WAIT_MS` | the write fails; the foreign lock file still exists | `packages/domain/test/tracker-plan-state.test.ts` | Plan comment |
| A failed read-back fails the write | `issue-comment-read` exits 1 | `failed`; no `issue-comment` call; no hash recorded | `packages/domain/test/tracker-plan-state.test.ts` | Plan comment |
| One comment across accounts | `gh` stub: marked comment by login X, current login Y | one comment edited, zero created | `test/reconcile/host.test.mjs` | Plan comment |
| A Delivered write keeps the progress line | prior comment with a progress line; `delivered` write with no `--slice-progress` | the posted body keeps the line | `packages/domain/test/tracker-plan-state.test.ts` | Plan comment |
| A late progress write does not undo a delivery | phase reads `delivered` inside the lock when the progress write runs | no `approved` label, no write | `packages/fleet/test/unit/auto-progress.test.ts` | Plan comment |
| Forward: a stale index reading does not fail the row | `checksSha` `dc98f4a02`, `checks: failing`, tip `75da18f94` | `waiting-on-machine`, `new head, checks not yet read`; old code: `checks failing` | `packages/domain/test/pr-row.test.ts` | Head checks |
| Bound: a current reading still fails the row | `checksSha` = tip = `75da18f94`, `checks: failing` | `waiting-on-you`, `checks failing` | `packages/domain/test/pr-row.test.ts` | Head checks |
| Reverse: a newer index reading does not win by being newer | `checksSha` `75da18f94` failing, tip still `dc98f4a02`, newer `updatedAt` | `new head, checks not yet read` for the tip the row shows | `packages/domain/test/pr-row.test.ts` | Head checks |
| No `checksSha` keeps today's reading | Bitbucket row `checks: failing`, no `checksSha` | `checks failing` | `packages/domain/test/pr-row.test.ts` | Head checks |
| The board passes the tip | fleet sandbox with an index row on the old head and a moved local ref | the Delivery row is not in *Waiting on you* and `stuckState` is not `ci-failing` | `packages/board/test/unit/fleet.test.ts` | Head checks |

## Slices

### Plan source

- `bug/an-issue-reads-its-plan-from-main` — `planMetasAtDefault` in `packages/board/src/server/fleet.ts` (replaces the body of `planMetasOf`, `:1583-1619`; caches by oid; corrects the comment at `:1549-1551`); `ticketPlansOf` and `ticketLaneData` read it, and `referencedIssues` in `fleet.ts` goes; `packages/board/src/server/idea.ts:401` calls the same helper; `TicketLaneReading.plans` in `packages/domain/src/rules/ticket-lane.ts` and `TicketLanesReading.plans` in `rules/ticket-lanes.ts`; `packages/board/src/server/discovery-lanes.ts` passes the map. Tests: `packages/domain/test/ticket-lane.test.ts`, `ticket-lanes.test.ts`, `packages/board/test/unit/fleet.test.ts`, `offline-issue-rows-into.test.ts`, `idea-route.test.ts`. → #3003

### Plan comment

- `bug/the-plan-comment-has-one-writer` — `packages/domain/src/adapters/tracker/tracker-plan-state.ts` (`withIssueLock`, the read-back at `:192-193`), `skills/plot/scripts/plot-host.sh:700` (`gh_marker_comment_id`), `packages/fleet/src/shared/auto-progress.ts` (the phase read inside the lock), and `packages/domain/src/rules/plan-issue-comment.ts` if the progress-line re-check finds a defect. Tests: `packages/domain/test/tracker-plan-state.test.ts`, `test/reconcile/host.test.mjs`, `packages/fleet/test/unit/auto-progress.test.ts`. The PR body answers each MEDIUM finding of #2935 and #2924.

### Released labels

- `infra/released-issues-carry-their-label` — `packages/domain/src/rules/released-labels.ts`; `issueLabel` on `packages/domain/src/ports/tracker.ts` and its GitHub, fixture, Jira and none adapters; `labels` on the GitHub closed read in `plot-host.sh:5481-5484`; `packages/board/src/server/entry/released-labels.ts` built to `skills/plot/scripts/board/plot-released-labels.mjs` (built on `main`, not committed) with its row in `skills/plot/scripts/README.md`; the reconcile section in `skills/plot/scripts/plot-reconcile-scan.sh`, offset in shell lines. Tests: `packages/domain/test/released-labels.test.ts`, `packages/board/test/unit/released-labels-entry.test.ts`, `test/reconcile/reconcile-released-labels.test.mjs`.

### Added issues

- `bug/an-added-issue-owes-its-phase` — `issueTransitionOf` in `packages/domain/src/rules/state-transition.ts` and its call in the gate entry `packages/board/src/server/entry/gate.ts`; `--only-issue` and the receipt in `packages/board/src/server/entry/plan-state.ts`; the README row of `plot-plan-state.sh`. Tests: `packages/domain/test/state-transition.test.ts`, `packages/board/test/unit/plan-state.test.ts`, `test/reconcile/state-gate.test.mjs`. <!-- waits: bug/the-plan-comment-has-one-writer -->

### Finding tickets

- `bug/settled-finding-tickets-close` — `reviewTicketSettled` in `packages/domain/src/rules/review-issue.ts`; `issueClose` on the Tracker port and its adapters; `packages/board/src/server/entry/finding-tickets.ts` built to `skills/plot/scripts/board/plot-finding-tickets.mjs` with its README row. Tests: `packages/domain/test/review-issue.test.ts`, `packages/board/test/unit/finding-tickets-entry.test.ts`. <!-- waits: bug/the-plan-comment-has-one-writer -->

### Head checks

- `bug/a-slice-row-reads-its-head-s-checks` — the root-cause step first, recorded in the PR body; then `checksSha` and `tip` in `PrRowReadings` (`packages/domain/src/rules/pr-row.ts`), the tip read and the three `prRowPlacement` calls in `packages/board/src/server/fleet.ts` (`:3621`, `:4151`, `:5126`), and `stuck.ts`'s input. Tests: `packages/domain/test/pr-row.test.ts`, `packages/board/test/unit/fleet.test.ts`. If the root cause places the fix in `packages/fleet/src/shared/fleet-scan.ts`, the slice line gains a wait on `feature/the-scan-script-is-a-launcher` before dispatch.

## Notes

Created from tracker issue #2997 (https://github.com/plot-pm/plot/issues/2997).

**Order with `every-plan-reference-shows-its-issue`.** That plan's slice `feature/the-fleet-payload-indexes-its-plans` builds `/api/fleet`'s plan index from the metas `planMetasOf` returns. `bug/an-issue-reads-its-plan-from-main` changes that source, so it merges first; the other plan's slice already waits on `feature/the-scan-script-is-a-launcher`, so the order costs it nothing. The moderator records the same order in that plan.

**`fleet.ts` churn.** `packages/board/src/server/fleet.ts` changed in 24 commits between 2026-10-25 and 2026-11-01 (seams juror). A slice that touches it rebases on `origin/main` before review.

**Later option for gap 1.** The layering juror proposed reading the plan set through the domain's `readEstate` with an `issues` field added to `PlanRecord` and every `PlanStore` adapter, and a corpus row against `plot-plan-meta.sh`. That moves the reader into the domain and retires `draftPlanFiles`, at the cost of a port change the walk's slices also touch. It fits after `feature/the-scan-script-is-a-launcher` lands.

**Why the Added issues slice waits on the Plan comment slice.** `--only-issue` writes through `githubPlanStateWrite`, the label, the comment and at `released` the close, so it carries #2935's defects until they are fixed. The Released labels slice writes the label only and does not wait.

**The 114 issues** are listed by the backfill's dry run, which the Released labels PR links, so a reviewer can check the set.

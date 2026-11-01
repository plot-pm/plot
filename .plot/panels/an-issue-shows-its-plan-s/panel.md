# Panel: an-issue-shows-its-plan-s

Round 1, 2026-11-01. Subject: `docs/plans/2026-11-01-an-issue-shows-its-plan-s.md` (plan PR #2998, issue #2997). Four jurors, one rubric, lens as the only variable. The jurors read `origin/main` 1be47ec3c; the moderator re-checked every cited line against 68fde7aa8.

**Reconciliation:** `unanimous amend` (layering, safety, testability, seams).

## What each juror looked at

- **layering:** read `ports/plan-store.ts`, `plan-walk-assembly.ts`, `plan-walk-estate.ts`, `fleet.ts:1539-1700`, `ticket-lane.ts`, `ticket-lanes.ts`, `review-issue.ts` and `tracker-plan-state.ts`. Ran queries: read the live PR index (`github.json`, `github.reader.json`) with `jq`, counted open review tickets with `gh issue list`, and counted the released-plan label drift with `gh issue view` per issue. It was the only juror to read the index's own timestamps.
- **safety:** parsed `State:` and `Issue:` of all plans on `origin/main` and joined them against `gh issue list --state all`; read `gh api rate_limit`; traced the write path of `githubPlanStateWrite` and `plot-host.sh` per call; read the active sprint file; ran `git log -S` on `review-issue.ts`. It was the only juror to price a bulk write in host calls and to name the issues that two plans share (#333, #912).
- **testability:** read the domain seams (`PlanRecord`, `readEstate`, `prRowPlacement`, `carriedChecks`) and their tests; ran the same plan-to-label join; ran `gh issue list` and `gh issue view` on the review tickets and on #2935 and #2924. It was the only juror to trace #2697, #2705 and #2714 to one plan released in v2.29.0, and to name the forward and the reverse fixture for gap 5.
- **seams:** read the same files plus `idea.ts:386-430`, `fleet.ts:2820-2840` and the `every-plan-reference-shows-its-issue` plan; counted `fleet.ts` churn (24 commits since 2026-10-25); checked open PRs and claimed branches for file overlap; ran the label join with `comm`. It was the only juror to order this plan against another plan's slice.

Every juror ran at least one query against the tracker. The three label counts agree because the three jurors ran the same join over the same data, not because three independent samples agree.

## Agreed findings

1. **The count is 114, not 38.** 342 issues are named by Released plans; 228 carry `plan:released`; 114 are closed with no `plan:*` label. No juror could reproduce 38. The moderator re-ran the join on 68fde7aa8 (623 plans, 578 Released, 1078 issues) and got 114, all closed, none named by a live plan. (layering, safety, testability, seams)
2. **Gap 3's premise is outdated.** `reviewIssue` answers `none` since 7f277875e (2026-10-29); 196 `plot-review: findings on` tickets are open, the newest created 2026-10-29T23:03Z; the only live writer is `auto-ticket.ts`, for a HIGH whose fixer attempts are spent. (all four; safety and testability add that a merge-triggered close would close the tickets that must stay open)
3. **The sprint item for #2935 and #2924 does not exist.** `docs/sprints/2026-W44-delivery-loop.md` names neither ticket, and no plan names them. (safety, seams; testability notes that gap 3 could close both tickets by accident)
4. **The plan walk carries no issues.** `PlanRecord` has no `issues` field, and the pulse drops released plans, which `fleet.ts:1540-1547` says the reference set must keep. "Consume the walk's resolved set" is not buildable. (all four)
5. **Behaviour 1 contradicts the lane rule.** `ticket-lane.ts:52` puts every named open issue in *In progress*, Draft and Delivered included; 13 open issues of Delivered plans sit there. (all four)
6. **Gap 1 has more readers than the plan named.** `ticketPlansOf` (the inbox) reads the same metas, and `idea.ts:401` holds a second `referencedIssues` behind `/api/idea`'s `already-planned` refusal. (layering names `ticketPlansOf`; testability and seams name both)

## Disagreement

**Gap 1 design.** layering requires the board to read the plan set through the domain's `readEstate`, with `issues` added to `PlanRecord` and every `PlanStore` adapter and a corpus row against `plot-plan-meta.sh`, so `draftPlanFiles` retires. seams requires the board to read `origin/<default>` itself, with one listing and one batched blob read, the pattern `draftPlanFiles` and `readPlansFromRef` already use, and no wait on the walk, whose slices are still changing that port. testability sides with the estate read; safety asks only that the set include every plan on the default-branch ref.

**Operator's decision:** seams' design. It changes no port the walk's in-flight slices touch, needs no wait, and fixes all three surfaces in one board helper. layering's estate read is recorded in the plan's Notes as a later option once `feature/the-scan-script-is-a-launcher` lands. The moderator measured the cost layering asked to be stated: the parse runs 598 to 673 ms over 623 plans today, not 132 ms, and the ref read adds 63 ms, so the helper caches by the `origin/<default>` oid.

**Gap 5 placement.** seams wants gap 5 moved to its own bug plan, because its fix site was unknown and it is not an issue-state concern. layering and safety keep it here as a domain rule comparing `checksSha` with the head. testability wants a measurement first.

**Operator's decision:** its own slice in this plan, with a root-cause step first. The measurement testability asked for exists: layering read `headSince` `13:09:35.183Z` for the new head and a 477 s reader cadence, so the index lagged by its own cadence. The rule follows layering and safety, and the slice waits on `feature/the-scan-script-is-a-launcher` only if the root cause lands in `fleet-scan.ts`, which is seams' ordering concern.

**Gap 2 shape.** testability wants a standing check, because drift continued after the release write existed; safety and seams want a one-off label-only entry, because a standing writer would close issues and strip labels on each pass.

**Operator's decision:** both halves. A one-off label-only operator entry, a read-only reconcile report for later drift, and a commit gate for the cause testability found: the v2.29.0 issues joined the `Issue:` line after the release (0e8c71e28), so no phase write ever owed them a label.

## Points one juror raised

- **layering:** the store evidence that the index, not the board, held the old head; the plan read `updatedAt` as the index's read time. A faster refresh after a push is a `pr-refresh.ts` cadence change with its own rate measurement.
- **safety:** the released write closes the issue and removes other `plan:*` labels on every call, and the written-hash file is local to one machine, so a backfill through it posts about 114 comments and costs about 1000 calls. The "says why" comment needs one marked comment, edited in place.
- **testability:** "within one PR index refresh" and "says why not" had no test that can fail. The reverse fixture for gap 5 proves the rule does not take the newer reading or the index by default.
- **seams:** gap 1 must merge before `every-plan-reference-shows-its-issue`'s `feature/the-fleet-payload-indexes-its-plans`, which builds from `planMetasOf`. #2924 reviews plan text, not code, so gap 4's acceptance is its MEDIUM findings re-checked against code.

## Shared blind spot

No juror asked why the three v2.29.0 issues missed the label. testability found them and concluded the release write misses issues; the moderator traced the `Issue:` line through 12 commits and found it named only #2757 at approval, delivery and release. The release write was correct; the field changed afterwards by hand, outside any controller, the shape CLAUDE.md's state gate already refuses for `State:`. The amended plan closes it with a gate on added issues rather than a second writer.

No juror priced the gap 3 re-review in model cost. The amended plan names the tier (Mid) and makes the triage measure 5 tickets before it runs the rest.

## Amendments made to the plan

1. Motivation corrected: the gap 1 readers and the pulse exclusion; the 114 count with its query and the v2.29.0 cause; gap 3 as a backlog plus `auto-ticket.ts`; gap 4 with no sprint owner; gap 5 from the index's own timestamps.
2. `### Approach` written for every gap; behaviour 1 is a domain rule over plan phases with the `ticketPhase` order.
3. `### Decisions` added and every Open Question ticked.
4. Six slices, one branch each: Plan source, Plan comment and Released labels with no wait; Added issues and Finding tickets waiting on `bug/the-plan-comment-has-one-writer`; Head checks with no wait unless its root cause lands in `fleet-scan.ts`.
5. A `## Done when` table maps every Changelog line to a test, its input and its slice.
6. Notes order gap 1 before `feature/the-fleet-payload-indexes-its-plans` and record layering's estate read as a later option. `- **Rounds:** 1` added to `## Status`.

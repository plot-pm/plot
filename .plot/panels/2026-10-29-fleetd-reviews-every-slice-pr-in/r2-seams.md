# Juror verdict: seams (round 2)

Position: amend

Evidence: read the amended plan (worktree at `a13b2b132`), round 1's `panel.md` and `seams.md`, `loop-decisions.md` (D1–D7, slice map), the design on `origin/main` (`d44303471`), and the nine amended sibling plans (#2898, #2899, #2901, #2902, #2903, #2904, #2905, #2906, #2907). Read code at the worktree: `packages/board/src/server/entry/review.ts` (55-100, 265-272, 355-360, 393-440, 478-527), `packages/domain/src/entities/pr-index.ts:1-110`, `packages/domain/src/ports/host.ts:115-160,370-410`, `packages/domain/src/adapters/host/host-shell.ts:500-515`, `skills/plot/scripts/plot-host.sh:698-707,4390-4404,4728-4830,6052-6066`, `packages/fleet/src/shared/board-run.ts:160-215`, `packages/fleet/src/shared/auto-verify.ts:148-158,496-497`, `packages/domain/src/rules/auto-verify.ts:162`, `packages/board/src/server/entry/sprint-transition.ts:150-200`, `packages/domain/src/entities/sprint.ts:140-160`, `packages/domain/src/rules/review-issue.ts`, `packages/domain/src/rules/sprint-selection.ts:137-142`, `packages/fleet/package.json`, `skills/plot/scripts/plot-bitbucket-commit-status.mjs:30-57`. Ran: (1) read-only `gh -R plot-pm/plot pr list --json statusCheckRollup` on 3 open and 3 merged PRs; (2) the `CHECKS_OF` jq fold copied from `plot-host.sh:701-707` on three sample rollups, once whole and once with `plot/review` removed (scratch files in `juror-r2-2900-seams/`). No tests run; nothing written except this file.

Executed output (2):

```
CI ok, review pending       -> all: pending  noReview: green  review: PENDING  startedAt 2026-10-29T12:00:00Z
CI ok, review failure       -> all: failing  noReview: green  review: FAILURE
only plot/review, no CI run -> all: green    noReview: none   review: SUCCESS
```

Executed output (1): merged PR #2895 carries `{"__typename":"StatusContext","context":"plot/review","startedAt":"2026-10-29T12:19:36Z","state":"SUCCESS","targetUrl":…}`. The rollup gives `startedAt` and no `description`.

## (a) Round 1 folded

Folded correctly: the HIGH issue at review time (plan line 45, D2); the index record with SHA and a review-free CI colour (line 47); `plot-review.mjs` started detached, not bare `agentRun` (line 50); an in-flight mark every machine sees, a per-head budget, no unattended overwrite of `failure` (line 50); the slice order Tickets → index → scope → rule (line 62); no caller identity here (D1); repair/revert/release PRs named as their owners' starts (Notes); #2899 dropped with a reason (Notes); open question 2 answered (line 63); cost raised as an open question (line 69).

Dropped or wrong:

1. **The step union and its precedence are fixed only by name.** Round 1 seams amendment 7 asked for "the step union, input record and precedence". The plan gives the union `none | review | merge | hold | fixer | ticket` and lists the input (line 49), but no field names, no `hold` reason, and no rule for combining arms. #2903 makes each arm "an exported function with its own test file, so plans that add arms do not conflict in one `switch`" (#2903 *Approach*). Nobody then owns the combinator. See (c).
2. **The pending mark's age is not in the index.** Line 50: "a pending status younger than `REVIEW_BOUND_SECONDS` reads as in flight". Line 47 stores only "the `plot/review` state, the SHA it applies to, and a CI colour". The rule reads the index (line 51), so it cannot compute the age. Executed (1): the GitHub rollup carries `startedAt` at no extra cost, so the row can store it. On Bitbucket `PrReviewReading` (`host.ts:143-150`) has `sha`, `state`, `bypass` and no time.
3. **"with a run id: every machine sees the mark"** (line 50). Executed (1): the rollup returns no `description`, so the run id is not visible through the index. Only a per-PR host read sees it.
4. **Round 1 amendment "the review record reader … name the type the siblings import"** is still open: the plan names no field or type. `PrIndexRow` already has a field called `review` (`pr-index.ts:41`, GitHub `reviewDecision`). A new field needs a name that does not collide, and three siblings (#2902, #2903, #2907) read it.

## (b) Cited facts

Checked and right: `review.ts:486` (`if (findings !== 0)`), `:269` (`openFollowUp`), `:358` (`findingsMarker`), `:395` (`reviewPr`), `:100` (`REVIEW_BOUND_SECONDS = 3600`), `:424-425` (two `removeFile`), `:430` (`trees.add`), `:506` (the "only in ${verdictFile}" line); `pr-index.ts:12` (`PR_INDEX_VERSION = 5`), `:41` (`review`); `plot-host.sh:702-707` (`CHECKS_OF`), `:6061` (`pr-comment` exit 4 on non-GitHub); `host.ts:122-133` (`CommitStatusWrite`), `:376-397` (`prComment`), `:408` (`prReview`); `host-shell.ts:505-512`; `auto-verify.ts:162` (`verifyStart`); `board-run.ts:184` (`startBoardRun`); fleet `auto-verify.ts:153` (`auto-verify-in-flight.json`); `sprint-transition.ts:162` (`sprintFrom`); `sprint.ts:150` (`sprintMembers`); `review.test.ts:608` (the per-PR marker test); `@plot-pm/fleet` depends only on `@plot-pm/domain` and `zod` (`packages/fleet/package.json`).

Wrong or incomplete:

1. **`startBoardRun` does not start a board entry.** Line 35 says it "starts a board entry detached with an in-flight file"; line 50 says fleetd starts `plot-review.mjs` "as `startBoardRun` starts a verify run". `board-run.ts:170-171`: "Starts one board role through `agentRun`"; auto-verify passes `role: 'verify'` (`fleet auto-verify.ts:496`). It runs an agent in fleetd's process group and refuses under `leaveBoardRunsToTheBoard` (`board-run.ts:166-168,199-205`). Starting a node entry (`plot-review.mjs`) is a new spawn site, which must sit under `adapters/` (the CI spawn ratchet). The pattern to copy is `verifyStart` + in-flight file; the start mechanism is new and needs its own name.
2. **"On GitHub the rich `pr-list` arm already fetches `statusCheckRollup`"** (line 47). True for the plain-GitHub arm (`plot-host.sh:4798`). The GitHub + `CI: jenkins` arm does not request it (`plot-host.sh:4744-4749`, "`statusCheckRollup` is NOT even requested"). On that arm the review state reads absent on every row, so the review arm would start a review on every head until the per-head budget runs out. The plan must name what that arm stores.
3. **`rules/review-issue.ts` already exists** (`reviewIssueTitle`, `findOpenReviewIssue`, `REVIEW_ISSUE_LABEL`). The plan says the decision "moves into" it (line 45) but does not say these exports remain only for #2903's ticket.
4. **Two sprint parsers, and an existing domain active-sprint reader.** `parseSprintContent` (`packages/board/src/server/board.ts:1597`) is a second parser beside `sprintFrom`, and `packages/domain/src/adapters/sprint-release.ts:4` already collects every active sprint. The plan moves one parser and names neither of the others.
5. **"Zero or two active sprints give an empty scope"** (line 48). The board supports more than one active sprint (`sprint-selection.ts:137-142`, `showsSprintSlug(activeSprintCount > 1 …)`). An empty scope on two active sprints stops all fleet reviews with no notification named.

## (c) Slices, order, `waits:`, and the sibling seams

The cut and order are right. Each sibling's dependent slice is named below with both quotes.

**`slicePrNext` input record and step union.**

- **#2902 needs cross-row input.** #2902: "the newest MERGED row's `mergedAt` is later than the reading's `askedAt`" → hold `merge-in-flight`, and "Index row reads `mergeable: CONFLICTING`". #2900 line 49: "One pure rule takes … the index row, the scope, the in-flight marks, the per-head start counts and the default-branch reading … one next step per open PR". The newest MERGED row is not "the index row" of this PR. The input record must carry it, or #2902's hold lives outside `slicePrNext`.
- **`hold` carries no reason.** #2902 holds by name (`default-branch-red`, `-stale`, `-unread`, `merge-in-flight`, `conflicting`); #2903 holds on "Fixer in flight" and "CI red, attempts spent". #2900 line 49 has bare `hold`. Name it `{ step: 'hold', reason }` with an open reason set.
- **#2903 needs a step the union lacks.** #2903 arm 5: "ticket recorded, no accepted `success` on this head → write the accepted `success`". The union has `ticket` and nothing for the accepted-success write. #2900 line 50 also needs one: "When a verdict file for the head exists and only the status write failed, the next step writes the status again and starts no review" — that is neither `review` nor `none`.
- **#2903 needs inputs the record lacks.** #2903 reads the fixer attempts record, the ticket record and "desk dead … no live worker on the branch". The record (line 49) has "the in-flight marks" (unspecified whose) and no desk reading.
- **Arm precedence is unowned.** The fixer pushes a new head; CI turns green; the fixer process still runs. #2900's review arm answers `review` (green, no review on head) and #2903's arm 3 answers `hold` (fixer in flight). One rule must say which wins. #2903's separate-functions shape leaves that to whoever composes them; #2900 creates the file and must own the composition.
- **The PLOT-BLOCKED item has no home.** The slice line (line 87) and the slice map end with "a desk holding a `PLOT-BLOCKED` marker is not dead". The Approach never mentions it, and the input record has no desk reading. #2901 relies on it: "#2900's `feature/fleetd-reviews-slice-prs` treats a desk that holds a `PLOT-BLOCKED` marker as not dead, so #2903's fixer arms never fire on a desk this plan answers." #2903 defines the reading itself: "The CI-red condition reads 'desk dead' as no live worker on the branch", with no marker. #2906 puts its own copy into its condition: "no `PLOT-BLOCKED` marker is on the desk". Three plans, three definitions, and the owner named by #2901 builds no reader. Move it to #2903's `feature/fleetd-starts-the-fixer` (the arm that reads "desk dead"), or add a `deskDead` reading with the marker to #2900's input record and to the Approach.

**The indexed review state and its SHA.**

- #2902: "the PR index row records `plot/review` as `success` on the row's `headSha`". #2903: "'HIGH on this head' reads `plot/review=failure` on the PR's head SHA from the PR index". #2907: reads "`plot/review` on the head". All three match line 47 in substance. None can name the field, because #2900 does not. Also name the state vocabulary: `success | failure | pending | error | absent`, with `unread` for a row whose read failed (#2903: "A failed or partial read is `unread` and holds").
- `failure` means HIGH only if every writer keeps that meaning. `review.ts:494` writes `failure` only for HIGH today, and #2903 relies on it. The plan adds a `pending` writer and a Bitbucket "not posted" description; it should state that no new path writes `failure` for anything but a HIGH.

**The CI colour without `plot/review`.**

- #2903 arm 2 reads "CI red" and never names the column. With the old `checks` word a HIGH reads `failing` (executed, row 2), so the CI-red arm and the HIGH arm fire on one row. #2903 needs to name #2900's review-free colour; #2900 needs to name the field it adds.
- Name the colour vocabulary. Executed row 3: a head with only `plot/review` and no CI run reads `none` once the review is removed. The review arm needs `green`, so a PR with no CI run never gets a review. State that.
- The colour's SHA: `checksSha` already exists (`pr-index.ts:79`) and is the rollup's head commit on GitHub only. Say that the review-free colour binds to `checksSha`, and what the review arm reads when `checksSha` is absent (Jenkins, Bitbucket).

**The scope reader's answer.**

- #2907: "when every scope plan is Delivered" and "wait for the scope". #2900 line 48: "Zero or two active sprints give an empty scope and a reason". With an untyped empty answer, "every scope plan is Delivered" holds vacuously on an empty scope. The answer must be a discriminated union (e.g. `{ read: 'scope', sprint, slugs }` | `{ read: 'none', why }`), and #2907 must hold on `none`.
- #2902: "fleetd merges only open slice PRs of that scope, through #2900's scope reader". The reader answers plan slugs. Neither plan names who maps an open PR's branch to a scope plan (each plan's `## Slices` branch list). Line 49 says "a slice PR of a scope plan" and the input record has no branch → plan map.
- "At its latest commit" names no ref. fleetd's checkout can lag `origin/<default>`. Name the ref the adapter reads.

**The detached review start and its in-flight mark.**

- **#2907 starts the reviewer through a different path.** #2907: "fleetd starts the reviewer role on the release PR's head through #2898's detached start and #2900's start guard". #2900 Notes: the release PR "starts the reviewer on its own PR through the detached start this plan builds". A role start through #2898 runs the agent and writes no `plot/review` — the exact seam round 1 found (`review.ts` keeps the only write, #2898 line 65). "#2900's start guard" is not a named export here. #2900 must export the start (e.g. `startReview(pr)`, its refusal set, the in-flight file path) and #2907 must call it, not #2898's role start.
- **#2904 does not wait on the start it uses, and both plans think the other triggers it.** #2904 slice 3: "`feature/fleetd-starts-main-repair` — … opens its fix PR, reviewed by #2900's reviewer `<!-- waits: feature/role-agents-start-detached -->`" — no wait on `feature/fleetd-reviews-slice-prs`. #2904 *Approach* 5: "#2900's reviewer runs on the fix PR because the repair record names it", and D3: "the repair record, not the scope reader, names the PR the reviewer … admit[s]". #2900 Notes: "each starts the reviewer on its own PR through the detached start this plan builds", and line 49 admits only scope plans' slice PRs. So #2904 expects #2900's rule to read the repair record, and #2900 expects #2904 to call the start. Neither builds it. #2904 slice 4 (revert PR) has no `waits:` at all and needs a review to merge (`review-not-passed` still refuses it, #2904 *Approach* 4).
- **Two liveness readings.** #2898 slice 4 builds "a liveness reading for a role run"; #2900 builds "an in-flight file read with pid liveness and a start grace" (line 50). Say why the review needs its own (it starts a node entry, not a role) so #2907 does not pick the wrong one.
- **Worktree owner.** #2898 table: reviewer runs in "a detached worktree at the PR head, created by fleetd". #2900 D5: "This plan starts `plot-review.mjs` … and creates the review worktree itself", and today `reviewPr` creates it (`review.ts:430`). Settle on `reviewPr`, and correct #2898's row.
- **The concurrency refusal is unnamed.** Line 50: "`reviewPr` refuses before it removes any file when another run holds the same PR and head". Which record does a person's manual `plot-review` see: fleetd's in-flight file, the pending status, or a lock under `reviews/`? #2907's start and a person's run need the same answer.
- **Where the start counts live.** The input has "per-head start counts" and a budget; the in-flight file holds "pid, PR, head and start time". If the counts are in memory, a fleetd restart resets the budget and the loop the budget exists to stop returns. Name the record.

**Run log.** #2899: "#2900 and #2901 name this plan as a need" (*Notes*), while #2900 Notes say "this plan does not depend on it". #2899's idle clock starts at "its last line that moved it", so a review start resets nothing and a head left "pending for a person" past its budget (line 50) is reported only as idle after `Slice idle after`. Either log `review-started` / `review-budget-spent` steps, or say that the idle notification is the only signal and correct #2899's note.

**`waits:` annotations.** #2902 slice 2, #2903 slice 2 and #2907 slice 2 wait on `feature/fleetd-reviews-slice-prs`, which comes after the index and scope slices in this plan, so the wait covers them. #2904 slices 3 and 4 need `<!-- waits: feature/fleetd-reviews-slice-prs -->`.

## (d) Open questions

- Q1 (`plot-review-status.sh`): not answerable from the seams lens beyond this: no sibling reads it, so the launcher option creates no sibling seam.
- Q2 (Bitbucket comment): the seam is #2903. It reads findings from the verdict file, which stays local on both hosts, so the fixer works on Bitbucket either way. A reader on ewz-kus-portal gets nothing until a `bb` comment write exists.
- Q3 (cost): #2903 re-reviews after each fixer push, so the per-sprint figure is at least (slices × pushes) + (HIGHs × 2). A per-sprint budget needs the start-count record named in (c).
- New: the Bitbucket index write. Line 47: "On Bitbucket the writer asks `pr-review` per open slice row". `pr-refresh.ts` does not know which rows are slice rows, and `pr-review` on Bitbucket is one PR read plus two paged walks (`plot-host.sh:4400-4403`) per row per refresh. Name the filter and the call count.
- New: the CLAUDE.md section *A Decision Reads The Index* says "Only a terminal answer is read from the index" and "another consumer needs its own paragraph here". The review state and the CI colour are not terminal. This plan adds the first non-terminal consumer that #2902 and #2903 then share. The paragraph belongs to this plan's slice 4.
- New: a head whose start budget runs out "stays pending for a person" (line 50). Which reader tells the person, and does `pending` on the head block a person's manual re-review (the "no unattended overwrite" rule covers `failure` only)?

## (e) Tests

The plan names no test per slice. Proposed tiers:

- `feature/a-review-opens-no-issue`: board unit, `review.test.ts` with `host-fixture` — HIGH 1 / MEDIUM 2 opens no issue (`opened` length 0), posts one marked comment, writes `failure`; a second head edits the same comment (`prComments` length 1); Bitbucket `unaskable` names the verdict file and the status description. Domain unit for `rules/review-issue.ts` answering none for every count.
- `feature/the-index-records-the-review`: domain unit on the fold, with the three executed rollups above as fixtures (`pending` + `startedAt`, `failure` → review-free `green`, review-only → `none`); the Jenkins arm answers absent/`unknown`, never `green`; decode refuses v5 under the bump.
- `feature/the-scope-is-read-from-git`: domain unit over sprint texts (struck item out, zero/one/two active sprints, the discriminated `none` answer); one adapter test on a temp git repo reading the named ref.
- `feature/fleetd-reviews-slice-prs`: domain table test of the review arm with readings as values (green on head + absent → `review`; review on older SHA → `review`; live pending → `none`; old pending + budget left → `review`; budget spent → `none`; red main → still `review`; verdict file present + status missing → the rewrite step); a precedence test with a live fixer mark and a green new head; a fleet unit test that two passes start `plot-review.mjs` once per head and a restart keeps the count; the spawn ratchet count does not grow outside `adapters/`.

## Amendments

1. Publish `slicePrNext`'s types: the input record with field names (including the newest MERGED row, a desk reading, the fixer and ticket records as optional sibling fields), `hold` with a reason, a step for "write the status" (#2900's rewrite and #2903's accepted `success`), and the composition order of the arms. This plan owns the composer.
2. Name the new `PrIndexRow` fields (not `review`, which is taken), their vocabularies, the review state's `startedAt`, and the binding of the review-free colour to `checksSha`. Say what the GitHub + Jenkins arm and Bitbucket store.
3. Correct line 35 and line 50: `startBoardRun` starts an agent role, not a board entry. Name the new adapter that starts `plot-review.mjs`, its export, its refusal set, its in-flight file path and the record that holds the per-head start count across restarts.
4. Type the scope reader's answer as a discriminated union, name the ref it reads, name who maps a PR branch to a scope plan, and say whether two active sprints stop the scope.
5. Move "a desk holding a `PLOT-BLOCKED` marker is not dead" to #2903's fixer slice, or define the reading in this plan's Approach; correct #2901's note and #2906's duplicate either way.
6. Fix the sibling quotes: #2907 starts the release review through this plan's export, not #2898's role start; #2904 slices 3 and 4 wait on `feature/fleetd-reviews-slice-prs`, and one plan (not both) says who starts the repair and revert reviews; #2898's reviewer row names `reviewPr` as the worktree creator; #2899's note drops #2900 or this plan logs its review steps.
7. Add the *A Decision Reads The Index* paragraph for the non-terminal review consumer to slice 4.
8. Add a test line per slice as in (e).

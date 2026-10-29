# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2905 (`gh issue view`), DESIGN-delivery-loop.md, the sibling plans for #2903, #2901, #2902 and #2899 (grep over ticket/record/comment), `packages/domain/src/adapters/tracker/tracker-plan-state.ts`, `packages/domain/src/rules/issue-status.ts`, `packages/domain/src/ports/tracker.ts:85-110,215-235`, `packages/domain/src/adapters/tracker/tracker-jira.ts:285-300`, `packages/domain/src/adapters/tracker/tracker-fixture.ts:205-216`, `packages/domain/src/rules/deliverable.ts:1-190`, `packages/board/src/server/entry/plan-state.ts:90-214`, `packages/board/src/server/entry/deliver.ts:520-555`, `skills/plot/scripts/plot-issue-status.sh`, `packages/domain/vitest.config.ts`, and the fixtures in `packages/domain/test/tracker-plan-state.test.ts` and `packages/board/test/unit/plan-state.test.ts`. Ran: `pnpm install` in the worktree; `vitest run test/tracker-plan-state.test.ts test/issue-status.test.ts test/deliverable.test.ts` in `@plot-pm/domain` (3 files, 109 tests, all pass); and an esbuild-bundled probe over the real sources (`juror-2905-testability/probe.ts`) that printed the comment bodies, `issueStatusWrites` per phase, and Jira's `planStateWrite` answer.

## (a) Problem statement

- Correct: `planStateComment` writes the marker plus one line `Plan <phase>: <link>` (`tracker-plan-state.ts:44-47`). Probe output: `"<!-- plot:plan-link -->\nPlan approved: docs/plans/x.md"`.
- Correct: `issueStatusWrites` owes a write at `approved`, `delivered`, `released` only (`issue-status.ts:46-57`). Probe: `draft []`, `approved [{"issue":"KUS-1","status":"In Progress"}]`, `delivered [...In Review]`, `released [...Done]`.
- Missing fact: the Jira connector writes no plan comment at all. `tracker-jira.ts:294-300` answers `no-target` for every `planStateWrite`; the probe confirmed `{"ok":true,"value":"no-target"}`, and `tracker-plan-state.test.ts:161` pins "a Jira tracker closes nothing and comments nothing". On Jira there is no comment to show progress, tickets or answers. The plan's Jira slice "at the same points as the comment" has no comment on that tracker to align with.
- Missing fact: the comment body is the WHOLE comment, replaced on every write (`githubPlanStateWrite` step `issue-comment <n> <marker> <body>`, `tracker-plan-state.ts:76`). The probe's delivered body is one line. So any later writer that does not render the ticket and answer lists erases them. Today the writers are `approve.ts:1174`, `deliver.ts:546` and `:955`, `plot-idea` SKILL step (`plot-plan-state.sh --phase draft`), and `/plot-release`. The plan's "rebuilt from recorded state on every write" holds only if every one of those callers reads the record; the plan names none of them.
- Inconsistent source for the count: the Approach names `plot-pr-merged.sh` (a shell script) and, two paragraphs later, "each write reads the PR index". A TypeScript write point that calls `plot-pr-merged.sh` breaks the layering rule unless it goes through an adapter, and the domain already counts landed slices over a pulse in `deliverable.ts:122-189` (`landed`).

## (b) Approach

- Slice 1 is testable as a pure function if the count is a domain rule over the pulse (`FleetReading`), as `allSlicesMerged` is. It is not testable without a live host if it reads `plot-pr-merged.sh` per branch.
- "After each slice merge" names no trigger. If the trigger is #2902's merge, a person's merge writes no progress line, though the design's *One merge in flight* counts every merge. The IndexMonitor already publishes `pr merged` (`index-findings.ts:105`, `attention.ts:86`); CLAUDE.md *A Decision Reads The Index* part 3 allows a decision triggered by an index update. That trigger covers both merge sources and is fleet-unit testable with a fake event.
- No idempotency guard is named. The port forbids reading the comment back (`tracker.ts:221-228`), so the writer cannot compare. Rewriting on every pulse costs two host calls per issue (`issue-label` plus `issue-comment`). The plan needs either an event trigger or a recorded "last progress written" value.
- Slice 2 duplicates two sibling slices. #2903's `feature/a-high-finding-is-fixed-before-ticket` already says "link it from ... the plan issue's comment"; #2901's `feature/an-answer-is-recorded-on-the-plan-issue` builds "the answers list in the plan issue's Plot comment". Three plans writing one comment, each with its own body, is the line-loss defect in (a). One plan must own the renderer and the others must write records only.
- Slice 3: on GitHub the plan-state write is the label plus the comment; on Jira it is `no-target`. The three Jira transitions already exist (`plot-issue-status.sh`, called at `deliver.ts:531`, and at approve and release). Unless open question 1 adds a new transition, slice 3 builds nothing, and its acceptance criterion cannot fail.
- Domain coverage is a gate at 100 % (`packages/domain/vitest.config.ts`, `all: true`): a new renderer or count rule in `packages/domain/src` needs a test for every branch, including the cut for comment size.

## (c) Slices

- Slice 1 is a clean cut if it holds the count rule, the optional count field on `PlanStateWrite`, and the event-driven write point.
- Slice 2 must either own the renderer for tickets and answers (and #2903/#2901 drop their comment wording and write records only) or leave this plan. In both cases it waits on the record shapes of #2903 and #2901, which neither plan defines yet ("The file shape is left to the builder", #2903 line 38).
- Slice 2 must also thread the record into every existing caller of `plot-plan-state.sh` (approve, deliver ×2, release, draft), or the Delivered write erases the lines. That is a board-entry change and belongs in the slice's acceptance.
- Slice 3 should be dropped or rewritten after open question 1 is answered. Proposed answer: drop it; the design's "same three points" already ship.

## (d) Open questions

1. *Which points does Jira transition at?* The design table line 156 says "the same three points", and those ship today (probe output above). A transition per progress step would re-write `approved`'s word, which `noTransitionOutcome` reports as `already` (`issue-status.ts:227`). Answer: nothing new; drop slice 3, or name a new config key and phase if a first-merge word is wanted.
2. *Unblocker record shape* — unanswered by #2901 (it records on the comment directly, slice `an-answer-is-recorded-on-the-plan-issue`). This plan must demand a record file, not a comment write, from #2901.
3. *Sprint item* — the design table line 155 says ticked at delivery (today, `rules/sprint-tick.ts`) and closed after the release, which #2907's plan owns. Answer: this plan adds nothing for the sprint item; say so and remove "the sprint item" from the summary line.
4. *Comment size* — GitHub's issue comment limit is 65,536 characters. A pure renderer with a cap is unit-testable: a fixture of 200 answers asserts the body stays under the cap and ends with a link line.
- New: which count is M — slices or branches, and are deferred slices in M? `landed` counts branches and exempts deferred ones (`deliverable.ts:150-178`). "2 of 3 slices merged" needs a stated rule and a test pinning it.
- New: does a `subject`-evidence branch count as merged for the progress line? A progress line is reversible, so `allSlicesMerged`'s reading (not `allSlicesConfirmed`'s) is enough; state it.
- New: what triggers the write, and what stops a repeat write on every pulse?
- New: a plan with several issues (`planStateWrites` writes one per issue) gets the same body on each; confirm.

## (e) Tests

| Slice | Tier | Fixture | Assertion | Needs live fleet/host/browser? |
|---|---|---|---|---|
| 1, count rule | domain unit (`packages/domain/test/`) | a `FleetReading` with one plan of three slices, one `complete`, one open, one deferred, built as in `deliverable.test.ts` | `sliceProgress(...)` returns `{merged: 1, total: 2}` (or whatever rule (d) settles); `null`/`unknown` on a partial pulse | No |
| 1, comment body | domain unit, extend `tracker-plan-state.test.ts` "the label and comment text" | `PlanStateWrite` with `{phase:'approved', progress:{merged:2,total:3}}` | body line 1 is the marker; body contains `2 of 3 slices merged`; a write without `progress` is byte-identical to today's body | No |
| 1, in-place edit | domain unit, the existing `issueHost()` stub `plot-host.sh` (`tracker-plan-state.test.ts:27-60`) | approved, then approved+progress 1/3, then 2/3 | `comments()` has length 1 and holds `2 of 3` | No |
| 1, write point | fleet unit (`packages/fleet/test/unit/`) | a `pr merged` index finding for a slice branch, `trackerFixture({planStates})` | exactly one `planStates` entry with the progress; a second identical event writes nothing | No |
| 2, renderer | domain unit | a record of 2 HIGH tickets and 3 answers; and 200 answers | body lists both tickets with links and each answer with author; the 200-answer body is under the cap and ends with a link | No |
| 2, no line loss | domain unit with `issueHost()` | approved+tickets write, then delivered write built from the same record | final comment still names both tickets | No |
| 2, every caller reads the record | board unit over `plan-state.ts` `run` (`plan-state.test.ts:94-147` pattern) | a plan file plus a record file in a temp repo, `trackerFixture` | the `PlanStateWrite` handed to the port carries the tickets at phase `delivered` | No |
| 3 | domain unit `issue-status.test.ts` | only if a new phase or word is added | `issueStatusWrites` owes the new word at the new point | No |

Every row runs without a live fleet, a live host or a browser. As written, the acceptance criteria are not all checkable: "after each slice merge" names no trigger to fire in a test, "names each HIGH ticket" names no record to build a fixture from, and slice 3's "same points as the comment" has no comment on Jira to compare against.

## Amendments

1. Name the count source as a domain rule over the pulse (a sibling of `allSlicesMerged` in `rules/deliverable.ts`), remove `plot-pr-merged.sh` from the Approach, and define M (slices or branches, deferred in or out).
2. Name the trigger: the IndexMonitor's `pr merged` finding, so a person's merge and a fleet merge both write; name the guard against a repeat write.
3. Settle ownership of the comment with #2903 and #2901: this plan owns one renderer; those plans write records (file under `.plot/state/` or in the plan) and never write the comment. Name the record shape or make slice 2 wait on it.
4. Add to slice 2's acceptance: every existing `plot-plan-state.sh` caller (approve, deliver at `deliver.ts:546` and `:955`, release, draft) passes the record, so the Delivered and Released writes keep the ticket and answer lines.
5. Record in the Motivation that Jira takes no plan comment (`tracker-jira.ts:294-300`), answer open question 1 with "nothing new", and drop slice 3 or rewrite it to a named new transition.
6. Remove "the sprint item" from the summary line, or name what this plan does for it.
7. Put the comment-size cap into the renderer with a stated number and a test.

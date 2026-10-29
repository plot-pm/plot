# Juror verdict: seams (this plan against its nine siblings and the story design)

Position: amend

Evidence: read the plan, issue #2904 (`gh issue view`), `DESIGN-delivery-loop.md`, and the Design and Slices sections of all nine sibling plans (#2908, #2909, #2911–#2917 worktrees). Read `packages/domain/src/workflows/merge.ts:1-160`, `packages/domain/src/entities/default-branch.ts:1-80`, `packages/fleet/src/shared/default-branch-refresh.ts` (grep), `packages/fleet/src/server/entry/registryd-main.ts:2863`, `packages/domain/src/adapters/agent-run/agent-run-command.ts:53-68`, `packages/board/src/server/entry/merge.ts` (grep). Ran: one vitest file in `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-2904-seams/red-merge.test.ts` that calls `merge()` with a green, pinned revert PR against a red, fresh default-branch reading. Output: `{"outcome":"refused","reason":"default-branch-red"}`, and `defaultBranchRed(reading, now, 3600000)` returns `true`.

## (a) Problem statement

- Facts check out: `registryd-main.ts:2863` maps `'default-branch-red': 'queue'`; `default-branch.ts` records `failingRuns` and `settled`; `.claude/agents/` does not exist.
- Missing fact: the reading has no field for "the merge that turned main red" and no "first red" time. `DefaultBranchReadingSchema` holds `headSha`, `settled`, `failingRuns`, `headSince`, `askedAt`, `at` (`entities/default-branch.ts:44-70`). `settled` advances and keeps no last-green SHA, so the plan's rule input "the merge that turned it red" and the bound "measured from the first red reading that settled" exist in no recorded state today. The repair record (approach item 5) must carry the last green SHA and the first-red time, or the refresh must add them. The plan leaves the shape to the builder and so leaves this input unowned.

## (b) Approach — seams with siblings

1. **The revert and the fix PR cannot merge through `workflows/merge.ts` while main is red. Executed, not inferred.** `merge.ts:127-129` refuses `default-branch-red` for every PR, and #2902 (`fleetd-merges-slice-prs-one-at`) adds a `slice-pr-next` row "Default branch red or stale → hold". Both PRs this plan opens exist only because main is red, so both are refused by the two pieces the plan relies on. "Jumps the queue" is named in the plan and the design and built by nobody. This plan owns the exception, and it must be a narrow, named one: a PR this plan's repair record names (the fix PR or the revert PR) may merge on a red, fresh reading; `default-branch-stale` still refuses. It touches `merge.ts`, which #2902 and #2911 (`release-approve`) also call, so the slice must state that their refusal stays unchanged for every other PR.
2. **Unnamed dependency on #2898 (`fleet-roles-are-declared-agents`).** #2898's *Definitions* slice builds `.claude/agents/main-repair.md`, and its *Runner* slice makes `agentRunCommand` take a role. Today `agentRunCommand` runs a fixed `deps.fragment` (`agent-run-command.ts:63-65`) and takes no role. The plan says "the role runs through the existing `agent-run` port", which cannot start `main-repair` before #2898 merges. Answer to open question 2: #2898 owns `main-repair.md`; this plan must not add it, and slice 2 waits on #2898's Runner and Definitions slices.
3. **Unnamed dependency on #2900 (`fleetd-reviews-every-slice-pr-in`).** "The PR goes through the same loop as a slice PR" means `rules/slice-pr-next.ts`, which #2900 creates. #2900 also adds the scope reader that restricts the tick to the sprint's plans. A main-repair fix PR and a revert PR belong to no slice heading and no sprint plan, so the scope reader excludes them and the loop never sees them. Either this plan adds a "repair PR" input to `slice-pr-next` (owner: this plan, after #2900), or the repair PRs bypass the loop and get their own review start. The plan must pick one. The `plot/review` status is a required check (design, *Constraints*), so a revert PR also needs a reviewer run before it can merge; the plan's step 3 omits the review.
4. **Unnamed dependency on #2899 (`the-delivery-loop-keeps-a-run`).** The plan's board-impact line says "the board shows the repair and the revert as steps of the run log". #2899 owns the run log and its line format (slice, PR, head, step, outcome, time). A repair has no slice; #2899's line shape needs a value for it. Name #2899 and agree the step words (`main-repair-start`, `revert-open`, `revert-merge`) with it.
5. **Unnamed dependency on #2903 (`a-high-finding-is-fixed-before`) for the ticket.** The design calls the revert ticket "HIGH-style". #2903 builds the ticket writer through the tracker connector (`ai-generated`, plan author, link from the plan issue's comment). This plan should call that writer and not build a second one. #2905 (`tickets-follow-the-delivery-loop`) renders the ticket list in the plan issue's Plot comment; "linked from the plan's issue comment" is #2905's renderer, so the revert ticket must use whatever record #2905 reads.
6. **The new slice heading on a Delivered plan is never dispatched.** Auto-dispatch takes approved plans (`auto-dispatch.ts:159`, per the design's table). A Delivered plan that stays Delivered and gains a slice heading has no route to a desk, and #2900's frozen scope does not include it in a later sprint either. Also, writing a slice heading is a plan-file change on the default branch: under `Plan PRs: required` and *The Master Agent Uses The Controllers* it needs a controller route (the `reslice` endpoint is the nearest; it is HTTP only). The plan names neither the writer nor how the slice is dispatched.
7. **Caller identity.** The plan does not mention it. `packages/board/src/server/entry/merge.ts` holds no `PLOT_UNATTENDED` check today (grep: 0 hits), so the merge needs no lift; but the fix PR's merge and the revert happen under fleetd, and #2898's caller-identity slice is the design's only sanctioned unattended route. Name it for consistency with #2902, which names the same dependency.
8. **Repair record vs fixer attempts file.** The repair record (approach item 5) is a different file from #2903's per-PR attempts file. That is correct: a repair is per red episode, not per PR. Say so, and say whether a main-repair PR that goes red takes a fixer attempt from #2903's file (the design table would start a fixer on it once the main-repair agent ends).

## (c) Slices

- Slice 1 (rule) is independent and mergeable after #2902's in-flight mark exists; it should also own the repair record and its two missing fields (last green SHA, first-red time).
- A slice is missing: the `merge.ts` / `slice-pr-next` exception for a repair-record PR on a red main. Without it slices 2 and 3 cannot finish. It waits on #2900 and #2902.
- Slice 2 waits on #2898 (Runner, Definitions) and the missing slice. Slice 3 waits on the missing slice and #2903's ticket writer.
- The "new slice heading" deliverable is a lifecycle write with no route; it should leave slice 3 for its own slice, or the plan should drop it until a controller writes slice headings.

## (d) Open questions

- Q1 (`waits:` on #2902): yes, a `waits:` on slices 2 and 3, and the plan must also name #2898, #2900, #2899 and #2903 (see (b)). An issue link alone does not order the slices.
- Q2 (`main-repair.md`): #2898's *Definitions* slice owns it (`<!-- builds: reviewer.md, fixer.md, unblocker.md, main-repair.md -->`). This plan adds nothing under `.claude/agents/`.
- Q3 (which merge turned main red): with #2902's one-merge-in-flight in force, at most one fleet merge lands between two settled readings, so the fleet case has one candidate. A person's merges can still stack. The proposal needs the last green SHA, which no file holds today.
- Q5 (stale reading): answered by current code — `merge.ts:121-125` already refuses a reading older than `Checks wait`, and `defaultBranchRed` stops holding it. The rule should answer `hold` (not `revert`) on a stale reading, because the bound clock cannot be trusted without a fresh red.
- New: who runs the reviewer on the fix PR and the revert PR, given `plot/review` is required?
- New: does the 60-minute bound pause while the repair PR is open and its CI is running, or does a revert race a fix PR that is green and waiting for review?
- New: if the revert itself goes red, what happens? The rule needs a terminal answer (notify, per #2899's stall rule) rather than a second revert.

## (e) Tests

- Slice 1: domain unit tests per answer (`hold` on stale, `start-repair` on first fresh red, `await-repair` while a repair is in flight, `revert` after the bound, `none` on green), readings as values.
- Missing slice: a unit test in `merge.test.ts` that the PR named by the repair record merges on a red reading, and that every other PR still refuses `default-branch-red` (the test I ran is its negative half).
- Slice 2: a fleet tick test with a stubbed `agent-run` port asserting one `main-repair` start per red episode.
- Slice 3: a fleet tick test with a stubbed host asserting one revert PR, a merge pinned to its head only on green, and one ticket call through #2903's writer when the plan is Delivered.

## Amendments

1. Add a slice that lets a PR named by the repair record merge on a red, fresh reading through `merge.ts` and `slice-pr-next`; keep `default-branch-red` for every other PR; place it after #2900 and #2902.
2. Name #2898 (Runner, Definitions, caller identity), #2900 (`slice-pr-next`, scope reader), #2899 (run log) and #2903 (ticket writer) as dependencies, with `waits:` annotations on the slices that need them.
3. Remove the plan's own claim to `.claude/agents/main-repair.md`; #2898 owns it.
4. Make the repair record carry the last green SHA and the first-red time, and state that it is separate from #2903's attempts file.
5. Name a reviewer start for the fix PR and the revert PR.
6. Name the writer of the new slice heading and how a slice on a Delivered plan reaches a desk, or move that deliverable out of this plan.

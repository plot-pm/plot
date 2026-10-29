# Juror verdict: seams against the nine sibling plans and the story design

Position: amend

Evidence: read the plan (worktree at a67cb8449), `DESIGN-delivery-loop.md`, issue #2900 (`gh issue view`), and all nine sibling plans (#2908, #2909, #2910, #2911, #2912, #2913, #2914, #2915, #2916). Read `packages/board/src/server/entry/review.ts` (lines 56-67, 405-425, 478-527), `packages/domain/src/ports/host.ts:143-150` and `:385-410`, `packages/domain/src/entities/pr-index.ts:30-64`, `packages/domain/src/adapters/host/host-shell.ts:110,510-513`, `skills/plot/scripts/plot-host.sh:702-707,4795-4813,4407,6062-6063`, `skills/plot/templates/sprint.md`, `packages/domain/src/rules/` listing. Ran: the `CHECKS_OF` jq fold from `plot-host.sh:702-707` against three sample rollups (output below); greps for `plot-review`/`UNATTENDED` in `review.ts` and `packages/fleet/src`, for `slice-pr-next.ts` (absent on main), for an existing active-sprint reader (none in `packages/fleet/src`). No tests run; nothing written except this file.

## (a) Problem statement

- The motivation is right: no file under `packages/fleet/src` names `plot-review` (grep, 0 hits), so fleetd never reviews.
- `review.ts:58-66` is the doc comment, not the behaviour. The decision is `review.ts:483-488` (`if (findings !== 0) openFollowUp(...)`, where `findings = high + medium + low`). Cite those lines.
- **The cited cause is incomplete.** `review.ts:483` opens a follow-up issue for a HIGH too, at review time. The design says a HIGH ticket exists only after two fixer attempts fail (*Goals* 2, *Tickets* row 2). This plan removes the issue for MEDIUM and LOW only; #2912 (#2903) lists MEDIUM/LOW as out of scope and never says it removes the immediate HIGH issue. **No plan in the story removes it.** After both plans merge, a review with HIGH 1, MEDIUM 3 still opens an issue at once.

## (b) Approach

1. **The review record has no owner and does not exist in the index.** The plan says the rule "reads the PR index row, the review record" and that the decision reads the index (line 38). Measured: the index row's `review` field is GitHub's `reviewDecision` (`plot-host.sh:4807`, `host-shell.ts:110`), not `plot/review`. The `plot/review` state and SHA are reachable only through `host.prReview` (`ports/host.ts:143-150`, `plot-host.sh:4407`), a live host read. A decision that calls it breaks *A Decision Reads The Index* part 2. #2914 (#2902) and #2912 (#2903) both read "the review record" and neither builds it. This plan reads it first, so it owns it: a `plot/review` state + SHA field folded into the PR index row by `pr-refresh.ts` (the one writer, with a `PR_INDEX_VERSION` bump), or a reader over the existing per-head files `reviews/<pr>-<sha>.md|.issue` under the common dir (`review.ts:413-416`). Name which, and name the type the siblings import.
2. **"CI green" cannot be read from the index `checks` word once a review exists.** Ran the `CHECKS_OF` fold:
   ```
   CI success, no plot/review           -> {"checks":"green","failing":[]}
   CI success, plot/review FAILURE      -> {"checks":"failing","failing":["plot/review"]}
   CI failure, plot/review SUCCESS      -> {"checks":"failing","failing":["CI"]}
   ```
   `checks` folds the whole rollup, `plot/review` included. A HIGH review therefore turns the row `failing`, and #2903's "CI red, desk dead → fixer" arm and its "HIGH, desk dead → fixer" arm read the same row. The rule needs `failing_checks` minus `plot/review`, and `failing_checks` is absent on the Jenkins arm (`pr-index.ts:44-46`). This plan defines the rule's input, so it must define "CI green" as excluding `plot/review`, and say what an absent `failing_checks` reads as.
3. **The reviewer start goes through the wrong seam.** The plan says the reviewer starts "through the existing `agent-run` port and `agentRunCommand`, with its charter". The `plot/review` status, the diff, the verdict file and the follow-up all live in the entry around that port (`review.ts:405-527`); a bare `agentRun` writes no status. fleetd must start `plot-review.mjs <pr>` as a process through an adapter (one new spawn site inside `adapters/`, so the CI spawn ratchet does not move). #2908 slice 1 changes `agentRunCommand` to `claude -p --agent <role>` and says "the reviewer starts through it" — that is the runner inside `review.ts`, owned by #2908. This plan owns only the fleetd-side start of the entry.
4. **No in-flight guard.** A review runs up to `REVIEW_BOUND_SECONDS = 3600` (`review.ts`). The row reads "no review on this head" for that whole time, so every pulse starts another reviewer on the same head. The design's merge in-flight mark is derived from main; nothing covers a review. The natural record is #2909's run log ("a decision may read it", #2909 *Approach*): a `review-started <pr> <sha>` line read back by the rule. The plan says it needs #2899 and never says what it uses from it; this is the use.
5. **Caller identity is not needed here.** `review.ts` has no `PLOT_UNATTENDED` refusal (grep, 0 hits), and the reviewer acts through no `continue`/`restart`/`merge` controller. The dependency on #2898 is therefore the role-aware runner only, and this plan can merge before it (today's charter command already runs the reviewer). #2914 says "This plan depends on #2900 for that identity" — that is wrong; the identity is #2908's slice `feature/fleetd-caller-identity`. This plan should state that it builds no caller identity, so #2914 corrects its dependency.
6. **The scope excludes PRs the siblings route through this loop.** #2910 (#2904) sends the main-repair fix PR and the revert PR "through the same loop", and #2911 (#2907) needs a review on the release PR. None of them belongs to a sprint plan, so slice *Scope* ("restrict the tick to that scope") stops the reviewer on all three, and the ruleset then blocks their merge. The scope reader must admit a repair PR, a revert PR and the release PR, or this plan must expose the reviewer start as a step the other rules call directly. #2911 also writes its own "run the reviewer on the head"; it should call this plan's start rather than add a second one.
7. **The step type is shared and nobody defines its shape.** #2912 says "the rule's input type" is "read from the design only". This plan creates `rules/slice-pr-next.ts`; it should fix the step union (`none | review | merge | hold | correction | fixer | ticket`), the input record, and the precedence. Precedence matters: the design's "default branch red or stale → hold" row must hold the merge and not the review, or a red main stops every review while #2910 tries to repair it.

## (c) Slices

- **Order is wrong for the cost.** Slice *Rule* wires the tick with no scope and no `waits:`. If it merges first, fleetd reviews every open slice PR of every plan, and each review still opens a MEDIUM/LOW issue, because slice *Tickets* has not landed — the 22-issue pile grows at fleet speed. Order: *Tickets* first, then *Scope*, then *Rule* with `<!-- waits: feature/fleetd-reviews-sprint-scope -->`.
- **Duplicate tick wiring with #2914.** This plan's slice *Rule* ("wire fleetd's tick to start the reviewer") and #2914 slice *The tick* ("fleetd's tick calls the rule for each open slice PR of the scope") both build the per-PR loop in the tick. Owner: this plan builds the loop over the scope and dispatches on the step union; #2914 adds only the merge executor arm. Say so in both plans.
- **Missing slice or explicit hand-off:** the review record reader (b.1). It belongs in this plan, either inside slice *Rule* or as its own slice before it.

## (d) Open questions

- **Freeze point:** neither a new state file nor the sprint file's current text. The template has `State:` and `Start:` (`skills/plot/templates/sprint.md:7-9`), and only `plot-sprint-state.sh` writes `State: Active` under the state gate. The frozen scope is the item list of the sprint file at the commit that set `State: Active` — re-derivable from git for free. A state file holding it would be a persisted verdict, which *Answers, never verdicts* refuses. Answer: read it from git.
- **One comment per head or one edited comment:** the mechanism exists. `host.prComment(pr, body, marker)` edits the comment holding the marker in place (`ports/host.ts:385-397`, `plot-host.sh:6062-6063`), and `review.ts:358` already defines `findingsMarker(pr)` = `<!-- plot-review-findings pr-N -->`, per PR, not per head. Answer: edit one marked comment per PR, and name the head inside the body. Note that Bitbucket answers `unaskable` for `prComment` (`host-shell.ts:504-509`); the plan should say where findings go there.
- New: who removes the immediate HIGH issue at review time (a.3)? Proposal: this plan's slice *Tickets* stops `review.ts` from opening any issue; #2912 opens the HIGH ticket after attempts. Between the two, a HIGH holds the PR at `plot/review=failure`, which is the safe side.
- New: does "no review on this head" mean `absent` only, or also a `pending`/`error` status? `review.ts` writes no `pending`.
- New: which file or index field is the review record (b.1), and what its type is called.

## (e) Tests

- Slice *Tickets*: unit test on `review.ts` with `host-fixture` — HIGH 0 / MEDIUM 2 opens no issue, posts one PR comment with `findingsMarker`, writes `success`; a second run on a new head edits the same comment (fixture `prComments` length stays 1). A HIGH case asserts whatever the plan decides in (d).
- Slice *Scope*: domain unit test over two sprint-file texts (at the activating commit and at HEAD with an added item) that the reader returns the activation-time set; corpus-free, no git.
- Slice *Rule*: domain unit tests per row with readings as values: `checks: failing, failing_checks: ['plot/review']` with no review on head → not "CI red"; review state on an older SHA → `review`; a `review-started` run-log line for this head → `none`; default branch red → still `review`. Plus one fleet unit test that the tick starts `plot-review.mjs` once per head over two pulses.

## Amendments

1. Cite `review.ts:483-488` and state that today a HIGH also opens an issue at review time; decide who removes it (proposal: this plan, slice *Tickets*).
2. Own the review record: name the reader (PR index field or the `reviews/<pr>-<sha>` files) and its exported type; do not read `host.prReview` in the decision.
3. Define "CI green" as the rollup minus `plot/review`, and say how an absent `failing_checks` reads.
4. Start `plot-review.mjs` through an adapter, not the bare `agent-run` port; leave the `--agent` runner change to #2908.
5. Add an in-flight guard for a running review and name #2909's run log as its record; otherwise drop the #2899 dependency.
6. Admit the main-repair PR, the revert PR and the release PR to the reviewer (or expose the start for #2910 and #2911 to call).
7. Publish the step union, input record and precedence of `slicePrNext`; red main holds merges, not reviews.
8. State that this plan builds no caller identity and owns the per-PR tick loop; #2914 adds the merge arm only.
9. Reorder slices: *Tickets* → *Scope* → *Rule*, with `waits:` annotations.
10. Answer both open questions as in (d).

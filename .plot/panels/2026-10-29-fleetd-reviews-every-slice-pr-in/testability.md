# Juror verdict: testability

Position: amend

Evidence: Read the plan, DESIGN-delivery-loop.md, issue #2900, sibling plans #2898, #2899 and #2903, `packages/board/src/server/entry/review.ts` (all 684 lines), `packages/board/test/unit/review.test.ts`, `packages/domain/src/entities/pr-index.ts`, `packages/domain/src/ports/host.ts:115-150,380-410`, `packages/domain/src/rules/auto-verify.ts`, `packages/fleet/src/shared/auto-verify.ts:1-140`, `skills/plot/scripts/plot-host.sh:698-707,4796-4815`, `packages/domain/src/entities/sprint.ts:9,150` and `packages/board/src/server/entry/sprint-transition.ts:162`. Ran: `pnpm install` in the worktree; domain vitest `auto-verify`, `sprint-tick`, `review-issue`, `sprint` (62/62 pass); fleet vitest `test/unit/auto-verify.test.ts` (20/20 pass); board vitest `--project parallel test/unit/review.test.ts` (56/56 pass); a node read of the live PR index `.plot/state/index/github.json` (v5, 1023 rows); `gh pr view 2917` and `gh pr view 2891 --json statusCheckRollup` (read-only); a scratch vitest probe that ran the board's `sprintFrom` and the domain's `sprintMembers` over sprint `follow-ups-2-29-1` at its start commit `f92415d23` and its close commit `c2349bd7c`.

## (a) Problem statement

- The motivation is correct. `review.ts` has no caller in `packages/fleet/src` or `packages/domain/src`: a grep for `reviewPr` and `plot-review.mjs` finds 0 hits. `packages/fleet/src` imports nothing from `@plot-pm/board` (0 files).
- `review.ts:58-66` is a TSDoc block. It describes the behaviour correctly ("Any finding opens one follow-up issue"), but the code that the slice changes is `review.ts:483-493` (`findings !== 0` → `openFollowUp`) and `openFollowUp` at `review.ts:269-345`. The plan should cite the code lines.
- The plan names the rule's inputs as "the PR index row, the review record and the default-branch reading". **The PR index holds no review record.** `PrIndexRowSchema.review` (`pr-index.ts:41`) is GitHub's `reviewDecision` (`plot-host.sh:4806`), and it reads `''` on all 1023 rows of the live index (measured). The `plot/review` status is only reachable through `Host.prReview` (`host.ts:398-408`), which is a live host call per PR. This is a missing fact in the problem statement, and slice 1 cannot be built without a decision on it.
- **The index `checks` word includes `plot/review`.** `checks_of` (`plot-host.sh:706`) folds the whole `statusCheckRollup`, and the rollup carries `plot/review` as a `StatusContext` (measured on PR #2891: six entries, the last `plot/review SUCCESS`). Consequences for the rule: (1) `checks: green` cannot tell "CI green, not reviewed" from "CI green, reviewed with no HIGH"; (2) a review with a HIGH turns the row to `checks: failing` with `failing_checks: ['plot/review']`, which the design's "CI red" row would read as a CI failure. The plan's arm "CI green and no review on this head" therefore needs a CI reading that excludes `plot/review` and a separate per-head review reading.

## (b) Approach

- **The reviewer start path is not `agentRunCommand`.** `reviewPr` (`review.ts:395-528`) does much more than start an agent: it reads the head from the host, makes a detached worktree, writes the diff, runs the agent, parses the verdict, opens or comments on issues and writes the status. A tick that calls the `agent-run` port directly would skip all of that, and no `plot/review` status would be written. fleetd must start `plot-review.mjs <pr>` as a process (an adapter call, like `startBoardRun` for verify, `fleet/src/shared/auto-verify.ts:29`) or `reviewPr` must move into the domain, because fleet cannot import the board package. The plan should name which.
- **No in-flight guard, no retry bound, no switch.** `auto-verify` is the precedent for "fleetd starts an agent on a decision": `verifyStart` (`domain/src/rules/auto-verify.ts:162`) refuses `off`, `running`, `halted`, `stopped`, `waiting`, `queue-unread`, `no-free-agent` and `starved`, and the fleet keeps `.plot/state/auto-verify-in-flight.json` with pids and a start grace (`fleet/src/shared/auto-verify.ts:44,130`). A review runs up to `REVIEW_BOUND_SECONDS = 3600` (`review.ts:100`) and writes nothing to the host until it ends. Without an in-flight record, every tick in that hour reads "no review on this head" and starts another reviewer. Without a failure record, a review that refuses (exit 3, no status, `review.ts:78`) restarts on every tick. Without a config switch (an `Auto-review` key like `Auto-verify`, CLAUDE.md config), the first merged slice starts reviewers on every open PR at once.
- **The frozen scope, applied to review, stops most merges.** The design freezes the scope for the release trigger. The plan's slice 2 also restricts the review tick to it. Measured on the estate's latest sprint: `sprintMembers(sprintFrom(...))` gives 2 plans at the start commit and 11 at close. 9 of the 11 plans delivered by that sprint joined after start. Under slice 2 none of their slice PRs would get a fleet review, and the ruleset blocks their merge until a person or master agent reviews them. That contradicts the design's Goal 1 for every plan "dispatched as today". The plan should either review every open slice PR (and use the scope only for the release trigger, which is a later plan) or name this consequence and get it decided.
- **The sprint parser lives in the board.** `sprintFrom` is at `board/src/server/entry/sprint-transition.ts:162`; fleet cannot import it. The plan's board-impact note ("the board already parses") is true but the reader in fleet needs the parser in the domain, which is a move with its own callers to keep green.
- **Slice 3 is silent on HIGH.** Today any finding opens an issue (`review.ts:486`). The plan stops that for MEDIUM and LOW. For a review with a HIGH, it does not say whether the issue still opens. The design says a HIGH ticket exists only after the fixer attempts fail, and #2903 owns that ticket. If slice 3 keeps opening an issue on HIGH, the estate gets two tickets for one HIGH once #2903 lands; if it stops, a HIGH has no ticket until #2903 lands.
- Layering: the rule as described (readings as values, one answer) fits `## The Domain Package` and the precedent of `verifyStart`. The shell ratchet is not touched if the CI-excluding-review reading is computed in TypeScript from `failing_checks`; it is touched if `plot-host.sh` gains a `plot/review` column in `pr-list --rich`.
- The plan says it needs #2899 but no slice uses the run log. Either a slice writes a run-log line for the review step, or the dependency goes.

## (c) Slices

- Slice 1 wires the tick before slice 2 builds the scope. Merged alone, slice 1 starts reviewers on every open slice PR, unscoped. That is only safe behind an off-by-default switch. Order the scope reader first, or ship slice 1 behind `Auto-review: false`.
- Slice 1 holds two independent pieces of work: the pure rule (domain unit tests only) and the tick wiring plus in-flight store (fleet unit tests). They are independently mergeable and reviewable; splitting them follows the cut of `auto-verify` (rule in `domain/src/rules/auto-verify.ts`, pass in `fleet/src/shared/auto-verify.ts`).
- Slice 3 is independent of slices 1 and 2 and can merge first.
- Missing: the review reading. Either a slice adds the per-head `plot/review` state to the PR index (an index version bump, `PR_INDEX_VERSION = 5` at `pr-index.ts:12`), or a slice reads the local review records under `<common-dir>/plot/state/reviews/<pr>-<sha>.*` (`review.ts:413-417`), or the plan accepts one `prReview` host call per candidate PR per tick and says why under *A Decision Reads The Index*.
- Not named: plan PRs (`idea/` branches) also need `plot/review` to merge into `main` (the ruleset has no branch filter in the design). The plan covers slice PRs only; say so as a non-goal.

## (d) Open questions

- **Q2 (one marked comment or one per head): already answered by the code.** `findingsMarker(pr)` is `<!-- plot-review-findings pr-N -->` (`review.ts:358`), and `Host.prComment` with a marker edits the identity's own comment in place (`host.ts:385-392`). `review.test.ts:608` asserts two runs leave one PR comment. The body names the head (`followUpIssue` body, `review.ts:182`). Reuse it: one comment per PR, edited per head.
- **Q1 (freeze point): git already records it.** `plot-sprint-state.sh` commits the transition as `sprint: start <slug>` (`f92415d23` for follow-ups-2-29-1). The scope is `sprintMembers(sprintFrom(git show <start-commit>:<file>))`. No new state file is needed, and none should be added: it would be a persisted verdict git can reach for free (CLAUDE.md, *Answers, never verdicts*). The adapter finds the commit with `git log -G 'State:\*\* Active'` on the sprint file.
- New: where does the rule read "a review exists on this head" (see (a))?
- New: what stops a second reviewer on the same head during the first one's hour?
- New: how often does a refused review retry, and when does it stop and notify?
- New: how many reviewers run at once, and do they count against fleet headroom like verify?
- New: with a HIGH, does slice 3 still open an issue until #2903 lands?
- New: does a PR with one of the 22 open findings issues still get comments on that issue (the recorded `<pr>-<sha>.issue` path at `review.ts:286`), or only the PR comment?
- New: with zero active sprints, or two, what does the scope reader answer, and does the tick then review nothing?

## (e) Tests

All three slices are checkable without a live fleet, host or browser, if the plan adopts the amendments. Fixture shapes come from the tests run above.

**Slice 1a, rule (`packages/domain/test/slice-pr-next.test.ts`, domain unit, vitest).** Fixture: a `PrIndexRow` literal (`{number, head, state:'OPEN', draft:false, checks, failing_checks, headSha, checksSha, ...}`), a review reading `{sha, state}` per `PrReviewReading` (`host.ts:143`), an in-flight set, a default-branch reading. Assertions, one per row:
- `checks:'green'`, review `absent` on `headSha` → `{step:'review', sha: headSha}`.
- review `success` on `headSha` → not `review`.
- review `success` on an older sha → `review` (a push makes the old review irrelevant; the design's head rule).
- `checks:'failing'`, `failing_checks:['plot/review']`, CI otherwise green → not the CI-red arm (the rollup fact above; this test fails against a rule that reads `checks` raw).
- `checks:'pending'` or `checksSha !== headSha` → no step.
- review in flight on this head → no step.
- `state:'MERGED'` or `draft:true` → no step.
- `checksLookup:'skipped'` (Jenkins) → no step, because the colour may belong to an older commit (`pr-index.ts:82-96`).

**Slice 1b, tick wiring (`packages/fleet/test/unit/auto-review.test.ts`, fleet unit, vitest).** Copy the `auto-verify.test.ts` world shape: a fake `start` that records `(pr, sha)` instead of spawning, a fake `alive(pid)`, a temp in-flight file. Assertions: one green unreviewed PR → one start with that PR number; a second pass with the run alive → zero starts; the run's pid dead with no status → the failure is recorded and the next start waits; switch off → zero starts. Plus a domain-tier spawn-free check: the pass imports no `node:child_process` outside `adapters/` (the existing purity and spawn ratchets in `ci.yml` cover this; no new gate).

**Slice 2, scope reader (`packages/domain/test/sprint-scope.test.ts`, domain unit).** Fixture: two sprint texts in the template shape (`docs/sprints/2026-W44-follow-ups-2-29-1.md` at `f92415d23` and at `c2349bd7c` are a ready real pair). Assert the scope of the pair is the 2 start members, not the 11 close members, and that an item struck with `~~[slug]~~` after start leaves the scope. The adapter that finds the start commit gets a reconcile-tier test (`test/reconcile/*.test.mjs`, `node --test`) in a temp git repo with three commits (create, start, add item), asserting the start commit's members.

**Slice 3, findings comment (`packages/board/test/unit/review.test.ts`, board unit, `--project parallel`).** The `rig()` fixture already captures `issues`, `prComments` and `statuses`. Change `review.test.ts:191` ("opens the follow-up issue ... on HIGH 0 with MEDIUM and LOW findings") to assert `r.issues` has length 0, `r.prComments` has length 1 starting with `<!-- plot-review-findings pr-7 -->`, and the status is `{state:'success', description:'no HIGH findings', targetUrl: pr URL}`. Add: a recorded `.issue` file for the head plus MEDIUM-only findings → no `issueComment` call (or one, per the decision above). Add the HIGH case per the decision. The `describe('one follow-up issue per PR')` block (`review.test.ts:498-606`) uses MEDIUM-bearing verdicts in places; each must be re-read against the new rule, not just made to pass.

## Amendments

1. Name the review reading the rule takes, and its source: a per-head `plot/review` state in the PR index (version bump), the local review records, or one `prReview` call per candidate with the cost stated.
2. Define "CI green" for the rule as the rollup with `plot/review` excluded, and test that a HIGH review does not read as CI red.
3. Say how fleetd starts a review: a process running `plot-review.mjs <pr>` through an adapter, or `reviewPr` moved into the domain. Not `agentRunCommand` directly.
4. Add an in-flight record, a failure/retry record and an `Auto-review` switch, modelled on `verifyStart` and `auto-verify-in-flight.json`, with domain tests per refusal.
5. Do not restrict the review tick to the frozen scope, or name the measured consequence (9 of 11 plans in the last sprint joined after start) and get it decided. Keep the frozen scope for the release trigger.
6. Move or declare the sprint parser for fleet use (`sprintFrom` is board-only). Take the freeze point from the `sprint: start` commit; add no state file.
7. State what slice 3 does on a HIGH before #2903 lands, and what it does with a recorded findings issue for a PR.
8. Close open question 2: reuse the existing per-PR marked comment (`review.ts:358`).
9. Split slice 1 into the rule and the tick wiring, and put the scope reader and the switch before the wiring. Drop the #2899 dependency or name the run-log line the review step writes.
10. Cite `review.ts:483-493` and `:269-345` as the code to change, beside the TSDoc at `:57-68`.

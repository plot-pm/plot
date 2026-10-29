# Juror verdict: measure (round 2)

Position: amend

Evidence: Read the plan, round-1 `panel.md`, `packages/domain/src/rules/ending-action.ts` (:154-370, :620-640), the record adapters `adapters/fresh-agent-record/fresh-agent-record-file.ts` and `adapters/ending-ask-record/ending-ask-record-file.ts`, and `adapters/desk/desk-fs.ts:93-130`. Ran: a join script over `<repo>/.plot/state/endings.jsonl` (209 lines), `<common-git-dir>/.plot/state/fresh-agents.tsv` (33 rows) and `<common-git-dir>/.plot/state/ending-asks.tsv` (109 rows); 43 read-only `gh pr list --head` / `gh pr view` calls; `gh pr list --state all --limit 4000` (1791 head names); `git ls-remote`, `git for-each-ref refs/plot/reaped` (16 pins) and local branches; a survey of all 30 `git worktree list` entries (ending file, exit record, marker, pid); an esbuild bundle of the worktree's `ending-action.ts` probed with 9 readings. Scratch: `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-r2-2906-measure/`.

## The measurement

**Method.** `fresh-agents.tsv` gives each fresh session's branch and start time (2026-10-09T17:53Z to 2026-10-28T17:23Z). `ending-asks.tsv` gives one row per `needs-a-person` ask with the ending's own time `endingAt` (2026-10-09 to 2026-10-29T06:46Z). An ask whose `endingAt` is later than the same branch's fresh-session `at` is a second ending after a fresh session that reached a person. `endings.jsonl` carries no time, so its file order gives the ending reason for that ask. PR existence and timing come from `gh`.

The plan says this number "is not measured" because `endings.jsonl` has no date. `ending-asks.tsv` has the date. The plan does not name that file.

**Slice 2 population (second fresh-session ending).**

| Reading | Count |
|---|---|
| Fresh sessions started | 33 |
| Fresh sessions whose branch had a PR **before** the session started | **33 of 33** |
| Branches that reached a second ending after the fresh session and asked a person | 10 |
| ...by reason of that second ending | `blocked` 7, `checks-unanswered` 1, `unreadable` 1, `holding-work` 1 |
| ...that hit the arms the fixer replaces (`:351`, `:354`, `:361`) | 2 (`unreadable` on `infra/playwright-install-survives-a-slow-download`, `holding-work` on `feature/tracker-issue-status-no-target-hides`) |
| ...with **no** PR | **0** |

The 8 `blocked`/`checks-unanswered` endings are `NEEDS_PERSON_ENDINGS` (`ending-action.ts:217-224`) and answer `needs-a-person` with or without a fresh session, so the plan's fixer never sees them. The 7 `blocked` endings are the fresh session writing a `PLOT-BLOCKED` question, which is #2901's population, not this plan's.

Both arm-reaching asks were raised **after** their PR had merged: #2367 merged 07:25Z, its `unreadable` ending is 15:12Z and the ask 18:29Z; #2591 merged 18:35:00Z, the ask 18:35:46Z. The `holding-work` arm reads no `prMerged` at all (`ending-action.ts:349-352`). These two asks were noise for a person, not work.

**How a person finished the 10.** All 10 PRs (#1959, #2356, #2358, #2367, #2464, #2468, #2591, #2711, #2737, #2752) merged, all merged by `jwloka`. Every commit after the ask carries a `claude` co-author, so a person directed an agent (master session or a board continue) to finish. Ask-to-merge spans 13 min (#2464) to about 20 h (#2737). The records do not say which route a person used.

**Slice 1 population (dead claimed desk, no ending, commit beyond claim, no PR, no marker).**

- Current desks: 7 plan-named slice desks hold a worker record. 4 read `unreadable` (exit 124), and their PRs #2892, #2880, #2872, #2895 are merged, so the table answers `leave`. 1 reads `checks-unanswered` with a marker. 2 read `stopped` (exit 143), a person's stop. **0 have no ending.**
- History: all 178 branch-named endings in `endings.jsonl` (the 31 `unregistered` lines name no branch) are on branches that had a PR at some time. 4 slice branches on `origin`: all have a PR. 16 reap pins (`refs/plot/reaped/*`): all have a PR. 3 local slice branches have no PR; all date from 2026-08-18/27, before the fresh-session records exist, and only `feature/the-scan-sees-a-repairable-conflict` holds a claim plus one commit.
- **Measured count: 0.**

**Blind spots.**

1. Slice 1's population cannot appear in `endings.jsonl` by definition: it is the desk that wrote no ending. Only live desks and surviving branches show it, and a deleted branch with no reap pin leaves no trace.
2. `endings.jsonl` is a best-effort append (`desk-fs.ts:118-129`) and undercounts. Two live desks hold a `stopped` ending, and the log holds zero `stopped` lines.
3. The join takes the ask's ending reason from file order in an undated log. The order matched the ask times on all 10 branches, but nothing guarantees it.
4. All three files are machine-local. Desks on another machine are not counted.
5. The window is 20 days. Fresh sessions run on PR desks because `corrections-spent` and `checks-unanswered` both presuppose a PR build. A no-PR desk that dies before its first push is the only shape slice 2 serves, and it did not occur.
6. Whether a worker can exit 0 without writing an ending is not measured. `killedWorkerEnding` treats exit 0 as "a worker that finished" (`ending-action.ts:632-635`).

**Executed probe** (worktree `endingAction`, base reading: no manifest, `commitBeyondClaim: 'yes'`, `prOpen: false`): no ending → `leave`; `stopped` → `leave`; `unreadable` with `priorFreshSessions: 1` → `needs-a-person` whether a PR is open or not; the same reading with `prMerged: 'merged'` → `leave`; `holding-work`, `corrections-spent`, `blocked` and `checks-unanswered` with `priorFreshSessions: 1` → `needs-a-person`. The table behaves as the plan describes.

## (a) Round-1 fold

- Folded correctly: the wrong rule named (now `endingTableAnswer`, `ending-action.ts:347-370`); one table for both verdicts; the restart bound and the ending read; desks with a PR go to #2903; a person's stop is respected; the continue lock; the #2901 collision; red build after attempts.
- **Got wrong:** round 1's shared blind spot asked for a count of the endings **before** building the fixer arm. The amendment keeps slice 2 and moves the count into Open Question 4, "before slice 2 starts". The count is possible today from `ending-asks.tsv` × `fresh-agents.tsv`, and it reads 0 of 10.
- The Motivation's 209-line breakdown is right (I recounted: `checks-unanswered` 70, `blocked` 36, `unreadable` 31, `unregistered` 31, `corrections-spent` 15, `holding-work` 12, `quiet` 8, `unstarted` 6). "66 that earn a fresh session first" overstates the fixer's reach. Of 33 fresh sessions, 10 led to a second ask, and 0 were on no-PR desks.

## (b) Cited file:line facts

Checked in the worktree, all correct: `registryd.ts:660-663, 1011, 1139, 1151, 1177-1178, 1208, 1216`; `ending-action.ts:154, 162, 217-224, 347-370, 366`; `claim.ts:77` (`ORPHANED_CLAIM_AGE_MS = 60_000`); `dead-claim.ts:31`; `run-limit.ts:13` (12); `restart-command.ts:19-20, 67, 114`; `continuation.ts:857`; `dispatch-verbs.ts:194`; `dispatch.ts:42` (a comment); `fresh-agent.ts:52`; `board/src/server/restart.ts:68`; `fleet/.../restart-command.ts:89`; `restart-stopped-command.ts:103`; `fresh-agent-tick.test.ts:410`. One wrong premise: "the number that reached a second fresh session is not measured". `ending-asks.tsv` records `endingAt` per ask (`ending-ask-record-file.ts:39-41`).

## (c) Slices

- Slice 2 (`feature/ending-action-starts-a-fixer`): its no-PR arm served 0 of 33 fresh sessions and 0 of 10 second endings. Its "desk with a PR answers `leave` with no marker" arm reached 2 asks, both on already-merged PRs. **Leave the plan.** The PR-desk `leave` belongs to #2903's `feature/fleetd-starts-the-fixer`, because #2903 owns that desk.
- Slice 1 (`feature/ending-action-restarts-a-desk`): measured population 0, but this measurement cannot see most of the population (blind spot 1). **Shrink.** Do not build a new verdict, a restart record and a refusal record for a population nobody has observed. Two smaller options:
  - (i) Make the desk observable first: count each tick's `leave` at `:366` for a desk with `ending: null`, a dead worker and `commitBeyondClaim: 'yes'`.
  - (ii) Extend `killedWorkerEnding` to compose `unreadable` for a dead, plan-named desk with work and no exit record or exit 0. The existing bound arm then answers `start-fresh` once and `needs-a-person` after that. It reuses `fresh-agents.tsv` as the bound, adds no verdict, and cannot restart a `stopped` desk (an ending exists, `:632`).
- Slice 1 still lacks `waits: feature/unattended-callers-are-refused`. The Notes say fleetd's restart is refused `unattended` until #2898 merges, so the slice cannot pass its own tick test without that branch. Option (ii) needs no wait.

## (d) Open questions

- OQ4 (how many reach a second ending): **answered.** 10 of 33 in 20 days, 0 with no PR, reasons above.
- OQ1 (after-prompt `holding-work`): the only measured case (#2591) had a PR, which had merged 46 s before the ask. This plan never sees it. **New:** the `holding-work` arm ignores `prMerged` (`:349-352`), and the bound arm's merged check lost a race in #2367 (ask 11 h after merge). Both produce asks on merged PRs. That is a table defect worth its own issue, and it is cheaper than either slice.
- OQ2 (where the fixer runs): moot if slice 2 leaves.
- OQ3 (run log): moot for slice 2. For slice 1 option (ii), the fresh session already writes its own record.
- **New:** 7 of 10 second endings are `blocked`, the fresh session asking a question. #2901 owns that population, and it is the largest one this data shows. Point #2906's motivation at #2901 for that number.

## (e) Tests

- Domain unit, `packages/domain/test/rules-ending-action.test.ts`: the plan's property test over ending × `priorFreshSessions` × PR × marker × worker state. Add a fixture of the 10 measured second-ending readings, which assert today's answers. Any later arm must state which of these 10 it changes.
- For option (ii): a `killedWorkerEnding` unit row for exit 0 and absent exit with a dead loop and work beyond the claim, and the existing row that a `stopped` ending is never overwritten.
- Fleet unit, `packages/fleet/test/unit/fresh-agent-tick.test.ts:410`: unchanged if slice 2 leaves.

## Amendments

1. Replace "the number that reached a second fresh session is not measured" with the measured figures: 33 fresh sessions in 2026-10-09 to 2026-10-28, 33 on PR desks, 10 second endings (7 `blocked`, 1 `checks-unanswered`, 1 `unreadable`, 1 `holding-work`), 0 on a no-PR desk. Name `ending-asks.tsv` as the source.
2. Remove slice 2. Move the "desk with a PR answers `leave`, no marker" row to #2903's `feature/fleetd-starts-the-fixer`.
3. Shrink slice 1 to option (ii), extending `killedWorkerEnding` into the existing bound arm, or to option (i), a count, before any restart verdict. If the restart verdict stays, add `<!-- waits: feature/unattended-callers-are-refused -->`.
4. Open an issue for the two asks raised on merged PRs: the `holding-work` arm reads no `prMerged` (`ending-action.ts:349-352`).
5. Drop Open Question 4 as answered, and drop Open Question 2 with slice 2.

# Board readings take the domain answer

> Five independent defects where a board, skill or test reading decides from a column name, a sentence, a copied regex or a placeholder number instead of from the domain rule that already answers the question.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3388, #3122, #3159, #3163, #3140
- **Review:** pr
- **Impl:** own branches

## Changelog

- An approval with no plan PR writes no `pr:` key into the sprint item annotation; it wrote `pr: #0`.
- The Delivery tab places an approved tracer plan's slices under Work items, and places rows correctly under a custom `Workflow phases` map.
- A Design plan's card names why its `Spike approved:` record licenses no branch, and prints the re-approval command `plot-approve.mjs --spike <slug> --who <handle>`.
- `/plot-implement` asks one bundle question for the approved spike of a Design plan instead of deciding it in skill prose.

<!-- Board impact: slices 2 and 3 change packages/board (a new AgentRow field, the card's spike reason) and packages/domain. Slice 5 removes three unproduced columns from plot-verdicts.mjs's stdin format. No plan format, plan template or docs/plans layout changes. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

All evidence is on origin/main `b21961602`.

**#3140, the sprint annotation writes `pr: #0`.** `annotateSprintItem` takes `pr: number` and always writes the key: `<!-- pr: #${pr}… -->` on a fresh comment (`packages/domain/src/rules/sprint-annotation.ts:32,48`), a replacement (`:57`) or an insertion (`:59`). `packages/board/src/server/entry/approve.ts:891` starts `pr` as `{ number: 0, state: 'NONE', draft: false }`, `:1005` sets `number: 0` when the host read is refused, `:1190` passes `prNumber: pr.number` into the write request, and `:720` hands it to `annotateSprintItem`. An in-session approval therefore writes `pr: #0`; issue #2532 shows `<!-- pr: #0, branch: feature/bb-pr-merge-match-head -->`. `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:227-231`) already takes `pr: number | null`. PR #3112 merged on 2026-11-05 (`b07fd8b40`) and rewrote `entry/approve.ts`, but the defect remains at the lines above.

**#3388 M1, the Delivery tab reads the plan's state from a column name.** The server fills `AgentRow.phase` with a column name: `phaseOfPlan(phaseMap, { state: plan.phase, tracer: plan.tracer })` for a slice row (`packages/board/src/server/fleet.ts:7613`) and `phaseOfPlan(phaseMap, { state: 'draft' })` for an `idea/` row (`:8004`). The client maps the name back to a state through a table of the five default names (`PHASE_OF`, `packages/board/src/app/lib/agent-rows/delivery-readings.ts:148-157`) and hands the result to the placement rule as `WorkItemReading.phase` (`:258-262`). `phaseOfPlan` puts a tracer plan in the column that holds `design` in every state except `released` (`packages/domain/src/rules/workflow-phases.ts:149-152`), so an approved tracer plan's slices read as `design` and land under You › Input to the fleet. Under a custom `Workflow phases` map every lookup misses and `phase` is unset: an `idea/` PR row lands in Work items, and a plan in its delivered column does not count as delivered (`:262`).

**#3122, four spike readers bypass `licensedSpike`.** `licensedSpike` (`packages/domain/src/rules/spike.ts:95`) answers the licensed branch or one of six `SpikeUnlicensed` reasons (`:66-72`).

- *Card.* `spikeCardState` (`packages/domain/src/rules/spike-confirm.ts:29-35`) answers one of three words (`:4`) and drops the reason at `:33`. `card-controls.ts:18` carries only the word, and `card-presentation.ts:250` renders `spike not approved yet` for a plan with no record and for a record that names a moved, renamed or absent branch alike.
- *Verdicts.* `slicesFrom` (`packages/board/src/server/entry/verdicts.ts:86-116`) parses three optional spike columns (`spikes`, `spikeApproved`, `planSpikes`; documented at `:65-71`). Nothing produces them: `plot-fleet-scan.sh` is a 276-line launcher with 0 lines matching `spike`, and `skills/plot/scripts/README.md:159` states that no shipped script calls `plot-verdicts.mjs`. `test/reconcile/scan-spike-readings.test.mjs:1-8` still describes the scan appending the columns, and its two column tests skip (`viaShell`, `:142`). `a-slice-is-marked-spike.test.ts:40` tests the parse of columns that have no producer.
- *Implement.* `workflows/implement.ts:65` declares `spikeBranch` and `:144-145` admit the next branch when it equals it. `implement` reaches the barrel (`workflows/index.ts:29`, `index.ts:602`), but only `packages/domain/test/workflows-implement.test.ts` calls it. The production writers of a `spikeBranch` reading feed the dispatch and commit gates (`packages/board/src/server/entry/plangate.ts:96`, `entry/gate.ts:792`), not `/plot-implement`. `skills/plot-implement/SKILL.md:71` and `:87` tell an agent to read `spike_approved_raw` and the `spike` flags and decide the spike in prose.
- *Corpus.* `packages/domain/corpus/plan-store.corpus.test.ts:285` fails only for a wire key on neither `FIELDS` nor `KNOWN_UNCARRIED`, so a key on both passes. `spike_approved_raw` is on `KNOWN_UNCARRIED` (`:80`) with the comment *"no PlanStore reader decides on it"*, while `planOf` maps it to `spikeApprovedRaw` (`packages/domain/src/adapters/plan-store/plan-store-shell.ts:175`) and `sliceReadingsOf` decides on it (`packages/domain/src/rules/slice-readings.ts:26`). The corpus therefore never compares the two.

**#3159, the quiet-kind invariant reads a sentence.** The invariant at `packages/board/test/unit/classifier-is-total.test.ts:707-712` runs over `classify`, which returns no `quietKind`, and selects rows with a regex over `result.note` (`:709`). A change to either `quietNote` sentence empties the violator list and the test passes with no check made. `quietPlacement` (`packages/domain/src/rules/quiet.ts:196-206`) answers `'done' | 'quiet'` and places `abandoned` and `orphaned-claim` as `quiet`, but two comments in `packages/board/src/server/fleet.ts` say both go to waiting on you (`:5774-5776`, `:5793-5795`). `docs/board-domain-model.md:1099` reads `| pr | present, or **absent** | — |`, which names no forbidden value.

**#3163, the escalation post duplicates a parse and a read.** `planIssueId` (`packages/domain/src/rules/escalation.ts:80-84`) and `planIssue` (`packages/domain/src/transitions/sprint-member.ts:128-132`) repeat the `## Status` and `- **Issue:**` regexes; they differ only in the id step (`planIssueId` also accepts a Jira key and answers `null`, `planIssue` answers `''`). `escalationOf` builds a new `answerRecordFile({ cwd: repoRoot })` for each question (`packages/fleet/src/shared/worker-question.ts:271-274`), so each refresh runs one `git rev-parse --git-common-dir` and one full read of `answers.tsv` per desk with a marker. `packages/fleet/test/unit/escalation-post.test.ts:7` types the stub answer `{ ok: true; value: 'commented' }` and `:14` returns it `as never`, which hides any difference from `PortResult<IssueCommentOutcome>` (`packages/domain/src/ports/tracker.ts:481`). `question-renders-waiting-on-you.browser.test.ts:41` hard-codes the note `… · escalated: test`, so the browser test proves only that the page renders a given string.

## Design

### Approach

**Slice 1, the annotation omits an absent PR (#3140):**

- `annotateSprintItem(content, slug, pr: number | null, branch)` (`sprint-annotation.ts:29-34`). On `null` it writes no `pr:` key on a fresh comment, leaves an existing `pr:` key unchanged, and inserts none; the `branch:` field behaves as today. A line with no comment and `pr: null` and `branch: ''` stays unchanged and answers `already`.
- `approve.ts` passes `null` where no plan PR was read: the in-session arm and the host-refused arm (`:891`, `:1005`). The write request's `prNumber` (`:534`) becomes `number | null`; the summary and refusal texts that print `#${pr.number}` (`:1179-1181`, `:1373`) are reached only on the PR arm and keep `number`.
- **Tests** in `packages/domain/test/rules-sprint-annotation.test.ts`: `null` on a bare line writes `<!-- branch: x -->`; `null` on a line with `pr: #12` keeps `#12`; `null` with no branch leaves the line unchanged; a number still writes `pr: #n`. One case in `packages/board/test/unit/approve.test.ts`: an in-session approval of a sprint member writes no `pr:` key.

**Slice 2, the row carries the plan's state (#3388 M1):**

- `AgentRow` gains `planState: 'draft' | 'design' | 'approved' | 'delivered' | 'released' | null` (`packages/board/src/contract/schema.ts`, beside `phase` at `:2786`), defaulting to `null`. `phase` keeps the column name for the column cell.
- The server fills it from the lifecycle state, never from the column: `plan.phase` lowercased where it is one of the five states, else `null`, for a slice row (`fleet.ts:7613`), and `'draft'` for an `idea/` row (`:8004`). The tracer and deliverable column rules of `phaseOfPlan` do not apply to it.
- `delivery-readings.ts` reads `first.planState` and drops `PHASE_OF` and `phaseOf` (`:148-157`). An older server that sends no field reads as `null`, which leaves `WorkItemReading.phase` unset, as an unknown column does today.
- **Tests** in `packages/board/test/unit/delivery-readings.test.ts`: an approved tracer plan's slice row (`phase: 'Design'`, `planState: 'approved'`) places under Work items; an `idea/` PR row under a custom map (`phase: 'Ideas'`, `planState: 'draft'`) places under You; a row of a delivered plan under a custom map counts as delivered. In `packages/board/test/unit/fleet.test.ts`: `rowsFromPulse` fills `planState: 'approved'` for an approved tracer plan, and fills it under a custom `Workflow phases` map whose column names are not the defaults.

**Slice 3, the card names the unlicensed reason (#3122, card):**

- `spikeCardState` answers `{ state: SpikeCardState; reason: SpikeUnlicensed | null } | null` (`spike-confirm.ts:29-35`); `reason` is `licensedSpike`'s reason on `spike-not-approved` and `null` otherwise.
- `CardControlsSchema` gains `spikeUnlicensed` next to `spikeState` (`card-controls.ts:18`). `card-presentation.ts:250` renders the reason in words and the command `plot-approve.mjs --spike <slug> --who <handle>`, except for `spike-record-absent`, which keeps `spike not approved yet`.
- **Tests:** one `spikeCardState` cell per `SpikeUnlicensed` reason and one for a licensed record, in `packages/domain/test/` beside the existing spike-confirm tests; one `card-controls-fixture.test.ts` cell that a renamed spike branch carries `spike-branch-renamed`. No browser test: the reason is a domain property.

**Slice 4, the corpus checks both lists (#3122, corpus):**

- `plan-store.corpus.test.ts` gains a test that no wire key sits on both `FIELDS` and `KNOWN_UNCARRIED`, and a test that every key `planOf` maps (`plan-store-shell.ts`) is on `FIELDS`.
- `['spikeApprovedRaw', 'spike_approved_raw']` moves to `FIELDS`, and its `KNOWN_UNCARRIED` entry and comment (`:79-80`) go. The corpus then compares the parser's value with `PlanRecord.spikeApprovedRaw` on every plan. On a disagreement the branch stops (*A Shell Script Asks The Domain*).

**Slice 5, the verdict line loses the unproduced spike columns (#3122, verdicts):**

- `slicesFrom` (`verdicts.ts:86-116`) parses three columns again and rejects a line with more; `spike` and `spikeApproved` drop out of `SliceLine`, and the doc comment (`:65-71`) loses the spike sentence. The domain walk sets both readings (`slice-readings.ts:26`), so `sliceVerdict`'s spike exception keeps its producer.
- `test/reconcile/scan-spike-readings.test.mjs` loses the two skipped column tests and the `node` tap, and its header (`:1-8`) states what it tests: the pulse's `tracer` and `--list-eligible` over the spike. `a-slice-is-marked-spike.test.ts` loses `describe('slicesFrom — the three spike columns')` (`:40`).
- **Tests:** `slicesFrom` refuses a six-column line; the `--list-eligible` cases of `scan-spike-readings.test.mjs` pass unchanged.

**Slice 6, `/plot-implement` asks for the spike (#3122, implement):**

- `plot-ask.mjs spike <slug>` (`packages/board/src/server/entry/main.ts`, beside `deliverable` at `:125,:364`) reads the plan through the plan store and prints `licensed <branch>` or `unlicensed <reason>`, from `spikeBranchOfRecord` (`entry/gate.ts:590`). A plan that does not read prints `unaskable` and exits non-zero.
- `skills/plot-implement/SKILL.md:71,:87` replace the prose rule with the call and its three answers, and keep the two stop messages. The skill's Model Guidance row for step 1 (`:49`) names the call. The changeset bumps `plot-implement`.
- **Tests:** one `test/reconcile/` case per answer over a sandbox plan: licensed, `spike-branch-renamed`, `spike-record-absent`, and an unreadable plan.

**Slice 7, the quiet invariant reads the placement (#3159):**

- The invariant at `classifier-is-total.test.ts:707-712` runs over `withHandOver(rowsFromPulse(…), agents)` across the same state, verdict, phase and worker product, with no PR, past the quiet window, and reads `row.quietKind`, never `note`. A second case feeds one row in `waiting-on-you` with `quietKind: 'abandoned'` to the same predicate and expects it as a violator, so the predicate is not empty by construction.
- The two `fleet.ts` comments (`:5774-5776`, `:5793-5795`) state that `quietPlacement` places `abandoned` and `orphaned-claim` as `quiet`.
- `docs/board-domain-model.md:1099` drops the `pr` row from the QUIET table; the prose after it already carries the rule.

**Slice 8, one Issue parse and one answer store (#3163):**

- `escalation.ts` exports `planIssueValue(planText): string`, the raw `Issue:` value or `''`. `planIssueId` and `sprint-member.ts`'s `planIssue` both call it and keep their own id step, so neither changes behaviour.
- `escalationOf` takes an answer-record store that the caller builds once per refresh (`worker-question.ts:260-274`).
- `escalation-post.test.ts` builds its tracker from `trackerFixture` (`packages/domain/src/adapters/tracker/tracker-fixture.ts`) and drops the `as never` cast.
- The browser row at `question-renders-waiting-on-you.browser.test.ts:41` takes its note from the board's note builder, and the assertion at `:97` stays. The `it` count does not change, so `EXPECTED_TESTS` in `stubbed-tests-start-no-board.test.ts` does not either; a change to the count moves it with a dated reason line.
- **Tests:** `planIssueValue` cells for no Status section, no `Issue:` line, `#12, #13` and `ABC-1`; a `worker-question` test that two questions in one refresh build one store.

### Open Questions

- [ ] Slice 5 keeps `plot-verdicts.mjs`, which no shipped script calls (`skills/plot/scripts/README.md:159`). Should the slice remove the bundle and its entry instead of three columns?
- [ ] Slice 6 leaves `workflows/implement.ts` with no production caller. Should the board's implement route call it with `spikeBranch` filled from `licensedSpike`, or should the workflow and its `spikeBranch` field go?
- [ ] #3122 asks that the pulse also names the `SpikeUnlicensed` reason. Slice 3 covers the card only. Is the pulse in scope?

## Slices

### Sprint annotation

- `bug/an-approval-with-no-pr-writes-no-pr-key` — `annotateSprintItem` takes `pr: number | null` and omits the key on `null`; `approve.ts` passes `null` for an in-session or host-refused approval; the unit tests <!-- builds: annotateSprintItem with an absent PR -->

### Plan state

- `bug/a-delivery-row-carries-its-plan-state` — `AgentRow.planState` from the lifecycle state, filled at `fleet.ts:7613` and `:8004`; `delivery-readings.ts` reads it and drops `PHASE_OF`; unit tests for a tracer plan and a custom phase map <!-- builds: AgentRow.planState, the plan's lifecycle state on a Delivery row -->

### Spike card

- `bug/the-spike-card-names-its-reason` — `spikeCardState` answers the `SpikeUnlicensed` reason, `CardControls.spikeUnlicensed`, the card renders the reason and the re-approval command; one cell per reason <!-- builds: spikeCardState with the unlicensed reason -->

### Spike corpus

- `bug/the-plan-store-corpus-checks-both-lists` — a test that no key is on both lists and that every mapped key is on `FIELDS`; `spike_approved_raw` moves to `FIELDS` <!-- builds: the corpus two-list check -->

### Spike verdicts

- `bug/the-verdict-line-drops-the-spike-columns` — `slicesFrom` parses three columns and rejects more; `scan-spike-readings.test.mjs` and `a-slice-is-marked-spike.test.ts` lose the column tests and the stale header <!-- builds: slicesFrom without spike columns -->

### Spike implement

- `bug/plot-implement-asks-for-the-spike` — `plot-ask.mjs spike <slug>` from `spikeBranchOfRecord`; `skills/plot-implement/SKILL.md` calls it in place of the prose rule; one reconcile case per answer <!-- builds: plot-ask.mjs spike, the licensed spike as a bundle question -->

### Quiet invariant

- `bug/the-quiet-invariant-reads-the-placement` — the invariant over `withHandOver(rowsFromPulse(…))` reading `quietKind`, a planted violator case, the two `fleet.ts` comments, and the QUIET table's `pr` row <!-- builds: the quiet-kind invariant over rowsFromPulse -->

### Escalation post

- `bug/the-escalation-reads-the-issue-once` — `planIssueValue` shared by `planIssueId` and `planIssue`, one answer-record store per refresh, the `trackerFixture` stub, and the browser note from the builder <!-- builds: planIssueValue, the shared Issue field parse -->

## Notes

- Created on 2026-11-21 from triaged issues #3388, #3122, #3159, #3163 and #3140. Type `bug`, review `pr`, implementation `own branches`.
- **Slice order.** No slice names a `waits:`; the slices touch different files, and no slice reads what another builds. `sliceVerdicts` (`packages/domain/src/rules/eligible.ts:165-172`) makes a slice eligible only when every earlier slice is complete, so under one `###` heading per slice the fleet starts them in heading order. The order puts the smallest and most visible fixes first.
- **#3388 M2 is fixed by `d452cb9d5`** (2026-11-20, on origin/main): one jump opens the section, group and plan row that hold an anchor, and `BlockedByMark` and the plan line links use it. That commit adds the browser test *"opens a folded section on a You count link and marks the target"* (`packages/board/test/integration/delivery-tab-sections.browser.test.ts`). It adds **no** browser test that follows a `BlockedByMark` or an `← agents:` link into a closed group; the nearest existing test, *"leaves a delivered blocker without a row"* (`agents-tab.browser.test.ts:1165`), covers a blocker in a folded Done section. This plan leaves M2 out; #3388's second *Done when* item stays open until such a test exists.
- **#3122 parts already fixed.** `tracer` is on `FIELDS` (`plan-store.corpus.test.ts:53`). `implement` is exported through the barrel (`workflows/index.ts:29`, `index.ts:602`); what holds is that no production code calls it.
- **#3140:** PR #3112 merged on 2026-11-05 (`b07fd8b40`) and changed `entry/approve.ts` (320 lines), but not the `pr: #0` path; this plan needs no rebase on it.
- **Deliverable search** (`skills/plot/scripts/plot-deliverable-search.sh`, 2026-11-21): `planState` matched only a local variable in `entry/approve.ts:1198-1272`, unrelated; `spikeCardReason`, `spike columns`, `spike-license` and `licensed spike question` found no deliverable (only prose uses of the word `spike` in `auto-dispatch.ts` and `plot-host.sh`); `KNOWN_UNCARRIED` matched one comment in `perform-fs.ts:51`; `quiet invariant`, `planIssueValue`, `issue field parse`, `answer record store per refresh` and `sprint annotation pr` matched only unrelated script comments and reconcile section headings. Nothing found builds what a slice builds.
- Related released plans: `docs/plans/2026-11-04-plot-approve-writes-the-sprint-annotation.md` filed #3140 as out of scope (`:124`); `docs/plans/2026-11-04-record-names-no-branch-so-a.md` filed #3122, #3123 and #3124 from its panel (`:176`).

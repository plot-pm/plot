# Board readings take the domain answer

> Five independent defects where a board, skill or test reading decides from a column name, a sentence, a copied regex or a placeholder number instead of from the domain rule that already answers the question.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3388, #3122, #3159, #3163, #3140
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged

## Changelog

- An approval with no plan PR records `pr: none` in the sprint item annotation, as `/plot-sprint` documents; it wrote `pr: #0`. A later approval with no plan PR rewrites an existing `pr: #0` to `pr: none`.
- The Delivery tab places an approved tracer plan's slices under Work items, and places rows correctly under a custom `Workflow phases` map.
- A blocker mark or an `← agents:` link on the Delivery tab opens the closed group that holds its target, and a browser test proves it.
- A Design plan's card names why its `Spike approved:` record licenses no branch and points to its *Approve spike* button; `/plot-pulse` names the same reason and `plot-approve-command.mjs --spike --who <handle> <slug>`.
- `/plot-implement` asks one bundle question for the approved spike of a Design plan instead of deciding it in skill prose.

<!-- Board impact: slices 2 and 3 change packages/board (a new AgentRow field, the card's spike reason) and packages/domain. Slice 3 adds `spikeUnlicensed` to the pulse plan and the card facts. Slice 5 removes three unproduced columns from plot-verdicts.mjs's stdin format. No plan format, plan template or docs/plans layout changes. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

All evidence is on origin/main `b21961602`.

**#3140, the sprint annotation writes `pr: #0`.** `annotateSprintItem` takes `pr: number` and always writes the key: `<!-- pr: #${pr}… -->` on a fresh comment (`packages/domain/src/rules/sprint-annotation.ts:32,48`), a replacement (`:57`) or an insertion (`:59`). `packages/board/src/server/entry/approve.ts:891` starts `pr` as `{ number: 0, state: 'NONE', draft: false }`, `:1005` sets `number: 0` when the host read is refused, `:1190` passes `prNumber: pr.number` into the write request, and `:720` hands it to `annotateSprintItem`. An in-session approval therefore writes `pr: #0`; issue #2532 shows `<!-- pr: #0, branch: feature/bb-pr-merge-match-head -->`. `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:227-231`) already takes `pr: number | null`. PR #3112 merged on 2026-11-05 (`b07fd8b40`) and rewrote `entry/approve.ts`, but the defect remains at the lines above.

**#3388 M1, the Delivery tab reads the plan's state from a column name.** The server fills `AgentRow.phase` with a column name: `phaseOfPlan(phaseMap, { state: plan.phase, tracer: plan.tracer })` for a slice row (`packages/board/src/server/fleet.ts:7613`) and `phaseOfPlan(phaseMap, { state: 'draft' })` for an `idea/` row (`:8004`). The client maps the name back to a state through a table of the five default names (`PHASE_OF`, `packages/board/src/app/lib/agent-rows/delivery-readings.ts:148-157`) and hands the result to the placement rule as `WorkItemReading.phase` (`:258-262`). `phaseOfPlan` puts a tracer plan in the column that holds `design` in every state except `released` (`packages/domain/src/rules/workflow-phases.ts:149-152`), so an approved tracer plan's slices read as `design` and land under You › Input to the fleet. Under a custom `Workflow phases` map every lookup misses and `phase` is unset: an `idea/` PR row lands in Work items, and a plan in its delivered column does not count as delivered (`:262`). **M2:** a blocker mark or a counterpart link into a closed group found no element and stopped. `d452cb9d5` (2026-11-20) routes these links through one jump that opens the section and group first, but no browser test follows such a link into a closed group, which is the issue's second *Done when* item.

**#3122, four spike readers bypass `licensedSpike`.** `licensedSpike` (`packages/domain/src/rules/spike.ts:95`) answers the licensed branch or one of six `SpikeUnlicensed` reasons (`:66-72`).

- *Card and pulse.* The issue's first *Done when* item asks for the reason on the card and on the pulse. `spikeCardState` (`packages/domain/src/rules/spike-confirm.ts:29-35`) answers one of three words (`:4`) and drops the reason at `:33`. `card-controls.ts:18` and `CardFacts.progress.design.spike` (`entities/card-facts.ts:224`, filled at `plan-card-facts.ts:301-302`) carry only the word, and `card-presentation.ts:250` renders `spike not approved yet` for a plan with no record and for a record that names a moved, renamed or absent branch alike.
- *Verdicts.* `slicesFrom` (`packages/board/src/server/entry/verdicts.ts:86-116`) parses three optional spike columns (`spikes`, `spikeApproved`, `planSpikes`; documented at `:65-71`). Nothing produces them: `plot-fleet-scan.sh` is a 276-line launcher with 0 lines matching `spike`, and `skills/plot/scripts/README.md:159` states that no shipped script calls `plot-verdicts.mjs`. `test/reconcile/scan-spike-readings.test.mjs:1-8` still describes the scan appending the columns, and its two column tests skip (`viaShell`, `:142`). `a-slice-is-marked-spike.test.ts:40` tests the parse of columns that have no producer.
- *Implement.* `workflows/implement.ts:65` declares `spikeBranch` and `:144-145` admit the next branch when it equals it. `implement` reaches the barrel (`workflows/index.ts:29`, `index.ts:602`), but only `packages/domain/test/workflows-implement.test.ts` calls it. The production writers of a `spikeBranch` reading feed the dispatch and commit gates (`packages/board/src/server/entry/plangate.ts:96`, `entry/gate.ts:792`), not `/plot-implement`. `skills/plot-implement/SKILL.md:71` and `:87` tell an agent to read `spike_approved_raw` and the `spike` flags and decide the spike in prose.
- *Corpus.* `packages/domain/corpus/plan-store.corpus.test.ts:285` fails only for a wire key on neither `FIELDS` nor `KNOWN_UNCARRIED`, so a key on both passes. `spike_approved_raw` is on `KNOWN_UNCARRIED` (`:80`) with the comment *"no PlanStore reader decides on it"*, while `planOf` maps it to `spikeApprovedRaw` (`packages/domain/src/adapters/plan-store/plan-store-shell.ts:175`) and `sliceReadingsOf` decides on it (`packages/domain/src/rules/slice-readings.ts:26`). The corpus therefore never compares the two.

**#3159, the quiet-kind invariant reads a sentence.** The invariant at `packages/board/test/unit/classifier-is-total.test.ts:707-712` runs over `classify`, which returns no `quietKind`, and selects rows with a regex over `result.note` (`:709`). A change to either `quietNote` sentence empties the violator list and the test passes with no check made. `quietPlacement` (`packages/domain/src/rules/quiet.ts:196-206`) answers `'done' | 'quiet'` and places `abandoned` and `orphaned-claim` as `quiet`, but two comments in `packages/board/src/server/fleet.ts` say both go to waiting on you (`:5774-5776`, `:5793-5795`). `docs/board-domain-model.md:1099` reads `| pr | present, or **absent** | — |`, which names no forbidden value.

**#3163, the escalation post duplicates a parse and a read.** `planIssueId` (`packages/domain/src/rules/escalation.ts:80-84`) and `planIssue` (`packages/domain/src/transitions/sprint-member.ts:128-132`) repeat the `## Status` and `- **Issue:**` regexes; they differ only in the id step (`planIssueId` also accepts a Jira key and answers `null`, `planIssue` answers `''`). `escalationOf` builds a new `answerRecordFile({ cwd: repoRoot })` for each question (`packages/fleet/src/shared/worker-question.ts:271-274`), so each refresh runs one `git rev-parse --git-common-dir` and one full read of `answers.tsv` per desk with a marker. `packages/fleet/test/unit/escalation-post.test.ts:7` types the stub answer `{ ok: true; value: 'commented' }` and `:14` returns it `as never`, which hides any difference from `PortResult<IssueCommentOutcome>` (`packages/domain/src/ports/tracker.ts:481`). `question-renders-waiting-on-you.browser.test.ts:41` hard-codes the note `… · escalated: test`, so the browser test proves only that the page renders a given string.

## Design

### Approach

**Slice 1, the annotation records `pr: none` (#3140):**

- `annotateSprintItem` (`sprint-annotation.ts:29-62`) stops editing the line itself. It finds the member line with `memberLineIndex` as today, answers `missing` where there is none, and otherwise calls `withSprintAnnotation(content, slug, false, …, branch)` (`packages/domain/src/workflows/rendering.ts:227-252`), mapping `wrote` to `updated` or `already`. One line edit remains in the domain. Its other caller, `transitions/sprint-member.ts:230`, passes a non-null PR and keeps its output.
- `annotateSprintItem` takes `pr: number | null`. A number passes through. `null` passes the new value `'none'`.
- `withSprintAnnotation` takes `pr: number | 'none' | null`. `null` keeps today's meaning: write no key and leave an existing one (`perform-fs.ts:166` still passes it). `'none'` writes `pr: none`, the value `skills/plot-sprint/SKILL.md:285` documents (*"PR number (`#N`) or `none`"*). On a line whose key reads `pr: #0`, `'none'` rewrites it to `pr: none`, because 0 names no PR. On a line whose key names a real PR (`pr: #12`), `'none'` keeps it: an approval with no plan PR does not unmake a recorded one.
- `approve.ts` passes `null` where no plan PR was read: the in-session arm (`:891`) and the host-refused arm (`:1005`). The write request's `prNumber` (`:534`, `:1190`) becomes `number | null`. The texts that print `#${pr.number}` (`:1179-1181`, `:1373`) are reached only on the PR arm and keep `number`.
- **Tests** in `packages/domain/test/rules-sprint-annotation.test.ts`: `null` on a bare line writes `<!-- pr: none, branch: x -->`; `null` on a line with `pr: #0` writes `pr: none`; `null` on a line with `pr: #12` keeps `#12`; a number still writes `pr: #n`; a missing member line answers `missing`. One agreement cell runs `annotateSprintItem` and `withSprintAnnotation` over the same fixture lines and asserts the same text. In `packages/board/test/unit/approve.test.ts`, the harness at `:191-233` (which asserts `pr: #42` today) gains an in-session approval of a sprint member that writes `pr: none`.

**Slice 2, the row carries the plan's state, and links open a closed group (#3388):**

- **M1.** `AgentRow` gains `planState: PlanStateSchema.nullable().default(null)` (`packages/board/src/contract/schema.ts`, beside `phase` at `:2786`; `PlanStateSchema` is `packages/domain/src/entities/card-facts.ts:39`). `phase` keeps the column name for the column cell.
- The server reads the state through the existing domain parse `planStateOf` (`packages/domain/src/entities/plan.ts:101`), which answers `none` for an unread word; `none` becomes `null`. A slice row (`fleet.ts:7613`) takes `planStateOf(plan.phase)`; an `idea/` row (`:8004`) takes `'draft'`. No lowercase-and-match stays in `fleet.ts`. The tracer and deliverable column rules of `phaseOfPlan` do not apply to `planState`.
- `delivery-readings.ts` reads `first.planState` and drops `PHASE_OF` and `phaseOf` (`:148-157`). `rejected` and `superseded` leave `WorkItemReading.phase` unset, as an unknown column does today. A row from an older server reads as `null`. Under the default map the change moves one kind of row: an approved tracer plan's slices go from You › Input to the fleet to Work items. A draft row reads `draft` in place of `design`, and `delivery-placement.ts:321` places both the same.
- **Fixtures.** Every `AgentRow` literal or factory that sets `phase` to a column name also sets `planState`: `packages/board/test/catalogue/states.ts` (45 rows), `test/integration/agents-tab.browser.test.ts` (16), `test/unit/tuple-row.test.ts` (12), `test/integration/plan-row-shows-plan-status-only.browser.test.ts` (11), `test/unit/schema.test.ts` (10), `test/unit/delivery-view.test.ts` (9), and `packages/board/src/server/mock-fleet.ts:81,93,108,118`. The builder runs `git grep -n "phase: '\(Discovery\|Design\|Development\|Testing\|Released\)'" -- packages/board` and settles each hit: an `AgentRow` gains `planState`; a `PlanMeta` or `CardFacts` fixture, which carries a lifecycle word, is left alone. Where a file builds rows through one factory, the factory sets it once.
- **The six `PHASE_OF` tests** in `describe('deliveryMapping phase words')` (`packages/board/test/unit/delivery-readings.test.ts:130-165`) are restated over `planState`: one per state, plus a row with `planState: null` that leaves the phase unset.
- **New M1 tests** in `delivery-readings.test.ts`: an approved tracer plan's slice row (`phase: 'Design'`, `planState: 'approved'`) places under Work items; an `idea/` PR row under a custom map (`phase: 'Ideas'`, `planState: 'draft'`) places under You; a row of a delivered plan under a custom map counts as delivered. In `packages/board/test/unit/fleet.test.ts`, the tracer cell at `:5153-5192` also asserts `planState: 'approved'`; one cell under a custom `Workflow phases` map asserts the state while `phase` reads the custom column; one cell for a plan whose `phase` is no lifecycle word asserts `null`.
- **M2.** `d452cb9d5` routes `BlockedByMark` and the plan line links through one jump that opens the section, group and plan row holding an anchor. No browser test follows a link into a closed group. Two cases go into `packages/board/test/integration/delivery-tab-sections.browser.test.ts`: fold the group that holds a blocking slice (Queued), click its `[data-slice-blocked-by]` mark, and expect the group's toggle `aria-expanded="true"` and the target row in the viewport; then the same for an `← agents:` link (`linkLine`, `packages/board/src/app/components/AgentList.tsx:1395`) whose target sits in a folded group. Where a case fails on origin/main, the slice fixes the jump. The two cases raise `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` by 2, with a dated reason line.

**Slice 3, the card and the pulse name the unlicensed reason (#3122, card and pulse):**

- `spikeCardState` answers `{ state: SpikeCardState; reason: SpikeUnlicensed | null } | null` (`spike-confirm.ts:29-35`). `reason` is `licensedSpike`'s reason on `spike-not-approved`, and `null` otherwise. `spike-none` cannot reach it: `spikeCardState` answers `null` before `licensedSpike` runs when the plan has no single spike (`:32`).
- **The carrier is `CardFacts`.** `card-presentation.ts` reads only `CardFacts` (`scripts/check-card-presentation.sh` allows `@plot-pm/domain/entities/card-facts` and UI helpers only). `CardControls` gains `spikeUnlicensed` next to `spikeState` (`card-controls.ts:18`). `CardFacts.progress.design` gains `spikeUnlicensed: SpikeUnlicensedSchema.nullable()` (`entities/card-facts.ts:224`), with a new `SpikeUnlicensedSchema` beside `SpikeCardStateSchema` (`:44`), its own `// plot-state: reading — …` declaration (as at `:43`, for `scripts/check-state-declarations.sh`) and a `same<…, SpikeUnlicensed>` check. `plan-card-facts.ts:301-302` copies the field from the controls.
- **Card wording** (`card-presentation.ts:248-252`), each followed by `— use Approve spike`, the card's existing button (`card-presentation.ts:218`, held where `licensedSpike` answers `licensed: false`):

  | Reason | Card line |
  |---|---|
  | `spike-record-absent` | `spike not approved yet` (unchanged, no pointer) |
  | `spike-record-branchless` | `spike record names no branch` |
  | `spike-record-unparseable` | `spike record does not parse` |
  | `spike-marker-moved` | `spike approved for a branch the spike marker no longer marks` |
  | `spike-branch-renamed` | `spike approved for a branch no slice names` |

  The card prints no command. The gated bundle `plot-approve.mjs` appears nowhere; the board-free command is `plot-approve-command.mjs --spike --who <handle> <slug>` (`entry/approve-command.ts:9-13`).
- **The pulse.** The pulse's `PlanSchema` (`packages/domain/src/entities/fleet.ts:707`) gains `spikeUnlicensed: SpikeUnlicensedSchema.nullable().default(null)`, filled by the plan walk (`packages/domain/src/workflows/plan-walk-assembly.ts`) for a Design plan with one spike whose record licenses nothing. `/plot-pulse` (`skills/plot-pulse/SKILL.md`) names the reason and `plot-approve-command.mjs --spike --who <handle> <slug>` on that plan's `unapproved` line; the changeset bumps `plot-pulse`.
- **Tests:** `packages/domain/test/spike-confirm.test.ts` updates its 7 calls to the new shape and adds one cell per reachable reason (five), one for a licensed record (`reason: null`), and one that a plan with no single spike answers `null`. `packages/board/test/unit/licensed-spike-agreement.test.ts` reads `.state` and also asserts that the card's reason equals `licensedSpike`'s. `packages/domain/test/plan-card-facts.test.ts` gains a cell that `spike-branch-renamed` reaches `design.spikeUnlicensed`. `packages/board/test/unit/card-presentation.test.ts` gains a cell per reason for the line above, and keeps `spike not approved yet` at `:129` for `spike-record-absent`. A plan-walk test asserts `spikeUnlicensed` on the pulse plan for `spike-marker-moved` and `null` for a licensed record. No browser test: the reason is a domain property.

**Slice 4, the corpus checks the mapped keys (#3122, corpus):**

- **How the test gets `planOf`'s key list.** It calls `planOf` (`plan-store-shell.ts:160-185`) on a `Proxy` whose `get` records every property name read and answers `undefined`. The recorded set is the wire keys the adapter reads, taken from the adapter's behaviour and not from a second table, so the `FIELDS` comment's ban on a derived table (`plan-store.corpus.test.ts:33-39`) still holds.
- **Keys that move to `FIELDS`:** `['spikeApprovedRaw', 'spike_approved_raw']`, `['designRaw', 'design_raw']` and `['verifiedRaw', 'verified_raw']`. Each is a plain string copy, so the existing per-field comparison (`:165`, `:216`) covers it. Their `KNOWN_UNCARRIED` entries and comments go.
- **Keys that `planOf` reads and that do not move**, on a new named list `COMPARED_APART`, each with its reason and its own test: `issues` (numbers on the wire, strings on the port; one test compares `issues.map(String)`), `rounds` (present only where the wire carries a number; one test compares presence and value), `error` (present only on a parse failure; one test with an unparseable plan fixture), `slices` and `waves` (the slice list, already compared through `WIRE_SLICES`, `:101`).
- **The new tests:** (a) every key the proxy records is on `FIELDS` or `COMPARED_APART`; (b) no key is on two of `FIELDS`, `COMPARED_APART` and `KNOWN_UNCARRIED`; (c) every `KNOWN_UNCARRIED` key is one the proxy did not record. On a comparison disagreement the branch stops (*A Shell Script Asks The Domain*).

**Slice 5, the verdict line loses the unproduced spike columns (#3122, verdicts):**

- `slicesFrom` (`verdicts.ts:86-116`) parses three columns again and rejects a line with more. `spike` and `spikeApproved` drop out of `SliceLine`, and the doc comment (`:65-71`) loses the spike sentence.
- `packages/board/test/unit/a-slice-is-marked-spike.test.ts` loses both describes that feed spike columns: `slicesFrom — the three spike columns` (`:40`) and the four `answer` tests at `:67-86` (*offers the spike when it stands alone*, *offers neither branch of a slice holding the spike and a sibling*, *offers nothing where the plan holds two annotations*, *offers nothing where the second annotation sits in a slice the scan does not show*). `test/reconcile/scan-spike-readings.test.mjs` loses the two skipped column tests and the `node` tap, and its header (`:1-8`) states what it tests.
- **What still proves the spike exception:** `packages/domain/test/slice-readings.test.ts:17-19` and the three `--list-eligible` tests at `scan-spike-readings.test.mjs:176-186`, which stay unchanged.
- **Test:** `slicesFrom` refuses a six-column line.

**Slice 6, `/plot-implement` asks for the spike (#3122, implement):**

- `plot-ask.mjs spike <slug>` (`packages/board/src/server/entry/main.ts`; `questionFrom` at `:124-126` admits `spike` beside `board`, `fleet` and `deliverable`) reads the plan through the plan store and answers from `spikeBranchOfRecord` (`entry/gate.ts:590`):

  | Answer | Exit |
  |---|---|
  | `licensed <branch> <record date>` | 0 |
  | `unlicensed <reason> <record date or ->` | 1 |
  | `unaskable <why>` (no plan, or a plan that does not read) | 2 |

- `skills/plot-implement/SKILL.md:71` replaces the prose rule with the call. Its stop message for an unlicensed record names the reason and `plot-approve-command.mjs --spike --who <handle> <slug>`, never `plot-approve.mjs`. `:87` keeps the age reading and takes the date from the answer's third field. The Model Guidance row for step 1 (`:49`) names the call. The changeset bumps `plot-implement`.
- The `plot-ask.mjs` row in `skills/plot/scripts/README.md` and the question list in `CLAUDE.md` (*The Master Agent Uses The Controllers*: *"`plot-ask.mjs` answers the questions `board`, `fleet`, `deliverable` and `release-claim`"*) name `spike`; `./scripts/check-agents-md.sh --write` regenerates `AGENTS.md`.
- **Tests** in `packages/board/test/unit/ask-spike.test.ts`, beside `ask-repair-pr.test.ts`: one cell per answer and exit code (licensed, `spike-branch-renamed`, `spike-record-absent` with `-` as its date, and an unreadable plan).

**Slice 7, the quiet invariant reads the placement (#3159):**

- The invariant at `classifier-is-total.test.ts:707-712` builds pulses in the shape of `:735-741` and runs `withHandOver(rowsFromPulse(pulse, ages, 'plot', QUIET), agents)`. Its product runs over the pulse axes: claim (claimed or not), commits ahead (0 or more), worker state, slice verdict, plan phase, and age past `QUIET`, with no PR. It reads `row.quietKind` and `row.group`, never `note`.
- A second case feeds one row in `waiting-on-you` with `quietKind: 'abandoned'` to the same predicate and expects it as a violator, so the predicate is not empty by construction.
- The two `fleet.ts` comments (`:5774-5776`, `:5793-5795`) state that `quietPlacement` places `abandoned` and `orphaned-claim` as `quiet`.
- `docs/board-domain-model.md:1099` drops the `pr` row from the QUIET table; the prose after it already carries the rule.

**Slice 8, one Issue parse and one answer store (#3163):**

- `escalation.ts` exports `planIssueValue(planText): string`, the raw `Issue:` value or `''`. `planIssueId` and `sprint-member.ts`'s `planIssue` both call it and keep their own id step, so neither changes behaviour.
- `workerQuestions` (`packages/fleet/src/shared/worker-question.ts:252-263`) builds one `answerRecordFile({ cwd: repoRoot })` per call and passes it to `escalationOf` (`:271-274`), which stops building one per question.
- `escalation-post.test.ts` builds its tracker from `trackerFixture` (`packages/domain/src/adapters/tracker/tracker-fixture.ts`) and drops the `as never` cast (`:7`, `:14`).
- `questionNote` (`packages/board/src/server/fleet.ts:4623`) is exported. The browser row at `question-renders-waiting-on-you.browser.test.ts:41` takes its note from `questionNote` over the fixture's question and escalation, and the assertion at `:97` stays. The `it` count does not change, so `EXPECTED_TESTS` does not either.
- **Tests:** `planIssueValue` cells for no Status section, no `Issue:` line, `#12, #13` and `ABC-1`. A `worker-question` test mocks `@plot-pm/domain/adapters/answer-record/answer-record-file` with `vi.mock`, counts `answerRecordFile` calls, and expects 1 for a pulse with two marked desks.

### Open Questions

- [x] Slice 5 removes only the three spike columns from `plot-verdicts.mjs`, and keeps the bundle (operator decision, 2026-11-21).
- [x] The `implement` workflow (`workflows/implement.ts`) stays as it is in this plan, with no new caller and no removal (operator decision, 2026-11-21). Notes name it as a follow-up.
- [x] The `SpikeUnlicensed` reason on the pulse is in scope, in slice 3 (operator decision, 2026-11-21).

## Slices

### Sprint annotation

- `bug/an-approval-with-no-pr-writes-no-pr-key` — `annotateSprintItem` delegates to `withSprintAnnotation`, which gains `'none'`; an approval with no plan PR writes `pr: none` and rewrites `pr: #0`; the unit, agreement and approve tests <!-- builds: withSprintAnnotation's pr: none -->

### Plan state

- `bug/a-delivery-row-carries-its-plan-state` — `AgentRow.planState` from `planStateOf`, filled at `fleet.ts:7613` and `:8004`; `delivery-readings.ts` drops `PHASE_OF`; every row fixture and `mock-fleet.ts` row carries `planState`; the six phase-word tests restated; tracer and custom-map tests; two browser tests that a blocker mark and an `← agents:` link open a closed group <!-- builds: AgentRow.planState, the plan's lifecycle state on a Delivery row -->

### Spike card

- `bug/the-spike-card-names-its-reason` — `spikeCardState` answers the `SpikeUnlicensed` reason; `CardFacts.progress.design.spikeUnlicensed` with its `plot-state:` declaration; the card wording per reason with the *Approve spike* pointer; the pulse plan's `spikeUnlicensed` and `/plot-pulse` line; the named test updates <!-- builds: SpikeUnlicensedSchema, the spike reason on the card and the pulse -->

### Spike corpus

- `bug/the-plan-store-corpus-checks-both-lists` — the proxy-recorded key list of `planOf`; `spike_approved_raw`, `design_raw` and `verified_raw` move to `FIELDS`; `COMPARED_APART` for `issues`, `rounds`, `error`, `slices` and `waves` with their own tests; the three list checks <!-- builds: the corpus key-list check over planOf -->

### Spike verdicts

- `bug/the-verdict-line-drops-the-spike-columns` — `slicesFrom` parses three columns and rejects more; the `:40` and `:67-86` describes of `a-slice-is-marked-spike.test.ts` and the skipped column tests of `scan-spike-readings.test.mjs` go <!-- builds: slicesFrom without spike columns -->

### Spike implement

- `bug/plot-implement-asks-for-the-spike` — `plot-ask.mjs spike <slug>` with the record date and exit codes 0, 1 and 2; `skills/plot-implement/SKILL.md:71,:87,:49` call it; the README row and CLAUDE.md list; one unit cell per answer <!-- builds: plot-ask.mjs spike, the licensed spike as a bundle question -->

### Quiet invariant

- `bug/the-quiet-invariant-reads-the-placement` — the invariant over `withHandOver(rowsFromPulse(…))` across the pulse axes reading `quietKind`, a planted violator case, the two `fleet.ts` comments, and the QUIET table's `pr` row <!-- builds: the quiet-kind invariant over rowsFromPulse -->

### Escalation post

- `bug/the-escalation-reads-the-issue-once` — `planIssueValue` shared by `planIssueId` and `planIssue`, one answer-record store per `workerQuestions` call with a counting test, the `trackerFixture` stub, and the browser note from the exported `questionNote` <!-- builds: planIssueValue, the shared Issue field parse -->

## Notes

- Created on 2026-11-21 from triaged issues #3388, #3122, #3159, #3163 and #3140. Type `bug`, review `pr`, implementation `own branches`.
- **Full coverage.** A release closes every issue on the `Issue:` line that no other unfinished plan names (`packages/board/src/server/entry/release-tracker.ts:95-146`). So the plan covers each issue in full: slice 2 carries #3388 M2's browser proof, and slice 3 carries #3122's pulse reason.
- **Slice order.** No slice names a `waits:`; the slices touch different files, and no slice reads what another builds. `sliceVerdicts` (`packages/domain/src/rules/eligible.ts:165-172`) makes a slice eligible only when every earlier slice is complete, so under one `###` heading per slice the fleet starts them in heading order. The order puts the smallest and most visible fixes first.
- **#3388 M2 is mostly fixed by `d452cb9d5`** (2026-11-20, on origin/main): one jump opens the section, group and plan row that hold an anchor, and `BlockedByMark` and the plan line links use it. That commit adds the browser test *"opens a folded section on a You count link and marks the target"* (`delivery-tab-sections.browser.test.ts`), but no test that follows a `BlockedByMark` or an `← agents:` link into a closed group; the nearest, *"leaves a delivered blocker without a row"* (`agents-tab.browser.test.ts:1165`), covers a blocker in a folded Done section. Slice 2 adds the two missing cases.
- **#3122 parts already fixed.** `tracer` is on `FIELDS` (`plan-store.corpus.test.ts:53`). `implement` is exported through the barrel (`workflows/index.ts:29`, `index.ts:602`); what holds is that no production code calls it.
- **Follow-up: the `implement` workflow.** `workflows/implement.ts` reads `spikeBranch` (`:65`, `:144-145`) and has no production caller; only `packages/domain/test/workflows-implement.test.ts` calls it. This plan leaves it as it is. A later plan either wires it into the board's implement route with `spikeBranch` filled from `licensedSpike`, or removes it.
- **#3140.** PR #3112 merged on 2026-11-05 (`b07fd8b40`) and changed `entry/approve.ts`, but not the `pr: #0` path; this plan needs no rebase on it. `docs/sprints/2026-W41-the-release-train-fixes-what-it-found.md:27-42` holds 9 lines with `pr: #0`. Slice 1 rewrites such a line only when an approval with no plan PR runs on it again; it does not edit the closed sprint file, which records history.
- **Rebase in `delivery-readings.ts`.** The Approved 2026-11-20 plans of the Delivery UI Polish sprint (*delivery-rows-act-from-one-place*, *every-delivery-section-folds*, *folded-sections-summarise-visually*, *delivery-tab-has-one-header*) cite `delivery-readings.ts:143`, `:305-310`, `:445-471` and `:571`, near slice 2's `:148-157` and `:259-262`. The open branches `feature/delivery-tab-has-one-header` and `feature/delivery-row-menu-column` do not touch the file. Whichever lands second rebases; none of those plans changes `AgentRow.phase` or `PHASE_OF`.
- **Deliverable search** (`skills/plot/scripts/plot-deliverable-search.sh`, 2026-11-21): `planState` matched only a local variable in `entry/approve.ts:1198-1272`, unrelated; `spikeCardReason`, `spike columns`, `spike-license` and `licensed spike question` found no deliverable (only prose uses of the word `spike` in `auto-dispatch.ts` and `plot-host.sh`); `KNOWN_UNCARRIED` matched one comment in `perform-fs.ts:51`; `quiet invariant`, `planIssueValue`, `issue field parse`, `answer record store per refresh` and `sprint annotation pr` matched only unrelated script comments and reconcile section headings. Two existing deliverables are reused rather than rebuilt: `planStateOf` (`entities/plan.ts:101`) for slice 2, and `withSprintAnnotation` (`rendering.ts:227`) for slice 1.
- **Panel round 1** (2026-11-21, three jurors, all `amend`, none `reject`): estate, testability and user. Each finding is resolved in the Approach above: fixtures and the `PHASE_OF` tests (slice 2); the `CardFacts` carrier, the test files, the wording, the unreachable `spike-none` and the gated command (slice 3); the key list and its enumeration (slice 4); the four `answer` tests (slice 5); the record date, the exit codes and `questionFrom` (slice 6); the pulse axes (slice 7); the `questionNote` and store-count seams (slice 8); `withSprintAnnotation` reuse and `pr: none` (slice 1); and the full-coverage rule (Notes). The testability juror's line-number drift check found every citation holding on origin/main `e20c92220`.
- Related released plans: `docs/plans/2026-11-04-plot-approve-writes-the-sprint-annotation.md` filed #3140 as out of scope (`:124`); `docs/plans/2026-11-04-record-names-no-branch-so-a.md` filed #3122, #3123 and #3124 from its panel (`:176`).

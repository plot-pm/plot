# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2899 (`gh issue view`), `DESIGN-delivery-loop.md`, sibling plans #2903 (`a-high-finding-is-fixed-before`), #2906 (`a-dead-desk-gets-a-fixer`), #2901 (`the-fleet-answers-plot-blocked-questions`), #2900 (`fleetd-reviews-every-slice-pr-in`); `ports/notifier.ts`, `adapters/notifier/notifier-fixture.ts`, `rules/question-escalation.ts`, `workflows/decision.ts:624-650`, `ports/fresh-agent-record.ts`, `fleet/src/shared/escalations.ts`, `fleet/src/server/entry/registryd.ts` and `registryd-main.ts:1040-1110,1505-1560`. Ran: `pnpm install` in the worktree; domain vitest `question-escalation.test.ts notifier-fixture.test.ts fresh-agent-record-file.test.ts` (3 files, 39 passed); fleet vitest `test/unit/escalations.test.ts` (13 passed); `plot-config.sh get "Notify command"` and `get "Question escalation"` (both unset in this repo); `scripts/check-state-declarations.sh` (clean, lifecycle=11 reading=16 classification=17); listed `.plot/state/` on the main checkout (`escalations.tsv` 277 lines, `endings.jsonl` 208 lines, no run log).

## (a) Problem statement

- The motivation is right: the design's *Stalls* section asks for exactly a run log and a non-stopping notification, and the issue body matches the plan's two builds.
- "`Notifier` port ... already used by `registryd` for escalations" is correct. `registryd-main.ts:1046` (`notifierFor`) builds it from `Notify command`, and `registryd-main.ts:1528` (`notifyEscalations`) applies `notify` writes. fleetd is this daemon: `plot-fleetctl.sh:102` maps both `com.plot-pm.fleetd` and `com.plot-pm.registryd` to it. The plan should name `registryd-main.ts` as the wiring site, because the name "fleetd" does not occur in its file name.
- Missing fact: this repository declares no `Notify command` (ran `plot-config.sh get`, answer unset). On this estate every stall notification answers `unaskable` (`ports/notifier.ts:24-28`), so "notifies the person" is unobservable here unless the stall is also recorded somewhere a person reads.

## (b) Approach

- **The rule's subject set is undefined, and a test cannot be written without it.** The rule takes "the run log, the config bound and the current time". With only those inputs, a slice whose last line is a merge stays "no step for longer than a bound" forever, and a slice with zero lines never stalls. The rule needs a fourth value: the slices that are still open in the scope (the PR index rows or the pulse), or a terminal step vocabulary (`merged`, `delivered`, `released`) that ends a slice's clock. Name which.
- **What counts as a step decides whether the rule ever fires.** The design's loop answers `hold` every tick for "default branch red" and "a merge is in flight" (DESIGN, *The loop*). The tick runs every 60 s (`registryd.ts:81`). If a `hold` writes a line, a held slice never stalls and the log grows by 1,440 lines per slice per day. If it does not, ten slices queued behind one-merge-in-flight wait about 100 minutes (DESIGN, *One merge in flight*) and stall at any bound below that. The plan must say whether a hold is a step, and the bound must be chosen against that 100-minute figure.
- **"One notification per stall" needs a record, and the plan names none.** The precedent dedups through `recordedRungs` read from `escalations.tsv` plus an in-memory copy (`escalations.ts:94-104`, `registryd-main.ts:1066-1067`). The existing write type cannot carry a stall: `NotifyWrite` (`decision.ts:640-650`) is keyed on `worktree` + `askedAt` with `rung: notified-${number}`, and `notifyEscalations` appends every `notify` write to `escalations.tsv`. Reusing it would write stall rows into the question-escalation record that #2901 turns into "a record only". The plan needs either a new write kind (`stall-notify`) with its own key, or a `notified` line in the run log itself that the rule reads back. The second keeps the rule's input to one file and makes the dedup provable in a domain unit test.
- **The second stall arm reads a counter that a later plan builds.** #2903 owns the per-PR attempts file (#2903 lines 38, 47, 61), and #2906 line 36 relies on "the stall rule notifies the person" after both attempts fail. This plan comes first. Arm 2 therefore has no producer when it merges, and its test can only use a fixture whose shape #2903 has not fixed yet. Either this plan defines the run-log step `fixer-started` with a finding key that #2903 must write, or arm 2 moves to #2903.
- **Slice 1 has no production writer.** No loop step exists before #2900, #2902 and #2903. The plan does not name which existing step slice 1 records. The candidates are steps fleetd takes today: auto-dispatch, correction written, fresh agent started, auto-deliver. Without one, slice 1 is a port and an adapter with no caller, and slice 2's rule reads an empty file in production.
- Layering: a domain rule taking readings as values plus an adapter-owned file is consistent with `CLAUDE.md` *The Layering Rule*. The precedent `escalations.ts` writes from `fleet/src/shared` with bare `fs`. The plan says "domain owns the port", which is the stricter shape of `ports/fresh-agent-record.ts`. Follow `fresh-agent-record`: a port, `adapters/run-log/run-log-file.ts`, and a fixture adapter.
- Location: name the root. `escalations.tsv` lives under `repoRoot/.plot/state` (`escalations.ts:16`). `fresh-agents.tsv` lives under the common git dir, so a reap cannot delete it (`ports/fresh-agent-record.ts`, header). The run log needs the second, because a desk-local file disappears with the desk.
- Bounded growth: name a rotation or a size cap. `endings.jsonl` and `escalations.tsv` are append-only with no cap.

## (c) Slices

- The two-slice cut is right in order. Slice 2 is not independently provable until the subject set, the step vocabulary and the dedup record above are named.
- Slice 2 holds two rules of different readiness: the time-based arm, provable today, and the attempts arm, which depends on #2903. Split slice 2 into `stall-after-a-bound` and `stall-on-spent-attempts`, the second with a `waits:` on #2903's rule slice, or move the second into #2903.

## (d) Open questions

1. **Bound key.** `Claim stale after` is hours and only shell reads it: grep found no TS hit in `packages/domain/src` or `packages/fleet/src`. Use `Stall after`, parsed with the duration grammar `parseQuestionEscalation` already accepts (`15m`, `4h`; `question-escalation.ts:77-81`), with `none` to disable. Then a domain unit test covers the parser the way `question-escalation.test.ts` covers the escalation one. The default must exceed the one-merge-in-flight queue (about 100 min for 10 slices), or holds must count as steps.
2. **Clock origin.** Count from the slice's last run-log line. The PR's last push needs a host call and breaks *A Decision Reads The Index*. A slice with zero lines needs a start line (dispatch or claim), otherwise it never stalls.
3. **Same finding before the attempts counter exists.** Read it from the run log: the fixer-start line carries a finding key. This makes the run log the only input and gives #2903 a contract to write.
4. **Re-notify.** Yes, once per episode, keyed on the slice and the time of its last step before the stall. This is the `worktree` + `askedAt` keying `escalations.tsv` uses, and a domain test can assert it.
- New question: is a `hold` a step? (see (b)).
- New question: how does a person see a stall on a repository with no `Notify command`? Proposal: the stall line in the run log with the send status (`sent`, `unaskable`, `failed <code>`), as `escalations.tsv` records it.

## (e) Tests

Every check below runs without a live fleet, a live host or a browser. The plan's acceptance is checkable that way once the amendments name the inputs.

- **Slice 1, domain unit** (`packages/domain/test/run-log-file.test.ts`, model: `fresh-agent-record-file.test.ts`). Fixture: `mkdtempSync` root, removed by its exact name. Assertions: an append then a read returns the line with `slice, pr, head, step, outcome, at`. A missing file reads `answered([])`. An unreadable file reads `failed()`. A malformed line is skipped. Two appends keep file order.
- **Slice 1, domain unit** for the line codec: round-trip a line with a tab or a newline in `outcome` (a finding title can hold either). The `escalations.ts` TSV codec has no escape and would split such a line.
- **Slice 1, fleet unit** (`registryd-tick.test.ts` pattern, `escalation(...)` world at line 1175): for the existing step slice 1 records (for example auto-dispatch), assert the tick's writes hold one run-log write per step taken.
- **Slice 2, domain unit** (`packages/domain/test/stall.test.ts`, the `reading(over)` factory of `question-escalation.test.ts:21-27`). Cases:
  - last step older than the bound is a stall;
  - exactly at the bound is not (strict `>`, as `question-escalation.ts:48`);
  - a slice not in the open set is never a stall;
  - a recorded notification for this episode gives `isNew: false`;
  - a new step after a notified stall followed by a second stall is a new episode;
  - two `fixer-started` lines with the same finding key are a stall, and with different keys they are not;
  - a `none` bound disables arm 1.
- **Slice 2, fleet unit** (`registryd-main.test.ts:2600-2625` pattern). Fixture: a `Notifier` stub and an mkdtemp root. Assertions: one stall sends one message across two consecutive applies. An `unaskable` send is still recorded. A notifier that throws does not end the tick (the case at `registryd-main.test.ts:1433`). No slice state, queue hold or claim changes: assert that the tick's other writes are byte-identical with and without the stall.
- **Gates to run locally:** `check-state-declarations.sh` if the step or stall kind is a `z.enum` (it needs a `plot-state: reading` or `classification` marker); `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`; and `check-shell-lines.sh`, unchanged by design.

## Amendments

1. Add the open-slice set (or a terminal-step vocabulary) as an input of the stall rule, and say whether a `hold` writes a step.
2. Name the dedup record for "one notification per stall": a `notified` run-log line keyed on slice and episode start is preferred. Do not reuse `NotifyWrite` or `escalations.tsv`.
3. Name which existing fleetd steps slice 1 records, so the log has a production writer before #2900, #2902 and #2903 land.
4. Split the spent-attempts arm into its own slice that waits on #2903, or define the `fixer-started` line with a finding key in this plan as the contract #2903 writes.
5. Record each stall in the run log with its send status, because this repository has no `Notify command` and every send answers `unaskable`.
6. Place the run log under the common git dir, as `fresh-agents.tsv` is, and name a size bound.
7. Name `Stall after` with the `parseQuestionEscalation` duration grammar and a default above the one-merge-in-flight wait.
8. Add the test list from (e) to the slices' acceptance.

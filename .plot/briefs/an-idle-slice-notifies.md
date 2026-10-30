## Implementation brief — an-idle-slice-notifies (wave: Idle notification)

- **Plan (canonical):** docs/plans/2026-10-29-the-delivery-loop-keeps-a-run.md on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2909 merged
- **Branch:** `feature/an-idle-slice-notifies` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (no project board configured for this slug)

This is the plan's second and last wave. The first wave, `feature/the-loop-keeps-a-run-log`, merged as PR #2938 (2026-10-30T10:46Z) and is already on `main` — nothing in this slice waits on anything else in flight.

### What to build

Wave 1 shipped the `RunLog` port (`packages/domain/src/ports/run-log.ts`) and its file/fixture adapters (`packages/domain/src/adapters/run-log/`). It defines `RunLogStepSchema` (`dispatch`, `correction`, `fresh-agent`, `deliver`, `notified`) and `RunLogOutcomeSchema` (`moved`, `failed`, `partial`), and the four non-`notified` steps already write lines from fleetd and the worker loop.

This wave adds the consumer: a domain rule that reads those lines (plus the open slice PRs, fleetd's start time, and live `PLOT-BLOCKED` markers) and decides which slices have gone idle, then wires a `notified` line and an outbound message through the existing `Notifier` port (`packages/domain/src/ports/notifier.ts`) — the port is built and already wired to `Notify command` in fleetd (`notifierFor`, `registryd-main.ts:1046`); this repository declares no `Notify command`, so every send here answers `unaskable`, and that is a normal, recordable outcome, not a defect to chase.

The concrete problem this closes: with the master agent out of the loop (`the-fleet-delivers-a-scope-alone`), a slice PR that stops moving is silent — nothing records that the loop acted, and nobody is told a slice is stuck. The run log already answers "did the loop act"; this wave turns "it didn't, for too long" into exactly one message per stall.

### The decisions the plan settles — do not re-derive them

**Build the rule as pure functions over readings, like `questionEscalation`.** Read `packages/domain/src/rules/question-escalation.ts` end to end before writing anything — it is the shape to copy: no I/O, no port, no `await`, just values in and a verdict out. Your new rule (plan calls it the **idle-slice rule**; put it in `packages/domain/src/rules/`, e.g. `slice-idle.ts`) takes as readings: the open slice PRs with each `createdAt`; the run-log lines for those slices; fleetd's start time (`FleetdStart`, already read via `packages/domain/src/adapters/fleetd-start/fleetd-start-file.ts`); which slices hold a live `PLOT-BLOCKED` marker; the `Slice idle after` bound; and the current time. It returns `{ idle, isNew }` per slice, the same two-field shape `questionEscalation` returns.

**The clock counts only `moved` outcomes, never `failed`/`partial`.** This is the load-bearing split called out directly in `RunLogOutcomeSchema`'s own doc comment (`ports/run-log.ts`): a slice retrying a broken correction every tick still reads idle, because `failed`/`partial` lines never reset the clock. Getting this backwards (treating any line as "moved") silently defeats the whole notification — a stuck slice would look busy forever.

**The clock start is `max(last moving line, PR createdAt, fleetd start)`.** Not "last line of any kind" — a `failed` or `partial` line is evidence the loop tried, not evidence the slice moved. A PR with zero lines starts its clock at `createdAt`; fleetd restarting resets every slice's effective floor to its own start time, so a just-restarted daemon does not immediately declare every slice idle it had no chance yet to act on.

**Idle is strict `>` the bound, matching `question-escalation.ts:47`'s `ageMs > reading.ages[i]`.** Exactly at the bound is not idle — copy that inequality rather than picking `>=`, which would double a boundary case the existing pattern already decided.

**A slice with a live `PLOT-BLOCKED` marker is never idle.** That notification belongs to the question ladder (`escalations.tsv`, `questionEscalation`) and #2901; this rule staying silent for a blocked desk is what keeps a person to one message instead of two for the same root cause. Do not special-case the message content for this — just exclude blocked slices from the subject set (or short-circuit `idle: false`) before computing anything else.

**Episode keying: slice + clock-start, no extra state.** "One notification per stall" does not need a new store — an episode is identified by `(slice, clockStart)`, so a new moving line changes the clock start and therefore starts a fresh episode automatically. `isNew` answers whether this episode's key is absent from the recorded set the caller passes in (mirroring `recordedRungs` in `questionEscalation`) — the `notified` lines already in the run log ARE that recorded set; read them back out, don't invent a second ledger.

**The bound reuses `parseQuestionEscalation`'s grammar, not a new parser.** `Slice idle after` is a `## Plot Config` key using the exact same duration grammar (`s m h d`, `parseQuestionEscalation` in `question-escalation.ts:96-104`) and the same `none` sentinel to disable it. Default `2h` — chosen because it sits above the design's worst-case merge-queue wait (~100 minutes for ten slices, `DESIGN-delivery-loop.md:89`), so queued-behind-a-merge is never mistaken for idle. Do not write a second duration parser; reuse or lightly wrap the existing one (it currently returns an ascending array for a comma list of thresholds — this plan wants one scalar bound, so wrap rather than reuse verbatim if the shapes don't match the call site cleanly).

**The write kind is a new `NotifyWrite`-sibling in `decision.ts`, not a reuse of the escalation one.** `packages/domain/src/workflows/decision.ts` around line 640 already defines `NotifyWrite` for the question-ladder's rung notifications. This plan's notify write is a **new, distinct** write kind (the plan calls it an "idle-notify `Decision` write") carrying the message text and the episode key (`slice` + clock-start) — don't overload the existing `NotifyWrite.rung`/`askedAt` fields, which are shaped for desk markers, not slice PRs.

**The applier lives in `registryd-main.ts`, beside `notifyEscalations`, not as a shell performer.** Read `notifyEscalations` (`registryd-main.ts:1528`) before writing its sibling — it is the exact pattern: filter the tick's writes by `kind`, send all of them concurrently through the `Notifier`, then for each result append one `notified` run-log line with status `sent` / `unaskable` / `failed <code>` (reuse `RunLog.append`, not a new file). **Delivery is at least once**: if the process crashes between the send and the append, the next tick's restart sends the same message again — this is a stated, accepted trade, not a bug to engineer around with idempotency tokens. **A notifier that throws must not end the tick** — wrap the send the same defensive way `notifyEscalations` already does (`Promise.all` over `sender.notify(...)`, no unguarded `await` that could propagate).

**`--once` must append nothing and send nothing.** `plot-fleetd.mjs --once` has no claim to the daemon's socket (`registryd-main.ts:2543`) — only the looping daemon and the worker loop are writers. Verify your wiring only runs the idle check from the looping entry point, never from the `--once` code path.

**This rule only ever adds information; a wrong answer costs one message too many or too few — it may never decide a merge, fixer, restart or revert.** Keep the rule's output to `{ idle, isNew }` and the one `notified` line; nothing elsewhere should come to depend on it.

### Open questions the plan leaves explicitly unresolved — do not silently pick an answer

The plan's own `### Open Questions` section lists three unresolved items (a `hold` as a step; #2900's review-start writing no line; whether a line can name a non-slice subject). None of them block this slice — they're deliberately left for later plans (#2904, #2900 itself). Implement against the plan as written; do not pre-empt these by inventing behavior for them.

### Done when

The plan's `## Done when` is the Tests section (lines 101–107 of the plan) — implement it as written. In particular, make sure these specific assertions exist because a naive implementation would pass without them:
- "exactly at the bound is not idle" — catches an off-by-one on the `>` vs `>=` comparison.
- "every slice past the bound just after fleetd starts is not idle until the bound passes since the start" — catches seeding the clock from `0`/epoch instead of fleetd's actual start time.
- "only failed-outcome lines past the bound is idle" — catches treating any line (not just `moved`) as resetting the clock.
- "a recorded episode answers `isNew: false`" and "a new step then a second idle period is a new episode" — together they catch both under- and over-notifying: an episode must survive ticks once recorded, but a fresh `moved` line must start a genuinely new one.
- "the tick's other writes are identical with and without the idle slice" — catches the idle rule accidentally coupling into dispatch/correction/deliver decisions it has no business touching.

Plus: a changeset (`.changeset/an-idle-slice-notifies.md` or similar — package `plot`), and `scripts/check-state-declarations.sh` passing for any new/changed enum (if you add fields to `RunLogStep`/`RunLogOutcome`, declare them; this wave is not expected to need new steps since `notified` already exists from wave 1).

Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests/typecheck for the files you actually touched. The suites in `CI suites` run in CI on every PR; don't run them locally, and don't list them as a gate here.

Name the shell gate: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is pure TypeScript (domain rule + fleet applier wiring) and should add zero lines of shell — if you find yourself touching a `.sh` file, that is a signal you've drifted from the plan's stated "adds no `spawn` site and no `plot-*.sh` line" (Layering, plan line 71).

### Bookkeeping

Open the PR through the controller as soon as a real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly. Once the PR exists, append `→ #<number>` to this branch's line under `### Idle notification` in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `packages/domain/src/rules/slice-idle.ts` (or similarly named) — the new rule
- `packages/domain/src/workflows/decision.ts` — the new notify-write kind (additive; do not touch the existing `NotifyWrite`/`AgentFindingWrite` shapes)
- `packages/fleet/src/server/entry/registryd-main.ts` — the applier, beside `notifyEscalations`
- `packages/domain/test/slice-idle.test.ts` and the matching fleet-side test for the applier
- a `## Plot Config` addition for `Slice idle after` (default `2h`) in this repo's `CLAUDE.md`, and the matching lookup in whatever reads Plot Config for fleetd

No other branch is in flight for this plan — wave 1 (`feature/the-loop-keeps-a-run-log`) is merged and closed. `the-fleet-delivers-a-scope-alone` sibling plans (#2900–#2907) are expected to add their own steps to `RunLogStepSchema` later; this slice does not need to coordinate with them, since none of them touch the idle rule itself.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

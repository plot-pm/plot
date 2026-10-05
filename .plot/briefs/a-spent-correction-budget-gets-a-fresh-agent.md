## Implementation brief — a-spent-correction-budget-gets-a-fresh-agent (wave 2: A spent correction budget gets a fresh agent)

- **Plan (canonical):** `docs/plans/2026-10-05-a-spent-correction-budget-gets-a-fresh-agent.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `feature/a-spent-correction-budget-gets-a-fresh-agent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This wave waits on wave 1 (`bug/the-correction-budget-counts-per-slice`, merged as #1285). The rule below is meaningful only because the count is now per slice. Nothing waits on this wave.

### What to build

**The failure it fixes.** Measured 2026-10-05 with auto-dispatch on: when a slice spends its `Correction budget`, the loop writes `PLOT-BLOCKED: the build for <branch> failed after N corrections …`, writes an ending with reason `unstarted`, and exits 1 (`plot-worker-loop.sh:2911-2916`). Its exit trap removes the agent's manifest, so the registry no longer names the desk and `supervise` never sees it. Delivery of the slice stops until a person reads the marker. The failures that did this today were small and mechanical (the domain actor-name gate, then the domain coverage gate), and each was fixed by the master session starting a separate agent by hand with the failure text. This wave makes the supervisor do that once, then ask a person.

Three parts, as the plan's Slice 2 lays out:

1. **The loop says why it stopped.** At `plot-worker-loop.sh:2911` the ending reason `unstarted` becomes `corrections-spent`. `EndingReasonSchema` (`packages/domain/src/entities/ending.ts:96`) gains the value, and `endingIsAttributable` (`packages/domain/src/transitions/agent.ts:414`) admits actor `agent` for it — add it to the `!==` chain and to the refusal's sentence. The shell change replaces one word and adds no line.
2. **One domain rule decides.** `freshAgentAfterCorrections(readings)` in `packages/domain/src/rules/`, arrow function, with a TSDoc block that states behaviour only. Answers `start-fresh` when the ending is `corrections-spent` and the slice had no fresh session, `needs-a-person` when it is `corrections-spent` and one already ran, and no answer for any other ending.
3. **The supervisor acts.** The registry tick (`packages/board/src/server/entry/registryd.ts:204`, applied in `entry/registryd-main.ts`) starts one fresh session on the same desk with an answer it composes: every correction from `PLOT-CORRECTION.md` in order, the failing run's URL and its failed step, and one instruction — "the previous session spent its correction budget; read every failure above before you change anything, and run the checks that failed locally before you push". It records the start in `.plot/state/fresh-agents.tsv` (branch, desk, time, the failing run).

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The rule reads the desk, not the registry.** The manifest is gone by the time the budget is spent (the exit trap removes it), so a rule keyed on agents never sees this ending. `an-unanswered-question-escalates` reads desks for the same reason. Reading the desk's `ending` file and `PLOT-BLOCKED.md` is the reading; `.plot/state/endings.jsonl` is not, because `plot-reap.sh` removes the desk's own ending file with the desk and the jsonl is an audit append, not a decision input.

**A fresh session is not a resume, not a new desk, and not unbounded.** A resumed session carries the context that produced the failing commits twice. A new desk fails because the branch is checked out in the old one and git refuses a second checkout. One per slice, then a person.

**The record's failure mode is chosen.** A missing or unreadable `fresh-agents.tsv` reads as "no fresh session yet". That can start one extra session; it cannot stop delivery silently. Absent is not false, in the other direction too: do not read a missing record as "already had one".

**The marker is the loop's, not an agent's question.** The tick answers no question a person owes, and `an-unanswered-question-escalates` keeps every agent-written question for a person. Do not widen the new rule to a marker the agent wrote itself: only the `corrections-spent` ending qualifies, never the marker's presence alone.

**Verify before you build: `POST /api/continue` cannot be called unchanged from the tick.** The plan says the tick uses "the existing continue path". Measured at dispatch: `handleContinue` refuses `no-manifest` when no manifest names the desk (`packages/board/src/server/continue.ts:484`, "a continuation needs one name to stamp"), and the spent-budget desk has no manifest. Also, `AgentResumeWrite` (`decision.ts:245`, kind `agent-resume`) already carries `resumeId: ''` meaning "start a fresh worker with this text in its brief". Read both before choosing. Reuse what composes the prompt (`composeContinuation`, `continue.ts:229`, and `manifest-stamp.ts` for `relaunches` and `previousPid`) and do not copy it. If neither path fits without a change to the continue route's refusal, say so in the PR rather than loosening `no-manifest` for every caller. Report what you find.

**Layering.** The tick is a controller: it calls the domain and never spawns. The start goes through the performer port and its adapter, as `startFreeAgent` does. The new TSV is a port with an adapter, not a file write in the tick. `scripts/check-*.sh` and the purity gate hold both boundaries. The spawn ratchet (`ci.yml`, `allowed=28`) counts `spawn`/`execFile` outside `adapters/` and fails if the number grows.

**Rules carried over unchanged.** Read the exit code, not the emptiness. A function you write is an arrow. Domain vocabulary: the actor is an **Agent**; do not add a `Worker`-named type or field outside the six process states. `Wave` is not to be added where `Slice` is meant.

### Done when

The plan's `## Slices` entry and Design section are the specification. Its **Tests** list is the minimum:

- `freshAgentAfterCorrections`: `corrections-spent` with no prior fresh session gives `start-fresh`; with one gives `needs-a-person`; any other ending gives no answer; a missing record reads as none.
- The tick: a desk with a `corrections-spent` ending and no manifest produces one continue with the composed answer, and the same tick input with the start recorded produces none.
- The composed answer holds every correction in order and the failing run's URL.

Assertions that exist because a naive implementation would pass without them:

- **A second spent budget on the same slice reads `needs-a-person` and writes a `blocked` declaration.** Catches a rule that restarts forever, the unbounded case the plan names.
- **A desk with a `corrections-spent` ending and a manifest still present is not started twice.** Catches a tick that acts on both the supervise path and the new rule.
- **An `unstarted` ending (a prompt that never started) gives no answer.** Catches the ending reason still being overloaded; the old meaning must keep its own handling.
- **An agent-written `PLOT-BLOCKED.md` with no `corrections-spent` ending gives no answer.** Catches a rule keyed on the marker, which would answer a question nobody owes.
- **The shell ending writes `corrections-spent` and the board reads it through `EndingReasonSchema`.** Catches the enum and the shell word drifting; the board contract tests parse the value.
- **The recorded start survives a tick that throws after the write.** Catches a record written after the start that a crash can lose, which would start a second session.

Plus the repo's gates. Run `nvm use` first (Node 24; `pnpm` crashes on 26) and `pnpm install` if `node_modules` is missing. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-worker-loop.sh` by one word, so it grows nothing; if you find yourself adding a shell line, stop: write the rule in the domain and ask it through a bundle, or remove shell elsewhere in the same change. The gate stores no number and has no override.

A **changeset** is required: `.changeset/*.md` with the description FIRST and the `bumps:` block LAST, package `plot`, and a `plan:` line naming this plan inside the same comment block. The board package may need its own entry; `./scripts/check-changeset-packages.sh` names what is wrong. Do not edit `metadata.version` by hand. Do not commit a rebuilt `board-server.mjs` (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-loop.sh` — the one word at the spent-budget ending
- `packages/domain/src/entities/ending.ts`, `packages/domain/src/transitions/agent.ts` — the new reason and its attribution
- `packages/domain/src/rules/` — `freshAgentAfterCorrections` and its tests
- the port and adapter for `.plot/state/fresh-agents.tsv`
- `packages/board/src/server/entry/registryd.ts` and `registryd-main.ts` — the tick's call and its application
- `.changeset/`

**In flight beside it**, verified at dispatch with `git ls-remote --heads origin`: `feature/a-question-is-listed-as-waiting-on-you` (plan `an-unanswered-question-escalates`, wave 1: the desk's marker as a reading, the `question` field in the fleet payload, the WAITING ON YOU placement in `fleet.ts`). Its second wave (`feature/a-question-notifies-as-it-ages`) will also edit `registryd.ts` and `registryd-main.ts` (a `notify` write and `.plot/state/escalations.tsv`) and is not yet a branch. Keep your tick change one added call and one applied write so a later rebase is mechanical. Do not edit `fleet.ts` or the marker reading.

**Do not touch:** the correction count (wave 1, merged); `an-unanswered-question-escalates`'s `questionEscalation` rule and `Notifier` port; the JS loop in `agent-loop.ts` beyond reading what it already emits (`the-worker-loop-runs-in-js` will emit `corrections-spent` itself; leave a note, not an edit).

The plan's two Open Questions are yours to leave open unless the work forces one: whether the fresh session should run on a stronger model, and whether a spent budget whose failures are all the same gate should go to a person at once. Do not settle either silently; if you implement one, say which in the PR description.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

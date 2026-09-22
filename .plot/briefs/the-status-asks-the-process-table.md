## Implementation brief — a-loaded-label-is-not-a-running-daemon (the status asks the process table)

- **Plan (canonical):** `docs/plans/2026-09-22-a-loaded-label-is-not-a-running-daemon.md` on `main`
- **Approved:** 2026-09-22, jwloka, in-session
- **Branch:** `bug/the-status-asks-the-process-table` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Sole slice — nothing waits on it and it waits on nothing. The plan was amended after a panel round; read the amendment banner first, because three facts in the original evidence were refuted and the corrected ones are what this builds against.

### What to build

`plot-fleetctl.sh --status` answers `supervisor: running` whenever launchd holds the label, without ever asking whether the process behind that label is alive. Measured twice in ninety minutes on 2026-09-22: `--status` said `running`, `ps` for `registryd.mjs` found nothing, and `launchctl list` showed the label loaded with `-` in its **first** column — which is launchd saying *no pid*. The last tick in the log was the previous day at 15:52 on the first occasion and 88 minutes earlier on the second. An operator was told the fleet was healthy while dispatched slices sat unserved.

Make `--status` report two readings rather than one verdict: the label, and the process. Three answers where there are two today.

| label | process | answer | exit |
|---|---|---|---|
| loaded | alive | `running` | 0 |
| loaded | **absent** | **`loaded, not running`** + the two-command repair | **1** |
| not loaded | — | `not loaded` | 1 |

The middle row is the whole slice. `install=` gains the matching third value and `supervisorState` gains the arm that reads it, both here. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Ask `supervisor_pid`, never `ps | grep`.** `supervisor_pid` already exists at `plot-fleetctl.sh:145`, is already called in the arm being changed (`:312`), and is scoped to `$LABEL`. The panel refused `ps | grep` for two reasons: a sibling agent's command line can flip it, and it silently regresses the systemd arm, where `systemctl is-active` already answers correctly.

**`KeepAlive: true` does restart the daemon.** The plan's first draft said the opposite and was measured wrong — `runs` counted 38 → 39 → 40 in about forty seconds. The deaths were a throttled crash loop, not launchd declining to act. This makes the status defect worse, not milder: a crash-looping label reports `running` at every moment between restarts, which is most of them. Do not "fix" this by waiting for a restart.

**Why the daemon died is already fixed elsewhere — do not chase it.** `2026-09-22-a-failed-tick-must-not-end-the-daemon.md` merged the same day (`65071ef52`); the supervisor's loop had no `catch`. If you try to reproduce the crash loop on current `main` you will likely fail, and that is the sibling plan working. This slice reports the symptom; it does not need the cause present.

**The `plot-boardctl.sh` precedent is withdrawn.** Its two-facts-must-agree rule belongs to `--stop`, not `--status`. What survives is the shape: report both readings on separate lines rather than folding them into one verdict.

**The tick age is evidence, not the verdict.** A log's mtime says when it last wrote, and a busy daemon between ticks has not written for up to 60 s. Print the age; never derive liveness from it.

**`--status` starts nothing.** The rule the file already holds at `:291` — *"a status that started what it was asked about could never report an absence"*. The repair goes in the message, not in the command.

**`install=` gains the third value; it does not reuse `running`.** Accepting `install=running` beside `exit 1` puts the same contradiction one field deeper — a caller reading `install=running` while the command exits 1 must know which to believe, and that is the defect being removed.

**The exit code must not carry the new state.** `supervisorState` (`packages/domain/src/rules/supervisor-reading.ts:216`) gates on exactly 0 and 1 and answers `unknown` for everything else, so a third exit code renders `unknown` from precisely the machines that most need an alarm. The state travels as a `summary:` field; the code stays 0/1. The existing test at `test/reconcile/fleetctl.test.mjs:692` states this in its own words.

### What a naive implementation gets wrong here — read before editing

**`supervisor_loaded` is called four times in the status arm, and two of them are after the message.** Lines `:310` (the `elif`), `:407` (composing `supervisor=up|down` on the summary line) and `:408` (`supervisor_loaded; exit $?`) are separate calls. **Editing only the `elif` branch leaves `:408` overriding your exit code** — the middle row will print correctly and still exit 0. The file's own comment at `:297` says the state is captured once per arm for a measured board budget of 5,000 ms against 4726–9770 ms with three agents; adding a fifth launchd call spends that budget. Capture the pid once in the arm and reuse it.

**`stubPlatform` emits no pid today, and that is why the existing pass is fragile.** `test/reconcile/fleetctl.test.mjs:682` writes `launchctl` as bare `exit 0` / `exit 113` with no stdout, so `supervisor_pid` already parses empty for a "loaded" stub. Under this change that stub *becomes the middle row*, and `--status exits 0 and says up where the init system holds the label` (`:726`) will flip to exit 1. That is the contract moving, not a regression — extend `stubPlatform` to emit a `pid = N` line for the genuinely-running case, and keep a pidless-loaded variant for the new row.

**`supervisorState` needs one arm, not a fifth state.** It is already four-valued (`up | down | unknown | died`) and line `:220` already discriminates on `install`: `readings.exitCode === 1 ? (readings.install === 'installed' ? 'died' : 'down') : …`. The new value follows that exact shape. `died`'s documented meaning — *"needs the log read first, because whatever killed the supervisor once will kill it again after a start"* — is the semantics this state wants. Decide deliberately whether the new `install=` value maps onto `died` or earns its own word, and say which in the commit; do not invent a fifth `SupervisorState` by reflex.

**An absent `install=` field is `down`.** That is the stated compatibility contract (`supervisor-reading.ts`, *"AN ABSENT FIELD IS `down`"*) — a board reading an older script must behave exactly as before. Do not change the fallback to `unknown`.

**`supervisor_loaded` returns 0 or 1 and never the init system's own code.** `launchctl print` answers 113 for a label it does not hold; this was a real defect (`:126`) with a test at `:537`. Any new probe you add obeys the same rule.

### Done when

The plan's `## Done when` content is the specification — the three-row table above plus the `install=`/`supervisorState` change.

Lifted because a naive implementation passes without them:

- **A loaded label with no pid exits 1.** Catches the `:408` override described above — the message alone can be right while the code is wrong.
- **A loaded label with a live pid still exits 0 and says `running`.** Without it, the slice is satisfied by a script that answers 1 unconditionally. This is the existing `:726` test, adapted.
- **All three rows run on CI's `ubuntu-latest`.** The seam is `test/reconcile/fleetctl.test.mjs:467-482`: source with `PLOT_FLEETCTL_SOURCED=1` and stub `platform` and `supervisor_loaded`, *"which is what makes the launchd arm reachable on CI"*. An earlier draft scoped this promise away claiming the arm was unexercisable there; the panel measured that false. Do not narrow it again.
- **The summary line keeps its shape.** `^summary: agents_running=\d+ agents_other=\d+ supervisor=\S+ install=\S+$` is asserted at `:639`.
- **The new `install=` value reaches `supervisorState` and renders as something other than plain `down`.**

Plus the repo gates: `nvm use` first (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and a changeset. **Do not run `pnpm run test:e2e`** — it is CI's gate, not a local one.

The changeset names `plot` with a `bumps:` block for the `plot-fleet` skill if its SKILL.md changes; description first, `bumps:` last, and it may carry a `plan:` line pointing at this plan.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-fleetctl.sh` — the `--status` arm and its helpers
- `packages/domain/src/rules/supervisor-reading.ts` — the `install=` arm
- `test/reconcile/fleetctl.test.mjs` — the three rows and `stubPlatform`
- the matching domain test file, and a changeset

Out of scope, each with its own plan: why the daemon dies (`a-failed-tick-must-not-end-the-daemon`, already merged), how the board renders the third state (`bug/the-board-says-the-fleet-is-stopped`, named in `plot-fleetctl.sh:326`), and the leaked test unit that held the production label — 103 sandbox directories and `com.plot-pm.registryd` bound to a temp plist, recorded in the plan's Notes as deserving its own plan. **Do not fix the leak here**, but if `fleetctl.test.mjs` work makes the one-line containment obvious, say so in the PR rather than acting on it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

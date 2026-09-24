## Implementation brief — a-supervisor-that-stopped-ticking-is-not-running (wave 2: The board shows the tick age)

- **Plan (canonical):** `docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-board-shows-the-tick-age` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

This slice waits on wave 1, `bug/the-status-says-when-it-last-ticked`. Wave 1 prints `  last tick: <N>s ago (…)` in `--status`'s running arm and changes no machine-read field. At dispatch (2026-09-24) its remote ref points at a `main` commit and carries no work. Cut this branch from `main` after wave 1 merges, and read the helper wave 1 extracted before you add a field.

### What to build

On 2026-09-23 `plot-fleetctl.sh --status` printed `supervisor: running (pid 3260)` while `.plot/logs/registryd.log` had not been written for 25 hours. The board rendered nothing at all: `supervisorVerdict` answers `shown: false` for `up`, and `FleetAlert` (`packages/board/src/app/components/FleetControls.tsx:354`) returns `null` when `shown` is false. Wave 1 puts the number in the shell output. This slice puts it on the surface an operator visits.

The path already exists end to end. Add one field to each hop:

1. **`plot-fleetctl.sh --status`** — append `tick_age=<seconds>` to the `summary:` line in the running arm, from the helper wave 1 extracted. Omit the field when no log file exists.
2. **`packages/board/src/server/supervisor-reading.ts`** — read `tick_age=` off the `summary:` line exactly the way `installState` reads `install=`: scan the summary line only, never the whole buffer. The prose above it now contains `last tick:`, and a loose match reads a value out of a sentence.
3. **`packages/domain/src/rules/supervisor-reading.ts`** — `SupervisorRun` gains an optional `tickAgeSeconds`. The staleness judgement lives here as a pure function with unit tests, and `supervisorVerdict` uses it.
4. **`packages/board/src/contract/schema.ts`** — `SupervisorSchema` carries what the banner needs (see *The wire*, below).
5. **`FleetAlert`** — renders the verdict it receives. It decides no word, no colour and no threshold.

The verdict is built at `packages/board/src/server/fleet.ts:7629` on the render clock. The reading is taken once per refresh at `:3166`. Keep that split. The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The judgement is a domain property, never a threshold in shell.** Wave 1 prints the number with the caveat *evidence, not the verdict*. The shell stays that way. The threshold lives in `rules/supervisor-reading.ts`, where a unit test can name it and no browser is needed. A `.tsx` that compares `tickAgeSeconds` against a number is the decision-in-a-component that `CLAUDE.md` › *Every rendered state is a domain property* rules out.

**The threshold is yours to choose, with these measured bounds.** The supervisor waits 60 s after a tick. Normal ticks measured 13–49 s. The last tick before the silence measured 2,478,705 ms (41 minutes). A threshold below about 110 s (60 s wait plus a 49 s tick) flags a healthy, busy estate, and an operator learns to ignore the banner. The plan's own argument sets the upper bound: a threshold generous enough to be safe must still catch 25 hours long before a person does. Name the constant, export it, and put the measurement in the commit message, not in a 4:1 TSDoc block (`CLAUDE.md` › *Factual API documentation*).

**`state` stays `up`. Staleness is not a fifth state.** The plan keeps `summary: … supervisor=up install=running` for a running supervisor whatever the tick age, because the state word answers *is a process behind the label*, and that was true. The same reasoning applies on the wire: `SupervisorWireState` and the schema enum stay `'up' | 'down' | 'unknown' | 'died'`. The `died` header in `rules/supervisor-reading.ts` explains why a new state needs a reader who acts differently. A stale-but-running supervisor is expressed through `prominence`, `shown`, `label` and `detail`.

**`warn` is the level that already waits for this.** `SupervisorProminence` documents `warn` as *"No supervisor reading produces it today; it stays because prominence is a scale and the level between a note and an alert is a real one a later state may need."* A stale `up` is that reading. `FleetAlert` already styles `warn` (`FleetControls.tsx:370`). Whether a stale `up` with agents running escalates to `alert` is a judgement for you to argue in the commit. The plan's own finding is that idle agents with no claimable work were correct behaviour, so staleness alone is not evidence that work is neglected.

**`shown` must become true for a stale `up`.** `supervisorShown` is currently `state !== 'up'`. If the verdict gains a warning and `shown` stays false, `FleetAlert` returns `null`, every unit test on the label passes, and the board shows nothing. That is the measured defect reproduced one layer up.

**No heartbeat file, no second reader of the log.** The board never `stat`s `registryd.log` itself. `plot-fleetctl.sh --status` is the one source (`rules/supervisor-reading.ts` header), and a second implementation drifts toward *looks fine*. `supervisor.ts:49` rejects a memo that outlives the tick, and a heartbeat file is that memo on disk.

**Labels say *fleet*, never `registryd` or the launchd label.** The `supervisorVerdict` header settles this vocabulary. A stale label names the consequence a reader decides about. It does not name the component.

Rules carried over from related work:

- **Absent is not zero.** No `tick_age=` field means one of three things: an older script, a machine with no log, or a state other than `running`. None of them is a fresh tick and none of them is a stale one. `tickAgeSeconds` is `undefined`, and the verdict for `up` is exactly today's: `quiet`, `shown: false`. Parse `tick_age=` with an empty or non-numeric value as absent. Never parse it as `0`.
- **Read the code, not the emptiness.** Every existing gate in `supervisorState` stays first. A run that was not asked, or that did not reach its `summary:` line, is `unknown` whatever `tick_age=` it carried.
- **The client casts, it does not parse.** Zod defaults do not apply client-side. A new schema field is `undefined` in the renderer unless the server fills it. `FleetAlert` must handle its absence.

### The wire

Choose the smallest schema change that lets the banner render the verdict. Two shapes fit the rules:

- The verdict alone carries the stale reading through `prominence`, `shown`, `label` and `detail`, and the schema is unchanged. This is the smallest option.
- Add an optional `tickAgeSeconds` to `SupervisorSchema` if the banner prints the number. It must be optional, because an older script sends none.

Either way, the sentence that carries the number is composed in the domain, not in the `.tsx`.

### Done when

The plan's `### Done when` list and this slice's line in `## Slices` are the specification. Assertions that exist because a naive implementation passes without them:

- **A stale `up` is shown.** Assert `shown === true` and a non-`quiet` prominence in `packages/domain/test/supervisor-reading.test.ts`. A test on `label` alone passes while `FleetAlert` renders nothing.
- **A fresh `up` stays silent.** Just under the threshold → `shown === false`, `prominence === 'quiet'`. This catches a threshold set below a busy tick.
- **An absent `tickAgeSeconds` on `up` is today's verdict, deep-equal.** This catches `undefined` read as `0` (fresh, harmless) or as `Infinity`/`NaN` (stale, an alarm on every older script).
- **`state` is `'up'` for every tick age.** This catches a fifth state or a downgrade to `down`.
- **`unknown` and `died` ignore the field.** A not-asked or unsummarised run carrying `tick_age=90061` is still `unknown`.
- **The server parse reads the summary line only.** In a unit test for `readSupervisor` with a stubbed `Scripts`, stdout contains `last tick: 5s ago` in prose and `tick_age=90061` on the summary line → `90061`. A second case has no summary field → `undefined`.
- **The shell field is absent without a log.** Add a case to `test/reconcile/fleetctl.test.mjs` next to wave 1's cases: a running supervisor with a backdated log prints `tick_age=` with a large value on the `summary:` line. The same line still matches `supervisor=up install=running`, and the script still exits 0. With no log, the summary carries no `tick_age=`.
- **One browser assertion that the banner shows it.** Extend `packages/board/test/integration/supervisor-badge.browser.test.ts` with a stale `up` payload: `data-fleet-supervisor-state="up"` renders with the warn prominence. Browser tests load the built artifact, so run `pnpm build:board` first.

Plus the repo gates:

- `nvm use` (Node 24). Use `corepack pnpm` if homebrew pnpm crashes.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`
- Rebuild and commit `skills/plot/scripts/board/board-server.mjs` (`pnpm build:board`), plus any other bundle the build rewrites. CI's no-diff gate fails a stale artifact.
- **Not** `pnpm run test:e2e`. That is CI's gate.
- A changeset with the description first and the `bumps:` block last, carrying `plan: docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md`. Name `'@plot-pm/board': patch` for the board and domain change. Because `plot-fleetctl.sh` gains a field, also name `'plot': patch` with `bumps: skills: plot-fleet: patch`. Check that `./scripts/check-changeset-packages.sh` passes.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Do **not** use `gh pr create`.
- When the PR exists, write the number inside this slice's wave heading in the plan on `main`: `(Branch: bug/the-board-shows-the-tick-age, PR: #N)`. Make that edit from a detached scratch worktree on `origin/main`, not in the shared main checkout.
- No project board is configured, so no board status is set.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-fleetctl.sh`: the `tick_age=` field on the running arm's `summary:` line, and nothing else
- `packages/domain/src/rules/supervisor-reading.ts` and `packages/domain/test/supervisor-reading.test.ts`
- `packages/board/src/server/supervisor-reading.ts` and a unit test for it
- `packages/board/src/contract/schema.ts`: `SupervisorSchema` only
- `packages/board/src/app/components/FleetControls.tsx`: `FleetAlert` only
- `packages/board/test/integration/supervisor-badge.browser.test.ts`
- `test/reconcile/fleetctl.test.mjs`: the summary-field cases
- the rebuilt board artifacts and one `.changeset/*.md`

In flight at dispatch (2026-09-24), checked against every `origin/*` ref:

- `bug/the-status-says-when-it-last-ticked` (wave 1): owns the running arm's prose line and the tick-age helper in `plot-fleetctl.sh`. This branch starts after it merges.
- `bug/the-unload-is-verified-to-a-bound` (plan `a-stop-that-reports-failure-does-not-exit-zero`): edits the `--stop` arm of `plot-fleetctl.sh` and adds cases to `fleetctl.test.mjs`. This is a different arm, so any conflict is textual. Rebase and keep both.
- `bug/a-row-with-no-plan-is-not-a-plan`: edits `packages/board/src/server/fleet.ts` near `rowsFromPulse` (`:7058–7117`). This branch should not need `fleet.ts`. If it does, the verdict call at `:7629` is the only line to touch.
- `feature/one-monitor-watches-the-slice`: adds to `packages/board/src/contract/schema.ts` at `ProcessGroupSchema` (`:3035`). `SupervisorSchema` is at `:3513`, so any conflict is textual.
- `board-server.mjs` conflicts with every board branch. Take either side, run `pnpm build:board`, and commit. Do not read the diff (`docs/definition-of-done.md`).

Out of scope, named in the plan: `--once` printing the previous tick's age, the cause of the 41-minute tick, and the agent bound.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

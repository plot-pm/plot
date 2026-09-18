## Implementation brief — a-stopped-fleet-names-its-repair (wave 1: The reading carries which stopped)

- **Plan (canonical):** `docs/plans/2026-09-18-a-stopped-fleet-names-its-repair.md` on `main`
- **Approved:** 2026-09-18, jwloka, in-session
- **Branch:** `bug/the-reading-carries-which-stopped` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention

Wave 2 (`bug/the-banner-names-what-died`) waits on this branch and carries the `waits:` annotation that enforces it. It renders the new state — the banner, the wire schema enum, the DOM attribute. **This slice must not touch any of those.** It widens the script's prose, carries a new optional field through the reading, and teaches `supervisorState` a fourth word. If the fourth word has no renderer when this merges, that is correct: wave 2 is the renderer.

### What to build

`plot-fleetctl.sh --status` distinguishes five machine states in prose and hands the board **one bit**. The status arm ends `supervisor_loaded; exit $?` (`skills/plot/scripts/plot-fleetctl.sh:363-364`), so four different machines all reach `supervisorState` as `down`.

The one that lies is `installed`. `fleet_install_state` (`:203-213`) returns it when the unit file exists **and** the start marker exists — and `--stop` removes that marker only after a successful unload (`:640`). So `installed` is reached exactly when a completed `--start` was followed by the supervisor **dying or being booted out on its own**: a crash, a logout, an OS update. That machine currently falls into the `*)` arm at `:327` and reads:

```
supervisor: not installed (<label>) — no unit on this machine
```

False about the machine, and it hides an unexplained death. An operator told *not installed* does not open `.plot/logs/registryd.log`, and a crash-looping supervisor will crash again after `--start`.

Build: `--status` appends its install state to the `summary:` line, `SupervisorRun` carries it as an optional field, `supervisorState` answers a fourth value from it, and the `installed` state gains its own prose arm. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The field goes ON the `summary:` line, not beside it and not before it.** That line's *presence* is what `readSupervisor` tests for `summarised` (`packages/board/src/server/supervisor-reading.ts:99`, `run.stdout.includes(SUMMARY_PREFIX)`). Moving the field to its own line would weaken the `unknown`/`down` split that the whole rule exists for. An appended `key=value` cannot break it — `includes` is a substring test, not an equality one.

**The exit code is unchanged: 0 loaded, 1 not.** `supervisorState` gates on exactly those two values and answers `unknown` for everything else (`packages/domain/src/rules/supervisor-reading.ts:147-153`). Widening the code to carry the state would render `unknown` from every machine in the new state. There is a regression lock for this already — `test/reconcile/fleetctl.test.mjs`, *"--status starts nothing in any state, and keeps the board contract"*, asserts `r.status === 1` **exactly**, never merely non-zero, because `launchctl print` answers 113 for a label it does not hold and that defect shipped once.

**The new field is OPTIONAL on `SupervisorRun`.** A board running against an older script must behave exactly as today. `supervisorState` answers `down` when the field is absent — pin that with a test, because it is the compatibility contract and nothing else enforces it.

**`installed` is the subject; `interrupted` is not.** An earlier draft led with `interrupted` and claimed the board prints a repair that cannot work. **That is false and was corrected by the panel.** `--start`'s refusal 4 fires only when the supervisor is *already loaded* (`:416`), which `interrupted` by definition is not — so `--start` proceeds, rewrites the unit, and runs `launchctl bootstrap` itself (`:493`). The script says so at `:325`: *"Nothing needs re-cutting: /plot-fleet --start also does this."* Do not reopen this.

**`platform: none` prints a repair that IS refused, and it is in scope.** The `none` arm at `:297-298` returns before `fleet_install_state`'s `case`, so the state machine never sees it and `supervisor_loaded` falls through. The board then prints `/plot-fleet --start` on a machine where `:406` refuses by design — *"REFUSAL 3 — no init system to hand the daemon to."* Report this state on the summary line too, **or name in the PR why not**. It is reachable by construction and no test covers it.

**A timeout DOES reach `down`, and `summarised` is what usually keeps it out.** An earlier draft claimed the adapter rejects on timeout, citing `scripts-shell.ts:147`. **Both halves are wrong.** That line is inside `stream`, which `readSupervisor` never calls; `readSupervisor` uses `awaited` → `runProcess` (`run-script.ts:60`), which binds **only `resolve`** and documents *"Never throws for a non-zero exit."* Reproduced 2026-09-18:

```
{"derivedCode":1,"killed":true,"signal":"SIGTERM","summarised":true} -> supervisorState => down
```

What keeps a timeout out of `down` is that the `summary:` line is the script's last, so a killed run has usually not printed it. *Usually.* **The 5,000 ms budget is not this plan's** — one plan per defect — so do not widen scope to fix it.

**Two files are named `supervisor-reading.ts`, and this slice touches both.** The plan's `supervisor-reading.ts:88` means the board one:

- `packages/domain/src/rules/supervisor-reading.ts` — the **rule**: `SupervisorState` (`:29`), `SupervisorRun` (`:39`), `supervisorState` (`:147`), `supervisorProminence` (`:172`), `supervisorVerdict`. Arrow functions, per the domain package's style.
- `packages/board/src/server/supervisor-reading.ts` — `readSupervisor` (`:87`), which spawns the script and builds the `SupervisorRun`. This is where the new field is parsed out of stdout.

Reading only the rule file and looking for `readSupervisor` returns nothing, which reads like the caller does not exist.

**Carried over unchanged:** absent is not false — a missing field means *an older script*, never *not installed*. Read the exit code, not the emptiness. And a second implementation reading a pidfile, a process name or `launchctl` directly would drift toward *looks fine*, which is the direction nobody notices; `--status` stays the one source.

### Done when

The plan's `## Slices` → *The reading carries which stopped* → `Done when` list is the specification. Lifting the assertions that exist **because a naive implementation would pass without them**:

- **The field is on the `summary:` line itself.** A naive implementation prints it on its own line and every existing test still passes — `summarised` only needs the prefix present. What catches it: an assertion that the state appears on the same line as `agents_running=`.
- **The exit code is exactly 1 for every not-loaded state.** A naive implementation encodes the state in the code. The existing `assert.equal(r.status, 1)` catches it only on a launchd machine — the test guards on `platform: launchd` and returns early on CI. Do not weaken that guard; add a platform-independent case the way `supervisor_loaded answers 1 for an absent label` does, by sourcing the script with `PLOT_FLEETCTL_SOURCED=1` and stubbing.
- **An absent field answers `down`, pinned.** A naive implementation answers `unknown` for the absent case, which looks defensive and silently degrades every board running an older script. Only a test naming the absent case catches it.
- **`installed` no longer reports *"no unit on this machine"*.** Assert the negative — `doesNotMatch(/not installed/)` for that state — the way the `NOT LOADED` test already does. Asserting only the new prose passes while the old line is still printed beside it.

Plus the repo's gates:

- `nvm use` first — Node 24, per `.nvmrc`. **pnpm crashes on Node 26** and a background job under it exits silently having produced nothing.
- `pnpm run test:contracts` — this is the named gate in the plan's `Done when`.
- `pnpm test` and `pnpm run typecheck`.
- `pnpm run test:board` if you touch anything under `packages/board/`.
- **Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one — it dispatches real workers into sandbox repos, and two agents running it once produced 53 concurrent `node --test` processes.
- A changeset. `@plot-pm/board` uses package frontmatter; a `skills/` change uses the `bumps:` block. Description **first**, `bumps:`/`plan:` block **last** — a block written first becomes the published changelog entry. Name the plan on a `plan:` line.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). It takes the title from the plan's wave heading and the body from the plan and this brief. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

### Scope guard

**This branch owns:**

- `skills/plot/scripts/plot-fleetctl.sh` — the `--status` arm and `fleet_install_state`
- `packages/domain/src/rules/supervisor-reading.ts` — `SupervisorState`, `SupervisorRun`, `supervisorState`
- `packages/board/src/server/supervisor-reading.ts` — `readSupervisor`'s parse
- `test/reconcile/fleetctl.test.mjs` and `packages/domain/test/supervisor-reading.test.ts`

**This branch does NOT own** — these are wave 2's, and touching them collides:

- `packages/board/src/contract/schema.ts:3519` — the `z.enum(['up','down','unknown'])`
- `packages/board/src/app/components/FleetControls.tsx:360` — `data-fleet-supervisor-state`, and `:387`'s detail-sentence guard
- `supervisorProminence` and `supervisorVerdict` — the banner's wording and loudness

Leaving the schema enum unwidened means the fourth state cannot reach the wire yet. **That is the correct end state for this slice**, because the server parses with that enum and the client only casts — so widening it here would ship a value with no renderer behind it.

**Other branches in flight, measured 2026-09-18:** one — `bug/the-index-is-read-once`, which touches `.changeset/the-index-is-read-once.md`, `skills/plot/scripts/plot-reconcile-scan.sh` and `test/reconcile/index-read-once.test.mjs`. **No overlap with this branch.** The other plans in `docs/plans/` naming these files (`the-board-says-whether-anything-supervises`, `the-installed-supervisor-hands-work-over`, `a-failed-gate-becomes-a-correction`) are all **Released** — they are this code's history, not competition for it.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The plan's own `## Notes` records that a diagnosis written into a brief eight days ago reached one agent and no index, and the defect sat unfixed — so an amendment goes to the plan, not into a brief.

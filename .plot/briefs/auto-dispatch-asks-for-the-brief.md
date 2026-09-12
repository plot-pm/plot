## Implementation brief — auto-dispatch-asks-for-the-brief

- **Plan (canonical):** `docs/plans/2026-09-12-auto-dispatch-asks-for-the-brief.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/auto-dispatch-asks-for-the-brief` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single slice, single branch. Nothing waits on it and it waits on nothing.

### What to build

**The board skips a plan as `no-brief` and tells a person to act. Make it ask instead.** Measured 2026-09-12 across seven dispatches in one session: every one reported `brief_asked=1 dispatched=0` on the first pass, and the claim followed 60–75 seconds later once a human's brief reached `origin/main`. The board was never the slow part.

On the pass where `skippedPlans` reports a plan as `no-brief`, run the configured `Brief command` for that plan, detached, and move on. Claim nothing that pass — the brief has to reach `origin/main` first, and the gate reads git rather than the filesystem. The next pulse finds the brief and claims normally.

Three parts: the spawn, a per-plan record so one pass cannot ask twice, and a budget check. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Ask, do not await.** The dispatch run reports that it asked; it does not wait for the brief. `plot-dispatch.sh:109` states the same distinction for the shell side — *"`brief_asked=N` COUNTS COMMANDS STARTED, NEVER BRIEFS WRITTEN."* A fan-out that blocked on one `claude -p` session of unknown length would hold every later branch behind it.

**One ask per plan per pass, and never a second while one is outstanding.** Measured 2026-09-11: a foreground dispatch timed out at 2 minutes while `timeout 300` on the inner script outlived it, and re-running produced two `claude -p` briefs for one slug. The record is in memory and per-board, mirroring `allInFlight` — a restart loses it, the brief either landed or did not, and the next pass asks again. That is the same recovery `plot-registryd.mjs` relies on by holding nothing between ticks; do not add a state file for it.

**A brief writer costs an agent.** `auto-dispatch.ts:1016` computes `budget = controls.parallelAgents - (liveCount + allInFlight.size)`. A `claude -p` brief session is a process like any other, so asking while the budget is spent starts work the operator capped. Ask only with budget to spare, and count the ask against it until the brief lands.

**An unset `Brief command` is today's behaviour exactly** — the skip is logged, nothing spawns, the operator writes the brief. Manifesto Principle 5: Plot hardcodes no agent tooling. Read the key fresh each pass rather than caching it at startup, for the same reason `readFleetSettings` is uncached.

**Reuse, do not rebuild — four helpers already exist and the plan names only one of them:**

- **The spawn shape is `approve.ts:294`.** A configured command is a shell FRAGMENT run through `sh -c`, and the prompt travels as one argument via `"$@"`, never interpolated into the command string. The safety is in the shape, not in the input. Copy `detached: true` and the no-`unref` decision with the reasoning at `approve.ts:308` — but read that comment before copying, because your case may want `unref`: the brief writer, unlike an approval, is not something the board's card is waiting on an exit code for.
- **`usableCommand` (`idea.ts:159`) already handles the `none` sentinel.** It is exported. Do not write a third copy of `case "$cmd" in none|NONE|None)`.
- **`briefPath` (`brief-path.ts`) is the one branch→path rule.** A leaf module with no imports beyond `node:path`, written to be taken without a cycle. `test/reconcile/briefpath.test.mjs` asserts it agrees with the shell.
- **`readConfig` (`board.ts:346`)** is how a board module reads a `## Plot Config` key.

**The prompt is already written, in the shell.** `brief_prompt()` in `plot-dispatch.sh` produces it, and its comment states the one rule: the agent is asked to run `/plot-implement <slug>` and is NOT asked to write a brief in its own words. `/plot-implement` step 4 owns brief authorship, and a prompt describing the brief here would be a second author. It is also told to commit and push, because the gate reads `origin/<main>` — a brief left in a working tree is invisible to the gate that asked for it, and the next pass would ask again, writing a file every pulse and never starting a worker. Match that wording rather than inventing one.

**A measured trap the prompt cannot fix.** `plot-dispatch.sh` carries the finding: `Unknown command: /plot-implement` in two 33-byte logs (2026-09-02, 2026-09-04) was literally true — Plot was installed as a plugin scoped to a *different* repository, and twelve skills including `plot-implement` were absent. The prompt's wording was never that defect. If a brief session produces nothing, check the skill directory exists before rewriting the prompt.

**`skippedPlans` is pure and stays pure.** Its docstring is explicit that it is a second pass over the same pulse, deliberately not an output of `planAutoDispatch`, and that it reads `dispatchable`, `inFlight` and `missingBriefs` in the planner's identical order so the two cannot diverge. The spawn goes in `maybeAutoDispatch`, which is where the file already puts every read and write — *"Every read and write is HERE; `planAutoDispatch` receives values and stays pure."*

**The ask is reported.** A pass that asked says so, with the plan named, in the same voice as the neighbouring skip logs. An operator reading the console sees the fleet acting rather than idling.

### Done when

The plan's `## Done when` list is the specification — it has none written out, so the Slices section stands in: the spawn on `no-brief`, the per-plan ask record, the budget check, and the report.

Lift these assertions, because a naive implementation passes without them:

- **A second pass with an ask outstanding spawns nothing.** Catches the 2026-09-11 double-brief. Assert on spawn count across two `maybeAutoDispatch` calls, not on the first call's behaviour.
- **A spent budget spawns nothing**, even with a `no-brief` plan sitting eligible. Catches an ask that skips the cap the operator set.
- **An unset or `none` `Brief command` spawns nothing and still logs the skip.** Catches a regression that makes a configured command mandatory.
- **The prompt reaches the command as one argument.** Catches interpolation into the shell fragment — a shape defect a working test would otherwise never notice, because a plan slug contains nothing that needs quoting.
- **The pass that asks claims nothing.** Catches an implementation that spawns and then dispatches the same branch on the same pulse, against a brief that is not yet on `origin/main`.

`auto-dispatch-spawn.test.ts` is the model: it stubs the script with a marker file that records arguments, never runs the real thing, and settles for the detached spawn with a short wait. Its `fixture()` builds a real git repo with briefs on `origin/main`, because the gate reads git.

Plus the repo's gates: `nvm use` first (pnpm crashes on Node 26), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`, and a changeset. **Not `pnpm run test:e2e`** — that is CI's gate, and running it locally starves the machine the board lives on.

The changeset is `'@plot-pm/board': patch` with package frontmatter, no `bumps:` block — this touches `packages/board/` and no skill. Description first, always.

**Rebuild the artifact.** The plan's board-impact note says so: `pnpm build:board`, committed. A merged fix that is not in `board-server.mjs` stays invisible to a running board and reads exactly like the fix not working.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work is moving). **Not `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Note the section is spelled `## Slices`, not `## Branches`, and the branch is named inside the heading as `(Branch: feature/auto-dispatch-asks-for-the-brief)` — annotate in the form the plan already uses.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/auto-dispatch.ts`, its tests under `packages/board/test/unit/`, and the rebuilt `skills/plot/scripts/board/board-server.mjs`. A new leaf module under `packages/board/src/server/` is in scope if the spawn wants its own home.

One other branch is in flight: `feature/a-delivery-verdict-names-what-it-ran`, holding `.changeset/lenses-name-what-ran.md`, `skills/plot-deliver/README.md` and `skills/plot-deliver/SKILL.md` — verified at dispatch, no overlap.

On a conflict in `board-server.mjs`, do not read the diff. It is generated output marked `-merge`: take either side, run `pnpm build:board`, commit the result.

**A reading note.** `plot-controller-gate.sh` matches on the script basename appearing in a command string, so `sed -n '400,500p' skills/plot/scripts/plot-dispatch.sh` is refused as though it were a dispatch. It is a read and the gate cannot tell. Split the name in the shell or use a variable; do not route around the gate for anything that actually invokes.

The plan leaves two questions open and out of scope: whether the board should surface `no-brief` in the UI, and whether an ask that never produces a brief needs a bound. If you find something the plan did not anticipate, report it rather than improvising outside scope.

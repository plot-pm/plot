## Implementation brief — a-board-or-fleetd-older-than (wave 1: Spawn Contract)

- **Plan (canonical):** [docs/plans/2026-10-26-a-board-or-fleetd-older-than.md](../../docs/plans/2026-10-26-a-board-or-fleetd-older-than.md) on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2729 merged
- **Branch:** `bug/a-spawn-carries-its-gate-contract` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This is the plan's first wave. The second wave, `bug/the-board-and-fleetd-report-their-contract`, waits on this branch — it reads the `SPAWN_CONTRACT` constant and the gate's `--spawn-contract` flag this wave adds. Nothing waits on this branch to start.

### What to build

A board or fleetd that started before a gate's spawn contract changed keeps spawning unattended runs with the old contract, and the main-checkout gate — which reads only its own process environment — cannot tell a stale spawner from a correct one. The incident (#2728, 2026-10-26): the board (started 2026-10-20) and fleetd (started 2026-10-17) were both running when `PLOT_MAIN_CHECKOUT_WRITER` shipped in `da7097509` (#2317, 2026-10-22). An implement run the stale board spawned got `PLOT_UNATTENDED=1` without the marker, the gate refused its commit, and the agent left its first writes in the main checkout (#2725) — with no way to tell, from the refusal text alone, that the cause was a stale spawner rather than a genuine mistake.

This wave gives every unattended spawn one number to carry (`SPAWN_CONTRACT`) and gives the gate that number to compare against its own. It does **not** make the gate detect every possible skew — only `absent` (unset) and a smaller number, which is the direction the incident hit. A spawner carrying a *larger* number than the gate (gate older than spawner) is also named, but the reverse-skew direction (a spawner that still grants a withdrawn marker) produces no refusal at all — the gate sees nothing on an allow, by design. That direction is wave 2's job (report-only, no gate change).

Build, in order:

1. **The rule file.** `packages/domain/src/rules/spawn-contract.ts`, exporting `SPAWN_CONTRACT` (a positive integer, starts at `1`) and `SPAWN_CONTRACT_ENV = 'PLOT_SPAWN_CONTRACT'`. `spawnContractEnv()` returns `{ PLOT_SPAWN_CONTRACT: String(SPAWN_CONTRACT) }` — modeled exactly on `backgroundGateEnv()` in `packages/domain/src/rules/agent-run-env.ts:33-38`, which returns a small object of forced env values. Also export `spawnContractReading(env)`, answering one of four shapes: `'absent'` (variable unset), `'empty'` (set to `''`), `'unreadable'` (set but not a positive integer — e.g. `'x'` or `'0'`), or `{ number }` (a valid positive integer). Keep `absent` and `empty` as distinct return values even though both currently mean "no contract" in practice — the plan is explicit that `absent` means "predates the contract" and `empty` means "a spawner cleared it on purpose," and no current spawner produces `empty`, so the distinction exists for the next spawner that might.

2. **Force it into the four env-building sites, last, after `backgroundGateEnv()`.** Each of these already does `...backgroundGateEnv()` (or the equivalent `backgroundGate()` export-line form) as the last merge step — add `...spawnContractEnv()` immediately after it, same pattern, so a caller's own value cannot override it:
   - `packages/domain/src/rules/agent-run-env.ts:67` — `agentRunEnv`'s return object, currently `{ ...inherited, ...plotEnv, ...backgroundGateEnv() }`.
   - `packages/domain/src/adapters/agent-run/agent-run-command.ts:67` — the `env: { ...request.env, ...backgroundGateEnv() }` object passed to `boundedRun.run`.
   - `packages/fleet/src/server/entry/prompt.ts:161-164` — the `backgroundGate()` function that prints `export NAME='VALUE'` lines for `plot-worker-loop.sh` to `eval`. Add the `SPAWN_CONTRACT_ENV` line the same way, iterating `{ ...backgroundGateEnv(), ...spawnContractEnv() }` or equivalent.
   - `packages/fleet/src/server/entry/worker-loop.ts:1567-1574` — the `env` object built for the desk prompt, currently ending `...backgroundGateEnv()`.

   These four cover every `startBoardRun` role on both runners (SDK and command) and every desk prompt, including desks `continuation.ts` and the dispatch desk launch start — read `packages/domain/src/rules/agent-run-env.ts`'s own TSDoc for why forcing-last matters (a project's own environment setting the same key ahead of this call must not win).

3. **The dispatch brief launch is separate — it's shell, not TypeScript, and today it carries NO background-gate relay of any kind.** `skills/plot/scripts/plot-dispatch.sh:826-827` spawns the `Brief command` directly with an inline env prefix: `PLOT_UNATTENDED=1 PLOT_MAIN_CHECKOUT_WRITER=1 PLOT_PLAN_SLUG="$bslug" PLOT_BRIEF_BRANCH="$branch" ...`. Checked directly: `plot-dispatch.sh` calls `plot-prompt.mjs` only twice today — `--launch` (around line 923, in `resolve_launch`) and `--capabilities` (around line 1475, in `start_worker`) — and contains zero references to `background-gate`/`backgroundGate` anywhere. There is nothing existing to extend; this slice adds the call from scratch.

   This script runs from disk per call, so it must read the number from its own bundle through a new `plot-prompt.mjs --background-gate` call (step 4 below adds that flag) rather than hand-constructing it. **Follow the script's own established capture pattern** (the same shape `resolve_launch` and `start_worker` already use for `--launch`/`--capabilities`, and the one the brief-settings line at `plot-dispatch.sh:825` uses): capture the call's stdout into a shell variable, e.g. `_brief_spawn_contract="$(node "$script_dir/board/plot-prompt.mjs" --background-gate 2>/dev/null || echo "")"`, then `export` it rather than splicing it as a literal `VAR=val` prefix. **Do not write it as an inline prefix token** (`PLOT_SPAWN_CONTRACT="$captured" PLOT_UNATTENDED=1 ...`) — the script's own comments at (around) `plot-dispatch.sh:1543-1550` document why: a `${var:+PLOT_X="$var"}` conditional prefix is not recognized by the shell as an assignment and errors `command not found`. `export` the captured line(s) in the subshell ahead of the `exec nohup sh -c '...'` call instead, the same way `PLOT_CAPABILITIES` is exported at `plot-dispatch.sh:1556` rather than prefixed.

4. **The gate reads it and `mainCheckoutWriteRefusal` splits in two.** `packages/domain/src/rules/main-checkout-write.ts:391` (today's `mainCheckoutWriteRefusal(scriptDir)`) becomes `mainCheckoutWriteRefusal(scriptDir, reading)`, taking the `spawnContractReading` result. Split its text in two:
   - **`mainCheckoutWriteRefusal`** keeps the desk-worktree instruction (the existing body). When `reading` proves a skew (`absent`, or a smaller number than `SPAWN_CONTRACT`, or a larger number), it adds one paragraph naming the spawner's number (or `"none"` for `absent`) and the gate's number, stating that the process which spawned this run loaded code older (or newer) than this gate, and telling the agent: if this run writes the main checkout by design (a deliver, reslice, story, auto-deliver or brief run), stop and report this refusal rather than working around it. **In that paragraph's case, drop the "route it through a disposable worktree" advice** (the existing lines at `main-checkout-write.ts:404-405` — `"If this really is bookkeeping ... route it through a disposable worktree"`). That sentence is what sent the #2725 agent around the refusal instead of reporting it; it must not appear when the cause is a proven stale spawner. `empty`, `unreadable`, or an equal number add no spawner paragraph at all — the base text is unchanged in those cases.
   - **`strandingResetRefusal(scriptDir)`** — a new function, pulled out of the same file, holding only the mixed-reset paragraph (today mixed into the same text as the main-checkout instruction). A marked deliver/reslice/story run must never read a sentence about a missing marker when only the stranding-reset arm fired.
   - `gate.ts:534` (`mainCheckoutGateOf`'s `ask`) returns `mainCheckoutWriteRefusal(...)` when `gatesMainCheckout` decided the arm, and `strandingResetRefusal(scriptDir)` when only `gatesStrandingReset` did. Read `gate.ts:523-539` before touching this — the `wants`/`ask` split and the `gatesMainCheckout`/`gatesStrandingReset` predicates themselves do **not** change; only which text each arm returns changes.
   - Neither text names a stop, restart, `kill` or `bootout` command — the plan is explicit that refusing to spawn from a stale spawner (the issue's third option) is out of scope; this is a text-content rule only.

5. **`plot-gate.mjs --spawn-contract`.** Add the flag to the gate entry so a reader (built in wave 2) can ask a plugin's installed gate "what number do you carry" without loading its whole module graph. It should print `SPAWN_CONTRACT` and exit 0. This is the one piece of wave 1 that exists only to serve wave 2 — wave 1 itself does not call it.

6. **Correct two stale docstrings** while touching this file: `main-checkout-write.ts:13-17` and `gate.ts:507-510` both still list the implement run as a marker (`PLOT_MAIN_CHECKOUT_WRITER`) setter. It is not — #2740 (`a98afb890`, 2026-10-26) removed the marker from the implement run; `implement-run.ts:652-659` now sets `PLOT_UNATTENDED`, `PLOT_BRIEF_ONLY`, `PLOT_PLAN_SLUG` and `PLOT_BRIEF_BRANCH`, no marker. The six current setters are deliver (`deliver.ts:649`), reslice (`reslice.ts:473`), story (`story.ts:514`), auto-deliver (`auto-deliver.ts:272`), brief-ask (`brief-ask.ts:163`) and the dispatch brief launch (`plot-dispatch.sh:827`).

### Decisions already settled — do not re-derive them

**The bump rule is binding, not advisory, and it is enforced by a test you must write.** Any change — in this slice or a future one — that adds, removes or renames an environment variable a gate reads (`PLOT_UNATTENDED`, `PLOT_MAIN_CHECKOUT_WRITER`, `PLOT_BRIEF_ONLY`, `PLOT_BRIEF_BRANCH`, `PLOT_SPAWN_CONTRACT`), or changes which spawn sets or clears one of them, must raise `SPAWN_CONTRACT` by one in the same change. Write this rule into `SPAWN_CONTRACT`'s own TSDoc. Then write `test/reconcile/spawn-contract-gate.test.mjs`: it reads the gate-read variable names from `gate.ts` and the domain rules it imports, and the setter files via a grep over `packages/*/src` and `skills/plot/scripts/*.sh`, and compares that against `spawn-contract.ts`'s exported `SPAWN_CONTRACT_SHAPE` (sorted variable names, and per name the sorted setter files, keyed to the *current* `SPAWN_CONTRACT` number). A mismatch fails with `the spawn contract changed: raise SPAWN_CONTRACT to N+1 and record the new shape`, naming the added/removed entries. **The file name must match `*gate*`** so `node --test test/reconcile/*gate*.test.mjs` (the `**` local check) runs it on every change — this is why the name is `spawn-contract-gate.test.mjs`, not `spawn-contract.test.mjs`.

**Only a proven skew gets a spawner paragraph — not every missing-marker case.** `empty` and `unreadable` are "no information," not "stale." Only `absent` or a differing number counts as proof. Getting this inverted (e.g. treating `unreadable` as `absent`) would print the spawner paragraph on a corrupted-but-not-actually-stale environment, which is a false accusation the plan explicitly guards against by keeping the four readings distinct.

**The "route it through a disposable worktree" sentence is removed only in the proven-skew branch of `mainCheckoutWriteRefusal`, not from the function unconditionally, and not from `strandingResetRefusal` at all.** The Open Questions section leaves this exact boundary unchecked (`[ ]`) for the operator — but the Design section's prose is unambiguous that the removal is conditional on the spawner-skew paragraph being present. Do not simplify this into an unconditional removal across both refusal texts; that would also silence the advice for the ordinary, honest desk-worktree case this refusal exists to help.

**`gatesMainCheckout`, `gatesStrandingReset`, and `wants`/`ask` in `gate.ts` are unchanged.** Only the *text* a known-firing arm returns changes. If your diff touches either predicate function's logic, stop — that is scope creep this plan explicitly excludes (reverse-skew allows are wave-2's report-only concern, not a gate behavior change).

**The dispatch brief launch reads the number through `plot-prompt.mjs --background-gate`, not by hand-constructing it, and no existing relay call is there to extend.** Checked directly (read the whole file): `plot-dispatch.sh` calls `plot-prompt.mjs` only for `--launch` and `--capabilities`; there is no `--background-gate` call today and no background-task-switch relay to piggyback on. This keeps the shell script and the TypeScript rule in agreement by construction — the shell never duplicates the number, it only relays what the bundle prints — but it is a genuinely new subprocess call, one `node ... --background-gate` invocation added where none existed. The plan's acceptance criteria still require this slice to net-remove at least as many shell lines elsewhere as this new call and its export line add — see Done when; the saving has to come from somewhere else in the file (e.g. simplifying a now-redundant comment or an adjacent block), not from reusing a call that does not exist.

### Done when

The plan's acceptance criteria for this slice, quoted from `## Design` → `### Acceptance`:

> `pnpm --filter @plot-pm/domain exec vitest run test/main-checkout-write.test.ts test/spawn-contract.test.ts` and `pnpm --filter @plot-pm/board exec vitest run test/unit/main-checkout-gate.test.ts` pass with the cases below; on `origin/main` today the stale-spawner and split-text cases fail. `node --test test/reconcile/spawn-contract-gate.test.mjs` passes. A `ps eww` sample of a deliver run that the slice's board spawns shows `PLOT_SPAWN_CONTRACT=<SPAWN_CONTRACT>`; on `origin/main` it shows none. Agents see the new refusal only after the next release updates the installed plugin.

The specific test cases (plan's `### Tests`, "Slice 1" bullets):

- **Domain (`spawn-contract.test.ts`):** `spawnContractReading` answers `absent` for an unset variable, `empty` for `''`, `unreadable` for `'x'` and `'0'`, and `{ number: 3 }` for `'3'`.
- **Domain (`main-checkout-write.test.ts`):** `mainCheckoutWriteRefusal` with `absent` and with a smaller number names both numbers and the stop-and-report sentence; with a larger number names the older-gate direction; with an equal number, `empty` or `unreadable` adds no spawner paragraph. No text from either refusal function (`mainCheckoutWriteRefusal` or `strandingResetRefusal`) contains the strings `--stop`, `restart`, `kill` or `bootout`. `strandingResetRefusal` contains no marker sentence.
- **Env:** `agentRunEnv`, the command runner's built env, `backgroundGate()`'s printed lines, and the desk prompt env each carry `PLOT_SPAWN_CONTRACT` equal to `SPAWN_CONTRACT`, and a caller-supplied value for that key cannot override it (forced-last, same pattern as `backgroundGateEnv()`).
- **Gate (`main-checkout-gate.test.ts`):** through `mainCheckoutGateOf` with injected readings, every existing case in that file still gives the same allow/refuse outcome as before (you are splitting text, not changing decisions). A marked writer (`PLOT_MAIN_CHECKOUT_WRITER=1`) with a mixed reset gets `strandingResetRefusal`'s text. An unmarked unattended run with `PLOT_SPAWN_CONTRACT` unset gets `mainCheckoutWriteRefusal`'s text including the stale-spawner paragraph.
- **Contract gate (`spawn-contract-gate.test.mjs`):** passes on this slice's tree; fails against a fixture copy that adds a gate-read variable without bumping `SPAWN_CONTRACT`.

Plus the repo's standing gates:

- `./scripts/check-shell-lines.sh` passes. This slice adds one export line at `plot-dispatch.sh:827` (via the extended `plot-prompt.mjs --background-gate` call) — it must remove at least as many shell lines elsewhere in the same change to stay even (the gate ratchets against the merge base and grants no exemption).
- `./scripts/check-decision-count.sh pr` passes.
- The changeset for package `plot`, with the plan's first Changelog line as its description (see plan's `### Changesets`).

For local tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints — the tests and typecheck for the packages this slice touches (`@plot-pm/domain`, `@plot-pm/fleet`, `@plot-pm/board`), plus the gate tests and `scripts/check-*.sh`. Run it before each push. The suites in `CI suites` (the e2e/contract/board suites) run in CI on every PR — do not run `test:e2e` locally (see the project's Testing section: it dispatches real workers into sandbox repos and is CI's gate, not a local one).

**The shell gate applies to this slice specifically**, not just as a general reminder: `plot-dispatch.sh` is a `.sh` file this slice edits, so growth there is paid for in the same change.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the plan's wave heading as the title, the plan and this brief in the body. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch has any history.

**When the PR is created, append `→ #<number>`** to this branch's line in the plan's `## Slices` section (the "Spawn Contract" wave, `bug/a-spawn-carries-its-gate-contract` line) — commit that edit to `main` the way this brief itself was committed, so the plan file stays current for `/plot-deliver` and the board without waiting for a later back-fill pass.

### Scope guard

This branch owns:

- `packages/domain/src/rules/spawn-contract.ts` (new file)
- `packages/domain/src/rules/main-checkout-write.ts` (split refusal functions, corrected docstring)
- `packages/domain/src/rules/agent-run-env.ts` (add `spawnContractEnv()`, wire into `agentRunEnv`)
- `packages/domain/src/adapters/agent-run/agent-run-command.ts`
- `packages/fleet/src/server/entry/prompt.ts` (`backgroundGate()`, `--background-gate` behavior already exists; add the new export line)
- `packages/fleet/src/server/entry/worker-loop.ts` (desk prompt env)
- `packages/board/src/server/entry/gate.ts` (corrected docstring, `ask` returns the right function per arm; `--spawn-contract` flag added to whatever CLI entry backs `plot-gate.mjs`)
- `skills/plot/scripts/plot-dispatch.sh` (add the new `plot-prompt.mjs --background-gate` call and export — no relay exists today to extend)
- `test/reconcile/spawn-contract-gate.test.mjs` (new file)
- Corresponding test files: `packages/domain/test/main-checkout-write.test.ts`, a new `packages/domain/test/spawn-contract.test.ts`, `packages/board/test/unit/main-checkout-gate.test.ts`.
- A changeset for package `plot`.

**The second wave (`bug/the-board-and-fleetd-report-their-contract`) is not in flight yet** — it waits on this branch merging, per the plan's `## Slices` section (`<!-- waits: bug/a-spawn-carries-its-gate-contract -->`). No other branch is known to be in flight for this plan at dispatch time; re-check `/plot-pulse` before assuming that still holds if this brief is picked up well after it was written.

If you find something the plan did not anticipate — e.g. the command-runner env file has moved, or `plot-dispatch.sh` has no existing `plot-prompt.mjs --background-gate` relay to extend — report it rather than improvising a second parallel mechanism outside what's described here.

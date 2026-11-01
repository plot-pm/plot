## Implementation brief — fleetd-s-fixer-and-main-repair (wave 1: Fixer bounds)

- **Plan (canonical):** `docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md` on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3029 merged
- **Branch:** `bug/fleetd-s-fixer-runs-bounded` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pull-request review per repo convention (`plot/review`)

This slice goes first. Slices `bug/the-role-command-passes-agents-json` and `bug/a-failed-role-start-spends-no-attempt` wait on it, because slice 2 switches the fixers on. Merge nothing that turns them on before this lands.

### What to build

No fixer or main-repair agent has ever run: `roleCommand` hands `--agents` a file path, and the CLI fleetd runs (2.1.231) refuses it (19 of 19 fixer logs end `--agent 'fixer' not found`). Slice 2 fixes that. Before it does, the fixer must be bounded, because an unattended opus agent will then start for real. This slice adds four bounds and touches nothing about how the role command is built.

1. **Run time.** `launchFixer` (`packages/fleet/src/shared/auto-fixer.ts:495`) passes `boundSeconds: 0`, and `bounded-run-process.ts:211` arms no timer for 0, so a hung fixer holds its PR through `fixerInFlightArm` (`slice-pr-next.ts:198`) with no end. Add `FIXER_BOUND_SECONDS = 3600` in the domain beside `FIXER_ATTEMPTS_BUDGET` (`rules/fixer-attempts.ts:4`) and pass it. A run past the bound ends; the next tick clears the mark and logs `fixer-end` with the bound as the cause.
2. **Concurrency.** `runAutoFixerPass` runs behind `stopped()` only (`auto-writes.ts:78`); verify takes a slot from `machine.headroom` (`:89-90`), the fixer takes none. Make a fixer start take a headroom slot and allow at most one fixer in flight across all PRs. A second PR with a HIGH holds with the named reason `fixer-busy` and starts on a later pass. The decision is a domain rule; the controller only reads it.
3. **Role gate.** `roleDeniesCommand` (`rules/role-gate.ts`) must refuse, for the fixer and main-repair roles: a forced push (`--force`, `-f`, `--force-with-lease`, a `+` refspec), a push whose destination is not the role's own branch (the PR head branch for the fixer, the claimed `bug/main-repair-*` branch for main-repair), and a branch deletion (`--delete`, `-d`, a `:<branch>` refspec). Parse through `gitPushCalls`, which the rule already imports. Never match the raw command string.
4. **Plugins.** The role session gets `.plot/agent-settings.json` beside the role's settings, as desks do (`.plot/worker-prompt.sh:160`). A debug run on 2.1.231 loaded 34 hooks from 13 plugins, including oh-my-claudecode, whose `UserPromptSubmit` hook reads prompt text and the fixer prompt carries review findings verbatim. Measure which form loads both files on 2.1.231 and on 2.1.316 (a second `--settings`, or a role settings file that carries the agent settings' `enabledPlugins`) and record the answer in the PR; this closes the plan's one open question. If `.plot/agent-settings.json` is absent, the role starts with its own settings and the run log says so once.

Plus one sentence in the CLAUDE.md master-agent section: the master agent reads `inFlight` in `.plot/state/fixer-attempts/<pr>.json` before it starts a hand fix. Regenerate the mirror with `./scripts/check-agents-md.sh --write`.

### Decisions the plan settles — do not re-derive them

- **A live desk does not block the fixer.** `highArm` reads no desk state and stays that way. The race is safe because the fixer pushes `HEAD:<branch>` from a detached head: a branch that moved rejects the push as non-fast-forward, and the new gate refuses the force that would override it. Do not add a desk check.
- **Main-repair gets no new bound.** It claims `bug/main-repair-<12 hex>` by ref push, makes one attempt per episode and runs under `Main repair bound` 3600 s. `plot-ask.mjs merge` admits only the record's `repairPr` or `revertPr` on a red main. Change nothing in it; the gate in item 3 applies to it only as a role.
- **The bound is a domain constant, not a config key.** A `## Plot Config` key is a listed follow-up.
- **A Bash write to a protected path (`sed -i`, `cat >`) stays a known gap.** It is named in the plan's Notes. Do not widen the gate to chase it here.
- **Do not touch `roleCommand`, `FixerAttemptSchema` or the attempts budget.** Slices 2 and 3 own them. Adding a failed-start concept here collides with slice 3 in `auto-fixer.ts`.
- **Carried rules:** absent is not false (a missing `agent-settings.json` is a named, logged fallback, not an error); read the exit code, not output emptiness; a decision lives in the domain, not in a `.then` or `.tsx`.

### Done when

The plan's `## Done when` table, rows marked slice 1, is the specification:

| Claim | Test |
|---|---|
| A fixer run ends at its bound: the request carries `FIXER_BOUND_SECONDS`; a run past it ends and the next tick clears the mark | `auto-fixer.test.ts`, `bounded-run-process` test |
| One fixer at a time: the second PR holds with `fixer-busy`, starts after the first ends | `auto-fixer.test.ts` |
| A fixer takes a machine slot: no slot, no start, the reason is logged | `auto-writes` test |
| The role gate refuses `--force`, `-f`, `--force-with-lease`, `+HEAD:b` for both roles | `role-gate.test.ts` |
| The role gate refuses `git push origin HEAD:other` and a push from a checkout of another branch | `role-gate.test.ts` |
| The role gate refuses `git push --delete origin b` and `git push origin :b` | `role-gate.test.ts` |
| The role's own push passes: `HEAD:<pr head branch>` (fixer), `HEAD:bug/main-repair-<hex>` (main-repair) | `role-gate.test.ts` |
| Both settings reach the command; absent file gives one log line | `role-command.test.ts` or the callers' tests |

The assertions a naive implementation passes without: the **own-push-allowed** row catches a gate that refuses every push and so passes all three refusal rows; the **`fixer-busy` then starts-after** row catches a cap that blocks forever; the **no-slot** row catches a slot check wired to verify's headroom copy rather than the fixer pass. Mutation checks from the plan: set `boundSeconds: 0` again and the bound row must fail; drop the `+` check and the force row must fail. Run both, and commit before mutating.

Plus: a changeset for package `plot` (description first, `bumps:` block last, per CLAUDE.md Versioning). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. This slice touches no `.sh` file; if that changes, `scripts/check-shell-lines.sh` requires removing as many shell lines as you add. New and changed functions are arrows; TSDoc states behaviour, not history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/fleet/src/shared/auto-fixer.ts`, `packages/fleet/src/shared/auto-writes.ts`, `packages/domain/src/rules/role-gate.ts`, `packages/domain/src/rules/fixer-attempts.ts` (the constant only), the new fixer-concurrency rule, their tests, CLAUDE.md, the regenerated `AGENTS.md`, and a changeset.

In flight and not yours: `bug/the-role-command-passes-agents-json` owns `rules/role-command.ts` and its tests. `bug/a-failed-role-start-spends-no-attempt` owns the harness refusal data, `FixerAttemptSchema`, the budget functions, `auto-ticket.ts` and `repair-role.ts`. Both share `auto-fixer.ts` with you only through slice 3, which waits on this merge. If you find something the plan did not anticipate, report it rather than improvising outside scope.

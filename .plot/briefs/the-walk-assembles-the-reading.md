## Implementation brief — the-plan-walk-moves-into-the (wave: Assembly)

- **Plan (canonical):** [docs/plans/2026-10-31-the-plan-walk-moves-into-the.md](../../docs/plans/2026-10-31-the-plan-walk-moves-into-the.md) on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-walk-assembles-the-reading` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR review channel: `pr`)

This is the fourth of eight slices. It waits on `feature/the-walk-reads-the-desks` (#2989, merged). Three slices wait on it in turn: `feature/scan-once-walks-in-process`, then `feature/the-walk-caches-by-oid`, then the CLI-modes and pulse-log slices — none of them can start until this one lands and the comparisons it proves are green.

### What to build

The first three stages (`readEstate`, `readBranchReadings`, `readDeskReadings`, all under `packages/domain/src/workflows/`) each gather readings and decide nothing — that discipline is explicit in their own doc comments ("GATHERS AND DECIDES NOTHING"). This slice is the first one that *decides*: it composes the readings those three stages already produced into the actual rows and output shapes the shell scan emits today (`FleetReading`, `--list-eligible`, `--slice-names`, `--next`, `<slug>`), and it introduces the `PLOT_SCAN_WALK=shell|domain` switch that lets every caller mode run through either walk while both exist.

Concretely:

1. Add a fourth workflow stage (e.g. `packages/domain/src/workflows/plan-walk-assembly.ts`) that takes the branch stage's `BranchReading[]` and the desk stage's `DeskReading[]` and produces, per branch, the same verdict the shell's row loop produces today — by calling the **existing** rules, not reimplementing their arithmetic.
2. Add the `PLOT_SCAN_WALK` env switch at the point `plot-fleet-scan.sh` currently decides how to produce its output. `shell` keeps today's behaviour exactly; `domain` runs the new walk instead. No caller mode's flag parsing changes — the switch selects which walk answers, not which flags exist.
3. Record, as part of this slice (in the plan or the PR body — the Done-when's third assembly bullet asks for it), which readings each caller mode actually consumes. `--list-eligible` and `--next` need slice/wait verdicts but not full desk detail; `--json` needs everything; `<slug>` needs one plan's rows. This is what lets a later slice (the cache) know what it's safe to drop.

### The decisions the plan settles — do not re-derive them

**This stage adds no verdict arithmetic.** The seams juror's panel verdict was explicit and the plan's Design section absorbed it: the walk "composes the rules that exist today" — `sliceVerdicts` and `waitVerdict` (`packages/domain/src/rules/eligible.ts:157`, `:257`), the branch-state rule the shell already calls through `plot-branch-state.mjs`, the merge-subject rule (`rules/merge-subject.ts`, already consumed inside the branch stage), `agentState` (`rules/agent-state.ts:136`) and `deskState` (`rules/desk-lifecycle.ts:157`). Every one of those rules already exists and is already tested. Your job is wiring `BranchReading`/`DeskReading` into their input shapes (`SliceReadings`, `BranchReadings`, `AgentStateReadings`, `DeskReadings`) and assembling the result — not writing a fifth implementation of "is this branch merged".

**The oracle is the normalised CLI output, not a new corpus pair against the shell's internals.** Earlier stages (estate, branch readings) compare their *readings* byte-for-byte against what the shell feeds into `plot-merge-subject.mjs`/`plot-branch-state.mjs`, because at that layer there was nothing else to compare against. At the assembly layer there is: the shell's own `--json`, `--list-eligible`, `--slice-names`, `--next` and `<slug>` outputs, which this slice's Done-when requires equal (after the standard normalisation: `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'`, with `changed_ago_seconds` and `worker_activity` compared by tolerance per `packages/domain/corpus/README.md`). Do not build a second readings-equality corpus test for this stage; build the output-equality one the Done-when names.

**`PLOT_SCAN_WALK` is new — there is nothing to extend.** `grep -rn "PLOT_SCAN_WALK"` across the repo returns nothing before this slice. You are introducing the variable, its read site in `plot-fleet-scan.sh`, and the domain-side entry point it calls. Keep the shell's existing code paths completely intact under `shell` — this switch is additive, and the shell walk stays the production default until the Removal slice (`feature/the-scan-script-is-a-launcher`) deletes it. `scripts/check-shell-lines.sh --per-file` ratchets `plot-fleet-scan.sh` against its merge base: adding the `PLOT_SCAN_WALK` branch point costs a few lines, and if it pushes the file over its current ratchet you must remove an equal number of shell lines elsewhere in the same change — do not budget on this being free.

**`conflicts` has no port operation yet, by design — it is not this slice's gap to fill.** The branch stage's own doc comment says so explicitly (`plan-walk-branches.ts:120`): `"conflicts has no port operation yet and is not read here."` If the shell's row assembly reports a conflict column, read it from wherever the shell already computes it today (unmoved), or report it absent/unknown on the `domain` walk path and say so in the PR — do not invent a conflict-detection port operation as a side quest; that is out of scope for every slice in this plan.

**Scope stops at the row/output shapes. `scanOnce` staying out-of-process is deliberate here, not an oversight.** The seams juror flagged that a cache "in fleetd's memory" has no caller until `scanOnce` calls the walk in-process — and the plan's slice ordering already answers that: `feature/scan-once-walks-in-process` is the *next* slice, waiting on this one. This slice proves the walk produces correct output when invoked (e.g. from a CLI entry point or test harness); it does not wire fleetd's beat loop to call it. Resist pulling that forward — it has its own slice, its own budget-and-heartbeat tests, and doing it here would make this PR unreviewable the same way the panel flagged the original unsplit slice 1.

### Done when

The plan's own Done-when section (`## Done when` in the plan file) is the specification; the Assembly bullet is the one this slice must satisfy:

- `PLOT_SCAN_WALK=domain node --test test/reconcile/fleet*.test.mjs test/reconcile/scan*.test.mjs` passes.
- The normalised `--json`, `--list-eligible`, `--slice-names`, `--next` and `<slug>` outputs equal the shell's, on the pinned clone, comparisons run with `--offline`, no host token, no `PLOT_PR_LISTING` and no `PLOT_TERMINAL_CACHE`, normalised with `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'` (`changed_ago_seconds`/`worker_activity` by tolerance).
- The slice records which readings each caller mode consumes (name it in the PR body if there's no natural file home for it).

Lift these assertions specifically because a naive implementation would pass without them:
- A test that an `unknown`/failed reading from an earlier stage (desk stage returns `failed`, say) propagates as a snapshot failure through assembly rather than silently rendering as "no branch" or "merged" — the earlier stages' own doc comments warn exactly about this failure mode ("an empty answer would read as 'no desk' and free the branch").
- A test on a plan with a `waits:` edge to another plan's branch, since cross-plan verdicts are explicitly "derived every beat, through verdicts over all readings" per the plan's Inputs table — a row assembled plan-by-plan in isolation would miss this.
- A test for `--offline --next`, since the seams panel noted its contract is narrower than its name (`--offline --next` still asks the host today) — if the `domain` walk's `--next` stops asking the host under `--offline`, that is a behaviour change the Done-when's equality check must catch, not silently "improve".

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves to the tests and typechecks for the files you actually changed. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run, `node --test test/reconcile/*.test.mjs`) run in CI on the paths you touch; a failure there comes back as a correction. Do not run the full e2e suite locally — it dispatches real workers and is CI's gate, not a local one (see CLAUDE.md's Testing section).

Name the shell gate explicitly in your PR: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice touches `plot-fleet-scan.sh` to add the `PLOT_SCAN_WALK` read — if that growth doesn't net out against shell removed elsewhere in the same change, the gate blocks the PR with no override. The gate counts commands, not lines (joining with `;`/`&&`, or folding `fi`/`done` onto the prior line, is not a payment).

### Bookkeeping

Open the PR through the controller once there's a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — it takes the title from the last commit subject rather than the plan's wave heading, and has caused titles like `plot: build the board artifact` to leak onto slice PRs before. Push the first real commit as soon as it exists, and once the PR appears, append `→ #<number>` to this branch's line under `### Assembly` in the plan's `## Slices` section.

### Scope guard

This branch owns: a new `packages/domain/src/workflows/plan-walk-assembly.ts` (or equivalent name you choose — no file by this name exists yet, so there's no collision to avoid), its test file, the `PLOT_SCAN_WALK` read site inside `plot-fleet-scan.sh`, and whatever thin domain-side entry point the switch calls into.

Siblings in flight: `feature/the-walk-reads-the-estate` (#2987, merged), `feature/the-walk-reads-the-branches` (#2988, merged) and `feature/the-walk-reads-the-desks` (#2989, merged) are all on `main` already — you build on top of all three (`plan-walk-estate.ts`, `plan-walk-branches.ts`, `plan-walk-desks.ts`), you don't touch their files. No other branch of this plan is in flight concurrently with this one (each slice waits on the previous), so there is no live collision to check against at dispatch beyond confirming the three prerequisite branches are merged — which they are.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

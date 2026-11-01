## Implementation brief — the-scan-script-is-a-launcher (wave: Removal)

- **Plan (canonical):** [docs/plans/2026-10-31-the-plan-walk-moves-into-the.md](../../docs/plans/2026-10-31-the-plan-walk-moves-into-the.md) on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-scan-script-is-a-launcher` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required on `main`)

This is the last slice in the plan's wave order — every other wave (Estate, Branch readings, Desks, Assembly, In-process, Cache, CLI modes, Pulse log) has merged (PRs #2987, #2988, #2989, #2991, #2992, #2995, #3001, #3004). Nothing waits on this slice; it closes the plan.

### What to build

`skills/plot/scripts/plot-fleet-scan.sh` is 5,420 lines (2,181 by `scripts/check-shell-lines.sh --per-file`, which counts commands, not raw lines) and still carries its own shell implementation of the plan walk behind `PLOT_SCAN_WALK=shell`, alongside the domain walk it calls by default (`plot-scan-walk.mjs`, under `PLOT_SCAN_WALK=domain`). Every prior slice proved the domain walk byte-equal to the shell's own answer on `--json`, `--next`, `--list-eligible`, `--why-nothing`, `--slice-names` and `--log-pulse`. This slice deletes the shell arm, so the comparison that justified keeping both stops being the point — one implementation remains, and the shell file shrinks to a launcher that resolves its target and `exec`s it.

Three things, named in the plan's Approach step 5:

1. **Remove the shell walk.** Delete the 51 shell functions that compute readings, verdicts and rows — everything the domain walk (`plan-walk-estate.ts`, `plan-walk-readings.ts`, `plan-walk-desks.ts`, `plan-walk-assembly.ts`, reached through `board/plot-scan-walk.mjs`) now answers instead. What remains is argument parsing, the `PLOT_SCAN_WALK` dispatch line (`plot-fleet-scan.sh:424`), and whatever `--no-fetch`/fetch-and-prune step still has to run in the shell because the domain walk takes `read_ref`/`local_head`/fetch result as inputs rather than performing the fetch itself (confirm this against `plot-scan-walk.mjs`'s current argument list before assuming the fetch itself moves — the plan's Decisions table lists "the fetch result" as an every-beat input the walk CONSUMES, not one it produces).
2. **Retire the corpus pairs by name.** The plan's Notes list exactly which corpus files compare the domain against the shell's own answer and must retire in this slice: `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible`, `finished-estate`, `refs`, `scan-listing`, `tracked-branches`. Read each one before deleting it — `scan-listing` and `tracked-branches` are named in the plan as staying "while the shell listing code stays," so confirm each file's own docstring still describes a shell-vs-domain comparison (several, e.g. `branch-state-waits-open-pr` and `refs`, cite `plot-fleet-scan.sh` behavior as the oracle) rather than deleting by name match alone; a corpus file that has drifted to compare something else by the time this slice runs is a reason to stop and ask, not to delete anyway.
3. **`plot-fleetctl.sh` recognises the new scan process before the shell walk goes.** `plot-fleetctl.sh:321-337` already matches a running scan by `art_end(p, "/board/plot-scan-walk.mjs", 0)` OR the literal token `plot-fleet-scan.sh` — this recognition is already in place (shipped with an earlier slice), so this slice's obligation here is to confirm it still holds once the shell script's own argv shape changes (a launcher that `exec`s into `node .../plot-scan-walk.mjs` replaces the process image, so `ps` will show the node command line, not the shell one — verify `plot-fleetctl.sh`'s match still fires against whatever argv a launched process actually presents after the rewrite, not just against the pre-existing dual-path code).

### The decisions the plan settles — do not re-derive them

**The target line count is a gate, not a goal to approximate.** The plan's Done when: `scripts/check-shell-lines.sh --per-file reports at most 25 lines for plot-fleet-scan.sh`. Today it reports 2,181. A rewrite that leaves meaningful shell logic behind — e.g. keeping the fetch-and-prune step, or any per-mode branching beyond picking which entry to invoke — will not clear this bar. If the fetch truly cannot move into the launcher's one-line `exec`, that is new information the plan did not anticipate (its Decisions table lists the fetch result only as a WALK INPUT) and is worth raising rather than silently absorbing into a long-surviving shell block.

**The shell file is a launcher, not a deletion.** Dozens of callers still invoke `plot-fleet-scan.sh` directly by name — skills, other shell scripts, and the bulk of `test/reconcile/` (confirmed: `fleet.test.mjs`, `fleetctl.test.mjs`, `dispatch.test.mjs`, `workerloop.test.mjs`, and ~40 more). None of these move in this slice. The CLI contract (`--json`, `--next`, `--list-eligible`, `--why-nothing`, `--slice-names`, `--log-pulse`, `--offline`, `--no-fetch`, `--loose`, `--stream`, `<slug>`) must keep behaving exactly as before — this slice only removes which code path answers it.

**`plot-worker-state.sh` is NOT touched by this slice.** The plan's Decisions explicitly keeps the "sourced shell": `plot-worker-state.sh`, `plot-plan-meta.sh` and their own corpus pairs (`agent-state`, `desk-waits-free`, `tree-reading`, `plan-store`) "stay, because other scripts still call them." Those four corpus names are a disjoint set from the eight this slice retires — do not conflate the two lists.

**`--log-pulse`'s bridge write already moved (prior slice, PR #3004).** This slice does not touch the pulse log's write path; it only removes the shell CODE that `--log-pulse` would have fallen back to under `PLOT_SCAN_WALK=shell`.

**Also carried over unchanged, confirm rather than rediscover:** the `PLOT_TERMINAL_CACHE` licence (a merged PR cannot revert on the host, so a terminal row is taken without re-asking) lives in the assembly/CLI-mode code that stays, not in anything retired here. `--offline --next` keeps asking the host even offline (naming a branch to claim needs a fact refs cannot supply) — this is domain-walk behavior already shipped, unaffected by this slice.

### Done when

The plan's `## Done when` → "Removal" bullets are the specification:

- `scripts/check-shell-lines.sh --per-file` reports at most 25 lines for `plot-fleet-scan.sh`.
- Each retired corpus pair is named in the commit (the eight listed above — name them explicitly in the commit message, not just "retire corpus pairs").
- The remaining corpus tier passes in CI.

Lift these assertions because a naive removal would pass without them:
- **A naive removal could pass `check-shell-lines.sh` while leaving dead code** if it only edits comments/blank lines around the functions without deleting them — the gate counts commands, so an unreachable function still counts. Verify the function bodies are gone, not merely unreferenced.
- **A naive corpus retirement could delete the test file but leave its fixtures/helpers behind**, or leave a `corpus/production.ts` entry pointing at a deleted comparison. Check `packages/domain/corpus/production.ts` and `packages/domain/corpus/README.md` (which the plan's Done when references for the `changed_ago_seconds`/`worker_activity` tolerance) for stale references after deletion.
- **A naive `plot-fleetctl.sh` check could pass in the unchanged dual-path state and silently stop matching once the shell no longer shows its own argv.** Test the launcher's actual running process, not the pre-existing recognition code.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps this slice's changed shell under `skills/` and the touched corpus/domain paths to their suites automatically. Do not run the full `test:e2e` locally (CI's gate, not a local one — this slice is exactly the kind of lifecycle-adjacent change where the temptation to "just check e2e" is highest; resist it, per `CLAUDE.md`'s Testing section).

**Name the shell gate explicitly, because this slice is the one place it should show the biggest NEGATIVE number on this estate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base — here the change should shrink the shell by roughly 2,150+ counted commands (2,181 → ≤25), the opposite direction of the usual warning about paying for growth elsewhere. There's nothing to "pay for" in this slice; it's the one case where the ratchet moves favorably.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create` — it takes the title from the branch's plan-wave heading, "Removal", not the last commit subject). Push the first real commit as soon as it exists. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` → "Removal" section — this is the plan's last unmerged slice, so that annotation is also effectively the plan's last open bookkeeping item before `/plot-deliver` can run.

### Scope guard

This branch owns: `skills/plot/scripts/plot-fleet-scan.sh` (deleting the shell-walk functions and the `PLOT_SCAN_WALK=shell` arm), the eight named corpus test files under `packages/domain/corpus/` (`branch-state*.corpus.test.ts` [3 files], `eligible.corpus.test.ts`, `finished-estate.corpus.test.ts`, `refs.corpus.test.ts`, `scan-listing.corpus.test.ts`, `tracked-branches.corpus.test.ts`) and any now-dangling references to them in `packages/domain/corpus/production.ts`, and — only if the `plot-fleetctl.sh` recognition check in step 3 above finds it no longer matches — the matching line(s) in `skills/plot/scripts/plot-fleetctl.sh:321-337`.

No other branch is in flight for this plan: every other wave's slice has merged, and nothing in the plan's `## Slices` section names a sibling waiting on or alongside this one. The only overlap risk is with work outside this plan that also touches `plot-fleet-scan.sh` or the eight corpus files — check `git log --oneline -- skills/plot/scripts/plot-fleet-scan.sh packages/domain/corpus/` since this plan's approval date (2026-10-31) for any such touch before starting, since a file this large and this widely read is a plausible point of accidental collision even with no plan declaring one.

If you find something the plan did not anticipate — particularly if the fetch-and-prune step cannot cleanly move out of the shell, or if `check-shell-lines.sh --per-file` cannot reach 25 lines without losing CLI-contract behavior some caller still depends on — report it rather than improvising outside scope.

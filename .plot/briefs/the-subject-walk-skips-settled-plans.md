## Implementation brief — the-subject-walk-skips-settled-plans (wave: Settled plans)

- **Plan (canonical):** [docs/plans/2026-10-31-the-fleet-scan-re-reads-what.md](../../docs/plans/2026-10-31-the-fleet-scan-re-reads-what.md) on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2979 merged
- **Branch:** `feature/the-subject-walk-skips-settled-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review required on `main`)

This is the plan's third and last slice. Slice 1 (`feature/the-scan-walk-starts-no-process-per-plan`, merged via PR #2982) already removed the per-plan process starts at the three sites this plan's Motivation measured; this slice is independent of that removal and touches a different part of the same loop. Slice 2 (`feature/a-fleetd-whose-scans-start-owns-the-scan`) is unrelated code (fleetd's scan-attempt record) and this slice does not wait on it.

### What to build

`plot-fleet-scan.sh`'s merge-subject loop (`:3706-3733`, building `SUBJECT_PLAN_SECTIONS`) iterates `"${!plans[@]}"` — **every** plan in the estate, settled ones included — asking which of each plan's refless branches a commit subject proves merged. The plan's Motivation measured this loop at 15.6 s CPU (2,476 + 1,238 calls) on an estate of ~1,238 plans. Filter that iteration to the plans whose subject answers some reader actually consumes, per the plan's Open Question.

### The answer to the Open Question — do not re-derive it

**Every caller of the loop's output is already scoped to non-terminal plans, so the filter is exactly `is_terminal_phase`, nothing narrower and nothing broader.**

- The loop's two outputs, `SUBJECT_PROVEN` and `SUBJECT_IGNORED` (set at `:3764-3767`), are read by exactly three call sites: `merged_by_subject`/`subject_predates_plan` at `:3956`, `:4544`, and `:4754`. All three live inside the per-plan row loop that starts after `:4290`.
- That row loop's very first lines (`:4290-4294`) are:
  ```bash
  if is_terminal_phase "$plan_phase" && [ "$plan_phase" != "delivered" ]; then
    continue
  fi
  ```
  (plus the docs/infra-at-delivered carve-out right after). So by the time `plan_base` is ever assigned and any of the three call sites can run, the plan has already passed this exact filter. **The merge-subject loop is proving pairs for plans whose own row loop will never ask about them.**
- `waits:` edges do not bypass this: a `waits:` name is resolved against `SLICE_NAMES` (built at `:3530` from `plan_phases`, itself non-terminal-only — see the comment at `:3534`), and a `waits:` target's merge status is read through the *target plan's own* row-loop iteration, which carries the same `is_terminal_phase` gate. There is no second path into `merged_by_subject`/`subject_predates_plan` that could need a terminal plan's proof.
- **So the filter is not "prove which readers need it and build a bespoke set" — the readers were always only three, all gated by one existing predicate, and that predicate is already computed for you.**

### The decision this settles — do not re-derive it

**The split already exists; it is thrown away at the join.** `add_plan_by_phase` (`:3489-3503`) already partitions every candidate into `plans[]` (non-terminal) or `terminal_plans[]` (`is_terminal_phase` true) as it parses the estate once. Lines `3524-3528` then **re-merge** `terminal_plans` back onto the end of `plans[]`:
```bash
for i in "${!terminal_plans[@]}"; do
  plans+=("${terminal_plans[$i]}")
  ...
done
```
This re-merge exists because the row loop (and other readers) need one combined, order-preserving array to walk for output purposes (a finished plan still needs to appear in `--json`, etc. — see the comment block above `:3480` on why terminal plans are appended rather than dropped). The merge-subject loop runs *after* this re-merge and has no way to tell, from `plans[]` alone, which entries were terminal.

**Fix: do not rebuild a terminal/non-terminal test for the merge-subject loop. Carry the split forward.** The cheapest shape: keep a count or index boundary from the partition (`${#plans[@]}` immediately after the first loop, before the terminal append — call it `n_live_plans` or similar) and have the merge-subject loop iterate only `"${!plans[@]:0:$n_live_plans}"` (or equivalent), since the re-merge appends terminal entries strictly after the live ones and preserves order (per the comment at `:3474-3476`, "ORDER IS PRESERVED: active plans first... with the terminal ones appended"). This needs no second pass over `plan_phases` and no second call to `is_terminal_phase` per plan — the ordering invariant the code already documents is suficient, and it is the reason this is a one-line boundary change rather than a filter predicate inside the loop.

Do not instead add an `is_terminal_phase "$plan_phase"` check inside the merge-subject loop body: `plan_phases[]` is indexed in parallel with `plans[]` after the re-merge and reading it there works too, but it re-asks a question the partition already answered and costs one more array lookup per plan for no benefit over slicing the range. Either is correct; the range slice is simpler and is what "skip settled plans" means once the ordering invariant is visible.

### Rules carried over unchanged

- **`plot-ancestry` comments stay as declared.** The ancestry calls inside this loop (`:3747-3756`, `git merge-base --is-ancestor` plus two `git cat-file -e`) are declared `evidence` — handed to `proofOf` in `plot-merge-subject.mjs`, which decides, and `unknown` proves nothing. This slice does not touch those calls or their declaration; it only changes which plans reach the loop that contains them. `scripts/check-ancestry-decisions.sh` must still pass with the declaration untouched.
- **Absent is not false.** `subject_predates_plan` and `merged_by_subject` both read presence in a newline-framed string as the only signal (`:2400-2408`, `:2413-2421`) — a plan this slice now excludes from the walk simply never gets an entry in `SUBJECT_PROVEN`/`SUBJECT_IGNORED`, which is indistinguishable from "no subject found" and is the correct reading, since no caller will ask about that plan anyway.
- **Output must stay byte-identical for every non-terminal plan.** This is slice 1's own `Done when` bar, reused here: `plot-fleet-scan.sh --offline --json` before/after, normalised with `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'`, must match exactly for every plan that is not settled. Terminal plans may legitimately show a different (likely absent) subject-proof footer than before, since they were never supposed to need one — confirm no non-terminal plan's row changes.

### Done when

The plan's own `## Done when` (Slice 3 section) is the specification:

- Record, in the plan file, which readers consume settled plans' subject answers, naming file and line — the answer above (`merged_by_subject`/`subject_predates_plan`, at `:3956`, `:4544`, `:4754`, both gated by the row loop's `is_terminal_phase` check at `:4290-4294`) is what to write there, in the plan's `### Open Questions` section (check the box) or a new `### Decisions` bullet — follow the plan's existing style (see "The oid cache... moves to a second plan" bullet for the shape of a settled-decision entry).
- Slice 1's normalised `--json` comparison and the `SUBJECT_PLAN_SECTIONS`/`_sp_pairs`/`_sp_answers` debug-dump comparison (see slice 1's `Done when`) must hold for every plan that is **not** settled, before vs. after this change.
- `node --test test/reconcile/eligible.test.mjs test/reconcile/branch-state.test.mjs test/reconcile/branch-state-waits.test.mjs` (the three corpus-adjacent suites the plan names as "`eligible`, `branch-state` and `branch-state-waits` corpus files") pass unchanged in CI.
- CPU of `--offline --json` on the pinned clone drops further from slice 1's baseline, measured the same way slice 1 measured it (`/usr/bin/time -p`, user + sys, with load average reported alongside) — state the new number in the plan.

Plus the repo's standing gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (do not run the full suite list by hand). `scripts/check-shell-lines.sh pr` must pass — this slice should **shrink** `plot-fleet-scan.sh` (fewer plans walked, and likely a smaller loop body) rather than grow it, so the shell-line ratchet should not bind here, but confirm after the edit since slice 1 already spent its own savings.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller once ready:
```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```
Never `gh pr create` directly. When the PR exists, append `→ #<number>` to this branch's line under `### Settled plans` in the plan's `## Slices` section.

### Scope guard

This branch owns the merge-subject loop's plan-iteration boundary in `skills/plot/scripts/plot-fleet-scan.sh` (roughly `:3706-3733`, plus the `n_live_plans`-style boundary this slice adds near `:3524-3528`) and the plan file's own Open-Questions/Decisions update. It does not touch:
- The per-plan process-start removal slice 1 already landed (different lines, same file, already merged).
- fleetd's scan-attempt record or `fleetOwnsScan` (slice 2, unrelated subsystem).
- The ancestry calls themselves, their `plot-ancestry` declaration, or `plot-merge-subject.mjs`'s `proofOf` logic — only which plans reach them.

If something about the three-call-site mapping above turns out to be wrong once you're reading current code on this branch (e.g. a fourth caller exists that this brief missed), report it rather than widening the filter to be safe — a wider filter defeats the slice's purpose and a narrower one needs its own justification, not a guess.

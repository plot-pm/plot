## Implementation brief — a-scan-says-where-its-time-goes (wave 3: The plan index is read once)

- **Plan (canonical):** `docs/plans/2026-10-01-a-scan-says-where-its-time-goes.md` on `main`
- **Issue:** #1017
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-plan-index-is-read-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

This slice waited on `bug/the-scan-drops-its-largest-cost`, which has delivered (#1196, merged 2026-10-02). Nothing waits on this slice. Read the plan's `## Notes` first: slice 1's trace names the cost this slice removes.

### What to build

`plan_meta_index_of` (`skills/plot/scripts/plot-fleet-scan.sh:3144`; the plan and the Notes call it `:2937-2938`, the line moved) finds a parsed plan's position in `plan_meta_files` with a bash `for` loop and a string compare. In slice 1's `PS4` trace it was the largest shell line: **294.4 s over about 345,000 trace gaps**, against 3545.6 s of traced span.

**The cost is quadratic in the estate and not in the live plans.** The scan reads 26 live plans, but `add_plan_by_phase` (`plot-fleet-scan.sh:3265`) calls `plan_phase_of`, and so `plan_meta_index_of`, once for **every candidate file** under `docs/plans/`, live or finished. `docs/plans/` holds 416 files today. Each call runs inside `$(…)`, so each also forks a subshell. About 416 files × an average scan of about 208 entries × about four trace gaps per iteration is the order of 345,000. A fix that only speeds one lookup, and keeps N lookups that each walk N entries, keeps the quadratic shape.

Replace the walk with an index **built once, in the parent shell, inside `parse_plan_estate`** (`:3058`) as it appends each `P` row. A lookup then costs one match against the index and not one walk. The other two callers read the same function: the subject loop at `:3544` and the row loop at `:4095`. Both are per live plan, so they are not the weight, but they must keep returning the same index.

The plan is canonical. This is orientation.

### Decisions the plan settles — do not re-derive them

**Shell overhead with no decision in it is fixed in place.** The plan's slice-2 rule applies to this slice too: no rule moves into `packages/domain`, no bundle, no new `plot-*.sh` script. Which index a file holds is not a decision. `docs/shell-and-domain.md` §1 allows duplication only for a rule, and a position lookup is not one.

**No associative arrays.** `/bin/bash` on macOS is 3.2 and `plot-fleet-scan.sh:3041` says so in its own header: *"a `declare -A` here would silently narrow where Plot runs."* So `declare -A`, `${!map[@]}` over a keyed map and `mapfile`/`readarray` are out. The idiom the script already uses is a newline-delimited string of `key<TAB>value` records tested with a `case *$'\n'"$key"$'\t'*` or a parameter expansion (`:1804`, `:2027`, `:3536`). Pick one; name which and why on the PR.

**Build it in the parent shell.** All three callers invoke the lookup as `$(plan_meta_index_of …)`, which runs in a subshell. An index that the lookup builds lazily on its first call is built in a child and lost: every call would rebuild it, and the fix would cost more than the walk. Build it where `plan_meta_files+=("$file")` runs (`:3118`), in the parent. `parse_plan_estate` runs at `:3208` and `:3358` in the parent shell, not in a pipeline.

**Quote the key inside the pattern.** A plan path may contain `[`, `*` or `?`. An unquoted key inside `case` or `${s#*…}` is a glob and matches the wrong entry. `"$1"` must be quoted so it matches literally, as the compare did.

**The first match wins, as it does now.** The loop returns the lowest index that equals the file. If a path appears twice in `plan_meta_files`, a lookup must still return the first. A later `P` row for a path already in the index must not replace it.

**The key is the stored string.** The `P` row's file passes through `clean()` (`:3067`), which turns tabs and newlines into spaces, and `plan_meta_files` holds that cleaned string. The lookup compares the caller's raw string against it. Keep exactly that: a path the clean changes was never findable, and it must stay unfindable rather than become findable by an accident of the new index.

**A second `parse_plan_estate` call must extend the index, not restart it.** `:3302` records that a second call "would build a second `plan_meta_files` index and the lookup would find nothing". Appending to one index keeps the arrays and the index in step.

**Rules carried over from this scan's history.** Absent is not false: a file that was not parsed yields `""`, the answer every caller already reads as "not a plan" (`:3547`, `:4096`). Do not return `0` for a miss; `0` is the first plan's index. Read the exit code, not the emptiness: `plan_phase_of` and `:3544` treat an empty string as the miss, so the function keeps returning 0 and printing nothing on a miss.

**Not this slice's:** the two `node` bundle calls at `:3532` and `:3925`, `json_str`'s `sed` at `:3566`, `ref_plan_file`'s double `basename` and `ref_mode_of`'s `awk`. Slice 1 reported them and the plan does not name them. If one is large once this lands, report it on #1017 for a person to decide. Do not fix it here.

### Done when

The plan's slice-3 item is the specification: **the median board-shaped wall time falls by at least the share the trace attributes to `plan_meta_index_of`, measured the same way at a comparable load, and the scan's `--json` output is unchanged for the same estate.** That share is **8.3%** of the traced span (294.4 / 3545.6) in slice 1, and it was measured before slice 2 removed the `pr-state` calls, so the denominator is now smaller and this cost's share is larger. Re-baseline before you cite 8.3%.

Assertions a naive measurement passes without:

- **Wall time cannot show 8% here, so measure CPU too.** Slice 1 ran the same scan at load 15 to 91 and wall time went from 398 s to 3547 s, while CPU stayed at 110.6 to 118.9 s. A before/after pair at different loads proves nothing in either direction. Run before and after back to back on the same `origin/main` base, record `uptime` before and after each run, and report **user+sys for each run beside wall**. The shell cost is CPU, so the CPU pair is the instrument that holds at load.
- **Take a lookup-count measurement that does not depend on load.** Count calls to `plan_meta_index_of` before and after (a counter in a throwaway worktree, not committed), or time the `add_plan_by_phase` loop alone. The count proves the quadratic shape went away; a wall number alone does not.
- **Also report the `--offline` shape.** It takes about 9.7 s with no host, so the shell share is largest there and the CPU change is easiest to read. It is not the Done-when's shape and does not replace the board-shaped measurement.
- **A `--json` diff on the same estate.** Run `plot-fleet-scan.sh --json` before and after, from the same `origin/main` commit and the same cache state, and diff. Any difference in a plan, a slice's `verdict` or its `pr` field is a defect. Note the base commit moves under a busy fleet: pin both runs to one `git worktree` at one SHA.
- **A test that the lookup returns the first of two equal paths, a literal match for a path holding `[`, `*` and `?`, and `""` for a path never parsed.** Source the function from a fixture, or drive the scan on a repo whose plan paths hold those characters. These are the three ways an index differs from a loop and each fails silently.
- **A test that the count of `plan_meta_index_of` work is not quadratic.** `test/reconcile/fleetbatch.test.mjs` already gates the plan-parse spawn count at two estate sizes and compares them, because *"an absolute number would encode today's estate rather than the property."* Do the same here: run the scan on a small and a large estate and assert the cost does not grow with the product of the two. The subject is a count, never a duration.

Plus the repo gates. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI and a failure there comes back as a correction. Do not run `test:e2e` locally. A changeset is required, since `skills/plot/scripts/` ships. `.changeset/` may be empty in a fresh worktree, so copy the format from a recent changeset in `git log` (for example `the-queue-holds-an-unnamed-slice.md`): `'plot': patch` in the frontmatter, the description first, a `<!-- plan: … bumps: skills: plot: patch -->` block last. Run `./scripts/check-changeset-packages.sh`.

If the measured gain cannot reach the Done-when's share once it is re-baselined, stop and write `PLOT-BLOCKED` with the numbers. Do not defer the slice yourself: a person writes `deferred:`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `PR: #<number>` to this slice's heading in the plan's `## Slices`: `(Branch: bug/the-plan-index-is-read-once, PR: #<number>)`.
- Post the before/after table on #1017, with the base commit, the load before and after each run, wall, user+sys and the lookup count. **Do not close #1017.** A person closes it after reading the numbers.
- The scan reads and never writes the host. Do not change the board's PR store or the scan's cache directories between the before and after runs.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh` (the plan-index functions and their callers only), its tests under `test/reconcile/`, the changeset, and the plan's `## Slices` line and `## Notes`. Anything else is out of scope. Do not edit `packages/board/src/server/fleet.ts`: the board's budget and its `--stream` call stay as they are.

Other branches in flight, verified at dispatch against `origin/main` `49dbeec4b` with `git diff --name-only origin/main...origin/<branch>`: `bug/a-moved-worker-leaves-no-pid-behind` (`plot-monitor-subject.sh`, `plot-worker-loop.sh`), `bug/a-worker-runs-at-one-desk` (`registry.ts`, `desk-worker.ts`, the board bundles) and `bug/the-full-read-asks-verdicts-of-open-prs-only` (`fleet.ts`, `pr-index.ts`, the board bundles). **None touches `plot-fleet-scan.sh`.** The scan is still a hot file: `9223b8c1e` and `e58ccecb7` landed on it today. Run `git log origin/main -5 -- skills/plot/scripts/plot-fleet-scan.sh` before you start, and rebase onto `origin/main` before you take the "after" measurement, so both runs use one script.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

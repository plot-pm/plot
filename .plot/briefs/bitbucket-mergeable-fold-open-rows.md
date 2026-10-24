## Implementation brief — bitbucket-pr-rows-run-per-row (wave 1: Mergeable fold)

- **Plan (canonical):** `docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2514 merged
- **Branch:** `bug/bitbucket-mergeable-fold-open-rows` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + plot-review)

This is wave 1 of 4. `bug/bitbucket-checks-lookups-bounded` waits on it, and the two waves after that wait in turn. It waits on nothing.

### What to build

`bb_fold_mergeable` (`skills/plot/scripts/plot-host.sh:1922`) is the per-row fold behind `pr-list --rich` and `pr-state` on Bitbucket. Issue #2481 (finding from plot-review on #2208 and #2359) measures the defect: the fold does work for every row it sees, and one of its calls has no time bound.

- **Rows.** The `state = OPEN` guard at `:1925` already keeps `git fetch` and `merge-tree` off MERGED and CLOSED rows. The `jq` read at `:1924`, the `git --version` at `:1931` and the `node` bundle still run for every row. Skip all of it for a non-OPEN row and print the row unchanged. Check what `plot-bitbucket-mergeable.mjs` returns for a non-OPEN row first, so the skipped row is byte-identical to the folded one.
- **`--repo`.** `pr-state` parses `--repo` into `repo_args` (`:3734`) and passes it to `bb`, but the fold runs `git` in the current directory against the local clone's `origin`. A PR in another repository is folded against the wrong base. Pass the repo through, or answer `unknown` with a reason when the clone is not that repo. Do not guess.
- **Fetch bound.** `git fetch -q origin "+refs/heads/$base:..."` at `:1926` has no time bound and stalls on SSH. Wrap it in a time bound. `Checks wait` (3600 s) is far too long for one fetch. The bound is a constant or a config key; the plan leaves that open, so take the constant unless a config key is already read nearby, and name the choice in the PR. A timed-out fetch reads as a failed fetch, so the row answers `unknown`.
- **Exit status.** `pr-state` calls `bb_fold_mergeable "$(bb_state_row "$out")"` (`:3825`, `:3884`). A failure of `bb_state_row` inside the command substitution is lost. Keep its exit status through the fold.

### Decisions the plan settles — do not re-derive them

- **Fetch once per base, keep it.** `BB_FETCHED` caches the fetch per distinct base per invocation. The base is fetched alone, never with the head: a fetch that names the head fails whole on Bitbucket's short hash and leaves a stale `origin/<base>` that answers wrongly with confidence (#2208). Do not merge the two fetches.
- **A failed fetch reads `unknown`.** Absent is not false. A timeout joins this arm and never reads `mergeable: false`.
- **Row output stays one line of JSON.** `pr-list --rich` pipes through `bb_fold_mergeable_stream`, which reads one row per line and strips `base` with `del(.base)`.
- **Slice 2 owns Jenkins.** Do not touch `bb_state_row`'s Jenkins lookups, the bind budget or `pr-merge`'s head re-read. The plan keeps `head-moved` for a real head change and stops reporting it for a parse failure; that belongs to the next wave. Your exit-status fix may help it and must not change what the merge path reads.

### Done when

The plan's slice line is the specification: `bb_fold_mergeable` runs for OPEN rows only, honours `--repo`, bounds each `git fetch`, and `pr-state` keeps the exit status of `bb_state_row`. Assertions a naive implementation passes without:

- A test with a stub `git` that records its calls: a MERGED row makes **zero** `git` and `node` calls. A status-only comparison cannot catch a leftover `merge-tree` call (this is the LOW finding at `test/reconcile/bitbucket-mergeable.test.mjs:340`, carried by the last wave; the real count there is yours to write only if cheap).
- A stub `git fetch` that sleeps past the bound: the row answers `unknown` within the bound. A test that stubs a fast failure does not prove the bound.
- `pr-state` with a failing `bb_state_row`: the exit status is non-zero. A test that only checks output passes with the status lost.
- `--repo other/repo` does not run `merge-tree` against the local origin.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-host.sh`, so pay for added lines in the same change: remove shell elsewhere, or move the rule into the domain and ask it through the bundle. The gate has no override. Add a changeset: description first, `bumps:` block last, package `plot`, and a `plot-host`-owning skill bump that names a real directory under `skills/`. Do not commit a rebuilt board bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Mergeable fold` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

You own `skills/plot/scripts/plot-host.sh` (the `bb_fold_mergeable` family and the `pr-state` call sites), `skills/plot/scripts/board/plot-bitbucket-mergeable.mjs` if the non-OPEN row needs it, and `test/reconcile/bitbucket-mergeable.test.mjs`. Branches in flight on the same plan, none started: `bug/bitbucket-checks-lookups-bounded` (Jenkins lookups and bind budget, `plot-host.sh:1953`, `:4604`), `bug/pr-refresh-rotation-keeps-green` (`packages/fleet`), `bug/bitbucket-bind-coverage-and-docs` (tests and the 14 LOW findings) and `docs/one-pr-reader-plan-figures` (another plan file). Leave their lines alone. If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — one-word-answers-two-questions-about-a-wave (wave 1: A wave says which question it answered)

- **Plan (canonical):** `docs/plans/2026-09-25-one-word-answers-two-questions-about-a-wave.md` on `main`
- **Approved:** 2026-09-25, Jan Wloka, in-session after panel
- **Branch:** `bug/a-wave-says-which-question-it-answered` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #994

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-fleet-scan.sh` prints a wave as `eligible` in its body and, in the same run, `eligible=0` in its footer, while `--list-eligible` and `--next` offer nothing. Reported from a Bitbucket estate at 2.20.0 (#994): one wave eligible, eleven branches, and both offer paths silent. The body word answers *are this wave's prerequisites met?* (`sliceVerdict`, `packages/domain/src/rules/eligible.ts:93-108`). The footer counter answers *can a branch here be claimed now?* (`isClaimable`, `eligible.ts:~170`). Both computations are correct. The fix is naming, not logic.

Three changes, all in the scan's output:

1. **Footer key.** The `summary:` line (`plot-fleet-scan.sh:4578`, and the empty-estate line at `:3189`) gains `claimable=<n>` from `n_eligible`. `eligible=` stays beside it with the same value, because three tests and `skills/plot-pulse/SKILL.md:163` read it. Update the header doc at `:91-96`: say that `claimable` counts BRANCHES, beside `waiting` and `prereq_missing`.
2. **Body line.** The wave line is printed at `:3930` (`echo "  ${wname:-(unnamed)} — $verdict"`). The claimable count is known only after the branch loop that follows it (`:3986-3990`). When the verdict is `eligible` and the wave has non-deferred branches but no claimable one, the line must say so with a prose suffix in `StartabilityVerdictSchema`'s words, for example `eligible — someone-is-on-it`. Either delay the wave line until after the branch loop, or buffer the branch lines. Claimed and in-progress (`wip`) branches count as taken. `unknown` (host unreadable) does NOT count as taken: that wave keeps bare `eligible`, or names the unknown, but never claims someone is on it.
3. **`--list-eligible` on stderr.** At `:4271-4276`, when `claimable` is empty and the scan found candidate branches in eligible waves that a claim filtered out, print one sentence on **stderr** (for example `nothing claimable: N branch(es) in eligible waves are taken`). An empty estate prints a different sentence, or nothing. Stdout stays a bare branch list, and the exit code stays 1.

### Decisions the plan settles — do not re-derive them

- **`--next` is untouched.** Its exit-1 contract is shipped, documented at `:27-30`, implemented at `:4271` and `:3168`, and tested at `fleet.test.mjs:333` and `:367`. An earlier draft proposed it as new work, and the panel removed it because a worker would rewrite a passing gate. The reported "silent at exit 0" does not reproduce from the code: `[ ${#claimable[@]} -gt 0 ] || exit 1`. Do not "fix" it.
- **No new `SliceVerdict`, no schema change.** `FleetWaveSchema.verdict` is a strict enum, so a parsed pulse cannot carry a new value, and the board rejects it. The suffix is prose in the human body only. `--json`, `--stream` and the `verdict` field stay byte-identical, and `json_waves` at `:4192` keeps bare `$verdict`.
- **The JSON `summary` object is not the footer.** `reading_doc` at `:4430-4438` carries `"eligible":%d` into the board's `FleetReading`. The plan's rename applies to the text footer. Do not remove the JSON `eligible` key. Add `claimable` there only if the board schema accepts an extra key: check `FleetReadingSchema.shape.summary` first, and leave it out if unsure.
- **Stderr, not stdout, for `--list-eligible`.** The dispatcher pipes its stdout into `sort -u` (the dispatcher's `--list-eligible` calls; the plan cites `:3471` and `:3519`, not re-verified at dispatch). A sentence on stdout becomes a dispatch target.
- **Use the estate's word.** `StartabilityVerdictSchema` (`packages/board/src/contract/schema.ts:1509`, not `:1489` as the plan says) already names `someone-is-on-it`. Its doc block (`:1476-1506`) records the same ambiguity measured on the board: *"26 rows said `eligible` and 5 could be started."* Do not coin a new word.
- **Carried invariants:** absent is not false. An unreadable host (`unknown`) is not "taken" and not "free". Read the exit code, not the emptiness.

### Done when

The plan's `## Done when` list is the specification. The assertions that catch a naive implementation:

- **A claimed-out wave:** one eligible wave, its only branch claimed. The body line carries the suffix, the footer reads `claimable=0`, `--list-eligible` exits 1 with the stderr sentence and an empty stdout. Without the stdout assertion, an implementation that echoes the sentence to stdout passes.
- **An empty estate:** `--list-eligible` exits 1 and does NOT print the claimed-out sentence. This separates the two cases the plan names.
- **One free branch:** the body line is bare `eligible` (no suffix), `claimable=1`, and `--list-eligible` prints exactly that branch name. This catches a suffix that fires on every eligible wave.
- **`--json` unchanged:** the wave `verdict` for the claimed-out wave is still `eligible`. This catches a suffix that leaks into the machine output.
- Existing footer tests (`fleet.test.mjs:196`, `:393`, `fleetunapproved.test.mjs:153`) still pass without edits, because `eligible=` is kept.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`. Run `pnpm run test:board` if anything under `packages/` changes. Not `test:e2e`. Add a changeset for `plot` (patch) with the description first; see CLAUDE.md › Versioning. Update `skills/plot-pulse/SKILL.md:163`'s example footer to show `claimable=`.

`fleet.test.mjs` runs for 355–544 s. Give it a ten-minute timeout and run failures alone before believing them.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh` (human output, footer, `--list-eligible` stderr), `skills/plot-pulse/SKILL.md` (the footer example), tests under `test/reconcile/`, and one changeset.

It does not touch `packages/domain/src/rules/eligible.ts`, `packages/board/src/contract/schema.ts`, `plot-dispatch.sh` or `plot-worker-loop.sh`.

In flight: a sweep of every `origin/*` branch at dispatch (2026-09-25) found none whose diff against `main` touches `plot-fleet-scan.sh`, `rules/eligible.ts`, `fleet.test.mjs`, or the board's fleet/pulse sources.

**Open question the plan leaves:** does the board's badge read the wave answer or the branch answer? `board.ts:904-920` counts `eligible` per plan as open branches in eligible slices, which is already the claimable answer, and rows carry `StartabilityVerdict`. Report what you find in the PR body. Do not change the board on this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — the-plan-walk-moves-into-the (wave: Cache)

- **Plan (canonical):** [docs/plans/2026-10-31-the-plan-walk-moves-into-the.md](../../docs/plans/2026-10-31-the-plan-walk-moves-into-the.md) on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-walk-caches-by-oid` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR review channel: `pr`)

This is the sixth of eight slices. It waits on `feature/scan-once-walks-in-process` (#2992, merged), which gave `scanOnce` its one in-process call site — `walkOnce` (`packages/fleet/src/shared/fleet-scan.ts:666-729`), called from `scanOnce` at `:852` inside `withinBudget(..., FLEET_SCAN_BUDGET_MS)`. Two slices wait on this one in turn: `feature/the-scan-modes-run-the-walk` and, after it, `feature/the-pulse-log-runs-the-walk`.

### What to build

Every read inside `walkOnce` today is cold: `readEstate`, `readBranchReadings` and `readDeskReadings` (all under `packages/domain/src/workflows/`) re-derive every answer on every beat, exactly like the shell script did — this was deliberate in the prior slice ("no cache. none." — see its brief, still on `origin/main` at `.plot/briefs/scan-once-walks-in-process.md`). This slice adds the oid-keyed caches to `ScanState` (`fleet-scan.ts:71-110`), a per-beat snapshot that reads ref-to-oid pairs once up front, and mark-and-sweep pruning so the cache stays bounded in a daemon that runs for weeks.

The target shape, per the plan's Design point 4 and Inputs table: a cached answer is a pure function of the git objects named in its key — never of a ref name — and `unknown`/failed reads are never cached. After each completed beat, any cache entry the beat's snapshot did not touch is removed.

### The decisions the plan settles — do not re-derive them

**The key is the object id, never the ref.** `origin/<main>` tip oid plus each main-relative reading's own (main oid, branch oid) pair; remote/local ref oids, where a ref's creation or deletion counts as a change (the safety panel's row 3 — a pruned ref has no oid, and "no entry" must read as "changed," not "unchanged"); the plan tree's blob oids and symlink targets; the parse key (blob oid + parser-file hash + Plot Config digest); merge subjects (raw subject text only — see below); and the commits that added each plan. Build the snapshot once per beat, before any cached read, and key every lookup off that one snapshot — never off a second `git` call mid-beat. The safety panel's race-test requirement (Notes, and `## Done when`'s "A race test moves a ref between the snapshot and the reads") exists because a ref read twice in one beat can disagree with itself.

**A parser-version key hashes the file on disk, every beat — not a version baked into fleetd's bundle.** The safety panel (§6) is explicit: fleetd's TypeScript walk lives in a bundle that does not reload until fleetd restarts, but `plot-plan-meta.sh` is still a script on disk that changes on every fast-forward of main. A compiled-in version string cannot see that change. Hash the parser file synchronously each beat (`hashFilesSync` already exists per the panel) and fold that hash into the parse key alongside the blob oid and the config digest — the plan's own Design point 4 names exactly these three.

**Row 6 (prefix-branch plan set) is not a per-blob cache — it is recomputed whenever any prefix ref moves.** The set of plans that exist only on a prefix branch depends on every tracked prefix ref together, not on one blob at a time. Cache the resolved set keyed by the tuple of all prefix ref oids, not per-plan.

**Row 9 (merge subjects): cache the raw subject by oid; never cache its interpretation.** The raw commit subject text is a pure function of the commit oid and may be cached. Whether that subject counts as a GitHub or Bitbucket merge-subject form depends on `remote.origin.url` and the configured host backend (row 11, an every-beat input per the Inputs table) — re-derive the interpretation fresh each beat from the cached raw text, never cache the parsed verdict.

**Ancestry entries refuse on a shallow repository or when `refs/replace` is non-empty.** Check both before trusting any cached or fresh `containsMany` answer — a shallow clone or an active replace ref makes ancestry answers unreliable regardless of caching, per the plan's Design point 4 bullet list.

**The dirty set bounds reads only — verdicts and output are never partial.** Only the readings touched by changed oids get re-fetched; `sliceVerdicts`, `waitVerdict`, and every rule downstream of the readings still run over *all* current readings on every beat, and `fleetReading`/`assemblePlanWalk` still emit every plan. Do not thread a "only recompute what changed" shortcut into the assembly stage — that stage already exists (merged, assembly slice) and this slice does not touch it.

**The cache belongs to `ScanState`, carried in fleetd's process — never shared with the dispatch re-check.** `plot-dispatch.sh --list-eligible` runs a separate, cold process by design (Design point 4's last bullet, and the safety panel §4: "the launcher never loads fleetd's cache, and no file or environment variable carries the cache to the launcher"). Do not add any serialization path, env var, or file that would let `--list-eligible` or any other launcher-mode process read this cache. `PLOT_TERMINAL_CACHE` is the existing precedent for passing *other* state through the environment (`fleet-scan.ts:62-69`) and it is explicitly not a template to extend to this cache.

**Store each entry as it is read, not when the beat ends — prune only after a completed beat.** The safety panel (§5, "Restart"): a cold walk after a fleetd restart may exceed the beat budget on its first pass. If entries are only committed at beat-end, a timed-out beat warms nothing and the next beat starts cold again, repeating the overrun. Write to the cache incrementally during the walk; run mark-and-sweep pruning only once a beat finishes successfully, never on a thrown/timed-out beat.

**No `unknown` or failed read is ever cached.** A failed `listBlobs`, `readBlobs`, `mergeBase`/`containsMany`, or host call returns a failed `PortResult` — store nothing for that key, and do not convert the failure into an empty or "no" answer that then gets cached as if it were a real one (safety panel §7, and the plan's own Design point 4: "`unknown` and failed reads are never cached").

**A working-tree-fallback read bypasses the cache entirely.** Per the safety panel (§3, item 3) and this plan's Decisions section ("`plan-store-ref.ts` is fixed in slice 1 ... reports an unreadable tree as a failure"), the estate stage already fails loudly rather than silently falling back to an empty plan list. If any working-tree-sourced plan reading still exists in the code path you touch, it has no tree oid to key by — it must never be written into the oid-keyed cache.

### Done when

The plan's `## Done when` (Cache bullets) is the specification — a full-versus-incremental corpus test over successive states built in temporary repositories, covering: main moves while a branch stays; a ref is pruned; an `active/` link is retargeted; a `waits:` prerequisite merges; a listing row changes only CI or draft; an unreadable commit becomes readable; the branch prefixes change; the parser file changes. Plus:

- A race test moves a ref between the snapshot and the reads, and finds no entry whose key differs from the oid actually read.
- A test proves the cache holds no `unknown`.
- A prune test shows the entry count returns to the live estate's size after a plan is removed.
- A warm no-change beat costs at most 2 s CPU at load up to 10 (compare against the in-process slice's own uncached measurement, reported in its PR, and the original 27.7–30 s shell baseline in the plan's Motivation).
- The slice records how many beats in one hour of fleetd changed any reading — this is Design step 4's open measurement; report it here since no other slice owns it.

Each fixture above must be mutation-tested per the safety panel §4 ("Start"): remove the main oid from a cache key and confirm the corresponding test fails — a fixture that passes whether or not the oid is in the key proves nothing.

Plus: the repo's gates — build artifacts (no committed `board-server.mjs` diff), a changeset naming `plot` or `@plot-pm/board`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; it maps changed paths (`packages/fleet/**`, `packages/domain/**`) to the right suites and gate tests. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite here.

Name the shell gate if you touch any `.sh` file under `skills/`: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice is expected to live entirely in `packages/fleet` and `packages/domain` — confirm that stays true; if it isn't, the growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/the-walk-caches-by-oid` under `### Cache`).

### Scope guard

This branch owns: the oid-keyed cache fields added to `ScanState` (`packages/fleet/src/shared/fleet-scan.ts:71-110`), the per-beat snapshot read, mark-and-sweep pruning, and the full-versus-incremental corpus tier plus the race and prune tests.

It does not own: the four domain workflow stages themselves (`readEstate`, `readBranchReadings`, `readDeskReadings`, `assemblePlanWalk` — all merged), the `scanOnce`/`walkOnce` in-process call site and its beat-budget mechanism (`feature/scan-once-walks-in-process`, merged), the `PLOT_SCAN_WALK` shell switch or `plot-scan-walk.mjs` (assembly slice, merged, serves only the shell's own CLI modes), and the CLI-modes/pulse-log slices that follow (`feature/the-scan-modes-run-the-walk` and `feature/the-pulse-log-runs-the-walk`, both waiting on this one).

If you find something the plan did not anticipate, report it rather than improvising outside scope.

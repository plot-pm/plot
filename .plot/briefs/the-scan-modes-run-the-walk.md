## Implementation brief — the-plan-walk-moves-into-the (wave: CLI modes)

- **Plan (canonical):** docs/plans/2026-10-31-the-plan-walk-moves-into-the.md on main
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-scan-modes-run-the-walk` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This branch waits on `feature/the-walk-caches-by-oid` (merged as PR #2995 — the
oid-keyed cache now lives in fleetd's `ScanState`). It is itself waited on by
`feature/the-pulse-log-runs-the-walk`, so land it before picking that up.

### What to build

The plan's framing ("`--json`, `--next`, `--list-eligible`, `--why-nothing`,
`--slice-names`, `--loose` and `<slug>` run through one node entry") reads as
if this slice builds that entry point. **It mostly already exists.** The real
work is narrower than the plan summary implies — read this section before
touching code, or you will rebuild something that is already built.

`skills/plot/scripts/board/plot-scan-walk.mjs` (built from
`packages/board/src/server/entry/scan-walk.ts`) already wires the four domain
workflow stages (`readEstate` → `readBranchReadings` → `readDeskReadings` →
`assemblePlanWalk`) and already answers all five machine modes — `--json`,
`--next`, `--list-eligible`, `--why-nothing`, `--slice-names`. The shell
(`skills/plot/scripts/plot-fleet-scan.sh:412-424`) already `exec`s into it
when `PLOT_SCAN_WALK=domain` and none of `--loose`/`--stream`/`--log-pulse`
is set. `test/reconcile/scan-walk-domain.test.mjs` already proves the two
paths agree byte-for-byte (masking three known gaps, see below). This was all
built by the "Assembly" and "In-process" slices.

**What this slice actually adds:**

1. **Flip the default.** Today `PLOT_SCAN_WALK=domain` is an opt-in env var;
   production runs `shell`. This slice makes the five machine modes run the
   domain walk unconditionally — not gated behind an env var a caller has to
   remember to set. Whether that means deleting the `shell` branch for these
   five modes outright, or just changing the default value, is a judgment
   call: the plan's "Removal" wave (`feature/the-scan-script-is-a-launcher`,
   later) is explicitly where the shell walk implementation itself is deleted
   and the corpus pairs retired by name — so this slice likely flips the
   *default* and leaves the `shell` escape hatch alive until Removal, rather
   than deleting code this slice doesn't own. Confirm which by re-reading the
   Removal slice's own wording before deciding; don't delete the shell walk
   here.
2. **Bare `<slug>` as a direct query.** Today `slug` is a positional argument
   threaded into whichever mode flag was also passed — there is no mode where
   `<slug>` alone (no `--json`/`--next`/etc.) does anything on the domain
   path. Decide what a bare slug should answer (most likely: the same shape
   `--json` gives, scoped to that one plan) and wire it into
   `scan-walk.ts`'s mode dispatch.
3. **`--loose` stays shell, and say so explicitly rather than silently
   skipping it.** `--loose` verifies the prior wave's PRs are green via the
   host (`plot-fleet-scan.sh:399-410`) and is excluded from the domain switch
   today (`plot-fleet-scan.sh:412-424` checks `$loose` is `0`). The plan's
   bullet list names `--loose` among the modes this slice touches, but
   nothing in the plan's Decisions section walks it into the domain walk, and
   `--loose`'s host-verification logic has no corresponding domain stage. The
   defensible reading is: confirm `--loose` still works correctly dispatching
   through whichever path handles the other flags (it already does, since it
   is excluded from the domain exec and falls through to the rest of the
   shell script), and record in the PR that `--loose` was checked and
   deliberately left on the shell path, rather than silently leaving it
   unexamined.
4. **`Refs.pulse()` calls the walk in-process.** Today
   `packages/domain/src/adapters/refs/refs-git.ts:583-589` shells out:
   `runProcess('bash', [scan, '--json'], ...)` and parses stdout against
   `FleetReadingSchema`. Its one caller is
   `packages/domain/src/adapters/sprint-scope-ref.ts:103`
   (`const pulse = await refs.pulse()`). Replace the shell-out with an
   in-process call to the same stage functions `scanOnce`
   (`packages/fleet/src/shared/fleet-scan.ts`) and `plot-scan-walk.mjs`
   already use — `readEstate` → `readBranchReadings` → `readDeskReadings` →
   `assemblePlanWalk` → the `fleetReading` shape — removing the `bash`/
   `runProcess` spawn from this adapter method entirely. This is exactly the
   kind of adapter-only, spawn-reducing change the CI ratchet
   (*One place reaches a process*, `ci.yml:259`) counts down.
5. **`plot-fleetctl.sh` recognises the new scan process.** Its classifier,
   `plot_process_candidates()` (`skills/plot/scripts/plot-fleetctl.sh:279-339`),
   is an awk routine over `ps axww` snapshot lines. It currently has three
   kinds: `board` (`/board/board-server.mjs`), `supervisor`
   (`/board/plot-fleetd.mjs` or `/board/plot-registryd.mjs`), and `scan` — but
   the `scan` branch matches only the literal bare token `plot-fleet-scan.sh`
   under a `bash`/`sh` interpreter (line 322: `art_end(p, "plot-fleet-scan.sh", 1)`).
   Once the domain path runs as `node .../board/plot-scan-walk.mjs ...`
   instead of `bash .../plot-fleet-scan.sh ...`, that process is invisible to
   fleetctl's machine-wide listing — it matches none of the three `node`
   branches. Add a fourth `art_end` check for `/board/plot-scan-walk.mjs`
   under the `node` interpreter, mapped to kind `scan` (same kind name the
   shell process already reports, so fleetctl's listing output format does
   not change shape).

### Known gaps carried over — do not treat as new defects

`skills/plot/scripts/README.md:112` and `test/reconcile/scan-walk-domain.test.mjs`
already document three fields the domain walk does not yet answer, masked out
of the byte-comparison: `conflicts_known`, `conflicts` and `changed_paths`
(the shell computes these with `git merge-tree`; no domain port operation
answers them yet), and `summary.merge_detect` (the domain walk reads no merge
subjects on this path). These are pre-existing, named gaps from the Assembly
slice — not something this slice is expected to close. If you find yourself
tempted to add `git merge-tree` calls to close them, stop: that is out of
this slice's scope and belongs, if anywhere, to a later slice.

### Done when

The plan's `## Done when` "CLI modes" line is the specification: each mode's
normalised output equals the shell walk's on the pinned clone, and
`node --test test/reconcile/fleetctl.test.mjs` passes with the new process
argv. In practice:

- `test/reconcile/scan-walk-domain.test.mjs` continues to pass once the
  default flips (it already runs both `PLOT_SCAN_WALK=domain` and `shell`
  explicitly, so flipping the default should not change its outcome — if it
  does, that is a real regression, not a fixture problem).
- A new or extended test proves bare `<slug>` answers something on the domain
  path (there is none today — `grep` the mode-dispatch tests in
  `test/reconcile/` for the shape to match).
- `node --test test/reconcile/fleetctl.test.mjs` passes with a fixture
  process whose argv is `node .../board/plot-scan-walk.mjs ...`, proving the
  new `scan` classification.
- A test on `sprint-scope-ref.ts` (or its existing corpus/adapter test) proves
  `Refs.pulse()` no longer spawns a process — a `Scripts`/process fake that
  fails on any `bash`/`plot-fleet-scan.sh` call is the shape `scanOnce`'s own
  test already uses for the equivalent proof; mirror it.

Plus: `pnpm build:board` before running `scan-walk-domain.test.mjs` — it
fails with that exact instruction if the bundle is stale, and the test file
says so in its own header comment. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints; the suites named in `CI suites` run in CI, and a failure
there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is
longer than at its merge base. This slice is expected to shrink shell (gating
logic simplifies once the domain path is unconditional for five modes) and
grow `plot-fleetctl.sh` by a handful of awk lines for the new `scan` branch —
net should be flat-to-negative, but check the gate's number before pushing;
if `plot-fleetctl.sh`'s growth isn't offset, remove shell elsewhere in the
same change rather than ask for an exemption (there is none).

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Push the first real commit as soon as it exists — do not wait for the whole
slice. When the PR is created, append `→ #<number>` to this branch's line in
the plan's `## Slices` section (the "CLI modes" entry, currently with no PR
number).

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-fleet-scan.sh` (the `PLOT_SCAN_WALK` gate and
  flag dispatch only — not a rewrite of the whole script)
- `skills/plot/scripts/plot-fleetctl.sh` (`plot_process_candidates()`)
- `packages/board/src/server/entry/scan-walk.ts` (mode dispatch, for bare
  `<slug>`)
- `packages/domain/src/adapters/refs/refs-git.ts` (`pulse()`)
- Whatever test files prove the above

Other branches in flight at the time this brief was written: none — this
plan's branches run one wave at a time (`own-branches`, strictly sequential
waits), and the prior wave (`feature/the-walk-caches-by-oid`) is already
merged. The next wave (`feature/the-pulse-log-runs-the-walk`) waits on this
one and has not started.

If you find something the plan did not anticipate, report it rather than
improvising outside scope — in particular, if flipping the default for the
five modes turns out to require touching code outside the five files listed
above, stop and report before widening scope.

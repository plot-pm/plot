## Implementation brief — the-plan-walk-moves-into-the (wave: Pulse log)

- **Plan (canonical):** docs/plans/2026-10-31-the-plan-walk-moves-into-the.md on main
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-pulse-log-runs-the-walk` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This branch waits on `feature/the-scan-modes-run-the-walk` (merged as PR #3001
— the five machine modes and bare `<slug>` already run the domain walk, and
`Refs.pulse()` already walks in process). It is itself waited on by
`feature/the-scan-script-is-a-launcher` (Removal), which has not started.

### What to build

`--log-pulse` is the one caller mode #3001 did not move. Read
`skills/plot/scripts/plot-fleet-scan.sh:424` before touching anything —
the dispatch condition is `"${PLOT_SCAN_WALK:-domain}$loose$stream$log_pulse" != domain000`,
which requires `log_pulse` to be `0` to reach the node entry. Setting
`--log-pulse` sets `log_pulse=1` (`:290`), so today it always fails that
condition and falls through to the shell's own per-plan loop (`:4250` onward)
purely to accumulate `n_waves`, `n_eligible`, `n_claimed`, `n_blocked`,
`n_deferred`, `n_waiting`, `n_prereq_missing` and hand-assemble `reading_doc`
(`:5263-5289`) — the exact computation `assemblePlanWalk`'s
`assembly.summary` already does on the domain path. This slice closes that
gap for the one remaining mode:

1. **Drop `$log_pulse` from the exclusion at `:424`.** Once it no longer
   blocks the domain dispatch, `--log-pulse` needs its own branch inside
   `scan-walk.ts`'s mode dispatch (`packages/board/src/server/entry/scan-walk.ts`)
   or a wrapper around the existing `json` path — the document `fleetReading`
   already returns (`packages/domain/src/workflows/plan-walk-assembly.ts:452`)
   carries every field the shell's hand-built `reading_doc` carries
   (`summary.plans/waves/eligible/blocked/deferred/waiting/prereq_missing`,
   and `plans[].file`), so no new domain computation is needed — only a new
   caller shape that does two things `json` mode does not: append the pulse
   line to each plan's `## Notes`, and write the bridge.
2. **The bridge write already has a domain-backed entry point — reuse it,
   do not re-derive it.** `packages/board/src/server/entry/delta.ts`'s
   `held()` is exactly `plot-fleet-scan.sh:5234`'s
   `node plot-delta.mjs --held < last-pulse.json` check (`fleetHoldsBridge`
   in `packages/domain/src/rules/scan-owner.ts`) — a missing, stale or thin
   bridge, or a failed ask, still writes. Keep calling it the same way (or
   call `held()` in-process from the same entry point you're building,
   whichever avoids a second process spawn) rather than reimplementing the
   four-field staleness check.
3. **The `## Notes` line append is the one piece of real shell logic this
   slice keeps, or moves.** `plot-fleet-scan.sh:5130-5146` reads each plan's
   resolved symlink target, greps for `## Notes`, and `awk`-inserts the pulse
   line after that heading (or appends a new `## Notes` section). Decide
   whether this stays shell (called with the now-domain-sourced plan list and
   counts) or moves into the node entry point — either is defensible, but
   whichever you pick, it must still write through the resolved symlink
   target (`active/<slug>.md` → the real file under `docs/plans/`), never the
   symlink itself, the same bug class `plot-plan-meta.sh` guards against
   elsewhere in this codebase.
4. **The pulse line's format does not change.**
   `<!-- pulse: <stamp> — waves=N eligible=N claimed=N blocked=N deferred=N waiting=N prereq_missing=N -->`,
   stamped `date -u +%Y-%m-%dT%H:%MZ`. A reader (person or `/plot-pulse`)
   diffing pulse lines across a format change would see every plan's history
   line as noise. The seven counts come from `assembly.summary` under their
   existing domain names (`eligible`, `blocked`, `deferred`, `waiting`,
   `prereqMissing`) — confirm each maps to the same shell-side count it
   replaces before wiring it in; `n_blocked` counts **waves**, not branches,
   and `n_waiting`/`n_prereq_missing` count **branches** (the comment at
   `plot-fleet-scan.sh:5283-5286` states this explicitly) — the domain's
   `assembly.summary.blocked` must be the wave-level figure, not a branch
   count, or the pulse line silently changes what its own numbers mean.

### Done when

The plan has no separate `## Done when` heading for this wave (`own-branches`
flow, the heading structure is the same whole-plan list used by every slice);
the "Pulse log" bullet is the specification: *"a test of `--log-pulse` reads
`last-pulse.json` and the plan's `## Notes` line after one run."* In practice:

- A test runs `--log-pulse` against a fixture repository and reads back
  `.plot/state/last-pulse.json`, proving the bridge was written with the
  domain-sourced reading (not the shell's own hand-assembled one).
- A test reads a fixture plan's `## Notes` section after one `--log-pulse`
  run and finds exactly one new pulse line, with counts matching
  `assembly.summary`'s fields under the mapping in point 4 above.
- A test proves the `--held` short-circuit still works: a bridge the fleet
  currently holds (per `fleetHoldsBridge`) is left untouched by
  `--log-pulse`, the same as today.
- `test/reconcile/` already has coverage comparing `--json` between the
  shell and domain paths (`scan-walk-domain.test.mjs`); extend the same
  comparison to `--log-pulse`'s *document* (the bridge content), not just
  its side-effecting `## Notes` write, so a future change cannot silently
  diverge the two without a byte-level test noticing.

Plus: `pnpm build:board` before running any test that spawns
`plot-scan-walk.mjs` — a stale bundle fails with that instruction in its own
header comment. Run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints; the suites named in the repo's
`CI suites` config key run in CI, and a failure there comes back as a
correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is
longer than at its merge base. This slice should shrink shell: the whole
per-plan accumulation loop `--log-pulse` currently falls into
(`plot-fleet-scan.sh:4250` onward, shared with other modes) does not get
smaller just from this change since other callers still need it, but the
`--log-pulse`-specific branches (the exclusion at `:424`, and whichever of
points 2–3 above moves out of shell) should net flat-to-negative. Check the
gate's number before pushing; if it grows, remove shell elsewhere in the
same change rather than ask for an exemption — there is none.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # on the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it
exists — do not wait for the whole slice. When the PR is created, append
`→ #<number>` to this branch's line in the plan's `## Slices` section (the
"Pulse log" entry, currently with no PR number).

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-fleet-scan.sh` (the `:424` dispatch condition and
  the `--log-pulse`-specific branches only — not a rewrite of the whole
  script, and not the per-plan loop other modes still use)
- `packages/board/src/server/entry/scan-walk.ts` (the new `--log-pulse` mode,
  or a wrapper reusing the `json` path)
- `packages/board/src/server/entry/delta.ts` (only if `held()` needs a new
  caller shape to be called in-process rather than spawned)
- Whatever test files prove the above

Other branches in flight at the time this brief was written: none — this
plan's branches run one wave at a time (`own-branches`, strictly sequential
waits), and the prior wave (`feature/the-scan-modes-run-the-walk`) is already
merged. The next wave (`feature/the-scan-script-is-a-launcher`, Removal)
waits on this one and has not started — do not delete the shell walk's
remaining implementation or retire any corpus pair here; that is Removal's
job, named explicitly in the plan.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

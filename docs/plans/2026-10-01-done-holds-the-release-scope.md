# DONE holds the release scope

> DONE is meant to name what the next release ships, and it drops a delivered plan 24 hours after delivery. On 2026-10-01, 25 plans awaited 2.22.0 and DONE showed 10.

## Status

- **State:** Released
- **Approved:** 2026-10-01, jwloka, in-session
- **Type:** bug
- **Issue:** #1116
- **Review:** in-session
- **Impl:** own branches
- **Delivered:** 2026-10-01
- **Released:** 2026-10-01, v2.22.0

## Changelog

- DONE lists every delivered plan that has not been released, whatever its age, so it names what the next release ships.

Board impact: yes. DONE gains every delivered, unreleased plan; the payload's shape is unchanged.

## Motivation

`done-holds-what-is-still-yours` (released in 2.9.0) defined DONE as the **release scope**: every plan whose work has landed and whose version has not shipped.

The fleet scan bounds that set by age instead. `plot-fleet-scan.sh:2251-2281` (*Recently delivered plans: the last day of finished work*) admits a delivered plan only while its `Delivered:` date lies inside `DELIVERED_WINDOW_HOURS`, read from `Claim stale after` (24). The window was written so a plan's branches stay visible right after delivery, and its comment says so: *"the answer stays the size of a day's work"*. It also became the bound on what DONE can hold.

Measured 2026-10-01: 25 plans reached `Delivered` after `v2.21.0`. DONE showed 10, plus 2 hidden by *Sprint only*; the 15 delivered on 2026-09-28 and 2026-09-29 were absent, and the footer read *15 branches across 11 plans*.

## Design

### The rule

**A plan at `Delivered` is in the pulse until it is `Released`.** Phase alone decides: `Delivered` admits, `Released` does not, and no age or window applies. That is the release scope `done-holds-what-is-still-yours` defined, read from the field `/plot-release` writes.

### The admission

`delivered_candidates` (`plot-fleet-scan.sh:2447`) lists links under `delivered/` whose mtime is inside the window. It is replaced by a scan of the plan directory for files whose `State:` line reads `Delivered`, one `grep -l` over `docs/plans/*.md`. Reading the plan directory rather than the `delivered/` index follows the rule the scan already applies to live plans: a missing symlink must not hide a plan. The `Delivered:` record stops deciding membership; `delivered_in_window` (`:2896`, `:3131`) and `DELIVERED_WINDOW_HOURS` (`:2280`) are removed with it.

### The cost

The window existed to bound parse cost: about 57 ms per plan through `plot-plan-meta.sh`. The release scope is bounded too, by the release cadence rather than by a day: on 2026-10-01 it held 31 plans, the 25 above plus 6 delivered before `v2.21.0` that were never marked `Released`. The slice measures a fleet scan on this repository before and after the change and records both numbers in its PR. If the added time exceeds 2 s, the slice caches each delivered plan's parse keyed by the file's blob hash (`git hash-object`), since a delivered plan's file rarely changes, and records that measurement too.

### What this does NOT do

- **It does not write `Released`.** The six plans that shipped in `v2.21.0` and still read `Delivered` will appear in DONE until `/plot-release` records them, which it does for the plans each release contains.
- **It does not change the sections a delivered plan's branches render in**; it only stops them leaving after 24 hours.

## Done when

- A fixture estate with one plan delivered 30 days ago and one delivered an hour ago puts both in the pulse; a plan at `Released` is in neither, and a Draft plan is unaffected.
- A delivered plan with no `delivered/` symlink is in the pulse.
- `DELIVERED_WINDOW_HOURS` and `delivered_in_window` no longer appear in `plot-fleet-scan.sh`, and `Claim stale after` keeps its claim meaning only.
- `test/reconcile/fleetdelivered.test.mjs` and `test/reconcile/fleetderived.test.mjs` are rewritten to the phase rule: each assertion that a plan leaves after the window now asserts that it stays until `Released`.
- The PR records a fleet scan's duration on this repository before and after the change, and, if the cache was built, with it.

## Slices

### DONE holds the release scope (Branch: bug/done-holds-the-release-scope, PR: #1117)

The phase-based admission in `plot-fleet-scan.sh`, the removal of the window, the rewritten contract tests, and the measurement.

## Notes

Filed while preparing 2.22.0 on 2026-10-01, when the operator asked where the other plans shipping with the release were.

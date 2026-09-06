## Implementation brief — a-stated-wait-is-a-parsed-wait (slice: The scan reports a wait that only prose declares)

- **Plan (canonical):** `docs/plans/2026-09-06-a-stated-wait-is-a-parsed-wait.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/a-stated-wait-is-a-parsed-wait` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

## What this delivers

`plot-reconcile-scan.sh` reports a live slice whose body claims a wait its branch line does not carry.

## The measured case

`a-desk-is-adopted-and-swept` said in bold: *"**IT WAITS FOR** [`a-desk-is-finished-with-once`](…) (#705)."* Its heading carried no `waits:`, so the machine read the slice as eligible, `bug/the-reaper-reads-prunable` reached the supervisor's queue as `no-brief`, and **a person recognising the prose was the only thing that stopped it dispatching.**

`waits:` is parsed into `waves[].branches[].waits_on` and used by 6 plans. The annotation was added 2026-09-06.

## The rule is narrow, and round 1 measured why

**THE FIRST DRAFT WOULD HAVE REPORTED 82% OF THE ESTATE.** *A slice body linking a plan file or naming a PR number without `waits:`* fires on **391 of 477 slices** — plans cite each other as context constantly. A finding that fires on four slices in five is one a reader learns to skip.

**MATCH THE CLAIM, NOT THE REFERENCE.** `waits for` / `waits on` in a slice body: **13 hits over the whole estate, 0 over the 40 live slices.**

| phrase | slices | why not this one |
|---|---|---|
| `waits for` / `waits on` | **13** | **use this** |
| `depends on` | 16 | reads as design rationale more often than ordering |
| `after the …` / `after #…` | 13 | temporal prose, rarely a dependency claim |

**THE 13 ARE THE HONEST COST AND THEY ARE HISTORICAL.** A `--stop` that *waits for each* agent to exit; a design doc *about* wave waiting; a monitor *waiting on* a finding. Two read as genuine and **both are on Released plans**. A reader meets these once when the section ships, not every run.

## Scope it to live plans

**ONLY Draft and Approved.** A Released plan's wait resolved by shipping, and reporting it is noise about finished work. That single filter is what takes 13 findings to 0 today — and 0 today is the Done-when, not an aspiration.

## Where it goes

**BELOW `== blocking sections end ==`** (`plot-reconcile-scan.sh:8`). An unannotated wait is a legibility gap, not a broken pointer, and an advisory finding that can stop a delivery is a gate nobody agreed to.

**IT COUNTS IN THE MACHINE-COUNTABLE FOOTER**, joining `uncut_slices=`, `index_drift=`, `rounds_drift=` and `sprint_index_drift=` at `:1743`.

**IT REPORTS AND CORRECTS NOTHING.** A plan may legitimately say a slice waits while the author decides it is context. The finding names the slice and the sentence so a person can add the annotation or dismiss it — the posture every advisory section here already has.

## Done when

- the scan reports a **live** slice (Draft or Approved) whose body claims a wait while its branch line carries no `waits:`
- it names the slice and quotes the sentence
- it counts in the machine-countable footer and gates nothing
- it sits below `== blocking sections end ==`
- **it reports zero findings on today's estate**
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not match a plan link or a PR number.** That was measured at 391 of 477.
- **Do not add `depends on` or `after`.** 29 more hits, and neither is a dependency claim in this estate's usage.
- **Do not scan Released or Delivered plans.**
- **Do not gate on it**, and do not place it above the blocking marker.
- **Do not infer a wait from arbitrary English.** The check matches one phrase the estate actually uses to mean this.
- **Do not run `pnpm run test:e2e`.** CI is its gate.

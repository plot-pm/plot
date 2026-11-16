## Implementation brief — the-s6-census-row-counts-one-change

- **Plan (canonical):** `docs/plans/2026-11-16-the-s6-census-row-counts-one-change.md` on `main`
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Branch:** `bug/the-s6-census-row-counts-one-change` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI (`census-head`, `census-base`, `census-compare`) is the authority for the measurement

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

On release PR #3444 at `7795279e1`, `census-compare` failed S6 on attempt 2 (HEAD 881 execve against a limit of 648.8, merge base 588) and passed on attempt 4 (589 against 589). S5 + S6 stayed at 1184 on both attempts: the failing run moved about 293 execve of the desk-commit change from S5 into S6. The cause is the normal pass's settle rule. `pass` in `packages/fleet/test/census/fleetd-census-entry.ts` advances the clock and waits on `quiet()` alone. `quiet()` does not see fleetd's supervision tick, so a gap of more than 300 ms between the scan's last child and the tick's first child places the `pass-4` mark early, and the tick's children land in the next pass. Under `strace -f` on a CI runner the gap exceeds 300 ms.

The fix lives in the census harness only (`packages/fleet/test/census/`). Build, in this order:

1. **`passSettled` in `census-settle.ts`.** A pure function `passSettled({ inFlight, sinceSettledMs, scanBusy, quietMs })` that returns true only when `inFlight` is 0, `sinceSettledMs >= quietMs` and the scan is not busy. `quiet()` in the entry calls it.
2. **`trackedTick` in `fleetd-census-entry.ts`.** Wrap the product's `tick` the way `track` wraps a child: add one to `inFlight` before the call, and on return or throw subtract one and set `lastSettled`. Count the ticks it runs. Pass `{ clock, tick: trackedTick }` to `run`; `RunSeams.tick` exists at `registryd-main.ts:2838`.
3. **`census-product:tick` in `fleetd-entry-build.ts`.** Add the specifier to `PRODUCT_MODULES`, pointing at `packages/fleet/src/server/entry/registryd.ts`, which exports `tick` at `:374`. The entry imports the product's `tick` through it.
4. **The `ticks=` done line.** The entry prints `census: pass <n> done ticks=<k>`. The driver's pattern at `fleetd-driver.ts:98` is `^census: pass ${n} done$`, anchored, so it must change to accept the suffix. Update the two existing assertions in `fleetd-entry.unit.test.ts` (`:74`, `:82`) that match `done$` the same way.
5. **S5 and S6 rows in `fleetd.census.test.ts`.** Print the real milliseconds of the pass and its tick count, as S8 prints `ms per pass` (`:266`). Assert that each change pass ran at least one tick, so a pass that settles before its tick fails by name instead of moving its count into the next row.
6. **A changeset** for `plot` (patch). Put the description first and the `bumps:` block last, naming `plot`.

### Settled decisions — do not re-derive them

**Wrap the existing `RunSeams.tick`; do not add a product seam.** The alternative, `RunSeams.parked?: (parked: boolean) => void` called by `pause` around `wake.wait` (`registryd-main.ts:3652`, `:3660`), closes every gap. It was rejected because the merge-base product ignores the seam until the fix is on `main`, so the PR that lands it still measures the base with the old race, and the two halves of the census would measure differently. `RunSeams.tick` has been on `main` since #1523, so the merge-base product accepts the wrapper at once and both halves measure alike. Jan Wloka decided option A on 2026-11-16. Take the product seam only if the `ticks=` logs show a leak with the wrapper in place, and then as a new plan.

**Waiting for the scan does not close this gap.** `scanEnded` (`:287-297`, from #3454, `8c2682388`) is the safety-net pass's answer, and it stays unchanged. In this race the scan has ended and the tick has not started its first child, so a scan wait returns too early. The bridge (`scanBusy`, `census-settle.ts:31-42`) tracks the scan and has no reading of the tick; that is why the tick is counted in the entry.

**Known limit of option A.** The wrapper does not hold the pass across the short gap between `wake.trigger` (`registryd-main.ts:3489`) and the start of `runTick` (`:3763`). That gap is in-process work in one loop iteration. Do not try to close it in this slice.

**No tolerance changes, and no row is marked as expected to fail.** The failing S6 stays a real gate. Do not widen the 10 % + 2 limit, and do not skip S6 on a second attempt.

**Carried over unchanged.** A lower count never fails the gate, which is why S5 passed on the failing run: read S5 and S6 together, as the sum S5 + S6. The S8 first safety-net window (900 to 902, then 313 and 316 on GitHub with 3 desks) is stable and outside this plan.

### Done when

The plan's `## Done when` table is the specification. Lifted from it, with what each catches:

- `passSettled` unit tests in `census-settle.unit.test.ts`. They must fail before the slice (the function does not exist) and cover the case a naive rule passes: `inFlight` is 0, the quiet window has passed, no scan is busy — settled — against the same input with one tick in flight, which must not settle.
- A test in `fleetd-entry.unit.test.ts` that reads `ticks=` on the done line of a pass after a desk commit and expects at least 1. It catches a `trackedTick` that is never passed to `run`.
- CI `census-head` on this PR prints S5 and S6 with `ticks=` of at least 1 each, and S5 + S6 stays within 2 of the merge base's sum.
- Three CI runs of the head commit (one push, two reruns of `census-head`, `census-base` and `census-compare`): every attempt reads S6 HEAD within 10 % + 2 of its merge base, and S5 likewise. A single green run proves nothing here — attempt 4 of #3444 was green with the race still present.

Plus: add a changeset (`./scripts/check-changeset-packages.sh` checks it). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push, and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e`, and do not run the census locally under load: it starts a real fleetd under `strace`-like tracing on a CI runner, and the three-run check above is CI's job.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), not `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Function style: new helpers in `packages/fleet/test/census/` are arrows (`const f = (…) => …`), not declarations.

### Scope guard

This branch owns `packages/fleet/test/census/` (`fleetd-census-entry.ts`, `fleetd-entry-build.ts`, `census-settle.ts`, `fleetd-driver.ts`, `fleetd.census.test.ts`, `census-settle.unit.test.ts`, `fleetd-entry.unit.test.ts`) and one changeset in `.changeset/`. It changes no file under `packages/fleet/src/`, `packages/domain/` or `skills/`, and it adds no corpus row. Other work in flight is the sprint `bug-fixes-2-35-0` and the plan `an-exhausted-episode-admits-its-repair-pr`; neither names a census file as of this dispatch.

If you find something the plan did not anticipate — in particular a leak that remains with the wrapper in place — report it rather than improvising outside scope.

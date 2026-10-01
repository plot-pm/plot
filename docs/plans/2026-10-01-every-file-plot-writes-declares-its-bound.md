# Every file Plot writes declares its bound

> `every-temp-directory-has-an-owner` (#1083) shipped in 2.22.0 with two gates missing: the leak gate fails only above 390 entries, and no gate checks what Plot writes outside the temp directory. Its sandbox also hides Playwright's browsers and does not run in CI's board job.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1118
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A contract or board run fails when it leaves any entry in its temp root, and names the entry.
- A contract run fails when Plot writes a state path that no inventory entry declares, and names the path.
- The board suite finds Playwright's browsers inside its private `HOME`, and CI's board job runs inside the same private temp root as a local run.

Board impact: none. No plan-format, template or payload change.

## Motivation

Measured 2026-10-01 on `main`:

- **The leak gate holds a ceiling of 390.** `scripts/owned-run.sh` fails a run only when its root holds more than `PLOT_LEAK_CEILING` entries. The five leakers #1083 measured leave zero; about 23 other files left 390 in one full run (`controller-gate` 34, `brief-name-gate` 22, `scan` 21, `install-hooks` 20, `ci-scheme` 19, `board` 19, `budget-rotation` 18, `storylint` 10, `agent-settings` 9, `capabilities` 8, `host-account` 7, and others). A new leak of fewer than the headroom passes.
- **No inventory gate exists.** #1083's design (`docs/plans/2026-09-30-every-temp-directory-has-an-owner.md`, *An inventory gate holds the rule*) specifies it; it fell between slices when they were re-cut.
- **The private `HOME` hides Playwright's browsers.** On macOS Playwright looks under `$HOME/Library/Caches/ms-playwright`; inside the root that is empty, so every browser test in `pnpm run test:board` fails at `browserType.launch` and is skipped.
- **CI's board job is unsealed.** It runs `vitest` directly (`ci.yml:909`, `:948`), not through `owned-run.sh`, while the #1114 changeset says both suites run in the root.

## Design

### Slice 1: the sandbox reaches the browsers and CI

`owned-run.sh` sets `PLAYWRIGHT_BROWSERS_PATH` before it moves `HOME`, unless the caller set it: the platform's default cache under the ORIGINAL `HOME` (`$HOME/Library/Caches/ms-playwright` on macOS, `${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright` elsewhere). Browsers are read, not written, by the suite, so pointing at the operator's cache does not reopen the leak. CI's board job runs its two `vitest` steps through `owned-run.sh`, so its runs report and fail the same way a local run does.

### Slice 2: no entry is left behind

Every file that leaves an entry in the root is fixed at its call site: each `mkdtempSync` result is removed by its exact name in a `t.after` (or `afterAll`), never by a glob. Then the ceiling goes: `owned-run.sh` fails a run on any entry left in the root, and `PLOT_LEAK_CEILING` is removed. A fixture test creates one entry on purpose and asserts the run fails and names it with its prefix. The SIGKILL case is unchanged: a run killed at its bound reports its entries as the bound firing, not as a leak.

### Slice 3: the inventory gate

`scripts/state-inventory.json` lists globs, each with one bound from #1083's vocabulary: *overwritten*, *spent*, *window*, *rotated*, *removed on exit*, *removed with its desk*, *kept on purpose*, or *tracked in git*. After the contract suite, `scripts/check-state-inventory.mjs` lists every file under the root's `home/.plot/`, `budget/` and `pr-index/`, and matches each path, relative to its base, against the globs. A path no glob matches fails the run and is named. `owned-run.sh` calls it after the suite, beside the registry check, and its exit code joins the run's. Coverage is what the suites execute; the manifest's header states that limit. A fixture test writes an undeclared path inside a sandbox and asserts the check names it.

### What this does NOT do

- **It does not inventory scratch repositories' `.plot/`.** Those are removed with the test that made them, which slice 2's gate already enforces.
- **It does not change any production write path.** Where the inventory finds a path whose bound is not true, it is declared as measured and filed, not fixed here.

## Done when

- Slice 1: `pnpm run test:board` on macOS runs its browser tests, none skipped at `browserType.launch`; a caller-set `PLAYWRIGHT_BROWSERS_PATH` wins; CI's board job runs both `vitest` steps through `owned-run.sh`.
- Slice 2: one full `pnpm run test:contracts` leaves zero entries; `PLOT_LEAK_CEILING` no longer appears in `owned-run.sh`; a fixture test that leaves one entry fails the run and the output names it with its prefix; a run killed at its bound still reports exit 124 as the bound.
- Slice 3: `check-state-inventory.mjs` passes on a full contract run; a fixture that writes an undeclared path under the sandbox `HOME/.plot/` fails it and names the path; every glob in the manifest carries exactly one bound from the vocabulary above.

## Slices

### The sandbox reaches the browsers and CI (Branch: bug/the-sandbox-reaches-the-browsers-and-ci)

`PLAYWRIGHT_BROWSERS_PATH` in `owned-run.sh`, and CI's board job through `owned-run.sh`.

### No entry is left behind (Branch: bug/no-entry-is-left-behind)

The per-file fixes, the ceiling's removal, and the fixture test.

### Every state path is declared (Branch: bug/every-state-path-is-declared)

`scripts/state-inventory.json`, `scripts/check-state-inventory.mjs`, the call from `owned-run.sh`, and the fixture test.

## Notes

Carries the two Done-when items `every-temp-directory-has-an-owner` deferred on 2026-10-01, plus two sandbox gaps found the same day: the Playwright cache while testing #1122, and CI's board job by #1083's delivery panel.

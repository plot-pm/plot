## Implementation brief — the-scan-asks-for-the-state (slice: Asking it from the scan)

- **Plan (canonical):** `docs/plans/2026-09-04-a-branch-state-is-derived-once.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/the-scan-asks-for-the-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **The plan carries three interrogation rounds.** Read its Notes first — round 3 explains why a whole-estate differential was rejected, and that reasoning applies to how you verify this slice.

Slice 2 of two. **`branchState(readings)` landed with #750** — `packages/domain/src/rules/branch-state.ts:285`.

## What this delivers

`plot-fleet-scan.sh` reads git, the claim ref and the plan annotation, and pipes them to the rule through a bundle at a call site that already does this twice.

**`branch_state()`'s GIT ARCHAEOLOGY STAYS.** What goes is the decision — the `if` chain that merges those readings into a state. The script keeps gathering; the rule keeps deciding.

## Read the shell before porting the call

`branch_state()` is at `plot-fleet-scan.sh:3050` in a script of ~4,200 lines, with 10 call sites. Its opening comment is a warning worth honouring:

> *"THE REF CHECK STAYS IN FRONT. DO NOT HOIST THE MERGE LOOKUP ABOVE IT"*

A branch name can be reused — merge `bug/flaky`, delete it, recreate it — and the first attempt's merge subject is still on main as **stale evidence**. Whatever readings you hand the rule must preserve that ordering's effect.

## Verification: unit tests, not a differential

**THE WHOLE-ESTATE DIFFERENTIAL WAS DROPPED AND THE REASON MATTERS.** An earlier draft asserted the scan's `--json` was byte-identical before and after. **It cannot be:** `plot-fleet-scan.sh:630` calls `plot-host.sh pr-list`, `:906` calls `pr-state`, and `branch_state` returns `unknown` when `HOST_VERDICT` is `throttled`, `secondary` or `failed`.

**Two runs of the same code differ when the host is throttled between them** — so a differential over live output measures the host as much as the code, and it fails in the direction that wastes a day, by looking like a regression.

**Asserted instead: each of the eight states is produced from readings the test supplies** — one case per state, in the rule's own unit tests, no host and no git.

**This session has three live examples of that failure mode**, all diagnosed today: the `refs` corpus, `monitors-real-estate`, and `fleet-settings.browser` each failed only while the fleet was moving. **Do not add a fourth.**

## The eight states

`open`, `wip`, `merged`, `claimed`, `deferred`, `unknown`, `waiting`, `blocked` — `entities/fleet.ts:54`. **Do not add or rename one.** The board groups every section by these words and the wire shape does not change.

## Done when

- the scan pipes its readings to `branchState` and no longer decides the state itself
- `branch_state()`'s git archaeology is unchanged
- each of the eight states has a unit test built from supplied readings
- no test compares live scan output between two runs
- the board renders exactly as it does today
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not assert the scan's `--json` is byte-identical.** The plan rejected this; the host makes it impossible.
- **Do not add a live-estate test.** Three already fail whenever the fleet works.
- **Do not hoist the merge lookup above the ref check.** `:3052` says why.
- **Do not add or rename a state.**
- **Do not change what the scan gathers** — only who decides.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc`.

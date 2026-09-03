## Implementation brief — quiet-holds-one-kind-of-row (wave Telling them apart)

- **Plan (canonical):** `docs/plans/2026-09-03-quiet-is-not-one-state.md` on `main`
- **Approved:** 2026-09-03, Jan Wloka, in-session
- **Branch:** `feature/quiet-holds-one-kind-of-row` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 1 of two. It decides; it renders nothing.

### The measurement

`classifyGroup` in `packages/board/src/server/fleet.ts` ends with two lines that describe by commit age whatever nothing else matched. **Age is not a state** — *"no commit for 126 days"* is equally true of rejected work, abandoned work, and work nobody started.

Measured 2026-09-03 on this estate: **17** branches whose PR closed without merging, **2** carrying one `plot: claim` commit and no work, **6** with real commits and no PR. All 26 rows say QUIET, and the last eight say *in progress* — while the estate ran **zero live workers**.

### What this branch owns

**A domain rule** — readings as values, arrow functions, unit-tested without a browser. It answers, for a branch nobody is on: `closed-pr`, `orphaned-claim`, `abandoned`, or `quiet`.

**Use the words the estate already uses.** `packages/domain/src/rules/sweepable.ts` names `'claim-ref'` and `ClaimRefReadings`; the sweep already reports orphaned claims. A reader who meets one on the board must find the same word in `plot-reap.sh --dry-run`, not a second name for one thing.

**Follow `free.ts` for shape.** `packages/domain/src/rules/free.ts` is the model merged this session: an interface of readings, a predicate, and a `why`-style companion that asks the predicate rather than re-deriving its negative — *so the word and its explanation cannot describe different agents*.

**`hasMergedPr` and friends are READINGS, not lookups.** The rule performs no I/O. Whether the host merged a PR is `plot-pr-merged.sh`'s answer, passed in — never ancestry, because squash-merge leaves a branch permanently ahead of main.

### What it does NOT own

**`classifyGroup`.** The rendering slice wires it. This branch changes no rendering and no placement.

**One reading the rule must take: `prState`.** The closed case is not decided in `classifyGroup` — that function is open-only by construction and says so — so the rule reads the PR state it is given rather than expecting to find a closed PR itself.

**The sweep.** `plot-reap.sh` already refuses these correctly — six of them hold unlanded work. This is a display problem sitting on top of a real one.

### Done when

- The rule answers all four kinds, with a test per kind and per refusal.
- No I/O in the rule; every fact arrives as a reading.
- `classifyGroup` is untouched — `git diff` proves it.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here produced 53 concurrent test processes and a board that could not answer in 25 seconds.

# A cold Bitbucket board buys the whole list

> The PR store makes a cold board *render* immediately and never makes its call cheaper on Bitbucket. `bb pr list` takes no query flag, so the window `prWindowFor` computes is discarded and every refresh buys the full listing — on the one host where the account, not the clock, is the scarce thing.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1050
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A Bitbucket board narrows its PR refresh to what changed, instead of re-buying every row each pass.

Board impact: fewer host calls per refresh on a Bitbucket estate. No payload change.

## Motivation

**This replaces a rejected plan, and the correction is the subject.** `docs/plans/2026-09-28-the-persisted-pulse-holds-the-bought-answer.md` claimed the restart path never reads the store. It does — `seedPrsFromStore` (`packages/board/src/server/fleet.ts:2629`), called at `:2829` before the host call, shipped 2026-09-22 in `83c4abdc`/`09cf9018`, connector-agnostic. What that plan asked for exists on every host.

**What it does not do is make the call cheaper, and on Bitbucket it never can.**

`plot-host.sh:3741-3746`, verified against `bb 1.9.0`:

> **THE WINDOW REACHES THE SWEEP AND NOT THE LISTING**, and the asymmetry is the CLI's rather than a choice. `bb pr list` takes `--state`, `--author`, `--json` and `--jq` and no query flag at all — verified against bb 1.9.0, which answers `unknown flag: --query`.

So `plot-host.sh:3755` fires on every listing:

```
plot-host: bitbucket ignores --since <t> on a listing; bb pr list has no query flag (bb 1.9.0) — answering in full
```

`prWindowFor` (`rules/pr-index.ts:158`) computes a window from the store's watermark, `fleet.ts:2848` hands it to the call, and the Bitbucket arm drops it. **The store's second job — narrowing the call — is unreachable on that host.**

### Why this costs more on Bitbucket than the same gap would on GitHub

The rejected plan reached for a rate-limit argument and never traced it. Traced now:

- `plot-fleet-scan.sh:895` calls `pr-list --state all`; `pr_list_verdict` maps the exit to `ok|partial|throttled|secondary|failed`, and `:894` returns early on anything but `ok|partial`. Branches then fall back to local evidence and **are not offered to `--next`**.
- `fleet.ts:2861` issues the same call on the board's PR timer.

A refusal is therefore a fleet that stops dispatching, not a slow screen. And the listing is not a small buy: `plot-host.sh:3705` records `quatico/quaweb-website` at **902 PRs, 886 MERGED**, where three listings answer for 50 rows of 902.

### The narrowing already exists, one path over

`bb_branch_query` carries `updated_on>=` through REST `q=` (`plot-host.sh:789-790`), and `PR_LIST_SINCE` already reaches it. **The sweep can narrow; the listing cannot.** The adapter states the trade at `:3761-3764`:

> A SWEEP'S COST IS THE CALLER'S WORKING SET … 11 branches over 3 states is 33 exact queries, against 3 listings that answer for 50 of 902 rows.

## Design

### The rule

**Where the caller asked for a window and the host cannot narrow a listing, the Bitbucket arm answers from the path that can — when the working set is small enough for that to be cheaper.**

A windowed listing on Bitbucket has exactly three honest options, and the slice picks between them **with a measurement, not a preference**:

1. **Sweep instead.** `bb_branch_sweep` already exists and honours `--since`. Cost is branches × states, so it wins only below a crossover the slice must measure rather than assume.
2. **Keep the full listing and say so.** Today's behaviour, already reported at `:3755`. The honest floor.
3. **Narrow by `--limit` against the union sorted by `updated_on`.** Rejected here unless measured safe — see the guard below.

### The guard option 3 must clear, and it is the one this estate has been bitten by

`bb pr list` paginates with a default of 50 (`bin/bb:195`, called with no limit at `:832`), and the listing is sorted by `updated_on` descending. On a merge-heavy repository the newest 50 are overwhelmingly MERGED and **open PRs are crowded out**. That is the 2026-08-18 measurement recorded at `plot-host.sh:1800-1805`: *"50 PRs, all MERGED, with the 3 open ones gone. No error, a plausible list."*

**A short page that looks complete is this adapter's named enemy** (`:3717`). Option 3 therefore needs per-state truncation detection intact, and it interacts with `a-state-sweep-is-one-request` (#1049), which changes the same budget. **Whichever of the two lands second inherits the other's cap.**

### What the store contributes, and what it cannot

The store supplies the watermark and nothing else here. `prWindowFor` already refuses a window in four cases — no store, no watermark, `complete: false`, or an age past `PR_FULL_READ_MS` — and **a store that cannot narrow must ask in full**, which is today's call exactly. This plan changes no rule in `pr-index.ts`.

### What this does NOT do

- **It does not add a store, a writer, or a cache.** One writer, as today.
- **It does not change `seedPrsFromStore`.** The render half works on every host.
- **It does not touch the GitHub arm**, which honours `--since` natively.
- **It does not read a non-terminal row as authoritative**, and a missing row still means *ask the host*, never *no PR*.
- **It does not persist a verdict.** `fleet.ts:2173` stands.

## Done when

- **The crossover is measured and recorded in the PR**: at what working-set size a `bb_branch_sweep` beats a full listing, on a repository above the pagination cap. A number, from a run, not an estimate.
- The Bitbucket arm honours a window by whichever path the measurement chose, or **keeps the full listing and the `:3755` report** — an explicit, recorded choice.
- **A caller that asked for a window and got a full listing still cannot read the answer as a delta.** `PR_LIST_SINCE=""` and the stderr line are the existing guard; whatever replaces them must preserve the property, because advancing a watermark over a window never applied is the silent corruption here.
- Per-state truncation detection survives, asserted against a fixture of **more than 50 PRs, merge-heavy** — the only regime where the failure exists.
- GitHub's path is unchanged, asserted by a test that still exercises it.
- **The interaction with #1049 is stated**, whichever lands first.

## Slices

### A cold Bitbucket board buys the whole list (Branch: bug/a-cold-bitbucket-board-buys-the-whole-list)

Measure the crossover, then narrow the Bitbucket windowed listing by the path that measurement chose, preserving truncation detection and the no-false-delta guard.

## Notes

**This plan exists because a panel rejected its predecessor and the reporter supplied the missing half.** The rejected plan measured `last-pulse.json`, found no PR data, and concluded PR answers were not persisted. They are — in `.git/.plot/state/index/<connector>.json`, one file per connector per repository, resolved through `git rev-parse --git-common-dir` so a dispatch desk reads the same file as the main checkout (`pr-index-file.ts`, tested at `pr-index-file.test.ts:78`).

**The `v: 1` reading in the rejected plan was never explained and is not load-bearing here.** This checkout's store reads `v: 2`. A different repository has a different store file and its version was never measured; nothing in this plan depends on either.

**The real report came from a Bitbucket repository**, which is why the estate's own measurements missed it: every store and every timing in the rejected plan was taken against a GitHub checkout, where `--since` works and the window is honoured.

**Its sibling is #1049**, which collapses three Bitbucket listings into one. Both touch the same pagination budget from opposite directions — one reduces the number of calls, this one reduces what a call asks for — and neither should be built without reading the other.

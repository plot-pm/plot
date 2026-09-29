# A cold Bitbucket board buys the whole list

> The PR store makes a cold board *render* immediately and never makes its call cheaper on Bitbucket. `bb pr list` takes no query flag, so the window `prWindowFor` computes is discarded and every refresh buys the full listing — on the one host where the account, not the clock, is the scarce thing.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1050
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, Jan Wloka, `bug/a-cold-bitbucket-board-buys-the-whole-list`

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

**The BOARD is the only caller that asks for a window, and an earlier draft attached this plan's cost argument to the wrong one.**

`fleet.ts:2862` is the sole site passing `--since`: `if (window.since !== null) args.push('--since', window.since)`. **`plot-fleet-scan.sh` never asks for one** — its call carries `--limit` and branch args, and `grep -n since` over that script returns prose comments only.

So the fleet-stall path is real and this plan does not change it:

- `plot-fleet-scan.sh:895` calls `pr-list --state all`; the verdict is mapped at `:898` and `:902` returns early on anything but `ok|partial`, after which branches fall back to local evidence and are not offered to `--next`.

That hazard belongs to the scan's **unwindowed** call. **This plan's benefit to the fleet is indirect** — the board spends less of a shared account budget, leaving more for the scan. A real benefit, and a much weaker claim than *narrowing the window stops the fleet stalling*.

The listing is still not a small buy: 895 merged PRs re-bought on every board refresh, against 9 rows in the measured window.

### The limitation is the SUBCOMMAND's, not Bitbucket's — and this is the whole fix

**An earlier draft of this plan inherited a stale comment as a boundary.** `plot-host.sh:3744-3745` says *"the only Bitbucket path that can carry `updated_on` is `bb_branch_query`'s own REST `q=`"*. That is the only path **that exists today**, not the only one available — and the difference is the plan.

- **`bb`'s own listing already builds a `q=` URL.** `bb_pr_list_query` (`bin/bb:445`) takes the `q=` form whenever an author is given, putting the states inside it. The listing calls that function at `:829`. The `q=` path is one branch away in code the listing already runs.
- **Plot already calls `bb api` with a windowed `q=`** at `plot-host.sh:802`, and `bb api` is a documented escape hatch (`bin/bb:2299-2331`).
- **`bb_branch_query` is not special.** It hardcodes `source.branch.name` into its filter; remove that clause and the same code is a windowed bulk listing.

## Design

### The rule

**Where the caller asked for a window and the host cannot narrow a listing, the Bitbucket arm answers from the path that can — when the working set is small enough for that to be cheaper.**

**A windowed Bitbucket listing goes through `q=`, server-side, with no branch clause.** Measured 2026-09-28 against the repository this plan cites, `quatico/quaweb-website` — 902 PRs, 895 MERGED:

```
$ bb -R quatico/quaweb-website api \
  '/repositories/{ws}/{repo}/pullrequests?q=state%3D%22MERGED%22%20AND%20updated_on%3E%3D%222026-09-20...%22&pagelen=50'
{ "size": 9, "returned": 9, "oldest": "2026-09-20T17:46:03", "newest": "2026-09-23T17:53:36" }

$ bb -R quatico/quaweb-website api '.../pullrequests?state=MERGED&pagelen=1'
{ "size": 895 }
```

**One request, 9 rows of 895.** `size` is the server's count of MATCHES, not a page length, so this is not a truncated page.

### The pagination hazard does not arise, and an earlier draft built its guard around it

An earlier draft offered three options and spent its `Done when` on guarding the worst of them — narrowing by `--limit` against an unfiltered union sorted by `updated_on`, which crowds open PRs out on a merge-heavy repository. **That guard is unnecessary because that option should not be built.**

The window narrows **server-side by predicate**, so rows outside it are never in the result set to crowd anything, and the 50-row budget is never approached.

| option | calls | rows | verdict |
|---|---|---|---|
| sweep (`bb_branch_sweep`) | branches × states | exact | **dominated** — never wins at any working-set size |
| keep the full listing | 1 per state | 895 | strictly worse for the same cost |
| narrow by `--limit` | 1 per state | 50, crowded | **the hazard**; do not build |
| **`q=` with a window** | **1 per state** | **9** | **this** |

### The crossover is ~1 and needs no slice to measure it

An earlier draft deferred *"at what working-set size a sweep beats a full listing"* to the slice. Bounded by reading: a sweep costs branches × states (`bb_branch_sweep` loops per branch per state, `bin/bb:864`); a full listing costs 1 per state; a **windowed** listing costs 1 per state with the same narrowing. **Against a windowed listing the sweep never wins at any size.** The deferred measurement was a measurement of a dominated option.

### What the store contributes, and what it cannot

The store supplies the watermark and nothing else here. `prWindowFor` already refuses a window in four cases — no store, no watermark, `complete: false`, or an age past `PR_FULL_READ_MS` — and **a store that cannot narrow must ask in full**, which is today's call exactly. This plan changes no rule in `pr-index.ts`.

### What this does NOT do

- **It does not add a store, a writer, or a cache.** One writer, as today.
- **It does not change `seedPrsFromStore`.** The render half works on every host.
- **It does not touch the GitHub arm**, which honours `--since` natively.
- **It does not read a non-terminal row as authoritative**, and a missing row still means *ask the host*, never *no PR*.
- **It does not persist a verdict.** `fleet.ts:2173` stands.

## Done when

- **A windowed Bitbucket listing goes through `q=` and returns the server's matches**, asserted against a repository with more than 50 merged PRs: the answer's `size` is the match count, not a page length.
- **`PR_LIST_SINCE` is no longer cleared for a listing, and `plot-host.sh:3755`'s report no longer fires** where the window was applied. The report stays for any path that still cannot narrow.
- **A caller that asked for a window and got a full listing still cannot read the answer as a delta.** That guard is the one thing an earlier draft got right and it must survive: advancing a watermark over a window never applied is the silent corruption here. Where the window IS applied, the watermark may advance.
- **The states travel inside `q=`, never alongside it.** `bb_pr_list_query`'s own comment (`bin/bb:440-444`) records why: *"a caller must never append `state=` alongside a `q=`: it looks like it works, and quietly discards every state."*
- GitHub's path is unchanged, asserted by a test that still exercises it.
- **#1049 becomes a smaller question and the PR says so.** That plan collapses three `state=` listings into one repeated-flag call; a `q=` window already carries its states in one expression. Whichever lands second states what remains of the other.
- **The fleet scan is explicitly out of scope.** It passes no `--since` and this plan does not change that. The PR says the fleet's benefit is an indirect budget saving, not a fix to the stall path.

## Slices

### A cold Bitbucket board buys the whole list (Branch: bug/a-cold-bitbucket-board-buys-the-whole-list)

Measure the crossover, then narrow the Bitbucket windowed listing by the path that measurement chose, preserving truncation detection and the no-false-delta guard.

## Notes

**This plan exists because a panel rejected its predecessor and the reporter supplied the missing half.** The rejected plan measured `last-pulse.json`, found no PR data, and concluded PR answers were not persisted. They are — in `.git/.plot/state/index/<connector>.json`, one file per connector per repository, resolved through `git rev-parse --git-common-dir` so a dispatch desk reads the same file as the main checkout (`pr-index-file.ts`, tested at `pr-index-file.test.ts:78`).

**The `v: 1` reading in the rejected plan was never explained and is not load-bearing here.** This checkout's store reads `v: 2`. A different repository has a different store file and its version was never measured; nothing in this plan depends on either.

**The real report came from a Bitbucket repository**, which is why the estate's own measurements missed it: every store and every timing in the rejected plan was taken against a GitHub checkout, where `--since` works and the window is honoured.

**Its sibling is #1049**, which collapses three Bitbucket listings into one. Both touch the same pagination budget from opposite directions — one reduces the number of calls, this one reduces what a call asks for — and neither should be built without reading the other.


### Round 1, 2026-09-28

One juror, **amend**, **executed**, two read-only Bitbucket calls. Moderation: `.plot/panels/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list/panel.md`.

**The premise was true of `bb pr list` and false of Bitbucket**, and the plan offered three options while omitting the one that wins. Measured: one `q=` request returned **9 rows of 895** on the repository this plan cites — cheaper than a sweep at any working-set size, same call count as the full listing, and immune to the crowding-out hazard because the narrowing is server-side by predicate.

**The mistake was inheriting a stale comment as a boundary** — `plot-host.sh:3744-3745` names `bb_branch_query` as the only `q=` path, when `bb_pr_list_query` already builds one for `--author` and Plot already calls `bb api` with a window at `:802`. That is the same failure this plan's sibling #1049 records as its own lesson, committed two hours earlier: **a recorded measurement is re-measured before it is trusted, and so is a recorded limit.**

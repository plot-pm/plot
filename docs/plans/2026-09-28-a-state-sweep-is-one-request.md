# A state sweep is one request

> `bb pr list` takes `--state` repeatedly. The adapter calls it once per state because it inferred from *there is no `all`* that there is no way to ask for several — so every `--state all` on Bitbucket costs three requests where one would do.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1049
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, jwloka, `bug/a-state-sweep-is-one-request`

## Changelog

- A Bitbucket `pr-list --state all` costs one request instead of three.

Board impact: fewer host calls per refresh on a Bitbucket estate. No payload change.

## Motivation

**The adapter measured this and was right at the time.** `plot-host.sh:1800-1805`, from `139f0255` (#210):

> `all` becomes SEPARATE CALLS, not repeated flags. `bb` 1.0.0 accepts `--state open --state merged` and **silently keeps only the last** — measured 2026-08-18: that pair returned 50 PRs, all MERGED, with the 3 open ones gone. No error, a plausible list. One call per state avoids depending on a `bb` fix.

**So this is a stale measurement, not faulty reasoning** — and the difference decides what the fix must guard. The original decision anticipated exactly the version-skew risk this plan would otherwise defer. `bb` was fixed; the adapter did not learn.

`bb 1.9.0`'s help now documents the repeatable form, and says more than the plan first claimed:

```
  --state <state>    Filter by state: open, merged, declined, superseded (default: open)
                     May be repeated to cover several states:
                       --state open --state merged
                     covers both, in one API call.
```

**One API call, stated by the tool.** Confirmed in `bb`'s source — it is a shell script, and `bin/bb:455` builds a single URL with repeated `state=` params:

```sh
for s in $states; do path="${path}${path:+&}state=${s}"; done
```

### Why it costs more than three requests' worth

**The saving is 50%, not 67%.** `plot-fleet-scan.sh:894` makes a separate `--state open --rich` call first, so a Bitbucket sweep is 1 + 3 = 4 requests today and becomes 1 + 1 = 2.

On an account near its rate limit, two extra requests per sweep is what tips a refresh into `HTTP 429`. And a burst refusal is not a local failure: `plot-fleet-scan.sh` reports `secondary`, every branch falls back to local evidence, and none is offered to `--next`. So the cost of the assumption is not latency — it is a fleet that stops dispatching.

## Design

### The rule

**`bb_states_for all` produces one call carrying three `--state` flags.**

The loop that exists to call once per state collapses to one invocation. Everything downstream — the jq program, the three call sites that differ only in it, `PR_LIST_PARTIAL_RC` — is untouched.

### The 50-row budget is SHARED, and this is what the slice must handle

**This is the defect, and it would reintroduce the 2026-08-18 failure by a different mechanism.**

`bb pr list` calls `bb_paginate "$path"` (`bin/bb:832`) with **no limit argument**, and the default is `local limit="${1:-50}"` (`bin/bb:195`).

| | requests | row budget |
|---|---|---|
| today | 3 | **50 per state**, up to 150 |
| one repeated-flag call | 1 | **50 total**, from a union sorted by `updated_on` |

On a merge-heavy repository — every mature one, and `plot-host.sh:3705` records `quatico/quaweb-website` at **902 PRs, 886 MERGED** — the 50 most recently updated are overwhelmingly merged, and **open PRs are crowded out entirely.** That is byte-for-byte what the adapter measured in 2026-08-18: *"50 PRs, all MERGED, with the 3 open ones gone. No error, a plausible list."*

**The slice must pass an explicit limit through to `bb_paginate`**, or state the truncation as an accepted trade. It must not let a diff against a small fixture certify it.

**A second loss in the same place:** `pr_list_states` runs truncation detection per state. One call means one check over a union, so the adapter can no longer say *which* state came back short — the hazard it warns about 30 lines up (`plot-host.sh:3717`): *"dropping it silently would serve a short page as if it were the whole set."*

### The partial-failure question is ANSWERED: a partial is unreachable

The loop exists so one state failing still prints the others (`PR_LIST_PARTIAL_RC=7`). **This was deferred to the slice and did not need to be** — `bb` is a shell script, and reading it settles the question with zero API calls.

`bin/bb:446-460` builds ONE url with repeated `state=` params and Bitbucket returns the union server-side. There is no client-side fan-out, so no per-state outcome can differ: one request succeeds or fails whole.

**So `PR_LIST_PARTIAL_RC` becomes unreachable on this path**, and the Bitbucket multi-state partial test (`test/reconcile/host.test.mjs:1040-1144`) must be **retired deliberately** rather than left passing against a stub that no longer models reality. The single-state test already covers the new shape. `plot-fleet-scan.sh:675` reads rc 7 directly and is unaffected — GitHub's single call could never produce it either.

### GitHub is untouched

`--state all` is native there and never reaches this arm. The fix is Bitbucket-only, and the comment that says GitHub *"can never reach this shape"* stays true.

### What this does NOT do

- **It does not change `bb_states_for`'s vocabulary.** Three states in, three states asked for.
- **It does not remove `PR_LIST_PARTIAL_RC`.** The code stays for GitHub and single-state calls; only the Bitbucket multi-state path stops producing it.

### The capability is PROBED, never version-compared

**Two products share the name `bb`,** and `plot-host.sh:1896` records why that settles the method:

> `TWO TOOLS SHARE THE NAME bb.` craftamap/bb is a Go binary that does NOT support `--json` … craftamap 0.6.0 is not "older than" Quatico 1.0.0 — they are unrelated.

So *"an older `bb` may not have it"* is the wrong frame: it may be a **different `bb`**. The precedent is `bb_require_json` / `bb_identify` (`:1923-2021`), which probe behaviourally through `--help` and cache the answer as `BB_CAP_*`. `bb_require_json` already runs on this exact path (`:3727`), so the probe point exists.

**Detect, following that precedent.** This is decided here rather than left to the slice.
- **It does not touch the three call sites**, which differ only in their jq program.
- **It does not change GitHub's path.**

## Done when

- A Bitbucket `pr-list --state all` makes **one** `bb` invocation, asserted by counting calls against a stub — not by timing.
- **The payload is identical to today's three-call result on a fixture of MORE THAN 50 PRs, merge-heavy.** A diff against a small repository passes whatever the limit does, and the cap is the only regime where this can fail.
- **An explicit limit reaches `bb_paginate`, or the truncation is recorded as an accepted trade.** One call shares one 50-row budget where three calls had 50 each.
- **The capability is probed through `--help` and cached**, following `bb_require_json` / `bb_identify` (`plot-host.sh:1923-2021`). Never a version comparison: two products share the name `bb`.
- The Bitbucket multi-state partial test (`test/reconcile/host.test.mjs:1040-1144`) is **retired deliberately**, with the reason recorded — a partial is unreachable once the call is one request.
- GitHub's `--state all` path is unchanged, asserted by a test that still exercises it.
- `bb --version` is recorded in the PR alongside the probe's answer.

## Slices

### A state sweep is one request (Branch: bug/a-state-sweep-is-one-request)

Collapse the per-state loop to one repeated-flag call, answer the partial-failure question, and assert the call count against a stub.

## Notes

**Re-measure a recorded measurement before trusting it.** This plan first diagnosed the adapter as reasoning from a true premise to a false conclusion. That was wrong: `plot-host.sh:1800-1805` records a **measurement** taken 2026-08-18 against `bb` 1.0.0, which silently kept only the last `--state` — 50 PRs, all MERGED, the 3 open ones gone. The adapter deliberately chose not to depend on a `bb` fix. The fix came; nobody revisited the measurement.

**That is a more useful lesson than the one first written here**, and it is the opposite of *check the help before inferring*: the code did check, and its answer expired.

### Round 1, 2026-09-28

One juror, **amend**, **executed**, zero Bitbucket API calls. Moderation: `.plot/panels/2026-09-28-a-state-sweep-is-one-request/panel.md`.

The premise holds and the tool states it more strongly than this plan first claimed — *"in one API call"*. The deferred partial-failure question is **answered**: `bb` is a shell script, `bin/bb:446-460` builds one URL with repeated `state=` and Bitbucket returns the union, so no partial is reachable.

**The defect the juror found is the shared 50-row budget**, and it would have reintroduced the 2026-08-18 failure by a different mechanism — invisible to this plan's original `Done when`, which any fixture under the cap would pass.

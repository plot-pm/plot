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

- A Bitbucket `pr-list` asks one page of 50 per state, so `--state all` costs 3 requests where it cost 8 on `quatico/quaweb-website`, with the same rows.

Board impact: fewer host requests per refresh on a Bitbucket estate. No payload change. `PR_REQUESTS_PER_REFRESH.bitbucket` stays 4 (3 listings + `issue-list`), which is now the real request count.

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

**Amended 2026-09-30, jwloka: one request per state at `pagelen=50`.** The rule approved on 2026-09-29 read *"`bb_states_for all` produces one call carrying three `--state` flags."* The measurement below refutes it, and the rule changes rather than the page budget.

`bb_state_listing` asks `bb api /repositories/{ws}/{repo}/pullrequests?state=<S>&pagelen=50` once per state. `bb_states_for all` still expands to three states, and `pr_list_states` still loops over them. The jq programs, the three call sites that differ only in them, `PR_LIST_PARTIAL_RC` and the truncation report are untouched. The sweep (`--branch`) and the window (`--since`) paths keep their own commands.

### The measurement that changed the rule

`bb pr list` sends no `pagelen`, so Bitbucket answers 10 rows a page and `bb_paginate` walks pages until it holds 50. A `bb` invocation is therefore not one request. Measured 2026-09-29 on `quatico/quaweb-website` with `bb` 1.9.0 (Quatico's script):

| listing | bb invocations | HTTP requests | rows returned |
|---|---|---|---|
| per state through `bb pr list` (before) | 3 | 8 (merged 5, declined 2, open 1) | 67 = 3 open + 50 merged + 14 declined |
| one `bb pr list --state open --state merged --state declined` | 1 | 5 | 50 = 3 open + 45 merged + 2 declined |
| `bb api` union, `pagelen=50`, walking `next` until every row is present | 1 script call | up to 19 (`size` = 912) | 67 |
| **per state through `bb api …?state=<S>&pagelen=50` (shipped)** | 3 | **3** | **67** |

The one-call union loses 17 of 67 rows, 12 of 14 declined PRs among them, and keeps its 3 open PRs only because all 3 were updated after 2026-09-17. That is the 2026-08-18 failure reached through the shared 50-row budget. The exact union costs more requests than the loop it replaces. Asking `pagelen=50` per state keeps every row and cuts 8 requests to 3, re-measured 2026-09-30.

### What this does NOT do

- **It does not collapse the states.** Three states in, three requests out.
- **It does not probe `bb` for the repeatable `--state`.** No path depends on it.
- **It does not remove `PR_LIST_PARTIAL_RC`.** One state can still fail while the others answer, and the partial-answer test stays.
- **It does not change `bb pr list`.** The change is in Plot's adapter, not in Quatico's `bb`.
- **It does not touch the sweep, the window, `pr-state`'s own loop, or GitHub's path.**

## Done when

- A Bitbucket `pr-list --state all` with no branch and no window makes **three** `bb api` requests, one per state, each carrying exactly one `state=` and `pagelen=50`, asserted by counting calls against a stub.
- **On a fixture of more than 50 PRs, merge-heavy** (60 merged, 3 open and 2 declined older than the 50th merged), the payload holds all 3 open, both declined and 50 merged rows, against a stub that models Bitbucket's paging and would crowd a union out.
- A full merged page is still reported as possibly truncated, naming `state=merged`.
- The partial-answer test and the single-state failure tests pass unedited.
- `--state all --branch x` still makes one query per state per branch.
- GitHub's `--state all` path is unchanged, asserted by a test that still exercises it.
- `bb --version` and the request counts are recorded in the PR.

## Slices

### A state sweep is one request (Branch: bug/a-state-sweep-is-one-request)

Ask each state one page of 50 through `bb api`, and assert the request count and the merge-heavy payload against a stub.

## Notes

**Re-measure a recorded measurement before trusting it.** This plan first diagnosed the adapter as reasoning from a true premise to a false conclusion. That was wrong: `plot-host.sh:1800-1805` records a **measurement** taken 2026-08-18 against `bb` 1.0.0, which silently kept only the last `--state` — 50 PRs, all MERGED, the 3 open ones gone. The adapter deliberately chose not to depend on a `bb` fix. The fix came; nobody revisited the measurement.

**That is a more useful lesson than the one first written here**, and it is the opposite of *check the help before inferring*: the code did check, and its answer expired.

### Round 1, 2026-09-28

One juror, **amend**, **executed**, zero Bitbucket API calls. Moderation: `.plot/panels/2026-09-28-a-state-sweep-is-one-request/panel.md`.

The premise holds and the tool states it more strongly than this plan first claimed — *"in one API call"*. The deferred partial-failure question is **answered**: `bb` is a shell script, `bin/bb:446-460` builds one URL with repeated `state=` and Bitbucket returns the union, so no partial is reachable.

**The defect the juror found is the shared 50-row budget**, and it would have reintroduced the 2026-08-18 failure by a different mechanism — invisible to this plan's original `Done when`, which any fixture under the cap would pass.

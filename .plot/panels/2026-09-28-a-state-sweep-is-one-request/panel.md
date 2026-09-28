# Panel — a state sweep is one request (#1049)

Subject: `docs/plans/2026-09-28-a-state-sweep-is-one-request.md`
Round 1, 2026-09-28. One juror, both commitments gated. **Zero Bitbucket API calls made.**

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

## The premise holds, and the tool says it louder than the plan did

`bb 1.9.0 --help` documents the repeated form as covering several states **"in one API call"** — stronger than the plan quoted. Confirmed in source: `bb` is a shell script and `bin/bb:455` builds a single URL with repeated `state=` params.

## The plan's diagnosis of the existing code was wrong, and the correction is the more useful lesson

The plan's Notes said *"the adapter's comment reasons carefully from a true premise to a false conclusion, and `bb pr list --help` refutes it in one line."*

`plot-host.sh:1800-1805` is a **measurement**, not an inference — from `139f0255` (#210), verified by the moderator:

> `bb` 1.0.0 accepts `--state open --state merged` and **silently keeps only the last** — measured 2026-08-18: that pair returned 50 PRs, all MERGED, with the 3 open ones gone. No error, a plausible list. One call per state avoids depending on a `bb` fix.

The adapter checked, was right, and deliberately chose not to depend on a future fix. **This is a stale measurement nobody revisited**, which is a different defect class from faulty reasoning — and it matters, because the original decision already anticipated the version-skew risk the plan was deferring.

## THE DEFECT — the 50-row budget is shared

The finding, and the plan contained nothing about it. Verified by the moderator:

- `bb pr list` calls `bb_paginate "$path"` (`bin/bb:832`) with **no limit argument**
- the default is `local limit="${1:-50}"` (`bin/bb:195`)

| | requests | row budget |
|---|---|---|
| today | 3 | **50 per state**, up to 150 |
| after | 1 | **50 total**, union sorted by `updated_on` |

On a merge-heavy repository — `plot-host.sh:3705` records `quatico/quaweb-website` at 902 PRs, 886 MERGED — the 50 most recently updated are overwhelmingly merged and **open PRs are crowded out entirely.**

That is byte-for-byte the 2026-08-18 failure, reintroduced by a different mechanism: not a `bb` bug, a shared pagination budget.

**The plan's own `Done when` could not catch it.** *"The payload is identical to today's three-call result, asserted by diffing the output"* passes against any stub or any repository under 50 PRs — and the divergence only exists above the cap, which is where the plan's own cited motivation lives.

**A second loss in the same place:** per-state truncation detection becomes one check over a union, so the adapter can no longer say which state came back short — the hazard it warns about at `:3717`.

## The deferred question is answered, and did not need deferring

*"The slice must confirm this rather than assume it."* `bb` is a shell script; `bin/bb:446-460` builds one URL and Bitbucket returns the union server-side. **No client-side fan-out means no partial is reachable** — one request succeeds or fails whole.

Cost: zero API calls, a few minutes of reading. **Third plan this week to defer a question answerable from a file already on disk**, and the third time the deferral hid something.

## Checks that came back clean

- **Three call sites differ only in jq** (`:3774`, `:3800`, `:3806`) — true as the plan claims.
- **`PR_LIST_PARTIAL_RC=7` is well tested** (`host.test.mjs:1040-1144`, four tests). They keep passing with the loop gone, but the Bitbucket multi-state case becomes unreachable and must be retired deliberately rather than left green against a stub that no longer models reality.
- **The cost claim is real and traced**, not inferred: `plot-fleet-scan.sh:895` makes the call, `pr_list_verdict` maps the rc, `:894` returns early on anything but `ok|partial`, branches fall back to local evidence and are not offered to `--next`. `fleet.ts:2861` issues the same call on the board's timer.
- **The saving is 50%, not 67%** — `:894` makes a separate `--state open --rich` call first, so 4 requests become 2.

## The version question is settled here, not deferred

`plot-host.sh:1896`: *"TWO TOOLS SHARE THE NAME bb. craftamap/bb is a Go binary that does NOT support `--json` … craftamap 0.6.0 is not 'older than' Quatico 1.0.0 — they are unrelated."*

So *"an older `bb`"* is the wrong frame: it may be a **different `bb`**. The precedent is `bb_require_json` / `bb_identify` (`:1923-2021`) — probe `--help` behaviourally, cache as `BB_CAP_*` — and it already runs on this path at `:3727`. **Detect. Decided in the plan.**

## Amendments folded in

1. Notes corrected: stale measurement, not faulty reasoning.
2. The shared 50-row budget stated, with the requirement to pass an explicit limit or record the trade.
3. `Done when` strengthened to a >50-PR merge-heavy fixture — the only regime where it can fail.
4. The partial question answered in the plan, with the multi-state test retired deliberately.
5. Capability probing decided, with its precedent named.
6. Cost corrected to 50%.

# A state sweep is one request

> `bb pr list` takes `--state` repeatedly. The adapter calls it once per state because it inferred from *there is no `all`* that there is no way to ask for several — so every `--state all` on Bitbucket costs three requests where one would do.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1049
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A Bitbucket `pr-list --state all` costs one request instead of three.

Board impact: fewer host calls per refresh on a Bitbucket estate. No payload change.

## Motivation

`plot-host.sh:609-612` states the assumption:

> **THE BITBUCKET ASYMMETRY THIS EXISTS FOR.** `bb pr list` has no `all` state, so `bb_states_for all` expands to three and the arm must call `bb` once per state.

The first clause is true. The second does not follow, and `bb`'s own help says so — measured against `bb 1.9.0`:

```
--state <state>    Filter by state: open, merged, declined, superseded (default: open)
                     --state open --state merged
```

**The repeatable form is the documented usage example.** There is no `all`, and there is a way to ask for several — the adapter conflated the two.

### Why it costs more than three requests' worth

On an account near its rate limit, two extra requests per sweep is what tips a refresh into `HTTP 429`. And a burst refusal is not a local failure: `plot-fleet-scan.sh` reports `secondary`, every branch falls back to local evidence, and none is offered to `--next`. So the cost of the assumption is not latency — it is a fleet that stops dispatching.

## Design

### The rule

**`bb_states_for all` produces one call carrying three `--state` flags.**

The loop that exists to call once per state collapses to one invocation. Everything downstream — the jq program, the three call sites that differ only in it, `PR_LIST_PARTIAL_RC` — is untouched.

### What the partial-failure path means afterwards

This is the part worth thinking about before building. The per-state loop exists so that **one state failing still prints the others** (`PR_LIST_PARTIAL_RC=7`, *"collecting across states means the first failure can no longer end the run"*). One request has no partial: it succeeds or it does not.

**That is a trade, and the plan takes it deliberately.** The partial path protects against one state erroring while others answer — which for a single endpoint with a repeated filter is not a shape the API produces. What actually fails is the whole request, on rate limit or transport, and that already ends the run today.

**The slice must confirm this rather than assume it**, because the assumption-without-checking is exactly what this plan is fixing. If `bb` can return a partial answer across repeated `--state` flags, the loop stays and only the request count changes.

### GitHub is untouched

`--state all` is native there and never reaches this arm. The fix is Bitbucket-only, and the comment that says GitHub *"can never reach this shape"* stays true.

### What this does NOT do

- **It does not change `bb_states_for`'s vocabulary.** Three states in, three states asked for.
- **It does not remove `PR_LIST_PARTIAL_RC`** unless the slice proves no partial is reachable; the exit code is cheap to keep.
- **It does not touch the three call sites**, which differ only in their jq program.
- **It does not change GitHub's path.**

## Done when

- A Bitbucket `pr-list --state all` makes **one** `bb` invocation, asserted by counting calls against a stub — not by timing.
- The payload is identical to today's three-call result for the same repository, asserted by diffing the output.
- **The partial-failure question is answered in the PR**: either a partial is unreachable and the loop goes, or it is reachable and the loop stays with a lower request count.
- GitHub's `--state all` path is unchanged, asserted by a test that still exercises it.
- `bb --version` is recorded in the PR: the repeatable flag is a property of the CLI, and an older `bb` may not have it.

## Slices

### A state sweep is one request (Branch: bug/a-state-sweep-is-one-request)

Collapse the per-state loop to one repeated-flag call, answer the partial-failure question, and assert the call count against a stub.

## Notes

**Check what the tool says before inferring what it cannot do.** The adapter's comment reasons carefully from a true premise to a false conclusion, and `bb pr list --help` refutes it in one line. This is the third defect this week of that exact shape.

**The version caveat is real.** `bb 1.9.0` documents the repeated form; an adopting repo on an older client may not have it. The slice should decide whether to detect or to require, and say which.

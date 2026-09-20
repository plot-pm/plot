# A PR list costs one round trip

> `bb` has no `--state all`, so a Bitbucket PR refresh makes three sequential host calls and pays 47 seconds of wall clock for a list the board refreshes on a timer.

## Status

- **State:** Draft
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A Bitbucket `pr-list --state all` asks its three states concurrently rather than one after another, cutting a measured 47 seconds to the slowest single state.

<!-- Board impact: the board's PR refresh returns sooner. No plan format, no
     template, no layout. -->

## Design

Measured 2026-09-20 on `quaweb-website`, a live Bitbucket repository:

| state | rows | wall clock |
|---|---|---|
| `open` | 3 | **5.4 s** |
| `merged` | 50 | **23.0 s** |
| `declined` | 13 | **15.1 s** |
| `--state all` (sequential) | 66 | **47 s** |

`bb pr list` has no `all` state, so `bb_states_for all` expands to three and
`pr_list_states` loops them **one after another**. The total is the sum plus
overhead, and the board pays it on every PR refresh.

**The GitHub arm pays one round trip** — `gh` takes `--state all` in a single
call — so this cost exists on exactly one backend.

### Concurrency is available and the loop does not use it

The three calls are independent: each asks a different state, none reads the
others' output, and `pr_list_states` already collects results per state before
classifying. Running them concurrently and collecting as they return would cost
the **slowest** state rather than the sum — 23 s rather than 47 s on this
repository, measured.

### What must not change

**The partial classification.** `pr_list_states` counts `_ok` and `_failed` and
returns `PR_LIST_PARTIAL_RC` when some answered — the rule
`one-exit-code-one-answer` just wired through to the host port. Concurrency must
feed the same counters; a rewrite that loses the partial verdict trades a
latency fix for a correctness regression.

**Output order is not a contract, and that must be stated rather than assumed.**
Sequential execution emits `open`, then `merged`, then `declined`. Concurrent
collection may interleave. Every consumer parses line-delimited JSON and joins
by branch, so order is irrelevant — but a test should pin that it is, because
nothing says so today.

**The truncation warnings stay per state.** Three states produce three warnings
on this repository, each naming which state was capped. Collapsing them into one
would lose the name.

### What this is NOT

**Not a fix for the board's PR data.** The board still shows zero rows carrying
a PR after a restart onto current code — see Notes. This plan makes the call
cheaper; it does not explain that.

**Not pagination.** `merged` returns exactly 50 because `bb` caps the page, so
this repository's merged list is already truncated. That is
[#333](https://github.com/plot-pm/plot/issues/333) and its own plan.

## Slices

### The three states are asked at once (Branch: infra/the-three-states-are-asked-at-once)

- `infra/the-three-states-are-asked-at-once` — `pr_list_states` runs its state calls concurrently and collects them, keeping the partial classification intact

**Done when** a Bitbucket `pr-list --state all` costs about the slowest single
state rather than their sum, measured before and after on a repository with
three non-empty states and both numbers stated; the partial classification is
unchanged — some states answering still exits `PR_LIST_PARTIAL_RC`, none
answering still exits its own kind — pinned by the existing tests at
`test/reconcile/host.test.mjs:1038` and `:1081` **without editing them**, since
they already pin exactly this and a passing unchanged test is the evidence;
every row that the sequential form emitted is still emitted, pinned by
comparing sorted output; a test pins that **consumers do not depend on state
order**; each capped state still produces its own truncation warning naming it;
the GitHub arm is untouched, pinned; and `pnpm run test:contracts` passes.

## Notes

**The board's own defect is unexplained and is not this plan.** Measured the
same day: the live board was restarted onto current code — process start
18:40:47 against a bundle written 13:51 — and still reported `prAgeSeconds:
null` with `prError` set and **0 of 5 rows carrying a PR**, while the identical
command by hand exits 0 with 66 rows. A staleness explanation was offered by a
juror on the previous plan and **the restart refuted it**.

Eight hypotheses have now been refuted for that symptom. It needs a different
approach from the outside-in probing tried so far — most likely a board built
from source with logging on the failure path, rather than another guess.

**47 s is this repository at this moment.** The three states were also measured
at 16 s, 22 s and 25 s earlier the same afternoon for the whole call, so the
host's latency varies by a factor of three. The *shape* — sum versus max — does
not vary, which is why the slice's Done-when compares the two forms in one
session rather than against a recorded number.

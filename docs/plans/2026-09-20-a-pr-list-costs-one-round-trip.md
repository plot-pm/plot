# A PR list costs one round trip

> `bb` has no `--state all`, so a Bitbucket PR refresh makes three sequential host calls and pays 47 seconds of wall clock for a list the board refreshes on a timer.

## Status

- **State:** Rejected
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Rejected:** 2026-09-20, jwloka, the cadence already absorbs the cost and nothing waits on the call

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

The three calls are independent: each asks a different state and none reads the
others' output. Running them concurrently would cost the **slowest** state
rather than the sum — 23 s rather than 47 s on this repository, measured.

**`pr_list_states` STREAMS per state; it does not collect.** `:628` pipes each
state's rows to stdout as that state returns. An earlier draft of this plan said
it collects, and the difference is the whole design constraint below.

### Three orderings must be preserved, and none is free

**1. The first stderr line is a shipped contract.**
`plot-reconcile-scan.sh:475` reads `head -1` of the call's stderr and classifies
`PR_SOURCE` from it. `host.test.mjs:1075` pins that the host's own sentence is
first — and its comment records the estate being bitten **in this exact
function** on 2026-09-18: *"an earlier draft printed `state 'open' failed` ahead
of the host's sentence, and `plot-reconcile-scan.sh` … showed that instead of
`HTTP 429`."*

Under concurrency the first line is whichever state returns first. The measured
timings make that `open` at 5.4 s, while a failure in `merged` arrives ~18 s
later — so the failing state's sentence is **last**, and the pinned test fails.
An earlier draft of this plan claimed those tests would pass **unedited**. They
cannot.

**So each state's stderr is buffered and replayed in state order after the
joins.** The spool already exists — `:601` and `:607` write per-state `_tmp`
files — and this plan makes replaying from them a requirement rather than an
option.

**2. Stdout rows must not tear.** Three children streaming multi-line `--rich`
JSON to one fd can interleave mid-line, and `fleet.ts:2502` calls `JSON.parse`
per line with no guard. Rows are therefore buffered per state and emitted whole.

**3. `withHostSlot` counts one slot as one in-flight request**
(`concurrency.ts:114`). Three concurrent `bb` calls make it three on Bitbucket
without telling the gate, so the slice either holds the slot for all three or
says why the gate's count may triple.

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
three non-empty states and both numbers stated; **each state's stderr is
buffered and replayed in state order**, so the host's own sentence stays the
first line and `test/reconcile/host.test.mjs:1038` and `:1081` pass **unedited**
— they are the evidence, and a run that needs them edited has broken
`plot-reconcile-scan.sh:475`'s `head -1` contract; **each state's stdout rows
are buffered and emitted whole**, pinned by a test that no line is torn, since
`fleet.ts:2502` parses per line with no guard; the partial classification is
unchanged — some states answering still exits `PR_LIST_PARTIAL_RC`, none
answering still exits its own kind; every row the sequential form emitted is
still emitted, pinned by comparing sorted output; the slice **states what three
concurrent calls do to `withHostSlot`** (`concurrency.ts:114` counts one slot as
one in-flight request) and either holds the slot across all three or argues why
tripling the gate's count is acceptable; **no new secondary-rate-limit refusal
appears** on the measured repository, checked by running the concurrent form
repeatedly and asserting no exit 6; each capped state still produces its own
truncation warning naming it; the GitHub arm is untouched, pinned; and
`pnpm run test:contracts` passes.

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

**Amended 2026-09-20 after a two-lens panel** (`.plot/panels/2026-09-20-a-pr-list-costs-one-round-trip/`).
The consumer lens found four blocking gaps, all about orderings the sequential
form gave for free: the first stderr line is read by a shipped consumer, stdout
rows can tear, `withHostSlot` miscounts, and the plan described the loop as
collecting when it streams.

**Land this before `a-capped-page-says-what-it-hid`'s successor if both ship.**
That plan removes stderr lines, which would make this plan's ordering race
*less* often observed — turning a deterministic test failure into an
intermittent one. It is an ordering preference rather than a dependency, so
neither branch carries a `waits:` annotation.

**47 s is this repository at this moment.** The three states were also measured
at 16 s, 22 s and 25 s earlier the same afternoon for the whole call, so the
host's latency varies by a factor of three. The *shape* — sum versus max — does
not vary, which is why the slice's Done-when compares the two forms in one
session rather than against a recorded number.

## Why this was rejected

**Two lenses: one `amend`, one `reject`. The reject holds, and its first finding
is sufficient on its own.** Record in
`.plot/panels/2026-09-20-a-pr-list-costs-one-round-trip/`.

### Nobody waits on this call

The plan's motivation was *"a list the board refreshes on a timer … the board
pays it on every PR refresh."* True of a naive timer; the board's is not naive.
`fleet.ts:184` declares `bitbucket: 4` requests per refresh and `:165` records
the rule:

> GitHub 1 request → refresh every 60 s; **Bitbucket 4 requests → refresh every
> 240 s** — the hourly spend stays 60 on both hosts.

Measured on the live board the same day: **`prNextInSeconds: 797`**. A 47 s call
occupies under 6% of its own window, the next refresh is not waiting on it, and
the operator reads the last completed pulse rather than the in-flight one.

**No reader was ever identified who is blocked for 47 s.** The plan optimises a
latency nobody experiences while explicitly disclaiming the defect somebody
noticed — *"Not a fix for the board's PR data"* — which remains 0 of 5 rows
carrying a PR after eight refuted hypotheses.

The comment beside the cost even warns against the shape: *"Do not 'fix' the
three by inventing an `all` — it would fabricate an answer the host cannot
give."*

### And the fix would cost more than it saves

Four further findings, each measured, any one of which would have needed its own
slice:

- **Concurrency raises the risk `die6` exists to report.** `plot-host.sh:365`
  says a secondary limit's reaction is *"retry shortly and **lower
  concurrency**"*; this plan raises it on the one backend that reaches that path.
  `fleet.ts:171` records a Bitbucket board hitting `HTTP 429` **account-wide,
  with every `bb` call from the operator's own shell failing too**.
- **Nothing throttles it today.** `host_concurrency_bound` needs a basis of
  `actual` or `predicted`; Bitbucket measures `basis: unknown`, so the slot is
  never taken and three calls go straight out.
- **Backgrounding corrupts the slot guard.** `plot-budget.sh:426` releases on
  `[ "$pid" = "$$" ]`, and three subshells share one `$$` — demonstrated, a
  child released a **live** sibling's slot, the *"cap exceeded by one"* the
  comment forbids. Fixing it means `$BASHPID` throughout the shared budget
  substrate, affecting `gh` and `jen` equally.
- **Stdout tears and stderr reorders.** Both were amended into this plan before
  the reject and both remain true: `fleet.ts:2502` parses per line with no
  guard, and `plot-reconcile-scan.sh:475` reads `head -1` of stderr — a contract
  the estate was bitten by in this same function on 2026-09-18.

### What survives

**The measurement.** `open` 5.4 s, `merged` 23.0 s, `declined` 15.1 s, whole
call 47 s, and GitHub pays none of it. If a caller ever appears that *does* wait
on this list, the numbers are here and the four obstacles are named.

**Nothing was implemented.** No branch, no PR, no `Started:` record.

---
"@plot-pm/board": patch
---

plot-fleet: a squash-merged branch is merged, not open

Squash-merge a branch and delete it, and the fleet reported it as `open` — the
same word it uses for work nobody has started. Two individually reasonable
facts combined into a wrong answer.

A branch's state comes from its ref, and `--delete-branch` removes it. And
`pr-merge` detection walks merge commits, which a squash merge never produces.
Measured on the merge of PR #209:

```
$ git log -1 --format="%h parents=%p %s" a263711
a263711 parents=c3b2dda plot: board verification ... (#209)
```

One parent, and a subject naming `#209` rather than the branch. The exhaustive
merge-commit walk has nothing to match.

**It was live in two shapes.** `2026-08-18-plot-board-setup` had both wave-1
branches merged (#208, #209) and still read `Scripts — eligible` with `Skill`
blocked — and a wave that cannot complete blocks its successor permanently, so
the fan-out `/plot-dispatch` exists to perform could not get past wave 1 under
this repo's own merge convention. Separately, the board advertised delivered
work as available: `bb-state-vocabulary` sat under NOT STARTED, "eligible —
nobody has taken it", while its plan read `Phase: Delivered` and PR #210 was
`MERGED`. "No ref" defaulted to *start this* rather than *cannot tell*, which
is the reassuring direction and therefore the worst one.

The data was never missing — only not local. When a branch has **no ref**,
there is nothing left to read locally, so the host is asked: one call per
absent branch, not per branch, and none at all where refs exist.

| `pr-state` says | Branch reads |
|---|---|
| `MERGED` | `merged` — the wave can complete |
| `OPEN` / `CLOSED` | its existing meaning |
| `NONE`, or the call fails | `open`, exactly as before |

**The last row is load-bearing.** `plot-host.sh` already separates a lookup
miss (exit 0, state `NONE`) from a transport failure (non-zero) — the
distinction it grew on 2026-08-17, when GitHub returned 503 all afternoon and
every branch read as having no PR. Only an explicit `MERGED` may move a branch
off `open`, because `merged` settles a wave and opens the next one; an
unreachable host that manufactured a `merged` would open a wave onto a seam
that never landed. A test asserts that failure direction, not merely the happy
path.

The lookup is placed inside the no-ref arm, which is what keeps the reused-name
case correct: merge `feature/retry`, delete it, recreate it for a second
attempt, and the host still answers `MERGED` about the *first* attempt. A
recreated branch has a ref, so it never reaches the lookup — pinned by its own
test.

**Cost, under a 5-second board poll.** Gated once per run on both a real
backend and `--offline`/`--no-fetch`, so the ambient pulse the board relies on
still makes no host calls whatsoever. Answers are cached per branch for the
length of one scan — on disk rather than in a variable, because `branch_state`
runs inside a command substitution and a subshell's assignments are discarded
the moment it closes. The cache directory is created per run and removed on a
trapped exit, so no answer outlives the scan that fetched it: a stale `merged`
read from a previous run is exactly the fabricated verdict the failure
direction forbids. A test asserts the call count — one for the absent branch,
none for the branch whose ref is still there.

**One number the plan did not have, and it belongs in the open.** The board
refreshes every 5 s without `--offline`, so it takes the host path: 720 scans
an hour. The within-run cache bounds a scan to ONE call per absent branch, but
across runs the arithmetic is 720 x (absent branches) — ~720 calls/hour for a
single squash-merged branch, ~3600 for five. `gh pr view --json` is GraphQL, so
these draw on the same 5000/hour budget this board exhausted on 2026-08-16.

Measured worst case: 20 absent branches against a host that fails every lookup
costs 4.1 s per scan versus 1.2 s offline — about 150 ms per absent branch. The
board's refresh is off the request path, guarded against overlap, and capped at
30 s, so nothing stalls; the cost is quota, not latency.

That is bounded by the count of absent branches in ACTIVE plans, which is small
in practice and shrinks as plans are delivered. It is left as measured rather
than pre-optimised — the plan's own fallback, matching the PR number in the
squash subject, is the offline answer worth reaching for if this proves too
expensive, and it should be chosen against real numbers rather than this
estimate.

The cache key is injective rather than a plain slash-to-underscore mapping:
`feature/a_b/c` and `feature/a/b_c` are both legal refs that collapse to one
key under the naive form, and the branch asked second would inherit the first's
answer. A `merged` arriving that way settles a wave on a branch nobody looked
at — the same fabricated verdict, reached through the cache instead of the
host. Pinned by a test that fails against the naive mapping.

<!--
bumps:
  skills:
    plot-fleet: minor
-->

`plot-fleet` minor: the scan gains a source it did not have, and the skill's
`merge_detect` table documented `open` under a squash/rebase repo as saying
nothing about whether work merged — now true only when the host cannot be
asked. Behaviour and documentation both changed; nothing was removed.

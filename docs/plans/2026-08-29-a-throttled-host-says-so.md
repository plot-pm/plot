# A throttled host says so

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, branch -->
- **Delivered:** 2026-08-31
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `bug/the-scan-says-it-could-not-ask`
- **Started:** 2026-08-31, Jan Wloka, `bug/the-board-shows-a-throttled-host`

## Approval

- **Assignee:** Jan Wloka

## Changelog

A fleet scan that could not reach the git host says so, instead of reporting
every branch as unmerged and looking like a quiet estate.

## Motivation

### Measured 2026-08-29, on a merged PR

`#513` was merged. Minutes later the scan reported:

```
  Reading — eligible
      infra/the-domain-names-a-slice — open      ← merged, and the ref is deleted
summary: … eligible=1 blocked=2 … merge_detect=pr-merge
```

**Nothing in that output is a warning.** `merge_detect=pr-merge` reads as *the
host was asked and answered*; the branch reads `open`; the summary counts it
among the unfinished. The truth was that `plot-host.sh pr-list` had returned

```
GraphQL: API rate limit already exceeded for user ID 870334.
```

and the scan swallowed it.

### The reaper says the same thing, and there it is a claim about WORK

**Measured 2026-08-29, minutes after #515 merged.** A dry run offered four
worktrees:

```
would   feature/the-domain-package-exists       PR merged (squash)
would   feature/the-entities-carry-their-states PR merged (squash)
would   infra/the-domain-names-a-slice          PR merged (squash)
```

The real run, seconds later, reported instead:

```
keep    feature/the-domain-package-exists       unlanded work — no merged PR
keep    feature/the-entities-carry-their-states unlanded work — no merged PR
keep    infra/the-domain-names-a-slice          unlanded work — no merged PR
```

**All three were merged**, confirmed by REST in the same minute (#509, #515,
#513 — `merged_at` non-null). GraphQL had run out between the two calls, so
`plot-pr-merged.sh` answered *not merged* and the reaper kept the trees.

**The direction is right and the words are wrong.** *"unlanded work"* is a claim
about the branch's CONTENT; what actually happened is that a question went
unanswered. A reader chasing that line looks for commits that do not exist.

**And this is the surface where the silence is most dangerous.** The scan's
version costs a stalled fleet; the reaper's version guards a decision to
**delete a checkout**. It degraded safely today — but a reader who trusts
*"unlanded work"* over *"could not ask"* draws the opposite conclusion about
what is safe to do next.

### The degradation is right; the silence is not

**The scan's direction is correct and must not change.** `plot-pr-merged.sh`
states the rule: *"An unreachable host answers not merged, so silence is never
permission."* A scan that guessed `merged` from a failed call would settle waves
on work that never landed.

**What is missing is the report.** The estate has a name for this shape — a
signal computed and consumed by nobody — and W36 was written about it. Here the
signal is not even computed: the failure is discarded at the call site.

### Why it bites harder than a one-off wrong row

`pr-list` is **one GraphQL call in place of ~186 REST calls**
(`plot-host.sh:363`), a deliberate and good trade. Its consequence is that
GraphQL throttling takes out **every** PR answer at once rather than degrading
row by row. So the whole fleet reads unmerged, every wave stays blocked, and the
board shows a busy estate with nothing eligible — indistinguishable from work
genuinely in flight.

**And REST is a separate bucket.** Measured the same afternoon: `gh api
repos/…/pulls/513` answered `merged=true` while GraphQL was refusing. The data
was reachable; only the path being used was not.

## Design

### The scan reports what it could not ask

`plot-host.sh` already has the vocabulary — exit 4 for *cannot be asked* — and
`PortResult<T>`'s third outcome (`unaskable`) is the domain's name for it. This
plan does not invent a mechanism; it connects one that exists to an output that
does not carry it.

Three surfaces, in order of how much they mislead today:

1. **The scan's summary line** gains `host=ok|throttled|failed`. A reader who
   sees `host=throttled` knows the merge answers are unreliable without reading
   further.
2. **Each affected row** says the answer is unknown rather than `open`. `open`
   is a claim about a PR; when no PR could be read, the honest word is different.
3. **The board** renders the degradation. It already renders `prError`; this is
   the same shape one level up.

### Not chosen: fall back to REST automatically

Tempting — the data *was* reachable. Rejected as this plan's content because it
turns a reporting fix into a second host path with its own pagination,
truncation and cost profile, and `pr-list`'s whole design is the batched call.
**A fallback is a plan of its own**, and it needs the reporting first: without
it, a silent fallback is just a slower silence.

### Not chosen: retry with backoff

Same objection, plus it hides duration. A scan that takes four minutes because
it is waiting out a limit looks like a slow scan, and the board's 90 s budget
would kill it mid-answer.

## Waves

**Challenged 2026-08-30, and the plan gets smaller: the convention already
exists, on the wrong path.**

`plot-host.sh:1484` states it in full — for `issue-list`:

> **THREE OUTCOMES, KEPT APART.** An empty list means the host answered and there
> are none; a non-zero exit with empty stdout means the question failed; exit 4
> means this host cannot be asked at all. Collapsing any two of them reproduces
> `an-outage-is-not-an-answer` — a board that says "no issues" because it could
> not reach the tracker is stating a fact it does not have.

**`pr-list` collapses exactly those two.** The call is unchecked:

```sh
_gh_raw="$(gh pr list --state "$state" … --json number,title,…)"
pr_list_report_truncation github "$limit" "$state" …
printf '%s' "$_gh_raw" | jq -c …
```

The script runs under `set -uo pipefail` — **no `-e`** — so a failed `gh`
continues with `_gh_raw` empty, `jq` emits nothing, and the caller receives an
empty list. Reproduced 2026-08-30 against a nonexistent repo: `exit=1`, stdout
empty. Indistinguishable from *there are no PRs*.

**And the scan already has the vocabulary too.** `plot-fleet-scan.sh:1701`
carries `_pr_ready_degraded` with named reasons (`no-host`, `no-cache`), so the
degraded state is a concept the scan reports rather than one this plan invents.

**So the work is narrower than the slice describes**: extend an existing
three-outcome rule to `pr-list`, and give the scan one more named reason. Not a
new mechanism — the same one, on the path that was missed.

### Reporting (Branch: bug/the-scan-says-it-could-not-ask)

`plot-host.sh` distinguishes *asked and answered* from *could not ask* on the
`pr-list` path, and `plot-fleet-scan.sh` carries that into its summary line and
its rows.

Tests: a stubbed host that exits with a rate-limit error produces
`host=throttled` in the summary and leaves no row claiming `open`; a healthy
host still produces `host=ok` and byte-identical rows to today.

**One more, and it is the one that discriminates:** a host that answers with an
**empty list** must still read `host=ok` with zero PRs. Without it the fix could
be "treat empty as throttled", which trades a silent wrong answer for a noisy
one and breaks a repo that genuinely has no open PRs.

**Mutation to run before calling it done:** make the stub exit 0 with empty
stdout. The suite must stay green. Then make it exit 1 with empty stdout — the
suite must go red. If both pass or both fail, the test is reading the emptiness
rather than the exit code.

### Rendering (Branch: bug/the-board-shows-a-throttled-host)

The board renders the degraded state, beside the existing `prError` treatment.

Tests: a pulse carrying `host=throttled` renders the notice; a pulse without it
renders exactly as today.

## Done when

1. **A scan that could not reach the host says so in its summary**, and the word
   distinguishes *throttled* from *failed* — they need different responses.
2. **No row reads `open` when its PR could not be read.** `open` is a claim
   about a PR that was seen.
3. **A healthy scan is byte-identical to today.** This is a reporting change;
   any moved verdict is a regression, and `--next` picks branches to claim from
   this output.
4. **The degradation direction is unchanged** — an unreachable host still
   answers *not merged*. Asserted, not assumed: the existing test that pins it
   must still pass unedited.
5. `pnpm test`, `pnpm run test:board`, `pnpm run test:reconcile` green.

## Notes

Found while waiting for a merged PR to clear the fleet. The scan was correct
about everything it could observe and silent about the one thing it could not —
which is the failure mode that costs the most, because it looks like data.

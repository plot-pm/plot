# An unreachable host is not an answer

> The GitHub quota ran out and the board said nothing. Merged PRs read
> `eligible`, finished work read `worker finished — review it`, and no banner
> said the host had stopped answering.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board says when it cannot reach the git host, instead of presenting the
  last readable answer as the current one.
- A row whose PR state is `unknown` says so, rather than taking a verdict
  computed as though the host had answered.

## Motivation

### What a reader saw

2026-08-24, 21:31, with `gh api rate_limit` reporting **graphql 0/5000**:

WAITING ON YOU held seven plans whose phase is **Testing** — delivered work —
each showing a merged wave as `eligible` with the note *worker finished — review
it*, and stale conflict lists beside them. Every one of those PRs is merged.

The payload underneath was right about everything git can answer:

```
state: merged    verdict: complete    pr.state: 'unknown'
```

Git knew the branch merged. The wave knew it was complete. Only the PR was
unreadable — and that one gap was enough to render finished work as work
awaiting review.

### Nothing said the host was down

`fleet.prError` was **null** for the whole outage, and `prAgeSeconds` read 39 —
a payload claiming to be current.

The error handling in `refreshPrs` is not at fault: it catches, records the
message, and backs off specifically on rate limits (`fleet.ts:1606-1616`). It
was never reached, because **nothing threw**. `plot-host.sh` returned
successfully with PRs whose `state` is `'unknown'`, and a successful return with
unknown states is indistinguishable, at that boundary, from a host that answered.

`unknown` is a deliberate contract value — *"`unknown` is what a host that
cannot answer reports (absent is not false)"* (`plot-host.sh:34`). The contract
is right. The consumer treats it as an answer.

### The board has a banner for this, and it did not fire

The endgame checklist's Stop 6 asks that an exhausted budget *"degrades
gracefully: the banner says so and names the reset, and PR-dependent groups say
they may be incomplete rather than showing zero."* Walking that step during the
outage would have failed it.

## Design

### `unknown` propagates as a gap, not as a state

Where every PR in a refresh comes back `unknown`, the fleet records that the
host could not be reached — the same field and the same banner an exception
already drives. One unknown PR among many is a gap in one row; ALL of them
unknown is an outage, and the two need telling apart.

The count is what distinguishes them. A single unreadable PR is ordinary; a
whole map of them, from a host that returned successfully, is the shape a quota
failure takes.

### A row with an unknown PR withholds its verdict

`eligible` answers *may this wave be started*, and that answer depends on facts
the host holds. Where the PR is `unknown`, the row says the host could not be
asked — not a verdict computed from a gap.

What it keeps is everything git can still answer: the branch, its state, its
wave, its plan. A merged branch still reads `merged`, because git said so.

### The banner names the reset

A rate limit has a known end. `gh api rate_limit` carries the reset timestamp,
and a banner that names it turns *"something is wrong"* into *"back at 21:32"*.

The backoff already exists for the same reason (`fleet.ts:1616`) — this makes it
visible rather than only effective.

## Waves

### Told (Branch: bug/an-unreachable-host-says-so)
- an all-unknown PR refresh records an outage; the banner names it and the reset

### Withheld (Branch: bug/an-unknown-pr-withholds-its-verdict)
- a row whose PR is `unknown` says the host could not be asked, and keeps every
  fact git still answers

## Done when

1. **An all-unknown PR map sets `prError`** and the banner renders. Asserted by
   feeding a refresh whose PRs all carry `state: 'unknown'` — the shape a quota
   failure produces, not a thrown exception.
2. **A single unknown PR among readable ones does NOT raise the banner.** One
   gap is a gap; the distinction is the point of the plan.
3. **A row whose PR is `unknown` does not read `eligible`.** The seven Testing
   plans from the report are the case.
4. **That row still reads `merged` where git says merged**, and still names its
   wave, plan and branch. Nothing git answers is withheld.
5. **The banner names the reset time** where the host supplied one.
6. **Checklist Stop 6's second item passes** — the item this defect fails today.
7. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### Not chosen: treat `unknown` as `closed`, or as absent

Both would move rows to a group that looks decided. The existing comment on the
PR-map failure path says it exactly: *"An empty PR map would quietly move every
row back to its git-only group, which looks like state changing rather than data
missing."* That reasoning is already in the code for the throwing case; this
plan extends it to the case that does not throw.

### The quota was spent by us, and that is not the defect

Five workers, a session of merges, and repeated `gh pr view` calls exhausted
5000/hour. `the-scan-asks-once-per-pulse-not-once-per-branch` (#370) bounded the
IDLE board — it never claimed to bound an active fleet, and an operator who runs
five agents should expect to spend quota.

What is defective is that spending it looked like work needing review.

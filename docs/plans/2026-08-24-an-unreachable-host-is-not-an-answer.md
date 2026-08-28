# An unreachable host is not an answer

> The GitHub quota ran out and the board said nothing. Merged PRs read
> `eligible`, finished work read `worker finished — review it`, and no banner
> said the host had stopped answering.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Started:** 2026-08-26, Jan Wloka, `bug/an-unreachable-host-says-so`
- **Started:** 2026-08-26, Jan Wloka, `bug/an-unknown-pr-withholds-its-verdict`
- **Delivered:** 2026-08-28

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

### Why the banner does not fire today, exactly

`prError` already exists — `fleet.ts:522`, in the schema, and rendered. It is
set in **one place only: a `catch`** (`fleet.ts:1720`).

The quota failure does not throw. `gh` answers, the fetch succeeds, every PR
comes back `state: 'unknown'`, and the success path runs `entry.prError = null`
one line before. So the field is right, the plumbing is right, and the banner is
silent because **nothing on the success path ever looks at what came back**.

That makes this wave a second, CONTENT-BASED trigger beside the existing
exception-based one — not new plumbing. And it makes the existing trigger a
regression risk: a content check that replaces the catch rather than joining it
would lose every failure that *does* throw, which is most of them.

### The banner says how stale the retained data is

The catch keeps the last good map rather than blanking it, deliberately — the
comment records why: *"an empty PR map would quietly move every row back to its
git-only group, which looks like state changing rather than data missing."*

Right call, and it leaves a reader looking at PR data of unknown age. The banner
therefore names it: *"PR data unavailable — showing data from 14 minutes ago"*.

**This is free.** `prAgeSeconds` is already in the payload and already rendered
elsewhere in the fleet header (`AgentList.tsx:1988`, `· PR data 45s ago`). The
work is putting it where the reader connects it to the failure, not computing it.

### The rule is about ORIGINS, not about GitHub

Written from a measured GitHub failure — the quota ran out and every PR read
`unknown` — but the rule it establishes is host-agnostic, and this sprint is
about to add three more origins that can fail the same way for different
reasons: an expired Jira token, an unreachable Jenkins instance, a Bitbucket
tracker that is switched off.

**Stated once, here, so the new backends inherit it rather than each deciding
again:** an origin that could not be asked propagates as a **gap**, never as an
answer. A gap withholds every verdict that depends on it, and withholds nothing
else. That is the same rule `plot-host.sh` already keeps with exit 4 — *cannot
be asked is not empty* — carried through to the surface, which is the only place
a reader can tell the difference.

The backends are not this plan's work. The rule is, and it costs nothing to
state it in the general form while there is one implementation to check it
against.

### One banner, and it names which origins are dark

Done-when 2 draws the line at *one gap is a gap* — a single unknown PR among
readable ones raises nothing. With four origins the question sharpens: a board
can show a healthy PR list and a dead Jenkins.

**One banner, naming the origins it covers**: *"tickets and builds unavailable —
Jira, Jenkins"*. Not one per section.

Per-section messages were considered — put the message where the blank is, which
is where the reader is confused — and rejected on the shape of the failure. These
origins fail together far more often than separately: one expired credential,
one network partition, one VPN off. Four separate messages for one cause reads
as four problems, and a reader who fixes the first still sees three. One banner
naming three origins reads as one cause, which it usually is.

The per-section blank still needs to say it is not an answer, but that is a
label, not a banner, and it belongs with the backend that produced it.

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

### Told (Branch: bug/an-unreachable-host-says-so, PR: #446)
- an all-unknown PR refresh records an outage; the banner names it and the reset

### Withheld (Branch: bug/an-unknown-pr-withholds-its-verdict, PR: #454)
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
7. **The rule is written host-agnostically** — the propagation and withholding
   are stated for *an origin*, not for the GitHub PR map, so a backend added
   later inherits it instead of re-deciding. Asserted by reading, not by a test:
   this one is about where the rule lives.
8. **The banner is one banner and names its origins.** Asserted with two origins
   dark at once, producing one message naming both — not two messages.
9. **A THROWN failure still sets `prError` and still shows the banner.** The
   new content-based trigger JOINS the existing catch rather than replacing it —
   a check that replaced it would lose every failure that does throw, which is
   most of them.
10. **The banner names the age of the data still on screen**, from
   `prAgeSeconds`. The retained map is deliberate; a reader cannot tell a
   14-minute-old board from a live one without being told.
11. `pnpm run test:board` green; artifact rebuilt and committed.

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

### Interrogated 2026-08-26

One round, and both answers widened the plan without adding work to it.

It was written for a measured GitHub failure and read as a GitHub plan. The
sprint it now belongs to adds three origins that fail the same way for different
reasons, so the rule is restated host-agnostically — an ORIGIN that could not be
asked propagates as a gap — and the new backends inherit it rather than each
deciding again. No wave changes; the generalisation is in where the rule is
stated.

The banner became one banner naming its origins, rather than one per section.
Per-section messages put the text where the reader is confused, which is the
better argument in isolation; it loses because these origins fail TOGETHER —
one expired credential, one VPN off — and four messages for one cause reads as
four problems.

### Interrogated again 2026-08-26

Round two, on the mechanism rather than the rule.

It found why the banner is silent, precisely: `prError` exists and is set in ONE
place, a `catch`. The quota failure does not throw — `gh` answers, every PR
reads `unknown`, and the success path nulls the field one line earlier. So this
wave adds a content-based trigger BESIDE the exception one, and Done-when 9 now
pins that the thrown path keeps working, since a replacement would lose the
majority of failures.

It also found that the banner can name the age of the data for free:
`prAgeSeconds` is already in the payload and already rendered in the fleet
header. The retained map is deliberate and right; a reader still cannot tell a
14-minute-old board from a live one without being told.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {
      "q": "Should the rule generalise beyond GitHub now?",
      "a": "Yes \u2014 state it host-agnostically so new backends inherit it; do not add backends here",
      "category": "technical"
    },
    {
      "q": "One banner or one per origin?",
      "a": "One, naming the origins \u2014 they fail together, and four messages for one cause reads as four problems",
      "category": "ux"
    },
    {
      "q": "Why does the banner not fire today?",
      "a": "prError is set only in a catch; the quota failure does not throw, so the success path nulls it \u2014 the fix is a content-based trigger BESIDE the exception one",
      "category": "technical"
    },
    {
      "q": "Should the banner name how stale the retained data is?",
      "a": "Yes \u2014 prAgeSeconds is already in the payload and rendered elsewhere, so it is free",
      "category": "ux"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": true
    },
    "domain": false,
    "ux": {
      "happyPath": false,
      "edgeCases": true,
      "errors": true,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": false,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

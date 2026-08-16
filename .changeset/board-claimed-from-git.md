---
"plot": minor
---

The board asks git how much work is in flight, instead of asking the plan file about facts that live in git refs.

**A card's `claimed` count was always 0, and could never have been anything else.** It came from `summariseWaves`, which counted `b.claimed` — a field `plot-plan-meta.sh` parses from a plan-file annotation *nobody writes*. Claims are taken by pushing a ref (an empty `plot: claim <branch>` commit), which is Principle 1 working exactly as designed, so the annotation is a note *about* a claim that no command produces. The number was therefore not stale but permanently wrong, and the Agents tab — reading the same refs through the fleet scan — showed the claim the same second the card denied it. `summariseWaves` is deleted rather than left beside its replacement: a function that reads a field nobody writes is a trap for the next reader.

**Cards gain `eligible`, a number `WaveSummary` could not carry at all.** The fleet scan has computed it all along (`verdict=eligible` per wave); the card simply never asked. It counts branches that could be started *now* — still `open`, in an eligible wave — which is deliberately narrower than "outstanding": a blocked wave's open branches are real work but not startable work, and conflating them would tell someone to begin a branch whose seam has not landed.

**Absent is not zero, and the two must not render alike.** Both counts are optional in the contract. The fleet cache is empty for the first seconds after start-up and a scan can fail, so a card built without a pulse omits them rather than showing zeros — `claimed: 0` and *"I have not looked"* rendering identically is the very confusion being removed, and re-creating it one layer over would be no improvement. The wave and branch counts stay plan-derived and keep rendering: those genuinely do come from the plan file, and they are still true when git is unreadable.

**Single-wave plans get a summary too.** The card builder guarded with `if (meta.waves.length > 1)`, which would have withheld the new numbers from exactly the plans this repo has most of. That guard was right about *"waves · branches"* — noise when there is one of each — and wrong about occupancy: whether someone is working on a single-wave plan's one branch is the same question, and just as worth answering. The summary is computed for every plan; what the tile renders stays a display decision, and a card with nothing in flight shows no badge rather than an empty one.

The route was already proven: `board.ts` reaches into the fleet cache for PR links via `prsByNumber(opts)`, synchronous and `| null` on a cold cache, so `pulseFor(opts)` is a second export of that shape rather than a new mechanism. `buildBoard` stays synchronous — awaiting a scan would block `/api/board` for 0.5–1.05 s on a single-threaded server, which is the reason the cache exists at all.

**The board also stops asking the git host for PR state every five seconds.** `refresh()` fired both a `plot-fleet-scan.sh` (git, local, free) and a `pr-list --rich --state all --limit 300` (GitHub GraphQL, metered) on one 5 s timer. At 720 calls an hour that exhausts a 5000/hour budget in well under a working day — and did, on this repo, while the plan for this change was being written (`remaining 0/5000, used 5007`). PR state does not change on a five-second horizon; a review or a check landing is a minutes-scale event. Git now refreshes at 5 s and PRs on their own 60 s timer, backing off to the reset the host names — or to two minutes when it names none. `refreshPrs` already had its own timestamp, its own error, and a comment stating the two sources are independent, so this separates a cadence that was never deliberately joined.

`--limit 300` stays: without it the board sees only the newest 30 PRs and exactly the finished work goes unlinked. The defect was the frequency, never the page size. An ordinary failure — a VPN blip, a missing CLI — keeps the normal rhythm rather than buying two minutes of silence, so only a genuine quota slows the board down.

Verified against a real repo rather than a fixture object: a git repo with a bare local remote and an actual pushed `plot: claim` ref, served by the built artifact, reports `claimed: 1` for the taken branch and `eligible: 1` for the free one — while the plan file on disk carries no claim annotation at all.

<!--
bumps:
  skills:
    plot: minor
-->

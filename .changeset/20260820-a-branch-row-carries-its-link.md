---
"@plot-pm/board": minor
---

board: a branch row carries its PR link, and a merge no longer erases it

Reported by the operator looking at the board: the plan name in a row is a
link, the branch name beside it is inert text. Measured on one `/api/board`
pulse — a plan row carried `slug, title, type, phase, path, prs, phaseDate,
story, waveSummary`, and a branch row carried `branch, path`. Zero of seven
branch rows held a `pr` field.

**The field already existed, and so did the renderer.** `AgentRowSchema.pr` has
carried `{ number, url, draft, state }` for several releases, `rowsFromPulse`
already assigned it, and `PrCell` already renders `url` as a link — the same
component `WAITING ON YOU` uses for `#240` and `#57`. Nothing needed inventing,
which is why the row's emptiness was mistaken for a styling omission twice
before anyone read the payload.

What was missing was one filter's second consumer. `refreshPrs` indexes only
open PRs by head:

```
if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
```

That filter is correct for the question it was written for. A merged PR handed
to `classify` would answer for a branch whose git state has already answered,
reopening a question the merge closed — the comment above it says so. But the
same map also decided the row's LINK, and there the filter drops exactly the
PRs a reader still wants: the finished ones.

**A PR OUTLIVES ITS BRANCH, and that is the whole case.** Measured on this repo
2026-08-20: #252, #253 and #254 are `MERGED` with real URLs and their refs
deleted. The PR page is the only remaining record of that work, and all three
reached the row as `pr: null`. The link had to survive a deleted ref, and the
open-only map is precisely where it could not.

So the two uses are split rather than the filter loosened. `prsByHead` is a
third index off the same fetch — the precedent `prsByNumber` set and states
("one fetch, two indexes") — holding every PR keyed by head. `classify` keeps
the open-only map and decides the group and the note from it exactly as before;
`rowsFromPulse` reads the link from the new one, falling back to the open PR so
every existing caller is unchanged. The two records are the same on an open
branch and differ only after a merge, which is the case that was losing its
link.

**No new host call, and that is the reason the fix is cheap.** The number was
already in hand: `pr-list --state all` is fetched once on the slow PR timer and
the merged PRs are already in that answer — the pipeline computed them, used
them for one decision, and dropped them before shaping the row. All three
indexes are built from that one response's loop. Asserted structurally rather
than behaviourally, following `a row's actions all live in its menu` and for its
stated reason: a second `pr-list` on the row path would sit behind a poll timer
and a cache, where no unit fixture reaches, while a source scan sees it whether
or not any test data does. The board polls every 5 s against a metered API, so
a per-row lookup here is not a small regression.

`prOutranks` decides which PR a head with several of them yields — a closed
attempt and its reopened successor. Open outranks finished, because a closed PR
winning would send a reader to a dead page while the live review sat one number
away; between two in the same standing the higher number wins. Merged is
deliberately not ranked above closed: both are finished and neither is more
current, so the number decides and decides consistently. Until this function
existed the answer came from the host's listing order, which no adapter
promises — `gh` sorts by number descending, `bb` documents nothing.

**One regression this would otherwise have introduced, caught and fixed.**
`hostCannotReportCi` prints *this host cannot report CI* when every PR-bearing
row reads `unknown`. A merged PR reports `mergeable: "unknown"` on GitHub —
mergeability stops being computed once a branch lands — so merged rows now
arrive as `unknown` from a host that answers CI perfectly well. Before this
change they had no `pr` at all and fell out of that tally by accident. Counting
them would turn a plan of merged branches plus one PR mid-outage into a false
claim about the host, with the hint's own words ("nobody could look") printed
under a section that was simply quiet. Merged rows are now excluded by the
function's own stated rule: a row with nothing to report is not evidence about
the host either way.

`/api/attention` needed no change and was checked rather than assumed:
`readingFor` returns null for `state === 'merged' || group === 'done'` ahead of
every `row.pr` arm, so a merged row never reaches the PR switch.

The contract's own wording is corrected too — `AgentRowSchema.pr` read *the open
PR for this branch*, which was never a decision about the contract so much as
this cache filter leaking into it.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched, and `plot-fleet-scan.sh` already resolves each branch's PR to decide
`merged` — Manifesto Principle 3 keeps the interpretation on the board's side.

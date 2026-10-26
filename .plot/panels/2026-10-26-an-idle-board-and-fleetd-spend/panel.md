# Panel round 1 — moderation

Subject: `docs/plans/2026-10-26-an-idle-board-and-fleetd-spend.md` at `f84562650` (#2715, plan PR #2716, Draft). Jurors: safety, estate, cost, contradiction. Gate: all four committed (exit 0). Reconcile: `unanimous amend`.

## Evidence basis

All four jurors read the code on `origin/main` `ea2aa9743`. Three also ran measurements: estate and cost re-ran the burst analysis over `budget.tsv`, and estate decoded the live PR index. Cost read `.plot/state/endings.jsonl`, sampled `gh api rate_limit` for 3 minutes and ran one GraphQL `totalCount` query (1 point). Contradiction re-ran the burst grouping. No juror ran a test.

## Agreement

- **The root cause holds.** All four confirm the path `run()` → `startNothingDoneReleases` → `nothingDoneDecisions` → `pr-state` per non-bound candidate, with no memo and no tally. The burst shape (sizes 11–13, about 43 ticks per hour) fits about 10 leftover desks at night; the night's desk count is still inferred.
- **Slice 1 changes no verdict and no release.** All four trace `prOpen` to `ending-action.ts:347` only on this path, and the destructive step keeps its own host read (`release-claim-reader.ts:72`, `:74`).

## Findings all four share

1. **The `mine=` acceptance cannot pass.** `mine=` is `(3,600,000 / 60,000) × calls`, while real ticks run about 43 per hour. Removing 2 calls per tick moves `mine=` by 120/hr and the record by about 80–86 lines per hour. Restate the acceptance per tick (burst size or calls per tick), or compute `mine=` over the measured time between readings.
2. **The moved tally reset double-counts.** A thrown tick (`continue` before the reading) and an incomplete tick take no reading, so their calls roll into the next reading, which still divides by one interval. Name the reset on those paths and test one.

## Findings three jurors share

3. **"Every call the step makes" is not what Design 3 counts.** The release port's `prState` and `prMerged` reads (`release-claim-reader.ts:72`, `:74`) run outside `tally` (estate, cost, contradiction). Count them, or narrow the wording.
4. **The `OPEN`-row rule needs a home and a bound.** It is a decision, so it belongs in a pure domain rule, not inline in `registryd-main.ts` (safety, estate). A stale `OPEN` row holds a dead desk's claim with no bound and no log line when the index writer stops; bound it by the store's `at` the way `default-branch-red` is bounded by `Checks wait` (safety, estate). The live store is `v: 4` against `PR_INDEX_VERSION` 5, so slice 2 reads no rows until fleetd is restarted on current code (estate).

## Disagreement: slice 2

- **Safety and contradiction** keep slice 2 with changes: name the one port it changes (the fresh-agent `prOpen` port at `registryd-main.ts:1594` must keep asking the host, because there `true` starts a session or asks a person); word the CLAUDE.md exception as "its only effect is `leave`"; cover draft rows, which CLAUDE.md treats as a separate class.
- **Cost** says drop it: `.plot/state/endings.jsonl` holds 184 endings and **0** are `nothing-done`, so slice 2 saves close to 0 requests per hour while it adds a written exception to *A Decision Reads The Index*.
- **Estate** says measure it or defer it: neither measured desk has the shape slice 2 serves, and it has no Changelog line or acceptance that can fail.

This is a disagreement about whether the slice is worth its rule exception, not about whether it is safe. All four agree it releases nothing. The operator allowed the exception before this measurement; the 0-of-184 count is new evidence.

## Single-juror findings worth keeping

- **Cost:** lines are not requests. In requests the nothing-done step is about 35 % of the idle spend (about 430 of about 1,250), not "most". After slice 1 about 750–800 requests per hour stay idle: the scan's `pr-list --state all --limit 3000` (about 450/h, 18 pages per call) and the tick's merged listing (about 215/h). The merged listing reads only MERGED rows, which the existing rule already lets fleetd read from the PR index, with no new exception. One leftover `blocked` desk (`free-b71b8ae4`, since 2026-10-23) spent about 3,000 requests on an unread answer.
- **Estate:** the nothing-done ports are built inline in `run()` with no seam; extract a builder that takes `tally`, the shape `freshAgentDeskReads` already has. Two comments become false (`HostTally` TSDoc, the `:2367` comment). The plan needs a changeset for package `plot`.
- **Contradiction:** retitle around fleetd (the board spends no GraphQL); `unclaimed=8|10` counts the complement of the nothing-done population and should be dropped; the comment at `registryd.ts:1403` already claims the filler pattern slice 1 builds; slice 2's CLAUDE.md edit touches the same section that #2386 rewrites.
- **Safety:** `readNothingDoneCandidates` lacks the `ending.branch === tree.branch` guard that the fresh-agent reader applies, so an old ending at a reused path can produce `release-claim` for a new branch. `releaseClaim`'s refusals still stand in front of it. Pre-existing; file separately.

## Shared blind spot

All four judged the plan's two slices and none proposed replacing slice 2. The cost juror's numbers point at a better second slice: answering the tick's merged listing from MERGED index rows needs no rule exception and saves about 215 requests per hour, against close to 0 for slice 2. The scan's 3000-row listing is the largest idle spender in requests and is out of every slice. Whether the plan should stop at the nothing-done step or take on the listings is a scope decision the panel did not frame.

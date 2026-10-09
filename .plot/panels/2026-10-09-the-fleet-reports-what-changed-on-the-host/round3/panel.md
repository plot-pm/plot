# Panel: the-fleet-reports-what-changed-on-the-host — round 3

- **Date:** 2026-10-09
- **Caller:** challenge-the-plan Phase 3P (Draft plan, round 3, revision 5788128ea)
- **Lenses:** estate, contradiction, deliverable, cost
- **Gate:** `plot-panel.mjs check Position proceed,amend,reject` passed for all four files
- **Reconcile:** `unanimous amend estate,contradiction,deliverable,cost`
- **Earlier rounds:** `round1/panel.md`, `round2/panel.md`

## What each juror looked at

All four read the plan, the round-2 moderation, the revision diff, CLAUDE.md and the cited code. The cost juror also measured `git log` on `main` for 2026-10-09 (103 of 121 commit gaps under 20 minutes; 108 commits by the operator's identity, 17 by `plot-build[bot]`) and the `ls-remote` cost at `board.ts:163` (about 459 ms). No juror ran a test.

## Convergence

The design holds: no juror questions the channel, the relay, the page push, the default-branch reading or the host-decided merge. Round 3's findings are defects inside slices, each fixable in one or two sentences. Round-2 amendments 3, 5 and 7 hold in every reading.

## Where three or four agree

1. **HIGH: no row carries a merge time.** Slice 3 keeps `pr merged` for 24 h "from the rows' merge time", but `PrIndexRowSchema` (`entities/pr-index.ts:30-62`) has no `mergedAt`, and no `pr-list` arm requests it (`plot-host.sh:4105`, `:4136`, `:4182`). An implementer would use `updatedAt` or publish hundreds of `pr merged` after a cold store. Fix: slice 1 adds `mergedAt`. Estate, contradiction and deliverable.
2. **MEDIUM: the desk port has no read.** `ports/desk.ts:215-245` holds `publishFinding` and `publishBuildFinding`, two writers. The board reads the files itself (`board/src/server/findings.ts:67`, `:119`), and `packages/fleet` cannot import board code. Fix: the Desk port gains a read, and the board moves to it in the same slice. All four.
3. **MEDIUM: the channel has no in-process publish or "seen".** `RunningChannel` exposes no `publish`, and `lastSeen` changes only inside a socket publish, taken from the relayed `measuredAt` (`channel-socket.ts:151`), so a relayed old finding reads as a silent monitor. Estate, contradiction, deliverable.
4. **MEDIUM: green is silent in `checksVerdict`.** `checksShown` hides green (`checks-reading.ts:113`), so `checks green @a048b6f` never renders, and one "not bound" label would merge the failing, none and unknown labels (`:105-108`). Contradiction and deliverable; estate adds that `StatusPanel` takes `BoardStatus {key, severity, text, tone}` (`AgentList.tsx:795`), not the `checksVerdict` shape.
5. **MEDIUM: `foldRuns` knows only GitHub's words.** The Jenkins arm passes `SUCCESS`, `FAILURE`, `UNSTABLE` through (`plot-host.sh:4526`), so a Jenkins default branch always reads `unknown`. Estate and deliverable.
6. **LOW, three or four:** `:4182` is the plain listing, not a no-CI arm; no refs operation returns the SHA from `ls-remote`; the Bitbucket `pr-merge` arm has nothing to do with `--match-head`.

## Findings one lens raised

- **Cost, HIGH: the hold reads a HEAD that is pending most of the day.** 103 of 121 gaps on `main` were under 20 minutes and `validate` runs up to 25, so HEAD reads `pending`, and `pending` holds nothing. The fleet's own record commits keep reopening the window. Fix, no extra host call: hold on the newest SHA whose runs concluded. Estate raises the same window after each red merge (M6).
- **Cost, MEDIUM:** the re-ask streak grows only for `pending` (`pr-refresh.ts:1508-1517`), so a `failing` PR would be re-asked every 60 s for an hour. The one-working-day measurement cannot run before merge: `budget.tsv` records the bucket, not the operation.
- **Contradiction, MEDIUM:** a reaped desk's findings are never retracted; slice 8's rollup fold in the domain would duplicate `pr-list`'s jq fold without a corpus test.
- **Estate, MEDIUM:** the new finding names break the exhaustive `READINGS` record in `rules/attention.ts:81`, `:91`; `checks failing` repeats `build failed` for a branch with a desk; the feed pane repeats what the attention lists show. `ladder.ts:159` is a third `pr-merge` caller.
- **LOW:** `action_required` keeps `main` pending for the hour; the mod has no daily turn ceiling; the CLAUDE.md part-3 row goes stale after slice 3 and the AGENTS.md mirror follows any CLAUDE.md edit; `build passed` and `checks green` are two words for one branch; the 2 s refetch bound is per page.

## Disagreement on weight

Three jurors rank `mergedAt` first; cost ranks the HEAD-pending hold first. Both are HIGH, and neither changes the design.

## Shared blind spot

No juror ran a test, so the claims about green silence, the attention record and the channel's `lastSeen` rest on reading. They are specific enough to verify in a brief. The slice-7 packaging question is still open after three rounds and blocks only that slice's dispatch.

## Amendments for the author

1. Slice 1 adds `mergedAt` to the row and to the `pr-list` field lists; slice 3 reads it and tests the 24 h rule.
2. Slice 2 holds on the newest SHA whose runs concluded, with a done-when case "red SHA, then a newer pending SHA, still holds"; `foldRuns` maps the Jenkins words; a new refs operation returns the remote HEAD SHA; `runs-for-sha` makes no per-failed-run `gh run view`.
3. Slice 1 grows the re-ask streak for `failing` as for `pending`.
4. Slice 3 adds in-process `publish` and `seen` to the running channel, takes `lastSeen` from receipt time, maps the new names in `READINGS`, and updates the CLAUDE.md part-3 row and the AGENTS.md mirror.
5. Slice 4 adds a read to the Desk port, moves the board to it, and retracts a removed desk's findings.
6. Slice 6 uses `BoardStatus` for the status-panel line, shows the commit on failing and running badges only, names the payload fields, and drops the feed pane.
7. Slice 8 names `ladder.ts:159`, reuses `pr-list`'s rollup fold for `pr-state` instead of a domain copy, and states the Bitbucket arm; the measurement moves to the first working day after merge, with a bug filed on a figure over its row; the mod gets a daily turn ceiling.

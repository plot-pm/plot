# Panel: the-fleet-reports-what-changed-on-the-host

- **Date:** 2026-10-09
- **Caller:** challenge-the-plan Phase 3P (Draft plan, round 1)
- **Lenses:** estate, contradiction, deliverable, cost
- **Gate:** `plot-panel.mjs check Position proceed,amend,reject` passed for all four files
- **Reconcile:** `unanimous amend estate,contradiction,deliverable,cost`

## What each juror looked at

All four read the plan, CLAUDE.md and the cited code, and searched the estate with grep and `plot-deliverable-search.sh`. No juror ran a test or executed the code. The positions rest on reading, not on execution.

## Where all four agree

1. **The merge controller (slice 6) can merge a commit nobody checked.** `plot-host.sh pr-merge` (`:3812-3833`) passes no `--match-head-commit`, and `PrMergeWrite` (`workflows/decision.ts:153-159`) has no `sha`. A push between the index read and the merge lands an unchecked head, which is the #1444 failure the plan sets out to fix. The slice also takes a destructive decision from non-terminal index answers (`checks`, `draft`, `headSha` of an OPEN row), against *A Decision Reads The Index*: "Only a terminal answer is read from the index". The fix (pass the SHA to the host and re-ask the host before the merge) is a second shell change, so the plan's "No other slice touches shell" is false. Raised by estate, contradiction and deliverable as HIGH; cost agrees on the citations.
2. **"Checks for that SHA" holds only on the GitHub rollup arm.** On the Jenkins arm (`plot-host.sh:4096-4131`) checks join on the branch name, so a row can show `green@<new sha>` from an older build. Contradiction and deliverable raise it; cost raises the same fact for `:4105`.
3. **A cold or version-mismatched store floods the event feed.** The first fold after v3 → v4 has no readable `before` (`pr-refresh.ts:1233`), so every PR in the store (about 937) becomes an event. Each event re-fetches the board, and the mod starts a turn on the kinds the operator names. Contradiction, deliverable and cost.
4. **Slice 7 toasts on `PLOT-BLOCKED`, but slice 3 never writes that kind.** It is a desk fact, and the plan moves desk facts to another plan. Contradiction and deliverable.
5. **The Jenkins open question starts from a false premise.** `build-jenkins.ts:29-59` already answers `runForSha`; only Bitbucket Pipelines has no arm. Estate and deliverable.

## Findings one lens alone raised

- **Estate: an event transport already exists.** `ports/channel.ts`, `adapters/channel/channel-socket.ts`, `channel-client.ts` and `rules/channel.ts` form a unix-socket NDJSON channel with subscriptions, and `rules/channel.ts:36-41` refuses `ci is green` / `ci is red` on purpose. The plan never names it. Slices 3, 4 and 7 must either build on it or say why a file is the better transport, and must say what happens to that refusal. The BuildMonitor's findings (`.plot-worker.monitor.build.jsonl`, `head moved`, `build failed`) also cover two of slice 3's kinds.
- **Estate: wrong citation.** `perform-fs.ts:54-56` skips `pr-merge`; the merge runs in `packages/board/src/server/entry/approve.ts:554`.
- **Cost: slice 2 has no cadence and no price, and can answer wrongly.** Read on each 60 s tick, the default-branch read adds 60 requests per hour, as many as the whole GitHub PR budget, and `main` moves after every merge because of the bundle commit. `run-for-sha` returns the newest single run across all workflows (ci, build-bundles, release), so `defaultBranchRed` can read green while `ci` is red. The read must take the combined check state for the SHA and follow the host-slot rule that `refreshRuns` (`board/src/server/fleet.ts:1385`) uses.
- **Cost: `checks-changed` is late by an existing bound.** A delta read misses a completed check, and the re-ask covers it only for `PR_PENDING_REASK_LIMIT` = 5 tries (about 5 minutes). CI runs longer, so the green event, the badge and the merge can wait up to 24 h for the next full read.
- **Contradiction: slice 2 puts a build-connector answer into the git host's strict store** (`pr-index.ts:89`), which breaks the two-connector split and adds a second read-fold-write path into one file.
- **Contradiction: the wait is prose only.** Slices run in strict order (`plot-pulse/SKILL.md:101`), so slice 6's wait also blocks slice 7, and nothing stops auto-dispatch from handing slice 6 over as soon as slice 5 merges.
- **Deliverable: slice 5 is not buildable as written.** The row badge exists (`PlanCard.tsx:265`, fed by `rules/pr-row.ts`), and "named render sites" is never defined as something an implementer can build and test. Slice 4's done condition depends on an open question.
- **Deliverable: existing parts to reuse.** `checksFromRuns` (`checks-verdict.ts:209`), `QUEUE_HOLDS` (`queue.ts:333`), and the size-rotated log in `process-log.ts` (cost names this too).

## No disagreement on the position, one on weight

All four say amend. They differ on which change matters most: estate, contradiction and deliverable name slice 6; cost names slice 2. Both are HIGH, and both are the same kind of defect: a decision that the plan bases on a reading that does not bind to the commit it claims.

## Shared blind spot

No juror asked whether the plan's main consumer, the master agent, needs a new transport at all, given the existing channel with subscriptions; estate found the channel but judged it as an overlap, not as a change of design. No juror executed anything, so the flood size (about 937), the request rate and the late-check window are reasoned figures, not measurements. The amendment should measure at least the first fold and the request rate before the slices are briefed.

## Amendments for the author

1. Slice 6: pin the merge to the SHA at the host (`--match-head-commit`, `unaskable` on Bitbucket), carry `sha` in `PrMergeWrite`, re-ask the host for head and checks before the merge, cite `entry/approve.ts:554`, and declare the second shell change with its own equal line removal.
2. Slice 1: state what `headSha` and the checks mean on each arm (rollup, Jenkins, plain, Bitbucket), and give the merge a `checks-unbound` refusal where the checks do not bind to the SHA.
3. Slice 2: keep the default-branch reading out of the PR store or say why not; read the combined check state for the SHA; give it a cadence, a host slot and a row in the cost model; state that a reversible hold may read a non-terminal answer.
4. Slice 3: build on `ports/channel.ts` or argue against it; define a baseline rule for a cold or mismatched store; decide the re-ask bound for `checks-changed`; reuse `process-log.ts`.
5. Slices 4 and 5: close the reconnect question; define a render site as a buildable, testable unit, and reuse the existing badge.
6. Slice 7: drop `PLOT-BLOCKED` or add it as an event kind, and bound turn starts.
7. Make slice 6's wait a recorded `waits:` annotation, or move it last.

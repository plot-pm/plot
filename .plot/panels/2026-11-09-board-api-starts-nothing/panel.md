# Panel: board-api-starts-nothing

Subject: `docs/plans/2026-11-09-board-api-starts-nothing.md`, round 1, three jurors (correctness, cost, operator).

## Reconcile

```
$ printf 'committed\tcorrectness\tamend\ncommitted\tcost\tamend\ncommitted\toperator\tamend\n' | node skills/plot/scripts/board/plot-panel.mjs reconcile
unanimous	amend	correctness,cost,operator
```

The panel is unanimous on `amend`. The jurors agree that the plan must change before approval, and they disagree on one design point (the identity read, below).

## What each juror looked at

- **Correctness** read the code: `readIdeaPlans` (`fleet-scan.ts:391-411`), `readBranchPlans` (`board.ts:1245-1353`), `READING_KEYS`, the sprint and story parsers, `collectPlanSources`, the census sandbox (`sandbox.ts:238`) and `admit` (`subscription.ts:30`). It measured one figure: 680 files and 8,358,012 bytes under `docs/plans/delivered/`. That figure measures the wrong set (see *Corrections to the jurors*). It ran no test and no route.
- **Cost** counted the starts per request from the code and traced each to its site. It found the third `for-each-ref` through `ticketLaneData`. It read `plot-host.sh account` (`plot-host.sh:4003-4006`) and `refs-git.ts:660-675`. It ran nothing; the count is a reading of the code, not a spawn-spy measurement.
- **Operator** read the payload contract (`schema.ts:4696`, `:4878-4885`), the page (`grep viewSource packages/board/src/app`, no hits), `heldIdentity` and `waitingOf` (`fleet.ts:2200-2201`), and `mine-filter.ts`. It ran one grep and no test.

No juror ran the route under a spawn spy. The plan's "about 5 `git` per request" and the cost juror's six-row table are both readings of the code, and slice 1's inventory test is the first measurement.

## Corrections to the jurors

- **The `delivered` size.** `buildBoard` reads text only for plans whose phase is `delivered` (`board.ts:2660`, `if (meta.phase !== 'delivered') continue`). On 2026-11-09, 22 plans in `docs/plans/` carry `State: Delivered`, and their text is 265,884 bytes, not 8.4 MB. The 680 files under `docs/plans/delivered/` include Released plans, which the board does not read for verification. The correctness juror's change (carry the inputs of `verificationOf` and `refutedClaims`, not the whole text) still holds, because the text enters every welcome message and every content comparison of `plans`.

## Verified against the code by the moderator

- `boardAnswer` calls `ticketLaneData(opts)` (`controllers/board-answer.ts:68`), outside `boardState`. `ticketLaneData` returns null unless `entry.issueSets` is set (`fleet.ts:1957-1958`), and `fleet.ts:2539` sets it from fleetd's `issues.json`. It calls `ticketPlansOf(opts, entry)` with no `refEntries` (`fleet.ts:1959`), which calls `planMetasAtDefault` (`fleet.ts:1809`), which calls `heldRefsFor(opts, undefined)` (`fleet.ts:1687`): one `for-each-ref` per request, exactly in the mode this plan targets. Confirmed.
- `readIdeaPlans` reads only `refs/remotes/origin/idea/*` and stores the file basename (`fleet-scan.ts:391-411`). Confirmed.
- `READING_KEYS` holds no sprint and no story key (`snapshot.ts:18-35`). Confirmed.
- `plan-store-shell.ts` drops rows with `error` at `packages/domain/src/adapters/plan-store/plan-store-shell.ts:243`; the plan named the path without its directory. Confirmed.
- `heldIdentity` asks only when nothing is held (`server-info.ts:219-220`), and `/api/board`'s `serverInfo` is what refreshes the cache every 60 s. Confirmed.
- fleetd records `plans.ref` as `worktree` on its fallback (`fleet-scan.ts:768`). Confirmed.

## Amendments the jurors share or no juror contests

1. **Route `ticketLaneData` through the snapshot in Serve** (cost; verified). Without it the third `for-each-ref` stays and Serve's "10 requests start 0 processes" row fails.
2. **Correct the `ideaPlans` row** (correctness; verified). It holds branch to basename for `idea/*` only. The board's branch-plan set covers every `Branch prefixes` entry, skips merged branches and de-duplicates by path. `branchPlans` needs its own read through one rule both paths call, and the read counts as new fleetd work.
3. **Keep working-tree plans and sprints, and `behind`, on the board on both paths** (cost and operator; correctness asks that the plan name the reader). They change with no ref event. `workingTreePlans` is an `fs` read and its parse is cached by blob id.
4. **`boardInputsFrom` answers `unknown` for `plans.ref` `worktree`** (correctness; verified).
5. **Every added reading is in `boardInputsFrom`'s `unknown` set**, including `authors` and `delivered`, with a test that a `failed` `authors` falls back instead of rendering empty authors (operator).
6. **`delivered` carries the verification inputs, not the whole text**, with a size row (correctness, figure corrected above).
7. **"No read is made twice" measures a pass after a default-branch move**, not the first pass over a static fixture, and the PR states the per-move `git log` count (cost).
8. **A parity fixture with one card of each kind** (all three ask for at least the local-only plan): a Draft plan on a `feature/` branch, a plan whose basename differs from its branch slug, a sprint with items, a story with a design document, an archived story, a Delivered plan with a verification record, an unparseable plan, a working-tree-only plan, a plan with `issues` and `rounds`.
9. **Slice order: Readings before Serve** (operator). Serve reads the fields Readings adds, so "slices 1 and 2 in either order" is wrong.
10. **S7 asserts a 200 answer for every in-window read** (cost), else a failed request reads as zero starts.

## Disagreements

- **Where the identity is read.** Correctness and cost: keep it on the board, cached for the process and re-read only when an `fs.stat` stamp of `hosts.yml` (or the `bb` config), `.git/config` and `~/.gitconfig` changes. Their reason: fleetd runs under `systemd-run --user` or launchd with an environment the board does not share, and `plot-host.sh account` reads `GH_CONFIG_DIR`, `GH_TOKEN` and `PLOT_BUDGET_ACCOUNT` from the caller's environment, so "same user" does not prove "same answer". A wrong `hostUser` empties «Mine» silently, and the parity test excludes `server`. Operator: read it in fleetd as the plan recommends, but add `heldIdentity` (the *Waiting on you* reader) to Serve, because it freezes once `serverInfo` stops calling `identity()`, and fall back to the board's TTL read on an `unread` or `failed` reading instead of serving `''`. The disagreement is about whether fleetd's environment can differ from the board's. Neither side measured it.
- **What the person sees about the source.** Only the operator asks for a `servedFrom` value on `/api/board` (`snapshot` with `generation` and `readAt`, or `own` with the fallback reason) rendered in the plan-source line, and for a row that a `snapshot` → `own` → `snapshot` flip never shows an older `generation` of the plans. Correctness and cost do not address it. It contradicts the plan's Changelog ("The `/api/board` payload keeps its shape"), so it is a scope decision, not a text fix.

## The shared blind spot

All three lenses read the plan's table of missing readings and checked rows against it. None asked whether the ticket lane reads the same plan set as the board.

`planMetasAtDefault` parses the default-branch plans **and** the draft plans in `entry.ideaPlans` whose branch has an open PR (`draftPlanFiles`, `fleet.ts:1888-1906`). The cost juror's fix ("`ticketPlansOf` reads `issues` from the snapshot's plan entries") covers the default-branch plans only. A ticket whose only plan is an open draft on an `idea/` branch loses its plan link on `snapshot`, and the census sandbox (one plan, no PR) cannot show it. The ticket lane's set is `idea/*` with an open PR; the board's branch-plan set is every prefix; the two differ, and `branchPlans` must serve both or the Serve slice must name which set each consumer reads. The moderator added this to the Serve slice and to the parity fixture.

A second gap all three share: none ran the route. Every count in the plan and the verdicts is read from the code, so slice 1's inventory list is the first evidence, and a start it prints that maps to no row is the expected kind of finding.

## Leftovers for the person

1. **S3 or a new row S7?** Options: change S3's window to poll `GET /api/board`, or add S7 and keep S3 unchanged. All three jurors recommend S7.
2. **Where is the reader's identity read?** Options: (a) in fleetd, served through the snapshot, with `heldIdentity` moved to the snapshot and a board fallback on `unread`/`failed` (operator); (b) on the board, process-cached behind an `fs.stat` stamp of the host config, `.git/config` and `~/.gitconfig`, with no `identity` reading (correctness and cost). The jurors split 2 to 1 for (b); the split rests on whether fleetd's service environment can answer a different account.
3. **The census slice after `refs-from-files`?** Options: merge Census zero after `feature/refs-from-files-adapters`, or accept 2 `git` per minute from the 5 s branch TTL. All three recommend waiting. (Readings before Serve is now a fixed order, not a choice.)
4. **Sprints and stories on `snapshot`?** Options: (a) add `sprints` and `stories` readings in Readings (parsed records, archived stories, design-document lists) inside the same `SNAPSHOT_PROTOCOL` 3; (b) keep the board's own sprint and story read on `snapshot` and state its process cost in S7. Correctness names both and prefers neither; no other juror addressed it.
5. **Should `/api/board` say where it was served from?** Options: add `servedFrom` and render it in the plan-source line, with a row for the `snapshot` → `own` flip (operator); or keep the payload shape as the Changelog states. Only the operator addressed it.

# Cost lens: board-api-starts-nothing

Position: amend

## Starts per request, counted from the code

Steady state on `own`, with nothing changed between two polls, one `GET /api/board` starts these processes:

| Start | Site | Removed on `snapshot` by |
|---|---|---|
| `git for-each-ref` (1) | `refsToken`, `controllers/fleet-state.ts:139-143` | Serve (generation key) |
| `git for-each-ref` (2) | `heldRefsFor` → `readRefSnapshot`, `board.ts:337`, `plan-walk-cache.ts:223-225` | Serve |
| `git rev-parse origin/<default>^{commit}` | `collectPlanSources`, `board.ts:1093`; `cachedRefs.resolve` answers only plain names (`plan-walk-cache.ts:296-299`) | Serve |
| `git for-each-ref` (3) | `boardAnswer` → `ticketLaneData(opts)` (`fleet.ts:1956-1960`) → `ticketPlansOf` → `planMetasAtDefault(opts, entry)` with no `refEntries` → `heldRefsFor` (`fleet.ts`, `planMetasAtDefault`) | **nothing in the plan** |
| `git` for the checkout branch | `serverInfo` → `currentBranch`, 5 s TTL against a 30 s poll (`server-info.ts:73`) | `refs-from-files` |
| `bash plot-host.sh account` + its children, `git config user.email` | `identity`, 60 s TTL (`server-info.ts:191`, `:200-214`) | Readings + Serve (identity) |

The "about 5 `git` per request" figure matches: three `for-each-ref`, one `rev-parse`, one branch read. Cached reads (`listBlobs`, `readBlobs`, `countBehind`, `planAuthors`, `recordCommit`, the plan parse by blob id, `defaultBranch` by digest, `repoRoot` via `git-dirs.ts:212-218`) start nothing while the refs do not move. `ticketLaneData` runs only where `entry.issueSets` is set, and `fleet.ts:2539` sets it from fleetd's `issues.json`, so it runs exactly in the mode this plan targets.

## Open Questions

1. **S3 or S7.** Add S7 and keep S3 unchanged. S3's window holds no `GET /api/board` (`board.census.test.ts:137-175`), and S3 is `strict`; a changed window makes the gate compare two different measures. `measureBoard` already makes one read before the window (`board.census.test.ts:57`), so S7's config, `people` and `ci` caches are warm when `w0` is marked. S7 must also assert that every in-window `read()` answers 200, else a failed request reads as zero starts.
2. **One identity for fleetd and the board.** Do not move the identity to fleetd. `plot-host.sh account` is a file read and no request (`plot-host.sh:4003-4006`), and it honours `PLOT_BUDGET_ACCOUNT` and `GH_CONFIG_DIR` from the caller's environment. fleetd runs under systemd or launchd with an environment the board does not share, so "same user, same answer" is not guaranteed. Keep the read on the board, cache it for the process, and re-read it only when an `fs.stat` stamp of `hosts.yml`, `.git/config` and `~/.gitconfig` changes. A `stat` starts no process, the census stays at zero, the snapshot loses one reading and fleetd takes on no new host call.
3. **Census slice waits for `refs-from-files`.** Agree. Without it the 5 s TTL branch read starts 2 `git` per minute in S7. Name the merge order in the census slice's line, as the plan does.

## Leftovers

- **S3 poll or S7.** Handled; the recommendation is right. Add the 200 assertion above.
- **One identity read in fleetd.** Handled as a question, answered the wrong way for cost and correctness. Replace the `identity` reading with a board-side stamp cache (Open Question 2), and drop `identity` from the Readings slice and its `Done when` row.
- **Census slice waits for `refs-from-files`.** Handled. It also waits for the `ticketLaneData` fix below, which no slice names.

## What makes a slice fail or answer wrong

1. **The third `for-each-ref` is out of scope.** Serve changes `boardState` and `serverInfo` only. `ticketLaneData` sits in `boardAnswer`, outside `boardState`, and reads the plans a second time through `planMetasAtDefault`. Serve's "10 requests start 0 processes" row then fails, or the worker fixes it unscoped. Add to Serve: on `snapshot`, `ticketPlansOf` reads `issues` from the snapshot's plan entries (the field Readings adds) and does not call `planMetasAtDefault`.
2. **Local-only plans vanish on `snapshot`.** `collectPlanSources` adds working-tree plans that the ref lacks (`board.ts:1095-1103`) and parses them. fleetd's `plans` reading holds the ref's records only (`fleet-scan.ts:765-767`), and `PlansValue.source.localOnly` gives a count, not cards. A plan written on the default branch and not yet pushed then has no card, with no error. The census fixtures hold no such plan, so the parity test passes. Keep the working-tree scan on the board on both paths: it is `fs` only, and its parse is cached by blob id, so it starts nothing at idle. Add a parity fixture with one local-only plan.
3. **fleetd's new reads run with no page attached.** `delivered` needs `refs.recordCommit` per Delivered plan: one `git log -m --first-parent -U0 -G…` each (`refs-git.ts:660-675`), 22 Delivered plans on this estate today, keyed by the default tip's oid. `authors` adds one `git log` walk per tip. Today the board pays this only while a page polls; after Readings fleetd pays it on every default-branch move, page or not. The cost is bounded and does not show at idle (S4), but the `Done when` row "after its first pass" measures a static fixture and never sees it. Change that row to compare a pass after one default-branch move against the merge base's board build over the same move, and state the per-move count in the PR.
4. **`behind` can go stale on `snapshot`.** `countBehind` is keyed by the checkout's `HEAD` oid. A `git checkout` in the main worktree moves no remote ref, so fleetd has no trigger and serves the old count. The same reasoning the plan applies to `currentBranch` applies here: keep `behind` on the board through the file reader, or state the staleness bound.

## Changes required

- Serve: route `ticketLaneData` through the snapshot (item 1).
- Serve: keep working-tree plans on the board, with a local-only parity fixture (item 2).
- Readings: drop the `identity` reading; the board caches it behind a `stat` stamp (Open Question 2).
- Readings: measure fleetd's per-move `git log` count, not the first-pass count (item 3).
- Census zero: S7, with a 200 assertion per in-window read.

## The one change that matters most

Add `ticketLaneData`'s plan read to Serve's scope. It is the third `for-each-ref` per request, it runs only while fleetd serves `issues.json`, and without it S7 cannot reach zero.

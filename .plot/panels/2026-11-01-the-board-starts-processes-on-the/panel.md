# Panel moderation — the-board-starts-processes-on-the

Reconciled: **unanimous amend** (layering, safety, testability, seams). Round 1 on the Draft plan, recorded as `- **Rounds:** 1`.

## What each juror looked at

- **layering** read the plan and the code on `origin/main` at `0974e8956` (`plan-walk-cache.ts`, `board.ts`, `fleet.ts`, `fleet-state.ts`, `refs-git.ts`, `server-info.ts`, `interrogate.ts`, `config-reader.ts`). It made the panel's one timing call: one `/api/board` request took 12.07 s at load 11.5 (2026-11-01 20:38). It counted 17 Delivered plans of 625 with `git grep`.
- **safety** read the same code and the removed cache in `ceaf53689`, plus `supervisor-reading.ts` and `scan-owner.ts`. It ran `git grep` for call sites. It ran no request and no test.
- **testability** read the code, the existing gate `a-read-route-spawns-nothing.test.ts`, the precedent `plan-read-shape.test.mjs` and `BuildBoardOptions`. It ran `git grep` only.
- **seams** read the code, the plan walk's remaining slices and #2993's slice, and the open PRs that touch `board.ts`. It counted 626 plan files and 17 Delivered plans with `git grep`. It ran no request.

All four positions rest on reading. The one measurement is the layering juror's single request duration, which confirms the symptom and not the cause.

## Agreements

1. **Behaviour 3 already holds.** `readSupervisor` has one caller, `refresh` (`fleet.ts:2847`), which the request does not await. The issue's sample counted every child of the board pid, so it held the refresh loop's starts too. All four drop or restate the supervisor slice.
2. **The plan missed the largest request-path starts.** The full `plot-plan-meta.sh` parse in `buildBoard` (`board.ts:2318`), `ticketLaneData` twice per request, `planMetasAtDefault`'s key reads, the synchronous config read in `interrogateAvailability` (`interrogate.ts:57`), and four starts per Delivered plan, not one per plan file.
3. **No second oid cache.** The domain's `cachedRefs`/`WalkCache` (#2995) is the mechanism to extend; a board-side Delivered map would be a third oid cache.
4. **Config needs one seam and a full stamp.** Four routes read config; the stamp must cover `CLAUDE.md` and `AGENTS.md` and the repo root; `cachedCi` and `cachedPeople` hold values for the life of the process.
5. **The count must not use a PATH shim on a running server alone**, because that also counts the refresh loop.
6. **An oid key needs a read at that oid.** `recordCommit` reads `origin/<name>` by name, so the port needs a ref parameter (layering, safety; testability judged the key sound and missed the race).

## Differences and the choice made

- **How to count.** Layering: counting ports at a new controller. Seams: extend the PATH-shim precedent and call `stopFleetRefresh()`. Testability: `vi.mock('node:child_process')` in-process, clocks stopped with caches kept, time pinned. **Chosen: testability's**, at layering's controller `boardAnswer`. `stopFleetRefresh` clears `caches` (`fleet.ts:3323`, confirmed), so seams' route loses the warm state, and counting ports miss the thirteen direct `node:child_process` importers.
- **Where the count lands.** Layering put it last; testability and seams first as a ratchet. **Chosen: first.**
- **The supervisor reading.** Layering and seams: a cadence question. Safety: the stored reading needs an asked-at time and a wire field, because a stale `up` also feeds `fleetOwnsScan`. Testability: a test-only slice. **Chosen: a Notes follow-up**, because it moves no request start, needs a wire field, and edits `refresh`, which the plan walk's last two slices edit.
- **The smaller design (held payload built on the beat).** Safety, testability and seams offered it as acceptable; layering argued against it (O4). **Chosen: rejected**, with layering's reason: the payload mixes clocks, and a held payload carries up to one refresh of staleness that the page would have to show.
- **Config parser.** Safety allowed a TypeScript parser with a corpus pair; seams and layering keep `plot-config.sh`. **Chosen: keep `plot-config.sh`.**
- **Config location.** Seams: `config-reader.ts`, async path only. Layering: one adapter seam board and fleetd share. Testability: an injectable field on `BuildBoardOptions`. **Chosen: an adapter decorator in the domain that `config-reader.ts` builds with, injectable through `BuildBoardOptions.config`, serving the sync path too.**
- **Inode in the stamp.** Safety (optional) and testability: yes. **Chosen: yes.**
- **The plan parse cache.** Layering: read through `cachedPlans` directly. Seams: `cachedPlans` or `planMetasAtDefault`'s held parse. **Chosen: one more kind on `WalkCache` under the `cachedPlans` key rule**, because the board's `PlanMeta` carries fields `PlanRecord` does not; neither juror named that mismatch.
- **The behind count key.** Layering and seams: (HEAD oid, origin oid). Safety adds attached or detached. **Chosen: safety's.**
- **The end value.** Layering: `for-each-ref` plus a named list. Safety: zero as target. Testability: one `for-each-ref`, or zero under the smaller design. Seams: `for-each-ref` plus `git status`. **Chosen: `git for-each-ref` and `git status --porcelain`.**
- **Order after the ratchet.** Seams said config first relieves the operator most; no other juror ranked. **Chosen: config first**, by start count, since the board waited on children at 0 % CPU; the plan-parse slice saves the most CPU and waits on the git-read slice.

## Shared blind spots

- **No juror measured the per-request start count.** Every count in the amended Motivation is read from code. The ratchet slice's first list is the first measurement; if it disagrees with the Motivation, the list wins and the Motivation is corrected.
- **A node-level count hides a script's own children.** All four jurors proposed counting starts the board makes. `plot-config.sh get` is one such start and about five processes; `plot-plan-meta.sh` is one start and 0.52 s CPU. The amended Done-when rows also count calls at the config adapter and at `cachedRefs`, so this cost is not hidden behind one line.
- **No juror tested the cause of "No contact".** All four accepted that start count drives request time. The layering juror's 12.07 s reading and the issue's 0 % CPU support it, but no juror separated load from the board's own starts by a request with the refresh loop stopped.
- **No juror asked what the 626 staged temp files cost.** `collectPlanSources` writes every plan blob to a temp directory on every request; the held parse removes that for unchanged blobs, but nobody measured the file-system cost.
- **The lenses shared one source.** Each juror read `origin/main` at `0974e8956`, and three of them quote the same handful of line numbers. A line number one juror got wrong would likely repeat in the others; the moderator rechecked `fleet.ts:2847`, `:3323`, `board.ts:2318`, `:2329`, `index.ts:493`, `:506`, `interrogate.ts:57` and `plan-walk-cache.ts:88`, `:230`, `:373` on `origin/main`.

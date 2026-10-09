# Contradiction juror

Position: amend

Lens: contradiction. The plan was read against CLAUDE.md (The Layering Rule, A Shell Script Asks The Domain, A Decision Reads The Index, The Master Agent Uses The Controllers, One Answer To "Did This Land"), against skills/plot/MANIFESTO.md, and against itself. All evidence below was read in the worktree at `f145ac8bc`.

## 1. Cited code

Every cited location holds as the plan states it:

- `packages/domain/src/entities/pr-index.ts:30-62`: `PrIndexRowSchema` holds `head: z.string()` (the branch name) and no SHA. `PR_INDEX_VERSION = 3` at `:12`. The schema and `PrIndexSchema` (`:84-121`) are both `.strict()`.
- `skills/plot/scripts/plot-host.sh:4105`, `:4136`, `:4182`: the three `gh pr list --json` lists carry no `headRefOid`. `:3754` (`pr-merged-heads`) is the only `pr list` call that asks for it.
- `packages/domain/src/ports/build.ts:103`: `runForSha(branch, sha, limit?)` exists. `packages/domain/src/adapters/build/build-shell.ts:161` calls `run-for-sha`.
- `packages/board/src/app/App.tsx:30-31`: `POLL_MS = 30_000`, `FLEET_POLL_MS = 4_000`.
- `packages/domain/src/workflows/approve.ts:256`: pushes `{ kind: 'pr-merge', pr, deleteBranch: true }`.
- One writer: `packages/fleet/src/shared/pr-refresh.ts:1238` is the only `foldPrIndex` call outside tests, and `packages/fleet/test/unit/one-pr-index-writer.test.ts` asserts it. With no fleet, the board refreshes in memory and writes no store (`packages/board/src/server/fleet.ts:1745-1753`).

## 2. Existing parts

Nothing the plan builds exists already. `grep` finds no `text/event-stream` or `EventSource` in `packages/`, and no `headSha`, `defaultBranchRed`, `indexTransitions` or `fleet-events` outside the plan. `plot-host.sh:4552-4574` already reads a run's `headSha` for `run-for-sha`, and the 2026-10-05 plan (`the-build-monitor-asks-for-the-pushed-commit`, Released) removed its newest-run fallback, so slice 2 can rely on an exact SHA match.

## 3. Findings

### F1 (HIGH): the merge controller merges from non-terminal index answers through a verb that does not bind the SHA

The plan (line 49) refuses a merge unless the index row's `headSha` equals `<sha>` and its checks are `green`, then "writes one `pr-merge` through the performer". Two settled rules and the plan's own changelog conflict with this:

- CLAUDE.md, *A Decision Reads The Index*: "Only a terminal answer is read from the index. … `OPEN`, `CLOSED` and draft rows are stale in either direction", and both consumers "ask the host for everything else". `checks: green` and `headSha` on an OPEN row are non-terminal answers. A merge cannot be undone, so by *One Answer To "Did This Land"* it is in the destructive class, where the blast radius decides, not the confidence. The plan does not say that it amends this rule, and does not say how it revalidates.
- `plot-host.sh:3812-3833` (`pr-merge`) accepts only `--squash` and `--delete-branch` and calls `gh pr merge <n>` with no `--match-head-commit`. A push between the fold and the merge therefore merges a commit nobody saw green. Changelog line 14 says "a merge on green merges the commit that was green". With the existing verb, that claim is false.
- Line 52 says "No other slice touches shell" and "slice 6 writes through the existing `pr-merge` verb". To make the changelog true, `pr-merge` must pass the SHA to the host (`gh pr merge --match-head-commit <sha>`; Bitbucket needs its own equivalent or an `unaskable` refusal). That is a second shell change, which contradicts line 44 ("This is the plan's one shell change") and line 52.

### F2 (MEDIUM): on the Jenkins arm the check state is not for the row's SHA

Slice 1 says "the check state is recorded for that SHA". `plot-host.sh:4096-4103` states that on `CI: jenkins` the checks come from Jenkins "joined on branch name", and `statusCheckRollup` is not requested. Adding `headRefOid` to that call gives a SHA, but the Jenkins colour can belong to an earlier build of the same branch. Then a row reads `green@<new sha>` from an old build, which is the exact defect the plan exists to remove, and F1's merge gate trusts it. The plan must say that the Jenkins arm (and Bitbucket, which has no rollup) records checks as `unknown` for the SHA unless the build is matched to the SHA. The open question at line 62 asks this only for the default branch, not for PR rows.

### F3 (MEDIUM): the default branch's CI row goes into the git host's store

Slice 2 adds a `defaultBranch` entry to "the index". The index is the host connector's file: `PrIndexSchema.connector` is "`github`, `bitbucket`" (`pr-index.ts:89`), and `writePrStore(connector, …)` reads and writes it per connector (`pr-refresh.ts:1229-1252`). The answer comes from the build connector through `runForSha`. CLAUDE.md, *The Layering Rule*, keeps the two connectors apart: two accounts, two budgets, and "neither ever sees the other's" state. A CI answer in the host's file breaks that split. It also adds a second fold path into one file on a second cadence, which CLAUDE.md names as the race ("`rename` makes each write atomic and not the read-fold-write sequence around it"). And because `PrIndexSchema` is `.strict()`, slice 2 changes the store's shape after slice 1 set it to v4, so slice 2 needs v5 or slice 1 must reserve the field. The plan says neither. Amendment: put the default branch's reading in its own store, keyed by the build connector, with its own version.

### F4 (MEDIUM): the mod reacts to an event that the feed does not write

Slice 7 (line 50) shows a toast on "a new `PLOT-BLOCKED`". The event kinds at line 46 are only host readings: `pr-opened`, `pr-ready`, `checks-changed`, `merged`, `closed`, `head-moved`, `default-branch-changed`. A `PLOT-BLOCKED` marker is a desk fact (an Agent fact, by CLAUDE.md's state split), and line 61 moves agent-lifecycle sites to "a separate plan … because the worker loop and not the host produces them". Either remove `PLOT-BLOCKED` from slice 7 or add a kind and name its producer. In the same way, Motivation line 32 wants an event that says "merged, branch deleted", but no kind reports a branch deletion.

### F5 (MEDIUM): the merge slice's external wait blocks the mod slice, which the Notes say it does not

Line 96: "the merge slice sits after the board slices so that this wait holds up nothing else." Slice order is strict: a wave is eligible only when "every prior wave is complete" (`skills/plot-pulse/SKILL.md:101`). Slice 7 comes after slice 6, so slice 6's wait on `feature/the-controllers-are-commands` (`docs/plans/2026-10-09-the-fleet-runs-without-the-board.md:127`) also holds slice 7. The wait is prose only. `rules/eligible.ts:226` knows the prerequisites in one plan and no cross-plan dependency, so auto-dispatch hands slice 6 over as soon as slice 5 merges, whether the other plan has landed or not. Amendment: move the merge slice to the end, and hold its dispatch until `the-controllers-are-commands` has merged, or split it into its own plan.

### F6 (MEDIUM): the first fold after the version bump emits every PR as an event

`writePrStore` reads an unreadable or wrong-version store as absent (`pr-refresh.ts:1233-1237`, "merged into as if it were absent"). Slice 1 moves the version to 4, so every v3 store reads as absent on the first fold. With `indexTransitions(null, after)`, every row becomes an event. The same flood happens after each unreadable store and after each full read that replaces the rows. Slice 7 starts a turn per named event kind, so a flood starts many turns. Slice 3 must define what `before = null` emits (nothing, or one `index-reset`). A unit test must assert it.

### F7 (LOW): the board's event route and render sites do nothing when no fleet runs

When no fleet runs, the board folds in memory and writes no store (`board/src/server/fleet.ts:1745-1753`), so no feed and no `defaultBranch` row exist. Line 47 covers the poll fallback ("a board with no feed behaves as today"). The banner's answer in that case must be `unknown`, which hides the banner, and not `green`. State this in slice 5.

### F8 (LOW): the plan names the supervisor `plot-fleetd`

The process names exist (`registryd-main.ts:2093` writes `fleetd.log`), so this is not a defect. But CLAUDE.md's *Architecture* names `plot-registryd`. Use one name in the plan.

### Rules the plan keeps

- One writer (line 42) agrees with `one-pr-index-writer.test.ts`. The event file has one appender, and listeners only read.
- "The index never says no": `unknown holds nothing` (line 45) and "a v3 store reads as 'ask the host'" (line 44) both agree with it.
- Holding hand-overs on a red default branch is reversible. By the blast-radius reasoning in *One Answer To "Did This Land"*, a non-terminal reading may hold a reversible step.
- The shell-line ratchet: slice 1 names the equal removal that `scripts/check-shell-lines.sh` requires. The plan is right that the gate stores no number and allows no exemption.
- Layering: every new decision is a domain rule, and the SSE route reads a file, not the host.
- Manifesto principle 5 and checklist question 2: the mod is optional and the fleet does not depend on it.

## 4. Slice order

Slices 1 to 5 are in a correct order: the badge needs slice 1, the banner needs slice 2, and the feed pane needs slices 3 and 4. Each of these can merge alone and leave `main` working, because the 30 s poll stays. The order is wrong only at slices 6 and 7 (F5).

## 5. Most important amendment

Rewrite slice 6. The merge must bind the SHA at the host: `pr-merge` gains `--match-head-commit <sha>` (and a Bitbucket equivalent or an `unaskable` refusal), and the gate re-reads the head and checks from the host before it writes, because the index row is a non-terminal answer. Declare this as the plan's second shell change, with its own equal line removal. Correct lines 44 and 52 so they say this. If the plan wants to merge from index answers alone, it must amend *A Decision Reads The Index* explicitly and say why a merge is not a destructive decision. Fix F2 in the same pass, because the merge gate trusts F2's `checks`.

## Amendments

1. Slice 6: bind the SHA in `pr-merge` and revalidate the head and checks at the host before the merge (F1). Restate the shell-change count at lines 44 and 52.
2. Slice 1: record `checks` for `headSha` only where the reading is bound to that SHA. On Jenkins and Bitbucket, record `unknown` or match the build to the SHA (F2).
3. Slice 2: keep the default branch's CI reading in its own store, keyed by the build connector, with its own version. Do not add it to the host's v4 schema (F3).
4. Slice 7: remove `PLOT-BLOCKED`, or add an event kind and name its producer. Add a kind for a deleted branch, or remove that row from Motivation (F4).
5. Move the merge slice after the mod slice. Make its cross-plan wait hold the dispatch, or move the slice to a separate plan (F5).
6. Slice 3: define what `indexTransitions(null, after)` emits, and add a unit test for it (F6).
7. Slice 5: the banner reads `unknown` when there is no `defaultBranch` reading (F7).

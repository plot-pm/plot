## Implementation brief — row-placement-and-wording-1677-1791 (wave 1: Placement and row text)

- **Plan (canonical):** [docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md](../../docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md) on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1859 merged
- **Branch:** `bug/row-placement-quiet-and-wait-bound` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on `main`)

This is wave 1 of 3. The two later waves (`bug/row-host-unresolved-and-checks-wording`, `bug/row-review-followups`) wait on nothing in this branch and touch other files; nothing waits on it.

### What to build

Two defects in how *Waiting on you* places and words a row, both measured and both still present on `main` at `985029c4b`.

**#1758 — a `quiet` row lands in *Waiting on you*.** Measured 2026-10-15 on `quatico/ewz-kus-portal`: 15 rows with `quietKind: "quiet"` and `group: "waiting-on-you"`, last commits 2 to 339 days old, none in *Quiet*. The cause is in `classifyGroup` (`packages/board/src/server/fleet.ts`, the wip fallthrough near line 4170): `group` is `hasMergedPr ? 'done' : !quietNeedsPerson(readings) ? 'quiet' : 'waiting-on-you'`, and `quietNeedsPerson` (`packages/domain/src/rules/quiet.ts:202`) answers `kind !== 'closed-pr' && kind !== 'merged'`. So kinds `quiet`, `abandoned` and `orphaned-claim` all keep a person's attention. The label `quiet` and the section `Quiet` then disagree. Decide the placement of a `quiet` kind in the domain (a rule in `rules/quiet.ts` or a sibling, with a unit test), and have `fleet.ts` call it rather than compute it. `abandoned` keeps its current placement: it is the one kind the code comments name as needing a person (revive or drop).

**#1743 / #1792 MEDIUM — a desk that ended cleanly at the wait bound reads as a blocked, stopped agent.** Wave 1 of the earlier plan (#1748) removed the `PLOT-BLOCKED.md` marker, and #1791 pinned the registry drop of a clean ended desk. What #1791 did not build, per its own plot-review finding: the row text reading the ending record ("ended after <h> h with no slice offered", plus the next action), the domain placement rule with a unit test, and one browser test proving the row is absent. `grep "no slice offered" packages/*/src` returns one hit, the worker-loop log line at `packages/fleet/src/server/entry/worker-loop.ts:1611`; no row-text producer exists. Read `.plot/briefs/an-ended-desk-is-not-waiting-on-you.md` first: its three "Measure first" discrepancies (which state the motivating desks read; where the ending record is read; `unplaced` is a person exit because `deskState` checks `manifestKnown` before any marker) still hold and are the reason a fix at the wrong layer passes its unit test and never moves the row.

### Settled — do not re-derive

**Placement is a domain property.** `CLAUDE.md`, *Every rendered state is a domain property*: the decision lives in `packages/domain`, the row text is produced there and printed by the component. A branch that computes the section or the wording in `.tsx` is the defect, not the fix. One browser test per behaviour proves it is *seen*; the unit test proves it is *decided*.

**Do not touch the marker writers or the loop.** The earlier brief closed `resetOnto` (`adapters/trees/trees-git.ts`), `adapters/desk/desk-fs.ts`, `ending-action.ts`'s table and `agent-loop.ts` ROW 2 with a trace each. ROW 2 writes nothing by design (`workflows-agent-loop.test.ts` asserts `writes` is `[]`).

**Open question 1 of the plan (fleetd at `agents=0`) is out of this slice.** The plan defaults the design question to no. Do not make fleetd start an agent here. Record in the plan's Open Questions that the answer is a follow-up issue, and file it with the `plot` label rather than deciding it in a placement fix.

**Open question 3 is a work instruction:** re-check each LOW finding on `main` before changing code. In this wave that applies to #1792's LOWs only if they land in the files you touch; the rest belong to wave 3.

**Carried-over rules.** *Absent is not false*: a desk with no ending record keeps its current placement, and a missing record must not read as a clean end. `mergedAt` is the only "did it land" answer (`rules/reapable.ts`); add no ancestry check. A `quietKind` of `null` is the common answer and is not a failure (`rowQuietKind`).

**Vocabulary.** Arrow functions for every function you write. TSDoc states behaviour only. Say `Slice`, never `Wave`, for new names. A desk's workflow state is an Agent fact, not a Worker fact.

### Done when

The plan's slice line is the specification: `quiet` rows land in *Quiet* (#1758); a clean wait-bound end reads from the ending record and not as blocked (#1743, #1792 MEDIUM). Assertions a naive implementation passes without:

- **`abandoned` and `orphaned-claim` keep their placement.** Moving every kind to *Quiet* passes the `quiet` test and hides the one kind that needs a person.
- **A desk that ended at the bound but holds unlanded work, a dirty tree, or a real `PLOT-BLOCKED` question stays in *Waiting on you*.** Hiding every `bound` ending passes the happy path and buries work.
- **A desk with no ending record keeps its current placement.** Catches absent read as clean.
- **The unit test asserts the section and the note for a row built from the fixture the plan describes** (merged slice, clean tree, `reason: bound`), not only a hand-built readings object. Otherwise the rule passes and the row never moves.
- **One browser test per behaviour** (a `quiet` row under *Quiet*; the ended desk absent from *Waiting on you*), each failing when the rule is reverted.

Plus: add a changeset (description first, `bumps:` block last, package `plot`; name the plan on a `plan:` line inside the block). Commit no rebuilt `board-server.mjs` (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite locally and no `test:board` while the operator's board is open. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth against the merge base: remove shell elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Placement and row text` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/quiet.ts` and a new or existing placement rule beside it, `packages/domain/src/rules/desk-lifecycle.ts` and `desk-manifest.ts`, their tests, the `classifyGroup` wip fallthrough and `rowQuietKind` in `packages/board/src/server/fleet.ts`, `packages/board/src/app/lib/agent-rows/` (`working-agents.ts`, `rows.tsx`, `sections.ts`), and the browser tests for those rows.

Out of scope, verified at dispatch against the plans in flight: `bug/the-tick-asks-nothing-for-an-ended-desk` (plan `fleetd-scan-cost-and-read-cadence`, claimed 2026-10-16) owns the registryd tick and `packages/fleet`; do not edit the tick or `worker-loop.ts`. Waves 2 and 3 of this plan own the host-backend pass-through, the checks-commit wording, `ownerOf`, `StoriesTab.tsx`, and the plan-head PR link. `fleet.ts` is large and shared, so keep edits to the two arms named above and rebase before pushing.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

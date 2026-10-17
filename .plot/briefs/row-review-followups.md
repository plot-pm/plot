## Implementation brief — row-placement-and-wording-1677-1791 (wave 3: Review follow-ups)

- **Plan (canonical):** docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1859 merged
- **Branch:** `bug/row-review-followups` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This branch is the plan's third and last wave. Both prior waves are merged
(PR #1902 "Placement and row text", PR #1933 "Host and wording") — nothing
waits on this branch, and it waits on nothing but `main` as it stands today.

### What to build

Five review follow-ups left open on main, grouped by file rather than by
issue — each is a small, independently-landable fix:

**#1760 — plan PR link, tally, slice groups** (`packages/board/src/app/lib/agent-rows/rows.tsx` and `packages/board/src/app/components/AgentList.tsx`)
- `tupleFromPlan` at `rows.tsx:622-634` passes no `branch`/PR fields, so `PlanRow` never receives `planShape.head` — only `planShape.heads`/`.loose` are consumed in `AgentList.tsx`. A plan's own PR link (e.g. #1738) is dropped at the head.
- `rowCount: group.rows.length` at `rows.tsx:633` counts the plan row itself, inflating the head's `(N)` tally by one.
- `AgentList.tsx:1649` already computes `planShape` (which holds `.slices`), but line 1656 independently recomputes `sliceGroupsFor(group.rows, key, slices)` as `planSliceGroups` instead of reading `planShape` for it.
- The stale comment at `AgentList.tsx:1633-1648` ("A PLAN GROUP IS HOMOGENEOUS BY CONSTRUCTION … falls back to the text heading") still contradicts `AgentList.tsx:1622-1623`, where the fallback is explicitly disabled for `waiting-on-you`. Fix the comment along with the behavior it describes.

**#1790 — ticket-lanes ownership and dead code** (`packages/domain/src/rules/ticket-lanes.ts`, `packages/board/src/app/lib/agent-rows/lanes-for-reader.ts`, `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `packages/board/src/app/components/StoriesTab.tsx`)
- `ownerOf` (`ticket-lanes.ts:89-99`, first-assignee read at line 93) reads only the first assignee — a ticket with several assignees is owned by whichever happens to be first.
- `ownedFromStory` is exported unused at `mine-filter.ts:116`, with a private duplicate kept at `lanes-for-reader.ts:63`. Remove the dead export or the duplicate, not both left in place.
- `hiddenByTopic` (`lanes-for-reader.ts:14,31,33`) does double duty under one name, forcing `StoriesTab.tsx:188,404-406` to run a second `ownedStoryByLane` lookup just to disambiguate.
- Redundant re-export at `lanes-for-reader.ts:110`.
- `StoriesTab.tsx:169-178` reshapes `lanesForReader`'s output back into the shape `lanesForTopic` already produces — a reshape with no behavior change, just extra surface.
- **Already fixed, do not re-touch:** the HIGH finding from PR #1789's review (raw tracker-account spelling misread as `theirs`) — `lanes-for-reader.ts:50-53` already routes through `resolvedOwner`.

**#1793 — Discovery/Planning disagreement and small gaps** (`lanes-for-reader.ts`, `packages/board/src/App.tsx`, `packages/board/src/app/components/StoriesTab.tsx`, `packages/domain/src/rules/ownership.ts`, `packages/domain/test/ownership.test.ts`)
- Discovery (`lanes-for-reader.ts` via `resolvedOwner`) and Planning (`ticketsForReader`/`ownership.ts`'s host-login branch) disagree on host-login estates — #1790's fix did not touch this; same root cause, different code path.
- `App.tsx:1218` passes `reader={readerFrom(board.server)}` inline, a fresh object every render, defeating the `useMemo` in `StoriesTab.tsx:159-162`.
- Review-history comments still shipped in source: `lanes-for-reader.ts:43` ("the prior shape here") and `packages/domain/test/ownership.test.ts:346` ("The scenario the HIGH review finding names") — both describe past review conversation rather than current behavior; remove them.
- Untested empty-lane strings at `StoriesTab.tsx:334-337,402-406`.
- Stale checkbox comment at `App.tsx:1180-1183` — it describes plan cards only, but the guarding condition at line 1184 (`tab === 'planning' || tab === 'discovery'`) already covers Discovery too.
- Awkward wording at `ticket-lanes.ts:19` ("the raw, unresolved spelling otherwise verbatim").

**Test hygiene from #1792** (`packages/fleet/test/unit/registry.test.ts`)
- Test title at line 1397, "keeps the desk, as `failed`, while it carries a PLOT-BLOCKED marker" — `bashCleanliness` doesn't actually special-case the marker name; any untracked file passes the same assertion, so the title overclaims what the test proves.
- The bound-specific fixture `.plot-worker.ending.json` (line 1379) is written but never asserted on — exit 124 alone drives the test's result, so the fixture is dead weight or the assertion is missing.
- `pid: '99999'` at line 1376 breaks the file's own dead-pid convention — every other dead-pid fixture in this file uses `999996`–`999999` (see lines 1014–1084).
- **Already fixed, do not re-touch:** #1792's changeset-wording finding — the changeset is already `.changeset/ended-desk-leaves-waiting.md` with user-facing prose, not test internals. The row-text, domain-placement-rule and browser-test parts of #1792 were wave 1's job (PR #1902) and are done.

#1742's own ask ("confirm the plan head shows the plan PR link") is the same
gap #1760 names above — fixing #1760's `tupleFromPlan`/`planShape.head` wiring
closes #1742 too; there is nothing left to do under #1742 once #1760 is fixed.

### Decisions already settled — do not re-derive them

- **Grouping is by component, not by issue.** The plan's Design section says
  placement and wording are decided in the domain, so each fix is a domain
  property with a unit test and a browser test proving the row shows it
  (`CLAUDE.md`, *Every rendered state is a domain property*). The five groups
  above follow the files that decide the behavior, not the five issue
  numbers — several issues land in the same file and should be one commit.
- **`rows.tsx` and `AgentList.tsx` were already touched by wave 1** (PR #1902
  edited `rows.tsx`). That is not a collision to route around — wave 1 is
  merged, this branch starts from current `main`, and the #1760 fix is
  additive to what's already there. Read the current file, not the PR diff.
- **Scope is explicitly the LOW/MEDIUM findings still open on main as of
  2026-10-17**, verified fresh rather than assumed from the issue text — the
  plan's own Open Questions flag that some findings in #1790/#1792/#1793 may
  already be gone. The findings listed above were checked against current
  `origin/main` (`a1ef25ed6`) before this brief was written; the "already
  fixed" callouts are what that check found gone. Don't re-verify the whole
  list from scratch — verify only if something listed above doesn't match
  what you find in the file.
- **Absent is not false.** Carried over from related work in this repo: a
  missing field, record, or marker means "nothing answered," never "no" —
  read the exit code or the explicit absence marker, not silence, as the
  negative case. Relevant here because several of these fixes touch
  optional/missing-value handling (`entry.backend ?? ''`-style code in the
  adjacent wave, `ownerOf`'s first-assignee fallback, empty-lane strings).
- **Not in scope:** the three Open Questions the plan leaves unresolved
  (#1903 follow-up for fleetd restart behavior; whether #1679 M3's changeset
  is moot in 2.27.0; re-checking LOW findings not listed above). If any of
  those turn out to matter while working this branch, report them — don't
  decide them here.

### Done when

The plan's `## Done when` list doesn't exist as a separate section — the
Slices line for this branch is the specification: "plan PR link on the plan
head, tally and slice-group fixes (#1742, #1760); first-assignee ownership
and dead code (#1790); Discovery/Planning host-login agreement, memoisation,
comments and empty-lane tests (#1793); test hygiene from #1792."

Concretely, done means:
- `tupleFromPlan`/`PlanRow` carries the plan's own PR link through to the
  rendered head, the tally no longer counts the plan row itself, and
  `AgentList.tsx` reads slice groups from `planShape` rather than
  recomputing them — each with a unit test (catches a regression to the old
  "head drops its own PR" or "tally off by one" behavior) and the existing
  browser test suite extended if no test currently renders a plan head with
  its own PR.
- `ownerOf` considers more than the first assignee (domain unit test with a
  multi-assignee fixture — catches silently picking the wrong owner), dead
  code (`ownedFromStory` duplicate, redundant re-export) is actually removed
  rather than just no longer imported, and `hiddenByTopic`'s double duty is
  resolved so `StoriesTab.tsx` needs no second lookup.
- Discovery and Planning agree on a host-login estate's ownership (a test
  that exercises both paths against the same fixture and asserts equal
  results — catches the two paths silently drifting apart again), the
  `useMemo` in `StoriesTab.tsx` actually memoises (pass a stable `reader`
  from `App.tsx`), stale review-history comments are gone, and the
  previously-untested empty-lane strings have a test.
- `registry.test.ts`'s three findings are fixed: the test title matches what
  it actually asserts (or the assertion is extended to match the title),
  the `.plot-worker.ending.json` fixture is either asserted on or removed,
  and the pid literal follows the file's `999996`–`999999` dead-pid
  convention.

Plus: a changeset recording this fix (user-facing prose first, `bumps:`
block last — the first line after frontmatter is what the changelog
publishes). Run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it finds the tests and typecheck
for whatever you changed. The suites in `CI suites` run in CI on every PR;
a failure there comes back as a correction. Don't run a full suite locally.

This branch touches no `.sh` file, so `scripts/check-shell-lines.sh`'s
shell-growth gate doesn't apply — no shell budget to pay down.

### Bookkeeping

Open the PR through the controller once there's a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it takes its title from the last commit subject
and skips the plan/brief linking `plot-open-pr.sh` does automatically.

When the PR exists, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (`### Review follow-ups` heading, the
`bug/row-review-followups` line) — this is the last branch in the plan, so
once this merges and its slice line carries its PR, `/plot-deliver
row-placement-and-wording-1677-1791` can run.

Push the first real commit as soon as it exists — don't hold commits local
until the whole branch is done.

### Scope guard

This branch owns:
- `packages/board/src/app/lib/agent-rows/rows.tsx`
- `packages/board/src/app/components/AgentList.tsx`
- `packages/board/src/app/lib/agent-rows/lanes-for-reader.ts`
- `packages/board/src/app/lib/agent-rows/mine-filter.ts`
- `packages/board/src/app/components/StoriesTab.tsx`
- `packages/board/src/App.tsx`
- `packages/domain/src/rules/ticket-lanes.ts`
- `packages/domain/src/rules/ownership.ts` and its test
- `packages/fleet/test/unit/registry.test.ts`

No other branch in this plan is in flight — both sibling waves
(`bug/row-placement-quiet-and-wait-bound`, PR #1902;
`bug/row-host-unresolved-and-checks-wording`, PR #1933) are merged, verified
via `gh pr view` before this brief was written. There is no concurrent
collision to track; the only overlap is sequential (this branch's files
were last touched by wave 1's merged commit, not by anything still open).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

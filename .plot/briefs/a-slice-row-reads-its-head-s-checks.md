## Implementation brief — an-issue-shows-its-plan-s (wave: Head checks)

- **Plan (canonical):** docs/plans/2026-11-01-an-issue-shows-its-plan-s.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2998 merged
- **Branch:** `bug/a-slice-row-reads-its-head-s-checks` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This is the plan's last unstarted slice (Plan source, Plan comment, Released
labels, Added issues and Finding tickets already carry `Started:` records).
Its `Added issues` and `Finding tickets` siblings wait on `Plan comment`; this
slice waits on nothing and touches a disjoint area (`pr-row.ts`, `fleet.ts`'s
checks-rendering call sites), so it can run concurrently with any of them.

### What to build

A Delivery row can show a PR's OLD failing checks for minutes after a push
fixed them, because the row never compares which commit the checks were
computed for against which commit the branch now points at. Measured
2026-11-01: slice PR #2996 failed CI on head `dc98f4a02` at 12:44 UTC; the desk
pushed `75da18f94` at 13:03; the row kept showing "PR #2996, checks failing"
until about 13:10 — a 7-minute window where the desk looked broken although it
had already fixed itself.

The fix: read the PR index's `checksSha` (the commit the checks rollup was
computed for) against the branch's actual tip (`refs/remotes/origin/<branch>`,
read locally, zero host calls), and when they disagree, say "new head, checks
not yet read" instead of repeating the stale checks word. This is a **pure
rule change plus three call-site wires** — no new data needs fetching, because
every piece already exists:

- `PrRecord.checksSha` already exists (`packages/fleet/src/shared/pr-refresh.ts:445`,
  flowed through `pr-refresh.ts:1161/1197/1228`) and reaches `fleet.ts` on the
  same `PrRecord` it already reads for `mergeable`/`checks`.
- `Refs.branchTips` already exists (`packages/domain/src/ports/refs.ts:463`)
  and `fleet.ts` already imports `Refs` and calls other `refs.*` methods
  (`:1313`, `:1597` onward) — it has never called `branchTips`.
  `board.ts:1113` is the existing call-shape to copy: one
  `refs.branchTips(['refs/remotes/origin/<prefix>*'])`, `tip.ok` checked,
  filtered by branch name.

So this slice adds no adapter, no port method and no index field. It is
entirely in `packages/domain/src/rules/pr-row.ts` (the rule) and
`packages/board/src/server/fleet.ts` (three callers plus one `branchTips`
read), with `stuck.ts` inheriting the fix for free because it reads
`prRowPlacement`'s answer rather than re-deriving `checks`.

### Root-cause step first — do this before writing the fix

The plan requires confirming the mechanism before patching it, and recording
that confirmation in the PR body. Read:

- The PR index row for the slice in question at the time of a stale read —
  compare its `headSince`/`checksSha` against the host's actual push time.
  The plan's own measurement (#2996, gap 5 in the plan's Motivation section)
  already did this: `headSince` for `75da18f94` was `2026-11-01T13:09:35.183Z`
  — six minutes after the 13:03 push — because the index refreshes on its own
  cadence (`prRefreshMsFor`, `packages/fleet/src/shared/pr-refresh.ts:747`,
  477s measured that day), not on every push.
- `skills/plot/scripts/plot-fleet-scan.sh:385-388` fetches
  `+refs/heads/*:refs/remotes/origin/*` on every scan pass (every few
  seconds), so the LOCAL ref already names the new head long before the PR
  index catches up. That gap between "local ref moved" and "index caught up"
  is exactly what this slice makes visible instead of silently wrong.

Confirm this still holds (it is a cadence fact, not a one-off incident) by
checking `prRefreshMsFor`'s current value and, if a live board is running,
one real stale-then-settled row. Record the confirmation — or what changed —
in the PR body before the fix.

### The decisions the plan settles — do not re-derive them

**Decide by commit, never by `updatedAt` or recency.** The rule compares
`checksSha === tip`, nothing else. An index reading can be *newer* than the
branch's current tip and still be naming an OLDER head (a slow re-fetch that
raced a push) — the plan's own "Reverse" test case covers this: a newer
`updatedAt` on a stale `checksSha` must still read as stale. Comparing
timestamps instead of commit identity would get this backwards.

**Silent on hosts with no `checksSha`.** Jenkins, Bitbucket and the plain
listing bind checks per-branch, not per-commit (`entities/pr-index.ts:74-79`),
so `checksSha` is absent on their rows by design — not a bug to work around.
Where `checksSha` is absent, or no tip was read, the rule answers exactly as
it does today. Only add the new clause where BOTH are present and disagree;
never regress a host that can't supply the field.

**No fourth state, no new `Checks` enum value.** The new clause is a THIRD
possible placement outcome alongside today's `failing`/`green`/etc, decided
purely by whether `checksSha` matches the tip — it is not a new `checks` word
and must not be threaded through `ChecksSchema`.

**`stuck.ts`'s `ci-failing` state must not fire on a stale reading.** `stuck.ts`
builds its `ci-failing` row (`packages/board/src/server/stuck.ts:297-313`) from
the same checks word `prRowPlacement` answers from. Once `prRowPlacement`
returns the new clause instead of `failing` for a stale `checksSha`, `stuck.ts`
inherits the fix with no separate change — confirm this with a test, do not
add a second comparison inside `stuck.ts`.

**Zero host calls.** The tip read is local (`refs/remotes/origin/<branch>`),
already fetched by the scan's existing `git fetch`. This slice adds no `gh`/`bb`
call and no new adapter method.

### Done when

The plan's `## Done when` table names five rows for this slice (search
"Head checks" in the table) — implement exactly those, no more:

1. **Forward:** `checksSha` names the OLD head, tip names the NEW head, checks
   say `failing` → placement answers `waiting-on-machine` /
   `new head, checks not yet read` (NOT `waiting-on-you` / `checks failing` as
   today).
2. **Bound:** `checksSha` equals tip, checks say `failing` → placement answers
   exactly as today (`waiting-on-you` / `checks failing`). This is the
   regression guard — the common case (checks genuinely failing on the
   current head) must not change.
3. **Reverse:** `checksSha` names the OLD head but carries a NEWER `updatedAt`
   than the tip's own read — still answers by the stale `checksSha`, proving
   the rule ignores timestamps.
4. **No `checksSha`:** Bitbucket-shaped row with `checks: 'failing'` and no
   `checksSha` field at all → unchanged (`checks failing`), proving the new
   clause never fires where the host can't bind checks to a commit.
5. **Fleet wiring:** a fleet sandbox where the index holds the OLD head and
   the local ref has moved → the Delivery row is NOT in `waiting-on-you`, and
   `stuckState` does NOT report `ci-failing`.

Tests: `packages/domain/test/pr-row.test.ts` (rows 1–4),
`packages/board/test/unit/fleet.test.ts` (row 5). Run via
`pnpm --filter @plot-pm/domain exec vitest run pr-row.test.ts` and
`pnpm --filter @plot-pm/board exec vitest related --run --project parallel <changed files>`.

Plus the repo's standing gates: a changeset (`plot`: patch — this is a bug
fix to row placement, not a new feature), and no generated bundle in the diff
(`scripts/check-no-bundle-diff.sh` — do not commit a `board-server.mjs`
rebuild; the CI job rebuilds it).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — the suites named in the repo's `CI suites` config
key run in CI only, and a failure there comes back as a correction. Do not
run the full local suite list yourself.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under
`skills/` is longer than at its merge base. This slice is pure TypeScript
(`pr-row.ts`, `fleet.ts`, `stuck.ts` consumers) — it should touch no `.sh`
file and this gate should cost nothing. If a shell change turns out to be
needed, growth must be paid for in the same change (remove shell elsewhere,
or move the rule into the domain behind a bundle).

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # non-draft once ready
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` directly — it takes its title from the last commit
subject rather than the plan's wave heading, and the plan-state gate expects
the controller's write shape.

When the PR is created, append `→ #<number>` to this branch's line in
`docs/plans/2026-11-01-an-issue-shows-its-plan-s.md`'s `## Slices` → `### Head
checks` section — the line currently ends with "If the root cause places the
fix in `packages/fleet/src/shared/fleet-scan.ts`, the slice line gains a wait
on `feature/the-scan-script-is-a-launcher` before dispatch." Per the
root-cause step above, the fix lands in `pr-row.ts`/`fleet.ts`, not
`fleet-scan.ts`, so that conditional wait does not apply — note this in the
PR body rather than silently dropping it.

### Scope guard

**This branch owns:** `packages/domain/src/rules/pr-row.ts` (the
`PrRowReadings` interface and `prRowPlacement` function), the three
`prRowPlacement(...)` call sites in `packages/board/src/server/fleet.ts`
(currently at lines 3724, 4254 and 5229 — re-grep before editing, this file
has had 24 commits in the week before this plan was approved and line numbers
drift), and the new `refs.branchTips` read `fleet.ts` needs to supply `tip`
to those calls. `packages/board/src/server/stuck.ts` is read-only context —
expect no edit there, only a passing test proving it inherits the fix.

**Other branches in flight on this plan** (verify with
`git ls-remote --heads origin 'bug/*' 'infra/*'` before starting, not
guessed): `bug/an-issue-reads-its-plan-from-main` (#3003, `fleet.ts`'s
`planMetasOf`/`referencedIssues`), `bug/the-plan-comment-has-one-writer`
(#3007, tracker adapter), `infra/released-issues-carry-their-label` (#3012,
domain rules + new entry script), `bug/an-added-issue-owes-its-phase` (#3036,
state-transition + gate), `bug/settled-finding-tickets-close` (#3042, review
ticket rules). None of them touch `pr-row.ts` or the `prRowPlacement` call
sites — `bug/an-issue-reads-its-plan-from-main` touches `fleet.ts` too (the
plan source section, not checks rendering), so rebase on `main` before
opening the PR and expect a textual (not semantic) conflict if that sibling
merges first.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

## Implementation brief — a-desk-continuation-skips-its-run (wave: Independent)

- **Plan (canonical):** docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2491 merged
- **Branch:** `bug/drop-reads-the-boards-branch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr (plan's `Review:` field)

This branch is in the plan's "Independent" wave, alongside
`bug/mergeability-uses-the-prs-own-base`. Neither waits on the other or on
the "Continuation" wave above it. No other branch touches `drop.ts`, so
there is nothing to sequence here.

### What to build

`packages/board/src/server/drop.ts:188` reads `entry.branch` — the
manifest's own `branch` field — to decide whether a `waiting` desk's branch
has merged. `packages/fleet/src/shared/registry.ts:903-911` asks the same
question through `branchOf(entry)`, which first checks the branch `git
worktree list` reports for that worktree path (`deskBranches`, built at
`registry.ts:875-887`), and falls back to `entry.branch` only when no
worktree is listed for that path. The two call the same domain rule,
`deskBranchMerged` (`packages/domain/src/rules/merged-desk.ts:33`), but hand
it different branch strings for the identical desk.

The manifest's `branch` field goes empty once a desk is freed:
`agents-fs.ts`'s `clearAssignment` (`:390-410`) writes `manifest.branch = ''`
to the manifest file, matching the shell's `clear_manifest_branch`. A desk
that is still `waiting` (holding a `PLOT-BLOCKED` marker) but whose
assignment was cleared therefore has `entry.branch === ''`, so
`deskBranchMerged(index, '')` is `false` by construction
(`merged-desk.ts:33` short-circuits on `branch !== ''`) — never mind what the
PR index says. The desk reads `waiting` forever and `LIVE_STATES` refuses the
drop with "the agent is still running," even though the branch checked out
on disk has a MERGED row.

Fix: make `drop.ts`'s `classifyState` resolve the branch the same way
`registry.ts` does — from the worktree's actual checked-out branch, falling
back to `entry.branch` only when that's unavailable — before calling
`deskBranchMerged`. The natural shape is to give `drop.ts` access to the
same `branchOf`-style resolution `registry.ts` builds (reading
`git worktree list` for `entry.worktree`), rather than inventing a second
way to ask it.

### The decision the plan settles — do not re-derive it

**This is a one-line divergence between two callers of one rule, not a
defect in `deskBranchMerged` itself.** `merged-desk.test.ts` already proves
the rule is correct for whatever branch string it is given — `deskBranchMerged(store([row({ head: '' })]), '')` is asserted `false`
on purpose, because an empty branch must never read as "known not merged"
either. The fix is entirely about which branch string each caller passes
in, not about the rule's logic. Resist the pull to add a special case
inside `deskBranchMerged` for an empty manifest branch — that would weaken
the rule for every other caller to patch one caller's stale input.

### Done when

The plan's `## Done when` is not written as a separate section in this
plan — the Design section's slice 3 line is the specification: *"`drop.ts`
reads the same branch for `deskBranchMerged` as the board, and the default
PR-index reader test asserts a result that failed before the change."*
Concretely:

- `classifyState` in `drop.ts` resolves the desk's checked-out branch (via
  worktree listing, falling back to `entry.branch`) before calling
  `deskBranchMerged`, matching `registry.ts`'s `branchOf`.
- A test in `drop.test.ts` exercises a `waiting` desk whose manifest
  `branch` is `''` (post-seal) but whose worktree is checked out on a
  branch that has a MERGED row in the PR index — and asserts the drop
  succeeds (or the state reads `finished`), where before the fix it would
  have stayed `waiting` and refused. This is the regression test the
  divergence needs: without it, a fix that silently stops reading
  `entry.branch` at all (rather than resolving the worktree's branch) would
  still pass every existing test, because none of them seal a manifest
  before dropping it.
- No change to `merged-desk.ts` or `merged-desk.test.ts` — the rule is
  already correct; only its caller's input changes.

Plus: the repo's gates. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it names the tests that touch `drop.ts` and the
related-tests/typecheck for `packages/board`. The suites in the `CI suites`
config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain
coverage, `node --test test/reconcile/*.test.mjs`) run in CI on every PR;
do not run them locally as a matter of course — `test:e2e` in particular
dispatches real workers and is CI's gate, not a local one. List no full
suite in your own checks.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not
in play.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan, titles the PR from this wave, and refuses a branch no
plan names or one that already carries a PR. When the PR is created,
append `→ #<number>` to this branch's line in the plan's `## Slices`
section (under "Independent"). Push the first real commit as soon as it
exists — do not hold commits locally until the change is "done."

### Scope guard

This branch owns:

- `packages/board/src/server/drop.ts`
- `packages/board/test/unit/drop.test.ts`

It must not touch `packages/fleet/src/shared/continuation.ts`,
`packages/fleet/src/shared/registry.ts`,
`packages/domain/src/adapters/trees/trees-git.ts`, or
`packages/fleet/src/server/entry/worker-loop.ts` — those belong to the
plan's other four branches (`bug/continuation-reads-the-loops-run-limits`,
`bug/a-failed-continuation-leaves-the-desk-as-found`,
`bug/mergeability-uses-the-prs-own-base`,
`bug/continuation-tests-assert-their-names`). `registry.ts` is read-only
reference here, for the shape of `branchOf` — not a file this slice edits.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

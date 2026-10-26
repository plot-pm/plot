## Implementation brief — a-desk-continuation-skips-its-run (slice: Independent — mergeability)

- **Plan (canonical):** [docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md](../../docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2491 merged
- **Branch:** `bug/mergeability-uses-the-prs-own-base` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plan's `Review:` is `pr` — standard PR review

This branch is listed under `## Slices` → `Independent`, so it carries no
`waits:` of its own. `bug/continuation-tests-assert-their-names` (Tests and
comments) waits on this branch finishing, alongside
`bug/a-failed-continuation-leaves-the-desk-as-found` — so this branch's
mergeable-reading shape and its conflict-correction wording need to be
settled before that slice can assert against them.

### What to build

Three related defects, all about the worker loop's mergeability reading,
named in the plan's Design slice 4 and Motivation's "Wrong branch and wrong
base" paragraph:

1. **`trees.mergeConflict` checks the wrong base.** `trees-git.ts:403-419`
   (`mergeConflict`) calls the module-local `defaultBase(git)` (`trees-git.ts:38`),
   which always resolves `origin/<repo-default>` — never the PR's own base.
   A PR opened against a non-default base merges against the wrong ref. The
   `Pr` entity already carries the PR's own base at `entities/pr.ts:58`
   (`base: string`), and the caller in `worker-loop.ts:960` already holds a
   `pr` object with that field in scope when it calls
   `ports.trees.mergeConflict(worktree)` — the fix is threading `pr.base`
   into the port call, not inventing a new way to learn the base. Update the
   port signature in `ports/trees.ts:194` (`mergeConflict(path: string)`) to
   take the base ref, and `trees-git.ts`'s implementation to merge against it
   instead of calling `defaultBase`.
2. **The checks-wait clock never re-reads mergeability.** `worker-loop.ts:960-970`:
   the mergeable reading — including the `trees.mergeConflict` fallback for a
   host that answers `unknown` (Bitbucket Cloud has no such field) — runs
   only once, guarded by `clock.since === null` (the entry pass). Once the
   clock starts (`:971`), nothing in ROWS 12-18 (`:976` onward, the `Checks
   wait` loop) reads mergeability again. A PR that becomes conflicting
   *during* the wait (someone else's merge lands on the base) is never
   caught — the loop keeps waiting for a CI run on a ref that can no longer
   build. Add a re-read during the wait, not only at entry.
3. **`Checks wait: 0` seals through a conflict instead of catching it.**
   The plan's slice 4 names this as "`Checks wait: 0` seals through ROW 12b
   when the PR conflicts" — with the wait disabled, the loop takes the
   zero-wait short-circuit path before the (new) re-read in point 2 gets a
   chance to run, so a same-pass conflict is missed. Find ROW 12b's exact
   branch in `worker-loop.ts` (the `i.checksWaitSeconds <= 0` return, visible
   minified in the shipped bundle as the `checksWaitSeconds<=0` guard
   following the `mergeConflictAtEntry` check) and make it check mergeability
   before sealing rather than after.

### Decisions the plan settles — do not re-derive them

**`mergeConflictAtEntry` is removed, in favour of `mergeable === 'conflicting'`.**
The plan's slice 4 states this explicitly. `mergeConflictAtEntry` is a boolean
flag threaded through `AgentLoopReadings` (`domain/src/workflows/agent-loop.ts:248`)
and tested directly by name in `worker-loop-run.test.ts:1134` and `:1147`
(both reference issues #2122 and #2167) and in six places in
`workflows-agent-loop.test.ts`. Once mergeability can be re-read mid-wait,
a separate "was it conflicting at entry" flag is redundant with the
`mergeable` field itself — `agent-loop.ts:893`'s
`if (readings.mergeConflictAtEntry) return mergeConflictCorrectionEnding(...)`
becomes a check on `mergeable === 'conflicting'` directly. Update every test
site above; a leftover reference to the removed field fails typecheck, not
silently.

**`host.test.mjs` currently excuses `mergeable` from a key-set parity test**
(`test/reconcile/host.test.mjs`, around line 419 — the `pr-state` fixture
that includes `mergeable: 'unknown'` alongside `headSha`, `base`, `checks`,
`checksSha`). The plan says this exclusion stops. Find where that test
special-cases the `mergeable` key and remove the exemption so `mergeable`
is checked for parity like every other field.

**The conflict correction's wording names its true source, and carries no
estate-specific text.** The plan: "The conflict correction names the true
source of the verdict (host or local `git merge-tree`) and carries no
estate-specific text (`origin/main`, `board-server.mjs`, `pnpm build:board`)."
Grep the correction string builder (minified bundle shows it as a function
producing `"the run at ... concluded ..."`-style text for checks — the
merge-conflict correction text is a sibling of that, likely near
`mergeConflictCorrectionEnding` in `agent-loop.ts`) for any hardcoded
`origin/main`, `board-server.mjs`, or `pnpm build:board` substring and
replace it with the project's configured default branch / generic language.
This repo is not every repo the correction text will run in.

**Why `mergeConflict` falls back to local `git merge-tree` at all.** The
port doc at `ports/trees.ts:180-194` and the inline comment at
`worker-loop.ts:954-959` both explain this: Bitbucket Cloud's REST API has no
`mergeable` field, so `pr.mergeable` reads `unknown` on every Bitbucket PR
unconditionally, not just transiently. On GitHub the same fallback only
fires in the host's brief gap between a push landing and its `mergeable`
field settling. Don't collapse the fallback into a GitHub-only special case
— Bitbucket depends on it every time.

**Rule carried over from the layering and purity rules in `CLAUDE.md`:** the
port (`ports/trees.ts`) stays an interface with no runtime code, and only
`trees-git.ts` under `adapters/` may touch `git` directly or import the
`defaultBase` helper. Widening `mergeConflict`'s signature to accept a base
ref is a port change; implement it in the adapter, not by having the
worker-loop reach around the port to run its own `git merge-tree`.

### Done when

The plan's `## Done when` is implicit in its Design section (no separate
`## Done when` heading in this plan — the Design slice descriptions and the
Motivation's named defects are the specification). Treat these as the
assertions a naive implementation would pass without:

- A test with a PR whose base is NOT the repo's configured default branch,
  proving `mergeConflict` merges against the PR's base and not
  `origin/<default>`. Without this, a fix that still calls `defaultBase`
  internally (just renamed) would pass every existing test, since none of
  them currently vary the base from the default.
- A test where mergeability flips from `mergeable` to `conflicting`
  *during* the checks wait (not at entry), proving the re-read actually
  runs on a later pass and not just once. `worker-loop-run.test.ts:1134`
  and `:1147` already assert the entry-time behaviour (#2122, #2167) — add
  the mid-wait case rather than only editing those two.
- A test with `Checks wait: 0` AND a conflicting PR together, proving the
  zero-wait path catches the conflict rather than sealing through it. The
  plan names this combination specifically ("`Checks wait: 0` seals through
  ROW 12b when the PR conflicts") because it is the one path most likely to
  short-circuit past a fix that only touches the normal-wait branch.
- Every `mergeConflictAtEntry` reference removed from non-test and test code
  (`agent-loop.ts:248`, `:893`; `worker-loop.ts:849`, `:969`;
  `workflows-agent-loop.test.ts` ×7; `worker-loop-run.test.ts` ×2;
  `ended-desk.test.ts`; `agent-run-fixture.test.ts`), replaced by direct
  `mergeable === 'conflicting'` checks — confirm with
  `grep -rn mergeConflictAtEntry packages/` returning nothing.
- `host.test.mjs`'s `mergeable` key-set exclusion removed, and the test
  still passes — confirming the field now carries real parity coverage
  rather than being silently skipped.
- The conflict-correction text contains no `origin/main`, `board-server.mjs`,
  or `pnpm build:board` substrings — `grep` the correction-text source for
  these literals and confirm none remain.

Confirm the plan's named line numbers still hold before trusting them
literally — the plan itself warns "the issue was checked at `84b1638e4` and
the line numbers drift." Re-grep for `mergeConflict`, `mergeConflictAtEntry`,
and `defaultBase` rather than trusting this brief's line numbers once the
tree has moved.

Plus the repo's gates: no bundle diff in the PR (`board-server.mjs` is
generated — restore it from the merge base if a rebuild appears in the
diff), and the changeset for this plan's package bump. For tests, run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — the suites named in `## Plot Config`'s `CI suites` key
run in CI, and a failure there comes back as a correction. List no full
suite locally.

The shell gate: `scripts/check-shell-lines.sh` refuses a PR whose shell
under `skills/` grew past its merge base. This slice is TypeScript-only
(`packages/domain`, `packages/fleet`) — it should not touch `.sh` files, so
this gate should not fire; if a change does touch a `.sh` file, growth must
be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — it takes the PR title from the last commit
subject and the controller refuses a branch no plan names.

When the PR is created, append `→ #<number>` to this branch's line under
`## Slices` → `Independent` in the plan file, and push that as its own
commit (or amend into the first commit if nothing has been reviewed yet).

Push the first real commit as soon as it exists — a claim-only push with no
further work isn't the goal, but don't sit on local commits either.

### Scope guard

This branch owns:
- `packages/domain/src/ports/trees.ts` — `mergeConflict` signature
- `packages/domain/src/adapters/trees/trees-git.ts` — `mergeConflict` implementation
- `packages/fleet/src/server/entry/worker-loop.ts` — the mergeability read/re-read call sites
- `packages/domain/src/workflows/agent-loop.ts` — `mergeConflictAtEntry` removal, `mergeConflictCorrectionEnding` wording
- Corresponding test files: `packages/fleet/test/unit/worker-loop-run.test.ts`,
  `packages/domain/test/workflows-agent-loop.test.ts`,
  `packages/domain/test/ended-desk.test.ts`,
  `packages/domain/test/agent-run-fixture.test.ts`,
  `test/reconcile/host.test.mjs`

Other branches in this plan, verified at dispatch (none claimed as of this
brief — check `git ls-remote --heads origin` before starting, this plan's
branches may claim out of order):
- `bug/continuation-reads-the-loops-run-limits` (Started 2026-10-24) and
  `bug/a-failed-continuation-leaves-the-desk-as-found` (Started 2026-10-24) —
  both touch `packages/fleet/src/shared/continuation.ts`, not this slice's
  files. No overlap expected.
- `bug/drop-reads-the-boards-branch` — touches `drop.ts` and
  `trees-git.ts`'s `deskBranchMerged`-adjacent code, if any. Check for
  overlap in `trees-git.ts` specifically before editing that file, since
  both branches touch it.
- `bug/continuation-tests-assert-their-names` — waits on this branch and on
  `bug/a-failed-continuation-leaves-the-desk-as-found`; do not expect it to
  be in flight yet.

If you find something the plan did not anticipate — a mergeability call site
this brief missed, or a base-ref assumption baked in elsewhere — report it
rather than improvising outside scope.

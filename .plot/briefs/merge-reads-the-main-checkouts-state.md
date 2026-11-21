## Implementation brief — fleet-state-is-read-whole-and-from-one-home (wave 1: Merge state home)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/merge-reads-the-main-checkouts-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

This is the first of eight slices and every later slice waits on it. Slices 4 and 5 build on `StateHome` and `stateHomeAtSync`, which this branch introduces.

### What to build

`plot-ask.mjs merge` and `repair-pr` run from a linked worktree read an empty `.plot/state`, so the merge gate opens silently. Measured 2026-11-06 from `.worktrees/scratch-sprint-add`: `repair-pr 3199` answered `{"named":false,"reason":"no-open-episode"}`, the same call from the main checkout answered `{"named":true,"pr":3199}`, and every `merge` from the worktree that day returned `"defaultBranchRead":false`. The cause: `contextFrom` sets `repoRoot` to `PLOT_REPO_ROOT ?? process.cwd()` (`packages/board/src/server/entry/main.ts:111`), and four file adapters join `.plot/state/…` onto it with no resolution.

Build, in this order:

1. `StateHome` in `packages/domain/src/entities/state-home.ts`: `string & { readonly __brand: 'StateHome' }`. Only `stateHomeOf` creates one.
2. `stateHomeOf(commonDir: string | null)` in `packages/domain/src/rules/state-home.ts`. It takes the absolute, realpathed common git dir. It answers `{ home }` where the basename is `.git` (home is the parent) and `{ unread: true }` otherwise, including `null`. It never answers the input path.
3. Two adapters feeding it: `stateHomeAt(repoRoot)` in `packages/domain/src/adapters/state-home/state-home-git.ts` (async, `processAnswers.absoluteCommonDir`, realpath), and `stateHomeAtSync(repoRoot)` in `main-checkout.ts` (`execFileSync`, cached per root as `mainRootOf` is). No new port.
4. `repairRecordFile`, `baseRepairFile`, `defaultBranchFile`, `baseBranchFile` and their `*Path` functions take `home: StateHome` instead of `repoRoot: string`. Then fix every caller `tsc` names. The plan lists 25 non-test sites: the board (`merge-ports.ts:62`, `main.ts:218-220`, `estate.ts:88`, `board.ts:472`) and fleetd (`auto-merge.ts`, `auto-review.ts`, `auto-fixer.ts`, `repair-start-world.ts`, `revert-start-world.ts`, `registryd-main.ts`). Trust `tsc` over the list.
5. Each process resolves the home once at start: `contextFrom` for the board entries, the registryd context for fleetd. Where it answers `unread`, fleetd logs one line and starts none of the arms that read the four files. For the board's merge path, slice 4 adds the named refusal; here, do not invent a refusal name. Pass the adapters whatever makes the entry read nothing, and leave a `TODO` pointing at no one: slice 4 owns the word `state-home-unread`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **A branded type, not a caller list.** A fixed list of 25 callers breaks when the next caller appears. The brand makes `tsc` refuse a raw `repoRoot`. Rejected: fixing the callers by hand with no type change.
- **`stateHomeOf` never falls back to the input path.** That fallback is the defect, present at `trees-git.ts:776-779` and `main-checkout.ts:29-30`. Do not reuse `Trees.mainRoot`: it does not realpath, and `mainRootOf` does, so the two can name one checkout with two strings.
- **The main-checkout home is the target.** The repair record, default-branch reading, base readings, fleet bridge and heartbeat live under `<main checkout>/.plot/state`. The 14 other adapters (`pr-index-file.ts`, `issue-index-file.ts`, `reader-lock-file.ts`, `answer-record-file.ts`, `run-log-file.ts`, `slice-spend-file.ts` and others) resolve `<git common dir>/.plot/state` themselves, are already worktree-safe, and `PLOT_PR_INDEX_HOME` and `plot-pr-index-lookup.mjs` depend on their location. Move none of them.
- **fleetd moves in this slice.** Its writers and its merge, review, fixer, repair and revert arms change together, so fleetd never writes one directory and reads another.
- **No behaviour change in the main checkout.** The home of a main checkout is the checkout, so its paths do not change. A diff that changes a path there is wrong.
- **Out of scope:** the bridge, the heartbeat, `processes-files.ts`, `approve.ts`, `design.ts`, `verify.ts`, `review.ts` (slice 5); `MergeReadings.stateHome` and `state-home-unread` (slice 4). Leave `mainRootOf` in place; slice 5 deletes it.
- **Carried rules:** absent is not false, and a missing file is not proof of "no episode". Read the exit code, not the emptiness. The index never says no.
- **Style:** arrow functions for everything you write (`export const f = (…) => …`). TSDoc states what an export does, its parameters, return and failure, with no history. Put reasoning in the commit message.

### Done when

The plan's `## Slices` entry for this branch is the specification, and `### Approach › Slice 1` holds its tests. The assertions that exist because a naive implementation would pass without them:

- `packages/domain/test/state-home.test.ts`: `stateHomeOf('/r/.git')` answers the parent; `/r/.bare`, `/r/.git/modules/x` and `null` answer `unread`. One `// @ts-expect-error` cell proves `repairRecordFile('/x')` is a type error. This catches an implementation that keeps accepting `string`.
- `packages/domain/test/state-home-adapter.test.ts` over real repositories in `mkdtempSync`: main checkout answers itself; a linked worktree answers the main checkout; a directory outside any repo answers `unread`; a `git init --separate-git-dir` checkout answers `unread`. This catches a fallback to the input path.
- `packages/board/test/unit/ask-merge-from-a-worktree.test.ts` runs `merge` and `repair-pr` from a real linked worktree, with the captured-ports pattern of `ask-repair-pr.test.ts:22-31` and `merge-reads-the-estates-default-branch.test.ts:24-30`. It writes a red default-branch reading and a repair record under the main checkout's `.plot/state` and asserts the captured `defaultBranch.read()` and `repair.read()` return them. This cell fails today (both answer `null`); confirm it fails before the fix.
- `packages/domain/test/workflows-merge.test.ts`: the same red reading with a non-repair PR refuses `default-branch-red`.
- `packages/fleet/test/unit/auto-merge.test.ts`: the merge arm reads the reading fleetd's refresh wrote, from a worktree root.

Plus: add a changeset (description first, `bumps:` block last; package `@plot-pm/board`, add `plot` only if a skill changes). Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` needs no payment.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/{entities,rules,adapters}` for `StateHome`, the four state-file adapters and `main-checkout.ts`, their callers in `packages/board/src/server/` and `packages/fleet/src/`, and the tests above. Verified at dispatch: open PR #3605 (`a-continuation-resumes-the-asking-agent`) changes `continuation.ts`, which this branch does not touch. The Approved plan `the-fleet-fixes-every-red-or-conflicting-pr` cites `packages/fleet/src/shared/repair-start.ts:214`; slice 2, not this one, may shift it. The seven later branches of this plan run after this one merges.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

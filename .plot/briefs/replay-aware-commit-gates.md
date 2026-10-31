## Implementation brief — the-commit-gates-match-only-the (wave 1: Replay-aware gates)

- **Plan (canonical):** `docs/plans/2026-10-31-the-commit-gates-match-only-the.md` on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2984 merged
- **Branch:** `feature/replay-aware-commit-gates` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** per repo convention (`plot/review` status on the PR)

This is wave 1. Wave 2 (`feature/the-commit-gates-match-only-the`, the commit rule) waits for this PR to merge: it makes the gates run on `--continue` forms, which are safe only after this slice stops refusing them.

### What to build

Two gates refuse a legitimate repair today. Build the two readings that stop that, and nothing else. Do not touch `wants`, `commitDirs` or any matching rule: that is wave 2.

1. **`state` gate clears a replayed transition.** `packages/board/src/server/entry/gate.ts:279-280` reads only `MERGE_HEAD` (through `refs.mergeParents`, `packages/domain/src/adapters/refs/refs-git.ts:479`). A `git commit` during a rebase that stops on a receipted `State:` change is refused, because the receipt was spent by the original commit (measured 2026-10-31, exit 2). Add a reading of the picked commit (`REBASE_HEAD` or `CHERRY_PICK_HEAD`) to the `Refs` port (`ports/refs.ts`, beside `mergeParents` at `:833`), implemented in `refs-git.ts` through `git rev-parse --git-path`, the way `mergeParents` finds `MERGE_HEAD`. The gate clears a transition with no receipt when the picked commit made the same `before -> after` change to the same path against its own first parent.
2. **`phase` gate drops the other side of a main merge.** `gate.ts:430-434` reads every staged path as the branch's own, so completing a conflicted merge of `origin/<main>` into a held branch or a Draft plan's work branch is refused by `holdRefusal` (`packages/domain/src/rules/phase-gate.ts:149`). While `MERGE_HEAD` exists and each `MERGE_HEAD` commit is contained in `origin/<main>` (`Refs.contains`, `ports/refs.ts:701`; `main` as `gate.ts:436-440` reads it), drop every staged path whose staged blob equals its blob at a `MERGE_HEAD` commit. `holdRefusal` and the implementation-path check read the remaining paths.

### Decisions the plan settles — do not re-derive them

- **No `REVERT_HEAD`.** A revert makes the inverse change, so a reverted transition can never equal the picked commit's `before -> after`. It needs a receipt, as today. A test row must prove a revert of a receipted `Draft -> Design` still refuses.
- **`am` has no picked commit.** `am --continue` reads as a plain commit. Add no `am` reading.
- **`contains` answering `no` or `unknown` drops nothing.** A conflicted merge of another branch into a held branch is refused as today. Absent is not proof: only an affirmative `yes` for every `MERGE_HEAD` commit licenses the carve-out.
- **A path the resolution changed still counts as the branch's own.** Compare the staged blob with the `MERGE_HEAD` blob; an equal blob drops, a different blob stays.
- **One ask per repository root.** The `state` gate spends a single-use receipt on each transition it reads (`gate.ts:320-326`). Do not add a second read of the same index.
- **The decision reads `MERGE_HEAD`, not the command's spelling.** `git commit` and `git merge --continue` get the same answer. Wave 1 drives every row through `git commit`; wave 2 repeats them through the `--continue` forms.
- **Rules are arrows in the domain.** Write new functions as `export const f = (…) => …`. The domain imports `zod` and nothing else outside `adapters/`; the new rule takes readings as values, and the gate (controller) reads the port.

### Done when

The plan's `## Slices` entry for this wave is the specification. Rows to lift, each catching a naive pass:

- `state`: a rebase stopped on a receipted `Draft -> Design` commit allows through `git commit`. A revert of that commit refuses. A picked commit with a different `before -> after` refuses (catches a gate that clears any `REBASE_HEAD`).
- `phase`, held branch: main's paths staged unchanged allow. A path the resolution changed refuses. Another branch's paths staged unchanged, with a `MERGE_HEAD` not contained in `origin/<main>`, refuse (catches a carve-out that ignores containment).
- `phase`, implementation branch: main's paths staged unchanged allow; a changed path still refuses.
- `brief-name`: a merge-in-progress row that stays as it is today.
- Each row runs through the real gate (a launcher or bundle test in `test/reconcile/`, model: `bundle-commit-gate.test.mjs`), not only a rule unit test.

Plus the repo's gates: a changeset (`plot` or `@plot-pm/board`; description first, `bumps:` last), no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. Run no full suite and not `test:e2e`. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to charge; if you touch one, remove shell elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/gate.ts`, `packages/domain/src/ports/refs.ts`, `packages/domain/src/adapters/refs/refs-git.ts`, `packages/domain/src/rules/phase-gate.ts`, `packages/domain/src/rules/state-transition.ts` (only the clearing rule) and their tests. Wave 2 owns `main-checkout-write.ts`, `chained-add.ts`, `brief-name.ts` and the `wants` lines; do not edit them. Controller and role-deny gates are a follow-up issue.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — the-bundle-gate-refuses-the-repair (wave: Gate)

- **Plan (canonical):** docs/plans/2026-10-31-the-bundle-gate-refuses-the-repair.md on main
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2971 merged
- **Branch:** `feature/the-bundle-gate-refuses-the-repair` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (per plan's `Review: pr`)

The plan has one slice and nothing waits on it or blocks it. Issue #2970; the blocked PR was #2965.

### What to build

`plot-bundle-commit-gate.sh` refuses a `git commit` that stages any generated board bundle (`bundleCommitPaths`, `packages/domain/src/rules/bundle-commit.ts`). "Staged" means different from `HEAD`. The repair the refusal prints, and the repair `CLAUDE.md`, `docs/definition-of-done.md:47`, `.gitattributes:16` and `stuck.ts:210` print, restores from `git merge-base HEAD origin/main`. During a merge in progress that resolves the pre-merge base, not `origin/main`, so the restored copy is still different from `HEAD` and the next commit is refused again. Measured 2026-10-31 on PR #2965: the desk followed the documented command, restored copies from `e57b2aa2a`, hit 17 conflicting files on the next merge, spent its last correction and stopped with `PLOT-BLOCKED`. A master-agent repair left 5 of 12 bundles unrepairable.

Change the rule so a staged generated path is allowed when its staged (mode, blob id) equals the (mode, blob id) at the same path in `B`, the merge base the commit will have: `git merge-base origin/main HEAD <each MERGE_HEAD>` during a merge, `git merge-base origin/main HEAD` otherwise. `B` is the base `scripts/check-no-bundle-diff.sh` diffs against, so the gate allows exactly when CI reads the path clean. Then print a repair the gate accepts, and make every text that prints the restore source say the same thing. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **Compare against `B`, not `HEAD` and not a ref name.** The old comparison (staged vs `HEAD`) is the defect. The repair names the resolved sha of `B`, never `origin/main` as a ref, because a `git fetch` during the merge would move a ref name under the repair. A test covers that.
- **`origin/main` stays literal.** `Refs.defaultBranch` (`adapters/refs/refs-git.ts`, near line 360) answers an empty string with exit 0 when `origin/HEAD` is unset and falls back to the current branch, so it is not a safe reading for a gate. `check-no-bundle-diff.sh:58` names `origin/main` too. A configurable default branch changes both together, in a later plan; do not start it here.
- **Fail closed on every unreadable input.** A failed merge base, a `MERGE_HEAD` that exists and does not resolve, a failed mode or blob read, and no resolvable `origin/main` each refuse, name the paths and print no repair line. Each failure reaches `bundleCommitRefusal` as a value; `packages/board/src/server/entry/gate.ts` gains no early return. A crash of the gate process keeps `onError: 'allow'`, because exit 2 blocks every Bash call, including the repair.
- **A path `B` does not hold** is refused, with `git rm --cached <path>` as the repair, and only where `B` was read successfully. A read failure is not "absent": absent is a resolved `null`. Carry the rule the estate keeps re-learning: absent is not false.
- **Mode counts.** A mode-only difference is refused, and CI refuses it too.
- **Deleted or renamed-away generated paths stay out of scope.** The gate ignores them today and CI refuses them. Do not widen the rule.
- **Not in scope:** the hook matching the substring `git commit` (so `git merge --continue` and `git -C <dir> commit` pass), `git add` chained before `git commit`, and `git commit -a`. Each needs its own issue.
- **Layering.** `bundleCommitPaths`, `bundleCommitTouches` and `bundleCommitRefusal` stay pure arrow functions over readings as values. The new readings go through the `Refs` port (`ports/refs.ts`) and are implemented in all three adapters under `adapters/refs/`: git, fixture and remote-git. The readings are: the index (mode, sha) per staged path, from the raw listing `stagedEntries` already reads (`stagedEntriesOf` drops it today); `Refs.mergeBase` over N revisions, with the merge heads from the existing `Refs.mergeParents` (`gate.ts:266`); and one batched (mode, sha) read at `B`. The domain imports no adapter; no controller spawns.
- **The CI agreement is a contract test, not a corpus pair**, because the CI side is a script over a real repository.
- **Existing tests prove nothing here.** `bundle-commit.test.ts:38,:83` and `bundle-commit-gate.test.mjs:99` pass 8 of 8 and never cover a merge base that differs from `HEAD`. Do not count them as coverage.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- **The #2965 replay** (branch holding older copies than `B`, conflicted merge of `origin/main`, main's copy taken): allowed and CI clean. A gate that compares against `HEAD`, or against `merge-base HEAD origin/main` computed without `MERGE_HEAD`, fails this.
- **A plain commit of a newer `origin/main` copy:** refused and CI not clean. A gate that simply compares against `origin/main` instead of `B` allows it.
- **The printed repair, run, clears the gate when `B` differs from `HEAD`.** This is the original defect: the refusal printed a repair the next commit refused.
- **`git fetch` during a merge:** the answer does not change. Catches a repair that names a ref.
- **Each unreadable reading refuses with no repair line.** Catches a gate that treats a failed read as "equal".
- **The merge-first line** appears on a branch behind `origin/main` with no merge in progress.
- The contract test asserts the gate allows exactly when `scripts/check-no-bundle-diff.sh <root> HEAD <B>` is clean, per fixture state, in a temp repository. Mutation-test it: break the comparison and confirm the replay case fails before you trust it.

Plus: `./scripts/check-agents-md.sh --write` after the `CLAUDE.md` edit, then `./scripts/check-agents-md.sh` passes; the `grep -rn 'merge-base HEAD origin/main'` in the plan's Done-when finds no repair text naming the pre-merge base; a changeset (description first, `bumps:` block last; the plan's Changelog gives the text). Do not commit a rebuilt `board-server.mjs` or any generated bundle; run `pnpm build:board` only to test locally, then restore generated paths. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and not `test:e2e`.

The `scripts/check-shell-lines.sh` gate refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should not touch the launcher `plot-bundle-commit-gate.sh`; if it does, pay for growth in the same change. The gate counts commands, not lines, so joining statements is not a payment.

Domain style: arrow functions, factual TSDoc, no history narrated in comments. Write English only.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/bundle-commit.ts` and its test, `packages/domain/src/ports/refs.ts` and the three adapters under `packages/domain/src/adapters/refs/`, `packages/board/src/server/entry/gate.ts`, `test/reconcile/bundle-commit-gate.test.mjs`, `scripts/check-no-bundle-diff.sh` (header and repair text only), `packages/domain/src/rules/merge-conflict.ts` (the bundle step wording), `packages/board/src/app/lib/agent-rows/stuck.ts` and `actions.ts` with their tests, `CLAUDE.md` and `AGENTS.md`, `docs/definition-of-done.md`, `.gitattributes` (comment only), one changeset.

In flight on remote at dispatch (verified with `git ls-remote`): `feature/a-merged-pending-check-is-asked-again`, `feature/an-unfixed-high-is-ticketed`, `feature/fleetd-starts-main-repair`, `feature/one-pr-reader-per-machine-and`, plus three `bug/*` branches. A `CLAUDE.md` or `Refs` port conflict with one of them is possible; resolve by merging `origin/main`, never by resetting.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

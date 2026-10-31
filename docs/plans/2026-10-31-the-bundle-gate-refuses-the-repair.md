# The bundle gate refuses the repair it prints

> The bundle-commit gate accepts a staged generated path whose mode and content equal the merge base the commit will have, which is the base `check-no-bundle-diff.sh` checks, and every text that prints the repair names that base.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2970
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2971 merged

## Changelog

- The bundle-commit gate allows a commit that stages a generated bundle path whose mode and content equal the merge base the commit will have against `origin/main`. During a merge that base is `origin/main`, so taking main's copy is allowed; on a plain commit it is the branch's base, so CI's printed repair is allowed.
- The gate's refusal, `check-no-bundle-diff.sh`, the Definition of Done, CLAUDE.md, `.gitattributes`, the board's stuck-row hint and the desk's conflict correction all name the same restore source.

<!-- Board impact: the stuck-row hint in packages/board/src/app/lib/agent-rows/stuck.ts and the actions.ts comment change wording; rebuild the board artifact (pnpm build:board) only to test locally. No plan format, template, helper script table or docs/plans layout changes. -->

## Motivation

A branch that carries an old copy of a generated bundle cannot be repaired by an agent. Measured 2026-10-31 on PR #2965:

- `plot-bundle-commit-gate.sh` refuses a `git commit` whose index stages any path in the generated set (`bundleCommitPaths`, `packages/domain/src/rules/bundle-commit.ts`). "Staged" means different from `HEAD` (`Refs.stagedPaths`).
- The refusal prints `git restore --staged --worktree --source=<merge base> -- <path>`, with the merge base of `HEAD` and `origin/main`. When `HEAD` holds a different copy than that base, the restored path is still staged against `HEAD`, so the next commit is refused again.
- **The documented command picks the wrong base during a merge.** `CLAUDE.md`, `docs/definition-of-done.md:46-53` and `.gitattributes` tell an agent to restore conflicting bundles from `git merge-base HEAD origin/main`. During a merge in progress that resolves the pre-merge base, not `origin/main` (executed by the panel's seams juror). The `feature/fleetd-starts-the-fixer` desk followed it and restored copies from `e57b2aa2a`, older than `main`. On the next merge of `origin/main`, 17 files under `skills/plot/scripts/board/` conflicted, every commit that took `main`'s copy was refused, and the desk spent its last correction and stopped with `PLOT-BLOCKED`.
- A master-agent repair hit the same refusal. `git merge -X theirs origin/main` resolved 7 conflicting bundles without a `git commit` call; 5 more still differed from `origin/main`, and restoring them needed a commit the gate refused, so a person ran it.
- The existing tests (`bundle-commit.test.ts:38,:83`, `test/reconcile/bundle-commit-gate.test.mjs:99`) pass 8 of 8 and never cover a merge base that differs from `HEAD`.

`scripts/check-no-bundle-diff.sh` asks for a branch whose generated paths equal its merge base with `origin/main`. The local gate refuses that commit.

## Design

### Approach

1. **Compare against the merge base the commit will have.** Let `B` be `git merge-base origin/main HEAD <each MERGE_HEAD>` while a merge is in progress, and `git merge-base origin/main HEAD` otherwise. A staged generated path is allowed when its staged (mode, blob id) equals the (mode, blob id) at the same path in `B`. Every other staged generated path is refused, including a path `B` does not hold. `B` is the base `check-no-bundle-diff.sh` diffs against after the commit, so the gate allows a commit exactly when CI reads that path clean. During a merge `B` is `origin/main`, which fixes #2970's conflict case; on a plain commit `B` is the branch's base, so CI's own repair is allowed and a plain commit of a newer `origin/main` copy is refused, as CI refuses it.
2. **Print a repair the gate accepts.** The refusal names `git restore --staged --worktree --source=<sha of B> -- <path>` where `B` holds the path, and `git rm --cached <path>` only where `B` was read and does not hold it. The source is the resolved sha, not a ref name. When no merge is in progress and `origin/main` is ahead of `B`, the refusal adds one line: merge `origin/main` first to take main's copies.
3. **Fail closed on every unreadable input.** A failed merge base, a `MERGE_HEAD` that exists and does not resolve, or a failed mode or blob read refuses, names the paths, and prints no repair line. Each failure reaches `bundleCommitRefusal` as a value; `packages/board/src/server/entry/gate.ts` gains no early return. A crash of the gate process keeps the hook contract that allows (`onError: 'allow'`), because exiting 2 there blocks every Bash call, including the repair.
4. **Keep `origin/main` literal.** The gate and `check-no-bundle-diff.sh:58` both name `origin/main`, and they keep doing so. `Refs.defaultBranch` (`refs-git.ts:360`) answers an empty string with exit 0 when `origin/HEAD` is unset and falls back to the current branch, so it is not a safe reading for a gate. A configurable default branch changes both sides together, in a later plan.
5. **Readings through the `Refs` port, the rule in the domain.** `bundleCommitPaths`, `bundleCommitTouches` and `bundleCommitRefusal` stay pure arrow functions over readings as values. The readings, each in the git, fixture and remote-git adapters:
   - the index (mode, sha) of each staged path, from the raw listing `stagedEntries` already reads (`stagedEntriesOf` drops it today);
   - `Refs.mergeBase` over N revisions, with the merge heads from the existing `Refs.mergeParents` (`gate.ts:266`);
   - one batched (mode, sha) read at `B` for the staged generated paths, where an absent path is a resolved `null`, not a failure.
6. **One repair text everywhere.** The same slice changes every text that prints the restore source, so none of them prints the pre-merge base: the `CLAUDE.md` Testing paragraph (then `./scripts/check-agents-md.sh --write`), `docs/definition-of-done.md` "Resolving a board artifact conflict", `.gitattributes:10-20`, `packages/board/src/app/lib/agent-rows/stuck.ts:210` and the `actions.ts:92` comment with their tests, `scripts/check-no-bundle-diff.sh`'s header and repair text, and `packages/domain/src/rules/merge-conflict.ts:20-23`, whose correction names the bundle step: during a merge, restore generated paths from `origin/main`, never from `git merge-base HEAD origin/main`.

### Decisions

- **The merge-base reading stays and changes meaning.** It becomes `B`, read over N revisions; the old `mergeBase(HEAD, origin/main)` call goes.
- **No resolvable `origin/main`** (no remote, a scratch fixture) refuses with no repair, as `mergeBase === null` does today.
- **Staged statuses.** A modified or added path compares against `B`. A deleted or renamed-away generated path is out of scope: the gate ignores it today and CI refuses it; it stays as it is and is noted below.
- **The CI agreement is a contract test**, not a corpus pair: the CI side is a script over a real repository.

### Out of scope

- The hook matches the substring `git commit`, so `git merge --continue` and `git -C <dir> commit` pass it today. That gap needs its own issue.
- `git add` chained before `git commit`, and `git commit -a`, are read as the case-collision gate reads them today.
- A configurable default branch for the gate and `check-no-bundle-diff.sh` together.

## Slices

### Gate

- `feature/the-bundle-gate-refuses-the-repair` — the bundle-commit rule compares a staged generated path's (mode, sha) with the merge base the commit will have, prints a restore from that base's sha, and fails closed on every unreadable reading; the `Refs` port gains the index (mode, sha), an N-revision merge base and a batched (mode, sha) read at a ref, in the git, fixture and remote-git adapters; `CLAUDE.md`/`AGENTS.md`, `docs/definition-of-done.md`, `.gitattributes`, `stuck.ts`/`actions.ts`, `check-no-bundle-diff.sh` and `merge-conflict.ts` print the same restore source <!-- builds: bundleCommitRefusal against the post-commit merge base -->

## Done when

- `pnpm --filter @plot-pm/domain exec vitest run test/bundle-commit.test.ts` passes, with unit cases for: a staged copy equal to `B`, a staged copy that differs from `B`, a mode-only difference, a path `B` does not hold, each unreadable reading refusing with no repair line, and the merge-first line on a branch behind `origin/main`.
- `node --test test/reconcile/bundle-commit-gate.test.mjs` passes, with a contract test that builds each fixture state in a temp repository, runs the gate entry and then `scripts/check-no-bundle-diff.sh <root> HEAD <B>`, and asserts that the gate allows exactly when the script is clean:
  - the #2965 replay: a branch holding older copies than `B`, a conflicted merge of `origin/main`, main's copy taken (allowed, CI clean);
  - a plain commit that restores from `B` (allowed, CI clean);
  - a plain commit of a newer `origin/main` copy (refused, CI not clean);
  - a `git fetch` during a merge in progress (the answer does not change);
  - a mode-only change (refused, CI not clean);
  - the printed repair, run, clears the gate when `B` differs from `HEAD`.
- `./scripts/check-agents-md.sh` passes, and `grep -rn 'merge-base HEAD origin/main' CLAUDE.md docs/definition-of-done.md .gitattributes packages/board/src packages/domain/src/rules scripts/check-no-bundle-diff.sh` finds no repair text that names the pre-merge base.

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2970. The blocked PR was #2965.
- Panel round 1, 2026-10-31: unanimous amend (layering, safety, testability, seams); verdicts and moderation in `.plot/panels/the-bundle-gate-refuses-the-repair/`.

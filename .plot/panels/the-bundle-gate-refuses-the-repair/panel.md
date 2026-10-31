# Panel moderation: the-bundle-gate-refuses-the-repair

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: all four built temp repositories and ran the real gate entry and `scripts/check-no-bundle-diff.sh` against them; testability replayed the #2965 sequence (`juror-testability-replay.sh`) and ran the existing gate tests (8 of 8 pass, none covers a merge base that differs from `HEAD`); seams ran the documented conflict command during a merge in progress.

## Agreed by all four

1. **The comparison target is wrong.** "Equal to `origin/<default>`" fixes the conflict case and breaks the plain case. Executed by all four: on a commit that is not a merge, staging `origin/main`'s newer copy passes the plan's rule and `check-no-bundle-diff.sh` refuses it (exit 1); CI's own printed repair (restore from the merge base) is then refused by the plan's rule, which is #2970 reversed. The target that agrees with CI by construction is the merge base the commit will have: `git merge-base origin/<default> HEAD <MERGE_HEAD…>` during a merge, `git merge-base origin/<default> HEAD` otherwise. During a merge that base is `origin/<default>`, so the #2965 fix holds.
2. **The readings are not named.** `StagedPath` and `StagedEntry` carry no blob id, `Refs.mergeBase` takes two revisions, and no operation reads a blob at a ref. The slice needs the index (mode, sha) per staged path, a merge base over N revisions (`Refs.mergeParents` already reads `MERGE_HEAD`, `gate.ts:266`), and a batched (mode, sha) read at the base, in the git, fixture and remote-git adapters.
3. **Approach 4 is unsafe as written.** `Refs.defaultBranch` (`refs-git.ts:360`) returned an empty string with exit 0 when `origin/HEAD` was unset (executed by layering, safety, seams); its fallback names the current branch, which would compare against the branch's own push. `check-no-bundle-diff.sh:58` hard-codes `origin/main`. Three jurors offer the same choice: drop step 4, or fix the reading and change both sides together.
4. **Every open question can be decided now**, and question 4 is a contract test under `test/reconcile/` that runs the gate and `check-no-bundle-diff.sh` over the same fixtures, not a corpus pair: the CI side is a script over a real repository.

## Findings from one lens each

- **Safety:** a mode-only change (`chmod +x`) with an equal blob passes a blob-only rule and fails CI, so compare (mode, sha). A `git fetch` during a merge moves `origin/main`; the post-commit merge base reads `MERGE_HEAD`, which does not move. Every unreadable input refuses with no repair line, so the gate never prints `git rm --cached` for a path main holds.
- **Layering:** every reading failure reaches `bundleCommitRefusal` as a value; `gate.ts` gains no early return.
- **Testability:** the plan has no Done-when; each claim needs one command.
- **Seams:** the documented repair caused #2965. During a merge, `git merge-base HEAD origin/main` resolves the pre-merge base (executed), which is how the desk restored `e57b2aa2a` copies. Five texts print that command and the plan changes none: `CLAUDE.md` Testing (and `AGENTS.md`), `docs/definition-of-done.md:46-53`, `.gitattributes:10-20`, `packages/board/src/app/lib/agent-rows/stuck.ts:210`, and `check-no-bundle-diff.sh`'s repair text. The desk's conflict correction (`merge-conflict.ts:20-23`) names no bundle step. `stuck.ts` makes "Board impact: none" wrong.

## Where they differ

- **A gate that throws.** Safety says fail closed on every unreadable input; testability says a thrown gate keeps `onError: 'allow'`. These are compatible and the plan states both: a reading that fails is a value that refuses; a crash of the gate process keeps the hook contract that allows, because exiting 2 there blocks every Bash call, including the repair.

## Shared blind spot

All four judged the gate against `check-no-bundle-diff.sh` as the truth, and all four treated the PreToolUse hook as the only path to a commit. Seams alone noticed that the hook matches the substring `git commit`, so `git merge --continue` and `git -C <dir> commit` pass it today; the master agent's own repair of #2965 on 2026-10-31 used `git -C <dir> commit`. That gap is outside this plan and needs its own issue.

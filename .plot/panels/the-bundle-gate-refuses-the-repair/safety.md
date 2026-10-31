# Safety juror: the-bundle-gate-refuses-the-repair

Position: amend

The plan fixes the measured deadlock in the common case, but its comparison source (`origin/<default>`'s tip) is not the source CI checks against (the merge base the commit will have). I ran both against `scripts/check-no-bundle-diff.sh` in a temp repo. The two disagree in both directions: the gate allows commits CI refuses, and it refuses the commit CI's own repair text prints. One reading fixes this and is exactly CI's condition: the staged (mode, blob) at the merge base of `origin/<default>` with the commit about to be made, `git merge-base origin/<default> HEAD [MERGE_HEAD]`.

## Findings

### F1. The gate allows a commit that CI refuses (non-merge commit). Severity: high for the gate's contract, low for main.

Experiment (temp repo, bare remote, `build.mjs` declaring one `shippedA`, `-merge` attribute): the feature branch is cut at v1, and main moves to v2. On the feature branch with no merge, `git restore --staged --worktree --source=origin/main -- a.mjs` stages the v2 blob, which equals `origin/main:a.mjs` (`8c1384d8…` on both sides). The plan's rule (Approach 1) allows. After the commit, `check-no-bundle-diff.sh . HEAD origin/main` exits 1 and names `a.mjs`, because the merge base is still v1 (`check-no-bundle-diff.sh` lines 75–81 diff merge base → HEAD). The plan's own repair text (Approach 2) prints this exact command for any staged path, merge or not. So an agent that follows the refusal on a non-merge commit produces a branch CI refuses. CI still blocks the PR, so no wrong bundle reaches main. The local gate is wider than CI, which is what the lens forbids.

### F2. The gate refuses the repair CI prints: #2970 inverted.

In the same repo after F1, I ran CI's printed repair, `git checkout <merge base> -- a.mjs`. The staged blob is then v1 (`626799f0…`), which differs from HEAD (v2), so `stagedPaths` lists it. It also differs from `origin/main` (v2), so the plan's rule refuses it. The agent can neither keep the commit (CI refuses) nor revert it (the gate refuses). The way out is a merge of `origin/main`, and neither message says so.

### F3. `origin/<default>` that moves during a merge breaks the plan's rule. `MERGE_HEAD` does not.

Experiment: the branch holds a stale copy, and `git merge origin/main` (v2) conflicts under `-merge`. A `git fetch` then moves `origin/main` to v3, and the copy taken from `MERGE_HEAD` is staged (`8c1384d8`). The plan's rule refuses it because it differs from `origin/main` (`29ef827e`). The plan's repair restores v3, which the gate allows. After the merge commit, CI exits 1, because the post-commit merge base is v2 (`9b440ec66`) and the branch now carries v3. `git merge-base origin/main HEAD MERGE_HEAD` returned `9b440ec66`, whose blob equals the staged copy CI would accept. A local `origin/main` BEHIND the real one is safe under both rules, because the stale tip is an ancestor of the real one and becomes the merge base CI computes. A local `origin/main` AHEAD of what the merge took (fetch mid-merge) breaks the plan's rule only.

### F4. Equal blob ids with a different mode: the plan allows, CI refuses.

Experiment: after a clean merge, `chmod +x a.mjs && git add`. `git diff --cached --raw` shows `:100644 100755 29ef827e… 29ef827e… M`. The blob ids are equal, so the plan's "blob id equals" rule allows it. CI's `git diff --name-only` names the path and exits 1. The comparison must be on (mode, blob), as `TreeBlob` (`ports/refs.ts:22`) already carries.

### F5. Approach 4 ("the host's default branch") reads a ref that can be empty, and its fallback would open the gate.

`Refs.defaultBranch` (`refs-git.ts:360–366`) runs `git symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed … || git rev-parse --abbrev-ref HEAD`. In a repo with `origin` added by `git remote add` (no clone), I got the output `[]`: an empty name with success. The `||` fallback never runs, because the pipeline's status is `sed`'s. An empty name gives the ref `origin/`, which does not resolve. If someone later fixes the pipeline (`pipefail`), the fallback names the CURRENT branch, and `origin/<current branch>` is the branch's own last push. The gate would then allow any bundle the branch already pushed. The plan reads this from Refs, not from the host as it says. CI also stays on the literal `origin/main` (`check-no-bundle-diff.sh` line 59), so the local and CI sources can differ. The plan must state that an empty or unresolvable default refuses, and that the reading never falls back to HEAD's branch.

### F6. Fail direction on an unreadable input is left open (Open Questions 1–2).

Today `mergeBase === null` refuses with no repair (`bundle-commit.ts:117`, `:159–161`). The plan's text says "a path `origin/<default>` does not hold has no blob to equal, so it stays refused", but it does not separate "the default does not hold the path" from "the read failed". Approach 2 maps the first to `git rm --cached`. If a failed read is mapped the same way, the refusal tells the agent to stage a delete of a bundle that main does hold. The gate never refuses deletes (`bundle-commit.ts:107–109`), so that delete commits, and CI then refuses it (`git diff --name-only` lists deletions). Every port answer is a `PortResult`. Only a throw reaches `onError: 'allow'` (`gate.ts:121`, `:891–897`). The plan must state: a failed read refuses with no repair line, and only a resolved ref that lacks the path gets `git rm --cached`.

### F7. Readings the plan names but the port does not offer.

- `StagedPath` (`ports/refs.ts:41`) carries no sha, and `stagedEntriesOf` (`refs-git.ts:333`) parses the sha out of the meta field and drops it. `Refs.mergeBase(a, b)` (`ports/refs.ts:220`) takes two refs, not three. The slice needs either a new port operation or a widened entry, implemented in `refs-git.ts`, `refs-fixture.ts` and `refs-remote-git.ts`. The plan does not say which.
- No `MERGE_HEAD` reading exists in the port.

### F8. Pre-existing holes the plan inherits and does not state. Not regressions.

- The hook reads the index BEFORE the command runs. `git add <bundle> && git commit` and `git commit -a` commit content the gate never saw. The `case-collision` gate (`gate.ts:203–213`) handles chained `git add` and `-a`. The bundle gate does not.
- Deletes and renames AWAY from a generated path are never refused (`stagedPathsOf` drops `D`, `refs-git.ts:293–299`), and CI refuses them. Open Question 3 asks only about repairs for the forms `StagedPath` carries.
- The gate does not see a generated path that is unstaged but still differs from the post-commit merge base. The plan's own measured case left 5 such paths. CI refuses them after the commit.

### F9. Layering and slices.

The rule stays a pure arrow in `rules/bundle-commit.ts` over readings as values, and `gate.ts` collects and decides nothing. That keeps controller → domain → port ← adapter. One slice is enough and is independently mergeable. Open Questions 1–3 decide fail direction and the repair text, so they must be answered before approval. Question 4 is not optional: F1–F4 are exactly the disagreements a gate-versus-CI pair test catches.

## Amendments

1. **Compare against the post-commit merge base, not the default's tip.** Allow a staged generated path when its staged (mode, blob) equals the (mode, blob) at the same path in `B = git merge-base origin/<default> HEAD MERGE_HEAD` while a merge is in progress, and in `B = git merge-base origin/<default> HEAD` otherwise. `B` is the merge base the commit will have, which is what `check-no-bundle-diff.sh` diffs against. This fixes the #2970 conflict case (staged = the merged side = `B`'s blob) and the stale non-merge case (a restore from the current merge base equals `B`). It also removes F1–F4.
2. **Repair text from the same `B`.** Print `git restore --staged --worktree --source=<B> -- <path>` where `B` holds the path, and `git rm --cached <path>` only where `B` was read and lacks it. When the branch is behind and no merge is in progress, add one line: `merge origin/<default> first to take main's copies`.
3. **Fail closed on every unreadable input, with no repair line.** An empty or unresolvable default branch, a failed merge-base, a failed blob or mode read, or a `MERGE_HEAD` that exists but does not resolve: each refuses, names the paths, and prints no `git rm`. State that the default-branch reading never falls back to the current branch (F5), and fix or bypass the `defaultBranch` pipeline so an empty name is a failure, not a success.
4. **Name the port change.** Add one `Refs` operation, for example `entryAt(ref, path): PortResult<{ mode, sha } | null>` (null = resolved ref, path absent), plus the index's (mode, sha) for each staged path and a merge-base over N refs. Implement each in the git, fixture and remote-git adapters.
5. **Make Open Question 4 a slice requirement.** Add a contract test that builds fixture commits and runs both `bundleCommitRefusal` (via the gate) and `check-no-bundle-diff.sh <root> HEAD <base>` on each, asserting that the gate allows exactly when CI is clean for the staged paths. Include these fixtures: non-merge restore from `origin/<default>` (F1), CI's printed repair (F2), fetch during merge (F3), mode-only change (F4), conflict merge taking main's copy (#2970), and stale local `origin/<default>`.
6. **State the inherited holes as out of scope or in scope:** chained `git add`/`-a` (the case-collision gate already reads them), and deletes or renames away from a generated path, which CI refuses and the gate ignores.

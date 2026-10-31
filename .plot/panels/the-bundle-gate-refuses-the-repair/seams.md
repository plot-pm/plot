# Seams juror — the-bundle-gate-refuses-the-repair

Position: amend

Lens: the owner of everything else that touches generated bundles. The plan changes the gate and leaves six other places printing a different repair. One of them caused the measured failure. The plan's rule also disagrees with `check-no-bundle-diff.sh` in the non-merge case, which is the seam the plan says it closes.

All git evidence comes from a temp repo under my scratch dir: a bare `origin`, `packages/board/build.mjs` declaring one `shipped` path `x.mjs` marked `-merge`, and `scripts/check-no-bundle-diff.sh` from the worktree run against it as `check-no-bundle-diff.sh <repo> HEAD origin/main`.

## Findings

### 1. The documented procedure is the root cause, and the plan leaves it in place

- During an in-progress merge of `origin/main`, `git merge-base HEAD origin/main` resolves the PRE-merge base, not `origin/main`. Executed: `merge-base HEAD origin/main = 13edcae6` (the old base), while `merge-base origin/main HEAD MERGE_HEAD = 940a64dd` (= `origin/main`).
- Restoring from that old base and committing the merge (E2a) leaves the branch with old copies, and `check-no-bundle-diff.sh` refuses the result. Restoring from `origin/main` (E2b) prints `No bundle diff: clean.` E2a is the #2965 sequence: the desk restored from `e57b2aa2a` "to finish one merge".
- Five places print the E2a command today, and the plan names none of them:
  - `.gitattributes:16` — `git checkout "$(git merge-base HEAD origin/main)" -- <each conflicting generated path>`
  - `docs/definition-of-done.md:46-53` — the same command, plus "If the gate ever refuses a staged generated path, the refusal prints this exact restore command". After the plan, this claim is false.
  - `CLAUDE.md:656` and its mirror `AGENTS.md:656` — "restore every conflicting generated path from the merge base against `origin/main` — the command the gate's own refusal prints". After the plan, this claim is false.
  - `packages/board/src/app/lib/agent-rows/stuck.ts:210` — the board's `artifact-conflict` row prints `git checkout "$(git merge-base HEAD origin/main)" -- <path>`. `actions.ts:92` describes it. So the plan's "Board impact: none" (plan line 19) is wrong.
  - `scripts/check-no-bundle-diff.sh:108-116` — prints `git checkout <merge_base> -- <path>`.
- The desk's correction loop names no bundle rule at all. `packages/domain/src/rules/merge-conflict.ts:20-23` says only "Merge that branch into `<branch>`, resolve the conflict, and push." So a desk falls back on CLAUDE.md, runs E2a, and with the plan's gate it gets one refusal per attempt. The correction budget is 2 (`## Plot Config`), and #2965 spent it.

### 2. The plan's rule refuses the repair `check-no-bundle-diff.sh` prints locally, and allows a commit that script refuses

The plan's Motivation ends: "The local gate refuses exactly that commit." The plan's rule keeps that contradiction in the non-merge case:

- Executed (run3): a branch that committed its own rebuild, with no merge, and `main` moved since. `check-no-bundle-diff.sh` prints `git checkout "13edcae6…" -- x.mjs` (the branch's merge base). After that restore, staged blob `626799f0` ≠ `origin/main` blob `c694117f`, so the plan's rule REFUSES. Committed anyway, `check-no-bundle-diff.sh` prints `No bundle diff: clean.`
- Executed (E1 and run2): a plain, non-merge commit that stages `origin/main`'s copy. The plan's rule ALLOWS it. `check-no-bundle-diff.sh` on the branch HEAD exits 1. In CI's shape, a simulated `refs/pull/N/merge` merge commit, the script prints clean. After `main` rebuilds that bundle once more, the test merge conflicts (`exit=1`).
- This answers rubric Q2. A non-merge commit of `origin/main`'s copy puts a generated bundle into the branch's own three-dot diff. CI does not catch it, because the `pull_request` checkout at `ci.yml:1005` sets no `ref:` and reads the merge ref. The next build on `main` makes the PR DIRTY. That is the 2026-10-02 measurement `check-no-bundle-diff.sh:9-11` exists for (10 open PRs DIRTY). The desk's conflict correction then spends budget on it.
- Seam detail: the CI script prints a different source in its two shapes. On the branch HEAD it prints the branch's merge base (`13edcae6`). In the merge-ref shape it prints `origin/main`'s tip (executed, run4: `git checkout "005438a6…"` = `origin/main`). Open Question 4 must name which shape the pairing test runs in, because the plan's rule agrees with the merge-ref shape and disagrees with the branch shape.

### 3. One reading makes the gate equal `check-no-bundle-diff.sh` by construction

The commit is correct exactly when the staged blob equals the blob at the merge base that the commit WILL have against `origin/<default>`. Git computes that directly: `git merge-base origin/<default> HEAD <each MERGE_HEAD parent>`. Executed: during the merge it answered `origin/main`'s tip. For a plain commit it is `merge-base HEAD origin/<default>`, the branch's base. With this rule:

- Conflict case (#2965): the staged copy of `origin/main` is allowed. This is the plan's case and the plan's outcome.
- Stale, non-merge case: the merge-base restore is allowed (run3: "future-merge-base rule: allow"), the commit leaves no three-dot diff, and no later conflict follows.
- Plain commit of `origin/main`'s copy when `main` moved: refused, with a repair that names either the base restore or "merge `origin/<default>` first".
- The reading already exists halfway. `Refs.mergeParents` (`ports/refs.ts:790-802`, worktree-aware through `--git-path`, "precisely the window a commit gate runs in") is already read by the state gate at `gate.ts:266`, which compares staged content against the other merge parents. That is the precedent. `Refs.mergeBase(a, b)` (`refs.ts:220`) takes two revisions and must take N.

### 4. The readings, where the gate runs (rubric Q3)

- Every reading is local: the `origin/<default>` remote-tracking ref, `MERGE_HEAD` through `--git-path`, and blob ids. They work offline and in a linked worktree. With no fetch, `origin/<default>` is stale, but a merge of that same stale ref stays consistent, because the future merge base is that ref.
- The plan does not name the blob-id operation. `StagedPath` and `StagedEntry` carry no sha (`ports/refs.ts:41-65`). `stagedEntries` already runs `git diff --cached --raw -M --no-abbrev` (`refs-git.ts:436`), which emits the index sha, so adding an `indexSha` field there is the smallest change. `refs-fixture.ts` must mirror it.
- Step 4, "the host's default branch": `Refs.defaultBranch` (`refs-git.ts:360-366`) pipes `symbolic-ref` into `sed`, so its `||` fallback never runs. Executed in a clone with no `origin/HEAD`, it answered `[]` (an empty string), not a failure. The plan must name the reading and what an empty answer does. Also, `check-no-bundle-diff.sh:58` keeps `origin/main` as a literal. The gate acts only where `packages/board/build.mjs` exists (`gate.ts:97-98`), which in practice is this repository. Step 4 therefore adds a failure mode and a divergence from the CI script, and gives nothing here. Drop it, or change both sides.

### 5. Layering and purity (rubric Q4)

The plan keeps the rule in `bundle-commit.ts` with readings as values, and `gate.ts` collects them. That is correct, and it follows the existing shape (`gate.ts:84-121`). Existing tests assert the old text, and the slice must update them: `packages/domain/test/bundle-commit.test.ts:44` and `test/reconcile/bundle-commit-gate.test.mjs:77,103-106`.

### 6. Slices and open questions (rubric Q5)

- One slice changes the gate. The texts in finding 1 are not in any slice. If they ship apart from the gate, `main` holds a gate and a CLAUDE.md that print different repairs, and CLAUDE.md says they print the same one. The texts belong in the same slice. `AGENTS.md` is regenerated by `./scripts/check-agents-md.sh --write`. `stuck.ts` is board source and needs its display test.
- OQ1 (keep the merge base?): yes. It is the answer for a plain commit (finding 3). Decide it now.
- OQ2 (no `origin/<default>`): keep refusing with no repair, as `bundle-commit.ts:132-138` does now. This is separate from `onError: 'allow'`.
- OQ3 (statuses): `StagedPath` carries no `deleted` (`refs.ts:42`), and a delete is never refused. A rename into a generated path is refused unless its blob equals the target. This is decidable now.
- OQ4: decide now. Write a contract test in `test/reconcile/` over a fixture repo with four states: (a) a plain commit restoring the merge base; (b) a plain commit taking `origin/main`'s copy after `main` moved; (c) a merge of `origin/main` resolved to `main`'s copy; (d) a merge resolved to the pre-merge base (E2a). The test asserts that the gate allows exactly when `check-no-bundle-diff.sh <dir> HEAD origin/main`, run after the commit, prints clean. With the plan's rule, (a) and (b) fail that assertion.

### 7. Not stated, and an implementer would guess (rubric Q6)

- The port operation and field for blob ids, and the fixture adapter's shape.
- What `defaultBranch` answering `''` does.
- Whether the gate's text, the CI script's text and the five docs/board texts change together.
- Whether the merge-conflict correction names the bundle rule.
- The Motivation says "a person must run that commit". That is outside this plan's change, but `wants` at `gate.ts:86` is `command.includes('git commit')`, so `git merge --continue` and `git -C <dir> commit` are not gated. An agent can bypass the gate today. The plan should say this is out of scope, so that nobody reads the gate as complete.

## Amendments

1. Replace Approach 1 with: allow a staged generated path when its index blob equals the blob at `merge-base(origin/<default>, HEAD, each Refs.mergeParents sha)`. Refuse it otherwise. Refuse a path the base does not hold, with the repair `git rm --cached`. Extend `Refs.mergeBase` to N revisions. Add the index sha to `StagedEntry` (or a new op), and mirror it in `refs-fixture.ts`.
2. Replace Approach 2 with: print a restore whose `--source` is that same resolved sha. During a merge this sha is `origin/<default>`. For a plain commit it is the branch's base. Add one line: "or merge `origin/<default>` first, then restore from it".
3. Add these to the slice, and name each one in its slice line: `CLAUDE.md:656` (plus the `AGENTS.md` regeneration), `docs/definition-of-done.md:46-53`, `.gitattributes:10-20`, `packages/board/src/app/lib/agent-rows/stuck.ts:210` and the `actions.ts:92` comment with their tests, the repair text and header (`:33-45`, `:108-116`) of `scripts/check-no-bundle-diff.sh`, and `packages/domain/src/rules/merge-conflict.ts:20-23`. In `merge-conflict.ts`, the correction must name the bundle step: during the merge, restore generated paths from the merged `origin/<default>` and never from `git merge-base HEAD origin/main`. Remove "Board impact: none".
4. Add to the Motivation: the documented command resolves the pre-merge base during a merge (finding 1, E2a). That is how the desk got `e57b2aa2a` copies.
5. Close OQ1–OQ4 with the answers in finding 6, and make the OQ4 contract test part of the slice's test list.
6. Drop Approach 4, or name the reading, its empty-string answer, and the matching change to `check-no-bundle-diff.sh:58`.
7. Add one Notes line: the `wants` substring test does not see `git merge --continue` or `git -C <dir> commit`, and that gap is out of scope.

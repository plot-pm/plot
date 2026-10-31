# Juror: layering

Position: amend

The plan puts the decision in the right place: a pure rule in `packages/domain/src/rules/bundle-commit.ts`, readings collected by `packages/board/src/server/entry/gate.ts`, and git reached through the `Refs` port. The defects are in WHICH reading it compares against, and in two readings it leaves unnamed. One of them makes the plan's repair produce a commit that CI refuses.

## Findings

### 1. The comparison source `origin/<default>` disagrees with CI on a branch that has not merged main (rubric 1, 2)

`scripts/check-no-bundle-diff.sh:77,83` diffs `merge-base(HEAD, origin/main)..HEAD`. A commit that stages `origin/<default>`'s copy WITHOUT merging `origin/<default>` therefore passes the plan's rule and fails CI.

Executed in a temp repo (copy of `check-no-bundle-diff.sh`, one shipped path): a feature branch cut at base `e764d430`, main then rebuilt the bundle. On the branch, `git restore --staged --worktree --source=origin/main -- <bundle>` and a commit. The staged blob equals `origin/main`'s blob, so the plan's rule allows it. `check-no-bundle-diff.sh . HEAD origin/main` then printed `::error::this diff changes a generated board bundle` and exited 1.

This is the common case, not an edge: an agent runs `pnpm build:board`, then `git add -A`, the gate refuses, and the plan's new refusal text tells it to restore from `origin/<default>`. Today the repair (restore from the merge base) unstages the path and CI passes. After the plan, whenever main has rebuilt that bundle since the branch's merge base, the printed repair lands a commit CI refuses. The plan fixes the merge case and regresses the plain-commit case.

The base CI will read after the commit is `git merge-base origin/<default> HEAD [MERGE_HEAD]`. Executed during a `git merge --no-commit origin/main`: `merge-base HEAD origin/main` answered `e764d430` (the old base, which is today's wrong restore source), while `merge-base origin/main HEAD MERGE_HEAD` answered `887577bc`, equal to `origin/main`. With no merge in progress it equals today's merge base. So one reading covers the conflict case, the non-conflicting-but-stale case (#2965's desk: HEAD holds `e57b2aa2a`'s copy, the base holds a newer one), and the plain commit, and it agrees with CI by construction.

### 2. The default-branch name has no sound local source as written (rubric 3, 6)

The plan's heading says "Name the default branch from config", and its body says "the host's default branch". Neither works in a PreToolUse hook:

- No `## Plot Config` key names the default branch (CLAUDE.md lists `Default branch checks`, which names CI checks, not a branch).
- The host is a connector (`Host` port, a network call through `plot-host.sh`). A commit gate that asks the host fails offline, and the layering rule's connector contract (rate limit, account) does not belong in a commit hook.
- `Refs.defaultBranch()` (`refs-git.ts:360-366`) is local, but defective for this use. It runs `git symbolic-ref ... refs/remotes/origin/HEAD | sed ... || git rev-parse --abbrev-ref HEAD` with no `pipefail`, so the `||` fallback never fires. Executed: with `refs/remotes/origin/HEAD` removed (a remote added by hand, as in a scratch fixture), the command answered an empty string with exit 0, and `asText` (`run-script.ts:383`) passes `''` through as an `ok` answer. The gate would then read `origin/`. If someone later fixes the pipeline, the fallback answers the CURRENT branch, so the gate would compare against `origin/feature/x` — the branch's own pushed bundle — and allow exactly the commit the gate exists to refuse.

### 3. Neither blob-id reading is named, and one already exists in the port (rubric 4, 6)

The plan says "the reading of blob ids goes through the `Refs` port" without naming an operation. An implementing agent has to guess between three shapes. The evidence points to one:

- Staged blob id: `Refs.stagedEntries()` already runs `git diff --cached --raw -M --no-abbrev` (`refs-git.ts:436`), and the raw line carries the index sha. Executed: `:100644 100644 6267… 29ef… M <bundle>`, where `29ef…` equals `git rev-parse origin/main:<bundle>`. `stagedEntriesOf` (`refs-git.ts:333-336`) matches it with `\S+ \S+` and discards it. Capturing it as an `indexSha` field on `StagedEntry` (and in `refs-fixture.ts`) is the smallest port change. `gate.ts:240` already calls `stagedEntries()` for another gate, so the operation has a caller.
- Blob id at the base: no single-path blob-id operation exists. `listBlobs(ref, dir)` (`refs.ts:384`) takes ONE directory, while the generated set comes from `build.mjs` and is not guaranteed to live under one directory; `fileExistsSync` (`refs-git.ts:663`) answers presence only. Either a new `blobIdsAt(ref, paths)` operation (one `git ls-tree <ref> -- <paths…>` call, batched per the port's own `readBlobs` reasoning at `refs.ts:390-395`) or `listBlobs` per distinct directory. The plan must pick one. Presence then falls out of the same reading (absent = never held), so `existedAtMergeBase` and its per-path `fileExistsSync` loop (`gate.ts:110-116`) go away.

### 4. A failed reading must reach the rule as a value, not as an early return in the entry (rubric 3, 4)

`gate.ts:97,104` already returns `null` (allow) when `repoRoot` or `stagedPaths` fails. That is a decision made in the entry, and it is the gate's fail-open on its own machinery, which `onError: 'allow'` documents. The plan's Open Question 2 is about the separate case where git answers but the base cannot be resolved. If the implementer handles it with another `return null` in `gate.ts`, the entry gains a decision and the rule loses a tested branch. The rule's input should carry it: `base: string | null` and `baseBlobs: Readonly<Record<string, string>>` (or `null` when unreadable), and `bundleCommitRefusal` decides refuse-without-repair, as `bundleCommitTouches` does today for `mergeBase === null` (`bundle-commit.ts:117`).

### 5. The rule stays pure and synchronous (rubric 4)

Comparing two blob-id strings per path is a pure function of values. Nothing in the plan's design needs an await or a port in the rule. `packages/domain/test/bundle-commit.test.ts` can cover every case without git; `test/reconcile/bundle-commit-gate.test.mjs` and `packages/board/test/unit/gate-entry.test.ts` already exist for the entry. No browser and no host is needed anywhere.

### 6. Slice and Open Questions (rubric 5)

One slice, independently mergeable: yes, the change touches one rule, one adapter parser, the fixture adapter and one entry. Open Questions 1 and 2 must be decided before approval, because the answer changes the rule's input type; amendment 1 below decides both. Open Question 3 is already answered by `StagedPath` (`refs.ts:41-48`: `added | modified | renamed`, delete never carried): a path the base holds gets a restore, one it lacks gets `git rm --cached`, and the old side of a rename is a delete, which is never refused. Open Question 4 must be decided too, and it is not a corpus pair: CLAUDE.md's corpus tier holds two implementations of ONE rule, while these two answer different questions (one commit vs a branch's whole diff). The invariant is an implication — a commit the gate allows never adds a bundle diff CI refuses — so it belongs in a contract test under `test/reconcile/` that runs both on fixture repos. The slice's test list names neither that test nor the plain-commit case from finding 1.

### 7. A residual path to a bundle main did not build (rubric 2)

`origin/<default>` is a local ref. A caller can move it (`git update-ref`), and the gate will compare against whatever it names. This is a deliberate forge, CI still diffs against the real remote, and I do not ask the plan to defend against it. I name it because rubric 2 asks for every path.

## Amendments

1. Replace "equal to `origin/<default>`" with "equal to the blob at the base the commit will have": `git merge-base origin/<default> HEAD [MERGE_HEAD…]`, read through `Refs.mergeBase` extended to take the merge heads, with `MERGE_HEAD` read through the existing `Refs.resolve`. Print the restore from that base sha. Drop the old `mergeBase(HEAD, origin/main)` reading. This decides Open Question 1.
2. Name the default-branch source as a local ref, and state what counts as unresolved. Either fix `refsGit.defaultBranch` (`pipefail`, empty answer is a failure, no current-branch fallback) inside this slice, or read `refs/remotes/origin/HEAD` directly through a new operation. Strike "from config" and "the host's default branch". When the name or the base cannot be resolved, refuse without a repair, as today. This decides Open Question 2.
3. Name the port operations: `indexSha` on `StagedEntry` from the raw listing the adapter already reads, and one batched blob-id read at a ref for the touched paths. Update `refs-fixture.ts` for both.
4. State that every reading failure after `stagedPaths` reaches `bundleCommitRefusal` as a value, and that `gate.ts` adds no new early return.
5. Add to the slice's tests: a plain commit on a branch behind `origin/<default>` that stages main's newer copy (refused, repair from the base), and a contract test under `test/reconcile/` that asserts a gate-allowed commit leaves `check-no-bundle-diff.sh` clean for the merge case and the plain case.

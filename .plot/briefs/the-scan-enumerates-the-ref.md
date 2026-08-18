# Brief: bug/the-scan-enumerates-the-ref

Implement **wave 2 (Cause)** of
`docs/plans/2026-08-18-the-board-never-shrinks-on-a-success.md`.

Read it first. The diagnosis was reproduced in a two-clone sandbox: **do not
re-derive it, do not widen the scope.**

## Why you were started while the gate says "blocked"

`plot-fleet-scan.sh` reports `Cause — blocked` for this branch. **That is
wrong, and it is wrong because of a different bug.** Wave 1 is genuinely
complete — verified 2026-08-18 before dispatching you:

```
PR #211              MERGED, commit f5560c3
remote branch        0 refs (deleted at merge)
local branch/worktree removed
f5560c3 parents=bf4e17b   <- ONE parent: a squash, not a merge commit
```

The scan's merge detection walks merge commits, and a squash merge is not one —
so it cannot see that wave 1 landed, and it holds your wave shut. That defect is
`docs/plans/2026-08-18-a-squashed-branch-is-merged-not-open.md`, and a sibling
branch is fixing it right now.

The operator confirmed the override deliberately. **Do not "fix" the gate as
part of your work** — that is the sibling's branch.

## The bug you are fixing

A refresh that *succeeds* can describe a smaller world, because the scan
enumerates the **working tree** while claiming to read a ref.

Measured in a sandbox with a bare origin and two clones:

```
origin/main: 24be275   local HEAD: 1085976
plans in origin/main tree: 3
plans in working tree:     2
scan --json reports:       2 plans
```

A second agent pushed a third plan. The scan's `git fetch` **succeeded** —
`origin/main` genuinely carried three plans — and it still reported two:

```
121:  PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
270:  set -- "$PLAN_DIR"/[0-9]*.md
```

`PLAN_DIR` is a filesystem path. The fetch updates refs the plan enumeration
never reads. So the board's plan list is only as current as the operator's last
`git pull` — and during a fleet run the tree is being rewritten by rebases,
checkouts and worker commits underneath the scan.

The fetch is unguarded too:

```
134:  [ "$do_fetch" = 1 ] && git fetch -q origin "$MAIN" 2>/dev/null
```

Errors discarded, execution continues. A blip during a fleet run is
indistinguishable from a healthy fetch.

## What to build

1. **Enumerate plans from the ref.** `git ls-tree origin/$MAIN -- $PLAN_DIR`,
   read content with `git show`. The scan then describes one atomic commit
   rather than a directory being rewritten under it.
2. **Keep worktree observation local.** `local_dirty`, `local_worktree`, and the
   `.git/index.lock` observation at line 265 deliberately describe *this
   machine* and must keep doing so. The split is: plan enumeration from the ref,
   worktree observation local.
3. **Stop discarding the fetch's failure.** A failed fetch means the refs are
   older than the scan claims — carry that fact rather than dropping it.

## The behaviour question you must answer

The plan's Open Points flag it: `/plot-idea` writes a plan file **before**
committing it, and a ref-only enumeration would make it invisible until commit.
That may be correct — an uncommitted plan is not yet shared — but it is a
behaviour change. Decide, implement it, and **say which you chose and why** in
the PR. Do not leave it implicit.

## Coordination — read this

Two sibling branches are on `plot-fleet-scan.sh` right now:

- `bug/pulse-names-the-ref-it-read` — banner and `--json` ref fields
  (~lines 943, 970). **PR #213, already open.**
- `bug/a-squashed-branch-is-merged-not-open` — merge detection (~lines 558, 621).

Yours is plan enumeration (~lines 121, 134, 270). Disjoint from both. Expect a
rebase; keep your diff to enumeration and the fetch guard so the three do not
collide.

## Definition of Done

- The sandbox reproduction as a test: a plan pushed by another clone must be
  seen **without a local pull**, and the count must not depend on the working
  tree
- A failed fetch is reported, not silently swallowed
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures that do not reproduce serially
- `pnpm run test:board` passes — the board consumes this scan
- A changeset with a `bumps:` block

## Platform note

CI runs Linux; you are probably on macOS. Two faults were caught this way today:
`stat -f` does not fail cleanly on GNU (it prints to stdout and *then* exits 1),
and `/usr/bin:/bin` is not an isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.

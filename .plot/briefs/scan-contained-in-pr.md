## Implementation brief — reconcile-scan-accuracy, branch 2 of 3

- **Plan (canonical):** `docs/plans/2026-08-15-reconcile-scan-accuracy.md` on `main`
- **Approved:** 2026-08-15, jwloka, plan-PR #101 merged
- **Branch:** `bug/scan-contained-in-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Section 3 — wave 1 (`bug/scan-single-pr-plans`) merged as #122.
  `feature/update-board-test` is blocked behind this one.

### What to build

**Section 3 currently calls a branch orphaned when it is merely unmerged.**

The `else` around line 462 turns *"ahead of main, not the head of an open PR"*
into **orphan**. That is wrong for a branch which is an ancestor of some open
PR's head — a perfectly ordinary state for stacked work, and one the report
should not describe as abandoned.

Add one test before that `else`:

    git merge-base --is-ancestor "origin/$b" "origin/$pr_head"

The open-PR head list already exists in the script — that is how *"no open PR"*
is decided today. Walk it for each candidate; a hit reports

    origin/<branch> — contained in open PR #<n> → not orphaned

and **must not count toward `stale=`**.

Cost is one `merge-base` per candidate per open PR — bounded by branches × open
PRs, both small, and only reached by branches that already failed the head test.

### Ordering: after the claim check, and the reason is not the obvious one

The plan is explicit here, because the first intuition was wrong and was tested
twice in a throwaway repo:

An empty claim branch is an ancestor of **nothing** — its claim commit puts it
one commit *ahead* of the branch point, so the ancestry runs the other way
(`main` is an ancestor of the claim). That is not the case that matters.

The real case is the opposite: once a worker builds on its claim, the claim
commit becomes part of the working branch, and that branch is typically the head
of the PR it opens. A claim with work on it is therefore legitimately *contained
in an open PR* — and it should still be reported as a **claim**, because that is
the more specific fact.

**Claim first, containment second.** Do not reorder these.

### Done when

- A branch contained in an open PR is reported as contained, not orphaned, and
  does not increment `stale=`. Show the scan's real output on a fixture repo —
  before and after counts are the evidence, since the footer is
  machine-countable.
- The claim check still wins for a claim with work on it. Pin this with a test;
  it is the ordering decision above, and it is easy to break silently.
- `pnpm run test:reconcile` and `pnpm run validate` pass.
- A changeset is present.
- macOS ships bash 3.2: **no `declare -A`**, no bash-4-only constructs. A test
  enforces this.
- **Assert per line, not with whole-output regexes.** This suite has been fooled
  three times by patterns matching across report lines or the summary footer.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

Section 2 is done (#122) — do not revisit it. `feature/update-board-test` is
wave 3 and not yours. Stay in `skills/plot/scripts/plot-reconcile-scan.sh` and
`test/reconcile/scan.test.mjs`. Drift → back to the plan.

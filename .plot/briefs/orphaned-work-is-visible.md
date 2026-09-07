## Implementation brief — orphaned-work-is-visible (slice: The scan reports work no plan claims)

- **Plan (canonical):** `docs/plans/2026-09-07-orphaned-work-is-visible.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/orphaned-work-is-visible` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice. **Read the plan's Notes first** — it carries a twelve-branch audit and a correction to it, and the correction is the part that shapes this finding.

## What this delivers

`plot-reconcile-scan.sh` reports a remote branch carrying unmerged commits that **no plan names** and **no open PR carries**.

## The reading is FILE CHANGES, not commits

**Seven of the twelve measured branches carry only a claim commit and a `PLOT-BLOCKED` marker.** Those are already reapable and already handled — reporting them is noise on top of a finding that already exists.

**The five that matter changed source files.** So the reading is:

```
git diff --name-only main...branch    # excluding PLOT-BLOCKED*
```

A branch with zero file changes after that exclusion is not orphaned work.

## It is ADVISORY — below the marker

**Place it below `== blocking sections end ==`** (`plot-reconcile-scan.sh:1159`). Unclaimed work is a legibility gap, not a broken pointer, and **a finding that can stop a delivery is a gate nobody agreed to.**

`/plot-deliver`'s gate reads to that marker. Sections 13–16 are the pattern to copy — each carries its own footer counter, stays below the line, and gates nothing.

**Add a footer counter** to the `summary:` line at `:2011`, alongside `stated_waits=` and `sprint_shipped=`.

**Do not renumber existing sections.** This scan has been renumbered twice; consumers read the marker, not a number.

## It names what a person can DO

There are exactly three answers, and the finding must say them: **open a PR**, **write the plan that claims it**, or **delete the ref**.

A finding that says only *this exists* leaves the reader where the board already left them.

**Report per branch: the branch name, its file count, and its last commit date.**

## The correction that shapes this — read it

The plan's first audit called one branch UNRECOVERED. **It was wrong.** `bug/a-hung-cleanup-says-which-half` had already landed — as a fix plus a comment, with the instrument deleted. The audit searched main for the branch's own tokens (`_stage`, `PLOT_LOOP_TRACE`), found neither, and concluded the work was lost.

**A diagnostic branch is exactly where that test fails: its success condition is its own deletion.**

**So this finding must not claim a branch is unfinished.** It reports *no plan names this and no PR carries it* — which is true of all twelve — and leaves *is it owed?* to the reader. Twelve of twelve turned out to be landed or superseded; a finding worded as *lost work* would have been wrong twelve times.

## Verification

- Run it against this estate. The twelve branches in the plan's Notes are the fixture — expect roughly five to survive the file-changes filter.
- **`/plot-deliver` still delivers** with findings present. That is the gate boundary; assert it.
- The footer counter is machine-countable, like its neighbours.

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile   # the scan's own contract tests
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one.

**The scan reads plans from `origin/main`, never the working tree.** A plan edit is invisible to it until pushed.

**Section numbers move under you.** Take main's whole file on conflict and re-insert; do not resolve a numbered hunk by hand.

## Done when

The scan reports a remote branch with unmerged file changes that no plan names and no open PR carries, names the branch, its file count and its last commit date, counts it in the machine-countable footer, and gates nothing.

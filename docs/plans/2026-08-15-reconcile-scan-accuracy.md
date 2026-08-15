# Reconcile scan: report states, not shapes

> Three gaps the scan showed on its own repo — two false answers and one
> untested script — each found by a plan slipping through it.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-reconcile-scan.sh` finds plans delivered in single-PR mode. Previously
  a plan whose work rode its own idea branch was never reported as
  merged-but-not-delivered, because the branch it named was deleted at merge.
- `plot-reconcile-scan.sh` distinguishes *contained in an open PR* from
  *orphaned*. A branch that is an ancestor of an open PR's head is work in
  flight, not abandoned work.
- `plot-update-board.sh` gains a test.

Board impact: **none.** No plan-format field, no template, no `docs/plans`
layout change. `plot-reconcile-scan.sh` and `plot-update-board.sh` are not read
by `packages/board` — the board consumes `plot-plan-meta.sh`, which this plan
does not touch. No board rebuild required.

## Motivation

Delivering two long-overdue plans on 2026-08-15 exposed three gaps, all in the
tooling that exists to prevent exactly that overdue-ness.

**A plan sat undelivered for five weeks and the scan never said so.**
`kanban-board-v1` ran in single-PR mode: plan and implementation on
`idea/kanban-board-v1`, one PR, merged and the branch deleted. The scan's
merged-but-not-delivered check iterates the branches the *plan* names and asks
whether each is in `merged_branches` — but that branch no longer exists, so the
answer is always no. The check looks for the right thing in the wrong place.

**Seven branches were reported as orphans while their PR was open.** All seven
`opus5-hardening` branches are ancestors of the head of PR #57. The scan asks
only whether a branch is the *head* of an open PR; being contained in one is
invisible to it. Seven of eight `stale=` entries were false, which is enough
noise to make a person stop reading the section.

**`plot-update-board.sh` has no test.** That is why a missing transition — new
implementation PRs never reaching *Ready* — survived five months (closed in
#98). A board update that never happens is indistinguishable from a board
nobody configured, so nothing fails loudly; only a test would have.

The common shape: **the scan reports on shapes it recognises rather than states
it verifies.** A finding it cannot express is silence, and silence reads as
health.

## Design

### Approach

Three independent fixes. Each is small, each is testable, and the third is what
makes the other two trustworthy later.

**Fix 1 — single-PR plans (`plot-reconcile-scan.sh`, section 2).**

The current test, around line 403:

    for b in $branches; do
      if printf '%s\n' "$merged_branches" | grep -qx "$b"; then merged_any=1; fi
    done

`$branches` comes from the plan; in single-PR mode that is the idea branch,
deleted at merge. Add a second signal that does not depend on a surviving
branch: **the plan file itself is on the default branch and its PR is merged.**

Resolve it from the PR references the plan already carries (`prs`, which the
row loop reads today) via `plot-host.sh pr-state`: a plan in phase `approved`
whose linked PR is `MERGED` is merged-but-not-delivered regardless of what its
branch list says. Where `prs` is empty, fall back to today's branch test — no
regression for plans that never linked a PR.

The two signals are OR-ed, not replaced. Fan-out plans keep the branch check
(their PRs are per-branch and may merge at different times); single-PR plans get
the plan-PR check.

**Fix 2 — contained versus orphaned (section 3).**

The `else` at line 462 turns "ahead of main, not the head of an open PR" into
*orphan*. Add one test before it: is this branch an ancestor of the head of any
open PR?

    git merge-base --is-ancestor "origin/$b" "origin/$pr_head"

The open-PR head list already exists in the script (that is how "no open PR" is
decided). For each candidate, walk that list; a hit reports

    origin/<branch> — contained in open PR #<n> → not orphaned

and does **not** count toward `stale=`. Cost is one `merge-base` per candidate
per open PR — bounded by branches × open PRs, both small, and only for branches
that already failed the head test.

Note the ordering constraint: this test must come **after** the claim check.
An empty claim branch is an ancestor of anything it was branched from, so
testing containment first would reclassify every claim.

**Fix 3 — a test for `plot-update-board.sh`.**

The script talks to `gh project`, so a test cannot exercise the happy path
without a real board. What it *can* pin is everything around it, which is where
the failure lived:

- **Argument handling** — missing arguments exit 1; four arguments do not.
- **Graceful degradation** — an unresolvable project exits **0** with a warning
  on stderr. This is the load-bearing behaviour: the script is called from
  skills that must not fail when no board is configured, and it is exactly why
  the missing call was silent.
- **Callers exist** — every status in the plan-to-column mapping
  (`Planning`, `Ready`, `Done`) is actually invoked by some skill. This is the
  test that would have caught the #98 gap: it asserts the *set of calls*, not
  the script.

The third assertion is deliberately a test about skills rather than about the
script. The defect was never in `plot-update-board.sh` — it was in nobody
calling it.

**Manifesto check.** Principle 1: both scan fixes derive from refs, nothing
stored. Principle 3: the script collects and reports; the judgment ("is this
abandoned?") stays with the human reading it — the fix only stops the script
asserting something it did not check. Principle 12: the third fix converts an
assertion ("the board sync works") into evidence.

### Open Questions

- [ ] Should *contained in an open PR* print at all, or be silent? Printing
      keeps the section honest about what it examined; silence keeps it short.
      Leaning: print, because a silent scan is what caused this plan.
- [ ] Fix 1 costs one `pr-state` call per approved plan with linked PRs. The
      scan is meant to be cheap enough for ambient use on `/plot` at ~100
      plans. Is the call worth it, or should it be behind a flag?

## Branches

### Section 2

- `bug/scan-single-pr-plans` — section 2 recognises plan-PR-merged as a second signal

### Section 3

- `bug/scan-contained-in-pr` — section 3 separates contained-in-open-PR from orphaned

### Coverage

- `feature/update-board-test` — argument handling, graceful degradation, and the caller-set assertion

<!-- Three waves, one branch each. The two scan fixes edit the same file and
     must not run concurrently; the board test is last because it is
     independent, not because it depends on them. -->

The two scan fixes share `plot-reconcile-scan.sh` and are therefore serialised.
They edit different sections and would probably merge cleanly — but "probably"
is exactly what the wave mechanism exists to remove, and this plan was drafted
with both in one wave before that was caught. The second fix's ordering
constraint (containment must be tested after the claim check) is also easier to
reason about against a file that has already absorbed the first change.

The coverage branch touches only the board script and its new test, so it
collides with nothing. It sits last for reviewability, not dependency — pull it
forward if the scan fixes stall.

## Notes

All three gaps were found on 2026-08-15 while delivering `board-sync` and
`kanban-board-v1`, both of which had shipped months earlier. Evidence for each
is in the [`plot-board` story](../stories/plot-board/STORY-plot-board.md) under
Key Findings.

Tests extend `test/reconcile/scan.test.mjs`, which already exists. Assert per
line rather than with whole-output regexes — this suite has been fooled three
times by patterns matching across report lines or the summary footer.

Definition of Done: `docs/definition-of-done.md`.

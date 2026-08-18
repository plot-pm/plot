# Reconcile scan: report states, not shapes

> Three gaps the scan showed on its own repo — two false answers and one
> untested script — each found by a plan slipping through it.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-15, jwloka, plan-PR #101 merged
- **Started:** 2026-08-16, jwloka, `bug/scan-contained-in-pr`
- **Started:** 2026-08-16, jwloka, `feature/update-board-test`
- **Started:** 2026-08-15, jwloka, `bug/scan-single-pr-plans`

## Approval

- **Assignee:** jwloka

## Changelog

- `plot-reconcile-scan.sh` finds plans whose work landed in single-PR mode.
  Previously a plan whose implementation rode its own idea branch was never
  reported as merged-but-not-delivered, because that branch is deleted at merge
  — so the scan had nothing left to match. It now also matches plan branches
  against merged PR heads, which survives both the deleted ref and a plan that
  never recorded its PR number.
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
deleted at merge. So the branch is neither in `merged_branches` (that list comes
from `git branch -r --merged`, and the ref is gone) nor resolvable at all.

**The obvious fix does not work, and the reason matters.** Reading the plan's
own `prs` field and asking `plot-host.sh pr-state` looks natural — but
`kanban-board-v1` carried **no PR annotation** while it hung. `→ #40` was
back-filled during its delivery on 2026-08-15, five weeks late. A fix that
depends on the annotation misses exactly the sloppy plans that go undelivered,
because the missing annotation and the missing delivery have the same cause.

The signal that survives a deleted branch and an absent annotation is the pair:
**a branch the plan names that no longer exists on origin, and a merged PR whose
head was that branch.**

    plot-host.sh pr-list --state merged   →  number, head   (one call, all plans)

Match each plan's named branches against the merged-PR heads. A plan in phase
`approved` with a hit is merged-but-not-delivered, regardless of whether the ref
still exists or the plan ever recorded a PR number.

**Cost, measured rather than assumed.** A single `pr-state` call takes **0.61 s**
— at one call per approved plan that is unusable at the ~100-plan scale the scan
targets. The bundled `pr-list --state merged` takes **0.63 s** for the whole
repo: one call, constant, no matter how many plans. The scan already fetches a
bundled list of *open* PRs (`open_prs`); this adds its merged counterpart beside
it, in the same degradation path — `--offline`/`--no-pr` skip both, and
`PR_SOURCE` already records which happened.

That measurement also settles the plan's original open question: no flag is
needed, because nothing scales with plan count.

The two signals are OR-ed, not replaced. Fan-out plans keep the existing branch
check (their PRs are per-branch and may merge at different times); single-PR
plans are caught by the merged-head match.

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

**Ordering: this test must come after the claim check** — but not for the reason
that first suggested itself. An empty claim branch is an ancestor of *nothing*:
its claim commit puts it one commit **ahead** of the branch point, so the
ancestry runs the other way (`main` is an ancestor of the claim). Tested in a
throwaway repo, both directions, twice — the intuition was backwards.

The real case is the opposite one. Once a worker builds on its claim, the claim
commit becomes part of the working branch, and that branch is typically the head
of the PR it opens. A claim with work on it is therefore legitimately contained
in an open PR — and it should still be reported as a **claim**, since that is
the more specific fact. Claim first, containment second.

**Fix 3 — a test for `plot-update-board.sh`.**

The script talks to `gh project`, so a test cannot exercise the happy path
without a real board. What it *can* pin is everything around it, which is where
the failure lived:

- **Argument handling** — missing arguments exit 1; four arguments do not.
- **Graceful degradation** — an unresolvable project exits **0** with a warning
  on stderr. This is the load-bearing behaviour: the script is called from
  skills that must not fail when no board is configured, and it is exactly why
  the missing call was silent.
- **Every status has a caller** — each of `Planning`, `Ready`, `Done` appears in
  some `plot-update-board.sh` invocation somewhere under `skills/`. This is the
  assertion that would have caught #98.

The third is deliberately a test about skills rather than about the script. The
defect was never in `plot-update-board.sh` — it was in nobody calling it.

**It asserts the status set, not skill-to-status pairs.** Pinning
`plot-approve → Ready` would be stricter and would also catch "the wrong skill
calls it" — but it would break on exactly the kind of restructuring that caused
the gap: Plot 2 moved branch creation from `/plot-approve` to `/plot-implement`,
and a pair-based test would have gone red for a legitimate move while staying
silent about the transition actually disappearing. A set-based assertion
survives renames and reorganisation, and still fails the moment a status has no
caller at all — which is the failure that happened.

**Manifesto check.** Principle 1: both scan fixes derive from refs, nothing
stored. Principle 3: the script collects and reports; the judgment ("is this
abandoned?") stays with the human reading it — the fix only stops the script
asserting something it did not check. Principle 12: the third fix converts an
assertion ("the board sync works") into evidence.

### Open Questions

- [ ] Should *contained in an open PR* print at all, or be silent? Printing
      keeps the section honest about what it examined; silence keeps it short.
      Leaning: print, because a silent scan is what caused this plan.
- [ ] What `--limit` does the merged-PR list need? The default truncates: a
      probe for `kanban-board-v1`'s merged PR came back empty at the default
      and needed a raised limit. Too low silently misses old plans — which is
      this plan's own failure mode — and too high costs latency on every run.
- [ ] Does fix 1 need a merged-PR list at all in `--offline` mode, or should
      the single-PR check simply not run there? Today `PR_SOURCE=off` already
      marks the degraded case; the question is whether to say so per finding.

## Branches

### Section 2

- `bug/scan-single-pr-plans` — section 2 recognises plan-PR-merged as a second signal → #122

### Section 3

- `bug/scan-contained-in-pr` — section 3 separates contained-in-open-PR from orphaned → #125

### Coverage

- `feature/update-board-test` — argument handling, graceful degradation, and the caller-set assertion → #128

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

Interrogated with `/challenge-the-plan` before approval. Three findings changed
the design rather than its wording, and two of them contradicted something this
plan had asserted:

- Fix 1's original mechanism — read the plan's `prs` field, call `pr-state` —
  would have **missed the very plan that motivated it**. `kanban-board-v1`
  carried no PR annotation while it hung; `→ #40` was back-filled at delivery.
  The missing annotation and the missing delivery share a cause, so a fix
  depending on the annotation is blind to its own case.
- The stated reason for fix 2's ordering was **backwards**. An empty claim
  branch is an ancestor of nothing — the claim commit puts it ahead of the
  branch point. Verified in a throwaway repo in both directions. The ordering
  survives on a different, real case.
- Measurement replaced the cost question rather than answering it: `pr-state`
  costs 0.61 s **per call**, the bundled `pr-list --state merged` 0.63 s **per
  run**. Same price, constant instead of linear.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "How should fix 1 fetch PR state, given 0.61s per pr-state call?", "a": "Bundled pr-list --state merged — one call, constant cost", "category": "nonFunctional"},
    {"q": "The claim-ordering rationale is false (tested); keep the ordering?", "a": "Keep it, correct the reason — a worked-on claim becomes the PR head", "category": "technical"},
    {"q": "How strict should the caller test be?", "a": "Assert the status set, not skill-to-status pairs — pairs break on the restructuring that caused the gap", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

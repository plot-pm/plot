# A deleted ref is not an unstarted branch

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

`plot-fleet-scan.sh` opens `branch_state()` with a single question:

```sh
if ! git show-ref -q --verify "refs/remotes/origin/$br"; then
  echo "open"; return
fi
```

Absence carries two meanings and the script silently picks one. A branch that
never existed and a branch that was merged and then deleted are the same
missing ref — and both are reported as `open`, which the wave arithmetic reads
as *outstanding*.

Observed 2026-08-16, immediately after #125 merged:

```
== 2026-08-15-reconcile-scan-accuracy.md ==
  Section 2 — complete
      bug/scan-single-pr-plans — merged
  Section 3 — eligible
      bug/scan-contained-in-pr — open        ← merged as #125, ref deleted
  Coverage — blocked                          ← blocked BY the line above
      feature/update-board-test — open
```

Wave 3 cannot be dispatched because wave 2 — finished, merged, delivered-ready
— reads as unstarted.

### Why this stopped being cosmetic

It was recorded twice as cosmetic, on the reasoning that *the wave gate is
advisory, not enforced*. That reasoning was sound when written and is now
false: #124 gave the gate an automated reader. With both of `board-reads-git`'s
PRs merged and both refs deleted:

```
$ plot-fleet-scan.sh --next
bug/board-claimed-from-git
```

`--next` names **finished work as the next thing to start**, and that is
precisely the question `plot-dispatch.sh` asks before fanning out. A dispatch
acting on that answer creates a worktree, pushes a claim — **which recreates
the deleted ref** — and re-badges the branch `claimed`. The wrong answer
manufactures the evidence that justifies it, and an agent is set to work on
code already sitting on `main`.

It also explains the ref that had to be restored by hand earlier that day to
unblock a wave. That was the symptom; this `if` is the cause.

Not the finding that changed — its surroundings did. Worth re-reading every
open point after a merge that grants a component more autonomy.

## Design

### The constraint that shapes the fix

The obvious repair is the one `plot-reconcile-scan.sh` already uses: ask the
host for merged PRs and match their heads against the plan's branches
(`reconcile-scan-accuracy`, "the signal that survives a deleted branch").

**That answer does not transfer here**, and the reason is cost, not
correctness. `plot-fleet-scan.sh` is git-only on its default path — `pr_ready`
is reached solely under `--loose` — and that is exactly why the board can poll
it every 5 s. Adding a `--state merged` call to the default path inverts the
script's cost property from *free, callable at any rate* to *metered*.
Measured on this repo the same day: one board costs 80 GraphQL calls/hour, and
seven accumulated boards cost 560/h — enough to exhaust a 5000/hour budget
across a working day with no human call involved. A metered fleet scan on a
5-second timer would dwarf that.

### The local signal

Nothing local survives the ref itself. Checked before designing around it:
after `bug/scan-contained-in-pr` was deleted, `git reflog show
origin/bug/scan-contained-in-pr` fails outright and `for-each-ref` finds **0**
matching refs. There is no cached tip, no packed remnant to consult.

What does survive is the merge commit on the default branch. Verified against
this repo:

```
bug/scan-contained-in-pr           merge-commit:37e9ed4
bug/board-claimed-from-git         merge-commit:3b04a1e
bug/dispatch-records-started       merge-commit:d0f9d38
feature/push-main-bypass           merge-commit:d4b98af
feature/update-board-test          merge-commit:none      ← never merged
```

Four merged branches found, the one unmerged branch correctly absent, no API
call. So `branch_state()` gains one question before it answers `open`: *did
this branch land on the default branch?* A hit returns `merged`, which is
already the state that settles a wave — the arithmetic does not change and no
new state is introduced.

### Structure decides which merges count; text only supplies the name

The obvious implementation is a `git log --grep` for the branch name, and it is
wrong in the dangerous direction. Of this repo's 119 merges reachable from
`main`, 108 match `Merge pull request #<n> from <owner>/<branch>`. Eleven are
*backward* merges:

```
Merge remote-tracking branch 'origin/main' into bug/scan-single-pr-plans
```

That subject **also names a branch**, with the opposite meaning: main was
pulled *into* the branch, not the branch onto main. And these are genuinely
reachable from `main` — confirmed, not assumed: `35fb8a5` is an ancestor of
`origin/main`, so any scan of `origin/main --merges` walks straight over it. A
name-only grep would read all eleven as merge evidence and report **unfinished
branches as merged**.

That inversion is worse than the bug being fixed. Today the scan calls finished
work outstanding, which is irritating; inverted, it calls outstanding work
finished and **opens the next wave on an unlanded seam** — the exact failure
`--loose` was hardened against ("readiness must be verified, never assumed").

**The discriminator is the first-parent chain, and it is purely structural.** A
PR merge lands *on* the default branch, so main's first-parent walk passes
through it. A backward merge happens *on a branch*; it becomes reachable when
that branch later merges, but never sits on main's own first-parent line.
Measured across the full history:

```
all merges reachable from main : 119
merges on first-parent chain   : 109      ← all 11 backward merges gone
of those, PR-subject matches   : 108
```

**Zero backward merges survive the filter**, before a single string is
compared. So the order is: `git log --first-parent origin/<default> --merges`
selects the candidates, and only then does the subject pattern supply the
branch *name*:

    ^Merge pull request #[0-9]+ from [^/]+/<branch>$

A structural counter-check on the second parent was considered and **tested
away**: on both PR merges and backward merges, `^2` is a distinct branch tip
not already on the first parent's side, so that test does not discriminate at
all. It would have passed on all eleven traps. The first-parent filter is what
does the work.

Text stays necessary for one reason only — the branch's tip SHA is exactly what
a deleted ref no longer provides, so the merged branch cannot be matched by
commit identity. Text is the last link in the chain, not the load-bearing one.

### The one first-parent merge that does not match

Of the 109 first-parent merges, one has a hand-written subject:

```
41045d1 Merge PR #44: @plot-pm/board release pipeline — OIDC trusted publishing…
```

A real PR merge, on the first-parent chain, carrying **no branch name**. No
amount of pattern anchoring recovers it, and that is the honest bound on this
approach: a merge whose author rewrote the subject is invisible to it. It is
one commit in 109 and it belongs to a delivered plan, so it costs nothing here
— but it is why the plan does not claim the detection is complete.

### What happens when the signal is absent

The pattern depends on a commit-message convention. Squash and rebase merges
leave no such commit; hand-written subjects like the one above defeat it; a
branch genuinely never started has nothing to find either.

**All of them keep today's answer, `open`.** This is a strict improvement,
never a regression: the fix can only move a branch from `open` to `merged`, and
only on positive evidence. It must not guess in the other direction, and it
must not invent a third state the wave arithmetic would have to learn.

But `open` must stop being silent about *why*. Today the same word means "never
started" and "I could not tell" — the very ambiguity this plan exists to
remove, reappearing one level up. The summary footer therefore names the
detection source, in the shape `plot-reconcile-scan.sh` already uses for
`pr_source=gh|bb|degraded`:

    summary: … merge_detect=first-parent|none …

`none` when the default branch carries no conforming merge commits at all —
the squash/rebase repo — so a reader can tell "nothing was merged" from
"this repo does not leave the evidence I look for". Following
`bug/scan-contained-in-pr`: where evidence is unavailable, skip rather than
guess, and say that you skipped.

### Plan annotations are not consulted

Plans carry `→ #<n>` annotations, and using them would be cheaper still. The
plan does **not**, for the reason `reconcile-scan-accuracy` already established:
"the missing annotation and the missing delivery have the same cause", so a fix
depending on annotations misses exactly the sloppy plans that hang.

Confirmed live rather than quoted: `board-reads-git` has **both** its branches
merged (#123, #124) and **neither** carries a `→ #<n>` annotation. The very
plan whose stuck wave motivated this work would have been missed by an
annotation-based fix. Detection reads git and nothing else, which also keeps
the scan stateless — re-derived from refs and history on every run.

## Branches

- `bug/fleet-merged-branch-state` — `branch_state()` recognises a
  merged-and-deleted branch via the first-parent merge chain; `merge_detect` in
  the footer; absence keeps `open`; tests in `test/reconcile/fleet.test.mjs`

**One branch, deliberately.** An earlier cut split this into Detection and
Coverage waves. That was wrong twice over: the change is one function in one
file, so there is nothing to fan out, and the split created a sequential
dependency with no parallelism to show for it — the same shape currently
blocking `reconcile-scan-accuracy`. The last three bug branches (#122, #125)
each shipped implementation and ~200 lines of tests together, so a separate
test wave would formalise a step that does not happen in practice.

## Done when

- A branch whose PR merged and whose ref was deleted reports `merged`, and its
  wave reports `complete`. Demonstrate against this repo's real state
  (`reconcile-scan-accuracy` wave 2 → complete, wave 3 → eligible), not against
  a reading of the code.
- `--next` no longer names finished work. This is the assertion that matters
  most: it is the interface `plot-dispatch.sh` acts on.
- **A backward merge (`Merge remote-tracking branch 'origin/main' into X`) is
  not accepted as evidence that X merged.** Pin with a test that builds the
  real shape — a branch that merged main into itself and was *never* merged
  back — and assert it still reads `open`. This is the inversion described
  above and it fails silently; it is the single most important assertion here.
- **Candidate selection is first-parent, and a test proves it.** A test that
  only checks the subject pattern would pass with the filter removed, since
  backward-merge subjects do not match the PR pattern anyway. Pin it with a
  merge that *does* match the pattern but sits off the first-parent chain
  (a PR merged into a feature branch that later merged to main) — the case
  where structure and text disagree, and the only one that catches a dropped
  filter.
- A branch with no merge commit still reports `open` — no third state, no
  guessing — and `merge_detect=none` appears in the footer when the default
  branch offers no conforming merges at all.
- **Plan `→ #<n>` annotations are not read.** Assert against a plan whose
  branches merged with no annotation present (the `board-reads-git` shape);
  detection must still succeed.
- The default path makes **no host calls**. Pin this too: the whole design
  rests on it, and a future edit could reintroduce one without any test
  noticing.
- `pnpm run test:reconcile` and `pnpm run validate` pass.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs.
- Assert per line, not with whole-output regexes — this suite has been fooled
  three times by patterns matching across report lines or the summary footer.

## Notes

Structurally the same defect `bug/scan-contained-in-pr` fixed one `else` over
in `plot-reconcile-scan.sh`, where *"not the head of an open PR"* meant
**orphan**. Two scripts, one blind spot, one of them now repaired. Both cases:
a branch falls through to a catch-all arm that serves several causes and
answers the common one wrongly.

The board consumes this through the fleet pulse, so the fix also removes the
condition where a card can spring back to *eligible* after its work merged.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "How robust must the merge signal be, given no local ref trace survives?", "a": "Text plus structural counter-check — refined during interrogation to first-parent filter, after the proposed second-parent check was tested and found non-discriminating", "category": "technical-architecture"},
    {"q": "Should the fix consult plan → #N annotations?", "a": "No — git only; board-reads-git proved live that merged branches carry no annotation", "category": "technical-architecture"},
    {"q": "Is silently keeping `open` acceptable when no evidence exists?", "a": "Keep `open` but report the degradation via merge_detect in the footer", "category": "nonfunctional-observability"},
    {"q": "Keep Detection/Coverage as separate waves?", "a": "Collapse to one branch — no parallelism gained, and the last three bug branches shipped tests with the code", "category": "tradeoffs-decomposition"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": false},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

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

### The anchored subject is the whole mechanism

The obvious implementation is a `git log --grep` for the branch name, and it is
wrong in the dangerous direction. Of this repo's 119 merges reachable from
`main`, eleven are *backward* merges:

```
Merge remote-tracking branch 'origin/main' into bug/scan-single-pr-plans
```

That subject **also names a branch**, with the opposite meaning: main was
pulled *into* the branch, not the branch onto main. These are genuinely
reachable — confirmed, not assumed: `35fb8a5` is an ancestor of `origin/main`,
so any scan of `origin/main --merges` walks straight over it. A name-only grep
would read all eleven as merge evidence and report **unfinished branches as
merged**.

That inversion is worse than the bug being fixed. Today the scan calls finished
work outstanding, which is irritating; inverted, it calls outstanding work
finished and **opens the next wave on an unlanded seam** — the exact failure
`--loose` was hardened against ("readiness must be verified, never assumed").

The defence is the *shape* of the subject, anchored end to end:

    ^Merge pull request #[0-9]+ from [^/]+/<branch>$

A backward merge is a different sentence — it opens `Merge remote-tracking
branch`, so it cannot match however its branch is named. Measured on this
repo: **0 of the 11 backward merges match the anchored pattern.**

So the candidate set is simply what is reachable from the default branch:

    git log "origin/$MAIN" --merges --pretty=%s
      | grep -E "^Merge pull request #[0-9]+ from [^/]+/<branch>$"

### Two structural filters were considered and tested away

Both are recorded because each looked convincing and neither survived contact
with a fixture.

**Second parent as a counter-check.** The idea was to accept a subject match
only if `^2` is a branch tip not already on the first parent's side. Tested on
real commits: PR merges and backward merges are *identical* under it — both
have a distinct second-parent tip. It would have passed on all eleven traps and
discriminates nothing.

**First-parent chain as the candidate filter.** This one measured well and was
adopted in round 1 on the strength of `119 merges → 109 on the chain, all 11
backward merges gone`. The number was real; the comparison was not. It measured
the filter against *raw merges*, when the mechanism it must improve on is the
**anchored pattern**. Against that baseline:

```
reachable + anchored    : 108
first-parent + anchored : 108      ← identical
```

**The filter eliminates zero additional traps.** And it is not free: it breaks
GitFlow. A feature merged into `develop`, where `develop` later merges into
`main`, does not sit on `main`'s first-parent chain. Built as a fixture and
run:

```
feature/alpha work is an ancestor of main : YES
first-parent from main → hits             : 0   → open   ← wrong
reachable  from main → hits               : 1   → merged ← correct
```

A restriction whose measurable benefit is nil and whose cost is a false `open`
for every GitFlow feature. Dropped.

The general trap is worth naming, because it is easy to repeat: a new mechanism
was compared against *no mechanism* rather than against the one it was meant to
improve. That flatters any addition.

**Reachability does not over-report either**, which is the obvious worry once
the filter is gone. A PR merged into a long-lived branch that was then
abandoned is not reachable from the default branch at all — fixture-tested: 0
hits for a sub-branch merged into a `feature/big` that never landed.
Reachability is itself an ancestry claim, so it cannot see work that never
arrived.

### Which branch counts as "landed"

`MAIN` is already resolved as `Main branch` config → `origin/HEAD` →
`"main"`, so the script is not pinned to a branch named `main`. Detection uses
**that one configured default branch** and no other.

A GitFlow repo sets `Main branch: develop`, because that is where feature PRs
land and therefore where wave progress is decided. Release merges from
`develop` into a production `main` are a different question — the Released
phase, not wave progress — and deliberately out of scope here. One script, one
notion of *landed*; a second branch concept would have to be threaded through
the wave arithmetic, which currently knows exactly one.

### The merge subject a human rewrote

Of the 108 conforming merges, one nearby commit does not conform:

```
41045d1 Merge PR #44: @plot-pm/board release pipeline — OIDC trusted publishing…
```

A real PR merge carrying **no branch name**. No amount of anchoring recovers
it, and that is the honest bound: a merge whose author rewrote the subject is
invisible to detection. Nor can it be recovered structurally — matching by
commit identity needs the branch's tip SHA, which is exactly what a deleted ref
no longer provides. It is one commit, on a delivered plan, so it costs nothing
here — but it is why the plan does not claim detection is complete.

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

    summary: … merge_detect=pr-merge|none …

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
  merged-and-deleted branch from an anchored PR-merge subject reachable from
  the configured default branch; `merge_detect` in the footer; absence keeps
  `open`; tests in `test/reconcile/fleet.test.mjs`

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
- **A GitFlow feature is detected.** Build the two-level shape — feature merged
  into `develop`, `develop` later merged into the default branch — and assert
  the feature reads `merged`. This is the case that killed the first-parent
  filter; without a test it will be reintroduced by the next person who reads
  "119 → 109" and finds it persuasive.
- **A PR merged into a branch that was then abandoned does not read as
  merged.** The mirror of the case above: a conforming merge subject that is
  *not* reachable from the default branch must not count. This is what makes
  reachability safe, and it is the assertion that fails if someone later
  broadens the search to `--all`.
- **The default branch is honoured, not assumed.** Run the suite against a
  fixture whose default branch is `develop` (no branch named `main` present at
  all) and assert detection works. `MAIN` resolution already exists; this pins
  that detection uses it rather than a hardcoded `main`.
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
  "round": 2,
  "questionHistory": [
    {"q": "How robust must the merge signal be, given no local ref trace survives?", "a": "Text plus structural counter-check — proposed second-parent check tested and found non-discriminating; replaced by first-parent filter in round 1, which round 2 then removed as well", "category": "technical-architecture"},
    {"q": "Should the fix consult plan → #N annotations?", "a": "No — git only; board-reads-git proved live that merged branches carry no annotation", "category": "technical-architecture"},
    {"q": "Is silently keeping `open` acceptable when no evidence exists?", "a": "Keep `open` but report the degradation via merge_detect in the footer", "category": "nonfunctional-observability"},
    {"q": "Keep Detection/Coverage as separate waves?", "a": "Collapse to one branch — no parallelism gained, and the last three bug branches shipped tests with the code", "category": "tradeoffs-decomposition"},
    {"q": "What if the repo is on develop or next rather than main?", "a": "Overturned round 1: first-parent adds 0 traps caught over the anchored pattern (108 = 108) and breaks GitFlow (feature via develop reads open). Reachability + anchored subject instead; abandoned-stack case fixture-tested as safe", "category": "technical-architecture"},
    {"q": "Which branch counts as landed when a repo has both develop and main?", "a": "The one configured default branch (Main branch → origin/HEAD → main). GitFlow sets Main branch: develop; release merges to production main are the Released phase, out of scope", "category": "domain-workflows"}
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

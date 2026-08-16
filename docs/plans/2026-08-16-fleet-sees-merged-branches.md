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

git already holds the answer. A PR merge leaves a commit on `main` that names
the branch, and that commit survives the ref's deletion. Verified against this
repo:

```
bug/scan-contained-in-pr           merge-commit:37e9ed4
bug/board-claimed-from-git         merge-commit:3b04a1e
bug/dispatch-records-started       merge-commit:d0f9d38
feature/push-main-bypass           merge-commit:d4b98af
feature/update-board-test          merge-commit:none      ← never merged
```

Four merged branches found, the one unmerged branch correctly absent. No API
call.

So `branch_state()` gains one question before it answers `open`: *is there a
merge commit on the default branch that names this branch?* A hit returns
`merged`, which is already the state that settles a wave — the wave arithmetic
does not change, and no new state is introduced.

### Anchor the pattern, or invert the bug

**This is the part that is easy to get wrong.** 119 merge commits on `main`
today; 108 match `Merge pull request #<n> from <owner>/<branch>`. The other 11
are *backward* merges:

```
Merge remote-tracking branch 'origin/main' into bug/scan-single-pr-plans
```

That subject **also names a branch** — with the opposite meaning. It says main
was pulled *into* the branch, not that the branch landed on main. A naive grep
for the branch name would read those 11 as merge evidence and report unfinished
branches as merged.

That is the more dangerous direction. Today the scan calls finished work
outstanding, which is irritating; inverted, it would call outstanding work
finished and **open the next wave on an unlanded seam** — the exact failure
`--loose` was hardened against ("readiness must be verified, never assumed").

So the match must be anchored on the merge subject's shape, not on the presence
of the name:

    ^Merge pull request #[0-9]+ from [^/]+/<branch>$

### What happens when the signal is absent

The pattern depends on a commit-message convention. Squash and rebase merges
leave no such commit, and a repo configured that way gets no hit — as does any
branch genuinely never started.

**Both then keep today's answer, `open`.** This is a strict improvement, never
a regression: the fix can only move a branch from `open` to `merged`, and only
on positive evidence. It must not guess in the other direction, and it must not
invent a third state that the wave arithmetic would have to learn.

Following `bug/scan-contained-in-pr`: where evidence is unavailable, skip
rather than guess.

## Branches

### Detection

- `bug/fleet-merged-branch-state` — `branch_state()` recognises a
  merged-and-deleted branch from the merge commit on the default branch;
  anchored pattern; absence keeps `open`

### Coverage

- `feature/fleet-merged-branch-test` — pin the backward-merge trap and the
  no-evidence path in `test/reconcile/fleet.test.mjs`

The two waves are sequential, not parallel: the test branch pins the behaviour
the first branch introduces. Within wave 1 the change is a single function in a
single file, so there is nothing to fan out — this plan is deliberately narrow.

## Done when

- A branch whose PR merged and whose ref was deleted reports `merged`, and its
  wave reports `complete`. Demonstrate against this repo's real state
  (`reconcile-scan-accuracy` wave 2 → complete, wave 3 → eligible), not against
  a reading of the code.
- `--next` no longer names finished work. This is the assertion that matters
  most: it is the interface `plot-dispatch.sh` acts on.
- **A backward merge (`Merge remote-tracking branch 'origin/main' into X`) is
  not accepted as evidence that X merged.** Pin with a test; this is the
  inversion described above and it fails silently.
- A branch with no merge commit still reports `open` — no third state, no
  guessing.
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

---
"plot": minor
---

plot-dispatch: a held branch is refused, not offered

`plot-dispatch.sh --dry-run` reported `claimed=0` across a fleet with four live
agents, and offered `feature/the-row-carries-its-verdict` and
`feature/reconcile-calls-the-index-advisory` — both already implemented, tested
and green — as dispatchable. Acting on that output puts a second agent on
finished work.

`plot-fleet-scan.sh` derives every state from `origin/<branch>`, and both
branches had no remote ref at all: one local commit each, never pushed. No
remote ref means no claim, and no claim reads `eligible`. The scan is right
about what it reads — the worktree is on the other side of the machine.

The evidence was already being collected. `plot-dispatch.sh` enumerates local
refs and worktrees for its `in flight:` collision report, for the reason
documented beside it: dispatch creates worktrees on THIS machine, so a check
blind to this machine is blind precisely where it acts. It could see what a
branch *touched* and not that someone was *holding* it, because the two facts
came from different sources in the same script. It is now asked both.

A gate rather than a rule. "Always dispatch through `plot-dispatch.sh` so the
claim ref exists" was violated four times in one evening by an operator who had
read it that evening — the check *"did I claim this?"* is answerable without
doing it.

Held needs both halves, because either alone is wrong. Without a worktree there
is no desk and nobody at it, and a bare local branch is not a hold — plenty
exist for other reasons. And the work must be unlanded: six of the thirty-six
worktrees on the machine that measured this were leftovers whose work had
merged, so refusing a merged tip would make the gate fire on exactly the
branches that are safe, which is the fastest way to teach an operator to route
around it.

Two findings from running the gate against this repo after it was written and
green, each of which a tip-only check gets wrong:

**Uncommitted work counts, and is checked first.** A worktree cut minutes ago
points at whatever main was then, so `--is-ancestor` calls it *landed* —
`ahead=0, behind=N`, indistinguishable by history from the merged leftover the
gate must not refuse. `plot-wt-a-branch-row-carries-its-link` was in exactly
that shape with six modified files and no commit, held by a live agent, and the
first version of this gate offered it. Only the file state separates the two
cases, and `uncommitted_files` was already collecting it for the in-flight
report a few lines above.

**The worktree is found by asking git, not by rebuilding its path.** The first
version derived the path from the branch name via dispatch's own flattening
rule and missed that same six-file worktree: every hand-made worktree on the
machine drops the branch *type*, so `bug/a-branch-row-carries-its-link` lived in
`plot-wt-a-branch-row-carries-its-link` where the rule says
`plot-wt-bug-a-branch-row-carries-its-link`. That failure lands in the worst
possible population — worktrees dispatch did not create are precisely the ones
carrying no claim ref, which is the whole reason the gate exists, so a
convention-matching check could only ever catch the already-claimed.

Three things it deliberately does not do:

- **It does not claim on the operator's behalf.** A claim ref for a worktree
  this script did not create is a record in git nobody asked for, and a stale
  claim is worse than an absent one — the reaper cannot tell it from a real one.
  The gate reports the path and stops; the operator decides.
- **It does not refuse a leftover worktree on a merged branch**, per above.
- **`--allow-local` does not override it.** That flag is the named escape for a
  repo whose `origin/<main>` cannot be resolved; it says something about reading
  a *phase* and nothing about whether a human is mid-edit. It is absent from the
  check by construction rather than by a conditional, and a test pins that.

`--dry-run` refuses identically, through the same function rather than a second
message that agrees today: a dry run that offers what a real run would refuse is
worse than no dry run — the same wrong answer with a reassurance attached. Its
summary footer carried a hardcoded `skipped=0` until the gate gave it something
to count.

One existing test changed fixture, not assertion. *"the candidate is never
reported as blocking itself"* gave the candidate a worktree with unpushed
commits, which is now precisely what the gate refuses — so the candidate became
un-offerable and the report unreachable, by the mirror image of the route the
test was already written to avoid. It now prepares that branch with **no
worktree**: the property under test belongs to `committed_files`, which reads
refs and needs no desk. Both properties keep their own fixture, because they are
close enough to collide.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot: minor
-->

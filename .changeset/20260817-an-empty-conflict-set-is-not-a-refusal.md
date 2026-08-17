---
"@plot-pm/board": patch
---

The artifact resolver now distinguishes *nothing observed* from *other files*, merges only in a worktree that is idle, and does not repeat a `not-observed` refusal every pulse.

**An empty conflict set is not a small one.** Measured live on 2026-08-17: a row read `artifact conflict — conflicting: skills/plot/scripts/board/board-server.mjs`, and beneath it `repair refused — not-artifact-only`. The classification and the refusal contradicted each other, and the classification was right — one file, and it was the artifact. The resolver's log said why: it reused a worktree in which no merge was running, so `git diff --diff-filter=U` returned nothing. It found zero paths, compared zero against one, and concluded *not artifact-only*.

Formally correct; factually inverted. **Empty there does not mean "other files", it means "I did not look."** The rule that produced it was correct and deliberate — that wave was told never to act on a host verdict without an observed conflict set — and the same test, applied to a set it never gathered, refused the one repair it was built to perform.

So the two refusals are named apart, because `not-artifact-only` asserts something about the files that conflicted and a set of zero has none to assert it about:

| Conflict set | Meaning | Resolver |
|---|---|---|
| exactly the artifact | the licensed case | repair |
| other files present | needs judgement | refuse, `not-artifact-only` |
| empty, no merge ran | nothing was observed | refuse, `not-observed` |

A conflict is not the only thing that ends a merge non-zero: a merge that never *started* — blocked by a dirty worktree, by a merge already in progress, by a ref that would not resolve — exits non-zero too and leaves nothing behind. The assertion is on the reason string rather than on the refusal, since a refusal naming the wrong cause sends the reader to look for files that were never examined.

**The resolver no longer merges in a worktree someone else is working in.** Measured at the same moment as the refusal above: zero unmerged paths, three modified files, an agent working in it — and the resolver ran `git merge` inside it anyway. It refused before writing anything, but that was luck rather than design. Reuse is right when a worktree is idle, and the name alone does not say so; a worktree carrying modifications now refuses as `worktree-busy`, which the plan names the honest minimum. Untracked files are deliberately not counted: a stray log is not work in progress, and `merge` does not touch it — a fence counting every difference would refuse repairs for no reason.

**Retry when the input changes, not when the clock ticks.** The pulse fires every 5 s and the branch stays `artifact-conflict` throughout, so a refusal leaving the input untouched was restarted by the very next pulse — five identical log entries, one per pulse, each reaching into the same worktree, none carrying information the one before it lacked. A `not-observed` refusal is now remembered against the input that produced it and not retried until that input changes.

Scoped to `not-observed` alone, and the scope is the argument rather than a convenience: `tests-failed` and `build-failed` depend on a suite, `push-failed` on a remote that moves, `worktree-busy` and `already-in-flight` on state that clears the moment their owner finishes. Suppressing any of those would be a repair never retried after the world fixed itself. `not-observed` is the one whose cause lies entirely inside its input — nothing was read, and re-reading the same input reads nothing again. A run whose log could not be read is never suppressed either: the exit code cannot tell one failure from another, and suppressing on that guess would silence repairs that should retry.

<!--
bumps:
  skills:
    plot: patch
-->

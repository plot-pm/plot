---
"plot": minor
---

Harden the fleet commands for first real use.

Probing the new commands from outside this repo surfaced defects that only appear in a fresh project. All are fixed:

**`/plot-dispatch` now gates on phase and ceremony, in the script.** It refuses a plan that is not Approved, and one whose `Impl:` answer is not `own branches`. Previously that check lived only in the skill's prose — a rule an agent can rationalise around and a human calling the script directly bypasses entirely. It **fails closed**: if the phase cannot be read, it refuses. That is the opposite of `plot-phase-gate.sh`, which is a PreToolUse hook and must fail open so a broken gate never locks a repo; here the user invoked the command, and starting several agents on unapproved work is the costly mistake.

**Workers are inspectable.** `--status` lists every fleet worktree with its worker pid, whether that process is alive, and the last line of its log; `--stop <branch>` stops one. Both work regardless of plan phase — work already running must stay reachable. `--stop` requires an explicit branch name; there is deliberately no "stop everything".

**Claims now age.** The reaper could tell a deliberately abandoned claim from a bare one, but not a worker that is thinking from one that died days ago. A claim older than `Claim stale after` (hours, default 24) is reported as stale with its age. Still no deletion command: staleness is evidence, not permission.

`Claim stale after` is a new key rather than a reuse of `Sprint stall limit`, which counts iterations without a deliverable in a serial run — a different quantity. Reusing it would have silently read "3 iterations" as "3 hours".

**`/plot-merge-queue` checks its git version.** `merge-tree --write-tree` needs git ≥ 2.38. Older git has a `merge-tree` with entirely different semantics that succeeds while answering a different question, so every branch would read as conflict-free. A false all-clear is worse than a refusal.

**Two loops and an exit code fixed.** `--next` returned 0 in a repo with no plans, so the caller pattern the skill itself recommends would accept an empty branch name as valid work — in any repo on day one. And `plot-dispatch` spun forever when a worktree could not be created, because `--next` has no memory and kept offering the same unclaimable branch.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot-fleet: patch
    plot-merge-queue: patch
    plot-reconcile: minor
-->

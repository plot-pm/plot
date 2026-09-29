# A slice starts its own conversation

> A desk handed a second slice resumes the first one's session. The 3.7 MB transcript stays silent for 2 770 s while it reloads, the idle rule reads that silence beside the previous slice's commits, and the monitor kills a worker that never got to start.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1067
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A slice handed to a reused desk starts its own conversation instead of resuming the previous slice's.

Board impact: the board follows an agent's transcript by session id, and this changes how many a desk has. See *What the board loses*.

## Motivation

Measured by an operator on 2026-09-29 (`ewz-leg`, desk `.worktrees/free-6bf72564`), with a second independent reproduction on `free-1ca12583`:

- transcript `faea98ad-….jsonl` opens 11:32:46Z for `bug/EWZLEG-861-leg-admin-validto`, reaching **3.7 MB** by 12:48Z
- the next slice, `feature/EWZLEG-872-…`, **resumed that session**; the transcript is silent 12:48:24Z → 13:34:34Z — **2 770 s** — and the 872 prompt appears only at the end
- at 13:04:19Z the WorkerMonitor reported `idle`: *"silent for over 900s … and the branch already carries commits"*. Those commits were **861's**, still on the reused desk.
- the loop ended the worker, `exit 124`, `.plot-worker.ending.json` recording `reason: quiet, actor: monitor`

`--restart` minted a fresh id and that worker ran normally.

### The mechanism, confirmed in source

`session_handle()` (`plot-worker-loop.sh:716-724`) returns the manifest's `resumeId` unconditionally. `session_flag()` (`:744-750`) picks `--resume` whenever a transcript for that handle exists. **Neither asks which branch**, and `resumeId` is the agent's launch id, unchanged for every slice on the desk.

### This overturns a decision, and that is the plan's real subject

`plot-worker-loop.sh:271-284` is not an oversight. It settled the question on 2026-09-05, deliberately:

> **IT DOES, AND THE VALUE IS THE ONE THE NEXT PROMPT CONTINUES.** An agent keeps a single conversation for its whole life, because `transcript.ts:100` opens `${sessionId}.jsonl` literally and a forked chain is a linked list the board cannot follow.

The constraint is real — `packages/board/src/server/transcript.ts:100` does exactly that. **So this plan must pay the cost that decision was avoiding**, not pretend it does not exist.

## Design

### The rule

**A hand-over to a DIFFERENT branch mints a new handle. A hand-over to the same branch resumes.**

`--resume` continues *this slice*; it never crosses into another. The condition is a comparison the hop already has in hand: `update_manifest_on_hop` receives `$2=new_branch` and the manifest holds the old one.

### Where the change goes

`update_manifest_on_hop` (`:301`) is the one writer of `resumeId`, and it is the function that knows both branches. **The decision belongs there**, not in `session_handle`, which has no branch to compare and is called from several places.

### What the board loses, stated rather than discovered

An agent stops having one transcript. `transcript.ts:100` opens `${sessionId}.jsonl` literally, so **the board will follow the newest slice and lose the previous one's history for that agent.**

That is the cost, and it is the right trade: a reader who wants the *current* slice's conversation is served, where today they get a 3.7 MB file whose last 46 minutes are a reload. **But the slice must say what the board shows for a desk's earlier slices** — whether they are unreachable, or reachable another way. It may not discover this in review.

### The idle rule is the second half, and it is separate

The monitor's evidence includes *"the branch already carries commits"* (`plot-worker-monitor.sh:551`). On a reused desk those commits may predate the hand-over, so the condition reads as *this worker has done work and stopped* when the truth is *another slice did work here*.

**Fixing the session alone leaves this**: a fresh conversation is fast to start, so the 900 s silence goes away and the rule stops firing — by accident. **The condition is still wrong and the slice must say whether it fixes it or files it.** A rule that stops misfiring because its trigger got rarer is not fixed.

### What this does NOT do

- **It does not fork a session.** `--fork-session` is the concept `:283` predicted; this plan mints a fresh id and does not build a chain.
- **It does not change `attempts`.** A hop is the same agent continuing and the retry budget is unchanged — the node one-liner round-trips every field it does not name.
- **It does not touch `--restart`**, which already mints a new id and is the documented recovery.
- **It does not change the monitor's thresholds.**

## Done when

- **A hop to a different branch produces a handle the previous slice does not own**, asserted by reading the manifest across two hops.
- **A hop to the SAME branch still resumes**, asserted — the property that makes `--resume` worth keeping.
- **A new slice's first prompt reaches the runtime within the monitor's quiet window**, asserted against the measured failure: 2 770 s of reload against a 900 s threshold.
- **What the board shows for a desk's earlier slices is stated in the PR**, with whatever `transcript.ts` does about it.
- **The idle rule's commit condition is fixed or filed**, named either way. It is wrong on a reused desk whether or not this plan makes it quiet.
- `attempts` and every unnamed manifest field survive a hop, asserted.

## Slices

### A slice starts its own conversation (Branch: bug/a-slice-starts-its-own-conversation)

Mint a fresh handle in `update_manifest_on_hop` when the branch changes, keep resume for the same branch, and state what the board shows for earlier slices.

## Notes

**The operator reported a second defect in the same message and it is not planned here:** a supervisor-started worker could not find `claude` — launchd's PATH lacks `~/.local/bin`, `exit 127` three times — and they worked around it in their own `.plot/worker-prompt.sh`. Plot's shipped template could carry the same fallback. **Filed as #1068 rather than folded in**, because it is an installer question and this is a session-handle question.

**The decision this overturns was argued and dated**, which is why the plan quotes it. `plot-worker-loop.sh:271-284` chose one conversation per agent to keep the board's transcript reader working, and named `--fork-session` as the shape a change would take. The measurement that overturns it is the 2 770 s reload — a cost that did not exist when a desk's second slice was rare.

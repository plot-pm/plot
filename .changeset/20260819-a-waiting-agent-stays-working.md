---
"@plot-pm/board": minor
---

board: a waiting agent stays in WORKING, annotated with what it waits on

An agent that stopped to ask a question was sent to WAITING ON YOU. A waiting
agent is still an agent: its worktree is live, its context is intact, and what
unblocks it is an ANSWER rather than a review. Filing it under the other verb
took it out of the section that answers *who is working?*, so an operator
counting agents in WORKING undercounted every one that had stopped to ask — and
the row arrived in WAITING ON YOU carrying none of what that section is built to
show: no PR to open, no checks to read, nothing to inspect on the host.

**The two sections answer different questions, and that is the whole rule.**
WAITING ON YOU is for RESULTS — branches, PRs, CI status, failures, things a
person inspects and decides about on the git host. WORKING is for AGENTS. The
`waiting` arm now returns `working`, placed beside `running` rather than among
the stopped states, because those two are the pair that mean *an agent still
holds this branch*. The comment above `running` is the precedent it follows: a
worker's own state outranks reasoning from commit age.

**The note says what it waits ON, not merely that it waits.** *worker is waiting
on an answer from you* named a state and withheld the only part a reader could
act on — they had to open the worktree to learn whether the question was even
theirs. The row now carries the marker line the scan's verdict was made from:
*worker waiting on you: PLOT-BLOCKED: which adapter should the fallback use?*

**An unreadable marker is a stated unknown, never a guess.** The scan already
found a marker — that is what made the worker `waiting` — so a failed read here
means this read did not find what that one did, not that nothing was asked. The
row says *reason unavailable, look in its worktree* and stays in WORKING. A
fabricated question would be far worse than a blank: a reader who answers the
wrong question has done work that clears nothing, and unlike a blank they have
no signal that they were misled.

**No new state and no new source.** The `asking` state this wave originally
proposed is withdrawn, and the reason is worth carrying: the log records that a
question *was asked*; the marker in the tree records that it is still
*unanswered*, and only the marker clears when someone writes the answer. A
restarted worker was measured finding its own question already answered in the
commit above it and carrying on — a log-shaped detection would have shown it as
still asking. `waiting` (PR #219) already reads the tree, and it was already
correct; this changes one verdict about it.

**The marker text is read on the SCAN's clock, not the render path.** `classify`
is a pure function called for every branch on every poll, so a subprocess inside
it would spawn git synchronously, once per row, every five seconds. The new
`workerQuestions` runs inside the scan refresh — where every other local fact on
the row is already read — and only for branches the pulse reports as `waiting`
with a worktree on this machine. A fleet with no questions in it spawns nothing
at all. Like `worker-log.ts`, every path segment comes from the pulse's own
`local_worktree` and none from a caller, and the search is `git grep` rather than
a recursive one: a worktree holds `node_modules`, and walking it on a 5 s timer
is not a cost this can carry.

**The questions are deliberately not bridged across a restart.** Every other
field in the pulse bridge stays true while the process is gone — a commit's age,
a plan's approval date — so restoring it labelled with its real age is honest. A
question is the opposite: it exists precisely until somebody answers it, and the
answering is often what a `node --watch` restart is FOR. A bridged question would
name something already resolved inside a fresh-looking row. Absent instead, which
renders as the stated unknown until the first scan lands.

**The ordering guarantee survives the move.** `waiting` is still tested before
`stalled`, and is now further above it than before. A worker that asked a
question has almost always left the work it was doing uncommitted beside the
question, so ranking dirtiness first files every such branch under *resume it*
and invites a restart into the same wait — measured happening twice to one
branch, the second restart re-running work the first had finished. Asserted
directly: a `waiting` worker with dirty files lands in WORKING and its note does
not say *resume it*.

**What deliberately did not change.** The PR arm still outranks this: a PR with
conflicts or failing checks is a person's errand even while an agent waits, and
`waiting` gets no version of the `running` exemption — that exemption exists for
an agent that opened a PR and kept working, and an agent that has stopped is not
that. A `finished` worker with a PR still goes to WAITING ON YOU, and a `stalled`
worker still goes there too. All three are asserted alongside the change.

One documented claim was retired rather than reworded: *when only `working` is
populated you can walk away*. It no longer holds, because a populated WORKING
section may hold one row that wants an answer. That is the honest trade — a rule
checkable at a glance is worth less than a section whose membership is true.

A pleasant composition falls out unasked. `showsWorkerLog` gates on WORKING
membership alone and knows nothing about worker states, so a waiting row now
gets the log the sibling wave shipped: the reader sees the question on the row
and can open the reasoning behind it without a second tool. In WAITING ON YOU it
had neither. Asserted, so neither wave can be undone without noticing.

The marker pattern is a second copy of the scan's, and that is named rather than
hidden. Teaching the scan to emit the marker line as a pulse field is the better
shape and is out of this branch's scope. What drift costs here is a sentence and
never a section: this pattern never decides `waiting` — the scan does — so a
spelling it misses degrades one row to *reason unavailable* while the row stays
in WORKING. A test asserts the set of spellings, so a divergence is a red test
rather than a quietly emptier board.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side verdict change only.
`plot-worker-state.sh` and `plot-fleet-scan.sh` are deliberately untouched —
`waiting` is already correct in both, and the marker they read is what this
change explains rather than re-decides. The `/api/fleet` payload gains no field;
the annotation is composed into the existing `note`.

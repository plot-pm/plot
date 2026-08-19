---
"@plot-pm/board": minor
---

board: continue an answered agent — a new run, not a reply

`claude -p` has no stdin after launch, so the agent that wrote a `PLOT-BLOCKED:`
marker is gone by the time anyone reads it. `POST /api/continue` starts a NEW
worker in the same worktree; the control is called **Continue with an answer**
and every string around it says so, because a *Reply* would promise a channel
this system does not have and cannot grow without a different runtime.

**The prompt is the brief plus the answer plus what already landed — never the
previous run's transcript.** A worker that ran an hour produces one large enough
to fill the next one's context before it starts. The brief is the specification
and has not changed; the answer is the new fact; and what the previous run
committed is read from `git log main..HEAD` — durable, current, re-derivable, and
in the tree the worker has checked out anyway. Commits are NAMED, never pasted:
a diff fills a context window as readily as a transcript does. The test asserts
the negative directly, because it is the decision the plan's interrogation turned
on and the kind that decays through a well-meant edit.

The answer reaches the worktree as a FILE, not as a shell word. `Worker command`
is a shell fragment run through `sh -c`, so an answer interpolated into it would
be shell source — one `"; rm -rf ~` from a person unblocking an agent. The prompt
is written to `.plot-worker.continue.md` and its path travels in
`PLOT_CONTINUATION`, beside the `PLOT_BRANCH` and `PLOT_WORKTREE` the dispatcher
already exports. The `.plot-worker.` prefix is deliberate: the marker searches in
both `plot-worker-state.sh` and `worker-question.ts` exclude it, so a prompt
quoting the old question is not re-detected as a new one.

**The stale marker is the new worker's to clear, and the prompt says so.** The
route could delete it at spawn time; that was rejected. It would put a write to
the branch's tree in an endpoint whose job is to start a process, and it would
lie in the window that matters — between the delete and the new worker's first
commit the branch reads `finished`, which is *review it*, aimed at a human, for
work not yet done. Worse, a worker that fails to start would leave the branch
reading finished forever with the question gone. So the marker stands from the
answer until the continuation has acted on it. The cost is named: a continuation
whose worker dies before clearing it leaves the branch reading `waiting`, and
someone may answer twice. That is recoverable by looking; the alternative is
not, because it shows nothing at all.

Four refusals rather than one, each naming a different next move: `unknown-branch`,
`no-worktree`, `no-question` and `no-worker-command`. A branch with no marker
cannot be continued at all — the precondition is exactly the state the control
was offered for, and without it a click could start a second agent in a worktree
that holds a live one.

The spawning guards are `/api/dispatch`'s, imported rather than rewritten: the
same-origin check and the bounded body reader exist because this endpoint class
spawns processes, and a second copy is a second place to forget them. The body
bound is raised for this route alone and derived from the answer bound, so the
two cannot drift into rejecting a legal answer as a transport error.

The plan's `Branches` line said *prompted with the transcript and the answer* —
stale since the 2026-08-19 interrogation rewrote section 4. Both copies of that
sentence are corrected, including the one in *What is NOT observable* that the
brief did not name; a decision recorded twice drifts in exactly this way, which
is what produced this task.

<!--
bumps:
  skills:
-->

No skill version bumps: this is board-side only. `plot-dispatch.sh` and
`plot-worker-state.sh` are deliberately untouched — the continuation reuses the
dispatcher's own launch shape (`sh -c` over `Worker command`, the same
`PLOT_*` environment, the same `.plot-worker.*` records) rather than teaching
either script a second mode, and worker liveness stays the scan's single verdict.

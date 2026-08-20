---
"@plot-pm/board": minor
---

board: a broken agent says what broke and where to look

The **Surfaced** wave of `2026-08-20-every-section-has-one-subject.md`, after
`bug/an-agent-is-not-a-machine-you-wait-on` (#300) settled the machine section.

WAITING ON YOU is for what needs a **person's decision** — a PR, a branch, a
plan, a release, a build. An agent has no business there while it works: an agent
*is* the worker, and WORKING is the section that says so while also saying *who*.
**An agent appears here only when something is wrong with the agent**, and its
presence is then itself the signal.

**The placement was already right, and that is the finding this wave starts
from.** Measured before changing anything: `failed`, `ended` and `stalled`
already return `group: 'waiting-on-you'`, and `running` and `waiting` already
return `working`. The three broken states were in the right section and said the
wrong things there — so what this wave changes is the sentence, not the routing.
The plan's own table anticipated the two representable cases; what it could not
see from the outside is that both were already representable *and already
placed*.

**The notes said what to do, and they are not entitled to.** They read *worker
failed (exit 127) — restart it* and *worker stopped with work unfinished —
resume it*. Both are verdicts about the schedule: whether a crashed agent is
worth restarting depends on what its log says and on what else is in flight,
neither of which the classifier can see — and the board restarts nothing in any
case, since relaunching is `/plot-dispatch`'s to do. Evidence, not verdict, is
the estate's rule for exactly this (Manifesto Principle 3: scripts collect,
humans conclude), and it is what `HOST_ANSWER_HINT` and the changed-files modal
already follow.

| state | before | after |
|---|---|---|
| `failed` | `worker failed (exit 127) — restart it` | `worker crashed — exited 127 · log: …` |
| `ended` | `worker ended, exit status unknown` | `worker stopped, exit status not recorded · log: …` |
| `stalled` | `worker stopped with work unfinished (…) — resume it` | `worker stopped without finishing and without asking (…) · log: …` |

**Advice still exists, in the surface whose declared job it is.**
`AttentionItem` carries `action: 'restart it'` beside the `verdict` a consumer
branches on and the `evidence` it traces to — auditable by construction. So
*restart it* is right there and wrong in a note, and `attention.ts` is untouched.
The two surfaces are not inconsistent; they answer different questions.

**The two broken kinds must not share a sentence.** *Stopped without finishing*
is not *crashed*, and the reader does different things with them. A `stalled`
worker **exited 0** — the process ended normally and the tree says the task did
not end with it, which is why `stalled` is a TASK state rather than a process
one — so there is no exit code to report and nothing crashed. *Without asking* is
the half that earns the phrase and is not rhetorical: a worker that stopped to
ask is `waiting` and stays in WORKING, so reaching the stalled arm means the scan
found no marker. Without that clause a reader cannot tell an abandonment from a
question they overlooked. `ended` names neither, because the record that would
settle which is the thing that is missing.

**The row names where to look.** A reader told an agent crashed and not told
where its log is has been informed, not helped — they still have to find the
worktree, which is the errand the row existed to save them. The clause names the
log *file* and the worktree: the log is a dotfile, so a reader given only the
directory runs `ls`, sees nothing, and concludes there is none.

**The path is never probed first.** Deciding the clause on `existsSync` would
make one sentence depend on a disk read taken at scan time and rendered later, so
a log rotated between the two would silently drop the only pointer the row had.
The clause says *where a log would be* — true whether or not the file survived —
and `/api/worker-log` answers *is there one*, which it already does with
`no-worktree`, `no-log`, unreadable and empty as four distinct outcomes. One
question, one owner.

**`classify` takes the worktree path, after `held` deliberately did not.** `held`
is the authoritative form of `local_worktree` *for the WORKING lift* — a boolean,
because a lift must not be decided on a path's mere presence, which is the
merged-leftover misread it exists to prevent. That argument is about DECIDING,
and the new parameter decides nothing: it lands in a sentence a person reads. So
both are right and both are there, and neither derives from the other — a merged
leftover has a path and earns no lift, while a branch held on another machine has
no path here at all. `""` is a stated absence and the clause is simply omitted:
the path is meaningless on any other machine, so a reader elsewhere gets the
evidence and no location rather than a directory that does not exist where they
are reading.

**Nothing in `AgentList.tsx` changed.** The note renders `truncate` with
`title={note}`, so a longer sentence is clipped visually and whole on hover — and
the location rides at the end behind the estate's `·` separator, so truncation
loses the path before it loses the fact. Two other branches are rewriting that
file in parallel; this wave stayed out of it.

**The regression guard on #300 is asserted from this side.** The two sections now
have disjoint agent rules — WAITING ON YOU takes an agent only when it is broken,
WAITING ON A MACHINE never takes one at all — and this is the wave that gave
agents a reason to be routed anywhere, so a future change surfacing a broken
agent by pushing a process entry would re-create #300's duplicate exactly. The
sweep runs over the whole `WorkerState` enum with `local_worktree` set, since that
is the field this wave newly reads.

**A negative assertion was disarmed by the rewording, and re-armed.** The
ordering guarantee *waiting outranks stalled* — measured causing two restarts of
one branch, the second re-running work the first had finished — was guarded by
`expect(note).not.toMatch(/resume it/)`. Rewording the stalled note made that
pass vacuously against a string nothing composes any more. It now asserts the
wording the stalled arm actually produces, plus positively that the row carries
its question.

**`compact context` is not here and cannot be.** The plan's third broken case is
undetectable: an agent with a full context still reports `running`, because the
condition is in the transcript rather than in the process. The registry reads
`contextTokens` for it and it arrives **absent** — this repo's `Worker command`
forwards no `--session-id`, so the transcript join degrades. Inferring it from
uptime or a token guess is what the plan's open point forbids until that forward
is fixed, and this wave does not.

**What deliberately did not change.** WORKING keeps `running` and `waiting`,
including a worker that stopped to ask — its question is its note, and moving it
would say a person must decide when an agent is mid-task. `finished` stays in
WAITING ON YOU as a result to review and is not described as broken; review and
restart are opposite moves. No PR, branch or plan row moves, and a conflicting PR
still outranks a worker. Making WORKING agent-centred is the next wave.

`WORKER_LOG_FILENAME` is a second spelling of `worker-log.ts`'s
`WORKER_LOG_NAME`: that module imports `pulseFor` from `fleet.ts`, so importing
back would close a cycle. Both describe one `plot-dispatch.sh` constant — the
shell is the source, and `continue.ts` already spells it a third time inline.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change to one sentence and its
routing. No helper script composes a row's note, `plot-fleet-scan.sh` is
untouched — the worker states it reports are unchanged — and the `/api/fleet`
payload loses no field. What changes is what a broken agent's row *says*, and
`local_worktree` was already on the pulse.

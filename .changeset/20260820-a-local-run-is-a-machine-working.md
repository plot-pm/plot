---
"@plot-pm/board": minor
---

board: WAITING ON A MACHINE is keyed on the process, not on the holder

The section is named correctly and was filled from exactly one source:
`pr.checks === 'pending'` on the git host. So it described what happens on the
HOST while the board sat in the very repository a local run was happening in — a
`vitest` run, a build, a scan in a worktree is a machine working that the board
could not show. A correct rule with too small a scope, the same shape
`worker: running` had when it was sealed inside the `claimed` arm.

Two measured cases fell through a rule keyed on who HOLDS a branch, and they
fall in opposite directions:

    exit 0, branch pushed, PR open, validate pending, guard: working=0
      -> NEITHER section. Not WORKING, because no agent held it; not WAITING ON
         YOU, because the checks had not landed.

    one live worker, PR open, checks pending
      -> BOTH, and a single `group` must pick one and be wrong about the other.

**The row stops being the entity.** WORKING lists AGENTS — *this agent is on
`bug/x`* — and WAITING ON A MACHINE lists PROCESSES — *CI is running for
`bug/x`*. The same branch appearing in both is not duplication: the entities
differ, and *who is working?* is a different question from *what am I waiting
on?*. Each entry names its branch, so two lines never read as one repeated.

`AgentRowSchema` gains `processes` — a list of `{ origin, evidence, pid }`,
where `origin` is `host` or `local`. It does NOT decide the section. `group`
still says where the branch's own row goes, unchanged, and the new field says
which processes the machine section additionally lists; a row can therefore be in
WORKING and have a process in WAITING ON A MACHINE at once without either field
contradicting the other. Folding process liveness into `group` is exactly what
made the both-sections case a coin toss, so it is not re-folded there — and
`classify` still returns a single placement, which a test pins.

**Derived, never collected anew, and that was checked before anything was
added.** Both entries come from facts the pulse already carries: `worker` and
`worker_pid` for a local run, `pr.checks` for a host one — both already read by
`classify` two arguments away. The alternative was to enumerate processes whose
cwd lies inside a worktree, and it is rejected on two counts: it would collect
every editor and shell a person happens to have open in a checkout and report
them as machines working, and it would be a new cost on a scan this repo's own
comments measure at 18.3 s. The fleet writes a pid where it starts a process;
that pid IS the observation, and it is the only local process the board can
honestly claim to see. `plot-fleet-scan.sh` and `plot-worker-state.sh` are
untouched.

`running` ONLY, of the eight worker states, and the seven negatives are most of
the field's meaning. `finished`, `failed` and `ended` are stopped; `waiting` and
`stalled` describe a TASK rather than a running program; `none` and `elsewhere`
are stated unknowns — `plot-dispatch` writes a pid only where it started the
worker itself, so an absent record licenses no claim in either direction.
Listing any of them would put *a machine is working* under a branch where none
is.

**Evidence, never a forecast** — the rule this plan estate repeats at every
level, and the one place it is visible to a reader. Each entry says what was
OBSERVED: *a worker process is running in a local worktree (pid 20145)*, *CI is
running for PR #244*. No entry names a remaining time, because nothing measures
when a local run ends and GitHub publishes no finish time for a queued check.
The section's empty hint loses its forecast for the same reason: *nothing — CI
will finish* predicted an outcome nothing here measures and named the one source
the section used to have, and it now reads *nothing — a machine is working*.

The section's sentence is the PROCESS's, not the branch's, and that is what
defends listing a branch twice. A live worker's `note` is *worker running (pid
20145)* — a true statement about an AGENT, which the WORKING row already makes.
Repeating it under WAITING ON A MACHINE would put one line in two sections and
prove the duplication complaint right, so the row takes a `section` prop and
composes from `processes` there. Passed in rather than derived from `row.group`,
because `group` is precisely what cannot answer it: a live worker's group is
`working` in both places it renders.

A host-side pending check still lands there through `group`, whether or not any
process is listed — the first clause of the predicate is the old rule verbatim,
so a pulse from a scan predating the field renders unchanged. The client reader
also tolerates the field being absent entirely: the page is a built artifact a
reader may have open across a restart and `/api/fleet` answers from whichever
server is running, so reading `.length` off an absent array would take the whole
board down over a missing convenience field.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched, and the `/api/fleet` payload gains a field rather than changing one —
an older client's schema strips what it does not know, and an older server's
payload validates against the new one by the default.

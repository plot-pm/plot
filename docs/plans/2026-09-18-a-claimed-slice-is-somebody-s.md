# A claimed slice is somebody's

> A claim reserves a slice and hides it: the queue is *eligible, briefed and unclaimed*, so a branch claimed with no agent on it is in no queue, in no hold list, and reported by nothing.

## Status

- **State:** Rejected
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Rejected:** 2026-09-18, jwloka, both slices refuted; the population measured 0

## Changelog

- A slice that holds a claim with nobody working it is reported rather than invisible, and a free agent's desk says it is free rather than reading as stalled work.

<!-- Board impact: a new reading reaches the fleet payload and a row's state
     word changes for one population. No plan format, no template. -->

## Design

**Measured on this estate 2026-09-18, twice in one hour.** Both findings are one
sentence apart in the same rule, and neither is visible to any operator command.

### A claim makes a slice ineligible for the queue that would staff it

`rules/queue.ts:7` states the contract:

> **"An eligible slice with a brief and no claim *is* queued"** — there is no
> queue file, no ordering record and nothing to reconcile after a restart.

Derived-never-stored is right and is not in question. What follows from it is:
**a claim removes a slice from the queue.** That is correct while an agent holds
the claim — the work is taken. It is wrong when the claim exists and no agent
does.

Measured: `bug/the-reading-carries-which-stopped` held a claim ref
(`d95614695`), a desk, and a brief on `origin/main`. Four consecutive supervisor
ticks reported `handed=0`, and the branch appeared in **no hold list at all** —
not `no-brief`, not `no-headroom`, not `not-claimable`. `--once` names every
hold every time, so a missing branch is not a missing key; the slice was outside
the queue's population entirely.

`plot-fleetctl.sh --status` showed the desk in state `none`. Nothing reported
that a claimed branch had no worker, and finding it took eliminating three hold
lists by hand.

**`--restart` is the repair and it already exists** — it hands an already-claimed
branch to a new worker, *"the one thing a slug dispatch can never do"*. What is
missing is the reading that tells a person to run it.

### The rule records this failure as fixed, and a desk was stranded anyway

`queue.ts:169` explains the brief gate's move:

> *"`plot-dispatch.sh` used to ask it after creating a desk and claiming a
> branch, so a missing brief left a **prepared desk nobody worked at**; asked
> here, the slice simply stays in the queue and no desk exists to strand."*

A prepared desk nobody worked at is exactly what was measured. The brief gate
did move; a desk and a claim were still created ahead of the hand-over. **Where
that happens is the first thing to establish**, and this plan does not guess at
it: the claim commit is `d95614695`, and the paths that create desks are
`plot-dispatch.sh:2057` (`--start`) and `:2925`.

### A free agent's desk reads as stalled work

Same estate, same hour, a different desk. Agent `89bfb811` finished
`the-index-is-read-once`, its PR **merged as #948**, and the registry cleared
its manifest `branch` to `""`. It returned to the free pool and its log says so:

> `plot-worker-loop: free on ? — nothing handed over yet. Waiting to be handed work`

Three components describe that desk with three different words:

| reader | answer | why |
|---|---|---|
| `plot-worker-state.sh` | **`stalled`** | commits in the tree not in `origin/main` |
| `plot-reap.sh` | **`worker alive (pid 20771)`** | the first of its five refusals |
| the manifest | **`branch: ""`** | free |

The board renders the first, so a **finished, merged, idle** agent shows as
`stalled` in red at 4h.

**The `stalled` reading is not wrong about the tree — it is wrong about the
question.** #948 was squash-merged, which rewrites the commits, so the branch
stays ahead of `origin/main` permanently. CLAUDE.md records the same trap for
the reaper: *"squash-merge leaves the branch permanently ahead of main, which is
why ancestry alone cleared 1 of 29 finished trees here and the host cleared the
other 28."* `plot-pr-merged.sh` is the answer to *did this land*, and the stall
reading does not ask it.

**A free agent's desk should not be left on a finished branch either.**
`plot-dispatch.sh --start` cuts a free agent's desk **detached** at
`origin/<main>`; this one was still checked out on `bug/the-index-is-read-once`
hours after that branch merged. Whether the desk should be reset on release is
the second slice's question.

### What this is NOT

**Not a change to the queue's derivation.** Derived-never-stored is load-bearing
— `the-registry-supervises-its-agents` specifies the daemon *"stateless across
restarts by construction"* — and this adds a reading beside it, never a stored
queue.

**Not a new stop or reap rule.** `reapable.ts` states every condition that can
hold a desk and `plot-reap.sh` reads it. A claimed slice with no worker is a
**report**, and the action is `--restart`, which is a person's call: the
alternative is a supervisor that re-staffs a branch somebody deliberately
stopped.

**Not a sixth process state.** `stalled` and `waiting` are the two Agent facts
read from the desk; this corrects what `stalled` is derived FROM, and adds no
word to the enum.

## Slices

### A claimed slice with no worker is reported (Branch: bug/a-claimed-slice-with-no-worker-is-reported)

- `bug/a-claimed-slice-with-no-worker-is-reported` — the fleet reports a branch holding a claim that no agent holds, and names `--restart`

**Done when** a claim ref with no agent in the registry naming that branch is
**reported by name**, with the repair `plot-dispatch.sh --restart <branch>`; the
reading is available to an operator without eliminating hold lists by hand —
through `--status`, `--once`, or the fleet payload, and the slice names which;
the queue's derivation is **unchanged**, pinned by a test that a claimed slice
with a live agent is still silent, since that is the normal case and reporting
it would make the finding worthless; a claim held by an agent on **another
machine** is not reported as unworked — `elsewhere` means no worktree here, and
this must not become an instruction to restart somebody else's work; the
population is measured on this estate and the number stated; and
`pnpm run test:contracts` passes.

### A free agent's desk says it is free (Branch: bug/a-free-agents-desk-says-it-is-free)

- `bug/a-free-agents-desk-says-it-is-free` — `stalled` asks whether the work landed, and a released desk stops reading as unfinished

**Done when** a desk whose branch has a **merged PR** no longer reads `stalled`,
asked through `plot-pr-merged.sh` — the one answer to *did this land*, which
reads `mergedAt` and never ancestry, because squash-merge leaves a merged branch
ahead of main forever; a desk with genuinely unlanded work still reads `stalled`,
pinned, since that reading is what rescued 324 uncommitted lines once; an
**unreachable host** answers *not merged* and the desk keeps reading `stalled`,
so an outage never clears a warning; the board's row for a free agent whose work
merged shows it as free rather than red; and the board suite passes.

## Notes

**Both findings came from one hour on a live estate**, and each was reached by a
different accident: the first by four ticks reporting `handed=0` while I waited
for a hand-over, the second by an operator reading the board and asking what a
`stalled` row meant.

**The reaper was right and the board was wrong, about the same desk.** The
reaper keeps it on *worker alive*, its first refusal; the five untracked scratch
files in the tree were never the reason. That disagreement is worth stating:
`plot-reap.sh` asks the host, and the stall reading asks git.

## Why this was rejected

**Three lenses, one `reject` and two `amend`, and both slices fell — one on the
code, one on the measurement.** Record in
`.plot/panels/2026-09-18-a-claimed-slice-is-somebody-s/`.

### Slice 2 was aimed at a file that is already correct

The Design claimed `stalled` means *"commits in the tree not in `origin/main`"*.
**`plot-worker-state.sh` never reads `origin/main`.** The reading is
`@{upstream}` and nothing else (`:724`), and the file spends 20 lines (`:689`–
`:706`) recording that an `origin/main` fallback was tried and measured wrong:
*"a fallback that counted against `origin/main` reported EVERY clean branch
`stalled` in a repo with no remote."*

Measured on the desk this plan names: **`unpushed` is 0**, not 6.
`taskState` fired on the `dirty` arm — the five untracked scratch files this
plan's own Notes dismissed as *"never the reason"* are the entire reason. The
squash-merge argument the case rests on concerns a reading that returned 0.

**And the remedy already exists.** `taskState`'s rank-1 arm is `hasPr`, which
already means open-or-merged and already returns `finished`. The board shows
`stalled` because `registry.ts:870` passes the PR fact as a literal `''`, by a
stated contract: *"the registry must not be behind anything that can fail."*

Putting `plot-pr-merged.sh` inside the reading would break that contract for
every caller. Measured: ~475 ms per call against a registry tick answering in
210 ms over 20 worktrees — **a 45× regression**, landing inside
`plot-fleetctl.sh:599`'s `sleep 0.5` poll loop. `plot-worker-state.sh:743`
prohibits it in the file itself: *"A host call in here would either break that
promise or fork a `gh` per branch on every 5-second board poll."*

### Slice 1 guards a population of zero

Measured 2026-09-18 across every remote ref: **0 empty-claim refs on the
estate**, and therefore 0 with no registered agent.

The one worked example was a **counter-example**. `bug/the-reading-carries-which-stopped`
was held by a registered, live agent (`pid 26405`) that produced four commits
after the claim. The claim was working as designed — it removed from the queue a
slice somebody was on.

### The desk attribution was wrong, and the section built on it withdrawn

The plan named `plot-dispatch.sh:2057` and `:2925`. Neither made that desk:
`:2925` is a disposable **booking** worktree, and the `plot-wt-` desk plus the
claim commit come from **`plot-worker-loop.sh:2263`/`:2277` and `:2307`** — the
agent's own hop, *after* hand-over, which is the intended order.

So `queue.ts:169` is **not** falsified: it describes dispatch preparing a desk
before the brief gate, and dispatch prepared nothing here. That section was
written while the plan promised *"this plan does not guess at it"*.

### What survives, and where it goes

**The queue derivation reading is correct and unrefuted** — a claimed slice
cannot appear in any hold list, because the derivation skips settled lines
before any hold is assigned. It is a real gap in the reporting surface with **no
demonstrated victim**, so it is recorded here rather than built.

Two candidates a later plan could take, neither this one:

1. **The manifest/desk pairing** — a branch cleared while the desk still holds
   it, or two agents sharing one desk. That is where the `stalled` row the
   operator saw actually comes from.
2. **A worker using a tracked desk as scratch space.** The five files that made
   this desk read `stalled` are the same class as `part1.txt`/`part2.txt`,
   untracked on 2026-09-18 after a worker rewrote 2,563 lines of them.

**Nothing was implemented.** No branch, no PR, no `Started:` record.

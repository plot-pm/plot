# Implementation brief — a-working-agent-is-not-a-hung-one (Hopping)

- **Plan (canonical):** `docs/plans/2026-08-30-a-working-agent-is-not-a-hung-one.md` on main
- **Branch:** `bug/a-long-agent-reaches-its-second-slice` (base: `main`)
- **Ends as:** one PR to main
- **Depends on the Reading slice.** Until the timer stops firing mid-run, an
  agent cannot reach a second slice to prove anything about.

### What to build

Evidence that the hop works — end to end, with a worker that actually hops.

**The code already exists** and has never run: `plot-worker-loop.sh` loops
(`:248`), asks `--next` for the following slice (`:260`), creates the worktree,
and rewrites its manifest (`update_manifest_on_hop`, `:284`).

**So this slice is mostly a test.** If the path turns out to be broken, fixing
it is in scope; assuming it works is not.

### Why it has never run

**2026-08-30: seven workers exited 124, none reached line 260.** The loop's own
message says it: *"ending worker without hopping"*. The hop is written,
reviewed, merged — and unexercised.

### The decisions the plan settles — do not re-derive them

**Assert end to end, not by reading the code.** *"The function that would hop is
called"* is what a green suite over a dead path looks like. The assertion is
that a worker **finished one slice and started the next**, observed from
outside: two branches claimed by one agent, one manifest, in sequence.

**`update_manifest_on_hop` sets `manifest.branch` to the NEXT branch** rather
than clearing it. So an agent is never observed with `branch === ''`, and
`isFree`'s first condition stays unreachable even after this slice. **That is a
finding to report, not to fix here** — `the-registry-owns-what-it-started`'s
Asking slice is what reads that field, and whether the empty state should exist
is a decision for the pair of plans, not for this test.

### Done when

- **a worker hops**, proven end to end: one agent, two branches, in sequence
- the manifest after the hop names the second branch and its worktree
- a worker with **no next branch** ends cleanly rather than looping (`--next`
  exits 1 for *nothing to start*, which is a normal state, not an error)
- the first worktree is left in whatever state the reap rule expects — **this
  slice does not reap**, and if the hop leaves something the reaper refuses,
  that is a finding

**The trap:** a test that dispatches a plan with one eligible branch proves
nothing, and passes. The fixture needs a plan whose second slice becomes
eligible when the first merges — otherwise `--next` returns nothing and the
worker exits correctly, having hopped over no work at all.

Plus: `pnpm test`, `pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`), changeset.

### Scope guard

The hop and its proof. Not the ending condition (the Reading slice), not the
registry's reader, not the worktree lifecycle.

**Expect this to take longer than it looks.** A test that drives two real slices
through one worker is slow and fiddly, and it is the first of its kind here.

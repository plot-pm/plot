# Implementation brief — the-pulse-is-an-entity (Waiting)

- **Plan (canonical):** `docs/plans/2026-08-30-the-pulse-is-an-entity.md` on main
- **Branch:** `feature/an-agent-waits-instead-of-asking` (base: `main`)
- **Ends as:** one PR to main
- **Depends on Ticking**, and on `monitoring-is-a-domain-concept` for anything
  that has to be told rather than asked.

### What to build

A worker whose next slice is blocked **waits** instead of ending.

### What happens today

`plot-worker-loop.sh:260`:

```sh
next_branch=$("$script_dir/plot-fleet-scan.sh" --next "$PLOT_SLUG" 2>/dev/null) || break
```

**`--next` answers *nothing* and the worker exits.** Reaching the following
slice then needs a fresh dispatch — worktree, claim, warm-up — and every ask
costs **18.3 s of scan, 12.7 s of it in git**.

**The hop already exists** (`update_manifest_on_hop`, `:284`) and has never run
in this repo. A subscription turns *"nothing free"* into *"not yet."*

### The distinction that carries the slice

**Two different nothings**, and conflating them is the whole risk:

| `--next` says nothing because | the worker should |
|---|---|
| the next slice is **blocked** — a prior slice is unmerged | **wait** |
| there is **no next slice** — the plan is done, or every branch is claimed | **end cleanly** |

**`--next` exits 1 for both today.** So this slice needs a second question, not a
longer timeout — *is there work that is not yet available, or is there no work?*

**A worker that waits on an empty plan never exits**, and that is worse than
today's behaviour: today it ends honestly.

### Done when

- a worker whose next slice is **blocked** stays alive and **hops when the
  blocker merges** — asserted end to end
- a worker with **no** next slice still **ends cleanly**
- the wait is bounded by something, and the PR says by what

**The first assertion is the first of its kind.** No worker in this repo has
ever hopped, so a test that drives one slice to completion and a second into
existence is new ground and will be slow and fiddly. **Budget for that.**

**The trap:** a fixture whose plan has one eligible branch. `--next` correctly
returns nothing, the worker correctly ends, the test passes, and **nothing was
proven.** The plan needs a second slice that becomes eligible when the first
merges.

Plus: `pnpm test`, `pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`),
changeset with a `bumps: skills:` block.

### Scope guard

The waiting and the hop. Not the cadence, not the channel protocol, not what a
monitor measures.

**Do not implement waiting as polling with a longer sleep.** That is what the
pulse exists to replace; a worker asking every 30 s instead of once is the same
18.3 s scan, less often.

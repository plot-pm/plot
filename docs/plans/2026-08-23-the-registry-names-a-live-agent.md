# The registry names a live agent

> The board shows `state=running` beside a pid that is dead. The state is read from the worktree and is right; the pid is read from a manifest nobody re-stamps and is a corpse — one row, two sources, and they disagree.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- An agent relaunched in an existing worktree updates its registry entry, instead of leaving the board naming the process that already exited.
- A pid that no longer belongs to the agent that claimed it can no longer read as `running`.

<!-- Board impact: registry + dispatcher. Touches skills/plot/scripts/plot-dispatch.sh
     (the stamp), packages/board/src/server/registry.ts (the liveness answer) and
     their tests. No plan-format or docs/plans-layout change. Rebuild the artifact. -->

## Motivation

Measured on this repo's running board, 2026-08-23:

```
feature/reconcile-counts-unsliced-waves   state=running  pid=72160  pid_alive=True
bug/the-name-track-holds-the-name         state=running  pid=91471  pid_alive=False
```

The second row contradicts itself. **Both halves come from different places**,
and only one of them was ever refreshed:

- `state` is computed per pulse by `plot-worker-state.sh`, which reads
  **`$wt/.plot-worker.pid`** (line 328) — the worktree's own file, rewritten by
  every launch. It says `running`, and it is correct: pid 69993 is alive.
- `pid` is read off the **manifest** in `.plot/agents/<session>.json`, written
  once at dispatch. It says 91471, which exited when that worker answered its
  blocker and stopped.

### Why the manifest is never corrected

`plot-dispatch.sh` writes `"pid": ""` as a placeholder, and the detached wrapper
stamps the real pid in with `awk` (line ~911):

```awk
$0 == "  \"pid\": \"\"," { print "  \"pid\": \"" pid "\","; next }
```

**A full-line match on the empty placeholder.** The comment argues for that
precision and is right about what it prevents: nothing inside the `command`
value can be mistaken for the line. But it also means the stamp fires **exactly
once per manifest, forever**. A second launch in the same worktree finds
`"pid": "91471",`, matches nothing, and leaves the corpse in place.

This is not hypothetical and is not rare: it is what happens every time a
blocked worker is answered and restarted, which happened twice today.

### The second defect, which the first one hides

`registry.ts` decides liveness with `kill -0` on the stored pid. That answers
*does some process hold this number*, not *is it our agent*. The OS recycles
pids; a manifest that outlives its process by long enough will eventually name
somebody else's, and the registry will report `running` about a stranger.

`readPid` already refuses `0` and junk for exactly this class of reason —
*"`kill -0 0` signals the whole process group and reads as running forever"* —
so the file already accepts that a plausible-looking pid can produce a false
`running`. This is the same failure one step further out.

### Severity, stated so it is not overstated

**No work has been lost to this.** `plot-worker-state.sh` reads the worktree
file, so the fleet scan, the dispatcher and WORKING's branch rows are all
unaffected — every consumer that *decides* something reads the correct source.
What is wrong is the number the board *displays*, and the fact that the
registry's own liveness answer rests on it.

That matters now rather than later because `every-section-has-one-subject`
(approved) moves WORKING onto the `agents` array. The moment it lands, this
display defect becomes the section that answers *who is working?*.

## Design

### Fix 1 — the stamp updates, it does not only fill

The launch-time stamp must replace **any** `pid` line, not only the empty one.
Keep the full-line-match discipline that makes it safe — match the key at the
start of the line and replace the whole line — rather than a substring match on
`"pid"`, which the `command` value could plausibly contain.

**The wrapper is still the only thing that knows the pid**, and it is still a
fresh `sh -c` with no access to this script's functions, so the fix stays inline
`awk` for the reasons the existing comment gives.

`startedAt` should be rewritten in the same pass. A manifest claiming a start
time from the previous run, beside a pid from this one, is a subtler version of
the same lie.

### Fix 2 — a pid alone cannot say `running`

`kill -0` proves a process exists, not that it is ours. The manifest must carry
something that ties the number to this launch, and the liveness check must
require both.

The repo already has the technique, recorded from the detached-worker pid tests:
assert on a **launch-time sentinel** rather than on `ps` liveness. The concrete
shape to prefer, in order:

1. **Compare against the worktree's `.plot-worker.pid`.** If the manifest pid
   and the worktree file disagree, the manifest is stale by definition — the
   worktree file is rewritten by every launch. This needs no new field, and it
   makes the two sources that currently disagree *check* each other instead.
2. Only if (1) cannot answer — the worktree is gone — fall back to `unknown`.
   **Not to `running`.** Absent is not false, and the direction of the error
   matters: a live agent reported `unknown` costs a glance, while a dead agent
   reported `running` costs a slot in the cap and an operator's trust.

### Not chosen: have the registry stop showing a pid

Cheapest fix, and it removes the visible contradiction without removing the
defect. Rejected: the pid is what an operator uses to check a worker by hand,
and the plan that added it argued the cap will read this count every pulse. A
number that is wrong should be corrected, not hidden.

### Not chosen: re-stamp from the board

The board reads the registry; making it write would put a repair on a render
path and give two processes the same file. `plot-dispatch.sh` owns manifest
writes and should keep owning them.

### Open Questions

- [ ] Should a manifest whose worktree no longer exists be **removed** rather
      than reported `unknown` forever? Twelve of twenty-two entries here are
      historical. That is registry lifecycle, probably its own plan — decide
      whether this plan draws the line or just stops making it worse.
- [ ] `plot-worker-state.sh` answers eight states; `registry.ts` keeps four.
      Confirm the four it keeps are still the right four now that `waiting`
      appears on the live board — a `waiting` agent collapsed into something
      coarser would undo the 2026-08-18 fix at the registry layer.

## Done when

- A worker **relaunched in an existing worktree** updates its manifest pid.
  Asserted by dispatching, killing, relaunching, and reading the manifest — this
  is the reported defect and the only assertion that catches the once-only stamp.
- The manifest's `startedAt` moves with it, asserted separately.
- A manifest pid that **disagrees with the worktree's `.plot-worker.pid`** does
  not read `running`. Asserted directly with a hand-written manifest, because an
  implementation that only fixes the stamp passes every test above and still
  reports a stranger's pid as our agent after a relaunch it did not observe.
- A manifest with **no pid** still reads `unknown` and still lists — the
  existing behaviour for the nine older manifests here, which must not regress
  into an entry that disappears.
- A first dispatch is unchanged: the placeholder is filled exactly as today.
- `pnpm test`, `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Stamped

<!-- ONE wave, one branch. The two fixes are a five-line awk change and a
     liveness predicate that reads the file the awk change keeps correct —
     splitting them would put the second branch's test on the first branch's
     behaviour, and the second would rebase onto it anyway. -->

- `bug/the-registry-names-a-live-agent` — the launch stamp replaces any pid line rather than only the empty placeholder, and liveness requires the manifest pid to agree with the worktree's own; a disagreement reads `unknown`, never `running`

## Notes

Found 2026-08-23 while answering whether WORKING belongs to the registry. It
does not today — WORKING renders branch and wave rows from the fleet scan, and
the registry's 22 agents are a separate array — but `every-section-has-one-subject`
is approved and moves it there.

The defect was created by hand in this session: a worker was blocked, answered,
and relaunched, and the relaunch is precisely the case the once-only stamp does
not cover. That is worth recording, because it means the trigger is not an
exotic failure but the ordinary repair loop.

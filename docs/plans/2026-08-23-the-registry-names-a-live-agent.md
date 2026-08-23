# The registry names a live agent

> The board shows `state=running` beside a pid that is dead, and reports `unknown` about nine agents whose worktrees are sitting right there. Two defects, one cause: the manifest's pid is written once and then trusted for a job it was never doing.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- An agent relaunched in an existing worktree updates its registry entry, and records that it was relaunched, instead of leaving the board naming the process that already exited.
- The registry classifies every agent whose worktree it can see, instead of skipping the ones whose manifest predates pid stamping.

<!-- Board impact: registry + dispatcher. Touches skills/plot/scripts/plot-dispatch.sh
     (the stamp), packages/board/src/server/registry.ts (the gate, the contract and a
     wrong docstring), packages/board/src/contract/schema.ts (previousPid/relaunches)
     and their tests. No plan-format or docs/plans-layout change. Rebuild the artifact. -->

## Motivation

Measured on this repo's running board, 2026-08-23:

```
feature/reconcile-counts-unsliced-waves   state=running  pid=72160  pid_alive=True
bug/the-name-track-holds-the-name         state=running  pid=91471  pid_alive=False
```

and, in the same pulse, `running: 3, waiting: 7, unknown: 12`.

### Defect A — the stamp fires once per manifest, forever

`plot-dispatch.sh` writes `"pid": ""` and the detached wrapper fills it with
inline `awk` (line ~911):

```awk
$0 == "  \"pid\": \"\"," { print "  \"pid\": \"" pid "\","; next }
```

**A full-line match on the empty placeholder.** The comment argues for that
precision and is right about what it prevents: the `command` value is one
escaped JSON string on its own line and can never equal that line. But it also
means a second launch in the same worktree finds `"pid": "91471",`, matches
nothing, and leaves the corpse in place.

This is the ordinary repair loop, not an exotic failure. Relaunch-in-place is a
**first-class board action**: `ContinueWithAnAnswer.tsx` restarts a blocked
worker and reports *"New worker started (pid X, replacing pid Y)"*. The board
already knows a manifest can be superseded; the manifest does not.

### Defect B — nine agents are never classified at all

`refreshStates` (`registry.ts:259`) decides who gets asked:

```ts
const checkable = entries.filter((e) => e.pid !== '' && e.worktree !== '');
```

**The pid is a gate on a value the classifier never consults.** `bashLiveness`
passes the **worktree path**; `plot_worker_state` then reads
`$wt/.plot-worker.pid` for itself. The manifest pid is not an input to the
answer — it is only a ticket to be asked the question.

Measured: **9 of the 22 manifests here name a worktree that exists on disk and
are skipped anyway**, because they were written before pid stamping. They read
`unknown` while the classifier would have answered them correctly.

### What is NOT wrong, stated because the plan first claimed it was

An earlier draft asserted a pid-recycling bug: that `kill -0` on a stale pid
could report a stranger's process as `running`. **That is false**, and the
falsification is worth keeping.

The belief came from `registry.ts:12`, which says *"`running` — the pid answers
`kill -0`"*. The code does not do this. `bashLiveness` passes worktree paths and
nothing else; the pid never reaches a liveness check. **The docstring is wrong**
and is part of what this plan fixes — a comment that misdescribes its own
function is how a later reader (this plan's author, once already) builds on a
mechanism that is not there.

### Severity, stated so it is not overstated

**No work has been lost to either defect.** Every consumer that *decides*
something — the fleet scan, the dispatcher, WORKING's branch rows — reads
`$wt/.plot-worker.pid` and is correct. Defect A costs a wrong number on screen;
defect B costs nine honest-but-useless answers.

It matters now because `every-section-has-one-subject` (approved) moves WORKING
onto the `agents` array. The moment it lands, these become the section answering
*who is working?* — and the concurrency cap reads the same count.

## Design

### Fix A — the stamp updates, and records that it did

Replace **any** `pid` line, not only the empty one. Keep the full-line-match
discipline that makes it safe: anchor on the key at the start of the line and
replace the whole line, never a substring match on `"pid"` that the `command`
value could plausibly contain.

The wrapper is still the only thing that knows the pid, and it is still a fresh
`sh -c` with no access to this script's functions, so the fix stays inline `awk`
for the reasons the existing comment gives.

**A relaunch is recorded, not just overwritten.** Rewrite `pid` and `startedAt`
to describe the current run, and keep what was displaced:

```json
{ "pid": "69993", "startedAt": "...", "previousPid": "91471", "relaunches": 1 }
```

`ContinueWithAnAnswer` **already computes and displays `previousPid`** and then
throws it away. Persisting it costs nothing at the point of writing and buys a
real signal: a branch restarted three times is struggling, and nothing on the
board can say so today.

`relaunches` increments; a first dispatch writes neither field, so an
unrelaunched manifest is byte-identical to today's.

### Fix B — classify everyone whose worktree is visible

```diff
- const checkable = entries.filter((e) => e.pid !== '' && e.worktree !== '');
+ const checkable = entries.filter((e) => e.worktree !== '');
```

The worktree is the only input the resolver takes. Gating on the pid asks for a
ticket that the questioner does not read, and it costs nine correct answers in
this repo alone.

**The pid becomes a display fact only** — what an operator uses to check a
worker by hand — which is what Fix A keeps accurate.

`worktree !== ''` stays: an entry with no worktree has nothing to look in, and
`unknown` is the right answer there. Absent is not false.

**And correct the docstring.** `registry.ts:12` must say what liveness actually
does: the worktree is classified by `plot-worker-state.sh`, which reads the
worktree's own pid file. The manifest pid is not consulted.

### Not chosen: have the registry stop showing a pid

Cheapest fix for defect A, and it removes the visible contradiction without
removing the defect. Rejected: the pid is what an operator uses to check a
worker by hand, and the plan that added it argued the cap will read this count
every pulse. A number that is wrong should be corrected, not hidden.

### Not chosen: re-stamp from the board

The board reads the registry; making it write would put a repair on a render
path and give two processes the same file. `plot-dispatch.sh` owns manifest
writes and keeps owning them.

### Not chosen: a launch-time sentinel

The earlier draft proposed one, to defeat pid recycling. With the recycling
claim falsified there is nothing for it to defend against — the classifier reads
a file that every launch rewrites, which is already a sentinel in effect.

### Open Questions

- [ ] Twelve of twenty-two entries are historical, and three name a worktree
      that no longer exists. Should the registry **remove** a manifest whose
      worktree is gone, or report `unknown` forever? That is registry lifecycle
      and probably its own plan; decide whether this plan draws the line or
      merely stops making it worse.
- [ ] Should `relaunches` be surfaced on the row, or only stored? Storing it is
      cheap and reversible; rendering it is a new column's worth of argument.
      Prefer storing now, rendering in whatever plan owns the agent row.

## Done when

- A worker **relaunched in an existing worktree** updates its manifest pid.
  Asserted by dispatching, killing, relaunching, and reading the manifest — this
  is the reported defect and the only assertion that catches the once-only stamp.
- The relaunch is **recorded**: `previousPid` holds the displaced pid and
  `relaunches` increments. Asserted across two relaunches, so an implementation
  that overwrites `previousPid` correctly but never increments is caught.
- A **first** dispatch is byte-identical to today: pid filled, no `previousPid`,
  no `relaunches`.
- An entry whose manifest has **no pid but a live worktree** is classified.
  Asserted directly against a hand-written pid-less manifest — this is defect B,
  and an implementation that only fixes the stamp passes every assertion above
  while leaving all nine entries `unknown`.
- An entry with **no worktree** still reads `unknown` and still lists. The
  registry must never drop an agent it cannot classify.
- `registry.ts`'s liveness docstring describes what the code does. Asserted by
  reading, not by a test — but do not skip it: a wrong comment here has already
  produced one wrong plan.
- `pnpm test`, `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Stamped

<!-- ONE wave, one branch. Fix A is the dispatcher's awk plus two manifest
     fields; Fix B is a one-line predicate and a docstring in registry.ts. They
     meet only in the tests, and splitting them would put wave 2's assertions on
     wave 1's behaviour while both touched registry.ts anyway. The `Done when`
     list keeps them separately assertable, which is what a split would buy. -->

- `bug/the-registry-names-a-live-agent` — the launch stamp replaces any pid line and records `previousPid`/`relaunches`; `refreshStates` classifies every entry with a worktree rather than gating on a pid the classifier never reads; the liveness docstring is corrected to match

## Notes

Found 2026-08-23 while answering whether WORKING belongs to the registry. It
does not today — WORKING renders branch and wave rows from the fleet scan, and
the registry's agents are a separate array — but `every-section-has-one-subject`
is approved and moves it there.

Defect A was created by hand in this session: a worker was blocked, answered,
and relaunched, and the relaunch is precisely the case the once-only stamp does
not cover.

**Defect B was found by interrogating this plan's own first draft**, which
claimed a pid-recycling bug that does not exist. Tracing the claim to decide how
to fix it showed the pid never reaches a liveness check at all — and that the
place it *does* reach is a filter that silently skips nine agents. The false
claim and the real one had the same root, and only reading the code separated
them.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "How should fix 2 be rewritten, given the pid-recycling claim is falsified but the pid gates refreshStates?", "a": "Drop the pid from the gate; check any entry with a worktree; fix the wrong docstring", "category": "technical"},
    {"q": "What should the manifest record on relaunch, given ContinueWithAnAnswer already computes previousPid?", "a": "Overwrite pid + startedAt AND persist previousPid/relaunches", "category": "domain"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

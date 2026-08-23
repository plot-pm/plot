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
     wrong docstring), packages/board/src/contract/schema.ts (previousPid/relaunches, and a default for `session`)
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

**There are TWO relaunch paths, and the one that matters is not the
dispatcher's.** `/api/continue` — the board's *Continue with an answer* button —
spawns a worker **directly** (`continue.ts:521`) and writes `.plot-worker.pid`
itself (line 544). It never invokes `plot-dispatch.sh`, so an `awk` fix in the
dispatcher would not fire on the very path that produced the reported defect.

It also already **holds both pids**: it returns `pid` and `previousPid` to the
client, reading the previous one from the pulse rather than from the manifest.
The facts are in hand at the write site and are discarded.

So the manifest write becomes **one contract with two implementations**:
`stamp` = `pid`, `startedAt`, `previousPid`, `relaunches`. `continue.ts` calls a
TypeScript helper; the dispatcher's detached `sh -c` cannot reach one and keeps
inline `awk` against the same field set. **A test asserts both paths produce an
identical manifest** — that is what keeps two implementations one contract, and
it is the `plot-worker-state.sh` pattern this repo adopted after five of six
states drifted while held in duplicate.

In the dispatcher, replace **any** `pid` line, not only the empty one. Keep the full-line-match
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

### Fix C — an agent with no manifest is still an agent

Measured 2026-08-23: **28 worktrees, 22 manifests.** Five real branch worktrees
have no registry entry at all — among them
`bug/the-kind-is-labelled-not-hovered`, which is the single branch the fleet
scan currently reports as `waiting`. The registry cannot see the one agent most
likely to need a person.

The cause is structural, not a bug: `plot-dispatch.sh` is the sole manifest
writer, so a worktree made by hand — or by any path that is not a dispatch — has
none. The registry's docstring calls its directory *"the whole truth about which
agents exist"*, and that has quietly stopped being true.

**This matters now for the same reason the rest of the plan does.** WORKING is
about to render the `agents` array; an agent invisible there is one an operator
cannot see, and — per the registry's own reasoning — *"an agent invisible during
an outage is an agent that gets restarted into work it is already doing."* The
same argument applies to an agent invisible because nobody wrote it a file.

**The registry lists a worktree it can see, manifest or not.** For a worktree
with no manifest it synthesizes an entry from what the worktree itself carries:
the branch (`git branch --show-current`), the path, and the same pulse-refreshed
state every other entry gets.

**What such an entry cannot have, and must not invent:**

- **`session` is `''`.** It is the transcript's name and is minted at launch; a
  worktree nobody dispatched has no session. This is the one field on
  `AgentEntrySchema` with no default, so the schema must gain one — `''`, the
  same *empty is a real value* rule `branch` already follows.
- **`command` and `startedAt` are `''`.** They are launch facts. A start time
  guessed from the worktree's mtime would read as a launch record and be wrong.
- **The transcript fields are absent** — `model`, `contextTokens`,
  `lastActivity`. That is the existing rule (*a missing transcript costs fields,
  not entries*) applied to an entry that never had one.

**This changes what a manifest means**, and the change is the point: a manifest
becomes the record of a *dispatch*, not the definition of an agent's
*existence*. The worktree is what exists; the manifest is what Plot knows about
how it came to be.

**Precedence, so the two sources cannot both claim one worktree:** a manifest
wins. Where a manifest names a worktree, that entry is used and nothing is
synthesized for the same path.

### Writing the manifest safely

**Atomic, and deliberately unlocked.** Both writers go through a temp file and a
rename within the directory — the discipline the dispatcher already uses, and
the one that keeps a manifest from ever being read half-written.

`relaunches` is a read-modify-write and is **not** locked. Two relaunches landing
in the same instant could both read 1 and both write 2, losing an increment.
That is accepted: the cost is an undercount on a diagnostic field nothing acts
on, while a torn manifest costs the whole entry. A per-branch lock would buy an
exact count and introduce a stale-lock failure mode — a poor trade for a counter
the plan's own open question has not yet decided to render.

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

### What the nine rows will say — measured, and not what was expected

Classifying the nine skipped entries changes them from `unknown` to a real
state. Measured by running the classifier against their worktrees directly, all
nine answer **`waiting`** — and **none of them has a `PLOT-BLOCKED` marker.**

That is a false positive, and it is not this plan's to fix. `plot_worker_blocked`
greps file **contents** for `PLOT-BLOCKED:|TODO\((you|human)\)`, excluding only
`.plot-worker.*`. Three committed briefs on `main` contain the literal string
because they *describe the blocking feature*:

```
.plot/briefs/a-waiting-agent-stays-working.md
.plot/briefs/api-attention-says-what-needs-you.md
.plot/briefs/continue-with-an-answer.md
```

Every worktree inherits them, so **every worker in this repo that exits cleanly
reads `waiting` instead of `finished`** — including the live ones. The board's
current `waiting: 7` is very likely this, not seven people owed answers.

**This plan does not fix it** (see the branch note), but it must not pretend the
nine rows will be informative either. The honest statement of the blast radius:

- before: `unknown` ×12
- after: `unknown` ×**0** — measured 2026-08-23, **all 22 manifests name a
  worktree that exists**, so every entry becomes classifiable and `unknown`
  survives only as the answer when the classifier itself cannot run
- of the nine, all read `waiting`, and all nine are the false positive above

**Assert the transition, not the verdict.** A test proves a pid-less manifest
with a live worktree is *classified* rather than skipped. Asserting it reads
`waiting` would pin the bug in place.

### Open Questions

- [x] ~~Should the registry remove a manifest whose worktree is gone?~~
      **Dropped in round 3: there are none.** All 22 manifests name a worktree
      that exists. The question targeted an empty population. The `Done when`
      assertion that a worktree-less entry still lists is KEPT — it is the
      contract even with no instance to test it against today.
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
- **`/api/continue` updates the manifest.** Asserted against that route, not only
  against the dispatcher — it is the path that produced the defect, and a fix
  applied only to `plot-dispatch.sh` passes every dispatcher assertion while
  leaving the reported bug exactly as it is.
- **Both writers produce an identical manifest** for the same inputs. Asserted by
  comparing them; this is what holds two implementations to one contract.
- A manifest is never observed half-written: both writers go through a temp file
  and a rename.
- An entry whose manifest has **no pid but a live worktree** is classified.
  Asserted directly against a hand-written pid-less manifest — this is defect B,
  and an implementation that only fixes the stamp passes every assertion above
  while leaving all nine entries `unknown`.
- An entry with **no worktree** still reads `unknown` and still lists. The
  registry must never drop an agent it cannot classify.
- **A worktree with no manifest is listed**, carrying its branch and a real
  state. Asserted against a hand-made worktree — measured 2026-08-23, five exist
  here and one of them is the only branch the scan calls `waiting`.
- A synthesized entry carries **`session: ''`** and no invented `command` or
  `startedAt`. Asserted directly: an implementation that fabricates a start time
  from the worktree's mtime passes "it is listed" and lies about a launch.
- Where a manifest names a worktree, **nothing is synthesized for that path** —
  no worktree appears twice.
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

- `bug/the-registry-names-a-live-agent` — the launch stamp replaces any pid line and records `previousPid`/`relaunches` from both spawn paths; `refreshStates` classifies every entry with a worktree rather than gating on a pid the classifier never reads; a worktree with no manifest is listed as a synthesized entry rather than being invisible; the liveness docstring is corrected to match

## Notes

**A separate defect was found while interrogating this plan and is NOT fixed
here:** `plot_worker_blocked` matches the marker string anywhere in a worktree's
file contents, so three committed briefs that discuss blocking make every
worktree read `waiting`. It needs its own plan — the fix is probably to match a
marker FILE rather than any file's contents, and that is a change to a
load-bearing classifier with its own measured history, not a rider on a registry
fix. Recorded here so it is not lost.

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
  "round": 3,
  "questionHistory": [
    {"q": "How should fix 2 be rewritten, given the pid-recycling claim is falsified but the pid gates refreshStates?", "a": "Drop the pid from the gate; check any entry with a worktree; fix the wrong docstring", "category": "technical"},
    {"q": "What should the manifest record on relaunch, given ContinueWithAnAnswer already computes previousPid?", "a": "Overwrite pid + startedAt AND persist previousPid/relaunches", "category": "domain"},
    {"q": "Where should the manifest update live, given /api/continue spawns directly and never runs plot-dispatch.sh?", "a": "A shared contract with two implementations; a test asserts both produce identical manifests", "category": "technical"},
    {"q": "How much concurrency safety should this plan carry for relaunches?", "a": "Atomic temp+rename in both writers; accept a lost increment rather than take a lock", "category": "nonFunctional"},
    {"q": "What should the plan say about nine rows changing from unknown to a real state?", "a": "State it as expected and assert the transition - but measurement showed all nine read `waiting` from a false positive in plot_worker_blocked, so assert classification, not the verdict", "category": "ux"},
    {"q": "Should the registry remove manifests whose worktree is gone?", "a": "Dropped - measured zero orphans; all 22 name a live worktree, so unknown falls to 0 after Fix B. Contract assertion kept, question deleted", "category": "domain"},
    {"q": "Five worktrees have no manifest, including the only branch the scan calls waiting. Fold or separate?", "a": "Fold in as Fix C: the registry lists a worktree it can see, manifest or not; a manifest becomes the record of a dispatch rather than the definition of an agent's existence", "category": "architecture"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

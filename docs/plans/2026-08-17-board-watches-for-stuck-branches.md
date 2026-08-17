# The board watches for stuck branches, and unsticks the one case it may

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #181 merged
- **Started:** 2026-08-17, Jan Wloka, `feature/scan-reports-stuck-branches`
- **Delivered:**
- **Started:** 2026-08-17, Jan Wloka, `feature/board-shows-stuck-branches`
- **Started:** 2026-08-17, Jan Wloka, `feature/pulse-resolves-artifact-conflicts`

## Problem

Asked on 2026-08-17: *do we need a branch watcher — one that watches
branches waiting for human input (merge conflicts, red builds, anything)
and dispatches an agent to resolve them?*

The session that produced the question is the evidence. Five branches got
stuck in one afternoon:

| Incident | What it cost |
|---|---|
| #176 artifact conflict | recreate worktree, take a side, rebuild, 547 tests |
| #177 artifact conflict | the same again |
| #177 rebase never pushed | noticed by accident; **30 minutes of dead CI** |
| #179 Playwright CDN `403` | read the log, compare run history, rerun |
| #172 fixture regression | add the missing field |

**Four of the five were mechanical.** Only the fixture regression needed
judgement — a sibling had added a contract field and a whole-object
`toEqual` did not know about it.

### Nobody is watching, and the fleet view does not fill the gap

`plot-fleet-scan.sh` reports what each branch *is*: claimed, eligible,
blocked, in progress. It does not report that a branch **cannot move**.
A branch whose PR conflicts, whose CI failed in a step it never touched,
or whose rebase is sitting unpushed reads exactly like a branch being
worked on.

The #177 case is the sharp one: from outside, a rebase that stayed local
is **indistinguishable from an agent that stopped**. That is precisely
the confusion `opus5-longhorizon-hardening` named as its central thesis —
*an agent that has gone quiet has failed, not finished* — and this
session produced two more instances of it.

### The pieces exist; the loop between them does not

Measured, three of the four parts are already built:

| Part | Script | State |
|---|---|---|
| Predict conflicts | `plot-merge-queue.sh` | done — `git merge-tree`, read-only |
| Read branch state | `plot-fleet-scan.sh` | done — read-only |
| Start an agent with a claim | `plot-dispatch.sh` | done |
| **Notice a branch is stuck** | — | **missing** |

## Design

### The pulse notices; a human acts — with exactly one exception

**Measured architectural constraint.** `dispatch.ts:10` states it
plainly: *"Everything else this server does is a read. `POST
/api/dispatch` is a change."* Its guard is the localhost binding — whoever
reaches the route is sitting at this machine — and `approve.ts` imports
that same guard rather than restating it.

A timer that calls those routes hollows the guard out. It checks **where**
the trigger is, not **who** it is; a firing interval passes it trivially.
So the split:

- **Detection is read-only and rides the pulse.** No new authority, no
  architectural change: the board already re-reads git every 4 s and the
  host every 60 s. Noticing that a branch is stuck is another read.
- **Action is a human click**, through the existing guarded route — with
  the single exception below.

This costs less than it sounds. The four mechanical incidents did not
need autonomy; they needed *noticing* plus *one button*. Today each took
ten minutes of reading logs and comparing run histories to reach a
conclusion the scan could have stated outright.

### The one exception: an artifact conflict resolves itself

`skills/plot/scripts/board/board-server.mjs` conflicts may be resolved by
the pulse without a click. This is the only write this plan grants, and
it is granted because the resolution **cannot be wrong** — which is a
claim `.gitattributes` already argues at length and this plan verified:

1. **`-merge` keeps the file valid.** Git keeps one side whole and writes
   no conflict markers, so the artifact stays buildable JavaScript
   *through* a conflict.
2. **The rebuild is deterministic.** `build.mjs` embeds no timestamp, no
   randomness — measured. So the rebuild's output does not depend on
   which side was kept.
3. **CI proves it.** The no-diff gate fails the build if the committed
   artifact does not match a fresh rebuild. A wrong resolution cannot
   reach `main` unnoticed.

Together those make this the one repair whose correctness is checkable
without judgement: take either side, `pnpm build:board`, commit. The repo
already instructs humans to do exactly this and to **not read the diff**.

**But "the pulse resolves it" is the wrong picture, and the measurement
says so.** `plot-merge-queue.sh` predicts conflicts with
`git merge-tree --write-tree`, which computes a merge **in memory** — the
conflict is *foreseen*, not *present*. Both of today's artifact conflicts
appeared only at `gh pr merge`, and resolving each one took:

```
git merge origin/main            # in the branch's own worktree
git checkout --<side> skills/plot/scripts/board/board-server.mjs
pnpm build:board
pnpm run test:board              # 547 tests, ~5 minutes
git commit && git push
```

That is not an inline fix a 5 s timer performs. So **the pulse dispatches
a worker** for it, through `plot-dispatch.sh` — which already creates a
worktree, claims the branch, and spawns detached. The board server gains
no new power: it triggers the same mechanism a human click triggers, on
the one input whose correctness is provable.

**The tests run BEFORE the push, not after.** The CI no-diff gate is what
makes the resolution *checkable*, but CI runs only once the push has
landed — so a resolver that pushes and waits would create exactly the
state this plan defines as stuck: a red PR in the queue. The worker
therefore ends on `pnpm run test:board` green in its own worktree, and CI
becomes confirmation rather than discovery. That is what a human did by
hand twice today, at about five minutes each.

**If the tests do not pass, nothing is pushed** and the branch is
reported as a real conflict. The resolution stopped being mechanical the
moment its own gate said so — and a worker that pushed anyway would have
manufactured the stuck state this plan exists to remove.

**Two sources answer "does this merge", and they disagree in the
reassuring direction.** Found while building wave 1 and recorded here
because wave 3 depends on it: `merge-tree` predicts from the refs **this
machine** holds, while the host computed its verdict against the branch
as it actually stands. A stale local ref therefore makes the prediction
wrong by saying *no conflict* where there is one — which is exactly what
happened twice on 2026-08-17, when both artifact conflicts appeared only
at `gh pr merge`.

So a host-declared conflict (`pr.state === 'conflicts'`) with **no
observed conflict set** is reported as a plain `conflict`, never as
`artifact-conflict`. The artifact case rests entirely on the set being
*exactly one known file*; here the host says *this does not merge*
without saying where. Guessing artifact-only with no set behind it would
be the *"is the artifact among the conflicts?"* mistake in its worst
form — handed to the one state a later wave may resolve without a human.

**Wave 3 may therefore only act on a conflict set it has actually
observed**, never on the host's verdict alone.

**Everything else is detected and offered, never taken.** Not "for now" —
the three properties above are what license the exception, and no other
failure has them. A real code conflict has no deterministic resolution; a
red CI check has no rebuild that proves it; an unpushed rebase is someone
else's work in progress.

**The exception is fenced by construction, not by intention.** The
resolver refuses any conflict set that is not *exactly* the artifact
path: one file, that file, and nothing else. A conflict touching the
artifact **and** anything else is reported, not resolved — because then
the merge as a whole needs judgement even though one of its files does
not.

### Anything the pulse cannot fix offers its action, visibly and in motion

**The rule, stated as given:** *everything that cannot be done
automatically offers an action, with a visible animated cue.* It applies
to three of the four states — the artifact conflict resolves itself and
therefore offers nothing.

**Measured, and this is why the rule bites.** `RowActions` today hides
its action behind the three-dot menu, and the menu opens only if
something inside could act. So a row with a waiting action looks
identical to a row with none until you click it. A cue nobody finds is
not a cue.

So a stuck branch surfaces its action **on the row**, not inside the
menu, with a marker that moves. The animation is the part that carries
across a glance: a stuck branch is not a state to browse for, it is a
thing waiting on you.

**This is the one place on this board where motion is the right answer,
and the reason is worth recording** — because #180 settled the opposite
for a neighbouring case. Its rule: *a thing true for hours has less claim
on motion than a thing true for three seconds*, which is why the activity
bar in `activity-shows-itself` is static.

A stuck branch is neither. It is **true until someone acts** — and the
acting is the point. Motion here does not decorate a state; it marks an
unanswered request, and it ends when the request is answered. That is the
one honest use of the scarce channel: something is waiting **for you**,
and it will keep waiting until you do something.

**The cue is bounded so it cannot become wallpaper:**

- **Only on rows with an offered action.** A stuck branch with nothing
  to offer (unpushed work — the fix is a push, and pushing someone
  else's work is not ours) is reported in words, not in motion.
- **It stops when the action is taken**, not when the branch unsticks.
  The request has been answered; whether the answer worked is what the
  row's other marks report.
- **`motion-reduce` keeps the cue and stops the animation** — the rule
  this repo has applied three times, and the reason: removing the element
  would take the marker along with the movement.
- **Never colour alone**, and never motion alone: the action carries a
  word, and the reason is in the accessible name. The repo's rule is
  *symbol AND word*, and a screen reader reaches the state through the
  action's label rather than through the animation, which is
  `aria-hidden`.
- **It never fires for a branch that is merely working.** A cue that
  appears on healthy rows makes the stuck ones invisible.

**Over a non-localhost binding the cue stays and the action refuses.**
Measured: `/api/dispatch` is available only on localhost — *"whoever
reaches localhost:7777 is sitting at the machine that owns the
worktrees"* — so on the Tailscale address the board is a reading surface
and dispatch is unavailable by construction.

The information is still true there, so the cue still shows: something is
stuck and waiting. The action is present but disabled, and it names the
reason — *available only on the machine that owns the worktrees* — which
is exactly what `RowActions` already does when the server will not act.
Hiding the cue instead would make a phone report a healthy fleet while
two branches sit stuck, which is a worse lie than an action you cannot
take from where you are.

### What "stuck" means, precisely

A branch is stuck when it cannot advance without someone doing something,
and four states qualify. Each is named, because *stuck* as one label
would be the one-label-many-states defect this board keeps removing:

| State | Detected from | Offered action |
|---|---|---|
| **Artifact conflict** | `merge-tree` reports conflicts, and the set is exactly the artifact | **resolved by the pulse** |
| **Real conflict** | `merge-tree` reports conflicts in other files | offered on the row, animated: dispatch a resolver |
| **Foreign CI failure** | `pr.state === 'failing'` in a job whose step the PR does not touch | offered on the row, animated: **open the failing run** (see below) |
| **Unpushed work** | `local_ahead > 0` and no matching remote commits | reported in words — the fix is a push, and it is not ours to make |

**Foreign CI failure is a judgement, so the pulse shows evidence and does
not judge.** Today's `403` from Playwright's CDN was transient, and the
proof was in the run history — the same branch was green two minutes
earlier — but a real failure can present identically.

So the row reports **facts, not a verdict**:

```
CI failed — step: Install Playwright browser
this branch changes only .md
same branch passed at 10:17, failed at 10:19
```

A human reads those three lines and concludes in seconds what took ten
minutes of log-reading today. Deciding *for* them was the alternative: a
heuristic mapping failing steps to changed paths. Rejected — that mapping
is a table nobody maintains, it would go **silently wrong** the first
time a workflow is restructured, and Principle 3 puts exactly this split
where it belongs: **scripts collect and report; humans and skills
interpret.**

**The CI action is a LINK, not a rerun — corrected during wave 2.** This
plan first said *rerun*, and the measurement found there is **no rerun
route on this server**. Building one would have been a write path wave 2
is explicitly fenced away from, and it would have eroded the argument
that makes **wave 3 the only automatic write this plan grants**: that its
correctness is provable by a rebuild and a CI no-diff gate. A second
route added quietly inside a display wave would weaken that without
anyone deciding to.

So the action opens the failing run on the host, where the rerun button
already lives. Navigation carries no authority, needs no guard, and reads
identically over a non-localhost binding — which matters, because the cue
shows there while the dispatch action refuses. Where the host reports no
run URL (Bitbucket has no run listing) the row says *no run link
available* rather than rendering a dead control: absent is a real answer.

**A real rerun would need its own guarded route and therefore its own
plan.** It is not deferred work inside this one.

The label `foreign CI failure` is therefore this plan's word for a
*shape* worth surfacing, never a claim the pulse makes about a specific
failure.

**Unpushed work is reported and never fixed.** Pushing someone else's
uncommitted judgement is not a mechanical act, and `local_ahead` is
`true` only on the machine doing the looking — a limit
`activity-shows-itself` records for the same field.

### Detection is stateless

Every state above is re-derived from git and the host on each pulse.
Nothing is remembered, nothing is written, and a restarted board reaches
the same conclusions from the same refs — Principle 1, the same posture
`plot-fleet-scan.sh` takes.

That also means the watcher cannot drift from reality: there is no
watcher state to become stale, because there is no watcher state.

### What this does not do

**No autonomous loop.** A background process that acts unattended would
need its own watcher — this session watched a silent agent be
indistinguishable from a dead one, twice.

**No merge.** `plot-merge-queue.sh` is deliberately read-only, and its
comment says why: *"most of the value is in KNOWING THE SAFE ORDER —
obtainable without granting any agent"* merge rights. That stands.
Resolving an artifact conflict on a branch is not merging it.

**No new data source.** Conflicts come from `merge-tree`, states from the
existing scan, CI from the PR state the contract already carries.

## Branches

### Detection

- `feature/scan-reports-stuck-branches` — the scan names the four stuck
  states with their evidence; read-only, stateless, machine-countable
  footer → #183

### Display

- `feature/board-shows-stuck-branches` — a stuck branch says so in its
  row, naming which of the four and why; anything the pulse cannot fix
  offers its action **on the row with an animated cue**, not inside the
  three-dot menu, through the existing guarded route → #185

### Repair

- `feature/pulse-resolves-artifact-conflicts` — the one granted write:
  an artifact-only conflict dispatches a worker through `plot-dispatch.sh`
  that merges, takes a side, rebuilds, runs `test:board`, and pushes only
  on green; refuses any conflict set that is not exactly the artifact

Three waves, sequential. **Detection first** — the display and the repair
both consume what it reports, and a repair built on a guessed shape would
have to be rewritten when the shape settles. **Display second**, because
a repair nobody can see happening is the silent-agent problem again.
**Repair last**, and only after the other two have made its input visible.

All three touch board sources; the scan wave also touches
`plot-fleet-scan.sh`. `activity-shows-itself` is in flight in
`AgentList.tsx` — wave 2 here must rebase onto whatever of it has landed
and must not touch `[data-change-mark]`, `[data-live-dot]`, or the
activity marks that plan introduces.

## Done when

- **The scan names each stuck state separately**, with the evidence that
  produced it. Assert all four; one label for all of them is the defect.
- **An artifact-only conflict is distinguishable from a mixed one.**
  Assert a conflict set of exactly the artifact, and one of the artifact
  plus another file: the first is resolvable, the second is not.
- **The resolver refuses a mixed conflict set.** The pairing that
  matters: an implementation checking *"is the artifact among the
  conflicts?"* passes the artifact-only assertion and silently resolves
  merges that need judgement.
- **The resolver rebuilds rather than choosing.** Assert the committed
  artifact matches a fresh `pnpm build:board` regardless of which side
  was kept — the property `.gitattributes` argues and CI gates.
- **Nothing is pushed until `test:board` passes locally.** The pairing
  that matters: a resolver that pushes and lets CI decide passes every
  correctness assertion above and manufactures a red PR — the exact stuck
  state this plan exists to remove. Assert a failing suite pushes nothing
  and reports a real conflict instead.
- **The resolution runs in a worker, not in the pulse.** Assert the
  server spawns through `plot-dispatch.sh` and does not merge, build, or
  push in-process: `merge-tree` predicts in memory, so the real work is a
  worktree merge plus a five-minute suite, and a 5 s timer cannot hold
  it.
- **A foreign CI failure is reported as EVIDENCE, not as a verdict.**
  Assert the row states the failing step, the branch's changed paths, and
  the branch's own recent run history — and that it does not classify the
  failure. The pairing that matters: a heuristic mapping steps to paths
  passes a "was it foreign?" assertion and goes silently wrong the first
  time the workflow is restructured.
- **A foreign CI failure is NOT rerun automatically.** Assert the offered
  action requires a click.
- **Every state the pulse cannot fix offers its action ON THE ROW**, not
  behind the three-dot menu. Assert the action is reachable without
  opening anything — measured: `RowActions` hides actions in a menu that
  only opens when something could act, so a waiting action looks
  identical to none.
- **The cue animates**, and **`motion-reduce` keeps it while stopping the
  animation.** Both halves — hiding the cue under `motion-reduce` takes
  the marker along with the movement.
- **The cue is not motion alone and not colour alone.** Assert the action
  carries a word and the reason reaches the accessible name; the
  animation is `aria-hidden`.
- **The cue stops when the action is TAKEN**, not when the branch
  unsticks. Assert it clears on the click — the request has been
  answered.
- **A healthy row carries no cue**, and **the artifact case offers
  nothing** because it resolves itself. The pairing that matters: a cue
  on every row makes the stuck ones invisible.
- **Unpushed work is reported and never pushed.** Assert no push is
  issued for `local_ahead`.
- **Detection writes nothing.** Assert the scan and the display path make
  no commit, no push, and no file write — the artifact resolver is the
  only writer, and only on its one path.
- **Detection is stateless.** Assert a fresh process reaches identical
  conclusions from identical refs, with no stored state.
- **The localhost guard is unchanged** for every offered action. Assert
  `/api/dispatch` and `/api/approve` still refuse over a non-localhost
  binding — the resolver is a separate path and does not widen them.
- **Over a non-localhost binding the cue SHOWS and the action REFUSES,
  naming the reason.** Assert both halves at a Tailscale address: the
  information is true everywhere, so hiding it would let a phone report a
  healthy fleet while branches sit stuck.
- **A branch that is not stuck is not reported.** Assert a healthy
  in-progress branch produces nothing: a watcher that flags everything
  flags nothing.
- `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
  `pnpm test`, `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.
- macOS bash 3.2 — no `declare -A`.

## Notes

The request asked for a watcher that *dispatches an agent to resolve
conflicts*. What it gets is a watcher that **notices** four kinds of
stuck, **offers** the fix for three of them, and **takes** exactly one —
the case whose correctness a rebuild and a CI gate can prove without
anyone reading a diff.

The narrowing is not caution for its own sake. `POST /api/dispatch` is
guarded by the localhost binding, which asks *where* the caller is and
not *who*; a timer passes that guard trivially. Detection needs no
authority at all, and separating it from action is what lets the useful
half ship without touching the guard.

Measured while planning: `build.mjs` embeds no timestamp and no
randomness, so the artifact rebuild is deterministic. That is what makes
the single exception provable rather than merely conventional.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "merge-tree computes in memory — what does 'the pulse resolves it' actually mean?", "a": "It dispatches a worker via plot-dispatch.sh; the real work is a worktree merge plus a 5-minute suite", "category": "technical"},
    {"q": "CI's no-diff gate runs AFTER the push — what proves the resolution before then?", "a": "test:board green locally before pushing; a failing suite pushes nothing and reports a real conflict", "category": "technical"},
    {"q": "How is a 'foreign' CI failure recognised?", "a": "It is not — the row shows evidence (step, changed paths, run history) and a human concludes", "category": "domain"},
    {"q": "Over Tailscale /api/dispatch is unavailable — what does a stuck row show?", "a": "The cue shows, the action refuses and names the reason; hiding it would report a healthy fleet", "category": "ux"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true},
    "ux": {"happyPath": true, "edgeCases": true, "accessibility": true},
    "nonFunctional": {"security": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

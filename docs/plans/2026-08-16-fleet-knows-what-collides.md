# The fleet knows the order and not the overlap

> Waves say which branch may start. They say nothing about which file it will
> open — so a correct "eligible" can still name a branch that two agents will
> fight over.

## Status

- **Phase:** Released
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-16, jwloka, plan-PR #142 merged
- **Started:** 2026-08-16, Jan Wloka, `infra/board-artifact-merge`
- **Started:** 2026-08-17, Jan Wloka, `feature/dispatch-reports-work-in-flight`
- **Started:** 2026-08-17, Jan Wloka, `feature/fleet-row-says-blocked`
- **Delivered:** 2026-08-17
- **Released:** 2026-08-18, v2.5.0

## Problem

Observed 2026-08-16, twice within an hour, and both times a human had to supply
the missing check by hand.

**The pulse's wave ordering is right and is not the whole answer.** The moment
`feature/fleet-row-phase` merged, `plot-fleet-scan.sh --next` offered
`feature/agent-view-phase-ui` — correctly: wave 1 was done, so wave 2 was
eligible, re-derived from refs with no flag to set and nothing to forget. But
`bug/board-shows-staleness`, from a *different plan*, had `AgentList.tsx` open
in an agent's worktree, and the eligible branch edits that same file. Nothing
in the model represents that.

Waves are a **within-plan** ordering. Collisions are **across plans**, and no
plan can declare them alone.

**And the built artifact collides between any two board branches, always.**
Measured: `skills/plot/scripts/board/board-server.mjs` is **796 KB across 177
lines** — roughly 4,500 characters per line. Git merges line by line, so every
change to the board, whatever source file it came from, lands in the same
handful of enormous lines. Two branches that touch entirely disjoint sources
still conflict there, and the conflict cannot be meaningfully resolved by
reading it.

That has been the binding constraint on parallel board work three times today.
It is why `bug/board-binds-port-zero` is held back although its sources are
free, and why every dispatch this evening required a human to read worktrees
first.

**Demonstrated while this plan was being written.** PR #141
(`bug/board-shows-staleness`) opened as `mergeable=CONFLICTING`, and
`merge-tree` names the whole of it:

```
Auto-merging skills/plot/scripts/board/board-server.mjs
CONFLICT (content): Merge conflict in skills/plot/scripts/board/board-server.mjs
```

One file, and it is the generated one. Not a single source conflict — the
branch edits `App.tsx` and `AgentList.tsx`, main had moved elsewhere, and those
merged cleanly. A human now has to resolve a 796 KB minified diff whose correct
resolution is *throw both away and rebuild*.

### What already exists, and where it runs

Neither half needs a new mechanism; both need an existing one at a different
moment.

`plot-merge-queue.sh` already predicts conflicts with `git merge-tree
--write-tree` — in memory, no checkout, non-zero exit means conflict — and
already guards the git-2.38 requirement, because the older `merge-tree`
silently answers a different question and would report everything as clean.
Verified on the live branch while writing this plan:

```
git merge-tree --write-tree origin/main <bug/board-shows-staleness HEAD>  → exit 1
```

The prediction was available. It was simply never asked before dispatch — only
before merge, which is after the cost has been paid.

## Design

### 1. The artifact stops being worth fighting over

**A conflict in a reproducible file is not information.** `board-server.mjs` is
generated output: any version of it is exactly as good as any other, because
`pnpm build:board` reproduces the correct one from sources that merged cleanly.
So the merge stops trying to reconcile it, and a rebuild settles it.

**`-merge` in `.gitattributes`, not a custom merge driver.** Checked while
writing this: the repo has no `.gitattributes` at all and no driver configured.
That matters, because the two mechanisms have very different reach. A custom
driver (`merge=rebuild`, invoking `pnpm build:board`) is the more elegant idea
and the more dangerous one: `.gitattributes` is versioned and travels with the
repo, but the **driver definition lives in each clone's `git config`**. On CI,
on a fresh clone, on a new colleague's machine, the attribute would name a
driver that does not exist — and git falls back to a normal merge, silently.
A rule that only works where someone remembered to install it is exactly the
kind this repo's own guidance warns against.

Marking the file `-merge` needs no local configuration and behaves the same
everywhere: git refuses to blend the two versions, keeps one, and reports the
conflict. The rebuild then settles it.

**Which side git keeps must not matter, and the plan says so explicitly.**
Under `git merge`, "ours" is the branch being merged into; under `git rebase`
the roles invert. A resolution phrased as *take ours* would therefore mean
different things depending on how the branch is being brought up to date — and
agents in this repo rebase routinely. Since the kept content is overwritten by
`pnpm build:board` in the next step, the correct instruction is side-neutral:
**take either version, then rebuild**. Any wording that names a side is a bug
waiting for a rebase.

This is the smallest change that removes the constraint, and it deliberately
does **not** take the file out of git. It is checked in for reasons that still
hold: `pnpm board` starts it with no build step, and the plugin ships it. CI
does not need it as an input — the workflow runs `pnpm run build:board` itself
and then diffs, so the committed file is an *expectation*, not a dependency.
Removing it would mean changing how the board starts, how the plugin ships, and
what the CI gate compares against — a large change to fix a merge problem.

**The CI gate stays exactly as it is.** It is the thing that keeps this honest:
if a branch resolves a conflict by keeping a stale artifact and forgets to
rebuild, the no-diff check fails. The strategy removes the *conflict*; the gate
still enforces *correctness*.

### 2. Dispatch asks before it fans out

**`merge-tree` cannot answer this, and the plan's first draft was wrong to say
it could.** The prediction it performs compares two *existing* commits. A
dispatch candidate is not one: `plot-dispatch` creates the branch, so at the
moment of the check it is identical to the default branch and `merge-tree`
would report *clean* for every candidate, forever. A check that always passes
is worse than no check — it converts a known gap into a false assurance.

The question at dispatch time is not *do these two commits conflict* but **which
files are already in play**, and that half — unlike the candidate's — is exactly
measurable.

**Only the measured side is used.** A second draft of this plan proposed a
`Touches:` field per branch, so the candidate could declare its paths and the
two sets could be intersected. Checking the briefs that already carry such
declarations killed it: the real scope guards are `packages/board/**`,
`packages/board/src/app/**` and `skills/plot/scripts/plot-fleet-scan.sh` — the
first *contains* the second. Under that comparison, `board-tells-the-truth` and
`fleet-sees-unpushed-commits` would read as colliding, and they ran in parallel
this evening without touching one another. Three of four briefs use `**` globs,
so the false positive is the normal case, not the corner. A warning that fires
on every board pair is a warning that gets ignored by the third time.

Worse, that half would rest on a **self-declaration**: estimated while planning,
never checked against what the branch actually writes, and phrased broadly
enough not to be a nuisance — which is precisely what makes it useless. A
comparison is only as good as its weaker half.

So dispatch **reports what is held, and does not predict what would clash**. For
every branch with a claim, its local ref and its worktree give the exact files
in play, committed and uncommitted:

```
would dispatch feature/agent-view-phase-ui → …
  in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
```

That is the same fact a human assembled by hand twice today, from five commands,
before deciding. It decides nothing automatically; it moves the decision from a
minute of investigation to a line of output — and it is built entirely on
measurement, with nothing estimated.

**`merge-tree` still earns its place — after the branch exists.** Re-running a
dispatch (`reused`) has two real commits to compare, and so does every merge.
`plot-merge-queue` keeps that job; this plan does not duplicate it.

`plot-dispatch` runs this check against the work in flight, before creating a
worktree.

**Against local refs AND worktrees, not the remote.** This is where the
refs-are-truth principle bends for a good reason, and the reason is measured:
the collision that blocked a dispatch this evening lived in an **unpushed
commit**. `bug/board-shows-staleness` had committed, its worktree was clean,
its remote ref held only the claim — invisible to any remote-based check.
Uncommitted work is invisible to refs entirely.

Both sources are readable here and only here:

- `refs/heads/*` — unpushed commits. Worktrees share one ref database, measured
  in [`fleet-sees-unpushed-commits`](2026-08-16-fleet-sees-unpushed-commits.md):
  `git rev-parse` answers from the main repo for a branch checked out elsewhere.
- `git worktree list` + `git status` — uncommitted changes, which no ref holds.

That is sound rather than a violation, because **dispatch is inherently local**.
It creates worktrees on this machine; it is already the one Plot command whose
job is machine-specific. A check that ignored what this machine knows would be
blind precisely where it acts.

### 3. Dispatch reports, and the human decides

Nothing is skipped automatically, because nothing is predicted. An earlier
draft had dispatch refuse a colliding candidate; that only makes sense with a
prediction worth trusting, and the section above explains why there is not one.
Refusing on a guess would block the pairs that ran fine today.

So `--dry-run` and the real run both print what is in flight and what it holds,
and the operator starts the branch or does not. This is the lightest thing that
would have prevented both of today's incidents, and it cannot itself be wrong:
every fact in it is read from git on this machine.

`plot-dispatch` remains a tool that reports rather than a gate that judges —
consistent with the pulse beside it, and with the split this repo states
outright: **scripts collect and report; skills interpret and adapt.**

### 4. The row says blocked, because it is

A held-back branch currently reads **`eligible — nobody has taken it`**, and
that sentence makes two claims of which only one is true. *Nobody has taken it*
is correct: no claim ref exists. *Eligible* is not — a dispatch would be
refused, or would collide.

The failure is not cosmetic, because the row is **indistinguishable from a
genuinely free one**. On the board tonight, `feature/agent-view-phase-ui`
(blocked by an agent editing `AgentList.tsx`) and `feature/plot-sprint-support`
(free since February, waiting for anyone) render the identical note. One is
waiting on a machine; the other is waiting on a person. The reader cannot tell,
and the tab exists precisely to tell them.

It is also the same mismatch this repo already rejected elsewhere: the Start
button appears only on eligible rows, because offering an action the tool will
decline teaches people to distrust the offer. A row that says *eligible* is
that offer in text.

So the vocabulary gains the state it is missing. `blocked by an earlier wave`
already exists for the **within-plan** case; the **across-plan** case has no
counterpart, which is why an accurate scan produces an inaccurate row. The note
names what holds it — the branch, not merely the fact — because *blocked* alone
invites the next question and the scan already has the answer.

**On the measured side only, and therefore conservative.** The row does not
claim the candidate *would* conflict — nothing here can know that. It says work
is in flight that has files open, which is the fact dispatch reports. So it can
mark a branch blocked that would in truth have been safe, and it says so in the
note rather than pretending to a certainty it lacks.

That is the right direction to err. The failure being fixed is a row that reads
*eligible* while a dispatch is inadvisable; an over-cautious row still leaves
the operator free to start the branch, and — unlike today — tells them what
they are deciding against. On tonight's board it would have been exactly right:
`feature/agent-view-phase-ui` blocked, `feature/plot-sprint-support` free.

**A Draft plan's branches are not eligible either, and that is the same rule.**
Found on the live board while this plan was open: `working-rows-show-motion` was
drafted, its plan PR still in CI, and its two branches immediately appeared
under NOT STARTED with one reading *eligible — nobody has taken it*. Measured:
`plot-plan-meta.sh` reports `phase: draft`, no `Approved:` record, no
`Started:`.

NOT STARTED means *discovered, planned, ready for an agent to pick up* — the
hand-off point. A plan still under review has not reached it, and
`plot-dispatch` would refuse those branches, so the row invites an action the
tool declines. Exactly the mismatch the Start button avoids by appearing only on
eligible rows.

The data is already there and nothing reads it: since #140 the pulse reports
each plan's own `phase`, deliberately as data — *"It is reported, never
decides"*. So this is a condition in `classify()`, not a scan change.

The row's own age gives the tell, honestly and by accident: the waiting age is
measured from the `Approved:` record, so a Draft's rows render `—` while
`plot-sprint-support` renders `6mo`. The row already knows it cannot answer; it
just says "age unknown" instead of "not approved yet".

**Derived, never stored.** The pulse is stateless by design and stays so: the
state is re-computed from refs and worktrees on every scan, exactly like wave
state. A branch stops reading blocked the moment the work it collided with
lands, with nothing to clear.

## Slices

### Merge

- `infra/board-artifact-merge` — a merge strategy for
  `skills/plot/scripts/board/board-server.mjs` so conflicts in the generated
  bundle are settled by rebuilding rather than by reading; CI's no-diff gate
  unchanged → #144

### Prediction

- `feature/dispatch-reports-work-in-flight` — before fanning out,
  `plot-dispatch` prints which claimed branches hold which files, read from
  local refs and worktrees; it starts everything as before and refuses nothing → #156
- `feature/fleet-row-says-blocked` — the pulse reports work-in-flight as its
  own row state, so a held-back branch stops reading `eligible — nobody has
  taken it`; derived per scan, never stored → #154 — delivers the DRAFT half
  only. The work-in-flight half is blocked on a contradiction between two of
  this plan's own requirements: *"No candidate-side prediction is consulted"*
  and *"`agent-view-phase-ui` blocked, `plot-sprint-support` free"* cannot both
  hold, because with no candidate-side input the only available rule marks both
  rows blocked. Same-plan narrowing is ruled out by this plan's own evidence —
  the live pair were in different plans, and the candidate's wave-1 sibling had
  already *merged*, which is what made its wave eligible. See the note on #154

Two waves, and the order is deliberate: the artifact strategy is what makes any
board branch mergeable at all, and the prediction is more useful once the
artifact stops producing a collision on every single pair.

## Done when

- **Two board branches that touch disjoint sources merge without an artifact
  conflict.** Assert against real branches, not a fixture: the 177-line shape
  is what causes this and a small synthetic file would not reproduce it.
- **A merged branch still fails CI if the artifact is stale.** The gate must
  survive the strategy — assert that resolving by rebuild is required, not
  optional. Without this the change trades a conflict for a silent
  regression.
- **Files held in an UNPUSHED commit are reported.** The exact case from
  2026-08-16: committed, clean worktree, remote ref holds only the claim. An
  implementation reading remote refs reports nothing and passes any weaker test.
- **Files held UNCOMMITTED are reported.** No ref holds them, so this fails
  against any implementation that reads refs alone.
- **Dispatch still starts everything.** Assert that reporting refuses nothing —
  the earlier draft skipped colliding candidates, and a skip built on this
  measurement would block pairs that ran fine today.
- **Nothing is reported when nothing is claimed.** A report that always prints
  something teaches the reader to skip it.
- **A DRAFT plan's branches do not read `eligible`.** Assert against a plan with
  `phase: draft` and no `Approved:` record — the case seen live, and the one an
  implementation reading only git state passes without noticing.
- **A blocked branch does not read `eligible`.** Assert the note differs from a
  genuinely free branch's: tonight `feature/agent-view-phase-ui` and
  `feature/plot-sprint-support` rendered identically while one waited on a
  machine and the other on a person.
- **The blocked note names what holds it.** Assert the counterpart branch
  appears — *blocked* alone invites a question the scan can already answer.
- **A branch stops reading blocked once the collision lands**, with nothing
  cleared by hand. Assert it against a second scan: a stored flag passes the
  first assertion and fails this one.
- **The strategy works in a clone that configured nothing.** Assert against a
  fresh clone with no `git config` of its own — a custom driver passes on the
  author's machine and silently does nothing everywhere else.
- **The resolution never names a side.** Assert that a rebase and a merge
  produce the same committed artifact: "ours" inverts between them, so a
  side-named resolution passes one test and fails the other.
- **No candidate-side prediction is consulted.** Assert the report is identical
  whether or not the plan describes the candidate's files — the two rejected
  drafts (a `merge-tree` comparison against a branch that does not yet exist, a
  `Touches:` self-declaration) both pass a loose test and fail this one.
- **git older than 2.38 refuses rather than reporting clean**, wherever
  `merge-tree` is still used (re-dispatch, merge queue). `plot-merge-queue`
  already guards this because the old `merge-tree` answers a different question;
  the guard must be shared, not reimplemented beside it.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

Both halves were found by dispatching, not by reading — the pattern this
session repeated all evening. The wave ordering looked complete until an
eligible branch pointed at a file an agent already had open.

Related and deliberately separate:
[`fleet-sees-unpushed-commits`](2026-08-16-fleet-sees-unpushed-commits.md)
makes unpushed work *visible in the board*; this plan makes it *consulted by
dispatch*. Same blindness, two different consumers, and the measurement that
unpushed commits are readable from the main repo is shared between them.

Recorded as open points in
[`plot-board`](../stories/plot-board/STORY-plot-board.md) on 2026-08-16.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "The repo has no .gitattributes and no merge driver configured. A custom merge=rebuild driver lives in each clone's git config — would silently do nothing on CI and fresh clones.", "a": "Use `-merge` in .gitattributes instead: no local configuration, same behaviour everywhere. git keeps one side and reports the conflict; the rebuild settles it", "category": "technical-architecture"},
    {"q": "merge=ours inverts between merge and rebase — 'ours' means different things. Problem?", "a": "Yes. The resolution must be side-neutral: take EITHER version, then rebuild. The kept content is overwritten anyway, and agents here rebase routinely", "category": "technical-implementation"},
    {"q": "What does merge-tree compare the candidate against?", "a": "Each claimed branch's local state — the question is 'would these two collide', not 'is the candidate mergeable', which is always yes for a fresh branch", "category": "technical-implementation"},
    {"q": "A dispatch candidate does not exist as a branch yet — plot-dispatch creates it. What can merge-tree compare?", "a": "Nothing useful — it would report clean for every candidate, turning a known gap into a false assurance. Compare declared FILES instead: the claimed side from refs and worktrees, the candidate side from the plan's own Branches/Design text", "category": "technical-architecture"},
    {"q": "Plan Branches text names no paths; briefs carry `### Scope guard` globs. Introduce a `Touches:` field per branch?", "a": "No. Measured: the real guards are packages/board/** and packages/board/src/app/** — one CONTAINS the other, so two branches that ran in parallel today would read as colliding. Three of four briefs use ** globs, so the false positive is the normal case. And it would rest on an unverified self-declaration", "category": "domain-rules"},
    {"q": "Then what does dispatch do?", "a": "Reports the measured side only — which claimed branches hold which files, from refs and worktrees — and refuses nothing. The same fact a human assembled by hand twice today from five commands", "category": "ux-happyPath"},
    {"q": "With no prediction, what does the `blocked` row rest on?", "a": "The measured side: work is in flight with files open. Conservative — it may mark a safe branch blocked — and it says so rather than claiming certainty. Erring that way still leaves the operator free, and tells them what they are deciding against", "category": "ux-errors"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": true, "data": false},
    "ux": {"happyPath": true, "edgeCases": false, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

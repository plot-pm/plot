# The board reads the ref, not the checkout

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The board reads plans and sprints from `origin/<main>` rather than from its own
checkout, so a plan approved or delivered elsewhere is visible without anyone
pulling the board's worktree — and a plan that exists only locally is shown,
marked `not pushed`, rather than silently missing.

## Motivation

### The measurement

Two operator reports on 2026-08-27, twenty minutes apart, from one cause.

**A `2 rounds` badge beside phase Development.** The badge renders only for a
Draft card (`isDraft(card)` is `card.phase === 'Discovery'`), so a plan reading
Development must not carry one. The board's payload:

```
phase: 'Discovery'   status: 'draft'   rounds: 2
```

while `origin/main` said `Phase: Approved`.

**A Deliver button refusing a finished plan.** `a-closed-sprint-says-what-it-achieved`,
both waves merged (#457 21:47, #463 05:51), refused with:

> plan has a branch that is not merged — a plan is deliverable only once every
> non-deferred branch has landed, and /plot-deliver would refuse it too

The board's checkout was **8 commits behind `origin/main`** and had never seen
the commit annotating wave `Reported` with #463. After a `git merge --ff-only`
and nothing else, the same plan read `status: 'deliverable'`, `deliverable: true`,
and the badge disappeared.

**Both messages were accurate about what the board could see.** Neither was
accurate about the repository.

### The row contradicted itself, and that is the tell

The Deliver refusal rendered directly beneath a wave row reading *merged ·
complete*. One row, two sources:

| Reader | Source | Fresh? |
|---|---|---|
| `plot-fleet-scan.sh` (wave rows) | `origin/<main>`, and it fetches every pulse | yes |
| `board.ts` (plan + sprint facts) | `fs.readFileSync` of its own checkout | **only if a human pulled** |

Nothing in `packages/board/src/server/` runs `git fetch`, and nothing pulls the
checkout. The working tree is current exactly as often as someone remembers.

### The board already fetches — it just does not read what it fetched

`fleet.ts:1801` runs `plot-fleet-scan.sh --stream` on every pulse, and the scan
fetches. So `origin/main` **in the board's own repository is already current**.

The stale bytes are not stale because the data is far away. They are stale
because `board.ts` reads a second, older copy of data it already has.

### The ref-reading machinery is already there, pointed the other way

`planPathsInTree` (`board.ts:255`) runs `git ls-tree -r <ref>`, and
`readBranchPlans` (`:292`) already asks for `origin/${defaultBranch}`.

It asks in order to **subtract**: which plans exist on main, so a branch plan is
not double-counted. The plans themselves then come from `collectPlanFiles`,
which walks `active/`, `delivered/` and the plan directory with `readdirSync`
and `realpathSync`.

So the board reads the ref to decide what NOT to show, and the checkout to
decide what to show. Fixing this adds no new mechanism; it points an existing
one at the content.

### This is the third instance of one defect class today

`plot-dispatch.sh`'s phase gate states the rule outright:

> the question the gate asks is: has this plan been approved WHERE EVERYONE CAN
> SEE IT? [...] There is deliberately NO fallback to the working tree — that
> would reintroduce the bug exactly where nothing can catch it.

The brief gate shipped in #465 with a `[ -r ] && [ -s ]` filesystem read and was
corrected the same day to `git cat-file -s origin/$MAIN:...`. `board.ts` is the
third, and the only one still reading a checkout.

## Design

### Plans and sprints come from `origin/<default>`, in ONE process

`collectPlanFiles` returns paths for the caller to read. It becomes a lister of
`origin/<default>` paths — `planPathsInTree` already does exactly this, mode
check and all — and the read becomes a **single `git cat-file --batch`** over
every blob it named.

`plot-plan-meta.sh` takes a FILE, so each blob is staged to a temp file the way
`board.ts:856` already stages branch-plan content. That path is proven: it is how
every Draft plan on an idea branch is parsed today.

`parseSprintFile` takes the same treatment, in the same wave and through the same
bulk read. Sprint files feed the sprint gate and the tally, so a stale sprint is
a wrong release decision rather than a cosmetic one — and splitting it out would
mean two branches editing `board.ts` days apart, which is how the artifact
conflicts this repo keeps resolving get made.

### The read shape is the design, not an implementation detail

Measured 2026-08-27 against this repo's own estate:

| approach | cost |
|---|---|
| one `git show` per plan (280 entries) | **~1.5 s** |
| one `git cat-file --batch` for all of them | **0.011 s** |

**136× apart, on a path the client polls every few seconds.** The naive shape is
not a slower version of the right answer; it is slower than the bug, and it would
be introduced by an implementation that satisfies every other item in this plan.

The constraint is already written down next to the code being changed: each `git`
invocation costs ~55 ms of process spawn *regardless of how little work it does*,
which is why `collectBranchPlans` caches on tip SHAs rather than re-reading.
A per-file loop pays that 280 times.

So `Done when` asserts the SHAPE, not only the source. A cache keyed on the main
SHA was considered and rejected as the primary mechanism: it makes the common
path fast and every push expensive, and it would sit beside the branch-plan cache
as a second cache solving one problem. With the batch read costing 11 ms there is
nothing left to cache.

### The parser is already spawned once, and must stay that way

Round two checked the obvious way this design could still be slow: the bulk read
wins because it is ONE process, and staging 151 blobs to temp files would be
worth nothing if `plot-plan-meta.sh` were then spawned per file — at ~55 ms a
spawn that is ~8 s, swallowing the 1.5 s the batch read saves.

It is not. `readPlanMeta` (`board.ts:599`) takes an ARRAY and its docstring says
so: *"Run the plan-format helper once over all plan files."* One `bash` spawn for
the whole estate, with a 64 MB buffer already sized for it, and `board.ts:880`
passes working-tree and staged files together in a single call.

So the existing architecture already solves the half this plan does not touch.
It is recorded here as a constraint to PRESERVE rather than a problem to fix: a
change that reads the ref correctly but parses per file would be slower than
today for a reason no `Done when` item above would catch.

### The symlinks stop being read, and that is a simplification

`collectPlanFiles` walks `active/` and `delivered/` and calls `realpathSync` to
resolve each symlink. A tree listing needs none of it: `planPathsInTree` already
**skips** non-regular modes, so a `120000` symlink entry is dropped and the
dated file is listed once, by its real path.

The de-duplication `collectPlanFiles` performs with a `seen` set exists because
one plan appears twice on disk. It appears once in a tree listing.

### Not chosen: pull the board's checkout on a timer

The obvious fix, and it is the one this plan rejects. A `git pull` in the board
mutates a working tree a human may be editing — the board's checkout is a real
worktree, not a cache — and it fails on a dirty tree, which is precisely when
somebody is using it. It would also make the board's correctness depend on a
write succeeding, when the read it needs is already local and free.

### Not chosen: read the checkout, warn when behind

Surfacing "this board is N commits behind" would make the two reports above
diagnosable rather than mysterious, which is a real improvement and not enough.
The Deliver button would still refuse a deliverable plan; the operator would
just know why. A gate that is wrong with an explanation is still wrong.

Worth keeping as a supplement if the ref read ever fails (below).

### Not chosen: SUBSTITUTE the working tree when the ref is unreadable

Distinct from showing a local plan as local, and the difference is the whole
design. Adding a card the ref lacks, labelled `not pushed`, claims nothing about
what everyone can see. **Substituting** working-tree content where a ref read
failed claims exactly that, silently — the phase gate's own words for it: a
fallback to the working tree *"would reintroduce the bug exactly where nothing
can catch it."*

So the two rules are one rule stated twice:

| the ref says | the working tree says | the board shows |
|---|---|---|
| a plan | anything | **the ref's**, unmarked |
| nothing | a plan | the working tree's, marked `not pushed` |
| unreadable | anything | **nothing, and why** |

A repo with no remote is a real case, and it is answered by the third row rather
than by quietly promoting the checkout. `readBranchPlans` already handles an
unreadable ref by returning nothing.

### An unpushed local plan is SHOWN, and marked as local

The ref is the source of truth for every plan it holds. The working tree may only
**add** plans the ref does not have, never override one it does — a one-directional
merge, not a second source of truth.

Such a card renders with an explicit *not pushed* marker.

**This reverses the first draft of this plan**, which argued the card should
simply disappear, on the grounds that what the board shows should be what
everyone can see. That reasoning conflated two different things. The defect is
not *reading the working tree*; it is **reading the working tree and presenting
it as shared truth**. A card that says `not pushed` makes no such claim — it
states exactly what it is, which is the same honesty `truncated` and
`brief=missing` carry elsewhere in this codebase.

The gap it closes is real and was measured on the day: this session wrote five
plans, each invisible to the board for the minutes between writing and pushing.
Worse than invisible, in one case — a plan EDITED but not pushed would render its
older ref content with nothing to say the working tree disagreed.

**The rule is one-directional and must be asserted as such.** A local plan that
also exists on the ref is the ref's, not the working tree's; otherwise an
uncommitted edit silently becomes what the board reports, which is the original
defect with extra steps.

### The marker serves an AUTHORING checkout, and is silent in a dedicated one

Measured 2026-08-27: the board's own checkout (`plot-board`) holds **zero** plans
that are not on the ref. Nobody authors there, so the `not pushed` marker would
essentially never fire in it.

The gap that justified the marker was measured in a different worktree — an
authoring checkout, where five plans written that session were each invisible for
the minutes between writing and pushing. `pnpm board` runs wherever it is
started, and both are real deployments.

**This is written down because the feature is expected to look unused.** A test
that fires only in an authoring tree, beside a dedicated deployment where it
never fires, reads as dead code to the next person — and the natural act is to
delete it. The two deployments are the reason it exists, so the plan names them.

### The board says which ref it read

The pulse already carries `readRef` and `readRefAge`; the board renders neither.

That is what made both of this plan's originating reports mysteries rather than
diagnoses: a badge and a button were wrong, and nothing on the screen said the
plan estate had been read from a commit sixteen behind. Measured the same day —
the board's checkout drifted **16 commits in about an hour**, so this is the
steady state rather than an unlucky moment.

Rendering it is a display of fields that already exist, not a new derivation, and
it belongs in this wave because it answers the question this wave's own failure
modes raise: *which source am I looking at, and how old is it?* An operator who
sees a local-only card or an unresolvable ref then has the mechanism in front of
them instead of having to know it exists.

## Waves

### Read (Branch: bug/the-board-reads-the-ref-not-the-checkout)

`collectPlanFiles` and `parseSprintFile` read plans and sprints from
`origin/<default>` via the existing `planPathsInTree` + staging path, with no
working-tree fallback, and the board reports when that ref cannot be resolved.

## Done when

1. **A plan approved on `origin/main` and never pulled reads `Approved` on the
   board.** Asserted against a checkout deliberately left behind — the measured
   shape. A fix verified only on an up-to-date checkout passes without doing
   anything.
2. **A plan whose every wave is merged is `deliverable` on a stale checkout.**
   The Deliver refusal is the report this plan came from; it must be the
   assertion, not just the phase behind it.
3. **The rounds badge is absent for a plan that is Approved on the ref and Draft
   in the checkout.** Same single cause, second visible symptom — both are
   pinned, because a fix that corrects `phase` and leaves `status` derived from
   something else would pass item 1 alone.
4. **A sprint file is read from the ref too.** A stale sprint tally is a wrong
   release gate, and sprints are read by a separate function that would
   otherwise be left behind.
5. **The whole estate is read in ONE git process.** Asserted by counting
   spawns, not by timing — a duration assertion is flaky on a loaded machine,
   and the spawn count is the fact that makes the duration. 280 entries in one
   `cat-file --batch` is 0.011 s against ~1.5 s for a per-file loop; without
   this item a naive implementation passes items 1-4 and makes the board slower
   than the defect it fixes.
6. **No `git fetch` is added to the board.** The scan already fetches every
   pulse; asserted by the existing no-network test.
7. **A plan present only in the working tree is shown, and marked `not
   pushed`.** The five-plans-invisible gap measured on 2026-08-27.
8. **A plan present in BOTH takes the ref's content, and is not marked.** The
   one-directional rule: without this, an uncommitted edit becomes what the
   board reports, which is the original defect with extra steps.
9. **The marker survives the client cast.** A new `CardSchema` field, asserted
   through a rendered card and not only through the payload — this repo's
   client casts rather than parses, so a field the schema does not declare is
   `undefined` in the renderer no matter what the server sent.
10. **Where `origin/<default>` cannot be resolved, the board says so** rather
    than silently rendering checkout contents as if they were the ref's.
11. **A plan indexed under `active/` appears exactly once.** The symlink
    de-duplication is being removed along with the directory walk (measured:
    151 plan blobs against 129 symlinks, and a mode-filtered tree listing drops
    the latter); a plan appearing twice is the regression that removal invites.
12. **`plot-plan-meta.sh` is spawned ONCE for the whole estate**, working-tree
    and ref-read plans together. Asserted by spawn count, like item 5: reading
    the ref in one process and then parsing in 151 is slower than today, and no
    other item here would catch it.
13. **The marker is ABSENT in a checkout whose plans are all on the ref.** The
    dedicated-deployment case, measured at zero local-only plans — pinned so a
    later change cannot start marking every card, which would make the label
    meaningless in the deployment where it matters.
14. **The board displays the ref it read and that ref's age.** Both fields are
    already in the pulse (`readRef`, `readRefAge`); this asserts they reach the
    screen, because their absence is what made two wrong renders undiagnosable.
15. `pnpm run validate`, `pnpm run test:board`, `pnpm run test:reconcile` green;
    artifact rebuilt and committed.

## Notes

### Why it read as a badge bug and a button bug

Neither `roundsBadgeText` nor the Deliver gate is wrong. Both were handed a
`PlanMeta` parsed from an old file and behaved correctly on it — which is why
two unrelated-looking reports twenty minutes apart had one cause, and why
looking at either renderer would have found nothing.

The failure is legible only from the payload: `phase: 'Discovery'` beside a plan
file that says `Approved`.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A section that renders wave state
from a fetched ref and plan state from an unpulled checkout is not telling one
truth with a delay — it is showing two answers of different ages in the same
row, and the operator has no way to tell which half is old.

### Interrogated 2026-08-27

Three questions, and the second overturned a decision this plan had argued for
at length.

**The read shape was missing, and it decides the outcome.** The plan said *read
from `origin/<default>`* without saying how. Measured against this repo's own
estate: 280 per-file `git show` calls cost **~1.5 s**, one
`git cat-file --batch` costs **0.011 s** — 136× apart, on a path the client
polls every few seconds. A naive per-file implementation would have satisfied
every other item in the plan and left the board slower than the defect it fixes.
The shape is now a `Done when` item, asserted by SPAWN COUNT rather than
duration, because a timing assertion is flaky and the spawn count is the fact
that produces the duration.

**Unpushed plans are shown and marked, not hidden.** The first draft argued they
should disappear, reasoning that the board must show only what everyone can see.
That conflated *reading the working tree* with *presenting it as shared truth* —
a card marked `not pushed` makes no such claim. The measured gap: this session
wrote five plans, each invisible for the minutes between writing and pushing, and
an EDITED-but-unpushed plan would have rendered stale ref content with nothing to
say the tree disagreed. The rule is one-directional — the working tree may add a
plan the ref lacks, never override one it has — and both halves are now asserted,
because the override direction is the original defect with extra steps.

That reversal forced a second one: *Not chosen: read the working tree when the
ref is unreadable* now reads *Not chosen: **SUBSTITUTE** the working tree*, with
a three-row table for the three cases. Adding a labelled card and silently
promoting the checkout are different acts, and the earlier wording forbade both.

**Sprints stay in the same wave.** They share the seam and the bulk read;
splitting would put two branches in `board.ts` days apart, which is how the
artifact conflicts this repo keeps resolving get made.

A `CardSchema` field also earned its own assertion: this client casts rather than
parses, so a marker the schema does not declare is `undefined` in the renderer no
matter what the server sent.

### Interrogated again 2026-08-27 — round 2

Two questions, plus one check that came back clean and is now recorded as a
constraint.

**The check:** the batch read wins by being one process, so round two asked
whether the parser undoes it. It does not — `readPlanMeta` already spawns
`plot-plan-meta.sh` once for the whole estate. That is now `Done when` item 12,
because an implementation could read the ref correctly and parse per file, and
nothing else in the plan would notice.

**The marker is expected to look unused, and the plan now says so.** The board's
own checkout holds zero plans absent from the ref — nobody authors there. The
five-plan gap was measured in an authoring worktree instead. Both are real
deployments of `pnpm board`, and without this written down the feature reads as
dead code to whoever finds its test next.

**The board will show which ref it read.** `readRef` and `readRefAge` are already
in the pulse and rendered nowhere, which is precisely why a wrong badge and a
refusing button were mysteries rather than diagnoses. The checkout drifted 16
commits in an hour, so the staleness this plan removes is continuous rather than
occasional — and an operator meeting the new failure modes (a local-only card, an
unresolvable ref) should be able to see the mechanism instead of having to know
it exists.


<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {
      "q": "How should the ref be read \u2014 per-file or bulk?",
      "a": "Bulk cat-file --batch; measured 0.011s vs ~1.5s for 280 per-file shows, and the shape is now a Done-when item",
      "category": "nonFunctional"
    },
    {
      "q": "Should an unpushed local plan disappear from the board?",
      "a": "No \u2014 show it marked `not pushed`; the ref may not be overridden, but the tree may ADD",
      "category": "ux"
    },
    {
      "q": "Plans and sprints in one wave, or split?",
      "a": "One wave \u2014 same seam, same bulk read; splitting invites artifact conflicts in board.ts",
      "category": "technical"
    },
    {
      "q": "The marker never fires in the board's dedicated checkout \u2014 keep it?",
      "a": "Keep, and name the authoring-vs-dedicated deployments so it is not read as dead code",
      "category": "ux"
    },
    {
      "q": "Should the board display readRef / readRefAge?",
      "a": "Yes, in this wave \u2014 the fields exist and their absence made two wrong renders undiagnosable",
      "category": "ux"
    },
    {
      "q": "Does per-file parsing undo the batch read's win?",
      "a": "No \u2014 readPlanMeta already spawns the parser once for all files; recorded as a constraint to preserve",
      "category": "nonFunctional"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": true
    },
    "domain": false,
    "ux": {
      "happyPath": true,
      "edgeCases": true,
      "errors": true,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": true,
      "scalability": true
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

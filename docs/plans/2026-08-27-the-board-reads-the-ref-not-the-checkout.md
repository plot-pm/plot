# The board reads the ref, not the checkout

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The board reads plans and sprints from `origin/<main>` rather than from its own
checkout, so a plan approved or delivered elsewhere is visible without anyone
pulling the board's worktree.

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

### Plans and sprints come from `origin/<default>`

`collectPlanFiles` returns paths for the caller to read. It becomes a lister of
`origin/<default>` paths — `planPathsInTree` already does exactly this, mode
check and all — and the read becomes `git show <ref>:<path>`.

`plot-plan-meta.sh` takes a FILE, so the content is staged to a temp file the
way `readBranchPlans` already stages branch plans. That path is proven: it is
how every Draft plan on an idea branch is parsed today.

`parseSprintFile` (`:669`) takes the same treatment. Sprint files feed the
sprint gate and the tally, so a stale sprint is a wrong release decision rather
than a cosmetic one.

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

### Not chosen: read the working tree when the ref is unreadable

The phase gate's own words: a fallback to the working tree *"would reintroduce
the bug exactly where nothing can catch it."* A repo with no remote is a real
case, and it is answered by the ref being absent, not by silently reading
something else — `readBranchPlans` already handles an unreadable ref by
returning nothing.

**Where `origin/<default>` cannot be resolved at all, the board says so** rather
than rendering a plan estate it cannot vouch for. This is the one place the
supplement above belongs.

### An unpushed local plan stops appearing, and that is correct

A plan written but not pushed currently shows on the board. After this change it
does not, until it is pushed or lives on a prefixed branch (where
`readBranchPlans` finds it — the Draft-under-review path, unchanged).

That is the same trade `plot-dispatch.sh` already makes, and the same one #465
made for briefs today: what is visible to the board should be what is visible to
everyone. A card only its author can see is the disagreement this plan removes,
not a feature.

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
5. **No `git fetch` is added to the board.** The scan already fetches every
   pulse; asserted by the existing no-network test.
6. **No working-tree fallback exists.** Asserted by making the ref unreadable
   and observing the board *say so* rather than render checkout contents.
7. **A plan indexed under `active/` appears exactly once.** The symlink
   de-duplication is being removed along with the directory walk; a plan
   appearing twice is the regression that removal invites.
8. `pnpm run validate`, `pnpm run test:board`, `pnpm run test:reconcile` green;
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

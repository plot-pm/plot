# Juror: the estate

Subject: `docs/plans/2026-09-17-the-index-is-read-once.md`
Lens: does the estate already hold this, or a better place to build it?


## What I tried to refute, and could not

Four lines of attack failed on measurement. I record them because a later reader
should not re-run them.

**1. "The domain is the right home, not more shell."** It is not. The estate
already settled this and settled it the other way. `reconcile()` shipped in
v2.16.0 (`2026-09-09-reconcile-is-a-controller-action.md`, State: Released) and
it takes `phaseSymlinkDrift` as a **reading it is handed**, not one it computes:

```
packages/domain/src/workflows/reconcile.ts:102
  /** Whether the plan's phase and its index symlink disagree. */
  readonly phaseSymlinkDrift: boolean;
```

`packages/board/src/server/entry/reconcile.ts:122` reads it off stdin
(`phaseSymlinkDrift: given.phaseSymlinkDrift === true`), and its own header
states the contract: *"SO THIS SPAWNS NOTHING AND READS NOTHING. Every reading
arrives on stdin, taken by the shell that owns the git and host calls."*
Resolving the index is filesystem I/O, so by the layering rule it belongs in the
shell that takes the reading. The plan is building it where the estate says it
goes.

**2. "`--offline`'s sibling already covers it."**
`2026-09-17-a-scan-section-honours-offline.md` (State: Delivered) names this
exact function and explicitly disclaims it: *"The separate defect is named
rather than merely acknowledged: `symlinked_from` is quadratic in plan count,
and it is somebody's plan to write. It is not this one."* This plan is that
plan. No overlap.

**3. "`index_drift=` gates nothing, so question the caller instead."**
Refuted. `symlinked_from` feeds **three** consumers, not one, and the first is
blocking. `in_active`/`in_delivered` at `:712-713` feed section 1
(`drift=`), which sits ABOVE `== blocking sections end ==` (`:1253`) and is what
`/plot-deliver` step 7b greps (`skills/plot-deliver/SKILL.md:468`). Only section
12 (`index_drift=`) is the convenience count. The plan says exactly this and is
right; the caller cannot be deleted.

**4. "The estate has a better technique already — `git ls-files -s` +
`cat-file --batch`, as `plot-fleet-scan.sh:2352` uses."** Measured here, and the
plan's `ls -l` wins:

| technique | both index dirs | forks |
|---|---|---|
| `ls -l` (the plan) | **0.052 s** | 1 |
| `git ls-files -s \| cat-file --batch` | 0.118 s | 2 |

The git-native route is also wrong for this caller: it answers from the ref,
and section 1 must report the **working tree**, which is where an operator's
half-finished `ln -s` lives. I withdraw this objection.

**5. `plot-deliverable-search.sh` run on the proposal** returned no deliverable
this duplicates. It is a rewrite of an existing function, not a new one.

## The finding that stands

**The plan fixes one of two walkers over the same directory, and the one it
leaves behind is 170 forks it already owns.**

`grep -n readlink skills/plot/scripts/plot-reconcile-scan.sh` returns five
sites. The plan names `:685`. It does not name `:1104`, in section 4:

```
skills/plot/scripts/plot-reconcile-scan.sh:1102-1105
for l in "$ACTIVE_DIR"/*.md; do
  [ -L "$l" ] || continue
  target=$(readlink "$l" 2>/dev/null | sed 's|.*/||')
  df="$PLAN_DIR/$target"
```

That is the **identical two-fork idiom, over the identical directory, in the
same run**. Measured on this estate today: 85 `active/` links, so 170 forks —
at the plan's own 37.8 ms that is **6.4 s of the sweep**, spent re-deriving a
map the plan's slice will have built one screen earlier and thrown away.

Why this is an amendment and not a nitpick:

- **The plan's Done-when forbids the obvious repair.** It reads *"`symlinked_from`
  has no remaining caller, or is deleted."* Section 4 does not call
  `symlinked_from`; it inlines the same two forks. So an implementer can satisfy
  every clause of the Done-when, pass the byte-identity pin, and leave `:1104`
  untouched — the gate does not see it.
- **It is the estate's own recorded failure mode.** `sprint_drift=57` and the
  `plot-pr-merged.sh` extraction are both cases this repo has written up where
  one question got two implementations and they drifted. This plan creates that
  shape deliberately: after it lands, the scan resolves `active/` once in a map
  and once per link in a loop, and nothing says they must agree.
- **It costs the slice almost nothing.** The map the plan builds is keyed
  link → target; section 4 wants the same pairs in the other direction, which is
  a second pass over an array already in memory. This is not scope creep, it is
  the same fork removal reaching the second site.

## Two smaller amendments

**The pinned counts are already stale.** The plan pins *"83 plans linked from
`active/` and 277 from `delivered/`"* and *"295 plans"* as the Done-when's
acceptance numbers. Measured today, 2026-09-17, in this checkout:

```
docs/plans/active/      85
docs/plans/delivered/  281
docs/plans/*.md        297
```

A Done-when naming absolute counts of a directory that changes every time a plan
is delivered will fail for the right reason on the wrong day. The byte-identical
diff of a before/after sweep is the real pin and it is already in the clause;
the numbers should be stated as *the counts measured at implementation time*,
not as 83 and 277.

**`ls -l` has one hazard the plan does not name, and it is benign here.** The
target is taken after the literal ` -> ` separator, and a filename containing
that sequence would split wrong. Measured: zero plan filenames on this estate
carry any character outside `[A-Za-z0-9._-]`, and the slug generator cannot
produce one. Worth one sentence in the design so the next reader does not have
to re-measure it. Confirmed benign: an empty index dir prints `total 0` and
exits 0; a missing one exits 1 to stderr, which the existing `[ -d ]` guards
already cover.

## What I am not objecting to

The measurement discipline is unusually good and I checked rather than assumed:
the 840x fork-to-iteration ratio, the refusal to accept "build an index" as the
spec because a per-link index is still 363 forks, the Notes recording two
rejected implementations that a `faster`-shaped Done-when would have passed, and
the explicit retraction of the earlier board-latency attribution. That last one
is verified — `grep symlinked_from` returns nothing in `plot-fleet-scan.sh`.

## Position

Position: amend

Amend before approving:

1. Bring `:1104` (section 4) into the slice, and change the Done-when from
   *"`symlinked_from` has no remaining caller"* to *"no site in the scan forks
   per index link"* — a clause that catches the inlined copy.
2. Restate the 83/277/295 pins as *measured at implementation*, keeping the
   before/after byte-identity diff as the binding gate.
3. Name the ` -> ` split assumption in the design, with the measurement that it
   is safe on this estate.

None of the three changes the plan's shape or its argument. Built as written it
is correct and it leaves 170 forks and a second implementation behind.

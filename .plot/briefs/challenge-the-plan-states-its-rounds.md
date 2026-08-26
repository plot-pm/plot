## Implementation brief — the-plan-file-states-what-the-board-shows (wave Written)

- **Plan (canonical):** `docs/plans/2026-08-26-the-plan-file-states-what-the-board-shows.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session (2 rounds)
- **Branch:** `infra/challenge-the-plan-states-its-rounds` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. `Stated` teaches `plot-plan-meta.sh` to READ the field; this wave
teaches the skill to WRITE it. Land `Stated` first — a field nothing reads is
inert, and its tests are what prove the format.

### What to build

`skills/challenge-the-plan/` Phase 5b sets `- **Rounds:** N` in the plan's
`## Status`, from **the same incremented value** it writes into the
`CHALLENGE-THE-PLAN-METADATA` block, in the same step.

This is a prose edit to `SKILL.md`. There is no code: the skill instructs an
agent, and Phase 5b already specifies the block's read-modify-write in that
register. Extend it; do not restructure it.

### THE CONSTRAINT THAT MATTERS MOST

**The write is replace-or-insert-after-`Impl:`, and touches nothing else.**

Until now Phase 5b has only replaced an HTML comment at the FOOT of a file,
where a bad regex damages nothing. `## Status` holds `Phase:`, `Type:` and the
`Approved:` / `Started:` / `Delivered:` / `Released:` transition records — facts
**nothing in this repo can reconstruct**. A greedy match there destroys history.

Exactly two behaviours, and no third:

- a `- **Rounds:**` line exists → replace **that line**
- it does not → insert one immediately after `- **Impl:**`

Never a rewrite of the section. Never a reflow. Never an insert computed from a
line number — plans differ in how many optional fields they carry.

**Insert-only was considered and REJECTED in the plan.** It is safer still, but
the field would freeze at `1` and never record a second round, which is the
whole fact being stated. Do not re-propose it.

### The decisions the plan settles — do not re-derive them

**One value, two destinations.** The field and the block are written from the
same incremented number in one step. That is the answer to *why will these not
drift the way the prose and the block already do* — measured on the estate:
34 plans have a count with no narrative, 7 have a narrative with no count.

**Only the repo skill.** A personal `~/.claude/skills/challenge-the-plan/`
override exists on at least one machine and records an `## Open Points` section
with no block at all. It is not Plot's to change. Edit
`skills/challenge-the-plan/SKILL.md` and nothing outside `skills/`.

**The block does not move or shrink.** It stays the skill's resumable state,
holding `questionHistory` and `categoriesCovered` across rounds. This wave adds
a second destination for one number; it removes nothing.

**Phase 5b still runs when a round changes nothing.** The skill says why: *"a
plan that reads as unexamined for having answered every question cleanly is the
exact failure this step prevents."* The field inherits that — it is written on
every round, not only on rounds that edited the plan.

### Done when

The plan's `## Done when` item 5 is this wave's specification, plus item 6.

- **Item 5** — run a round on a plan with no field: afterwards the field exists
  and the block's `"round"` **agrees with it**. Then run a second round: the
  field updates rather than freezing. Both halves, or insert-only passes.
- **Item 6** — **no plan under `docs/plans/` is modified** by this wave.
  Asserted by the diff. The 40 existing plans gain the field on their next
  interrogation and read correctly through the parser fallback until then.

Plus: `pnpm test` (it validates that every skill parses) and a skill version
bump declared in a changeset `bumps:` block — never edited by hand.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Written (Branch: infra/challenge-the-plan-states-its-rounds, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit.

### Scope guard

This branch owns `skills/challenge-the-plan/SKILL.md` and its changeset.

**Do not touch** `skills/plot/scripts/plot-plan-meta.sh` — that is wave
`Stated`, and the two must not both edit the format.

CI validates that a changeset names a real workspace package (`plot` or
`@plot-pm/board`) and that a `bumps:` block names a real directory under
`skills/`. A skill change is `'plot'` with a `bumps: skills: challenge-the-plan`
entry.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

## Implementation brief — agent-rows-line-up, wave 2 (Presentation)

- **Plan (canonical):** `docs/plans/2026-08-17-agent-rows-line-up.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #162 merged (one interrogation round)
- **Branch:** `feature/agent-rows-line-up` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The agent row becomes a **real grid** with fixed tracks, gains table semantics,
and renders the PR cell from the fields wave 1 delivered instead of searching a
sentence.

Wave 1 landed as #165, so the contract now carries:

```ts
pr: { number, url, draft: boolean,
      state: 'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' }
```

`conflicts` outranks `none` where both hold. `draft` is deliberately its own
boolean — a draft has CI like anything else.

### The measurement that produced this

A screenshot of WAITING ON YOU where no two rows agreed on where anything sits:

| Phase | Branch | PR | Age |
|---|---|---|---|
| *(none)* | `feature/opus5-longhorizon-hardening` | `PR #57 green` | `22d` |
| *(none)* | `changeset-release/main` | `PR #116, no checks` | `15m` |
| `Discovery` | `idea/board-survives-its-agents` | `PR #157, draft` | `13m` |

`AgentList.tsx:586` is a flex row, and the code says so itself: *"a visual table
with no table semantics"*. Only Phase (`w-24`), Age (`w-10`) and the menu
(`w-5`) have widths; Plan and Branch are content-sized, and `ml-auto` on the
note shoves everything from there to the right edge. So the slack collects
*between* branch and PR, and the branch starts wherever the plan cell before it
happened to end.

### Six decisions the plan settles — do not re-derive them

**The tracks:**

```
grid-cols-[6rem_10rem_1fr_9rem_2.5rem_1.25rem]
           phase plan  branch pr  age  menu
```

The branch takes `1fr` — it is the longest and most variable value and the one
worth reading in full.

**Overflow elides the MIDDLE, keeping both ends.** Branch names here share long
prefixes and differ at the tail: `feature/opus5-hardening-…` covers six
branches, so end-truncation would render all six identically — which reads as
duplicate rows rather than as truncation. Middle-elision keeps the prefix that
says *what kind of work* and the suffix that says *which one*; `title` carries
the full value.

**An empty cell leaves a gap, not a shift.** That is the whole point: a row with
no phase aligns with one that has a phase, and a row whose plan name sits in the
group heading aligns with one whose does not.

**Table semantics.** `role="row"` / `role="gridcell"`, with a header row carrying
`role="columnheader"` — `role="grid"` on the `<ul>`, **not** a `<table>` element,
because the rows carry interactive controls and a collapsible group structure
that table markup would fight. The `sr-only` prefix on the phase can then go: it
exists, as the code says, because *"column position conveys nothing and each row
is heard as a run of words"*, and that stops being true.

**All six waiting-groups inherit it, structurally.** `AgentList.tsx:945` maps
`GROUPS` and `:1043` renders one `<Row>` inside it — a single implementation, so
WAITING ON YOU, WORKING, WAITING ON A MACHINE, NOT STARTED, QUIET and DONE
cannot diverge. Do not add a special case for one group; a special case is how
six sections stop agreeing.

**The PR cell renders from fields, and `Note`'s `indexOf` goes.** Today:

```ts
const marker = row.pr ? `PR #${row.pr.number}` : '';
const at = marker && row.pr?.url ? row.note.indexOf(marker) : -1;
```

That is a parser for a format nobody declared — it silently drops the link the
moment the server's wording drifts. The cell now shows the git host's own PR
glyph, the number, and the state as a badge. **The icon replaces the word `PR`,
never the state**: the repo's rule is *symbol AND word*, so the number stays,
the state stays as a word, and the glyph gets an `aria-label` since a bare `157`
announces nothing. Inline SVG or a text glyph — no external asset, the artifact
stays self-contained.

**The note keeps everything a PR state cannot say** — *uncommitted work*,
*blocked by an earlier wave*, *claimed elsewhere*. It is not being replaced,
only relieved of one duty.

### Below 640px the row becomes a card

**This is what the grid takes away, so it has to give back.** Measured: the
agents tab has **zero** responsive breakpoints; its only concession to a narrow
window is `flex-wrap`, and the code says why that works — *"the rows are
flex-wrapped, so nothing depends on the position"*. Position meaning nothing is
exactly what lets a row wrap. A grid inverts that: tracks line up, and tracks
cannot wrap.

The arithmetic decides it. Fixed tracks total 460 px, gaps and padding 84 px —
**544 px before the branch column gets a single pixel**:

| Viewport | Branch column |
|---|---|
| 375 px (phone) | **−169 px** |
| 768 px (tablet) | 224 px |

So below `sm` each row becomes a small block: the branch on its own line, with
plan, phase, PR and age beneath it as one wrapped line. **Nothing is dropped and
nothing is elided** — the same facts stack instead of ranging.

Dropping columns instead was the cheaper answer and is wrong: the plan name is
precisely what `showPlanHeading` made a row's own responsibility when its group
has no heading, and removing it on a phone would re-open at one width the defect
closed at every width.

The phone is a real reader: the server detects a Tailscale address, so the board
is reachable over a private network. It is a **reading** surface there —
`/api/dispatch` is localhost-gated, so the row action menu is unavailable by
construction, which is why losing its column below `sm` costs nothing.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **Every row's branch cell starts at the same x**, with or without a phase, and
  whether or not its plan name sits in the group heading. Assert against a
  **mixed section** — the case `showPlanHeading` introduced.
- **An empty cell leaves a gap, not a shift.** The flex version cannot express
  this, so a test that only checks "the phase is absent" passes today.
- **A long branch name elides rather than pushing the PR cell**, and **the
  elision is in the MIDDLE** — assert two branches sharing a long prefix stay
  distinguishable.
- **All six waiting-groups get the same row.** Assert the grid in a group other
  than WAITING ON YOU.
- **The row is announced by column**, and the phase's `sr-only` prefix is gone
  rather than duplicated by the header.
- **The PR cell renders from fields, not from `row.note`.** Assert a note whose
  wording does not contain `PR #<n>` still produces a linked PR cell — the
  `indexOf` version silently drops the link.
- **The icon is not the sole carrier.** Assert the number and the state word are
  both present, and the glyph has an accessible label.
- **Below 640px the row is a card, and nothing is dropped.** Assert branch,
  plan, phase, PR and age all present at 375 px — the plan name in particular.
- **Above the threshold the card does not appear.** The pairing: a fix that
  renders cards everywhere passes every mobile assertion above.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present with
its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (the row, its cells and the
grid), and its tests.

**Do NOT touch the contract or `fleet.ts`** — wave 1 (#165) settled the PR
fields; you consume them.

**Do NOT add the interrogation-rounds badge** — that is wave 3
(`feature/card-shows-interrogation-rounds`), which rebases onto you and touches
`schema.ts` and `PlanCard.tsx`.

**One other branch is in flight:** `bug/acting-buttons-pin-the-double-click`,
editing `StartWorkButton.tsx` and `ApproveButton.tsx`. Those render *inside* a
row but are separate files — no overlap except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff.**

**Note on whole-object test expectations:** on 2026-08-17 a branch failed CI
because a sibling had added one field and a `toEqual` against a hand-written
fixture did not know about it — `merge-tree` compares lines, not expectations.
If you add a contract-shaped fixture, prefer asserting the fields you care about
over the whole object.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

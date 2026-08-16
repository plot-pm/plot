## Implementation brief — working-rows-show-motion (wave 2: Density)

- **Plan (canonical):** `docs/plans/2026-08-16-working-rows-show-motion.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #145 merged (two interrogation rounds)
- **Branch:** `feature/agent-groups-collapse` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`working-rows-pulse`) merged as #148 — the pulsing dot is on `main`, so
read the current `AgentList.tsx` rather than assuming its shape.

### What to build

Three changes to the Agents tab, all asking the same question: **how does this
view behave when you leave it open beside your work?**

**1. Group headers collapse.** `quiet` and `done` start **collapsed**;
everything else starts open. That default is not a preference — it is the
existing group order made effective. The list is already sorted
actionable-before-diagnostic, and those two are the diagnostic end. On the live
board they cost twenty rows and pushed the footer off screen.

- **The header keeps its count when collapsed.** `QUIET (7)` states plainly that
  seven rows are hidden; a collapsed header without a number reads as *nothing
  here*.
- **An empty group never collapses.** The header renders `rows.length > 0 ?
  '(N)' : hint`, so an empty `QUIET` shows *still thinking, or dead?* — that hint
  is exactly what a reader wants when there is nothing to list, and a collapse
  control on a group with nothing to hide is an offer leading nowhere.
- **A row falling into a collapsed group changes the count and nothing else.**
  No flash, no auto-expand: the pulse re-scans every five seconds, and a view
  that reopens itself mid-read moves the line under the cursor.
- **State persists in `localStorage`** — deliberately NOT the URL, even though
  `?tab`, `?lanes` and `?plan` all live there. Everything in the query string is
  worth sending to someone; `?collapsed=quiet,done` would rebuild the
  recipient's view as a side effect of "have a look at this". Collapse is
  convenience, not subject matter.

**2. NOT STARTED sorts by waiting age, freshest first.** `fleet.ts:977` sorts
every group by **commit** age and coerces a missing age to `-1`. NOT STARTED
rows have no commit — their age is `waitingDays`, from the `Approved:` record,
which the sort never consults. So every row ties at `-1` in whatever order the
scan produced.

The direction **inverts for this group only**: elsewhere old means neglected and
belongs on top; here it means *nobody wants it*, while a plan approved minutes
ago is the one still in the reader's head. Undated rows lead — they have just
arrived and have not yet been ignored by anyone. Confine the inversion: a rule
that flips direction depending on where it is applied is two rules with one
name.

**3. Row actions move into a three-dot overflow menu.** `Start work` currently
sits at the far right *after the age*, so the line reads *what · state · age ·
act*. And it is about to stop being alone — `board-becomes-operable` adds
`Approve`.

- **Only actions go in.** Navigation (plan link, branch link) stays in the row,
  where the thing is named: a `cmd`-click on a real link is worth more than a
  tidier line. The menu acts; the row shows.
- **A row with no available action renders the menu, disabled.** A deliberate
  exception to this repo's rule against greyed-out controls, and the difference
  is what a control *claims*: a dead `Start work` button lies about an action
  that does not exist here, while a dimmed three-dot menu says only *this is
  where actions would be* — true on every row. The layout argument decides it:
  with most rows having no action, rendering nothing would leave the right edge
  ragged and **moving**, since the pulse re-scans every five seconds.
- **Very dim, same width.** Available versus not is contrast, not presence.
- **It says why**, via `title`, using the row's own reason (*blocked by an
  earlier wave*, *no commit for 22 days*).
- **`aria-disabled`, not `disabled`** — the native attribute leaves the tab
  order and takes that explanation out of reach for anyone not hovering.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist
because a weaker implementation passes without them:

- **`quiet` and `done` start collapsed; every other group starts open** — assert
  both halves.
- **A collapsed header still shows its count**, and an **empty group renders no
  collapse control** and keeps its hint.
- **The state survives a reload**, and the default applies when nothing is
  stored.
- **Collapse state never reaches the URL** — assert the query string is
  unchanged by toggling.
- **Nothing collapses by itself**, and a row entering a collapsed group updates
  the count **without expanding it**.
- **NOT STARTED sorts freshest first, undated ahead of dated** — fixture with no
  date, today and six months; the current code ties all three at `-1`, so any
  order passes a test that only checks they are present.
- **No other group changes order** — assert `quiet` still leads with its oldest.
- **`Start work` is reachable only through the menu** — an implementation
  keeping the bare button beside it passes a test that only checks the action
  works.
- **The disabled menu is `aria-disabled` and focusable**, and its `title` names
  the row's own reason rather than a generic "no actions".
- **The right edge does not move** when a row gains or loses its action.
- **The footer is reachable** without scrolling past a collapsed group.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists.**

### Scope guard

`packages/board/src/app/components/AgentList.tsx`, the row sort in
`packages/board/src/server/fleet.ts`, and their tests.

**`fleet.ts` is contested.** `bug/fleet-sees-unpushed-commits` (PR #149) is
rewriting `classify()` in the same file and has not merged yet. Keep your change
there to the **sort function only** — do not touch `classify` — and rebase onto
whatever lands first.

`.gitattributes` marks the built artifact `-merge`: on a conflict there, take
either side, run `pnpm build:board`, `git add` it, continue. Do not read that
diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

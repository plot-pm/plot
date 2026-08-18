# One place for what a row can do

> Four actions, two places, no rule. *Open failing run* is an inline link, *Start work* is in the `⋯` menu, and nothing distinguishes them except which one was added first.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `bug/a-rows-actions-live-in-its-menu`
- **Delivered:**
- **Released:**

## Changelog

- Every action a board row offers is reachable from that row's `⋯` menu, so a reader looks in one place rather than scanning the row for links.

## Motivation

Reported 2026-08-18 while a row showed a CI failure: *why is "Open failing
run" not in the `⋯` menu?* Measured in `AgentList.tsx`, the answer is that
nothing says it should be.

| Action | Where it lives | Line |
|---|---|---|
| Open failing run | inline link in the row | 2419 |
| resolve conflict (dispatch) | inline, same block | ~2428 |
| Start work | `⋯` menu | 2606 |
| Approve | `⋯` menu | 2623 |

All four are things a person clicks to make something happen. Two are
found by scanning the row, two by opening a menu, and the split follows no
stated principle — it follows the order they were built in.

### What it costs the reader

**An action is only findable when its row happens to be in the right
state.** *Open failing run* renders only while `stuck.state === 'ci-failing'`,
so the route to a failing CI run exists exactly as long as the row is red
and is invisible the rest of the time. A reader who wants the last run of a
green branch has no control at all.

**The menu already lies about being empty.** It renders on `card`, so a row
with no plan card — `changeset-release/main` and
`feature/opus5-longhorizon-hardening` were both on screen — shows a `⋯`
that opens nothing. Measured on the same board: two of six rows in WAITING
ON YOU had a dead affordance.

So today a reader must learn two habits: *scan the row for links*, and
*try the menu, which may be empty*. Neither is discoverable, and both are
learned by failing.

### Why the existing rule did not prevent this

The menu's own comment states a good rule and stops short of this one:

> Each ITEM asks for what it needs, and an item whose precondition is
> missing simply is not there.

That governs **what appears in the menu**, not **what belongs in it**. An
action rendered in the row never meets the rule, because it never reaches
the menu to be tested by it. The rule is sound; its scope is one level too
small.

### Why this matters more as actions multiply

`docs/plans/2026-08-17-working-shows-the-agent.md` adds several — open a
worker's log, continue a stopped agent with an answer, open the agent
panel. Each will need a home, and with no rule each lands wherever it is
easiest to render. Four actions in two places is a nuisance; eight in two
places is a UI nobody can learn.

## Design

### Approach

**The `⋯` menu is where a row's actions live. All of them.** A row renders
state — branch, PR, verdict, age — and the menu renders what can be done
about it. One place to look, one place to add to.

This is a rule that can be gated rather than remembered: an `<a>` or
`<button>` inside a row body that is not the row's own navigation is a test
failure, not a judgement call (CLAUDE.md, *Gates Over Rules* — the test is
whether "did I follow this?" can be answered without doing the work).

### What each action becomes

| Action | Menu item | Condition |
|---|---|---|
| Open failing run | *Open failing run* | a run URL exists |
| resolve conflict | *Resolve conflict* | conflict + dispatch |
| Start work | unchanged | `canStart && dispatch` |
| Approve | unchanged | `canApprove && approve` |

**A run link should not require the row to be failing.** The condition
becomes *a run URL exists*, so the last run stays reachable from a green
row too. That is a widening this plan proposes and flags rather than
smuggles.

### The empty menu

A `⋯` that opens nothing is a control that lies. Two ways to settle it:
render no `⋯` when the row has no items, or render it disabled with the
reason. **Rendering nothing is preferred** — the row already says what it
is, and an absent control claims nothing.

This is the same rule the inline case already follows one line below the
link: *no address, so no link — and the row says why rather than rendering
a dead control.* The menu simply has not been held to it.

### What must not change

**The stuck cue stays in the row.** It is state, not an action: it points
at something being wrong, and the plan that added it was explicit that
motion is never the sole carrier. Moving the cue into a menu would hide the
signal behind a click, which is the opposite of what it is for.

The distinction is the whole design: **the row says what is; the menu says
what you can do.**

### Open Points

- [ ] Does the accessible name survive the move? The link carries
      `aria-label="Open the failing run for <branch> — <reason>"`, which
      reads correctly inline. Inside a menu already scoped to a row, the
      branch name may become noise or may be the only context — worth
      testing with a screen reader rather than deciding here.
- [ ] Should the menu show *why* an action is unavailable, or only omit it?
      Omission is honest and quiet; a disabled item with a reason teaches.
      They conflict, and the empty-menu decision above leans on the answer.
- [ ] Keyboard: the menu is `role="menu"` with `role="menuitem"` children
      but no arrow-key handling that this plan found. Moving more actions in
      makes that gap matter more, and it may deserve its own branch.

## Branches

- `bug/a-rows-actions-live-in-its-menu` — move *Open failing run* and the conflict dispatch into the `⋯` menu as items with their own conditions; render no `⋯` when a row has no items. Tests: a row with a failing run offers it from the menu and renders no inline action link; a green row with a run URL still offers it; a row with no actions renders no menu button at all; the stuck cue stays in the row. Plus a structural test asserting no interactive element is rendered in a row body outside the menu, so the next action cannot quietly land beside it. PR #224.

## Notes

Prompted by a reader asking why one action was in the menu and another was
not. The honest answer was that nobody had decided — which is the finding,
not the excuse.

Related: `docs/plans/2026-08-17-working-shows-the-agent.md` adds the log,
the agent panel, and *Continue with an answer*. Landing this first gives
each of them a home; landing it after means moving them twice.

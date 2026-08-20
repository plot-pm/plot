---
"@plot-pm/board": minor
---

board: the agent panel's facts are destinations

`BRANCH`, `PLAN` and `WORKTREE` on the agent panel were plain strings. The
board already knew what each of them was — the plan has a card, the branch has a
row, and the worktree path is the one thing on the panel that leaves the browser
— so a reader who opened the panel to understand an agent had to find each of
those by hand.

Now each is what it names:

- **BRANCH** is a button that closes the panel and scrolls to its fleet row,
  ringed with the same blue the board's highlighted card wears — one arrival
  colour across both tabs. The row gains an `id` (`agent-row-<branch>`) as the
  scroll target, the Agents-tab twin of `#plan-<slug>`. Revealing the same
  branch twice fires again (a nonce), because scrolling is idempotent and a
  second click otherwise lands nowhere.
- **PLAN** is a button that opens the plan's card, through the same
  `onOpenPlanFile` the row's plan link already uses. `panel.plan` is the plan
  FILE, which is how the board opens a card.
- **WORKTREE** offers **Copy path**, and is deliberately NOT a link. A browser
  refuses to navigate from `http://localhost` to `file://`, so a link would
  offer a move it then declines — the board's own rule for a dead PR link: an
  affordance that cannot navigate must not look like one.

The affordance degrades where it has nowhere to go. A panel whose `plan` is ""
(a plan the board never walked) leaves PLAN as plain text rather than a dead
button, and the omission rule still runs first — a fact the panel could not read
is no row at all.

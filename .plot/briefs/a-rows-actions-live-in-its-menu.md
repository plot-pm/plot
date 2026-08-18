# Brief: bug/a-rows-actions-live-in-its-menu

Implement `docs/plans/2026-08-18-one-place-for-what-a-row-can-do.md`.

Read it first. The rule came from an operator and is settled: **the row
says what IS, the menu says what you can DO.**

## The bug

Four actions, two homes, split by build order rather than principle — all
in `packages/board/src/app/components/AgentList.tsx`:

| Action | Where | Line |
|---|---|---|
| Open failing run | inline link | 2419 |
| resolve conflict (dispatch) | inline, same block | ~2428 |
| Start work | `⋯` menu | 2606 |
| Approve | `⋯` menu | 2623 |

Two costs, both measured on one board:

- *Open failing run* renders only while `stuck.state === 'ci-failing'`, so a
  green branch's last run is unreachable.
- The menu renders on `card`, so rows without a plan card show a `⋯` that
  opens nothing — two of six WAITING ON YOU rows had that dead affordance.

## What to build

Move *Open failing run* and the conflict dispatch into the `⋯` menu as items
with their own conditions. Render **no** `⋯` at all when a row has no items.

**The run link should not require the row to be failing.** Its condition
becomes *a run URL exists*, so the last run stays reachable from a green
row. This is a widening the plan proposes deliberately.

## Do not

**Do not move the stuck cue.** It is state, not an action — it points at
something being wrong, and the plan that added it was explicit that motion
is never the sole carrier. Hiding it behind a click is the opposite of its
purpose.

**Do not lose the accessible name.** The link carries
`aria-label="Open the failing run for <branch> — <reason>"`. Inside a menu
already scoped to one row, the branch name may be noise or may be the only
context. The plan flags this as an open point — decide, and say why.

**Do not make one item the fallback of another.** The existing comment at
2615-2621 explains why *Start work* and *Approve* are written as
independent items rather than if/else: if their preconditions ever overlap,
the menu should show both rather than silently pick one. Keep that shape.

## Definition of Done

- A row with a failing run offers it **from the menu** and renders no inline
  action link
- A green row with a run URL still offers it
- A row with no available actions renders **no menu button at all**
- The stuck cue stays in the row
- **A structural test asserting no interactive element is rendered in a row
  body outside the menu** — this is the gate, not the prose. Without it the
  next action lands beside the others again. Verify it fails when an inline
  `<a>` is added back.
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Coordination

`AgentList.tsx` is yours alone. Two sibling branches are in
`packages/board/src/server/fleet.ts` — the PR-cadence fix and the
freshness display. Expect a rebase; keep your diff to the component.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way today:
`stat -f` does not fail cleanly on GNU, and `/usr/bin:/bin` is not an
isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can
and **report the discovery** rather than improvising.

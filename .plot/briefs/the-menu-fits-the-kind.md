# Brief — feature/the-menu-fits-the-kind

Wave 1 of `docs/plans/2026-08-20-waiting-on-you-says-what-kind-of-waiting.md`,
and deliberately first: **two rows of three in WAITING ON YOU have no `...` menu
at all**, so today the reader has no route to any action whatever the row leads
with. The three sibling branches wait on this one.

The plan was interrogated across three rounds. Its decisions are settled — do
not re-derive them, do not widen the scope.

## What this branch does

Each kind offers its own actions in the `...` menu, and **every row in the
section has a menu**.

| Kind | Menu |
|---|---|
| Ticket | **Create plan**, **Create story**, Open on host |
| Plan | **Open**, **Approve**, **Commission design** |
| PR | **Open**, **Review**, and where checks fail: **Show failure** |
| Branch | **Open**, and per cause: **Resolve conflict** / **Show failure** |
| Release | see below — its mark is wave 2, but do not offer a reflex **Merge** |

## The settled decisions this branch must honour

**Commission design ships minimally, not as a refusal.** It creates a plan in
phase `Design` with an empty spec section. The `Design` phase landed in #259 and
nothing fills it; a menu entry that only explained why it cannot act would leave
the phase unreachable for longer. The spec/spike/tracer-bullet distinction is
left to the plan itself — do not build three variants.

**Only what the pulse already carries. No fetch on click.** The scan reports
`ci-failing` with its checks list, and `changed_paths` and the failing check
names are already on the row. Where a detail is not in the pulse, the menu
**links out to the host** rather than fetching it. A per-click fetch would put a
second cost on the data path the scan was just taken from 279 s to 20 s across
#262 and #264.

**An action that cannot act refuses with its reason on the control.** This is
the row action menu's existing rule — refuse with the reason rather than accept
and disappoint three pulses later. `StartWorkButton`'s three refusals are the
pattern to follow.

## Out of scope — each is a sibling branch

- Which fact leads the row (`the-row-leads-with-its-subject`) — including the
  `pr.state` → `pr.states` change and the release mark. **Do not touch the
  contract here.**
- The kind label replacing the tooltip (`the-kind-is-labelled-not-hovered`)
- Reshaping the failure detail (`a-failure-is-shown-not-dumped`) — `Show failure`
  may open what exists today; making it structured is that branch's work

## Verify before implementing

Work specified in this estate has previously already merged. In particular
`every-action-is-in-the-menu` (on `a-held-branch-says-who-holds-it`) moves
*Create plan* **into** the menu — check whether it has landed, and if it has,
build on it rather than duplicating it.

## Tests

- a ticket offers Create plan and Create story
- a plan offers Approve and Commission design, and **Commission design creates a
  plan in phase `Design`**
- a PR with failing checks offers Show failure
- an action that cannot act refuses with its reason on the control
- **every row in the section has a menu** — the motivating defect
- no host call is added, on pulse or on click

## Definition of Done

- `pnpm test`, `pnpm run test:board` green
- `pnpm build:board` in THIS worktree, artifact committed
- changeset with a `bumps:` block — `@plot-pm/board: minor`
- `trash`, not `rm`

## Hazards

- **Use node 22:** `nvm use 22.17.1` — the default node crashes pnpm here.
- A failing board test should be re-run alone before you believe it; contention
  starves tests rather than breaking them. Wait on your own PID, never `pgrep`
  by name.
- Playwright route callbacks must be synchronous; `dispatchEvent` for
  `aria-disabled` controls.
- Do not touch sibling worktrees; several are held by other agents.

# Brief: bug/the-board-says-when-it-has-not-asked

Implement the **display** branch of
`docs/plans/2026-08-18-not-yet-asked-is-not-nothing.md`.

Read it first. Reported live from two screenshots of the same board 22
seconds apart: **do not re-derive the diagnosis, do not widen the scope.**

## The bug

`WAITING ON A MACHINE — none` is printed in two opposite situations:

| Situation | Should convey |
|---|---|
| PR data fetched, nothing pending | nothing is running — proceed |
| PR data not fetched yet | I have not looked |

Measured: a board showing `PR data 22s ago` displayed `none` and no status
on any PR row. 22 seconds later, with `PR data 4s ago`, the same board
showed #57 `conflicts`, #196 `checks failing since the previous day`, #203
`CI running`. Nothing changed on the host. The operator read it as the
board having lost its state; it had not yet fetched it.

A branch with a **failing CI run since the previous day** presented as
unremarkable. That is the cost.

## What to build

**Say which clock a fact was read from.** Three states where there is one:

| State | Shown as |
|---|---|
| fetched, something pending | the rows, as today |
| fetched, nothing pending | `none` |
| **not fetched yet** | `not checked yet` |

The third is the whole branch. It is a **first-load** state, not a general
staleness display — once the host has answered, ordinary ageing is what the
footer already reports, and re-labelling every row every 60 s would trade
one misreading for a flicker.

**Evidence, not verdict.** The row says *the host has not answered yet*. It
does not estimate, does not retry-count, and never says *probably fine*.

## Do not

**Do not conflate the two clocks.** Git facts are local and current; host
facts are metered and older. The footer already reports both ages
separately (`scanned 19s ago · PR data 111s ago`) and that separation is
the point — a PR-derived field must never borrow the scan's age.

**Do not touch the PR timer.** A sibling branch —
`bug/a-refresh-that-never-fires-is-not-a-cadence` — is fixing *when*
`prAt`/`prNextAt` are set (`fleet.ts` 625-626, 639-640, 840), because the
timer and its gate share one period and a tick gets dropped. **Expect that
branch to land first or to rebase you.** Your change is what the display
does with `prAt`, never when it is stamped.

## An open point you must answer

The plan flags it: does a **failed** host call read as `not checked yet`, or
as its own state? `docs/plans/2026-08-17-an-outage-is-not-an-answer.md`
(Delivered) argues an outage must be visible as an outage — which suggests a
fourth state rather than folding it into the third. `entry.prError` already
carries the message. Decide, implement, and **say why** in the PR.

Also flagged, and yours to choose: section header
(`WAITING ON A MACHINE — not checked yet`) or per-row? The header is one
place to change and one place to miss; per-row survives a collapsed section.

## Definition of Done

- A board rendered **before the first PR fetch** must not print `none` under
  WAITING ON A MACHINE, and must not present a branch with no PR data as
  though it had been checked. Verify this fails against the unchanged code.
- After a fetch that finds nothing, `none` reads exactly as today
- A row's PR-derived fields never borrow the scan's age
- The failed-call case is decided and covered
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way today:
`stat -f` does not fail cleanly on GNU, and `/usr/bin:/bin` is not an
isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can
and **report the discovery** rather than improvising.

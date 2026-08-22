---
"@plot-pm/board": minor
---

board: a folded plan says what its branches' PRs are doing

A collapsed plan head showed its phase and nothing about the branches beneath
it, so a folded group gave a reader no reason to open it even when a PR two rows
down was red. Reported from the live board as *"Wo ist 304?"* — PR 304 was
there the whole time, under a plan row reading `Discovery` with `checks failing`
inside the fold.

The plan head now folds its branches' PR states into one worst-case word beside
the phase, with a count where more than one branch carries it. The plan stays
canonical; this is orientation.

Decided and enforced:

- **Derived inside `PlanRow`, from the `group` it receives — never at a call
  site.** `PlanRow` has two, and they are asymmetric: NOT STARTED folds
  `active`/`marked` at the call site while the `planHeads` path over wave groups
  passes neither. Computing the aggregate the way `marked` is computed would put
  it on one kind of plan head and not the other — the exact shape of a fix on
  2026-08-22 that rendered nothing. A browser test asserts the badge on BOTH
  paths.
- Precedence `conflicts > failing > pending`, quiet states silent: `green`,
  `none`, `unknown`, `closed` and a PR-less branch earn no word.
- `pending` is included, rendered in a dimmer tone than the two actionable
  states — *something is happening* against *do something*.
- The aggregate STAYS when the group is expanded, unlike the change mark beside
  it: a long group scrolls its head off screen either way.
- The phase keeps slot 5 and is never replaced — the badge rides beside it via
  `statusExtra`.
- The word comes from `prStatus`, so a fold of five says the same word a lone
  branch does for that state, colour reinforcing but never carrying it.

Client-side only: `AgentRow.pr.state` was already on the wire.

<!--
bumps:
  skills:
    plot: minor
-->

---
'@plot-pm/board': minor
---

board: an approved plan's head offers Implement and Dispatch

An approved plan with eligible work (`phase === 'Development'` and
`waveSummary.eligible > 0`) now offers two new controls on its plan-head row:

- **Implement** — present but refused until wave 2 adds `/api/implement`. The
  refusal reason is visible in the title attribute, and the button has
  `aria-disabled` for accessibility.
- **Dispatch** — posts to `/api/dispatch` with NO `--max` cap, unlike Start work
  on a wave row which passes `--max 1`. This dispatches the whole plan at once.

Both controls appear in the plan-head's three-dot menu alongside the existing
Approve and Commission design (which remain available for Draft plans only).

Gate conditions:
- `isApproved(card)` — checks `card.phase === 'Development'`
- `hasEligibleWork(card)` — checks `waveSummary.eligible > 0`

Neither control appears on:
- Draft plans (only Approve and Commission appear)
- Plans with no eligible work (blocked or completed)
- Branch or wave rows (plan-level acts belong to the plan head)

Tests added in `test/integration/approved-plan-offers.browser.test.ts` covering
all gate conditions and accessibility requirements.

From plan: docs/plans/2026-08-22-an-approved-plan-offers-its-two-starts.md (wave 1)

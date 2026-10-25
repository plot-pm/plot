---
"@plot-pm/board": patch
---

Three Delivery-tab browser tests could pass under both correct and buggy behaviour: `delivery-filters.browser.test.ts` checked for the word "hidden" without asserting the count, `unplanned-issues.browser.test.ts` asserted an absent row without a fixture proving it would render if unfiltered, and `sprint-switch.browser.test.ts` asserted a `data-sprint-hidden` attribute no component writes. All three now assert the real DOM state, each confirmed to fail against the prior fixture by reverting the matching source behaviour locally. `unplanned-issues.test.ts`'s `jiraFixture` wrapper now pins `PLOT_REPO_ROOT` so its config answer no longer depends on ambient CWD. `FilterOption` is no longer declared twice — `filters.ts` now imports the one definition from `@plot-pm/domain`. `TicketPhase.order` is removed: nothing read it, and `waitingTickets` was never meant to sort by it.

<!--
plan: docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md
bumps:
  skills:
    plot: patch
-->

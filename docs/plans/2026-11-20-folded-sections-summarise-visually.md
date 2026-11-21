# A folded Delivery section shows what it holds in counters and bars

> A folded Delivery section shows a visual summary in its header line: a segment bar for Release delivery, coloured counters with an icon and a word for You, Work items and Tickets, agent circles for Fleet, near-limit chips for Machine, and one amber chip for Not placed, each computed as a domain property.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Started:** 2026-11-21, Jan Wloka, `feature/folded-sections-summarise-visually`

## Changelog

- A folded Delivery section says what it holds without a sentence. Release delivery shows a segment bar of its plans' slice states, the plan count and a red chip when a plan is blocked. You shows `● N blocks delivery`, `◆ N input` and `⑂ N unblock`; Work items shows `◷ at a gate`, `▶ being built`, `≡ queued` and the oldest wait; Fleet shows agent circles, "N working · M free" and "auto K of 4"; Machine shows `✓ load ok` and an amber chip for a limit near its end; Tickets shows assigned to me, others and unassigned; Not placed shows "N not placed".
- A zero count shows grey, never hidden.
- A folded section shows the activity spinner beside its title while a row it hides is active.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 3 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `folded-headers.html` compares the summary styles and `header-and-sections-v2.html` is the reference. The spec is canonical for everything this plan does not restate.

Today a section header answers in words and punctuation ("YOU BLOCK 1 DELIVERY · 3 TO CLEAN UP"), and folding means hiding. The spec's anti-goal: *a folded header that needs reading a sentence to understand.* This plan implements goal 3, the *Section summaries (folded)* table, and the heading spinner. It waits on plan 2, which builds the fold and the summary slot, on plan 5's Mine rule, which the summaries count through, and on plan 4's header frame, which its agreement test compares against.

## Design

### Approach

- **Summary style B** (spec call, operator accepted the v1/v2 mockups built on it): a segment bar only where the section measures progress (Release delivery), coloured counters elsewhere. A bar for You would suggest progress where there is only a to-do list.
- **The summaries:**

  | Section | Folded summary |
  |---|---|
  | Release delivery | segment bar of the release plans' slice states in the five `SLICE_STATES` (delivered, blocked, at a gate, being built, not started; `packages/domain/src/rules/slice-states.ts:9`) · "N plans" · red chip when any plan is blocked |
  | You | `● N blocks delivery` (red), `◆ N input` (amber), `⑂ N unblock` (grey) |
  | Work items | `◷ at a gate`, `▶ being built`, `≡ queued`; "oldest Nd" |
  | Fleet | agent circles coloured by state; "N working · M free"; chip "auto K of 4" (dispatch, review, verify, design) |
  | Machine | `✓ load ok`; an amber chip only for a limit past a threshold |
  | Tickets | chips: assigned to me, others, unassigned; the hidden-by-filter count; plan 7 adds `◎ N delivered by the sprint` and `⚑ N found` |
  | Not placed | one amber chip "N not placed" |

  A zero count shows grey. An unread count shows the unread form, never 0. Where a section is empty, the summary is plan 2's empty-kind mark (`sectionEmptyKind`), with the scope and the hidden count it names, so a section that the scope or Mine empties never reads as clear while rows exist out of view. The hidden count is plan 2's: it comes from the rows the section shows, not from a second ownership test. A unit test covers each section's empty summary in each scope × Mine cell below.
- **Every chip that links opens its target first.** A summary chip or count that jumps to a group or row uses plan 2's reachability rule: the jump opens the target section and group, then scrolls. No chip calls `scrollToAnchor` (`packages/board/src/app/components/DeliveryRows.tsx:20-22`) directly.
- **Domain properties, extending what exists.** The Release delivery line extends `releaseDeliveryHeader`, `headerCountParts` and `headerText` (`packages/domain/src/rules/release-plan-rows.ts:346,299,314`). The section views extend `delivery-view.ts` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`). Tickets reads its counts from `ticketsSection` (`packages/domain/src/rules/tickets-section.ts:57`); Fleet from `fleetCard` (`packages/domain/src/rules/fleet-card.ts:24`); Machine from `machineHealth` (`packages/board/src/app/lib/agent-rows/machine-health.ts`). Every count, colour state and chip is a domain or view property with a unit test. New domain code is arrow functions with factual TSDoc.
- **Scope and Mine.** The section summaries count what the sections show, so they follow both the scope selector (`DeliveryScopeKind`, `packages/domain/src/rules/delivery-scope.ts:8`: `release` or `my-sprint`) and the Mine filter, with the three modes of `DeliveryMine` (`packages/domain/src/rules/delivery-placement.ts:32`), which the board's `MineMode` (`'all' | 'mine-and-unknown' | 'mine'`, `packages/domain/src/rules/mine-mode.ts:12`) maps to through `MINE` (`packages/board/src/app/lib/agent-rows/delivery-readings.ts:143`) (operator decision, 2026-11-20). The `mine` rule of the table below is built by plan 5's first slice, `feature/mine-means-mine-or-my-plan`, in the filters (`mine-filter.ts`, `deliveryMapping`, `mineAllows`); this plan counts the rows those filters keep and decides no ownership, and its slice waits on that slice:

  | Scope | Mine `off` | Mine `mine` | Mine `strict` |
  |---|---|---|---|
  | all active sprints (`release`) | every item; the `release` scope does not narrow rows today (`delivery-scope.ts:25-27`) | an item assigned to me or whose plan is mine (`ownership` with kind `plan`, `packages/domain/src/rules/ownership.ts:304-305`), plus today's rows of unknown owner, also in no active sprint | today's narrower rule, `isMineStrict` (`ownership.ts:326`) |
  | `my-sprint` | every item of every active sprint I own | the `mine` rule, inside those sprints | the `strict` rule, inside those sprints |

  Mine applies to You, Work items, Fleet and Tickets; Release delivery reads `deliveryMapping({ ...input, mode: 'all' })` (`releaseCardsOf`, `delivery-readings.ts:571`; `releaseCards`, `packages/domain/src/rules/release-card.ts:117`), so only its scope varies. Fleet and Machine take no scope (spec *Header*: "Fleet and Machine show the whole machine in both scopes"): Fleet's `my-sprint` cells equal its `release` cells, and Machine takes neither scope nor Mine. A unit test covers each section's summary in each of the six cells.
- **My sprint with several sprints** (operator decision, 2026-11-20). Where `deliveryScope` returns several sprints, the active sprints the reader owns and selects (`delivery-scope.ts:56-65`), the summaries combine all of them.
- **The header and the summaries share their counts.** Plan 4's header reads `deliveryMapping` in mode `all` and does not change with Mine; these summaries follow Mine. Both count through the same functions (`fleetCard`, `machineHealth`, the placement's group counts). This slice owns the agreement test: a unit test asserts that `deliveryHeader`'s You, Work items and Fleet numbers equal these summaries' numbers under `MineMode` `all` over one fixture. The slice waits on plan 4's `feature/delivery-tab-has-one-header`, which builds `deliveryHeader`, so the test has its partner when it lands.
- **No new external queries.** Machine shows `headroom`, `load1`, `cores` and the host rate-limit buckets from `FleetMachineSchema` (`packages/board/src/contract/schema.ts:4475-4481`) only.
- **Heading spinner.** A folded header shows the activity spinner beside its title while any hidden row is active. Reuse `headingPace` and `groupPace` (`packages/board/src/app/lib/agent-rows/activity.ts:616,596`), which `AgentList.tsx:1555-1558` already calls for a section heading, and `ActivitySpinner` (`packages/board/src/app/lib/agent-rows/marks.tsx:21`, #3575). Extend it to Tickets and Not placed where their rows carry a pace.
- **No hidden UI.** A zero counter shows grey; no chip disappears because its count is zero, except Machine's amber limit chip, which by the spec shows only past its threshold.
- **Board tests.** Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason, as #3575 did.

### Open Questions

- [ ] The Machine threshold for the amber chip. The spec leaves it to the builder and suggests more than 50 % used.

## Slices

### Summaries

- `feature/folded-sections-summarise-visually` <!-- waits: feature/every-delivery-section-folds, feature/delivery-section-empty-kinds, feature/mine-means-mine-or-my-plan, feature/delivery-tab-has-one-header --> — the folded summary of each of the seven sections as a domain or view property with unit tests in every scope × Mine cell, no scope for Fleet and Machine, the test that `deliveryHeader` and the summaries agree under `MineMode` `all`, drawn in the summary slot plan 2 builds, a five-state Release delivery bar, zero counts grey and unread counts unread, empty summaries from `sectionEmptyKind` with their scope and hidden count, chips that jump through plan 2's reachability rule, and the heading spinner on every folded section with active hidden rows <!-- builds: sectionSummary, the folded summary of each Delivery section -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Waits on plan 2's slices `feature/every-delivery-section-folds` (the frame, the summary slot and the reachability rule) and `feature/delivery-section-empty-kinds` (the empty kind each empty summary shows), on plan 5's `feature/mine-means-mine-or-my-plan` (the `mine` rule the counted rows follow), and on plan 4's `feature/delivery-tab-has-one-header` (`deliveryHeader`, which the agreement test compares against), named in the `waits:` marker. None of those slices waits on this plan, so no cycle forms.
- Amended 2026-11-20 after panel round 1 on plans 2, 4, 5 and 7, which carried three findings here: every jump opens its target first, the bar has five slice states, and an empty or hidden count names the scope and the Mine mode.
- Plan 6 (`delivery-activity-has-three-signals`) owns the activity signals as a whole; this plan builds only the heading spinner the spec lists under the shared frame, and plan 6 waits on it.
- Amended 2026-11-20 after panel round 2 on plans 2, 4, 5 and 7: the Mine rule has one owner, plan 5's first slice, and this plan waits on it; the header-agrees-with-summaries test moved here from plan 4; Fleet and Machine take no scope; and the hidden count is plan 2's, counted from the shown rows.

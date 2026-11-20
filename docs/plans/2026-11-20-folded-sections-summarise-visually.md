# A folded Delivery section shows what it holds in counters and bars

> A folded Delivery section shows a visual summary in its header line: a segment bar for Release delivery, coloured counters with an icon and a word for You, Work items and Tickets, agent circles for Fleet, near-limit chips for Machine, and one amber chip for Not placed, each computed as a domain property.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches

## Changelog

- A folded Delivery section says what it holds without a sentence. Release delivery shows a segment bar of its plans' slice states, the plan count and a red chip when a plan is blocked. You shows `● N blocks delivery`, `◆ N input` and `⑂ N unblock`; Work items shows `◷ at a gate`, `▶ being built`, `≡ queued` and the oldest wait; Fleet shows agent circles, "N working · M free" and "auto K of 4"; Machine shows `✓ load ok` and an amber chip for a limit near its end; Tickets shows assigned to me, others and unassigned; Not placed shows "N not placed".
- A zero count shows grey, never hidden.
- A folded section shows the activity spinner beside its title while a row it hides is active.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 3 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `folded-headers.html` compares the summary styles and `header-and-sections-v2.html` is the reference. The spec is canonical for everything this plan does not restate.

Today a section header answers in words and punctuation ("YOU BLOCK 1 DELIVERY · 3 TO CLEAN UP"), and folding means hiding. The spec's anti-goal: *a folded header that needs reading a sentence to understand.* This plan implements goal 3, the *Section summaries (folded)* table, and the heading spinner. It waits on plan 2, which builds the fold and the summary slot.

## Design

### Approach

- **Summary style B** (spec call, operator accepted the v1/v2 mockups built on it): a segment bar only where the section measures progress (Release delivery), coloured counters elsewhere. A bar for You would suggest progress where there is only a to-do list.
- **The summaries:**

  | Section | Folded summary |
  |---|---|
  | Release delivery | segment bar of the release plans' slice states · "N plans" · red chip when any plan is blocked |
  | You | `● N blocks delivery` (red), `◆ N input` (amber), `⑂ N unblock` (grey) |
  | Work items | `◷ at a gate`, `▶ being built`, `≡ queued`; "oldest Nd" |
  | Fleet | agent circles coloured by state; "N working · M free"; chip "auto K of 4" (dispatch, review, verify, design) |
  | Machine | `✓ load ok`; an amber chip only for a limit past a threshold |
  | Tickets | chips: assigned to me, others, unassigned; the hidden-by-filter count |
  | Not placed | one amber chip "N not placed" |

  A zero count shows grey. Where a section is empty, the summary is plan 2's empty-kind mark and sentence.
- **Domain properties, extending what exists.** The Release delivery line extends `releaseDeliveryHeader`, `headerCountParts` and `headerText` (`packages/domain/src/rules/release-plan-rows.ts:346,299,314`). The section views extend `delivery-view.ts` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`). Tickets reads its counts from `ticketsSection` (`packages/domain/src/rules/tickets-section.ts:57`); Fleet from `fleetCard` (`packages/domain/src/rules/fleet-card.ts:24`); Machine from `machineHealth` (`packages/board/src/app/lib/agent-rows/machine-health.ts`). Every count, colour state and chip is a domain or view property with a unit test. New domain code is arrow functions with factual TSDoc.
- **Scope and Mine.** The section summaries count what the sections show, so they follow both the scope selector (`DeliveryScopeKind`, `packages/domain/src/rules/delivery-scope.ts:8`: `release` or `my-sprint`) and the Mine filter, per the spec's table:

  | Scope | Mine off | Mine on |
  |---|---|---|
  | all active sprints (`release`) | every item of every active sprint | all items assigned to me, also those in no active sprint |
  | `my-sprint` | every item of my sprint | only items assigned to me and contained in my sprint |

- **No new data sources.** Machine shows `headroom`, `load1`, `cores` and the host rate-limit buckets from `FleetMachineSchema` (`packages/board/src/contract/schema.ts:4475-4481`) only.
- **Heading spinner.** A folded header shows the activity spinner beside its title while any hidden row is active. Reuse `headingPace` and `groupPace` (`packages/board/src/app/lib/agent-rows/activity.ts:616,596`), which `AgentList.tsx:1555-1558` already calls for a section heading, and `ActivitySpinner` (`packages/board/src/app/lib/agent-rows/marks.tsx:21`, #3575). Extend it to Tickets and Not placed where their rows carry a pace.
- **No hidden UI.** A zero counter shows grey; no chip disappears because its count is zero, except Machine's amber limit chip, which by the spec shows only past its threshold.
- **Board tests.** Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason, as #3575 did.

### Open Questions

- [ ] The Machine threshold for the amber chip. The spec leaves it to the builder and suggests more than 50 % used.

## Slices

### Summaries

- `feature/folded-sections-summarise-visually` <!-- waits: feature/every-delivery-section-folds --> — the folded summary of each of the seven sections as a domain or view property with unit tests, drawn in the summary slot plan 2 builds, zero counts grey, and the heading spinner on every folded section with active hidden rows <!-- builds: sectionSummary, the folded summary of each Delivery section -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Waits on plan 2's slice `feature/every-delivery-section-folds`, named in the `waits:` marker.
- Plan 6 (`delivery-activity-has-three-signals`) owns the activity signals as a whole; this plan builds only the heading spinner the spec lists under the shared frame, and plan 6 waits on it.

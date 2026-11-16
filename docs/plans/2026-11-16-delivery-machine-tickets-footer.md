# Delivery tab: Machine, Tickets and the footer

> The Machine section reads as one line while healthy and lists only the limiting resources when strained, the Tickets section becomes the target of every triage link, and a footer line carries freshness, counts and the desks not placed behind details.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches

## Changelog

- A healthy machine shows one header line: "● healthy · load 2.1 of 10 cores · GitHub 4,210 / 5,000 left · CI queue 1". A strained machine turns the dot amber or red and lists only the resources that limit the fleet, each with its effect.
- The text "none — nothing — a machine is working" is removed.
- The **Tickets** section lists the tickets assigned to the reader with no plan, each with **Plan it ›**, and is the target of every **triage** link.
- A footer line shows how old the board read and the PR data are, with the time of the next read, the branch and plan counts, and "<n> desks not placed · details", with the desk paths behind **details**.

Board impact: changes the Machine and Tickets sections and adds a footer in `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board.

## Motivation

Plan 6 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: "5 subjects not placed" shows with absolute desk paths, "PR data 485s ago" shows as content, and the Machine section reads "none — nothing — a machine is working".

The design is canonical. This plan implements its *Machine*, *Tickets* and *Footer* sections and the third point of *Changes to the 2026-11-08 Design* (tickets become rows in the Tickets section). It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern; every slice waits on its `feature/delivery-section-header` slice.

- **Machine, healthy:** one header line and no body: the health dot, load against cores, the git host's remaining budget and the CI queue.
- **Machine, strained:** the dot turns amber or red, and the body lists only the resources that limit the fleet, as Resource · Now · Effect ("GitHub GraphQL · 0 / 5,000, resets 16:42 · PR reads use REST"). The rulings of 2026-11-10 on host freshness in `docs/plans/2026-11-08-every-work-item-and-agent-shows.md` stand: a board that has not asked the host prints no `none`, and a failed first call reads as an outage.
- **Tickets.** Header: "<n> assigned to you with no plan · <n> more unassigned · show all". Columns: Kind · Ticket · Do · Age, where **Do** is **Plan it ›**. The first rows show, then "… n more · show", one of the design's three collapsibles. The **triage** links in the tab header (plan 1) and the You header (plan 2) land here. Tickets stay unscoped: the **My sprint** toggle does not change this section (*The "My sprint" Toggle*).
- **Footer.** One line: how old the board read is, and how old the PR data is with the time of the next read ("PR data 8 min old · next read in 2 min"), each with a coloured dot; the branch and plan counts; "<n> desks not placed · details", with the list of desk paths behind **details**.
- **Readings.** Load, host budget, CI queue and read times come from readings the board and fleetd already take (*Non-goals*). Where a reading does not exist, the plan names the gap rather than adding a host call.
- **Domain first.** The health verdict, the limiting-resource list with its effects, the ticket rows and the freshness values are domain properties with unit tests.

### Done When

- A healthy machine renders one line and no body; a strained one lists only its limiting resources, each with an effect, asserted in unit tests.
- No Delivery text reads "none — nothing — a machine is working".
- Every **triage** link on the tab lands on the Tickets section, and each ticket row offers **Plan it ›**.
- The footer shows freshness in minutes with the next read time, and the desk paths show only behind **details**.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.

### Open Questions

- [ ] Which reading gives the time of the next PR read, and does one exist while no fleetd runs?
- [ ] Which control does **Plan it ›** call: the existing `idea` controller with the ticket as its source?

### Left to the Builder

- The thresholds for amber and red, within readings the machine already takes.
- The names of the new domain facts and their types, within the domain's terminology (Machine, Worker).

## Slices

### Machine line

- `feature/delivery-machine-line` <!-- waits: feature/delivery-section-header --> — the one-line healthy Machine header and the strained body of limiting resources with their effects <!-- builds: a Machine health verdict with limiting resources -->

### Tickets section

- `feature/delivery-tickets-section` <!-- waits: feature/delivery-section-header --> — the Tickets section with its header, Plan it rows and "… n more", as the target of every triage link <!-- builds: the Tickets section as triage target -->

### Footer

- `feature/delivery-tab-footer` <!-- waits: feature/delivery-section-header --> — the footer line with freshness, next read, branch and plan counts, and desks not placed behind details <!-- builds: a Delivery tab footer with freshness and details -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 5 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "machine line", "desks not placed" and "Tickets section" found no artifact of that name in the estate.

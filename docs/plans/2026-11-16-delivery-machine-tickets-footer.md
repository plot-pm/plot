# Delivery tab: Machine, Tickets and the footer

> The Machine section reads as one line while healthy and lists only the limiting resources when strained, the Tickets section becomes the target of every triage link, and a footer line carries freshness, counts and the desks not placed behind details.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** bug-fixes-2-35-0
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-tickets-section`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-machine-line`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-tab-footer`
- **Delivered:** 2026-11-19
- **Released:** 2026-11-19, v2.35.0

## Changelog

- A healthy machine shows one header line: "● healthy · load 2.1 of 10 cores · GitHub 4,210 / 5,000 left". A strained machine turns the dot amber or red and lists only the resources that limit the fleet, each with its effect. An unmeasured machine shows a grey dot and "not measured". Each dot carries its state as text too.
- The text "none — nothing — a machine is working" is removed.
- The **Tickets** section lists the tickets assigned to the reader with no plan, each with **Plan it ›**, counts the unassigned ones and lists them behind **show all**, and is the target of every **triage** link. Ticket rows leave **You** and **Work items** for it in the same change.
- A footer line shows how old the board read and the PR data are, with the time of the next read and a dot that turns amber and red as the data ages, the branch and plan counts, and "<n> desks not placed · details", with the desk paths behind **details**.

Board impact: changes the Machine and Tickets sections and the footer in `packages/domain` and `packages/board`, and adds the machine's headroom, 1-minute load, cores and host budget to the fleet payload; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 6 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: "5 subjects not placed" shows with absolute desk paths, "PR data 485s ago" shows as content, and the Machine section reads "none — nothing — a machine is working".

The design is canonical. This plan implements its *Machine*, *Tickets* and *Footer* sections and the third point of *Changes to the 2026-11-08 Design* (tickets become rows in the Tickets section). It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern; every slice waits on its `feature/delivery-section-header` slice, directly or through the tickets slice. Plan 2's `feature/delivery-you-groups` and plan 1's `feature/delivery-tab-todo-list` wait on this plan's tickets slice, so the Tickets section exists before any triage link points at it. Plan 4's `feature/delivery-fleet-plan-runs` also waits on it, because both edit the "Tickets and plan runs" block.

- **What exists.** The Tickets section and the footer exist in part: "Tickets and plan runs" (`AgentList.tsx:1499-1506`), a footer line (`AgentList.tsx:1577-1620`), and the desks-not-placed list `view.notPlaced` (`agent-rows/delivery-view.ts:183, 218-220`). The slices rework them.
- **Machine, healthy:** one header line and no body: the health dot, load against cores, and the git host's remaining budget. The dot derives from the machine's `Headroom` verdict (`packages/domain/src/entities/machine.ts:30-43, 55-60`): `clear` green with the word "healthy", `tight` amber with "tight", `starved` red with "starved", and `unmeasured` (a null `spawnCostMs`) grey with "not measured". An unmeasured machine shows the one-line form and no body, because `unmeasured` defers nothing (`dispatchDefers`, `machine.ts:115`), and its line differs from `clear` in dot and word. Load is context on the line and never the verdict.
- **Machine readings.** `Machine` already carries `loadAverage` (the 1-, 5- and 15-minute averages) and `cores` (`machine.ts:40-42`); the line shows the 1-minute value. The board payload carries none of the line's figures today (`packages/board/src/contract/schema.ts`), so the machine slice adds `headroom`, the 1-minute load, `cores` and the host budget to the payload. The board server measures through `machineSystem(context).measure` (`packages/domain/src/adapters/machine/machine-system.ts`), as fleetd does in `fleetCapForRepo` (`packages/fleet/src/server/entry/registryd-main.ts:1588-1595`), at most once per 60 s per board process, and serves the last reading to every `/api/fleet` poll. The remaining budget comes from the connector's `LimitReading` (`entities/limit.ts:59-72`), which the connector already records; the host's name comes from the connector's backend word, not a fixed "GitHub". No CI-queue reading exists anywhere, and the design forbids a new host read (*Non-goals*), so the line shows no CI queue and this plan names it as a gap.
- **Machine, strained:** the dot turns amber or red, and the body lists only the resources that limit the fleet, as Resource · Now · Effect ("GitHub GraphQL · 0 / 5,000, resets 16:42 · PR reads use REST"). The rulings of 2026-11-10 on host freshness in `docs/plans/2026-11-08-every-work-item-and-agent-shows.md` stand: a board that has not asked the host prints no `none`, and a failed first call reads as an outage. The one-line form keeps the `HostAnswer` states: `unasked` shows the host figure as not yet asked, and `unreachable` shows it as an outage.
- **Tickets.** Header: "<n> assigned to you with no plan · <n> more unassigned · show all"; the unassigned count is `waiting.unassigned` (`waiting-view.ts:91`). Columns: Kind · Ticket · Do · Age, where **Do** is **Plan it ›**. The rows are the reader's tickets with no plan, newest first; the first five show, then "… n more · show" opens the rest, one of the design's three collapsibles. **show all** opens the unassigned tickets as rows of the same form below the reader's, folded by default under the same "… n more" control. The **triage** links in the tab header (plan 1) and the You header (plan 2) land here. Tickets stay unscoped: the **My sprint** toggle does not change this section (*The "My sprint" Toggle*).
- **The ticket move.** The tickets slice moves every ticket row into the Tickets section in one change: the reader's tickets out of You › Input to the fleet (`ticket-assigned`, `delivery-placement.ts:202`) and other tickets out of Work items › Queued (`workGroup`, `delivery-placement.ts:226`). A ticket therefore shows on exactly one row at every merge. `ticket-input-to-the-fleet.browser.test.ts` changes with it.
- **Plan it ›** calls the existing `idea` controller through the control ticket rows carry today (`CreatePlanButton.tsx`, `AgentList.tsx:1535-1545`), with the ticket as its source. On Bitbucket the controller answers `tracker-unsupported` (`packages/board/src/server/idea.ts:124-125, 725`), and the button shows disabled with that reason.
- **A second press.** The button marks itself busy and ignores a click while its run is in flight (`CreatePlanButton.tsx:90-107, 207-238`). The controller refuses `already-planned` with 409 once any plan at `origin/<default>` or any open draft plan names the ticket (`idea.ts:654-675`), and also when the plans cannot be read. A press from a second view while the first run has not yet written its plan is refused by neither; the Tickets section adds no lock, and Notes names the gap. A second plan for one ticket is a Draft plan that a person can supersede.
- **Plan runs.** The "Tickets and plan runs" block also holds design and verify runs. The Tickets section holds tickets only; the runs stay in a block of their own until plan 4's `feature/delivery-fleet-plan-runs` moves them into Fleet.
- **Footer.** One line: how old the board read is, and how old the PR data is with the time of the next read ("PR data 8 min old · next read in 2 min"), each with a dot; the branch and plan counts; "<n> desks not placed · details". The readings exist: `prAgeSeconds`, `prNextInSeconds` and `prIntervalMs` (`schema.ts:4551-4590`). Where `prNextInSeconds` is null, as while no fleetd runs, the footer shows the age only ("PR data 8 min old"), with no next-read part.
- **Footer dots.** A dot's state comes from the age against the reading's own interval: green "fresh" while the age is at most one interval, amber "aging" up to three intervals, red "stale" beyond. The PR data's interval is `prIntervalMs`; the board read's is the client's poll interval, 4 s. With no interval known, the dot is grey "age unknown". Writer's call: the reading's own interval is the one figure that says when a next read was due.
- **Accessibility.** Every dot in the Machine line and the footer carries its state as visible text beside it ("healthy", "aging") and as its accessible name, so colour is never the only signal. **details**, "… n more · show" and **show all** are buttons in the tab order, open and close with Enter and Space, and carry `aria-expanded`.
- **The footer fact.** A domain fact holds the footer: its freshness entries (age, next read or none, dot state and word), the branch and plan counts, and the not-placed entry as a count with its desk paths in a separate `details` list. The line renders the count and never a path; the paths render only when **details** is opened. A unit test asserts that the line's text holds no path.
- **Readings.** Load, cores, host budget and read times come from readings the board and fleetd already take (*Non-goals*). Where a reading does not exist, the plan names the gap rather than adding a host call.
- **Domain first.** The health verdict, the dot states and words, the limiting-resource list with its effects, the ticket rows and the footer fact are domain properties with unit tests. A unit test on the Machine fact asserts that no state yields "none — nothing — a machine is working", and the browser test that shows the Machine section asserts that the text is absent.
- **Order inside the plan.** The slices run in heading order: a slice is eligible once every earlier slice has merged. The tickets slice comes first, because three siblings wait on it; the machine line and the footer follow, and the footer reworks the same bottom block of `AgentList.tsx` as the tickets slice. The footer's `waits:` marker names both earlier slices.

### Done When

Per slice, in slice order.

- *Tickets section:* every **triage** link on the tab lands on the Tickets section, and each ticket row offers **Plan it ›**, disabled with its reason on Bitbucket; the Tickets header shows the reader's count and the unassigned count, the first five rows show and "… n more · show" folds the rest, and **show all** opens the unassigned tickets as rows; no ticket row shows under You or Work items; each fold is a keyboard button with `aria-expanded`.
- *Machine line:* a healthy machine renders one line and no body, with its dot and word from `Headroom`; an unmeasured machine renders a grey dot and "not measured"; a strained one lists only its limiting resources, each with an effect; the line shows the 1-minute load; `unasked` and `unreachable` host answers show as not asked and as an outage; the host's name comes from the connector; the board measures the machine at most once per 60 s; no Delivery text reads "none — nothing — a machine is working"; each asserted in unit tests, the absent text also in a browser test.
- *Footer:* the footer shows each freshness in minutes with the next read time, or the age only where no next read exists; each dot's state follows the age against its interval, with a word beside it; the desk paths show only behind **details**, a keyboard button; each asserted on the footer fact.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- This plan's tickets slice moves every ticket row, and plan 2 waits on it. Writer's call, from the round-1 panel.

### Open Questions

- [x] Which reading gives the time of the next PR read, and does one exist while no fleetd runs? Resolved: `prNextInSeconds`; it is null while no fleetd runs, and the footer then shows the age only.
- [x] Which control does **Plan it ›** call? Resolved: the existing `idea` controller, through the control ticket rows carry today, with the ticket as its source; disabled with its reason where the controller answers `tracker-unsupported`.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Machine, Worker).

## Slices

### Tickets section

- `feature/delivery-tickets-section` <!-- waits: feature/delivery-section-header --> — the Tickets section with its header, Plan it rows, "… n more" and **show all**, every ticket row moved into it from You and Work items, and the plan runs kept in their own block <!-- builds: the Tickets section as triage target --> → #3492

### Machine line

- `feature/delivery-machine-line` <!-- waits: feature/delivery-tickets-section --> — headroom, 1-minute load, cores and host budget on the payload from a reading cached for 60 s, the one-line Machine header with its dot and word from `Headroom`, and the strained body of limiting resources with their effects <!-- builds: a Machine health verdict with limiting resources --> → #3496

### Footer

- `feature/delivery-tab-footer` <!-- waits: feature/delivery-tickets-section, feature/delivery-machine-line --> — the footer fact and line with freshness, next read, dot states by interval, branch and plan counts, and desks not placed behind details <!-- builds: a Delivery tab footer fact with freshness and details --> → #3507

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 5 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "machine line", "desks not placed" and "Tickets section" found no artifact of that name. The parts that exist are named under *What exists*.
- Named gaps, per the design's *Non-goals*: no CI-queue reading exists, so the Machine line shows none; no lock stops a second **Plan it ›** from another view while the first run has not yet written its plan.
- Amended after the round-1 panel, 2026-11-16: the dot derives from `Headroom`, the tickets slice moves every ticket row and comes first, and the footer has a named domain fact.
- Amended after the round-2 challenge, 2026-11-16: the unmeasured machine, the 1-minute load, the unassigned rows, the footer dot thresholds, the text beside every dot, the keyboard path, the second press and the footer's waits are settled.

## Open Points

Panel round 1 (unanimous `amend`: estate, contradiction, deliverable, cost). Moderation: `.plot/panels/delivery-machine-tickets-footer/panel.md`.

- [x] [Estate] The healthy Machine line needs load, cores, remaining host budget and CI queue, and the board payload carries none of them. Resolved: the machine slice adds headroom, load, cores and the host budget from existing readings; the CI queue is a named gap and leaves the line.
- [x] [Domain] The dot's verdict is `Headroom`. Resolved: the dot derives from `Headroom`, and the thresholds are `HEADROOM_THRESHOLDS` (`machine.ts:20`).
- [x] [Open Question 1] `prNextInSeconds`, `prAgeSeconds` and `prIntervalMs` exist. Resolved: settled; with no next read, the footer shows the age only.
- [x] [Open Question 2] The `idea` controller exists and refuses on Bitbucket. Resolved: settled; the ticket is the source, and the button shows disabled with the reason on Bitbucket.
- [x] [Estate] The Tickets section and the footer exist in part. Resolved: the slices rework them; plan 4's plan-runs slice owns the design and verify run rows, which stay in their own block until it moves them.
- [x] [Order] Plan 2 removes ticket rows from You and asks where the count links until this plan ships. Resolved: this plan's tickets slice moves every ticket row, and plan 2's groups slice and plan 1's to-do slice wait on it.
- [x] [Cost] "Rebuild the board artifact with each slice" contradicts `check-no-bundle-diff.sh`. Resolved: the rebuild is a local test only.
- [x] [Deliverable] Name a footer domain fact; state the test site for the absent "none" text; assert the `HostAnswer` states on the one-line form. Resolved: the footer fact holds the paths in a separate `details` list; a Machine fact unit test and a browser test assert the absent text; Done When asserts `unasked` and `unreachable`.
- [x] [Deliverable] State whether the three slices are independent after `feature/delivery-section-header`. Resolved: they are not independent and run in heading order, the tickets slice first.
- [x] [Cosmetic] The story file is absent at HEAD; the host name should come from the connector; the unassigned count exists as `waiting.unassigned`. Resolved: the story is on `main` and the link resolves once this branch merges; the host name comes from the connector; the header reads `waiting.unassigned`.

Challenge round 2, run unattended on 2026-11-16, amended the same day.

- [x] [Domain] `Machine.spawnCostMs` is null when unmeasured. Resolved: `Headroom` reads `unmeasured`, shown as a grey dot with "not measured" on the one-line form, distinct from `clear`, and asserted in the machine slice's Done When line.
- [x] [Domain] `Machine.loadAverage` holds three values. Resolved: the line shows the 1-minute value; `Machine` already carries `loadAverage` and `cores`, and the machine slice adds them to the payload, not to the domain.
- [x] [Domain] Do unassigned tickets render as rows or only as a count? Resolved: the header counts them, and **show all** opens them as rows below the reader's; "… n more · show" folds the rows past the first five.
- [x] [UX] At what age does a freshness dot turn amber and red? Resolved: amber past one interval of its reading, red past three; grey where no interval is known.
- [x] [UX] The dots carry state by colour alone, and the folds need a keyboard path. Resolved: every dot carries its state as text and as its accessible name; **details**, "… n more · show" and **show all** are keyboard buttons with `aria-expanded`.
- [x] [Edge] **Plan it ›** pressed twice, or on a ticket another session already planned. Resolved: the button ignores a click while its run is in flight, and the controller refuses `already-planned` once a plan or open draft plan names the ticket; a press from a second view before the first plan exists is a named gap.
- [x] [Order] The footer slice waited only on `feature/delivery-tickets-section`. Resolved: its marker names both earlier slices, and the machine line waits on the tickets slice, so the markers and the heading order agree.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": false},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

# Delivery tab: tickets for the release and loose ends under You

> The Delivery tab lists the tickets assigned to a person, narrows them to the target release, counts them on the release line, and shows unplanned PRs and branches under Unblock with release and delete actions.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** ship-2-32-0
- **Issue:** #3246
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Started:** 2026-11-08, Jan Wloka, `feature/people-carry-a-tracker-identity`
- **Started:** 2026-11-08, Jan Wloka, `feature/the-issue-index-reads-assignee-and-release`
- **Started:** 2026-11-10, Jan Wloka, `feature/tickets-reach-input-to-the-fleet`
- **Started:** 2026-11-10, Jan Wloka, `feature/sprint-work-records-the-ticket-it-opened`

## Changelog

- The Delivery tab lists every ticket assigned to the person under **You › Input to the fleet**, and the Sprint filter narrows the list to the tickets planned for the sprint's target release.
- The release line counts the release's tickets: closed, planned and untriaged.
- A ticket opened by sprint work carries the mark "opened by sprint".
- A PR or branch that no plan names and nobody works on shows under **You › Unblock** with release and delete actions.
- The `People` config key accepts a tracker identity per person.

Board impact: the issue index (`issues.json`) gains fields, the `People` config grammar gains a tracker identity, and the Delivery tab gains rows and counts. Rebuild the board artifact (`pnpm build:board`) with the slice that changes the board.

## Motivation

This is plan 3 of the three plans in `docs/superpowers/specs/2026-11-08-delivery-tab-design.md` (approved 2026-11-08). The design is canonical. This plan carries the part of it that today has no source: the board does not know whose a ticket is, which release a ticket belongs to, or which work opened it.

Measured on the code, 2026-11-08:

- `tracker-github.ts:158` states that the GitHub tracker names no fix version and does not model milestones, and `versionRead` answers `unaskable` there.
- `issues.json` carries the open issues of one source, with no assignee and no release.
- The `People` key maps a handle to a name only (`jwloka = Jan Wloka`). Nothing maps a handle to a tracker account.
- Nothing records which sprint work opened a ticket.
- A PR or branch that no plan names has no release or delete controller. The controller list in CLAUDE.md ("The Master Agent Uses The Controllers") names neither.

## Design

### Approach

The design spec settles the behaviour. This plan orders the work and names the seams. Plans 1 (Placement) and 2 (Row forms) of the same design own the section rule and the row forms. This plan adds readings and rows that those plans place.

1. **Identity.** `People` gains an optional tracker identity per person, for example `jwloka = Jan Wloka <jira:jan.wloka@quatico.com>`. The handle stays the GitHub login. The domain parses the form and answers "which tracker account is this handle" as a value. A person without the extension keeps today's behaviour.
2. **Reads.** The tracker port gains the assignee, the GitHub milestone and the Jira fix version. Both trackers answer one question, "which release is this ticket planned for", through the tracker connector. A ticket is planned for a release when a milestone (GitHub) or a fix version (Jira) has the release version as its name. `fleetd` writes the fields into `issues.json` through the one writer, `refreshIssueIndex`. The board makes no second read (Non-goals of the design). The index version moves with the new fields, and a reader of an older version answers *ask again*, never an empty list.
3. **Input to the fleet.** A domain rule lists the tickets assigned to the person that no plan answers, using the Mine filter's modes. The Sprint filter narrows the list to the tickets planned for the target release. A ticket that a plan answers shows through that plan only.
4. **Lineage.** The board records "opened by sprint" where sprint work opens a ticket: a review finding, a fixer, a person through the board. The record is a fact written at the moment of opening, because nothing can re-derive it later.
5. **Release line.** The release line counts the release's tickets: closed, planned and untriaged. The counts are a domain property with unit tests. The browser test proves only that the line shows them.
6. **Loose ends.** A PR or branch that no plan names and that nobody acts on shows under **You › Unblock** with the actions release, delete and plan it. Release and delete run through controllers, per "The Master Agent Uses The Controllers": a missing controller is part of this work. A delete controller refuses a branch with an open PR or an unpushed commit, and pins the tip under `refs/plot/reaped/` before it deletes, as `plot-reap.sh` does for a local branch.

Every rendered state is a domain property (CLAUDE.md, "Every rendered state is a domain property"). New domain code uses arrow functions and the vocabulary Slice, Agent, Worker.

### Settled Questions

- Plans 1 and 2 exist: `every-work-item-and-agent-shows` (#3248) and `rows-share-seven-columns-and-link` (#3249). The slices that place rows into **You** or onto the release line wait on plan 1's `feature/delivery-tab-sections`.
- The "opened by sprint" record lives in the sprint file: a line under the sprint's Notes names the ticket and the slice that opened it. Nothing is written to the tracker, and the issue index keeps bought answers only. Settled by jwloka, 2026-11-08.
- A ticket is planned for the release when any of its Jira fix versions, or its one GitHub milestone, has the release version as its name. Writer's call.
- "Release" for a loose end means giving up its claim and deleting its ref through `plot-dispatch.sh --release`, never publishing a version. Writer's call.
- The delete controller runs over HTTP and with no board, as `plot-restart-command.mjs` does. Writer's call.

## Slices

### Identity and reads

- `feature/people-carry-a-tracker-identity` — the `People` key accepts `<tracker:account>` per person; the domain parses it and answers which account a handle is <!-- builds: parsePeople, a tracker identity per handle --> → #3254
- `feature/the-issue-index-reads-assignee-and-release` — the tracker port reads assignee, milestone and fix version through the connector, and `refreshIssueIndex` writes them to `issues.json` <!-- builds: releaseOf, a ticket's planned release read through the tracker port --> → #3256

### Tickets on the board

- `feature/tickets-reach-input-to-the-fleet` <!-- waits: feature/delivery-tab-sections --> — the rule lists my unplanned tickets, and the Sprint filter narrows them to the target release
- `feature/sprint-work-records-the-ticket-it-opened` <!-- waits: feature/delivery-tab-sections --> — the board records "opened by sprint" where sprint work opens a ticket, and the row shows the mark
- `feature/the-release-line-counts-tickets` <!-- waits: feature/delivery-tab-sections --> — closed, planned and untriaged ticket counts on the release line

### Loose ends

- `feature/loose-ends-show-under-unblock` <!-- waits: feature/delivery-tab-sections --> — a PR or branch that no plan names and nobody works on shows under **You › Unblock** with its actions <!-- builds: release and delete controllers for a loose PR or branch -->

## Notes

- Source: issue #3246, "Delivery tab: tickets for the release and loose ends under You". The plan writes nothing to the tracker.
- Similar plans, all Released and none a duplicate: `my-jira-tickets-are-in-the-inbox`, `waiting-on-you-counts-tickets-as-tickets`, `tickets-follow-the-delivery-loop`, `tickets-and-stories-have-lanes`. They built the ticket inbox and ticket lanes. This plan adds the assignee, the release and the loose ends on top of them.
- Deliverable search found no existing `releaseOf` or tracker-identity parser.
- Definition of Done: `docs/definition-of-done.md`.

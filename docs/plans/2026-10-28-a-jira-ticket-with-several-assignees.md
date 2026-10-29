# A Jira ticket with several assignees reads as theirs when the reader is not first

> `accountTicketOwnership` stops at the first declared assignee, so a `tracker-account` ticket answers `theirs` or `mine` by assignee order. The defect is latent: the shipped Jira read emits at most one assignee. The fix folds every assignee as `planOwnership` folds its fields, makes `waitingTickets` use the same predicate, and makes `ownerOf` name the reader on a ticket the reader holds.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2819
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2820 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/a-jira-ticket-with-several-assignees`
- **Delivered:** 2026-10-28
- **Released:** 2026-10-29, v2.29.1

## Changelog

- The ownership rule checks every assignee of a tracker-account ticket, so a ticket's owner no longer depends on the order of its assignees. No shipped connector reports several tracker-account assignees today, so no board row changes for a Jira reader.
- A ticket with several assignees, the reader among them, names the reader as its owner in *Waiting on you* and in the Discovery ticket lanes. On GitHub, a ticket assigned to `eins78` and `jwloka` now shows `jwloka` to `jwloka`.

<!-- Board impact: none to the plan format, template, helper scripts or docs/plans layout. The change is in domain rules (`packages/domain/src/rules/ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts`, `lanes-for-reader.ts`) that the board reads; the board artifact rebuilds from `main`. -->

## Motivation

Panel round 1 on the plan PR #2812 for #2811 (`.plot/panels/2026-10-28-mine-hides-rows-with-no-known/`) found the defect, and three jurors reproduced it in probes. Panel round 1 on this plan (`.plot/panels/2026-10-28-a-jira-ticket-with-several-assignees/panel.md`) reproduced it in four more probes.

**The rule breaks its own contract.** `accountTicketOwnership` (`packages/domain/src/rules/ownership.ts:153`) returns at the first assignee whose `<prefix><account>` spelling the directory declares (`:158-163`). With `[mruepp, jan]`, both declared, it answers `theirs`; with `[jan, mruepp]` it answers `mine`. The doc comment on `ticketOwnership` (`ownership.ts:176`) says: *"Every assignee is checked; any match is `mine`."* The `host-login` arm of the same function (`ownership.ts:188-195`) follows that comment. Only the order "a declared other person ahead of the reader" changes the answer; every other order answers the same before and after the fix (testability juror: 151 of 151 ownership-related tests pass against a fixed copy).

**The defect is latent.** Jira is the only `tracker-account` lister (`packages/domain/src/adapters/tracker/tracker-listers.ts:19-22`). The Jira read builds `assignees` from the single `assignee` field (`skills/plot/scripts/plot-host.sh:5429`), so a Jira row carries 0 or 1 assignee. Measured on ewz-kus-portal on 2026-10-28: 50 open rows, 0 with two or more assignees. GitHub and Bitbucket rows do carry several assignees, but they take the `host-login` path, which already reads every assignee. No board row reaches the defect today; a future `tracker-account` source, a Jira multi-user field, or a `PLOT_JIRA_JQL` override would.

**What a reader would see.** If a source delivered `[mruepp, jan]` to reader `jwloka`:

- **«Mine» on, Delivery and Discovery:** the reader's own ticket hides. `lanesForReader` keeps a ticket through `isMine(ownedTicket(...))` (`packages/domain/src/rules/lanes-for-reader.ts:67`), the same path as the Delivery filter.
- ***Waiting on you*:** the ticket drops only when no inbox read supplies it. `waitingTickets` selects rows with `ownership === 'mine'` (`packages/domain/src/rules/waiting-tickets.ts:223`) and unions them with the inbox (`:224`); an inbox row shows whatever its ownership. With `inbox: []` and a declared reader the ticket drops.

**A second copy of the rule.** `accountMatches` (`waiting-tickets.ts:83-93`) checks every assignee, with `.handle ===` in place of `samePerson` and a raw `hostUser.trim()` in place of `comparableLogin`. It and `accountTicketOwnership` disagree on `[mruepp, jan]` today, and two copies can disagree again.

**The owner label.** `ownerOf` (`packages/domain/src/rules/ticket-lanes.ts:98-109`) names the first declared assignee and takes no reader. After the ownership fix, a `[mruepp, jan]` ticket answers `mine` but carries the label `mruepp`. On GitHub this happens today: `['eins78', 'jwloka']` answers `mine` for `jwloka` and shows `eins78`.

**Test coverage.** `waiting-tickets.test.ts:200` and `lanes-for-reader.test.ts:134-136` cover a `tracker-account` ticket with several assignees, but both put an undeclared assignee first, so the early return never fires. No test puts a declared other person ahead of the reader.

## Design

### Approach

**The fold.** `accountTicketOwnership` maps each assignee to a reading and folds them as `planOwnership` does (`ownership.ts:135-141`):

- An assignee whose `<prefix><account>` spelling is declared and resolves to the reader reads `mine`.
- An assignee whose spelling is declared and resolves to another person reads `theirs`.
- An assignee with no declared spelling, or a blank one, reads `unknown`: it neither makes a ticket `mine` nor blocks `theirs`.
- Any `mine` → `mine`; otherwise any `theirs` → `theirs`; otherwise `unknown`.

The `host-login` loop is not the model: it counts every non-matching assignee as `theirs`, which would turn `[undeclared]` into `theirs`. The doc comment on `accountTicketOwnership` (`ownership.ts:148-149`) states "any assignee" for `mine` and "none resolves to the reader and at least one declared spelling resolves to another person" for `theirs`.

**One predicate.** `ownership.ts` exports one predicate that answers whether a `tracker-account` assignee list holds the reader, and `accountTicketOwnership` uses it for its `mine` reading. `waitingTickets` calls it in place of `accountMatches` (`waiting-tickets.ts:202`), and `accountMatches` is removed. The two answers then come from one implementation.

**The owner label.** `ownerOf` takes the reader as an optional argument. Where any assignee resolves to the reader, it returns the reader's handle; otherwise it keeps today's answer (the first declared assignee, else the first as written). `waitingTickets` passes its reader at `waiting-tickets.ts:169`. `ticketLanes` builds rows with no reader (`ticket-lanes.ts:111,175`), so `lanesForReader` applies the reader's label to the rows it keeps. The label is a domain property, not a `.tsx` decision.

### Tests

Each new assertion fails on `main` and passes on the branch, except the one pin the fold decision names:

- `packages/domain/test/ownership.test.ts`, in the describe block at `:247`: `[mruepp, jan]`, both declared with email spellings → `mine`.
- `ownership.test.ts`: `[mruepp, undeclared]` → `theirs`. This holds on `main`; it pins the fold against a change that lets a trailing undeclared assignee demote `theirs` to `unknown`.
- `packages/domain/test/waiting-tickets.test.ts`: rows `[mruepp, jan]` and `[mruepp]`, `inbox: []`, a declared reader, the `JIRA` source → the `[mruepp, jan]` ticket is in `tickets` and not counted in `hidden`. This holds on both `main` and PR #2814's base: #2814 changes only the arm for an absent inbox (`inbox: undefined`).
- `packages/domain/test/lanes-for-reader.test.ts`: the `tracker-account` twin of the case at `:124`, two declared email spellings with the reader second, «Mine» on → kept.
- `packages/domain/test/ticket-lanes.test.ts` or `waiting-tickets.test.ts`: an `ownerOf` case, `['eins78', 'jwloka']` on GitHub read by `jwloka` → owner `jwloka`.

No board-unit or browser test: `packages/board/test/unit/mine-filter.test.ts` already proves the board passes through to `ownedTicket`, and no `.tsx` decides ownership.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-a-jira-ticket-with-several-assignees/panel.md`):

- [x] One bug slice, merging before #2811's `feature/mine-strict-ownership-rule` and `feature/waiting-hidden-split`.
- [x] The Motivation and Changelog call the defect latent: Jira, the only `tracker-account` lister, reads one assignee (`plot-host.sh:5429`, `tracker-listers.ts:19-22`); GitHub and Bitbucket take the `host-login` path. The rule still breaks its own contract (`ownership.ts:176`).
- [x] The fold follows `planOwnership` (`ownership.ts:135-141`). `[undeclared, declared-other]` stays `theirs`, and a test pins `[mruepp, undeclared]` → `theirs`.
- [x] One shared predicate replaces `accountMatches` (`waiting-tickets.ts:83-93`), in this slice.
- [x] `ownerOf` (`ticket-lanes.ts:98-109`) names the reader on a ticket the reader holds, in this slice. This also changes the GitHub case `['eins78', 'jwloka']`.
- [x] Tests: only assertions that fail on `main` (`[mruepp, jan]` → `mine`, *Waiting on you* with `inbox: []`, the Discovery lane twin, an `ownerOf` case), plus the `[mruepp, undeclared]` pin.

### Open Questions

- [ ] Should the Jira connector read several assignees, for example from an instance-specific multi-user field? `plot-host.sh` reads none today, and this plan does not add one.
- [ ] A reader whose host login is not the handle under which their `jira:` spelling is declared reads their own ticket as `theirs`. Should a notice name that configuration error under «Mine», as `waitingTickets` does for an unmatched spelling? Not part of this plan.

## Slices

### Ownership across assignees

- `bug/a-jira-ticket-with-several-assignees` — fold every `tracker-account` assignee as `planOwnership` does, replace `accountMatches` with the shared predicate, make `ownerOf` name the reader, and add the failing assertions <!-- builds: order-independent tracker-account ownership, one shared predicate, reader-first owner label --> → #2840

## Notes

- Source: https://github.com/plot-pm/plot/issues/2819. Found while reviewing the plan PR #2812 for #2811; filed separately so that PR stays scoped.
- Merge order: this slice merges before #2811's `feature/mine-strict-ownership-rule` and `feature/waiting-hidden-split` (plan `docs/plans/2026-10-28-mine-hides-rows-with-no-known.md`, Approved), so their tests do not pin the old answer.
- PR #2814 (`bug/an-absent-inbox-guesses-no-spelling`) edits `waiting-tickets.ts` and `waiting-tickets.test.ts`. The two share files but not a design; a conflict there is a rebase.
- Fixtures use email-shaped `jira:` spellings, as the connector emits `emailAddress` and falls back to `accountId` (`plot-host.sh:5429`).

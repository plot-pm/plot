## Implementation brief — tickets-for-the-release-and-loose (wave: Tickets on the board)

- **Plan (canonical):** docs/plans/2026-11-08-tickets-for-the-release-and-loose.md on `main`
- **Design (canonical):** docs/superpowers/specs/2026-11-08-delivery-tab-design.md, approved 2026-11-08 — read "Tickets and loose ends", second bullet
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Branch:** `feature/sprint-work-records-the-ticket-it-opened` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on `main`)

This branch is the second of three in wave "Tickets on the board". It waited on `feature/delivery-tab-sections` (#3267, merged). Its siblings `feature/tickets-reach-input-to-the-fleet` and `feature/the-release-line-counts-tickets` may run at the same time. Nothing waits on this branch.

### What to build

Nothing records which ticket sprint work opened. A ticket that a review finding, a fixer or a person through the board opens looks, on the board, like any other ticket, so no row can say "this sprint made this work for itself".

Build two halves:

1. **The record.** Where sprint work opens a ticket, write one line under the sprint file's `## Notes` that names the ticket and the slice that opened it. The line is a fact written at the moment of opening, because nothing can re-derive it afterwards.
2. **The mark.** A domain rule reads those lines and answers, for a ticket, whether this sprint opened it and which slice did. The ticket row shows the mark "opened by sprint" from that answer.

Where tickets open today (verified on `main` at dispatch, 2026-11-10):

- `packages/board/src/server/entry/verify.ts:615` — `tracker.issueOpen({ ...issue, labels: ['ai-generated'] })` opens one ticket per refuted claim of a verification. It is the one TypeScript call site of `issueOpen`. The port is `IssueOpen` / `IssueOpenOutcome` in `packages/domain/src/ports/tracker.ts`, and `IssueOpenOutcome.id` is the new ticket's identifier.
- `packages/board/src/server/entry/finding-tickets.ts` handles review-finding tickets (`TITLE_HAS = 'plot-review: findings on'`). Read it to learn whether it opens tickets or only lists them.
- The design names a third and a fourth opener, a fixer and a person through the board. Grep found no TypeScript caller for either. Report each one you cannot find, with the grep you ran, and do not invent an opener to hold a record.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The record lives in the sprint file and nowhere else.** Settled by jwloka, 2026-11-08. The alternatives were a tracker label or comment, and a field in `issues.json`. Both are refused: the plan writes nothing to the tracker ("Notes" in the plan), and `issues.json` holds bought answers only (CLAUDE.md, "A Decision Reads The Index" — *Answers, never verdicts*). A lineage fact is neither, so the sprint file keeps it. Do not add a field to the issue index and do not add a tracker write.

**Which sprint.** The sprint is the active sprint whose items include the plan of the slice that opened the ticket. `memberLineIndex` (`packages/domain/src/rules/sprint-membership.ts`) finds the member line and already refuses a plan slug that appears only under `### Deferred` or `### Scope Changes`. Use it. Do not match a slug by substring. Where no active sprint holds the plan, write no record and say so, because a record in the wrong sprint is worse than none. Where two active sprints hold it, report it and write to neither until a person says which.

**Write through a domain rule and an adapter, not a hand edit.** `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts`) is the precedent: a pure function from file content to `{ content, outcome }`, with `updated | already | missing` outcomes. Write the new function in the same shape, so the same record written twice gives `already` and a second line is never added. The sprint file is a lifecycle document: the master agent edits it through a controller, never by hand (CLAUDE.md, "The Master Agent Uses The Controllers"). Find the existing sprint-file writer this write belongs next to, and reuse its commit and push path. Do not open a second path to the file.

**Record format.** One line under `## Notes`, in the same `- <date>: …` form as the lines already there (`docs/sprints/2026-W45-ship-2-32-0.md`), and parsed back by the rule you write. Name the ticket by its tracker identifier (`#3301`, or `QKP-123` on Jira) and the slice by its branch. The parse is the contract: a test writes a line and reads it back, so the format and the reader cannot drift apart.

**Absent is not false.** A ticket with no record reads *no record*, and the mark does not show. That is not the same as "not opened by sprint": every ticket opened before this slice has no record and cannot get one. The rule answers `opened-by-sprint | no-record`, never a boolean `false`, and no screen says "opened by someone else".

**The board makes no second read of the tracker.** The row reads the sprint file through the reading the board already makes of it, and the ticket's identifier from `issues.json`. Do not call `plot-host.sh issue-list` or `issue-view`.

**Terminology is binding** (CLAUDE.md, "The Domain Package"). Write `Slice`, never `Wave`, where a slice is meant. An **Agent** is the actor and `Worker` stays machine-side. New functions are arrows: `export const f = (…) => …`. Doc comments say what an export does, its parameters and how it fails, with no history.

**Every rendered state is a domain property.** Whether the mark shows, and its wording, come from the rule. The browser test proves only that the row shows the mark.

### Done when

The plan has no `Done when` list. The specification is the design's "Tickets and loose ends" second bullet and the settled decisions above. These assertions exist because a naive implementation passes without them:

- **Write twice, one line.** Writing the record for the same ticket and slice twice leaves exactly one line (`already` on the second call). A test of the first write alone passes while the file grows a line per run.
- **Round trip.** The line the writer produces is the line the reader parses, ticket and slice both. A reader tested against a hand-typed fixture passes while the writer's real output reads as `no-record`.
- **Wrong section.** A ticket named under `### Scope Changes` or `### Deferred`, or in any section other than `## Notes`, is not a record. Use one fixture holding the identifier in all three places and assert one hit.
- **Identifier collision.** `#33` is not `#330`. A substring match passes the first fixture and marks the wrong ticket.
- **No record, no mark.** A ticket opened before this slice shows no mark and no "not by sprint" text.
- **Missing or doubled sprint.** No active sprint holds the plan: no write, and the outcome names why. Two do: no write, and the outcome names both.
- **The sprint file is the only write.** A test of the opener asserts that no tracker write other than the original `issueOpen` happens, and that `issues.json` gains no field.
- **Failed record does not undo the ticket.** The ticket exists once `issueOpen` answers `opened`. If the sprint-file write fails after it, the opener reports the failure with the new identifier and does not open a second ticket on a retry. Measured in this estate: an earlier run that asked the tracker and recorded no answer is the case `the issue may exist: …` names in the tracker adapter, so the same care applies here.

Plus: the board artifact is generated output. Do not commit `skills/plot/scripts/board/*.mjs` bundles (`scripts/check-no-bundle-diff.sh` refuses a bundle in a PR diff, and `main` builds its own). Run `pnpm build:board` only to test locally, then restore the generated paths before you push. Add a changeset for `plot` with the description FIRST and the `bumps:` block LAST, with a `plan:` line inside the block (`./scripts/check-changeset-packages.sh` refuses the other order).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite. `test:e2e` is CI's gate, not a local one.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new record rule and its test under `packages/domain/`, the call that writes the record next to `verify.ts:615` (and next to any other opener you find), the sprint-file write path, the ticket-mark mapping in `packages/board/src/app/lib/agent-rows/delivery-readings.ts`, the mark on the ticket row, and one browser test that shows the mark.

Do not touch:

- `packages/domain/src/entities/person.ts` and `packages/domain/src/rules/release-of.ts` — shipped (#3254, #3256). Call them.
- The ticket placement and the Sprint filter (`feature/tickets-reach-input-to-the-fleet`). That sibling adds the `ticket` item kind and its You case. This slice adds only the mark to a ticket row. Where the sibling has not merged, the row has nowhere to show a mark: build the rule, the writer and the mapping, state in the PR that the visible mark waits on the sibling, and do not add a second ticket item kind.
- The release-line counts (`feature/the-release-line-counts-tickets`).
- Loose PRs and branches, and the release and delete controllers (`feature/loose-ends-show-under-unblock`).
- Row forms and the seven columns (plan 2, `rows-share-seven-columns-and-link`).

Two siblings in this wave also edit `delivery-readings.ts` and `delivery-view.ts`. Keep the mark mapping in its own function so a merge conflict is a different hunk. Verified at dispatch: no remote branch of the wave's other branches exists yet.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

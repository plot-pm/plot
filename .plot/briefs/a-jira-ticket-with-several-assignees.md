## Implementation brief — a-jira-ticket-with-several-assignees

- **Plan (canonical):** `docs/plans/2026-10-28-a-jira-ticket-with-several-assignees.md` on `main`
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2820 merged
- **Branch:** `bug/a-jira-ticket-with-several-assignees` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the plot-review app, per the repo convention

This is the only slice of the plan. It merges before #2811's `feature/mine-strict-ownership-rule` and `feature/waiting-hidden-split`, so their tests do not pin the old answer. PR #2814 (`bug/an-absent-inbox-guesses-no-spelling`) also edits `waiting-tickets.ts` and its test; a conflict there is a rebase.

### What to build

`accountTicketOwnership` (`packages/domain/src/rules/ownership.ts`) returns at the first assignee whose `<prefix><account>` spelling the directory declares. With `[mruepp, jan]`, both declared, a reader `jwloka` gets `theirs`; with `[jan, mruepp]` the same reader gets `mine`. The doc comment on `ticketOwnership` says "Every assignee is checked; any match is `mine`", and the `host-login` arm follows it. The `tracker-account` arm does not.

Three changes, all in `packages/domain/src/rules/`:

1. **Fold every assignee** in `accountTicketOwnership` as `planOwnership` folds its fields: map each assignee to `mine` (declared spelling, resolves to the reader), `theirs` (declared spelling, resolves to another person) or `unknown` (no declared spelling, or blank); any `mine` gives `mine`, else any `theirs` gives `theirs`, else `unknown`. Update the doc comment to match.
2. **One shared predicate.** Export from `ownership.ts` a predicate that answers whether a `tracker-account` assignee list holds the reader. `accountTicketOwnership` uses it for its `mine` reading. `waitingTickets` calls it where it calls `accountMatches` (`waiting-tickets.ts`, the `candidates.some(...)` line), and `accountMatches` is deleted. Today the copy uses `.handle ===` where the rule uses `samePerson`, and a raw `reader.hostUser?.trim()` where the rule uses `comparableLogin`; the shared predicate takes the rule's spelling of both.
3. **Owner label.** `ownerOf` (`ticket-lanes.ts`) takes the reader as an optional argument. Where any assignee resolves to the reader it returns the reader's handle; otherwise it keeps today's answer (first declared assignee, else the first as written). `waitingTickets` passes its reader where it builds the row (`owner: ownerOf(row.assignees, …)`). `ticketLanes` builds rows with no reader, so `lanesForReader` applies the reader's label to the rows it keeps. The label is a domain property; no `.tsx` decides it.

The defect is latent: Jira is the only `tracker-account` lister and its read emits 0 or 1 assignee (measured on ewz-kus-portal 2026-10-28: 50 open rows, 0 with two or more). GitHub and Bitbucket carry several assignees but take the `host-login` path. The changelog says so; keep it that way.

### Decisions the plan settles — do not re-derive them

**The fold copies `planOwnership`, not the `host-login` loop.** The `host-login` loop counts every non-matching assignee as `theirs`. Copied here it turns `[undeclared]` into `theirs`, because a `tracker-account` assignee with no declared spelling is unknown, not another person. `[undeclared, declared-other]` stays `theirs`, and `[mruepp, undeclared]` stays `theirs`.

**Only the order "a declared other person ahead of the reader" changes an answer.** Every other order answers the same before and after. Measured by the testability juror: 151 of 151 ownership-related tests pass against a fixed copy. A fix that changes another order's answer is a different fix.

**The predicate is shared in this slice, not a follow-up.** Two copies already disagree on `[mruepp, jan]`; a follow-up leaves them free to disagree again.

**`ownerOf` names the reader in this slice.** After the ownership fix a `[mruepp, jan]` ticket answers `mine` but would carry the label `mruepp`. On GitHub this is true today: `['eins78', 'jwloka']` answers `mine` for `jwloka` and shows `eins78`. The slice changes that GitHub case on purpose.

**No new connector read.** Whether Jira should read several assignees (an instance-specific multi-user field), and whether «Mine» should name a login/spelling mismatch, are open questions in the plan and are not part of this slice.

**Carried-over rules.** Absent is not false: an empty or missing assignee list is `unknown`, never `theirs`. Fixtures use email-shaped `jira:` spellings, as the connector emits `emailAddress` and falls back to `accountId` (`plot-host.sh:5429`).

### Done when

The plan's `## Design › Tests` list is the specification. Each new assertion fails on `main` and passes on the branch, except the one pin:

- `packages/domain/test/ownership.test.ts`: `[mruepp, jan]`, both declared with email spellings → `mine`. Catches the early return.
- `ownership.test.ts`: `[mruepp, undeclared]` → `theirs`. Holds on `main`; it pins the fold against a change that lets a trailing undeclared assignee demote `theirs` to `unknown`.
- `packages/domain/test/waiting-tickets.test.ts`: rows `[mruepp, jan]` and `[mruepp]`, `inbox: []`, a declared reader, the `JIRA` source → the `[mruepp, jan]` ticket is in `tickets` and not counted in `hidden`. The existing cases at `:200` put an undeclared assignee first, so the early return never fires there; this one puts a declared other person ahead of the reader.
- `packages/domain/test/lanes-for-reader.test.ts`: the `tracker-account` twin of the case at `:124`, two declared email spellings with the reader second, «Mine» on → kept.
- `ticket-lanes.test.ts` or `waiting-tickets.test.ts`: `['eins78', 'jwloka']` on GitHub read by `jwloka` → owner `jwloka`.

Prove the failing side: run each new assertion against `main`'s rule files and see it fail before it passes. No board-unit or browser test; `packages/board/test/unit/mine-filter.test.ts` already proves the board passes through to `ownedTicket`.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Add a changeset for the `plot` package, description first, `bumps:` block last, with `plan: docs/plans/2026-10-28-a-jira-ticket-with-several-assignees.md`; `./scripts/check-changeset-packages.sh` checks it. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice touches no `.sh` file.

Domain style: new or rewritten functions are arrows (`export const f = (…) => …`). A TSDoc block says what the export does, its parameters, its return and how it fails — no history of the decision.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Commit message: `plot: …` is for cross-cutting changes; a domain fix takes a plain description.

### Scope guard

This branch owns `packages/domain/src/rules/ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts`, `lanes-for-reader.ts` and their tests under `packages/domain/test/`, plus one changeset.

In flight on the same files, verified at dispatch:

- PR #2814 `bug/an-absent-inbox-guesses-no-spelling`: `waiting-tickets.ts` and `waiting-tickets.test.ts`, the arm for an absent inbox (`inbox: undefined`). Leave that arm alone.
- PR #2829 `feature/waiting-hidden-split`: `waiting-tickets.ts`, `waiting-tickets.test.ts`, plus board files. It merges after this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

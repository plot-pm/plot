## Implementation brief — jira-ticket-stays-in-the-inbox (wave 1: Fix)

- **Plan (canonical):** `docs/plans/2026-10-23-jira-ticket-stays-in-the-inbox.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2430 merged
- **Branch:** `bug/jira-key-leaves-the-inbox` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

In ewz-kus-portal (`Tracker: jira`, `Ticket prefixes: EWZKUS`) three Approved plans carry `Issue: EWZKUS-<n>`. `/api/board` shows `"issues": ["EWZKUS-3893"]` on each card, yet `tickets.open` still lists `EWZKUS-3893`, `-3894` and `-3895` with no plan link. A ticket named by an open plan must leave *Waiting on you* (or show its plan's phase), as `#<n>` does for a GitHub issue. The plan is canonical; this is orientation.

### What the plan settles — do not re-derive

**The parse side is not the suspect.** `plot-plan-meta.sh:605` extracts `[A-Z][A-Z0-9]*-[0-9]+` whenever `Tracker:` is `jira` or `linear` (first token, lowercased, `:351-362`), and the card payload proves the key arrives. `issueKey` (`packages/board/src/contract/schema.ts:3448`) is `String(n)`, so it does not normalise either side. Start at the inbox side: `ticketPlansOf` and `referencedIssues` (`packages/board/src/server/fleet.ts:1498`, `:1578`) key plans by `issueKey(n)`, and `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts:148`) looks rows up with `plans.get(row.number)`. Compare the string a Jira row carries in `number` with the string the plan side stores. This is a hypothesis; the plan's open question is which of the domain rule, the plan-to-issue index and the `Issue:` parse fails, and the first commit must answer it with a failing test before any fix.

**The comparison becomes a domain property.** Normalise both sides to one key form (`#12` for GitHub, `PREFIX-12` for a tracker key) in `packages/domain`, and assert it in a unit test. A fix made only in `fleet.ts` is the board deciding, which the layering rule refuses.

**Neighbours to check, each with a test:** a plan naming several keys (`EWZKUS-1, EWZKUS-2`); a key whose prefix is not in `Ticket prefixes`; a Draft plan PR's `Issue:` (see `2026-10-17-a-planned-issue-shows-its-plan.md`); case — the parser matches uppercase only, so decide and test what a lowercase key does. Do not widen the parser: it refuses `WONT-FIX`-shaped words on purpose.

**Invariants carried over:** absent is not false — a `null` plan read (`ticketPlansOf` returning `null`) declines to answer and never means "no plan names anything"; the inbox must not surface every ticket as unplanned on a failed read. `allReleased([])` is `false`.

### Done when

The plan's `## Slices` line is the specification: a tracker key in `Issue:` marks the ticket planned, with a domain unit test and one browser test of the inbox. Lifted assertions:

- **A fixture with `Issue: EWZKUS-1` and an open row `EWZKUS-1`** asserts the row is planned. A GitHub-only fixture passes without the fix, so this one must fail before it.
- **The browser test seeds a Jira-sourced `issues.json`** and asserts the ticket is absent from the unplanned rows or shows the plan's phase; a unit test alone does not prove the badge shows it.
- **A GitHub `#<n>` fixture still passes** unchanged.

Plus: a changeset (`@plot-pm/board` or `plot`, description first, `bumps:` last), and `pnpm build:board` only to test locally, never committed (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this fix needs no shell, and if you touch a `.sh` file, pay for the growth in the same change.

New domain functions are arrow functions (`export const f = …`); TSDoc states behaviour, not history.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to the branch line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owns: `packages/domain/src/rules/waiting-tickets.ts`, `ticket-phase.ts` (or a new rule beside them), the matching tests, the plan-to-issue derivation in `packages/board/src/server/fleet.ts`, one browser test, and a changeset. No change to the plan format, the template or `issues.json`. Other branches in flight on these files: none known at dispatch; run `/plot-pulse` to confirm. If you find something the plan did not anticipate, report it rather than improvising outside scope.

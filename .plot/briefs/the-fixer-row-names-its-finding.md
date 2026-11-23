## Implementation brief — the-fleet-fixes-every-red-or-conflicting-pr (wave 3: Board)

- **Plan (canonical):** `docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3597 merged
- **Branch:** `feature/the-fixer-row-names-its-finding` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waits on wave 2, `feature/the-fixer-merges-the-base-into-a-conflicting-pr`, which merged as #3603: the `conflict` finding (`{ kind: 'conflict', head, baseTip }`) is in `packages/domain/src/entities/fixer-attempts.ts` on `main`. Nothing waits on this wave. Wave 4, `feature/the-review-reads-the-fixer-scope`, waits on wave 1 only and touches `reviewPrNext`, not these files.

### What to build

A fixer that merges the base into a conflicting PR runs on a PR whose CI is green and whose review is clean. The Delivery row cannot say so today: `agentRowFactsOf` infers the finding from the PR's state (`packages/board/src/app/lib/agent-rows/delivery-row-facts.ts:158-159`, `ci === 'failed'` gives `'ci'`, `review === 'high'` gives `'high'`), so that run shows the bare word "fixing". The fixer's own attempt record already knows the kind, and `roleRuns` already reads it to count the attempt (`packages/domain/src/rules/agent-roles.ts:93-104`, `fixerAttemptsSpent(record, current.finding.kind)`). Carry that kind to the row:

1. **Domain.** `RoleRun` (`agent-roles.ts:10`) gains `finding?: 'high' | 'ci' | 'conflict'`, set on a fixer run from `current.finding.kind`, absent on every other role. Take the type from `FixerFindingSchema`'s kind, not a second literal list.
2. **Contract.** `RoleRunSchema` (`packages/board/src/contract/schema.ts:4495`) gains the same field, optional, with the doc line `attempt` has: absent from an older server and from every other role. `readRoleRuns` in `packages/board/src/server/fleet.ts:8798` returns `roleRuns(...)` unchanged, so the server needs no edit; verify that by reading it, do not assume.
3. **Row facts.** `agentRowFactsOf` (`delivery-row-facts.ts:~118`, beside `if (run?.attempt !== undefined) facts.fixerFinding...`) reads `run.finding` first. Where it is absent, the PR-state inference stays exactly as it is, for an older server.
4. **Form.** `fixerFinding` (`packages/domain/src/rules/delivery-row-form.ts:165`) gains `'conflict'`. The By cell (`delivery-row-form.ts:635`) shows `fixing conflict ✗` for it, and keeps the `· attempt N of 2` suffix it already appends.

### Decisions the plan settles — do not re-derive them

**The row reads the run, not the PR.** Inferring "conflict" from `row.pr.mergeable` is the obvious shortcut and it is wrong: the row's PR reading and the fixer's attempt are read at different instants, so a run that started on a conflict shows the wrong word the moment GitHub's `UNKNOWN` window opens after a base move. The attempt record is the one fact that says what this run was started to fix. The PR-state inference survives only as the fallback for a server that sends no `finding`.

**Order of precedence is run, then inference.** A run with `finding: 'conflict'` on a PR whose CI is also red shows `fixing conflict ✗`, because `conflictArm` runs before `ciRedArm` and a red CI on a conflicting head is not a finding (GitHub runs no `pull_request` checks on a conflicting merge ref).

**`FIXER_ATTEMPTS_VERSION` stays 1.** Do not bump it and do not add a migration. An older board reading a record that holds the `conflict` arm sees it as unreadable and hides that run silently; the plan accepted that. Do not widen the slice to fix it.

**Every rendered state is a domain property** (`CLAUDE.md`, *The Layering Rule*). The wording `fixing conflict ✗` is decided in `delivery-row-form.ts`, not in a `.tsx` file. The browser test only proves it is seen.

Rules carried over unchanged: absent is not false — a run with no `finding` must render exactly as it does on `main` today, with no default word; and do not rename `Wave` to `Slice` in code you touch, but add no new `Wave` names.

### Done when

The plan's slice 3 *Tests* list is the specification:

- a unit cell per kind (`high`, `ci`, `conflict`) for `roleRuns` in `packages/domain/test/agent-roles.test.ts`;
- a unit cell per kind for the cell's wording in `packages/domain/test/delivery-row-form.test.ts`, with and without the attempt suffix;
- a cell for a run with no `finding`, in both places — it keeps today's output;
- `packages/board/test/unit/delivery-row-adapter.test.ts` (the panel named it): `agentRowFactsOf` with `run.finding = 'conflict'` on a green, clean PR yields `fixerFinding: 'conflict'`; with `run.finding` absent and `ci === 'failed'` it still yields `'ci'`;
- one browser test that the row shows `fixing conflict ✗`; put it in an existing integration file beside the fixer-row tests (`a-fleet-row-shows-its-role-chip.browser.test.ts` or `agents-tab.browser.test.ts`) rather than a new file that starts a new server.

The assertion that exists because a naive implementation would pass without it: a conflict run on a green, review-clean PR. Reading the PR state alone cannot produce `fixing conflict ✗` there, so this cell fails if step 3 is skipped.

Plus: the schema change touches `packages/board`, so run `pnpm build:board` locally to test and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for `@plot-pm/board` with the description first and the `bumps:` block last; name the plan on a `plan:` line inside the block. Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` needs nothing from you.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Board` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/agent-roles.ts`, `packages/domain/src/rules/delivery-row-form.ts`, `packages/board/src/contract/schema.ts`, `packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`, their tests, and one changeset.

The panel's round-1 builder notes (`.plot/panels/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr/panel.md`) list one more slice-3 duty that the slice line above does not name: every hold reason (`person-pushed-recently` with the time left, `hands-off`, `repair-owned`, `base-out-of-scope`, `conflict-attempted`, `owner-unread`) reaching the run log and the Delivery row as a row property. That is a separate mechanism from `RoleRun.finding` and it depends on what waves 1 and 2 record. Do not build it inside this PR. Report in the PR body whether a hold reason is already persisted anywhere the board can read, so a person can cut it as its own slice.

Other branches in flight: wave 4 (`feature/the-review-reads-the-fixer-scope`) edits `packages/domain/src/rules/slice-pr-next.ts` and `packages/fleet/src/shared/auto-review.ts`; neither is in this branch's scope, so no collision is expected.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

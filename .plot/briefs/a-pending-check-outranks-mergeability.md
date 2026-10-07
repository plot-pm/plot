## Implementation brief — the-board-reads-a-pr-while-its-ci-runs (wave 1: A pending check outranks mergeability)

- **Plan (canonical):** `docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-pending-check-outranks-mergeability` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Wave 1 of 3. Waves 2 (`bug/a-pending-check-is-asked-again`) and 3 (`bug/a-pr-fetch-older-than-the-branch-reads-unknown`) wait on this one: the plan runs slices in heading order, and both change readings that this slice's rule consumes.

### What to build

A new domain rule, `prRowPlacement(readings)` in `packages/domain/src/rules/pr-row.ts`, answers which group an open PR's row belongs to and what its note says. `classifyGroup` stops deciding the order itself and calls the rule.

The failure this fixes (#1164), observed 2026-10-02 on #1157 and #1159: a PR whose CI is running reads WAITING ON YOU. GitHub answers `UNKNOWN` for `mergeable` while it recomputes after every push, which is exactly when CI starts. `classifyGroup` returns `waiting-on-you` for any `pr.mergeable !== 'mergeable'` (`packages/board/src/server/fleet.ts:4978`) before it reaches the `checks: 'pending'` arm (`:4987`). An operator is sent to a row that needs nothing from them.

Only one row of the plan's table changes behaviour: `mergeable` unknown or absent with `checks: 'pending'` moves from waiting on you to waiting on a machine, note `PR #n, CI running`. `conflicting` still wins over any checks. Every other row keeps today's group and wording. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The conflict outranks the checks, and the pending check outranks unknown mergeability. Do not flatten this into "pending first".** The plan's table has `conflicting` + `pending` answer waiting on you. A conflicting PR reports an empty rollup, and the comment at `fleet.ts:4950-4958` records that GitHub starts no workflow for a branch that does not merge. A rule that reads `pending` first would move conflicting rows too. Test it.

**`!== 'mergeable'`, not `=== 'unknown'`.** An absent `mergeable` (an adapter predating the field) must behave as `unknown`. `fleet.ts:4975-4977` and `prStates` (`:6069`) already hold this line. Keep it in the rule.

**A green draft keeps its fall-through.** `case 'green': if (pr.draft) break;` (`fleet.ts:5001`) means a green draft is not waiting on you. The plan says this does not change. Carry it over unchanged.

**The rule takes readings as values, not a `PrRecord`.** `CLAUDE.md` (*The Domain Package*) says the domain takes readings, and `draft-placement.ts` is the sibling to copy: a `readonly` readings interface, a discriminated result, TSDoc that says what the export does and how it fails, no argument. Arrow function (`export const prRowPlacement = (…) => …`). The reasoning goes in the commit message, not in comments (measured 2026-08-29: 28 lines of code carrying 109 lines of comment in the first rule moved).

**Four places spell the same precedence today. Use the rule in each, or the row's word and its sentence will disagree.** The plan names two (`classifyGroup`, `prState`). The measured count on `main` is four:

- `classifyGroup`'s PR arm, `fleet.ts:4960-5003` — decides the group and the note.
- `prEvidence`, `fleet.ts:4455-4467` — a nested ternary with the same order, used at `:4914`.
- `draftNote`, `fleet.ts:5930-5946` — the same order again, for drafts (also called at `:7540`).
- `prStates`, `fleet.ts:6069-6085` — the word. It returns `['unknown']` for any non-`mergeable`, non-`conflicting` record, so `unknown` + `pending` reads `unknown` while the group says CI running.

Read all four before writing the rule. The plan's Done-when requires that `classifyGroup` and `prState` "agree on every row of the table", and that cannot hold if `prEvidence` or `draftNote` still say *cannot say whether it merges* for a row `classifyGroup` files under a machine. Decide per site whether the rule's note replaces the sentence or the site calls the rule for its group only, and say which in the PR. If a draft with `unknown` + `pending` changes its note, that is a behaviour change outside the plan's table — report it rather than choosing silently.

**Rules carried over unchanged.** An absent answer is not a false one: absent `mergeable` is `unknown`, absent `checks` is not `green`. A missing field never moves a row toward a quieter group. No `CLOSED` arm: `byHead` is open-only, so a closed PR never reaches this arm (`fleet.ts:4942-4947`).

### Done when

The plan's `## Done when` list is the specification. The items that exist because a naive implementation would pass without them:

- `unknown` + `pending` answers waiting on a machine, and `conflicting` + `pending` answers waiting on you — both in one test file. A rule that checks only `pending` first passes the first and breaks the second.
- Absent `mergeable` + `pending` answers waiting on a machine, the same as `unknown`. It catches a rule written as `=== 'unknown'`.
- `unknown` + `green` stays waiting on you. It catches a rule that treats any non-`mergeable` PR as CI running.
- A table-driven test asserts, for every row of the plan's table, that `classifyGroup`'s group and `prStates`' word agree with the rule. This is the test that fails if one of the four sites keeps its own copy.
- One browser test proves a PR row with running checks renders in WAITING ON A MACHINE. Per `CLAUDE.md` it is where the state is seen, not where it is decided; the placement itself is asserted in a unit test with no browser.
- Every test above fails on `origin/main` before the change. Run it there first and keep the failing output.

Plus: a changeset for `@plot-pm/board` (`patch`), description first and the `bumps:` block last, with `plan: docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md`. Do not edit versions by hand. `packages/domain` is arrow-function code; a new helper you write in `fleet.ts` is an arrow too, and an existing declaration you only pass through stays as it is. Do not commit `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Close the board before `pnpm test:board` (it takes the operator's board down) and run it under Node 24 (`nvm use`).

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If that changes, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), not `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/pr-row.ts` (new), its export in `packages/domain/src/index.ts`, and its test beside the other rule tests in `packages/domain/test/`.
- In `packages/board/src/server/fleet.ts`: the four sites above, and nothing else in the file.
- The board unit tests that assert these rows (`packages/board/test/unit/fleet.test.ts` and its neighbours), and one browser test.
- The changeset.

Not this branch's:

- `bug/a-pending-check-is-asked-again` owns the delta refresh (`fleet.ts:3091-3093`), the `pr-list` question and `PR_REQUESTS_PER_REFRESH`. Do not touch the `--since` window or the PR store.
- `bug/a-pr-fetch-older-than-the-branch-reads-unknown` owns `rules/quiet.ts` and `claimedReadings`/`wipReadings` (`fleet.ts:5610-5640`) and `hostUnasked`. Do not touch them.

Both other branches are unstarted at dispatch (`git ls-remote --heads origin` for each returned nothing on 2026-10-07), so a collision is possible only in `fleet.ts`, in different regions.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

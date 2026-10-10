## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 6: The board shows the new readings)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/the-board-shows-the-new-readings` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 6 of 8. Waves 1 to 5 merged (#1455, #1460, #1464, #1466, #1469): the PR index rows carry `headSha`, `checksSha` and `mergedAt`; fleetd writes `.plot/state/default-branch.json`; the channel carries the findings; the page refetches on an event. Nothing on the page shows the new readings yet. Wave 7 (the mod) and wave 8 (the merge controller) wait on nothing here and edit none of the files below.

### What to build

Two readings exist on disk and reach no reader. A PR whose checks failed shows `checks failing` and does not say which commit failed, so a reader cannot tell a stale failure from a current one. `main` can be red and the board says nothing: on 2026-10-09 the master agent found `main` red by reading a PR's failed check. Three changes:

1. **`checksVerdict` names the commit.** `ChecksReadings` (`packages/domain/src/rules/checks-reading.ts`) gains an optional `checksSha`. On the `failing` and `pending` states the `detail` ends with the short SHA (`@a048b6f`, seven characters). Where `checksSha` is absent on those two states, the `detail` says the checks are not bound to a commit. The `label` strings do not change. `green` stays silent (`checksShown`), and `none` and `unknown` keep their text.
2. **`defaultBranchStatus(reading)` in the domain.** A new rule beside `defaultBranchRed` in `packages/domain/src/rules/default-branch.ts` takes `DefaultBranchReading | null` and returns `BoardStatus | null`. It returns an entry only while `defaultBranchRed(reading)` holds, so the panel keeps its vanish-when-empty contract. `BoardStatus` (`{key, severity, text, tone}`) is declared in `packages/board/src/app/components/StatusPanel.tsx`; the domain cannot import board code. Declare the shape in the domain, make `StatusPanel.tsx` re-export or reuse it so there is one definition, and keep `AgentList.tsx`'s call sites compiling.
3. **The payload and the two places.** `/api/board` gains `defaultBranch` (the reading, or absent) and each `CardPr` gains `headSha` and `checksSha` (absent, never `''`). `PlanCard.tsx`'s `ChecksNote` passes `checksSha` into `checksVerdict`. The status panel in `AgentList.tsx` (built at `:795`) pushes the entry `defaultBranchStatus` returns.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**No new banner and no new component.** The panel (`StatusPanel`) and the badge (`ChecksNote`) already exist, and each already takes a domain-decided shape. A red `main` is one more `BoardStatus` in the list the panel already orders by severity. The plan rejected a dedicated banner because the panel's whole contract is that it vanishes when empty and orders what it holds.

**Green is silent, in both places.** `checksShown` returns false for `green` and `defaultBranchStatus` returns null for a green, pending, unknown or absent reading. A pending head after a red settled SHA still reads red: `defaultBranchRed` reads `settled` and never `head`. Do not read `reading.head`. That is the rule the queue's `default-branch-red` hold uses, and the status line and the hold must agree on the same reading. Test it with a red settled SHA followed by a pending head.

**The SHA names the commit the checks were read for, which is `checksSha`, not `headSha`.** On GitHub the two are equal. On Jenkins `checksSha` is absent because a Jenkins job colour carries no commit, and the badge must say so rather than print `headSha`. Printing `headSha` there states a binding the host never gave. Absent is not false: do not render `@` followed by nothing.

**The reading is the build connector's answer, not the PR index's.** Read it through `defaultBranchFile` (`packages/domain/src/adapters/default-branch/default-branch-file.ts`), the `DefaultBranchStore` port. Do not parse `.plot/state/default-branch.json` by hand and do not add a second reader of the PR index for it. `decodeDefaultBranch` returns null for a missing, unparseable or other-version file, and null holds nothing. The board does not write the file: fleetd is its only writer (`one-default-branch-writer.test.ts` asserts it).

**The board adds no host call.** Both readings are files fleetd already wrote. A board build that spawns, or asks the host for either, is wrong. `a-read-route-spawns-nothing.test.ts` walks the read routes; run it. Wire the store through `Estate` (`packages/board/src/server/estate.ts`) as `prIndex` is wired, with a null-returning fixture in `mockEstate`, so a test needs no repository.

**A stale reading is still shown, with its age.** The reading carries `askedAt` and `at`. Decide whether `defaultBranchStatus` takes the clock and states the age in the text (`red since 14:02, read 3 min ago`). Recommended: it takes `now` as an argument, as the throttle rule in wave 5 did, because a red `main` read an hour ago by a dead fleetd is not the same news as one read a minute ago. Do not hide a stale red; say how old it is.

**Where the status shows is settled by the code, not by the plan, and one fact needs your check.** `StatusPanel` is rendered only inside `AgentList` (the Agents tab), which receives `fleet` from `/api/fleet`. The plan puts `defaultBranch` on `/api/board`. Follow the plan: `App.tsx` already holds both payloads, so pass `board.defaultBranch` to `AgentList` as a prop. Check that the Agents tab renders the panel when the board payload has not loaded yet, and say in the PR what the reader sees in that case. If you find the panel should also show on the Board tab, report it and do not add it.

**Rules carried from earlier waves, so they are not rediscovered by breaking them:**

- Absent is not false. A missing reading is not a green `main`, and a missing `checksSha` is not an unbound PR on GitHub (the row simply predates v4). A v3 store reads as "ask the host", so the board shows the old text there.
- No `.default()` in a schema. `CardPrSchema` has `.default('')` on `url` and `author` already; the new fields are `.optional()` and stay off the card when the row has none.
- Arrow functions for everything you write, tests included. Domain code is TSDoc that states what an export does, takes, returns and how it fails, and not the history of the decision.
- A view state that cannot be asserted without a browser is a domain property that has not been extracted yet. Each decision above is a function with a unit test; the browser tests prove only that it is seen.

### Done when

The plan's wave line is the specification: each function has a unit test, each place has one browser test, and green stays silent.

The assertions that exist because a naive implementation would pass without them:

- **`checksVerdict`: failing and pending name the commit.** `checksSha: 'a048b6f…'` gives a `detail` containing `a048b6f`. Catches a `detail` that never reads the field.
- **`checksVerdict`: absent `checksSha` says unbound, on failing and pending only.** Catches a badge that prints `@undefined`, and one that adds the "not bound" sentence to `none`, `unknown` or `green`.
- **`checksVerdict`: labels and `shown` are unchanged for all five states with and without a SHA.** Catches a change to the existing labels (`checks-reading.test.ts` already holds them; run it unmodified).
- **`defaultBranchStatus`: red settled holds, green, pending, unknown, absent and null do not.** Catches a rule that reads `head` instead of `settled`.
- **`defaultBranchStatus`: red settled with a pending head still returns an entry.** Catches the same defect from the other side. The fixture needs `head: 'pending'` and `settled: { state: 'red' }` in one reading, or the two arms agree (`mutation-test-fixtures-must-make-arms-disagree`).
- **The payload: a v3 store and a missing `default-branch.json` give a board with no `defaultBranch` and no `headSha`.** Catches a board that throws, or renders `main` as green, on a cold start.
- **Browser, badge:** a card whose PR is `failing` with a `checksSha` shows the short SHA in `[data-pr-checks]`'s `title`; a card whose PR is `green` renders no `[data-pr-checks]`. Catches a place that does not call the domain function, and a green PR that gets a badge.
- **Browser, panel:** a payload with a red settled reading shows one `[data-status-panel]` entry naming the default branch; the same payload with `green` leaves the panel absent. Catches a panel that renders an empty frame.

For the browser tests: Playwright can stub `/api/board` with `route.fulfill`, so a stubbed payload is enough and no real board is needed. `stubbed-tests-start-no-board.test.ts` gates which tests may start a board; read its rule before you choose, and mark a real-board test `@needs-real-board` with the reason.

Mutation-test the gates you add: make `defaultBranchStatus` read `head`, make `checksVerdict` print `headSha`-style text when `checksSha` is absent, and drop the `checksSha` argument at the `PlanCard.tsx` call site; read the failures before you trust the tests (`mutation-test-a-gate-before-believing-its-tests`). Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. This slice touches `packages/domain/src/rules/`, `packages/board/src` and the board contract, so expect the domain and board vitest runs, `pnpm run typecheck` and the domain `tsc --noEmit` on the list. The root typecheck skips the domain package (`root-typecheck-skips-the-domain-package`), so run the domain one it prints. Do not run board tests while an operator's board is open on this machine; `pnpm run test:board` takes that board down, and `scripts/owned-run.sh` isolates the run.

**Shell-line gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

**Other gates:**

- A changeset in `.changeset/` for package `@plot-pm/board`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` inside the comment block. Run `./scripts/check-changeset-packages.sh`.
- The payload gains fields, so the board contract changes. Run the contract tests the local-checks command lists, and update `packages/board/src/contract/schema.ts` and any generated contract file together. A generated bundle is never committed: `skills/plot/scripts/board/board-server.mjs` and the other bundles are restored from the merge base before you push (`scripts/check-no-bundle-diff.sh`). A conflict in `board-server.mjs` is not read; follow *Definition of Done › Resolving a board artifact conflict*.
- The one-spawn ratchet (*One place reaches a process*, `ci.yml`) counts `spawn` and `execFile` in `*.ts`. This slice spawns nothing; the count must not grow.
- The board is first-class (`docs/definition-of-done.md`). The plan's board-impact comment already names the status panel and the PR badge. If `CLAUDE.md` says the board shows no default-branch state, edit it, run `./scripts/check-agents-md.sh --write` and confirm with `./scripts/check-agents-md.sh`. Do not edit `AGENTS.md` by hand. If nothing is false after this wave, change nothing.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Where a project board is configured, set the new PR to "Ready" with `../plot/scripts/plot-update-board.sh <pr-url> "Ready" <owner> <number>`; skip it otherwise.
- Do not edit the plan's `State:` line or any `Started:` record by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns:

- `packages/domain/src/rules/checks-reading.ts` and `packages/domain/src/rules/default-branch.ts`, their exports from the package index, and their tests under `packages/domain/test/`
- the `BoardStatus` shape (one definition) and its use in `packages/board/src/app/components/StatusPanel.tsx` and `AgentList.tsx`
- `packages/board/src/app/components/PlanCard.tsx` (`ChecksNote`) and the `App.tsx` prop that carries `defaultBranch`
- `packages/board/src/contract/schema.ts` (`BoardSchema.defaultBranch`, `CardPrSchema.headSha` and `checksSha`), the `CardPr` mapping in `packages/board/src/server/board.ts:2108`, and the `Estate` wiring in `estate.ts`
- tests under `packages/board/test/unit/` and `packages/board/test/integration/`
- the changeset

Branches in flight, verified 2026-10-10 against `git ls-remote --heads origin 'feature/*'` and `gh pr list`: no open PR touches these files. Wave 7 (`feature/a-mod-follows-the-channel`) is a separate plugin and edits none of them. Wave 8 waits on `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`), which edits `packages/fleet/build.mjs` and `packages/board/src/contract/bundles.generated.ts`; this branch edits neither.

Out of scope, owned by other waves, and not to be started here:

- Any change to the channel, `/api/events`, the IndexMonitor, the desk relay or the monitors (waves 3 to 5).
- A new finding name or a change to `READINGS`.
- The PR index schema, `pr-refresh.ts` and `default-branch-refresh.ts`: the board reads what fleetd wrote and changes none of it. If a field the page needs is not in the row, report it.
- A feed pane. The plan dropped it; the mod is the feed.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Two cases to expect: `CardPrSchema` is parsed by the page, so an older board server and a newer page (or the reverse) must both render, and absent fields must parse; and a repository with no build connector (Bitbucket) has no default-branch file, which must read as no entry and not as an error.

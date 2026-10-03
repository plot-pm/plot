## Implementation brief — a-desk-and-its-manifest-name-each-other (slice 4: A desk with no manifest says so)

- **Plan (canonical):** `docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-desk-with-no-manifest-says-so` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI plus a person reading the diff)
- **Issue:** #1101 (the row half)

This is the last slice of the plan, and it waits on nothing. Slice 1 landed `manifestDirectory` and `deskManifest`, slice 2 (#1234) landed `watchedDesk`, slice 3 (#1256) landed `loopRegistration`, all in `packages/domain/src/rules/desk-manifest.ts`. Add `unnamedDeskLabel` as a separate export and leave the four existing exports untouched.

### What to build

`synthesizeEntry` (`packages/board/src/server/registry.ts:911`, the plan's `:876-895` has moved) builds a registry entry for a desk no manifest names, and sets `branch: wt.branch`. So the board draws that desk as an agent working on the branch the desk happens to have checked out. #1101 measured it on `free-c7b58b4f` and `free-a8d68976`: the desks were between slices, no manifest named them, and the rows read as agents on a slice branch. The checkout is a fact about the desk, not an assignment of the agent.

Build four things:

1. **`unnamedDeskLabel({ checkout, live })`** in `rules/desk-manifest.ts`: the words a row shows for a desk no manifest names. It names the absence (no manifest names this desk) and the process state, as the plan says. It is a pure function with unit tests at 100% branch coverage, and it does no I/O.
2. **`synthesizeEntry` sets `branch: ''` and `checkout: wt.branch`.** `AgentEntrySchema` (`packages/board/src/contract/schema.ts:3523`) gains `checkout: z.string().default('')`, with a TSDoc line that says what it is and that no decision reads it. The default keeps a pulse from an older server valid, the rule `identity` already follows.
3. **The registry row renders the label** where a synthesized entry's name goes today. `rows.tsx:2381-2386` falls back to `agent.branch`, then to the worktree name; with `branch: ''` it reaches the worktree name on its own, so the label is an addition to the row and not a replacement of that fallback. The checkout appears only as a separate, explicitly labelled detail ("checked out `bug/x`"), never in the branch slot, the `href` slot or the `agent-row-<branch>` id (`:2465`).
4. **A board changeset**, `'@plot-pm/board': patch`.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**The row keeps rendering.** `rows.tsx:2507` already records the trade: an undeclared desk is an error row (`iconTone: 'error'`, `data-agent-undeclared`) that keeps its place, because the desk holds the work. This slice changes what the row says and leaves its kind, its tone and its existence alone.

**`checkout` is a new field, not a reuse of `branch`.** The alternative is to keep `branch` and add a flag that tells readers to ignore it. Every reader of `AgentEntry.branch` would have to remember the flag, and the readers sit in `auto-dispatch.ts`, `fleet.ts` (`handedTo`), `AgentList.tsx` and `rows.tsx`. An empty `branch` is already a real value the schema documents (*empty is a real value*, `schema.ts:3545`), and every reader already handles it.

**The rule holds the words, the component holds none.** *Every rendered state is a domain property.* The label comes from `unnamedDeskLabel` and the component prints it. A label built in `.tsx` is testable only by rendering it.

**`several` is not this slice.** A desk that two manifests name is not synthesized at all (`registry.ts:862-866` takes `kind !== 'unnamed'` as named). Leave that line as it is.

### Traps the plan does not name

**1. `branch: ''` makes a live unnamed desk FREE, and auto-dispatch hands it a slice.** `isAgentFree` (`packages/domain/src/rules/free.ts`) answers true for `state === 'running'` with `branch === ''`: *an agent between units is running with no branch and is available*. `refreshStates` gives a synthesized entry a real state, so a running desk no manifest names turns from "holds `bug/x`, busy" into "free". `freeAgents` in `packages/board/src/server/auto-dispatch.ts:213-223` counts it, `freeAgentLabels` names it `(between slices)`, and a dispatch proceeds against an agent the registry cannot even name. That is the opposite of what the slice is for. Exclude undeclared entries in `freeAgents`, the one place `isFree` is asked, using `identityWasDeclared` (`packages/domain/src/entities/agent.ts`), so the count and the names stay one answer. Do not touch `isAgentFree`: its inputs are right. `liveAgentCount` counts by state alone, so the unnamed desk keeps holding its concurrency slot; leave that. A test in `auto-dispatch`'s test file asserts a running synthesized entry is not counted free and still counts live.

**2. `liveAgentBranches` and `handedTo` stop naming the checkout, and that is intended.** `liveAgentBranches` filters on `Boolean(a.branch)` and `handedTo` returns `[]` for an empty branch, so an unnamed desk no longer appears in a cap-refusal's branch list and no longer turns a `not-started` slice into `someone-is-on-it`. Today it does, which is the false reading #1101 reported. Pin this with one `fleet` or `handed-to` unit case; do not "fix" it by reading `checkout`. `checkout` is display-only, and no decision may read it.

**3. Three existing tests assert the old shape, and each is the anti-contract.** `registry.test.ts:569` (*"synthesizes an entry … carrying its branch"*) asserts `got[0].branch === 'feature/orphan'`. Rewrite it into the plan's case: `branch` is `''` and `checkout` is the worktree's branch. Do not leave it beside a contradicting one. Then run `grep -rn "synthesized\|identity: 'synthesized'" packages/board/test` and read each hit: `a-row-is-owned-by-more-than-its-pr.test.ts`, `drop.test.ts`, `working-shows-every-agent.browser.test.ts` and `supervisor-badge.browser.test.ts` build synthesized entries and may key on their branch. Change an assertion only where the old branch was the subject.

**4. The synthesizing filter stays on the worktree's branch.** `registry.ts` skips a worktree whose `wt.branch` is empty (*does NOT render a branchless worktree*, `registry.test.ts:605`). That reads the worktree, not the entry, and it keeps working: do not move it onto `entry.branch`, which is now always empty for these rows, or every unnamed desk disappears.

**5. The client's `agentByBranch` map (`AgentList.tsx:438`) keys on `a.branch`.** With several synthesized entries it gets several `''` keys, and the last wins. Every lookup passes a branch row's non-empty `r.branch`, so no lookup reads the `''` key. Leave it. A unit case does not need to cover it; the browser test below does.

### Done when

The plan's `## Done when` list is the specification. Each test below must FAIL on `origin/main` and PASS on the branch; run each against `main` before claiming it, in a pristine worktree, never by reverting your own tree.

- **`registry.test.ts`:** a worktree no manifest names, checked out on `bug/x`, gives an entry whose `branch` is `''` and whose `checkout` is `bug/x`. The existing *"carrying its branch"* case is rewritten into this one. A manifest-backed entry still carries its branch and an empty `checkout`.
- **Browser test** (`packages/board/test/integration`, beside `working-shows-every-agent.browser.test.ts`): the synthesized row does not show `bug/x` in its name, link or id, and shows `unnamedDeskLabel`'s words. Seed the label's words from the rule's own output rather than a literal, so a reworded label does not break the test, and assert `bug/x` appears only inside the `checked out` detail. Run `pnpm build:board` from the repository root first: the browser tests load the built artifact, and a stale one fails every new-feature test.
- **`desk-manifest.test.ts`:** `unnamedDeskLabel` at 100% branch coverage, and the module's existing coverage kept. Cover each `live` value the entry's `state` can take, and an empty `checkout`.
- **`auto-dispatch` unit case (trap 1):** a running synthesized entry is not counted by `freeAgentCount`, is not named by `freeAgentLabels`, and still counts in `liveAgentCount`. This catches the dispatch hazard: without it every other test stays green while the fleet hands slices to a desk it cannot name.
- **`handedTo` or `fleet` unit case (trap 2):** a live synthesized entry on a slice's checkout leaves that slice's row `not-started`, not `someone-is-on-it`.
- **`schema.test.ts`:** an entry without `checkout` parses with `checkout === ''`.

Plus: one `@plot-pm/board` patch changeset with the description first and the `plan:` line inside the trailing comment block, no `skills` block (see `.changeset/a-continued-loop-carries-its-manifest-board.md` for the form). Run `./scripts/check-changeset-packages.sh`. `.changeset/` holds siblings' files: add yours, touch none. Use `nvm use` (Node 24) before any `pnpm` command. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Run `pnpm build:board` from the repository root when `packages/board/src` changes, and commit the artifact; on a conflict in `board-server.mjs`, take either side and rebuild. New functions you write are arrows.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work continues). Do not use `gh pr create`.
- When the PR exists, append `, PR: #<number>` inside this slice's heading in the plan's `## Slices` (`(Branch: bug/a-desk-with-no-manifest-says-so, PR: #N)` is the form waved plans parse), through a scratch worktree on `origin/main`.
- Do not `git add -A` after a suite run: board tests rewrite the tracked `tiny-garden/.plot/state` fixture.

### Scope guard

This branch owns:

- `packages/domain/src/rules/desk-manifest.ts` (add `unnamedDeskLabel` only), `packages/domain/test/desk-manifest.test.ts`
- `packages/board/src/server/registry.ts` (`synthesizeEntry` only), `packages/board/src/contract/schema.ts` (`AgentEntrySchema` gains `checkout`), `packages/board/src/server/auto-dispatch.ts` (`freeAgents` only)
- `packages/board/src/app/lib/agent-rows/rows.tsx` (the registry row's label and the checkout detail only)
- the tests named above, and the board artifact rebuilt from them

No other branch of this plan is in flight: slices 1, 2 and 3 are merged (#1170, #1234, #1256). Do not edit `continue.ts`, `manifest-stamp.ts`, `plot-worker-loop.sh` or the monitors; they are those slices' files and are done. `bug/the-loop-reports-idle` (#1041) is a different plan; it edits the wrapper and the loop, not the registry.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

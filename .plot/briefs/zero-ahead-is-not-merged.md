## Implementation brief — a-slice-nobody-worked-on-reads-not-started (wave 2: Zero ahead is not merged)

- **Plan (canonical):** `docs/plans/2026-09-30-a-slice-nobody-worked-on-reads-not-started.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session
- **Branch:** `bug/zero-ahead-is-not-merged` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waits on wave 1, `bug/a-slice-with-no-work-waits-in-not-started`. Wave 1 gives `classifyGroup` arms for `blocked`, `waiting` and `unknown`. Without those arms, the `open` and `unknown` this wave produces for a zero-ahead ref fall to the `wip` tail and read *commits, no PR ever opened*. Cut this branch from `main` after wave 1 merges; if it was cut earlier, rebase onto it first.

### What to build

`branchState` answers `merged` for any ref that is zero commits ahead and strictly behind the default branch (`packages/domain/src/rules/branch-state.ts`, the last `return 'merged'` of the zero-ahead arm, near `:271`). It reads neither `pr` nor `hostReach` there. Measured 2026-09-30: `bug/the-suites-own-their-temp-root` was a ref pushed at the then-tip of `main`, carried no commit of its own, and `plot-host.sh pr-state` answered `NONE` — the board showed it in DONE as `merged`, wave `complete`. `merged` settles a wave, so a slice nobody wrote opens the next wave.

The arm becomes the plan's table, over every reading it receives:

| Reading | Answer |
|---|---|
| `mainTip` null | `unknown` |
| `pr === 'MERGED'` | `merged` |
| `hostReach` `unasked` | `merged`, as today |
| `hostReach` `throttled`, `secondary` or `failed` | `unknown` |
| host asked, `pr` `unreadable` | `unknown` |
| host asked, `pr` `OPEN` | `wip` |
| host asked, `pr` `none` or `CLOSED`, list complete | `open` |
| host asked, `pr` `none` or `CLOSED`, list not complete | `unknown` |

To answer the last two rows, `BranchReadings` gains `prListComplete: boolean`. It travels:

1. **Scan → bundle.** `plot-fleet-scan.sh` fills it from `$HOST_STATE_CACHE/.list-complete` (written at `:1075` and `:1080`, one path for GitHub and Bitbucket; read at `:1154`) and sends it as an **eleventh** tab-separated field.
2. **Bundle.** `packages/board/src/server/entry/branch-state.ts` — note the path, the plan says `entry/branch-state.ts` — holds `const FIELDS = 10` (`:87`) and documents *"Ten tab-separated fields"* (`:57-72`). It becomes 11, and every other count still exits 2. Rebuild `skills/plot/scripts/board/plot-branch-state.mjs`.
3. **Refill path.** `plot-fleet-scan.sh:3923` rebuilds a line as `cut -f1-9` plus the prerequisite's word. After this change that drops field 11. Carry it.
4. **Corpus.** `packages/domain/corpus/branch-state.corpus.test.ts`'s `readingsFor` fills it, from `readPrList().complete`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`unasked` keeps `merged`.** The literal rule *"no PR evidence means open"* was measured by the round-1 juror: it failed 8 of 163 `test/reconcile/fleet.test.mjs` tests, one of them `--next` offering the merged `feature/tracer` as the next branch to start. A repository with no git host, and every `--offline` scan, has zero-ahead-behind as its only merge signal; a merge-commit merge with its ref kept reads exactly that way. `fleet.test.mjs:1548` (*"a branch behind main still reads merged — the regression that matters"*) runs offline and must stay green unchanged. Keeping `merged` for `unasked` passed 163 of 163.

**`open` needs a complete PR list; otherwise `unknown`.** `host_pr_state` answers `NONE` from a list capped at `PR_LIST_LIMIT` (`plot-fleet-scan.sh:648`, default 1000). This repository has more than 1010 PRs, so a merged PR outside the window reads `NONE`. Answering `open` on that would reopen landed work. `unknown` holds the wave and renders in NOT STARTED after wave 1 — which is what the measured rows need. **On this repository the list is never complete**, so an empty claim here reads `unknown`, not `open`. That is expected; do not raise `PR_LIST_LIMIT` in this branch.

**The list counts as complete only with at least one row** (`plot-fleet-scan.sh:1078`). An empty list is not proof that no PR exists — the repo's standing rule, *absent is not false*.

**`mergeSubjectFound` is not zero-ahead evidence.** The scan reports it only on the no-ref arm. Do not read it in the zero-ahead arm.

**This reverses a recorded decision, on purpose.** `packages/domain/test/branch-state.test.ts:300-322` says the arm is *"NOT fixed by answering `open` instead"* and that *"the discriminator is the PR index"*. The host's PR answer, bounded by the list's completeness, is that discriminator. Replace that note; do not keep it beside the new assertions.

**Exactly 11 fields, no tolerance for 10.** The scan is the only caller that sends lines, and scan and bundle ship in this one branch, so no 10-field line can arrive. Accepting both counts would be a second contract nobody tests.

**The supervisor's queue is not affected.** It treats every existing ref as claimed (`registryd-main.ts:534`), so an operator's hold — an empty ref pushed to keep a slice from the queue — still holds. It now reads `open` (or `unknown` here) to a person and to `--next` instead of `merged`. Do not touch the queue; #1100 owns `waits:` in the queue.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc — no decision history in comments; that goes in the commit message.
- A duplicated rule is held by its corpus test. On a disagreement between `branchState` and the bundle, stop; never adjust one side to make the comparison pass.
- The bundle reads its line from stdin and never opens a file.

### Done when

The plan's slice-2 `## Done when` items are the specification. The assertions that exist because a naive implementation passes without them:

- **Every table row asserted in `branch-state.test.ts`**, including `unasked → merged`. A change that answers `open` wherever `pr` is `none` passes the headline case and fails `fleet.test.mjs` 8 times — this row catches it at unit level.
- **`branch-state.test.ts:188` reads `waiting`.** A ref behind main whose prerequisite has an OPEN PR read `merged` because `merged` is not replaceable by a prerequisite. Once the arm answers `open`, the wait verdict applies. This proves the new `open` flows into the prerequisite precedence rather than bypassing it.
- **`test/reconcile/fleet.test.mjs` passes whole**, run `--offline` as it is. It runs 355–544 s; give it a ten-minute timeout.
- **Host shim, complete list, `NONE`:** a plan whose second slice is a zero-ahead ref behind main does not complete that slice's wave. With the list incomplete, the slice reads `unknown`.
- **Refill path:** under the same shim — `NONE` for the slice, `MERGED` for its `waits:` prerequisite — a zero-ahead ref behind main reads `open`. **This is the only test that proves field 11 survives `:3923`**; without it the refill silently sends 10 fields and the bundle exits 2, or a padded default hides the loss.
- **Corpus:** a fixture reading per table row, rule and bundle answering the same state for each; the bundle refuses a 10-field line with exit 2.
- **The #995 guard passes with a rebuilt fixture.** `packages/board/test/unit/a-failed-scan-keeps-the-last-sections.test.ts:57` and `:89-92` build their `done` row from exactly the reading this wave changes. Rebuild the fixture from `pr: 'MERGED'`, which still answers `merged`. The guard's subject — a failed scan does not move a remembered row to DONE — must not change.
- **The three measured rows as fixtures**, through `rowsFromPulse`, land in NOT STARTED, NOT STARTED and WORKING (plan `## Motivation` table).

Every `BranchReadings` literal gains `prListComplete` (plan Notes, round 4): `branch-state.test.ts:25`, the three in the #995 guard, and the corpus `readingsFor`. `tsc` finds the rest.

The `mainTip` null row is an unreadable main, not an incomplete host answer. If wave 1's `unknown` sentence (*the host's answer is incomplete*) can be told apart for it, give it its own sentence; if that needs a payload field, report it instead — the plan adds none.

Plus the repo gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run typecheck
pnpm run test:board          # rebuilds board-server.mjs and plot-branch-state.mjs; commit both artifacts
pnpm run test:contracts
```

Do not run `pnpm run test:e2e` locally; CI runs it. Add one changeset, description first, `bumps:` last (`CLAUDE.md` › Versioning); the scan change needs a `plot` entry beside `'@plot-pm/board'`. Board suites fail spuriously under load: re-run a failing file alone and compare against `main` before believing it.

### Bookkeeping

- Push the first real commit as soon as it exists. An empty claim ref is exactly the row this plan is about.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's heading in the plan's `## Slices` section on `main`: `### Zero ahead is not merged (Branch: bug/zero-ahead-is-not-merged, PR: #N)`. The trailing `→ #N` form parses as no PR for a waves plan.

### Scope guard

This branch owns:

- `packages/domain/src/rules/branch-state.ts` and `packages/domain/test/branch-state.test.ts`
- `packages/domain/corpus/branch-state.corpus.test.ts`
- `packages/board/src/server/entry/branch-state.ts` and its artifact `skills/plot/scripts/board/plot-branch-state.mjs`
- `skills/plot/scripts/plot-fleet-scan.sh` — the readings line and the `:3923` refill only
- `packages/board/test/unit/a-failed-scan-keeps-the-last-sections.test.ts` — the fixture only
- `test/reconcile/fleet.test.mjs` — new shim cases only; existing cases stay unchanged
- new fixture tests for the three measured rows, one `.changeset/*.md`, and the rebuilt `board-server.mjs`

Not this branch: `classifyGroup` and `rowsFromPulse` in `packages/board/src/server/fleet.ts` (wave 1), the supervisor queue (#1100), `/plot-implement` (#1090's first half), free-desk labels (#1101).

Other branches in flight, verified 2026-09-30 at brief time:

- `bug/scripts-share-one-temp-helper` (10 ahead) edits `plot-fleet-scan.sh` at `:253`, `:573-590` and `:2577-2594` — its temp-directory helper. No overlap with the readings line or `:3923`, but the same file: whichever lands second rebases.
- `bug/a-slice-with-no-work-waits-in-not-started` (wave 1) owns `fleet.ts`'s classifier. No other remote branch touches `branch-state.ts`, the entry, the corpus, the #995 guard or `fleet.test.mjs`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

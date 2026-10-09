## Implementation brief — a-merged-pr-s-checks-freeze (wave 2: A merged pending check is re-asked)

- **Plan (canonical):** docs/plans/2026-10-09-a-merged-pr-s-checks-freeze.md on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/a-merged-pending-check-is-asked-again` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (PR review, CI)

Wave 1 (`feature/a-merged-pr-shows-no-ci-state`) merged as #1423 (`276aa2535`). This branch waits on nothing now.

### What to build

PR #1413 merged at 06:35:04 UTC while its last CI run was still going. The store holds `"state":"MERGED","checks":"pending"` for it, and nothing ever replaces that word. Wave 1 stopped the screen from reading it (`prStates` answers `['unknown']` for a merged PR through `prChecksSuppressedByMerge`). This wave fixes the stored field, so the PR index holds the final check state for every other reader.

Measured on 2026-10-09 in `.git/.plot/state/index/github.json`: 5 merged rows hold `pending` (#1228, #1299, #1302, #1346, #1413), 97 hold `green`, 2 `failing`, 5 `none`, 873 `unknown`.

Add a domain rule `pendingMergedPrNumbers(held)` beside `pendingOpenPrNumbers` in `packages/domain/src/rules/pr-index.ts` (line 292). It returns the numbers of the `MERGED` rows whose stored `checks` is `pending`. Then add a second re-ask to the delta refresh in `packages/board/src/server/fleet.ts`, directly after the open re-ask (the block at line 3237, guarded by `window.since !== null`):

- Ask `scriptsFor(opts).hostSaid(['pr-list', '--rich', '--state', 'merged', '--limit', '<n>'])` inside `withHostSlot`, only when at least one number is askable.
- Keep the rows whose number is in the askable set, normalise them as the open re-ask does, `byNumber.set` them, and push `storeRow(pr)` into `rows`. The existing fold path writes the store. Do **not** `map.set(pr.head, …)`: a merged PR must not reach `classify` by head (the guard `pr.state === 'OPEN'` at the open re-ask exists for that).
- Bound it with the same `PR_PENDING_REASK_LIMIT` (line 280) and the same `entry.prPendingReaskStreak` map, keyed by number. A number is no-progress when the answer is still `pending` with the stored `updatedAt`. Read the streak code in the open block and reuse its shape; do not invent a second streak.
- A refusal, a partial answer or a throw leaves the stored rows as held, exactly as the open re-ask does.

Amend the TSDoc of `pendingOpenPrNumbers` (*"A stored `pending` on a merged or closed row is left exactly as held"*) so it points at the new rule for `MERGED`. The `CLOSED` half stays true.

### Settled decisions — do not re-derive them

- **The open question cannot be reused.** `pr-list --rich --state open` never returns a merged PR. `plot-host.sh pr-list` takes `--state merged` and `--limit`, and takes no number filter. The cheapest question that reaches a recently merged PR is `--rich --state merged --limit <n>`, because GitHub lists by number descending.
- **It must be `--rich`, not `--rich-open`.** `--rich-open` emits a `MERGED` row with `checks:"unknown"` (`plot-host.sh:74-80`), and the fold's `withHeldVerdicts` (`pr-index.ts:216`) then keeps the held `pending`. `--rich` asks the rich fields of every row it returns. A test that answers `green` through the mock host proves the arm; a test that answers `unknown` proves nothing.
- **Plan open question 3 is answered: the full read cannot overwrite the row.** The full read uses `--rich-open`, so a `MERGED` row arrives as `unknown`, and `withHeldVerdicts` fills `checks` from the held row. That is why #1228 still reads `pending` five weeks after its merge. The fold is correct: *absent is not false*, and an `unknown` must never erase a held answer. **Do not change `foldPrIndex` or `withHeldVerdicts`.** The delta re-ask is the only fix; a rich answer is not `unknown`, so it wins in the fold.
- **Plan open question 2 — the limit.** #1228 is about 190 PRs older than #1413. A `--limit` that reaches it asks for hundreds of rich rows; the full read measured 43.0 s for 1000 rows against 7.3 s without the rich fields (`plot-host.sh:90`), about 0.04 s per row. Recommendation: a fixed constant (start at 50, measure `pr-list --rich --state merged --limit 50` on this repository and state the figure in the PR), and leave rows older than the window as held. Slice 1 already stops them rendering, so a legacy `pending` row costs no screen. The newest pending row is the one that matters, and it is recent by construction: a check still pending at merge belongs to a PR that merged minutes ago. State the choice and the measurement in the PR body.
- **Plan open question 1 — does this wave earn its request?** Read before you write. After wave 1, a grep over `packages/board/src` and `packages/domain/src` for `.checks` finds these readers of a stored row: `fleet.ts:2462` (`refreshRuns` filters `pr.checks === 'failing'`, then `branchIsWatched`), `PlanCard.tsx:265` and `plan.ts:56` (`checksVerdict` over `card.prs`, fed by `board.ts:2198`), and `fleet.ts:5914-5949` (`classify`, reached by open PRs only). Check whether a merged PR reaches `PlanCard.tsx:265` / `plan.ts:56`; the plan row's aggregate was wave 1's concern, so confirm it before you decide. If no reader of a merged row's `checks` exists, write that in the PR body and still ship: the issue (#1418) asks for the index to hold the final answer, and the issue is the scope. Report the grep, do not silently drop the wave.
- **One writer.** `fleet.ts` stays the only caller of `foldPrIndex` (*A Decision Reads The Index*). The new rule reads the store and spawns nothing. Shell consumers read the index through `board/plot-pr-index-lookup.mjs`; do not touch it.
- **Only a terminal answer is read from the index, and the index never says no.** This wave fixes a stored word on a terminal row. It does not make the index supply `pr: 'none'`.
- **`CLOSED` is not re-asked.** `prStates` renders it `closed` whatever its checks say.
- **The request cost is not in `PR_REQUESTS_PER_REFRESH`.** The comment above that table (line 211) says why the open re-ask is not priced there: it fires on a delta and only for a pending row. Extend that paragraph to name the merged re-ask; do not add it to the table.
- **Vocabulary and style.** The slice is a Slice, not a Wave, in any new identifier (this brief says "wave" because the plan's heading does). `packages/domain` takes arrow functions and a TSDoc block that states what the export returns, with no history. The reasoning goes in the commit message. A function you write in a board file or a test is an arrow too.

### Done when

The plan's `## Done when` list is the specification. The tests that matter, and what each catches:

- `pendingMergedPrNumbers`, in `packages/domain/test/pr-index.test.ts` beside the `pendingOpenPrNumbers` cases (line 404 onward): returns `[1]` for one `MERGED`+`pending` row, and returns `[]` for a `MERGED` row with each of `green`, `failing`, `none`, `unknown`, for an `OPEN`+`pending` row, for a `CLOSED`+`pending` row, and for `null`. The `OPEN` and `CLOSED` cases catch a rule that drops the `state` filter and double-asks the open rows.
- In `packages/board/test/unit/pr-store.test.ts` (the pending re-ask cases near line 965): a stored `MERGED`+`pending` row, a host that answers `green` for `--state merged`, and one delta refresh. The store then holds `green`. **Use a store row with `pending`, not `unknown`, or the test passes on `origin/main`.** A host double that answers the merged call with `unknown` must leave `pending` in place; this catches a re-ask that uses `--rich-open`.
- The same file: five answers of `pending` with the same `updatedAt` stop the asking, and a sixth delta makes no merged `pr-list` call. This catches a missing streak. Count calls on the host double rather than reading the streak map.
- A delta with no `MERGED`+`pending` row makes no `--state merged` call. This catches an unconditional second request on every refresh.
- A merged PR answered by the re-ask is absent from `entry.prs` (the by-head map). This catches a `map.set` that lets a merged PR reach `classify`.
- `fleet.ts` remains the only caller of `foldPrIndex` (`grep -rn foldPrIndex packages/*/src`).

Each test must fail on `origin/main` today. Prove it on a pristine `main` worktree before you rely on it, and remove the worktree afterwards.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction; list no full suite. The board unit tests need a built artifact first: run `pnpm build:board` to test locally and restore the generated paths before you push (`scripts/check-no-bundle-diff.sh`); never commit a rebuilt `board-server.mjs`. This wave touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply. Add a changeset (`'plot': patch`, description first, `bumps:` block last, optional `plan:` line); the description is the plan's second changelog line. Do not edit versions by hand.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/pr-index.ts`, `packages/domain/test/pr-index.test.ts`, the delta refresh in `packages/board/src/server/fleet.ts` (the block after the open re-ask near line 3237, the comment at line 211 and the constant at line 280), `packages/board/test/unit/pr-store.test.ts`, and a changeset.

Wave 1 is merged. Do not edit `pr-row.ts`, `prStates` or the `prRowPlacement` call sites. Do not edit `foldPrIndex` or `withHeldVerdicts`. In flight in `fleet.ts` on other branches: none verified at dispatch; run `git fetch` and `git log origin/main -5 -- packages/board/src/server/fleet.ts` before the first edit, because that file is shared and large. If you find something the plan did not anticipate, report it rather than improvising outside scope.

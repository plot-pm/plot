## Implementation brief — delivery-you-blocks-or-feeds (wave 5: Person comment)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-you-person-comment` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last of five slices. It waits on `feature/delivery-you-phase-strip` (#3522), which has merged, and so on `-plan-rows` (#3520), `-loose-prs` (#3511) and `-groups` (#3500). Nothing waits on it.

### What to build

A PR whose CI passed on a repository with `Auto-review: true` never reaches You today, and neither does a PR where a person left a comment nobody answered. fleetd's merge pass already finds the second case: `mergeAt` refuses `human-comment-open` and returns the newest conversation time (`packages/domain/src/workflows/merge.ts:651-658`), and `mergeTick` keeps the answer in memory as `conversationHolds`, a `Map<pr, { head, at }>` (`packages/fleet/src/shared/auto-merge.ts:55-65, 295-298`, created at `auto-writes.ts:59`). The board never sees it, so such a PR waits under Work items › At a gate with nothing saying a person must act.

This slice carries that answer to the board in three steps:

1. **fleetd writes it into the PR index.** A new optional field on the OPEN row, `personComment: { head, at }`, folded by the PR pass (`pr-refresh.ts`, the one caller of `foldPrIndex`). `PR_INDEX_VERSION` goes from 7 to 8 (`packages/domain/src/entities/pr-index.ts:12`). No new host call.
2. **The field reaches the client.** It follows `ciChecks`' route: `PrIndexRowSchema` → `PrRecord` and `OPTIONAL_FIELDS` (`packages/domain/src/rules/pr-maps.ts:55-72`) → the row's `pr` object (`packages/board/src/server/fleet.ts:6390-6399`, `packages/board/src/contract/schema.ts:2925-2945`) → `rowItem` in `packages/board/src/app/lib/agent-rows/delivery-readings.ts:231-252`, which sets a boolean on `WorkItemReading`.
3. **A domain arm places the PR.** `youCase` (`packages/domain/src/rules/delivery-placement.ts`, the `item.stage === 'pr'` branch) returns a new `person-comment` case, group Blocks delivery, marker "blocks delivery". Add it to `YouReason` and `YOU_GROUP_OF` (the plan's table fixes the group), and give it a `REASON_STATUS` and `REASON_DO` entry in `delivery-row-form.ts`.

The plan is canonical. This brief is orientation. Re-read the line numbers before you edit, because they drift (`main` moved 86 commits between the last brief and this one).

### The decisions the plan settles — do not re-derive them

**fleetd's held answer is the source, and the host is not asked again.** The merge pass paid for the conversation read already. Reading it again from the PR pass doubles the host spend for the same fact, which the plan's "makes no new host call" line forbids, and the PR pass runs on a different beat from the merge pass.

**The index never says no.** A row with no `personComment` was never asked, and the arm then does not fire. Absent is not "no comment". A repository with no auto-merge pass, a PR whose CI never passed, and every row `plot-pr-reader.mjs` writes (it runs no merge pass) carry no field. The plan's Notes name this gap; do not close it by asking the host.

**The staleness test is the one `holds()` makes** (`auto-merge.ts:~75-80`): the field's `head` equals the row's `headSha`, and the row's `updatedAt` is not later than `at`, both parsed. An unparseable time or a missing `updatedAt` means the arm does not fire. A reply to the comment bumps `updatedAt`, so the arm lets go on its own; the merge pass re-asks at the same moment.

### Traps a naive build walks into

**`head` is the commit, not the branch.** `PrIndexRow.head` is the branch name and `headSha` is the commit. The hold's `head` is `row.headSha` (`slice-pr-next.ts:229`). Compare it with `headSha`. A comparison with `row.head` never matches, and the arm never fires.

**`conversationHolds` holds two refusals, and only one is a person's comment.** `mergeTick` sets a hold for `human-comment-open` and for `human-comment-unread` (`auto-merge.ts:295`). `unread` means the conversation could not be read; it says nothing about a comment. `ConversationHold` has no field naming which one it was, so folding the map as it stands puts every PR with an unreadable conversation under Blocks delivery as "a person commented". The plan's Done When line names `human-comment-open` alone. Add the reason to the hold, fold only `open` ones, and test that an `unread` hold writes no field.

**A delta overwrites the row.** `foldPrIndex` replaces a held row with the incoming one for every number the answer carries (`rules/pr-index.ts:~176`), and `withHeldVerdicts` carries held fields for terminal rows only. A `personComment` written on one pass is gone after the next delta that mentions the PR unless the row-building step puts it back. Apply the field from the hold map to every OPEN row the pass writes, or carry it from the predecessor under the same head test (as `plotReviewJudged` is carried at `pr-refresh.ts:~1135-1147`). A test must run two passes in a row and find the field on the second.

**The hold map lives in memory for the daemon's life.** A restart empties it, and the store keeps the old field. That is fine only while the field is bound to a head and a time: after a restart the stale field stops firing when `updatedAt` moves or the head moves, and the merge pass writes a fresh hold at its next refusal. Do not write a second persistence path for the map.

**The PR pass and the merge pass are separate beats of one process.** Both run in fleetd (`registryd-main.ts:3360` builds `fleetPrs`; `auto-writes.ts` builds the merge pass). How the PR pass reaches the map is your decision, within one limit: `pr-refresh.ts` stays the only caller of `foldPrIndex`, and `PrWorld` (`pr-refresh.ts:143-176`) is where a PR pass reading is declared. `fleetPrs` has a second caller, `server/entry/pr-reader.ts:189`, which has no merge pass and passes no map; the field must stay optional there.

**One test, two readers.** `holds()` lives in `packages/fleet` and the board's arm lives in the domain, which cannot import fleet. Put the head-and-time test in `packages/domain/src/rules/` as one arrow function and have both call it, or write the second and add a test that runs both over the same table. Two undeclared copies drift.

**The version bump invalidates stored v7 files and every `v: 7` fixture.** A v7 store fails `decodePrIndex`, and every reader reads that as "ask the host" (`A Decision Reads The Index`), so the first fleetd beat after upgrade does a full read. Fixtures with a literal `7` fail to parse: `git grep -n "v: 7"` on `packages/domain/test`, `packages/fleet/test/unit` and `packages/board/test/unit` (`pr-index.test.ts`, `pr-index-file.test.ts`, `pr-store.test.ts`, `registryd-main.test.ts`, `registry.test.ts`, `known-pr.test.ts`, `merged-desk.test.ts`, `merged-row.test.ts`, `deliverability.test.ts`, `delivery-follows-the-merge.test.ts`). Prefer `PR_INDEX_VERSION` in a fixture over a new literal. Also run `git grep -n "PR_INDEX_VERSION\|\"v\": 7" -- skills/plot/scripts packages/board/build.mjs`: `plot-host.sh`, `plot-impl-status.sh`, `skills/plot/scripts/README.md` and `board/plot-pr-index-lookup.mjs` mention the version, and a script that reads it as a number needs the same change. Say in the PR what you found there.

**No `.default()` on the schema field.** `PrIndexRowSchema` forbids it, because a default turns a cold store into an invented measurement. `.optional()` only. The board payload field is `.optional()` too, with the same reason `ciChecks` carries in its comment.

**Where the arm sits among the others is yours to decide, and a test must fix it.** All of `fleet-stuck`, `merge-conflict`, `person-comment` and `review-pr` are Blocks delivery, so the marker never differs, but `reason` does, and it drives the Status and Do words. A spent-budget PR with a person's comment should read as `fleet-stuck`: the fleet cannot proceed whatever the person says. Write the order as a unit test over a PR that meets two arms.

**Domain first.** Every arm, the staleness test and the status words are domain properties with unit tests. The client sets one boolean and decides nothing. A function you write is an arrow, and the unit is the function: leave neighbouring declarations alone.

### Done when

The plan's Done When item for this slice is the specification: fleetd's PR pass writes `personComment` on an OPEN row from a held `human-comment-open` answer and makes no host call; a PR whose field names its head and is not older than its `updatedAt` places under Blocks delivery, and a row with no field does not, each asserted in a unit test.

Lift these assertions, because a naive implementation passes without them:

- A hold with reason `human-comment-unread` writes no `personComment`. This catches folding the map whole.
- The arm fires where the field's `head` equals `headSha`, and does not fire where it equals only the branch name `head`. This catches the wrong head field.
- The arm does not fire where `updatedAt` is later than `at`, where either time is unparseable, and where `updatedAt` is absent. This catches a one-sided test.
- Two PR passes in a row, the second a delta that names the PR, leave the field on the stored row. This catches a delta that overwrites it.
- A row with no field places where the other arms place it, and the PR under test also sits under Work items › At a gate in the unfired case. This catches "absent" read as "no".
- The pass makes zero host calls for this field: assert on the host port's call log, not on the return value.
- A PR that meets `fleet-stuck` and `person-comment` reads `fleet-stuck` (or the order you chose, fixed by the test).
- A v7 store file decodes to "ask the host", and a v8 store round-trips the field through `encodePrIndex` and `decodePrIndex`.
- One browser test shows a PR with a fired field under Blocks delivery with the person-comment Status words. Unit tests prove the rule; the browser test proves the row renders from it.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, with the description first (at least 20 characters), then the `plan: docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count; if the version grep above makes you edit one, pay for its growth in the same change.

Close the slice by adding one paragraph to `CLAUDE.md` under *A Decision Reads The Index*, or a sentence in the existing review-arm paragraph, saying that `personComment` is a non-terminal answer read from the index to place a row, bound by head and time, written by fleetd's PR pass from its merge pass's held answer, and absent wherever no merge pass runs. That section states that "another consumer needs its own paragraph here", and a second reader of a bought answer without one is the drift it warns about. Then run `./scripts/check-agents-md.sh --write`, because `AGENTS.md` mirrors that file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The last slice's merge is what `/plot-deliver delivery-you-blocks-or-feeds` waits on.

### Scope guard

This branch owns the `personComment` index field and the version bump, the PR pass's fold of fleetd's held answer, the reason on `ConversationHold`, the head-and-time rule, the payload field and client reading, and the `person-comment` arm with its status words, with their unit and browser tests.

It does not own: the groups and markers table (merged), the closed-PR reading (merged), the plan rows (merged), the header counts and phase strip (merged), the merge pass's refusals themselves (`mergeAt`'s decision does not change), or any new host call.

In flight, diffed at brief time against `origin/main` (`4a39aad78`): `feature/delivery-slice-states` (plan 1) changes `packages/domain/src/rules/delivery-placement.ts` and `packages/board/test/unit/delivery-readings.test.ts`, both of which this slice edits. Expect a textual conflict in `delivery-placement.ts` near `YouReason` and `youCase`, and resolve it by keeping both sides' additions. `feature/delivery-tab-footer` touches none of the files this slice names. Run `git diff --name-only origin/main...origin/<branch>` again at dispatch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

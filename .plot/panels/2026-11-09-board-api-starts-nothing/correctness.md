# Correctness juror: board-api-starts-nothing

Lens: where the plan can go wrong silently, such as a card the snapshot path renders differently from the ref path, a protocol bump that an old reader misreads, or a parity test that compares too little.

Position: amend

## Open Questions

1. **S3 or a new row S7.** Add S7 and keep S3 unchanged. S3 is `green: true` with `greenBy` `board-reads-the-channel` (`packages/fleet/test/census/census-rows.ts:34-41`), and its window sends no `GET /api/board` (`board.census.test.ts:137-175`). A changed S3 window makes the merge-base comparison compare two different scenarios. S7 states the poll as its own claim.
2. **One identity for fleetd and the board.** Do not move the identity read to fleetd. Keep it on the board and key it by the stamps of `gh`'s `hosts.yml` (or the `bb` config) and the repository's `.git/config`, so it starts a process only when one of them changes. Reason: fleetd runs under `systemd-run --user` (story, line 327), and the sandbox removes environment variables there. `gh` reads `GH_CONFIG_DIR` and `GH_TOKEN` from the environment, so "same user" does not prove "same answer". A wrong `hostUser` silently empties the *mine* filter (`app/lib/agent-rows/mine-filter.ts`) and the reader in `fleet.ts:2201`. The parity test excludes `server`, so it cannot see this disagreement. A stamp-keyed board read meets the S7 zero target with no cross-process risk.
3. **The census slice waits for `refs-from-files`.** Agree. `serverInfo`'s branch read has a 5 s TTL (`server-info.ts:73`) against a 30 s poll, so S7 reads about 2 `git` per minute without the file reader. Keep slice 3 after `feature/refs-from-files-adapters`.

## Leftovers

- S3 versus S7: the plan handles it as Open Question 1. No change other than recording the decision.
- One identity read in fleetd: the plan handles it as Open Question 2, but the recommendation does not name the environment risk above. Change slice 1 and slice 2 to keep the identity on the board, stamp-keyed, or else add a test that starts fleetd under the census's `systemd-run` environment and compares its identity with the board's.
- Census slice after `refs-from-files`: handled as Open Question 3. No change.

## What would ship a silent wrong answer

1. **`branchPlans` is built from a reading that does not hold what the plan says.** The plan states that `ideaPlans` holds "raw text only" (`fleet-scan.ts:976-977`). It holds a map from branch to file BASENAME, and only for `refs/remotes/origin/idea/*` branches with a file whose name ends in `<slug>.md` (`readIdeaPlans`, `fleet-scan.ts:391-411`; `BranchTextValueSchema`, `view-readings.ts:130`). The board reads a different set: every branch under every `Branch prefixes` entry (`idea`, `feature`, `bug`, `docs`, `infra`), every plan path on it that the default branch and the state ref lack, skips branches the default branch contains, and de-duplicates by path (`collectBranchPlans` and `readBranchPlans`, `board.ts:1245-1353`). A `branchPlans` reading parsed from `ideaPlans` drops every Draft plan on a non-`idea/` branch and every plan whose basename is not the branch slug. Those cards disappear from Discovery with no error. Change: fleetd must read the board's set through one domain rule that both paths call, and the "No read is made twice" row must count this new read honestly (it is not a read fleetd "already makes").
2. **Sprints and stories have no reading.** The board parses sprint text with `parseSprintContent` (`board.ts:1920-1930`) and story text with `parseStoryContent` (`board.ts:2115-2166`), reads archived stories (`:2231-2262`), and lists design documents from disk (`listDesignDocs`, `:2054`, `:2166`). `READING_KEYS` (`snapshot.ts:18-35`) has no sprint or story key, and fleetd's estate walk reads the plan directory only (`fleet-scan.ts:734-768`). The plan's table omits all of this, yet `boardInputsFrom` promises "sprint and story records". Change: add `sprints` and `stories` readings (with the fields the two parsers return, archived stories and design-document lists) to slice 1 and to the table, or keep the board's own sprint and story read on `snapshot` and state its process cost in S7.
3. **Working-tree plans and sprints.** `collectPlanSources` adds every plan that exists only in the working tree (`board.ts:1097-1104`), and the sprint reader adds working-tree sprints (`workingTreeSprints`, `:1928-1930`). The plan adds only the COUNT `localOnly` to `PlansValue`. A local-only plan changes with no ref event, which is the same argument the plan uses to keep `currentBranch` on the board. Without a decision, an unpushed plan card (*not pushed*) disappears on `snapshot`. Change: name who reads these files and how they are parsed without `plot-plan-meta.sh` per request.
4. **The `delivered` reading carries 8.4 MB.** This repository holds 680 delivered plans and 8,358,012 bytes of their text (measured 2026-11-09, `docs/plans/delivered/`). The board uses the text only for `verificationOf` and `refutedClaims` (`board.ts:2854-2864`). Carrying the whole text puts it in every welcome message and in every content comparison of `plans` (`recordReading`). Change: carry the inputs those two functions read (the deliveryCommit, the refuted count and the lines `verificationOf` reads), and add a size row to *Done when*.
5. **The estate's `worktree` source.** fleetd records `plans.ref` as `worktree` when the estate falls back to the working tree (`fleet-scan.ts:758`). The board's `collectPlanSources` never promotes the working tree (`board.ts:1070-1075`, row 3). `boardInputsFrom` must answer `unknown` for `ref: 'worktree'`, or the snapshot path shows working-tree content as shared truth, which is the defect `collectPlanSources` exists to prevent.

## The parity test compares too little

The census sandbox writes one plan (`packages/fleet/test/census/sandbox.ts:238`) and no sprint, story, delivered plan, branch plan, unparseable plan or local-only plan. A parity test over these fixtures passes while findings 1 to 3 drop cards. The test also excludes `server`, so the identity is not compared. Change: give the parity corpus its own fixture with at least one card of each kind: a Draft plan on a `feature/` branch, a plan whose basename differs from its branch slug, an active sprint with items, a story with a design document, an archived story, a Delivered plan with a verification record, a plan file that does not parse, a working-tree-only plan, and a plan with `issues` and `rounds`. Compare `server.hostUser` and `server.gitEmail` in a separate row.

## The protocol

No silent misread found. `admit` serves a subscriber only when its protocol equals `SNAPSHOT_PROTOCOL` (`subscription.ts:30`), so a protocol-2 board meets `mismatch` and reads for itself. Every new reading in findings 1 to 4 must go into the same raise from 2 to 3, so that slice 2 does not need a fourth protocol.

## The change that matters most

Fill the snapshot from the board's real card sources (branch plans over all prefixes, sprints, stories, working-tree plans) through rules both paths share, and prove it with a parity fixture that holds one card of each kind. Without this, slice 2 ships missing cards that the parity test cannot see.

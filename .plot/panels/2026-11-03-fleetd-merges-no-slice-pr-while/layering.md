# Layering juror: fleetd-merges-no-slice-pr-while

Plan: `docs/plans/2026-11-03-fleetd-merges-no-slice-pr-while.md` (PR #3068, issue #3063). Lens: where each responsibility lives (controller → domain → port ← adapter), which component decides to merge, and whether the merge still goes through the merge controller and the host adapter.

Position: amend

## The merge path today

All references are on `origin/main`.

1. fleetd's tick: `runAutoMergePass` in `packages/fleet/src/shared/auto-merge.ts:132-197` reads the PR index, the default-branch file and the config, and builds `MergePorts` with `caller: 'fleetd'` (`:170`).
2. Domain rule: `mergeTick` (`auto-merge.ts:88-124`) asks `slicePrNext` for each row. `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:320-347`) answers `merge` or a hold. `merger-app-missing` is the last hold (`:346`), after the repair admission (`:331-341`).
3. Merge controller: `nextMerge` picks one PR, and `mergeAt` (`packages/domain/src/workflows/merge.ts:354-`) re-asks the PR state, the default-branch reading, the tip and `plot/review` through the host port (`:360-366`), then `merge()` decides or refuses.
4. Host adapter: `pr-merge --match-head` goes to `plot-host.sh` (`skills/plot/scripts/plot-host.sh:4418-4447`). The GitHub arm calls `plot-merger-token.mjs`, which chooses the identity: App token, or exit 5 and the signed-in `gh` identity (`plot-merger-token.mjs:36-37`).

None of the three options changes steps 3 and 4. The merge still goes through `mergeAt` and `plot-host.sh pr-merge`. The identity choice stays in the adapter, where credentials belong (connector concern). On the main question of this lens the plan is sound.

## Findings

1. **The plan's code claims are true.** `auto-merge.ts:183` computes `mergerAppMissing: backend.value === 'github' && readConfig(opts, MERGER_APP_KEY, '') === ''`. `slice-pr-next.ts:346` holds `merger-app-missing`. The notice text is in `plot-merger-token.mjs:37`, which `plot-host.sh:4439` calls. The Bitbucket claim holds: the reading is false off GitHub, and the Bitbucket arm re-reads the head before it merges (`plot-host.sh:4445`).

2. **The merge policy is decided outside the domain, and option 3 would add to that.** `auto-merge.ts:183` holds a policy rule ("GitHub with no Merger app does not merge") in the fleet package. It is not a raw reading. CLAUDE.md's layering rule says "No domain-specific code or behaviour lives outside the domain". No unit test covers that line: `packages/fleet/test/unit/auto-merge.test.ts:124-128` passes `mergerAppMissing: true` directly to `mergeTick`, and `slice-pr-next.test.ts:405-408` does the same. Option 3 adds a third input (the opt-in key). The easiest edit for an unattended agent is `&& optIn === ''` on line 183, which grows an untested policy in the fleet layer.

3. **Two components read `Merger app`, and they define "declared" differently.** fleetd reads "declared" as a non-empty string (`auto-merge.ts:183`). The adapter uses `resolveApp` and refuses a malformed key, an unreadable key file, or a key with the same App id as `Writer app`, with exit 4 (`plot-merger-token.mjs:36-47`). A malformed key therefore makes fleetd try the merge. The adapter then refuses, `mergeTick` records `host-refused` for that (PR, head) (`auto-merge.ts:122`), and the PR does not merge again until its head moves. No named reason reaches the hold. This defect exists already, and an opt-in key adds a third reader.

4. **Open Question 3 already has an answer in the code.** `mergeAt` re-asks `plot/review` through `ports.host.prReview(pr)` (`merge.ts:364-366`). `merge()` refuses `review-not-passed` unless the review reads `success` on the pinned head (`merge.ts:209-212`). This happens for every caller, fleetd included, and with either identity. If the plan leaves the question open, an agent can add a second re-read in the fleet layer.

5. **The change also applies to repair and revert PRs on a red default branch, and the plan does not say so.** The `merger-app-missing` hold comes after the repair admission (`slice-pr-next.ts:331-346`), so today it also holds the repair PR and the revert PR that `repairMergeVerdict` admits. Options 2 and 3 let fleetd merge a revert on a red main as the signed-in Admin identity, with `bypass_mode: always`. That may be the right result, but it is a decision for a person and must be named. Also, `packages/domain/src/entities/repair-record.ts:18-20` says an undeclared `Merger app` ends an episode at `exhausted`, but `git grep` finds no code that does this. The slice should correct that comment, or a test should implement it.

6. **Open Question 4 (attribution) crosses into the adapter.** A PR comment is a host write. It must go through the host port and `plot-host.sh pr-comment` (`plot-host.sh:6061`), never through `gh` directly (`scripts/check-host-cli-callers.sh`). A merge-commit body changes `plot-host.sh pr-merge` on both arms, and the shell-lines ratchet counts it. The host already records `mergedBy`, so a write is not needed to tell a fleet merge from a hand merge. The plan must choose before approval. Otherwise the agent chooses where the write goes.

7. **Board impact is none.** `git grep merger-app-missing origin/main -- packages/board/src` finds nothing. The plan can replace the "the slice confirms" comment with that fact.

8. **The slice cannot start while the option is open.** The slice line says "change per the chosen option". Option 1 is an operator action (create the App, install it, store the key, add it to the ruleset bypass list) and needs no code. An unattended Sonnet agent cannot choose between 1, 2 and 3, and cannot name the key.

## Required amendments

1. Close Open Question 1 (the option) and Open Question 2 (the key name, and `## Plot Config` as its home) before approval. For option 3, also state if `plot-init` and `plot-board-setup` propose the key, or if they are out of scope.
2. Move the policy into the domain. `SlicePrNextReadings` takes raw readings: the backend word, whether `Merger app` is declared, and whether the opt-in key is set. A pure domain rule (for example `mergeIdentity(...)` → `app | signed-in | held`) answers, and `mergeArm` holds on `held`. `auto-merge.ts` only reads config and passes values. A test in `packages/domain/test/slice-pr-next.test.ts` covers the matrix: GitHub with no App and no opt-in holds, GitHub with opt-in merges, GitHub with an App merges, and Bitbucket merges.
3. Close Open Question 3 in the plan with the citation `merge.ts:209-212`, `:364-366`. State that the slice adds no review re-read outside the merge controller.
4. State the repair-arm consequence in Design (finding 5). Either the opt-in covers repair and revert PRs, or the slice keeps them held without a Merger app. Add a `slice-pr-next` test for the chosen case. Fix the `repair-record.ts:18-20` comment.
5. Decide Open Question 4. The recommended decision is no new write, because the host's `mergedBy` names the identity. If a write is chosen, the plan names the host-port operation and the `plot-host.sh` arm on both backends.
6. Optional, but cheap: let fleetd read whether `Merger app` is declared through the same `resolveApp` semantics as the adapter (or a domain parse of the key), so that a malformed key holds with a named reason and does not fail as `host-refused`.

## Decisions that need a person

- The option (1, 2 or 3). This includes accepting the Admin `bypass_mode: always` exposure that D4 of #2902 closed.
- The opt-in key's name, and whether it covers repair and revert merges on a red default branch.
- Attribution: rely on the host's `mergedBy`, or add a host write.

## What I ran and what I only read

Ran (read-only): `gh issue view 3063`, `gh pr view 3068 --json state,files`, `git fetch origin main`, `git show origin/main:<file>` for the files cited above, `git grep` on `origin/main` for `Merger app`, `mergerApp`, `merger-app-missing`, `exhausted` and `HoldReason`, and `ls` of the panel directory.

Read only: `auto-merge.ts`, `slice-pr-next.ts` (lines 80-112 and 300-370), `workflows/merge.ts` (lines 170-215 and 354-400), `repair-record.ts`, `plot-host.sh:4418-4447`, the comments in `plot-merger-token.mjs`, `auto-merge.test.ts:85-128`, and `docs/review-status-rollout.md:140-155`.

Not run: no tests, no fleet or board command, no host write. I did not execute the malformed-key path in finding 3. I derived it from the code.

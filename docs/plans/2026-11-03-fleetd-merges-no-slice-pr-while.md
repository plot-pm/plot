# fleetd merges no slice PR while no Merger app is declared

> fleetd merges a green slice PR with `plot/review` success and no HIGH as a narrow `Merger app` GitHub App that is not on the ruleset's bypass list, so `validate` and `plot/review` from the Review app bind every fleet merge; a missing, invalid or unread key holds the merge by name and leaves one action-log record.

## Status

- **State:** Released
- **Type:** feature
- **Issue:** #3063
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3068 merged
- **Started:** 2026-11-03, Jan Wloka, `feature/fleetd-merges-as-the-merger-app`
- **Delivered:** 2026-11-03
- **Released:** 2026-11-07, v2.31.0

## Changelog

- fleetd merges a green slice PR whose head has `plot/review` success as the GitHub App that `## Plot Config` names in `Merger app`. The App is not on the ruleset's bypass list, so GitHub refuses the merge unless `validate` and the Review app's `plot/review` are green on the head.
- A pure domain rule decides whether fleetd may merge on this host. A missing `Merger app` holds as `merger-app-missing`, a malformed key, an unreadable key file or an App id equal to `Writer app` holds as `merger-app-invalid`, and a failed read holds as `merger-app-unread`. Before, a malformed key made fleetd try the merge and stall as `host-refused` until the head moved.
- fleetd appends one action-log record per merge attempt and one per first hold on a merger reason, so a person can see that fleetd merged and why it holds.
- `plot-init` and `plot-board-setup` name the `Merger app` key for an adopting repository on GitHub.

<!-- Board impact: none. `git grep merger-app-missing origin/main -- packages/board/src` finds nothing; the board renders no merge hold reason. The action-log record is the surface for the new holds. -->

## Motivation

On 2026-11-02 and 2026-11-03 every slice PR of sprint `2026-W44-delivery-loop` with a green head and a clean `plot/review` waited for a person, or for an operator's job script that called `plot-ask.mjs merge`. The sprint goal says the fleet carries every plan to Delivered alone.

The cause is one rule. `packages/fleet/src/shared/auto-merge.ts:183` sets `mergerAppMissing` when the host is GitHub and `## Plot Config` declares no `Merger app`. `slicePrNext` then holds every PR with `merger-app-missing` (`packages/domain/src/rules/slice-pr-next.ts:346`). This repository declares no `Merger app`. `plot-host.sh pr-merge` merges as the signed-in `gh` identity when no App is declared (`plot-merger-token.mjs:37`, exit 5), so a person merging through `plot-ask.mjs merge` succeeds where fleetd is held.

Plan `fleetd-merges-slice-prs-one-at` (#2902, Released 2026-11-03) decided D4: on GitHub fleetd merges nothing until `Merger app` is declared, so no fleet merge uses a ruleset bypass. `DESIGN-delivery-loop.md:175` records it as jwloka's decision. This plan keeps D4 and supplies the App.

Ruleset 24412719, read 2026-11-03 with `gh api repos/plot-pm/plot/rulesets/24412719`: required status checks `validate` (integration 15368) and `plot/review` (integration 5317669, the Review app); `required_approving_review_count: 0`; two bypass actors with `bypass_mode: always`, RepositoryRole 5 (Admin) and Integration 5173644 (`plot-board-builder`). The signed-in `gh` identity here is admin.

## Design

### Decision

jwloka decided on 2026-11-03, after the first panel round:

1. **fleetd merges as a narrow Merger App.** The App is declared in `## Plot Config` as `Merger app`. It is NOT on the ruleset's bypass list (`docs/review-status-rollout.md:181-196`, #1730). It merges because the ruleset requires 0 approvals and the two status checks. So GitHub itself refuses a fleet merge whose head lacks `validate` success or whose `plot/review` success does not come from the Review app (integration 5317669). The first draft of this plan said the App needs a bypass entry. That was wrong: a bypass-listed merger recreates #1730 under the App's name.
2. **Attribution needs no new host write.** GitHub's `mergedBy` names the App's bot (`<app-slug>[bot]`), which tells a fleet merge from a hand merge. fleetd also appends one action-log record per merge attempt and one per first merger hold (see *Merge record*), so a live run proves that fleetd merged with no person.
3. **Repair and revert PRs merge through the same App path.** The merger hold comes after the repair admission (`slice-pr-next.ts:331-346`), so a repair PR or a revert PR that `repairMergeVerdict` admits on a red default branch merges as the App, or holds on the same merger reason. A test holds this.

Rejected options:

- **Merge as the signed-in admin identity.** It uses the Admin role's `bypass_mode: always`, so GitHub checks neither `validate` nor the creator of `plot/review`, and the merge controller's review read takes the newest `plot/review` status from any writer (`plot-host.sh:4395`, #3072).
- **An opt-in key for the signed-in identity.** The key is read from the working tree (`config-reader.ts:41-44`), so a slice PR can add it, and the opt-in path inherits every gap of the admin identity above.

### Approach

**The decision moves into the domain.** A new pure rule `mergeIdentity` in `packages/domain/src/rules/merge-identity.ts` takes raw values and answers one of `app`, `host` or a hold:

| Backend | `Merger app` reading | Answer |
|---|---|---|
| `github` | `usable` | `app` |
| `github` | `absent` | hold `merger-app-missing` |
| `github` | `invalid` (malformed key, unreadable key file, App id equal to `Writer app`) | hold `merger-app-invalid` |
| `github` | `unread` (the read failed, or no reading was passed) | hold `merger-app-unread` |
| any other | any, not consulted | `host` |

`SlicePrNextReadings` drops `mergerAppMissing` and takes `backend` and `mergerApp` instead. `mergeArm` calls `mergeIdentity` at the place of `slice-pr-next.ts:346` and holds on its hold. `auto-merge.ts:183` stops deciding: it reads the backend and the `Merger app` reading and passes both.

**fleetd reads the key the way the adapter does.** Today fleetd reads "declared" as a non-empty string (`auto-merge.ts:183`) while the adapter refuses a malformed key, an unreadable key file and an App id equal to `Writer app` with exit 4 (`plot-merger-token.mjs:36-47`, `resolveApp` in `plot-github-app.mjs:45-62`). So a malformed key makes fleetd try the merge, `mergeTick` records `host-refused` for that (PR, head) (`auto-merge.ts:122`), and no named reason reaches the hold. The slice adds `plot-merger-token.mjs --check`, which runs the same validity checks, mints no token, prints nothing on stdout, and exits 0 for usable, 4 with the reason on stderr for invalid, and 5 for absent. A new adapter under `packages/domain/src/adapters/` runs it and answers the `Merger app` reading; any other exit or a failed start reads `unread`. One component answers validity, and fleetd no longer reads `Merger app` through `readConfig`.

**A failed read holds.** `readConfig` answers its fallback both for an absent key and for a failed read (`config-reader.ts`). The new adapter does not use it. `resolveApp` already reports a crashed `plot-config.sh` as not absent (`plot-github-app.mjs:38-41`), so it exits 4 and holds `merger-app-invalid`. A start failure or an unknown exit holds `merger-app-unread`. No path reads a failed read as consent.

**Merge record.** `runAutoMergePass`'s result is discarded at `auto-writes.ts:92`, and `mergeTick` and `mergeAt` append nothing to the action log. The slice appends records the way the review pass appends `review-start` (`auto-review.ts:245-260`):

- one `merge` record per merge attempt, with PR, head and outcome: `merged as app`, `merged as host`, or `failed: <refusal or host-refused>`;
- one `merge-hold` record the first time a (PR, head, reason) holds on `merger-app-missing`, `merger-app-invalid` or `merger-app-unread`, with the adapter's reason text for `invalid`. A later pass with the same (PR, head, reason) appends nothing.

**What stays.** The merge still goes through `mergeAt` (`merge.ts:354-`) and `plot-host.sh pr-merge` (`:4418-4447`). The identity choice stays in the adapter. `release-pr` stays refused for fleetd: `mergeTick` calls `mergeAt` with `viaReleaseApprove` false (`auto-merge.ts:115`, `merge.ts:193-195`). `head-moved`, `checks-not-green`, `checks-unbound`, `review-not-passed`, `default-branch-red`, `-stale`, `-unsettled` and `-unread` stay controller refusals for every identity. `plot-ask.mjs merge` does not change: a person still merges as the signed-in identity where no App is declared.

**Bitbucket.** The rule answers `host` and does not read the key, so fleetd merges there as the `bb` identity, as today. The Bitbucket arm re-reads the head before merging (`plot-host.sh:4445`). Nobody has measured whether the `bb` identity bypasses Bitbucket merge checks; this plan argues nothing from that arm.

**Related: #3072.** `pr-review` takes the newest `plot/review` status from any writer (`plot-host.sh:4395`), so the merge controller's review read binds no creator. Under the App the ruleset still refuses a merge whose `plot/review` success comes from another writer, because the check is bound to integration 5317669. So #3072 is not a precondition of this plan. It stays open for `plot-ask.mjs merge` and for Bitbucket.

### Open Questions

- [x] Which option? Option 1, the Merger App (jwloka, 2026-11-03). Options 2 and 3 are rejected; see *Decision*.
- [x] Key name and home: `Merger app` in `## Plot Config`, the existing key (`auto-merge.ts:30`, `docs/review-status-rollout.md:200-202`). `plot-init` and `plot-board-setup` name it for a repository on GitHub and do not create the App.
- [x] Does the merge need a `plot/review` re-read like `release-approve`? It has one: `mergeAt` re-asks `ports.host.prReview(pr)` (`merge.ts:364-378`), and `merge()` refuses `review-not-passed` unless `plot/review` reads `success` on the pinned head (`merge.ts:209-213`). The existing tests in `packages/domain/test/workflows-merge.test.ts:272-285` and `:479` guard it. The slice adds no review re-read outside the merge controller.
- [x] Attribution: GitHub's `mergedBy` plus the fleetd action-log record; no new host write.

### Tests

Each test fails on `origin/main` before the change.

- `packages/domain/test/merge-identity.test.ts` (new; fails before because the module does not exist): `github` + `usable` → `app`; `github` + `absent` → hold `merger-app-missing`; `github` + `invalid` → hold `merger-app-invalid`; `github` + `unread` → hold `merger-app-unread`; `bitbucket` with each of the four readings → `host`.
- `packages/domain/test/slice-pr-next.test.ts:405-408` rewritten to the new readings: `backend: 'github'`, `mergerApp` absent → hold `merger-app-missing`; usable → `merge`; invalid → hold `merger-app-invalid`; `backend: 'github'` with no `mergerApp` → hold `merger-app-unread`. Each hold fails before, because `mergeArm` reads only `mergerAppMissing` and merges.
- `packages/domain/test/slice-pr-next.test.ts`, repair arm: on a settled red, a repair PR and a revert PR that `repairMerge` admits hold `merger-app-missing` with the key absent and answer `merge` with it usable. The hold fails before for the same reason.
- `packages/fleet/test/unit/auto-merge.test.ts`: `runAutoMergePass` with an injected host backend `github` and a `Merger app` reading `invalid` calls no `mergeAt` and leaves the refused map empty; with a reading that throws, it holds `merger-app-unread`. Fails before: the line at `:183` reads a non-empty key as declared and calls `mergeAt`. The slice adds the seam: `runAutoMergePass` takes the `Merger app` reader and the run log as optional parameters, defaulting to the adapters, as it takes `alive` today.
- `packages/fleet/test/unit/auto-merge.test.ts`, merge record: a merged pick appends one `merge` record with PR, head and `merged as app`; a refused pick appends `failed: <reason>`; a merger hold appends one `merge-hold` record on the first pass and none on the second pass for the same (PR, head, reason). Fails before: nothing is appended.
- `test/reconcile/github-app-absent.test.mjs` (or a sibling): `plot-merger-token.mjs --check` exits 5 with an absent key, 4 with a malformed key, 4 with an unreadable key file, 4 with an App id equal to `Writer app`, and 0 with a readable key and no network call. Fails before: `--check` is read as the repository name, and the script tries the mint.

### Docs and comments

The slice changes these in the same branch.

- `packages/domain/src/entities/repair-record.ts:18-20`: drop "an undeclared `Merger app`" from the `exhausted` reasons. No code ends an episode at `exhausted` for that reason (`git grep -i merger origin/main -- packages/domain/src` finds only this comment and the merge rule).
- `docs/stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:37` and `:175` stay true under this decision. `:37` gains the two `always` bypass actors (Admin role 5, Integration 5173644) and states that the Merger App is neither.
- `docs/review-status-rollout.md:146-151`: a column for fleetd — key absent holds `merger-app-missing`, declared and readable merges as the App, malformed or unreadable or the same App id as `Writer app` holds `merger-app-invalid` with no merge attempt. Step 4 of the Merger App section (`:205-210`) names a fleetd merge and its `merge` record as the proof.
- `skills/plot-init/SKILL.md` and `skills/plot-board-setup/SKILL.md`: for a repository on GitHub, name the `Merger app` key and link the Merger App steps in `docs/review-status-rollout.md`. Neither creates the App or writes the key. Each skill's `## Model Guidance` table and changeset bump follow.
- `CLAUDE.md` `## Plot Config`: the `Merger app` line is a person-step (step 3), because the key path is the person's. The slice does not add it.

### Live proof

After the person-steps, the next slice PR with green CI and `plot/review` success merges with no `plot-ask.mjs merge` call and no person. The evidence is a fleetd `merge` record with outcome `merged as app` whose PR and head match `gh pr view <n> --json mergedAt,mergedBy,headRefOid`, and `mergedBy` naming the App's bot. A `mergedBy` of a person's login is not evidence. The proof also confirms that `require_extra_approval_for_unattributed_changes: true` in the ruleset does not refuse the App's merge; no juror measured that.

## Person-steps

The code slice builds and its tests pass with no App installed. The live proof needs the App, and only an org owner of `plot-pm` can create it:

1. Create a GitHub App (for example `plot-merger`) with exactly these repository permissions, no webhook and no event subscriptions:
   - *Contents:* read and write — `gh pr merge` writes the merge commit to the default branch.
   - *Pull requests:* read and write — the merge is a pull request write, and `gh pr merge` reads the PR.
   - *Metadata:* read — mandatory for every App.
   - *Workflows:* read and write — GitHub refuses an App's merge of a PR that changes a file under `.github/workflows/`, and slice PRs here change `ci.yml`.
2. Install it on `plot-pm/plot` only. Do not add it to ruleset 24412719's bypass list (`docs/review-status-rollout.md:190-191`).
3. Generate a private key, save it outside the repository with mode `600`, and add `- **Merger app:** <app id> <key path>` to `## Plot Config` in `CLAUDE.md`. Its App id must differ from any `Writer app`.
4. Run `./scripts/check-agents-md.sh --write` and commit both files.

## Slices

### Merge as the Merger app

- `feature/fleetd-merges-as-the-merger-app` — `mergeIdentity` in the domain, the `plot-merger-token.mjs --check` mode and its adapter, the `SlicePrNextReadings` change, the merge records, and the changes in *Tests* and *Docs and comments* above. Buildable and testable with no App installed; the live proof runs after the person-steps. <!-- builds: the merger-identity rule, the --check reading and the merge records --> → #3085

## Notes

- Refs #2902, #3072. Origin: tracker issue #3063, filed 2026-11-03. The plan writes nothing to the tracker.
- Panel round 1: `.plot/panels/2026-11-03-fleetd-merges-no-slice-pr-while/panel.md`, unanimous amend.
- `plot-ask.mjs merge` is not changed by this plan.
- The opt-in key is rejected, so no `## Plot Config` key grants a weaker merge path. `Merger app` is still read from the working tree; a slice PR that adds it confers no bypass, because the App it names must exist, be installed, and stay off the bypass list for the ruleset to admit its merge.

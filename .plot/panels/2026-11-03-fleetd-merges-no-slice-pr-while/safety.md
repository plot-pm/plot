# Safety juror: fleetd merges no slice PR while no Merger app is declared

Position: amend

## Summary

The plan names the defect correctly and its line references hold. It leaves the safety decision open, and two of its premises are wrong: option 1 puts the Merger App on the bypass list, which the repository's own setup doc forbids, and open question 3 asks for a `plot/review` re-read that `mergeAt` already makes. The real gap on the signed-in path is different: with the admin bypass, GitHub stops checking that `plot/review` came from the Review app and that `validate` exists, and the controller checks neither by identity or by name. Option 2 as written can merge a PR with a HIGH. Option 3 is acceptable only with the amendments below.

## Findings

1. **Line references are true.** `packages/fleet/src/shared/auto-merge.ts:183` sets `mergerAppMissing: backend.value === 'github' && readConfig(opts, MERGER_APP_KEY, '') === ''`. `packages/domain/src/rules/slice-pr-next.ts:346` holds `merger-app-missing`. Existing tests: `packages/domain/test/slice-pr-next.test.ts:405-408`, `packages/fleet/test/unit/auto-merge.test.ts:126`. `plot-host.sh:4438-4441` merges with `GH_TOKEN=<merger token>` when the key exists and as the ambient `gh` login otherwise, always with `--match-head-commit`.

2. **The ruleset, read live.** `gh api repos/plot-pm/plot/rulesets/24412719`: required checks `validate` (integration 15368) and `plot/review` (integration 5317669, the Review app); bypass actors RepositoryRole 5 (admin) `always` and Integration 5173644 `always`. Under an App merge with no bypass, GitHub itself refuses a head whose `plot/review` from App 5317669 is not success or whose `validate` is missing. Under an admin merge, GitHub enforces neither.

3. **Option 1 is misdescribed, and the misdescription is unsafe.** Plan line 36: "The App needs a place in the ruleset's bypass list." `docs/review-status-rollout.md:181-194` says the Merger App "is NOT on the bypass list, anywhere, ever" and "A bypass-listed merger recreates #1730 under a different name." A Merger App merging a green, reviewed PR needs no bypass. An agent that builds option 1 or 3 from this plan text would add the App to the bypass list and reopen D4 under the App's name.

4. **Open question 3 is already answered, and the real gap is the creator.** `packages/domain/src/workflows/merge.ts:209-213` refuses `review-not-passed` unless `plot/review` reads `success` on the pinned head; `mergeAt` re-asks `host.prReview` (`merge.ts:364-378`). But the read binds no creator: `plot-host.sh:4394-4395` takes `[$st[] | select(.context == "plot/review")][0]`, the newest status of that context from any writer. Every agent the fleet starts runs with the operator's `gh` login and `--permission-mode bypassPermissions`, and that login can `POST /statuses/<sha>` with `context=plot/review`. The only rule against it is prose (`.claude/agents/unblocker.md:28`). So on the signed-in path: the Review app writes `failure` (a HIGH), any other identity writes `success` after it, `slicePrNext` and `merge()` both read `success`, and an admin merge lands a PR with a HIGH. On the App path the ruleset's `integration_id: 5317669` binding refuses the same PR at the host.

5. **`validate` is not checked by name.** `merge()` requires `pr.checks === 'green'` bound to the head (`merge.ts:202-207`). `checks` is the rollup colour (`plot-host.sh:708`: no bad, no wait, non-empty → green). A head whose rollup is green without a `validate` context reads green. The ruleset would hold it; an admin merge would not. `validate` runs on every `pull_request` today (`ci.yml:2166-2169`, `if: !cancelled()`), so this is a latent gap, not a measured one.

6. **The release PR stays refused.** `merge.ts:193-195` refuses a `changeset-release/` head as `release-pr` unless `viaReleaseApprove`, and `mergeTick` calls `mergeAt(ports, pr, head)` with the default `false` (`auto-merge.ts:115`). The signed-in path does not change that. The plan does not say so; it should, with a test.

7. **Red main, wrong head and the repair arm stay refused.** `merge()` refuses `head-moved` (`:199-201`), `default-branch-red`/`-stale`/`-unsettled`/`-unread` (`:214-247`), and admits only the repair record's PR on red. fleetd passes `requireReading: true` and `caller: 'fleetd'` (`auto-merge.ts:169-170`). These hold on either identity, because they are controller refusals, not ruleset rules.

8. **The opt-in key is writable by an agent.** `readConfig` reads `## Plot Config` through `scriptsShell` from `opts.repoRoot` (`packages/fleet/src/shared/config-reader.ts:41-44`), the working tree of fleetd's checkout. A slice PR can add the line to `CLAUDE.md`, and nothing gates a `## Plot Config` edit the way `plot-state-gate.sh` gates `State:`. Open question 2 also asks whether `plot-init` or `plot-board-setup` proposes the key. The weaker path must be a person's recorded choice, so neither should propose it.

9. **Attribution.** On the signed-in path the merge is the operator's: GitHub records `jwloka` as merger. Plan line 49 leaves this open. `/plot-reconcile` 20a (`docs/review-status-rollout.md:93-100`) reports a merge without a passing `plot/review`, but it cannot tell a fleet merge from a hand merge.

10. **A safer option is missing.** Fleetd can merge as a signed-in identity that is not a bypass actor: a machine user or fine-grained token with write but not admin. The ruleset then applies in full with no App. The plan's three options omit this, and it is the one that removes the exposure without App setup.

11. **Bitbucket.** Plan line 40 says option 2 "would make GitHub match" Bitbucket. Nobody has measured whether the `bb` identity is exempt from Bitbucket branch restrictions, so "match" claims nothing about safety. The plan should say the Bitbucket arm is unchanged and not argued from.

## Required amendments

1. Rewrite option 1: the Merger App is never on a bypass list; cite `docs/review-status-rollout.md:181-194`.
2. Replace open question 3 with the creator binding: on the signed-in path, the `plot/review` reading that `mergeAt` uses must name the Review app as its creator (the status's `creator` is `<review-app-slug>[bot]`, or the App id from `Review app`). A `success` from any other creator refuses by name (for example `review-unbound`). Name the slice that changes `plot-host.sh pr-review` or the domain reading, and keep the Bitbucket arm's answer explicit.
3. On the signed-in path, require each required context by name and bound to the head: at least `validate` success. Either read the ruleset's `required_status_checks` from the host or take the names from a config key; a missing context refuses by name.
4. If option 3: the opt-in key is never proposed by `plot-init` or `plot-board-setup`, has no default, and is read from the committed `## Plot Config` on `origin/<default>`, not the working tree. A key change in a slice PR is a person's merge, by the plan's own rule.
5. State the identity: fleetd records the login it merges as (one `gh api user` read per pass, or the token's login) in its action log, and the merge carries a fleet marker (a merge-commit body trailer or a `pr-comment`) so a person tells a fleet merge from a hand merge.
6. Add tests that fail before and pass after: (a) signed-in path, App `failure` then a non-App `success` on the head → refused; (b) signed-in path, rollup green with no `validate` → refused; (c) signed-in path, `changeset-release/` head → `release-pr`; (d) key absent → `merger-app-missing` unchanged; (e) key present in the working tree only → still held.
7. Add the non-admin machine identity as option 4 and weigh it against 1 and 3.

## Decisions that need a person

- Which option. The safety lens ranks them: 1 or 4 (ruleset applies in full), then 3 with amendments 2-5, and rejects 2 (D4 reverted with no replacement check).
- Whether the operator accepts merges attributed to their own admin account at all.
- Whether to narrow the ruleset's admin bypass (RepositoryRole 5, `always`) and what Integration 5173644 is and why it holds `always`. Both are repository settings, not code.

## What I ran versus read

Ran (read-only): `gh issue view 3063`; `gh api repos/plot-pm/plot/rulesets` and `.../rulesets/24412719`; `git show origin/main:` and `git grep` over `auto-merge.ts`, `slice-pr-next.ts`, `workflows/merge.ts`, `config-reader.ts`, `plot-host.sh`, `ci.yml`, `docs/review-status-rollout.md`, the #2902 plan and earlier panel files. Read only: the plan file and the juror brief. Ran no test, no host write, no fleet or board command; findings 4 and 5 are read from code, not reproduced.

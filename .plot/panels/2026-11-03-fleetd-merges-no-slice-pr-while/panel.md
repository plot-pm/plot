# Panel — fleetd merges no slice PR while no Merger app is declared

Subject: `docs/plans/2026-11-03-fleetd-merges-no-slice-pr-while.md` (`ba53e43d8`, plan PR #3068, issue #3063)
Convened: 2026-11-03, round 1, against `origin/main`; findings re-checked at `abedcfb49`
Lenses: layering, safety, testability, seams — four jurors, one rubric, persona varied only.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | read (`git show`, `git grep` on `origin/main`) |
| safety | **amend** | read, plus the live ruleset (`gh api .../rulesets/24412719`) |
| testability | **amend** | read |
| seams | **amend** | read, plus the live ruleset, repo permissions and org installations |

All four gated with a committed position. No hedges. Reconcile: `unanimous amend layering,safety,testability,seams`.

## Where all four agree

**1. The plan's code claims hold.** `auto-merge.ts:183` computes `mergerAppMissing` from the backend and a non-empty `Merger app` string; `slice-pr-next.ts:346` holds `merger-app-missing`; `plot-merger-token.mjs:37` prints the signed-in notice. Re-checked on `origin/main` at `abedcfb49`.

**2. The option is a person's decision, and the slice cannot start while it is open.** An unattended agent cannot choose between the App, the admin identity and an opt-in key, and cannot write a failing-first test for an undecided rule.

**3. Open Question 3 already has an answer.** `mergeAt` re-asks `ports.host.prReview(pr)` (`merge.ts:364-378`), and `merge()` refuses `review-not-passed` unless `plot/review` reads `success` on the pinned head (`merge.ts:209-213`). Every caller passes through it.

**4. A failed config read must hold.** `readConfig` answers its fallback for an absent key and for a failed read. Testability and seams name it directly; layering and safety reach it through the key's semantics.

**5. Board impact is none.** No file under `packages/board/src` reads `merger-app-missing`.

## Where they differ

These are differences in what each juror found or required. The moderator records them and does not average them.

- **Option 1 needs no bypass entry.** Safety and seams found that the plan's option 1 text contradicts `docs/review-status-rollout.md:181-196`: the Merger App is never on the bypass list, and a bypass-listed merger recreates #1730. Layering repeated the plan's wording without testing it; testability did not address it.
- **The decision lives in the fleet package.** Layering and testability require a pure domain rule over raw values with a matrix test, because no test reaches `auto-merge.ts:183` (`auto-merge.test.ts` injects the boolean; `auto-writes.test.ts:28` stubs the pass). Safety and seams do not raise the placement.
- **Two readers of `Merger app` disagree.** Only layering found that a malformed key passes fleetd's non-empty check, fails in the adapter with exit 4, and stalls the PR as `host-refused` until its head moves. It offered a shared validity reading as optional.
- **The `plot/review` creator.** Safety and seams found that `pr-review` takes the newest `plot/review` status from any writer (`plot-host.sh:4395`), so on the admin path a forged `success` merges a PR with a HIGH. Both rank it HIGH for options 2 and 3; it is now #3072. Layering and testability did not read the creator.
- **`validate` by name.** Only safety found that `merge()` checks the checks rollup colour and not `validate` by name; the ruleset checks it for a non-bypass identity.
- **Repair and revert PRs.** Layering found that the merger hold comes after the repair admission, so any option also decides how a repair or revert PR merges on a red main, and that `repair-record.ts:18-20` lists an `exhausted` reason no code produces. Seams found the same stale comment.
- **Observability.** Testability found that fleetd appends nothing to the action log on a merge or a hold (`auto-writes.ts:92` discards the result), so no live run can tell a fleetd merge from a hand merge under the admin identity. Safety asked for a recorded login and a host-side marker; layering recommended no new host write because `mergedBy` exists.
- **A fourth option.** Only safety proposed a non-admin machine identity.
- **Docs left behind.** Only seams listed `DESIGN-delivery-loop.md:37` and `:175`, the table at `docs/review-status-rollout.md:146-151`, `check-agents-md.sh --write`, and the silence of `plot-init` and `plot-board-setup` about the key. Seams also named the second `always` bypass actor, Integration 5173644 (`plot-board-builder`).

## What each juror ran and what it only read

- **Layering** ran `gh issue view`, `gh pr view`, `git fetch`, `git show` and `git grep`. It did not execute the malformed-key path; it derived it from code.
- **Safety** ran `gh api` on the rulesets and the same `git` reads. It reproduced neither the forged-status path nor the `validate`-by-name gap.
- **Testability** ran `git fetch`, `git show` and `git grep`. It ran no test, so "passes before the change" is from reading test bodies.
- **Seams** ran `gh api` on the ruleset, repo permissions, `apps/plot-review` and the org installations. It did not verify whether `require_extra_approval_for_unattributed_changes: true` refuses an App's merge.

No juror ran a test, a fleet command, a board command or a host write.

## What the lenses shared, and could have missed together

- **No juror executed a merge.** Every claim about what GitHub refuses for an App or admits for an admin comes from the ruleset JSON and the rollout doc, not from a merge attempt.
- **No juror measured the App's permissions.** None listed what `gh pr merge` needs as an App, so the `Workflows` permission for a PR that changes `.github/workflows/` was raised by the moderator, not a juror.
- **`require_extra_approval_for_unattributed_changes: true` is unmeasured.** Seams named it; nobody tested whether it refuses an App merging a head with commits from another identity.
- **Bitbucket is read, not measured.** All four agree the Bitbucket arm is unchanged; nobody measured whether the `bb` identity bypasses Bitbucket merge checks.
- **All four read `## Plot Config` from the working tree.** Only safety named that a slice PR can add a key; under the App that key confers no bypass, but no juror tested it.

## The person's decisions

jwloka decided on 2026-11-03, after this round:

1. **Option 1, a Merger App.** fleetd merges as a narrow GitHub App declared as `Merger app`. The App is not on the ruleset's bypass list, so `validate` and the Review app's `plot/review` bind every fleet merge. Option 2 (signed-in admin identity) and option 3 (an opt-in key) are rejected. The plan's claim that option 1 needs a bypass entry is corrected.
2. **Attribution: no new host write.** `mergedBy` names the App; fleetd appends one action-log record per merge attempt and one per first merger hold.
3. **Repair and revert PRs merge through the same App path**, with a test, and the stale `repair-record.ts:18-20` comment is fixed.

The safety lens's fourth option (a non-admin machine identity) is not adopted; option 1 removes the same exposure and keeps the merge attributed to a bot.

## Disposition

Amend. The plan is amended in round 1: the decision is recorded; the merge-identity rule moves into the domain with a matrix test; fleetd reads `Merger app` through the adapter's validity check, so a malformed key holds as `merger-app-invalid` and a failed read holds as `merger-app-unread`; Open Questions 1 to 4 are closed with citations; the merge records, the test list, the docs list, the person-steps for the App and the live proof are named; #3072 is cited as related and not a precondition. The slice branch is `feature/fleetd-merges-as-the-merger-app`.

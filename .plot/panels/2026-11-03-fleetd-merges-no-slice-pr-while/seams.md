# Seams juror: fleetd-merges-no-slice-pr-while

Position: amend

## Summary

The plan names the right defect and the right three options. Its description of the edges is wrong in two places and incomplete in three. Option 1 is described as needing a bypass-list entry, which the setup doc forbids. The plan says the signed-in path has "no ruleset check in between", but omits that `merge()` already re-reads checks and `plot/review` on the pinned head, and it omits the one thing the ruleset adds that `merge()` does not: the `plot/review` status must come from the plot-review App (integration 5317669). The slice also leaves a design spec, a domain comment and the AGENTS.md mirror behind.

## Findings

1. **Option 1 misstates where the Merger App goes (factual error).** Plan line 36: "The App needs a place in the ruleset's bypass list". `docs/review-status-rollout.md:181-196` (origin/main) says the opposite: the Merger App "is NOT on the bypass list, anywhere, ever", and step 2 says "A bypass-listed merger recreates #1730 under a different name." Option 1 works without a bypass entry because ruleset 24412719 requires 0 approvals (`required_approving_review_count: 0`) and two status checks, `validate` (integration 15368) and `plot/review` (integration 5317669). A non-bypass App merges once both are green. A reader who follows the plan's wording would add the App to the bypass list and recreate #1730.

2. **The ruleset has two `always` bypass actors, not one.** `gh api repos/plot-pm/plot/rulesets/24412719` answers `RepositoryRole 5` (Admin) and `Integration 5173644` (`plot-board-builder`, from `gh api orgs/plot-pm/installations`), both `bypass_mode: always`. The plan names only the Admin role (lines 26, 36, 37). `docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md:158` already names both. The plan should name both, and state that the signed-in identity here is admin (`gh api repos/plot-pm/plot` answers `admin: true`).

3. **The controller already enforces what Open Question 3 asks.** `packages/domain/src/workflows/merge.ts` refuses `checks-not-green`, `checks-unbound` and `review-not-passed`; the review reading is "re-asked through the host and never folded from the checks rollup" (merge.ts, `MergeReadings.review`) and must name the pinned head. So Open Question 3 has an answer on main: yes, and it exists. The plan should say so, because it changes the weight of option 2: the signed-in path is not "no check", it is "the controller's check without the ruleset's check".

4. **What the ruleset adds and the controller lacks: the identity behind `plot/review` (HIGH for options 2 and 3).** The ruleset binds `plot/review` to `integration_id: 5317669`. The controller's read does not. `plot-host.sh pr-review` on GitHub (origin/main, the `gh api repos/{owner}/{repo}/commits/<sha>/statuses` arm just above `pr-create`) takes `[$st[] | select(.context == "plot/review")][0]` and checks no creator. `git grep` over `plot-host.sh` and `packages/domain/src/adapters` finds no `creator`, `integration_id` or `plot-review[bot]` filter, and the controller gate (`controller-gate.ts`, `entry/gate.ts`) names `plot/review` zero times. Fleet desks run under the same `gh` login as fleetd. Any process with repo write, a desk agent included, can post a `plot/review` `success` status to its own head with one `gh api` call. Under option 1 the ruleset refuses that merge, because the status does not come from App 5317669. Under options 2 and 3 the admin bypass skips the ruleset, `merge()` reads `success`, and fleetd merges unattended. Today that exposure exists only for an attended `plot-ask.mjs merge`. The plan moves it to an unattended path and does not name it.

5. **A failed config read must hold, whichever key option 3 adds.** `readConfig` (`packages/fleet/src/shared/config-reader.ts`) answers the fallback when a key is absent and when the read fails. `auto-merge.ts:183` is safe today because the fallback `''` reads as "missing", which holds. An opt-in key for option 3 needs the same property: absent, unreadable or any value except the exact opt-in word reads as not opted in, so `merger-app-missing` still holds. The plan does not say this.

6. **Docs and comments that describe who merges, and which the slice does not list.**
   - `docs/stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:37` says "No fleet merge bypasses the ruleset … fleetd merges on GitHub only when the `Merger app` key is declared", and `:175` records it as jwloka's decision after the panel round. Options 2 and 3 contradict a binding design spec. The slice lists only `docs/review-status-rollout.md`.
   - `docs/review-status-rollout.md:153` says "Declare `Merger app` to close it". Option 3 needs a third row in the table at `:146-151` for the opt-in key.
   - `packages/domain/src/entities/repair-record.ts:20` lists "an undeclared `Merger app`" as a reason for `exhausted`. `git grep` finds no code that does this; the comment is already stale, and the slice touches the same rule.
   - `CHANGELOG.md:70` (#2961) and the sprint line `docs/sprints/2026-W44-delivery-loop.md:23` ("only through a Merger app") are history and need no change.

7. **A new key in this repository's `## Plot Config` touches two gates.** Adding it to `CLAUDE.md` requires `./scripts/check-agents-md.sh --write`, because CI refuses an `AGENTS.md` mirror that differs. A Sonnet agent will not know this from the plan.

8. **Adopting repositories.** `git grep` over `skills/plot-init` and `skills/plot-board-setup` finds no mention of `Merger app`, `Writer app` or `Review app`'s merge role, so no adopting repository is ever told about either the App or a new opt-in key. Open Question 2 asks whether one of them proposes it; it needs an answer, or the key stays known only to this repository.

9. **Bitbucket claims hold.** `auto-merge.ts:183` gates the read on `backend.value === 'github'`; `hostPinsMerges` (`merge.ts:268`) answers `true` for every backend; `plot-host.sh pr-merge`'s Bitbucket arm re-reads the head and refuses `head-moved`. So fleetd merges on Bitbucket today as the `bb` identity, as the plan says. The plan does not measure whether that identity bypasses Bitbucket merge checks; Bitbucket Cloud has no ruleset equivalent to bind `plot/review` to an identity, so finding 4 applies there already. That is not this plan's defect, but option 2's "make GitHub match Bitbucket" argument inherits it.

10. **Board impact note holds.** No file under `packages/board/src` reads `merger-app-missing` or `mergerAppMissing` (`git grep`, excluding the generated bundle).

## Amendments required

1. Rewrite option 1: the Merger App is not added to the bypass list; it merges because the ruleset requires 0 approvals and `validate` + `plot/review` green. Cite `docs/review-status-rollout.md:181-196`.
2. Name both `always` bypass actors (Admin role 5, Integration 5173644 `plot-board-builder`) and that the signed-in identity is admin.
3. Answer Open Question 3 from the code: `merge()` already refuses `review-not-passed` on the pinned head. Replace it with the real question: on the signed-in path, does the controller verify that `plot/review` was written by the `Review app` (App 5317669, `plot-review[bot]`)? If option 2 or 3 is chosen, the slice adds that check to the `pr-review` read (GitHub: the status `creator` / `performed_via_github_app` must match the `Review app` id) and a refusal word for a mismatch, with a test that posts a `plot/review` `success` from another creator and expects no merge.
4. For option 3, state that the opt-in reads only an exact value and that absent, unreadable or other values hold `merger-app-missing`, with a test for the unreadable case.
5. Add to the slice: `DESIGN-delivery-loop.md:37` and `:175`, a new row in `docs/review-status-rollout.md:146-151`, the stale `repair-record.ts:20` comment, and `./scripts/check-agents-md.sh --write` when the key enters `CLAUDE.md`.

## Decisions that need a person

- Which option. `DESIGN-delivery-loop.md:175` records "fleetd merges on GitHub only with a declared `Merger app`" as jwloka's decision, so options 2 and 3 overturn a person's recorded decision. An agent must not choose.
- Whether to create and install the Merger App for plot-pm/plot (option 1 or the App half of 3). Only an org owner can do that.
- Whether `plot-init` proposes the opt-in key to adopting repositories.

## Ran versus read

Ran (read-only): `gh issue view 3063`; `gh api repos/plot-pm/plot/rulesets`, `.../rulesets/24412719`, `repos/plot-pm/plot` (permissions), `.../branches/main/protection` (404, no classic protection); `gh api apps/plot-review`; `gh api orgs/plot-pm/installations`; `git fetch`; `git grep` for `Merger app`, `mergerAppMissing`, `merger-app-missing`, `Auto-review`, `plot/review` in the gates, and creator filters; `git show` of the files below.

Read on origin/main: `packages/fleet/src/shared/auto-merge.ts`, `packages/fleet/src/shared/config-reader.ts`, `packages/domain/src/rules/slice-pr-next.ts:80-115,295-370`, `packages/domain/src/workflows/merge.ts:25-80,178-268`, `packages/domain/src/entities/repair-record.ts:1-40`, `skills/plot/scripts/plot-host.sh` (`CHECKS_OF`, `pr-review`, `pr-merge`), `skills/plot/scripts/plot-merger-token.mjs` (head), `docs/review-status-rollout.md:120-230`, `skills/plot/scripts/README.md` rows for `plot-host.sh` and `plot-push-main.sh`.

Not verified: whether `gh pr merge` as an admin passes `require_extra_approval_for_unattributed_changes: true` on a PR whose head carries a commit from another identity; the issue's report that `plot-ask.mjs merge` succeeded as the signed-in identity is the only evidence. No test suite, host write, fleet or board command was run.

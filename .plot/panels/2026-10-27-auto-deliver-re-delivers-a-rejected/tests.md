# Juror: tests

Lens: the proof. Does each slice's acceptance fail on today's code, do the fixtures make the old and new arms disagree, and is a corpus pair needed?

Position: amend

## 1. The problem

- **Ran** `gh pr view 2422 --json files,commits,mergedAt`: `files: []`, two commits (`plot: claim bug/plot-host-bitbucket-pr-list-reads`, `…: blocked on bb pr list --all`), `mergedAt 2026-10-26T14:19:47Z`, merge commit `eede90c78`.
- **Ran** `git show -m --first-parent --name-only eede90c78`: no file. The merge gave main nothing.
- **Ran** tree-vs-parent-tree for both PR commits: both have tree `58a30942…` equal to their parent's tree. Both are empty commits.
- **Read** `git log` on the plan file: deliver `b2df79eaf` 15:21:07 +0100, reject `6666041ff` 15:38:04 +0100, deliver `c67b5cd1f` 15:38:47 +0100. The issue's "14:19 UTC" for the first delivery is the PR's merge time, not the delivery commit (15:21 +0100 = 14:21 UTC). Minor.
- **Read** `packages/domain/src/rules/auto-deliver.ts:340-395`: `isDeliverable` checks phase, in-flight, `allSlicesConfirmed`, `landedBranches > 0`, and `retryVerdict`. Nothing reads a `Rejected:` record or what a merged PR changed. The account holds.

## 2. The approach against the code — what the tests would be built on

- **Read** `packages/domain/src/entities/fleet.ts:174-721`: `BranchSchema` and `PlanSchema` carry no `Rejected:` date, no `mergedAt`, and no reading of what a merged PR changed. `planAutoDeliver` reads only the pulse (`auto-deliver.ts:30-42` states this as a design choice). So both slices need a NEW pulse field filled by `plot-fleet-scan.sh`. The plan says "adds no plan field and no helper script" and "Board impact: none expected"; it does not say that the pulse schema and the scan change. That is where the tests must also go.
- **Slice 2's definition is wrong in two ways.**
  - **Read** `ls .plot/` on main: there is no `.plot/claims/` directory. **Read** `packages/domain/src/rules/empty-claim.ts:5-8`: a claim marker is an empty commit titled `plot: claim …`. "A diff that holds only `.plot/claims/`" describes nothing that exists, so a test built on it has no real arm.
  - **Ran** the check above: `isEmptyClaim` is true for `d92e323f9` and false for `f576060de` (subject does not start with `plot: claim `). So `realCommits` on PR #2422 answers 1, and "reuse the merge watcher's definition" — if that means `realCommits`/`ClaimAnswer` (`rules/claim.ts:47-48`) — reads #2422 as `work` and does NOT catch the incident. **Ran** grep for "changes no file beyond its claim" / "merge watcher" in `packages/*/src` and `skills/plot/scripts`: no merge-side refusal with that text exists. The plan cites a mechanism I cannot find.
  - The definition that catches #2422 is file-based: the merge commit's first-parent diff is empty (`Refs.commitFiles`, `refs-git.ts:495`, which CLAUDE.md names as *what did MAIN gain*), or the host's PR file list is empty. That needs the merge SHA per branch on the pulse, which the pulse lacks.
- **Trap in the existing field.** **Read** `plot-fleet-scan.sh:4931-4942`: `changed_paths` is `[]` whenever `conflicts_known` is false ("Not looked at, so nothing is claimed"), and `changed_paths_of` (`:2354`) is a three-dot diff against `origin/<branch>`, which is meaningless after the remote ref is deleted. An implementation that reads `changed_paths: []` as "claim-only" would hold every merged plan. Default fixtures in `packages/fleet/test/unit/auto-deliver.test.ts` (64 tests) and `packages/domain/test/auto-deliver.test.ts` (43) never set `changed_paths`, so such a bug flips every existing "delivers" case — the suite would catch it only if the new field is not defaulted to the claim-only answer. The new reading must be tri-state (`changed` / `none` / `unknown`), and the plan must say which one a pre-field pulse reads as.

## 3. Safety (tests view)

- Both holds move toward NOT delivering, which is the reversible direction: a person can still run `/plot-deliver`. No ref is deleted by a hold.
- The risk is a hold that never lifts. Slice 1's "until a branch merges after that date" compares a day (`Rejected: 2026-10-26`, local date written by `plot-undeliver.sh:130,154`) with a timestamp. In the incident the PR merged 14:19Z and the rejection came 14:38Z, the SAME day. A day-granular `>` holds the incident but also holds a real fix merged later that day until another merge happens on a later day — possibly never. A `>=` lets the incident re-deliver. The acceptance test must pin the same-day case both ways, or it proves nothing about the incident.
- **Read** `plot-undeliver.sh:124-157`: the `Rejected:` line is written right after `State:`, replaced in place on a second reject, and the `Delivered:` line is removed. "Latest Status record" by position is therefore `Rejected:` after a reject, but `/plot-implement` appends a `Started:` record for a re-opened slice. Whether a later `Started:` lifts the hold must be a named fixture.

## 4. Slices against Changelog and acceptance

**Slice 1 (`bug/auto-deliver-holds-a-rejected-plan`).** Acceptance: "reject a delivered plan with all slices merged, run the pass, assert no delivery."
- Fails on today's code: yes, but only once a pulse field exists — today the fixture cannot express a rejection. The test must name the field.
- Arms disagree: only if the fixture's merge precedes the rejection on the same day, as in #2400. A fixture with the merge on an earlier day passes for both `>` and `>=` and for a "carries any Rejected record" rule. Required fixtures: (a) merge 2026-10-26T14:19Z, Rejected 2026-10-26 → no delivery; (b) a branch merged after the rejection → delivery (proves the hold lifts; today's code and a "never deliver a rejected plan" rule disagree here); (c) no `Rejected:` record → delivery unchanged; (d) a pre-field pulse → delivery unchanged.
- Missing: a scan-level test (beside `test/reconcile/scan-*.test.mjs`) that a plan file holding `- **Rejected:** 2026-10-26 (…)` emits the field. A domain-only test passes while the scan never fills the field, and the incident recurs with every test green.

**Slice 2 (`bug/auto-deliver-ignores-a-claim-only-slice`).** Acceptance: none stated beyond the rule. No test is named.
- The fixture must be #2422's exact shape: one empty `plot: claim` commit PLUS one empty non-claim commit, zero files. A fixture with only a claim commit makes `realCommits` and a file-based rule agree, so it cannot tell the wrong reuse from the right one. This is the fixture that makes the arms disagree.
- A second fixture: a PR whose only change is a non-claim file (e.g. a `PLOT-BLOCKED.md`, or a docs line) must still count as work — or the plan must say it does not.
- Squash-merged and Bitbucket-merged PRs: the reading must come from git (`commitFiles` over the merge SHA) or from `plot-host.sh`, never from the three-dot `changed_paths`. A test with a squash fixture is needed because a squash of an empty PR may produce no commit at all on main.
- Missing: the same scan-level emission test as slice 1.

**Order.** Either slice alone stops the #2400 incident. Slice 2 is the root fix (the slice was never done); slice 1 guards every other reason a person rejects. The order is fine; neither depends on the other.

**Changelog** names both behaviours; each maps to one slice. Good.

## 5. Corpus pair and new defects

- **Read** `packages/domain/corpus/deliverable.corpus.test.ts:6-31`: four readers answer "is this plan deliverable" (`allSlicesMerged`, `plot-ask.mjs deliverable`, `plot-deliver.sh`, `planAutoDeliver`), and `planAutoDeliver` is deliberately excluded from the equality because it is stricter. If both new holds stay inside `planAutoDeliver`, no new corpus pair is needed and the exclusion comment needs one line. If Open Question 3 resolves to "the hand path gains the same check", the check enters the three compared readers, and the existing corpus test is where it is proved — not a new pair. Approach item 3 is a conditional with no slice; the plan must decide it.
- The scan field costs shell lines under `check-shell-lines.sh`; the plan must name where lines are removed, or move the reading into a bundle the scan calls.
- New tests in `test/reconcile/` must be arrows and must clear `PLOT_UNATTENDED`/`PLOT_REPO_ROOT` in their `run()`.

## Amendments

1. Replace slice 2's definition. "A diff that holds only `.plot/claims/`" describes no existing path. State it as "the merge gave the default branch no file" (first-parent diff of the merge commit, or the host's PR file list), and drop the claim that a merge watcher already refuses it — or cite the file and line.
2. Say that `realCommits`/`isEmptyClaim` is NOT the reused definition, because it counts PR #2422's blocker commit as work (ran: `f576060de` tree equals parent tree, subject is not `plot: claim `).
3. Name the new pulse fields (rejection date on the plan; per-branch merge reading with `unknown`) and the scan change that fills them. Correct "adds no plan field and no helper script / Board impact: none" accordingly, and state the shell-line cost.
4. Give each slice a scan-level emission test as well as the domain test, so the rule cannot ship with the field unfilled.
5. Pin slice 1's fixtures to the incident's same-day timings (merge 14:19Z, `Rejected:` 2026-10-26), plus a hold-lifts case, a later `Started:` record case, a timezone-midnight case, and a pre-field pulse case. Resolve Open Question 1 before approval; the tests cannot be written until it is.
6. Pin slice 2's fixture to #2422's shape (empty claim commit plus empty non-claim commit), plus one real-work case and one squash case.
7. Resolve Open Question 3 and replace Approach item 3 with a decision: either the holds stay unattended-only and `deliverable.corpus.test.ts`'s exclusion comment names them, or the hand path adopts them and that existing corpus test proves the agreement.

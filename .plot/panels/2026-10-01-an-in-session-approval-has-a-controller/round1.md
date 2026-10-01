# Moderation — an-in-session-approval-has-a-controller, round 1

Subject: `docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md` at `56a978ea` (#1088, Draft), read on `origin/main` `385d6d7d`.

Gate: `unanimous amend skeptic,gate,operator`. Each of the three verdict files names exactly one position, `amend`.

## What each juror executed and read

| Juror | Executed | Read |
|---|---|---|
| skeptic | `plot-approve.sh --who jwloka x` on an in-session Draft in a scratch repository (exit 1); `plot-controller-gate.sh` with hook JSON for `plot-approve.sh --reviewer jwloka x` (exit 2) and `plot-deliver.sh --release 2.22.3 x` (exit 0); a row count of `unowned-state-writes.tsv` | the plan, `plot-approve.sh`, `transitions/plan.ts`, `workflows/approve.ts`, `entry/transition.ts`, `workflows/release.ts` |
| gate | nothing beyond `git fetch`, `git show` and read-only `gh api` calls | the plan, `plot-approve.sh`, `transitions/plan.ts`, `workflows/approve.ts`, `workflows/release.ts`, `entry/transition.ts`, the board's `index.ts` and `approve.ts` |
| operator | nothing beyond `git show`, `git grep` and counts over the TSV | the plan, the TSV, `plot-approve.sh`, `plot-controller-gate.sh`, the board's `approve.ts`, `workflows/release.ts`, `plot-release/SKILL.md`, `plot-approve/SKILL.md`, the three named test files, `.plot/briefs/a-release-is-a-controller-command.md` |

Only the skeptic ran the scripts. The two gate findings (the refusal of the skill route, and the `--release` pass-through) therefore rest on one execution and two readings that agree with it.

## Agreed

- The motivation counts are true: 237 rows, of them 109 `Approved`, 112 `Released`, 11 `Rejected` and 5 `Superseded`. The operator adds that the 109 `Approved` rows name 97 distinct plans, all `Review: in-session`.
- `--who` already exists (`plot-approve.sh:3`, `:115`, `:293`) and defaults to `git config user.name`. A second flag `--reviewer` duplicates it (all three).
- `workflows/approve.ts` `ApproveInput` (`:65-70`) holds `on` and `who` only. The PR switch at `:169-182` answers `pr-absent` for a plan with no PR, and `:208-210` builds the channel from the PR number. The plan's claim that the workflow "applies the same rule" fails without a `channel` input and a skip of the PR checks (all three).
- `plot-controller-gate.sh:83-84` gates `plot-approve.sh` and `plot-deliver.sh`. The plan names neither the gate nor a route through it (skeptic, operator; the gate juror's finding A depends on it).
- `--release` must record each plan's own tag, as `workflows/release.ts:277` does with `normalizeVersion(plan.tag)` (gate, operator).
- The path of `entry/transition.ts` is `packages/board/src/server/entry/transition.ts` (all three).

## Required changes, by juror

- skeptic: fold `--reviewer` into `--who`; give the workflow a `channel` input or drop the parity claim; name the controller gate and its route; make the ` --release ` exemption deliberate and test it; state that the sprint annotation step runs; correct the line numbers and the path; align the Delivered-only refusal with the domain's idempotent `released` case.
- gate: append every in-session approval to a counted log; refuse under `PLOT_UNATTENDED=1` and on the `Approve command` arm; refuse an empty reviewer or one not declared in `People`; never default the reviewer from `git user.name`; specify the workflow's in-session path; check `git tag --contains` the merge commit; correct the path.
- operator: name the controller gate and choose a route (`/api/approve` with the reviewer, `/api/deliver` or a named route for the release); specify the workflow skip with a no-PR unit case; name the reviewer's source and how it reaches the agent arm; specify the per-plan version and the date; name the overlapping brief.

## Disagreements

- **`transitions/plan.ts` line numbers.** The skeptic reports the arm at `:253-259`, "off by 4". The gate and operator jurors confirm `:257-262`. Measured on `origin/main` `385d6d7d`: the `switch (plan.review)` opens at `:253`, and the `in-session`/`ballot` arm runs `:257-262`. The plan's range is correct; the skeptic counted from the `switch`. The amendment keeps `:257-262`.
- **Scope of `Released`.** The gate juror says `Released` is outside #1088 and widens the change. The skeptic and operator accept it and ask for it to be specified. The amendment keeps `Released`, because the 112 `Released` rows are the larger half of the counted bypass, and specifies the route, the version and the date.

## Shared blind spot

No juror asked what the brief `.plot/briefs/a-release-is-a-controller-command.md` delivered. It shipped as #848 (`96c20470`), which built the sprint gate in front of a release (`plot-release-gate.sh`), not the `Released` write. `plot-release/SKILL.md:404-409` still names that slug as the work that closes the `Released` gap. The amendment states the relation and rewrites that sentence. No juror asked how a shell script reads the `People` key either: only `packages/board/src/server/server-info.ts:169` parses it today.

## What an amendment changes

The plan drops `--reviewer` and requires an explicit `--who` for in-session; adds a domain refusal for an empty or undeclared reviewer; adds an unattended refusal in the script and on the board's agent arm; adds the counted log `.plot/state/in-session-approvals.tsv`; routes approval through `POST /api/approve` with `who` and the release through a new `POST /api/release`; scopes the gate's ` --release ` exemption to `plot-dispatch.sh`; adds `channel` and `people` to the workflow input with a no-PR unit case; resolves each plan's version and tag date from `git tag --contains`; names the overlapping brief; corrects the line numbers and the path; and adds tests for self-approval, the unattended refusal and the gate route. The two slices stay.

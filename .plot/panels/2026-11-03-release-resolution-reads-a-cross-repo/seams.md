# Juror: seams

Position: amend

The defect is real and the direction (release reads this repository's PRs only) is right. The plan misplaces half of the fix: `--release` is TypeScript, not shell, and the domain already holds the repository qualifier. It also leaves the deferral seam, the "this repository" identity and the all-foreign arm to an unattended agent.

## Findings

### F1. `--release` picks its PR in the domain, and the plan does not name it

- `skills/plot/scripts/plot-deliver.sh` is a 13-line launcher that `exec`s `board/plot-deliver.mjs`.
- The release arm is `packages/board/src/server/entry/deliver.ts:806`: `releasePr(parsed.value.prs, parsed.value.deferredPrs)`.
- `releasePr` is `packages/domain/src/rules/release-tag.ts:30`. It takes the highest non-deferred number. Its tests are `packages/domain/test/release-tag.test.ts`.
- The plan's design point "whether the rule is shared with the TypeScript side … or duplicated in shell" reads the TS side as optional. It is the `--release` path itself. The slice must change `releasePr` (or its input), and the plan names neither the file nor the function.

### F2. The qualifier already survives in the domain

- `packages/domain/src/rules/cross-repo-reference.ts:56` `branchClaims` returns `{ repo, number }` per claim, with `repo: ''` for this repository. `crossRepoReferences` (`:94`) filters the foreign ones.
- `plot-impl-status.sh` reads claims through `board/plot-slice-claims.mjs` → `branchClaims` (its header, lines 50-70), and `deliverability.ts:299` reads `crossRepoReferences`.
- The plan's first design point ("carry the qualifier through the awk parser or add a separate list") ignores this reader. Reusing `branchClaims` is the route that makes release agree with delivery by construction, which is the plan's fourth design point.

### F3. Claims about the parser are partly false

- "The awk parser in `plot-plan-meta.sh` and `plot-reconcile-scan.sh`": the scan has no parser. It calls `plot-plan-meta.sh` once (`plot-reconcile-scan.sh:662`) and reads `.prs` through `jq` (`:663-666`).
- "takes the last PR number": `prs` is sorted ascending and deduplicated (`plot-plan-meta.sh:663`, `sorted_insert` at `:396-401` returns early on an equal value). "Last" means "highest number", not the last line of the plan. `releasePr`'s TSDoc says so; the plan's Approach ("take the last of the remaining PRs") does not.
- `extract_prs` (`plot-plan-meta.sh:1049-1057`) matches `owner/repo#N` and keeps `N` only. The comment at `:1037-1041` states this on purpose: "callers ask which PRs are the evidence, and plot-host.sh resolves where each lives". The release callers do not resolve where each lives.

### F4. The number-only lists cross-contaminate, and the plan does not name it

- Deduplication: `→ #33` and `→ owner/other#33` become one entry `33`.
- Deferral: `dprs` holds bare numbers (`:1052`). A deferred `→ owner/other#33 <!-- deferred -->` puts `33` into `deferred_prs`, and `releasePr` then drops the local, shipped `#33` (`release-tag.ts:31`). The result is `''`, a refusal on a plan that has a valid local PR.
- So "skip foreign entries in `prs`" cannot be built on today's `prs`/`deferred_prs` fields. The rule needs per-reference `(repo, number, deferred)`. `branchClaims` carries the repo but not the deferral, so the slice must decide where deferral is read. This decision is absent.

### F5. Section 6 and `releasePr` already disagree, an undeclared duplicate

- Section 6 takes `${prs##*,}` (`plot-reconcile-scan.sh:3481`) and does not skip deferred PRs.
- `releasePr` skips them.
- A plan whose highest PR is deferred gets one PR from the scan and a different PR from `--release`. The plan adds a second rule ("this repository only") to both sides without making them one rule. Per CLAUDE.md "A Shell Script Asks The Domain": the scan runs once per operator command, so it should ask the domain, not duplicate it. Duplicating it in awk also adds shell lines that `scripts/check-shell-lines.sh` refuses unless the same change removes as many. The plan names neither the ratchet nor the corpus tier as a decision.

### F6. "This repository" needs no identity if the existing convention holds

- `plot-impl-status.sh` treats every qualified `owner/repo#N` as foreign (the `[ -z "${REF%#*}" ]` test in its index-query loop, near line 137), and `crossRepoReferences` does too. Neither compares a qualifier against the remote.
- `plot-host.sh` has no free subcommand that answers this checkout's `owner/repo`. GitHub needs `gh repo view` (a network call, `plot-host.sh:4438`). Bitbucket would parse the remote's `workspace/slug` (lowercase slug, SSH and HTTPS forms). A fork's `origin` names the fork, and a renamed GitHub repository keeps the old name in old plans.
- `git grep '→ [owner]/[repo]#N' origin/main -- docs/plans` finds 0 qualified annotations in this repository, so no plan here relies on a self-qualified reference.
- The plan's Approach says "skip every `owner/repo#N` where `owner/repo` is not this repository", which forces the identity question and the Bitbucket parser into the slice. The convention "a qualifier means another repository" removes both and matches delivery. This is a decision for a person, because it changes what the Approach states.

### F7. The silent wrong answer is the case to test, not the refusal

- The issue's reproduction ends in a named refusal ("no merge commit for PR #280"), which is safe.
- The worse case is a foreign number that also exists and merged in this repository. Section 6 then prints "shipped in vX" with the wrong tag, and `--release` writes `Released: <date>, vX` with the wrong version. `deliver.ts:806-840` has no check that the PR belongs to the plan.
- The plan's single test ("a test on a two-repository plan") does not require that collision. A fixture whose foreign number is unknown to the host passes before and after only by the refusal text changing.

### F8. The all-foreign arm gives wrong advice

- The plan says an all-foreign plan "reads as 'no PR annotation'". That arm (`plot-reconcile-scan.sh:3457-3463`) prints "no PR annotation → cannot resolve a version" and "inspect: add → #N to its Branches section". For an all-foreign plan that advice is wrong: the plan carries annotations, and no local one exists to add.
- The arm counts into `n_unrel` on every sweep, forever. `--release` refuses forever (`deliver.ts:828-830`, same "names no '→ #N' annotation" text). The issue's workaround (hand-written `Released:` plus an `--unowned` receipt) stays the only exit for such a plan.
- It needs its own arm with its own words ("every PR is in another repository: no version resolves here") and a decision on what releases it.

### F9. Commit-hash slice lines are left out without saying so

- `commit_list` (`plot-plan-meta.sh:988-995`) reads `→ commit abc1234` and `→ owner/repo@sha`. Neither section 6 nor `releasePr` reads commits.
- A plan whose local slice is `→ commit abc1234` and whose other slice is `→ owner/other#280` reaches the same defect today, and after the fix reaches the "no PR annotation" arm although `git tag --contains abc1234` answers the version directly (section 6 already has that direct path at `:3516-3523`).
- A foreign `owner/repo@sha` must never feed `git tag --contains` (CLAUDE.md: "A commit in another repository reads `unknown`").
- The plan should either take a local commit as release evidence or state that commit-only slices stay out of scope, so the agent does not decide it.

### F10. Sprint seams: what this fixes and for whom

- The zero-intervention path does not hit this defect. `finishRelease` (`release-finish.ts:104-140`) reads the version from `package.json` and books the sprint scope with no per-plan PR resolution. #3078's changeset-named booking adds no PR resolution either.
- The defect blocks the per-plan route: `skills/plot-release/SKILL.md` step 5b (one `--release` call per plan), #3071's named repair route (`plot-deliver.mjs --release <tag> <slug>` re-runs the tracker step), and #3078's master-agent route for a per-plan release. A cross-repo plan cannot be repaired through any of them today.
- `runRelease` refuses `PLOT_UNATTENDED=1` (`deliver.ts:791-795`), so this route always needs a person. The Motivation should state that the fix removes the hand-written-record workaround on the repair route, and does not move the fleet's own release path.
- Merge order: #3071 extracts the tracker step out of `runRelease` into `release-tracker.ts`. The `releasePr` line at `deliver.ts:806` sits above that region; a rebase conflict is unlikely but the slice should name #3071 as a sibling on `deliver.ts`.

### F11. Board impact claim holds only if `prs` keeps its shape

- `packages/board/src/server/board.ts:2707` maps `meta.prs` to `CardPr`, so the board already shows `#280` as a PR of this repository. That is a separate, existing defect.
- If the slice changes `prs` in `plot-plan-meta.sh` output (for example to drop foreign numbers), the card list, `ApproveButton.tsx:71` (`card.prs[0]`) and section 2 (`plot-reconcile-scan.sh:1245`) change behaviour too. The plan should say `prs` stays as it is and the release rule reads a new input.

### F12. Open Question 2 is answerable now

- `git grep` for `prs##*,`, `last_pr` and `releasePr(` over `skills` and `packages/*/src` on origin/main finds two sites: `plot-reconcile-scan.sh:3481` and `deliver.ts:806`. `plot-release-chain.mjs resolve` takes the number from the scan. No third site exists. The plan can close the question.

## Required amendments

1. Name the TS path: `deliver.ts:806` → `releasePr` in `packages/domain/src/rules/release-tag.ts`. The release-PR choice becomes one domain rule, and section 6 asks it through a bundle (one batched call per sweep, or an extension of `plot-release-chain.mjs`) instead of a second awk copy. If the agent duplicates it in shell anyway, the plan must name the corpus test and the shell-lines cost.
2. Build the rule on per-reference readings `(repo, number, deferred)`, reusing `branchClaims` for the qualifier. State where the deferral flag comes from, so a foreign deferral cannot drop a local PR and a foreign `#33` cannot merge with a local `#33`.
3. Adopt the existing convention: any `owner/repo#N` is another repository, as `plot-impl-status.sh` and `crossRepoReferences` read it. Drop the remote-identity design point (subject to the person's decision below).
4. Leave `prs` and `deferred_prs` in `plot-plan-meta.sh` output unchanged, so the board and section 2 do not move. Record this as the board-impact answer.
5. Give the all-foreign plan its own arm in section 6 and its own refusal in `--release`, with words that do not advise adding an annotation.
6. State the commit-hash scope: either a local `→ commit <sha>` resolves the version through `git tag --contains`, or commit-only slices stay out of this plan. A foreign `owner/repo@sha` is never asked.
7. Sharpen the tests, each failing on origin/main:
   - `packages/domain/test/release-tag.test.ts`: `#33` plus `owner/other#280` answers `33` (today `280`); `#33` plus a deferred `owner/other#33` answers `33` (today `''`); only foreign references answer the all-foreign outcome.
   - `test/reconcile/scan.test.mjs` section 6: the host stub answers `#280` as merged with a sha inside `v0.2.0`, and `#33` with a sha inside `v0.1.0`. Today the section prints `v0.2.0`; after the fix it prints `v0.1.0`. A second fixture with only foreign references prints the new arm.
   - A `deliver.ts --release` test (beside `packages/board/test/unit/deliver-plan-state.test.ts`) with the same collision, asserting the written `Released:` names `v0.1.0`.
8. Close Open Question 2 with the two sites in F12, and state in Motivation that the fixed route is the per-plan `--release` route (skill step 5b, #3071's repair route), not `release-approve`'s finish.

## Decisions for a person

- D1. "This repository" is the unqualified `#N` only (convention, F6), or a qualifier is compared against the remote. The first matches delivery and needs no host call; the second needs a Bitbucket and GitHub remote parser and a rule for forks.
- D2. What releases an all-foreign plan (F8): it stays Delivered with a named finding, the sprint finish books it by scope only, or `--release` accepts it with a version a person names. Today only a hand-written record releases it.
- D3. Whether a local `→ commit <sha>` counts as release evidence in this plan (F9).

## What I ran versus read

Ran (read-only): `gh issue view 3081`; `git fetch origin main`; `git archive origin/main` of `skills/plot/scripts`, `packages/domain/src`, `packages/board/src`, `test/reconcile` into the scratchpad; `grep`/`sed -n` over those files; `git grep` over origin/main for `releasePr`, `last_pr`, `prs##*,`, `deferred_prs`, `.prs` and qualified `→ owner/repo#N` annotations in `docs/plans` (0 found); `git show` of the sprint file and of plans #3071 and #3078 on origin/main.

Read only, not executed: `plot-reconcile-scan.sh` section 6 (`:3400-3540`) and its plan-row read (`:650-667`); `plot-plan-meta.sh` `sorted_insert`, `commit_list`, `extract_prs` and the JSON emitter; `plot-impl-status.sh` header and index-query loop; `cross-repo-reference.ts`; `release-tag.ts`; `deliver.ts:780-860`; `release-finish.ts:100-140`; `plot-host.sh` `account` arm and `--repo` handling. I ran no test, no scan, no bundle and no host write. The collision outcome in F7 and the deferral outcome in F4 are derived from the code, not reproduced.

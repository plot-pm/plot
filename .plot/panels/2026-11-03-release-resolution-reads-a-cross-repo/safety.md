# Safety juror — release-resolution-reads-a-cross-repo

Position: amend

The defect is real and the direction (skip foreign annotations) is right. As written, the plan names the wrong code for the `--release` arm, leaves "this repository" undefined, and keeps a "last PR" rule whose meaning is "highest PR number". Three of the shapes below can book a Released record at a wrong tag. Each needs a named refusal or a stated rule before an unattended agent builds it.

## Findings

### F1. The `--release` arm is TypeScript, and the plan does not name it

- `skills/plot/scripts/plot-deliver.sh` on origin/main is a 13-line launcher that `exec`s `board/plot-deliver.mjs`. It decides nothing.
- The release PR is chosen by `releasePr(prs, deferredPrs)` in `packages/domain/src/rules/release-tag.ts:30`, called from `packages/board/src/server/entry/deliver.ts:806`. `deliver.ts:832` asks `ctx.host.prState(Number(lastPr))` on this repository's host. It does not call `plot-release-chain.mjs`.
- The plan says "in the scan's section 6 and in `plot-deliver.sh --release`" and "`plot-release-chain.mjs resolve` receives the number the scan picked, so the choice must be made before that call". The second sentence is true for the scan only (`plot-reconcile-scan.sh:3514`). A Sonnet agent reading the plan can patch shell and leave `releasePr` untouched. Then the scan reports "shipped in vX" and `/plot-release` still refuses (or, worse, the two pick different PRs).
- Because two implementations exist, the plan must say whether the rule lives in `rules/release-tag.ts` and the scan asks it through a bundle, or is duplicated in shell and joins the corpus tier. The plan lists this as a "point to settle". For a write that is hard to undo, the agent must not settle it alone.

### F2. "Last PR" means "highest PR number", not "last in the plan"

- `plot-plan-meta.sh:663` sorts and deduplicates `prs` numerically (`sorted_insert`, `:396-401`), and `:688` emits the sorted list. `plot-reconcile-scan.sh:665` joins it, and `:3481` takes `${prs##*,}` — the highest number.
- `releasePr` documents the same: "the highest PR number the plan annotates" (`release-tag.ts:21-30`).
- The plan's Motivation says "takes the last PR number"; its Approach says "take the last of the remaining PRs"; Open Question 1 asks whether "the last PR of this repository always carries the release". None says "highest number". In the issue's example the defect fires only because 280 > 33, not because #280 is listed last.
- Safety consequence: the highest-numbered PR is the one opened last, not the one merged last. A plan with this-repo PRs #50 (opened early, merged late) and #60 (merged first) resolves to the first tag containing #60. That tag can precede the tag containing #50. `releaseTag` (`release-tag.ts:70-108`) checks only the one merge commit, so the Released record names a tag that does not contain all of the plan's this-repo work. This exists today. The fix removes the one guard that often stopped it on mixed plans (a refusal), so more plans now reach this arm.

### F3. Qualifier collisions after the parser drops the repository

- `plot-plan-meta.sh:1050-1052` keeps the number only (`sub(/^.*#/, "", p)`), and `sorted_insert` drops a duplicate number. A local `→ #280` and a foreign `→ other/repo#280` become one entry `280`. Carrying the qualifier "through" requires dedup by (repo, number), not by number.
- `deferredPrs` is a number list too (`plan-store-shell.ts:163`, `ports/plan-store.ts:43`), and `releasePr` filters `prs` by number (`release-tag.ts:31`). A deferred foreign `other/repo#33` removes a shipped local `#33`. Then `releasePr` picks a lower local PR, which can resolve to an earlier tag. Same consequence as F2.

### F4. "This repository" is undefined, and the existing convention differs from the plan's

- `plot-impl-status.sh:137-141, 252-258` and `branchClaims` (`packages/domain/src/rules/cross-repo-reference.ts`) treat any qualified reference as another repository. They never compare `owner/repo` against the remote. A self-qualified `→ me/this-repo#40` is resolved through `plot-pr-state.mjs` in that repository, which happens to be this one, so delivery works.
- The plan says "skip every `→ owner/repo#N` where `owner/repo` is not this repository". If the build follows impl-status's convention (qualified means foreign), a self-qualified this-repo PR is skipped. With a mix of `→ #33` and `→ me/this-repo#40`, release picks #33 and books an earlier tag. That is a wrong Released record with no refusal.
- If the build compares against `origin`, it needs a rule for: case (Bitbucket workspace and repo slugs, GitHub owner case — `ownerOfRemote` lowercases, `remote-owner.ts:26`), a fork whose `origin` is the fork while annotations name upstream, a renamed repository whose old name GitHub redirects, a local-path `origin` (`ownerOfRemote` returns `null`), and a self-hosted `group/sub/repo` path. `hostAndPathOfRemote` (`packages/domain/src/rules/remote-url.ts:16`) is the existing parser; the plan does not name it.
- Safety rule the plan must state: when the repository of a qualified annotation cannot be compared (no parseable `origin`), the release refuses by name. It never skips that annotation.

### F5. The all-foreign plan ends in a refusal, but with the wrong words

- `deliver.ts:829-830` and `release-tag.ts:74-77` say "names no '→ #N' annotation … Annotate the branch that shipped this plan". The scan says "add → #N to its Branches section" (`plot-reconcile-scan.sh:3460-3461`). For an all-foreign plan both are false advice: the plan has annotations, and adding a local one would be invented.
- The refusal itself is safe: nothing is written. It needs its own reason (for example `no-local-pr`) with its own repair text. Whether an all-foreign plan should instead end at Delivered like docs/infra (`plot-reconcile-scan.sh:3449`), or count as "live on merge", is a lifecycle decision for a person. Until a person decides, the plan stays in the scan as a finding, which keeps "cannot tell" visible.

### F6. The scan and the release controller already disagree on deferred PRs

- `releasePr` excludes deferred PRs; scan section 6 reads `prs` with no deferral filter (`plot-reconcile-scan.sh:3481`). A plan whose highest PR is deferred gets "cannot resolve" in the scan and resolves in `/plot-release`. The fix touches both selections; leaving them different keeps two answers to one question, which "A Shell Script Asks The Domain" forbids without a corpus pair.

### Claims checked

- Line ~3481 `last_pr="${prs##*,}"`: true on origin/main.
- Parser drops the prefix: true (`plot-plan-meta.sh:1036-1052`).
- `plot-release-chain.mjs resolve` receives the scan's number: true (`:3514`). The issue's printed message matches `release-chain.ts:105`.
- `plot-impl-status.sh` resolves `owner/repo#N` in its own repository: true (`:252-258`).
- "`plot-deliver.sh --release` … refuses: no merge commit for PR #280": the refusal comes from `deliver.ts:835`, not the shell.

### Bitbucket arm

`plot-pr-state.mjs` and `plot-host.sh pr-state --repo` already resolve a foreign repository on Bitbucket. The release change must not ask the foreign repository at all, so it adds no Bitbucket call. Comparing `owner/repo` on Bitbucket must be case-insensitive. Workspace and slug are the two path segments of the `origin` URL.

## Amendments required

1. Name `releasePr` in `packages/domain/src/rules/release-tag.ts:30` and its caller `packages/board/src/server/entry/deliver.ts:806` as the `--release` site. Decide the home: the rule lives in the domain, takes `(repo, number)` references, and the scan asks it through a bundle; or the shell duplicates it and the slice adds a corpus test. State which, and state the shell-lines offset if shell grows.
2. Replace "last PR" with the actual rule. State that the qualifier must reach the selector: either add `{repo, number}` to `plot-plan-meta.sh`'s JSON (additive field, deduplicated by repo and number) or read `branchClaims`. Deferral is keyed by (repo, number) too.
3. Define "this repository": unqualified `#N` is this repository; a qualified reference is this repository when its `owner/repo` equals the one `hostAndPathOfRemote(origin)` gives, compared without case; otherwise foreign. When `origin` gives no `owner/repo`, a plan with any qualified reference refuses by name (for example `repository-unknown`) instead of skipping it.
4. Close the wrong-tag hole of F2 in the controller: before booking, resolve every non-deferred this-repo PR's merge commit, and require that the booked tag contains each one (or book the highest of their first-containing tags). Any this-repo PR without a merge commit refuses as today. If a person rules this out of scope, the plan must say so and file it, because skipping foreign PRs sends more mixed plans into this arm.
5. Give the all-foreign case its own refusal reason and repair text in both `releaseTag`/`deliver.ts` and scan section 6, distinct from "no PR annotation".
6. Make scan section 6 and `releasePr` select through the same rule, including deferral (F6).
7. Tests, each failing on origin/main: `releasePr` on `[#33, other/repo#280]` returns 33 (today `'280'`); a self-qualified `me/this-repo#40` beside `#33` selects 40, not 33; a foreign `other/repo#33` with a local `#33` keeps the local one, and a deferred foreign `#33` does not drop a shipped local `#33`; an all-foreign plan refuses with the new reason; an `origin` with no `owner/repo` refuses `repository-unknown`; a two-PR plan whose higher-numbered PR is in an earlier tag than the lower one refuses (amendment 4); a scan section 6 test with a stubbed host on the two-repository plan prints "shipped in v0.1.0" and asks `pr-state` for 33 only.

## Decisions for a person

- Whether an all-foreign plan ever reaches Released, stays Delivered as a finding, or is exempt like docs/infra.
- Whether amendment 4 (all this-repo PRs in the tag) belongs to this plan or to a follow-up.
- Whether a fork whose `origin` differs from the annotated upstream counts as this repository (for example by also comparing an `upstream` remote), or refuses.

## What I ran and what I read

Ran (read-only): `git fetch origin main`; `gh issue view 3081`; `git show origin/main:` of `plot-reconcile-scan.sh`, `plot-plan-meta.sh`, the deliver launcher, `plot-impl-status.sh`, `packages/board/src/server/entry/deliver.ts`, `packages/domain/src/rules/release-tag.ts`, `cross-repo-reference.ts`, `remote-owner.ts`, `remote-url.ts`, `skills/plot-release/SKILL.md`; `git grep` for `releasePr`, `lastPr`, `deferredPrs`, `nameWithOwner`.

Only read, not executed: every behaviour above is from source. I did not run the parser on a two-repository plan, the scan, the release bundle, or any test suite. The F2 wrong-tag case is reasoned from `releaseTag` reading one merge commit; I did not reproduce it.

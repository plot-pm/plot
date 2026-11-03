# Testability juror: fleetd merges no slice PR while no Merger app is declared

Position: amend

Lens: whether each named test fails before the change and passes after, whether the merge decision is a domain property testable without a host, and how a live run proves that fleetd merged a PR with no person.

## Summary

The plan names the right defect and the right two test files, but it names no test case. Under the recommended option 3, both named test files pass unchanged before the change, because the decision that changes lives in `runAutoMergePass` in the fleet package, which no unit test calls. And a live run cannot prove that fleetd merged a PR: under options 2 and 3 GitHub attributes the merge to the same login as a hand merge, and fleetd records nothing when it merges.

## Findings

### F1. The decision that changes is not a domain property, and no test reaches it

- `packages/fleet/src/shared/auto-merge.ts:183` (origin/main) computes the hold input inline: `mergerAppMissing: backend.value === 'github' && readConfig(opts, MERGER_APP_KEY, '') === ''`. This is the whole rule the plan changes. It lives in `runAutoMergePass` (`auto-merge.ts:134`), a fleet function that reads a host backend, the PR index file, the default-branch file and the config.
- `packages/fleet/test/unit/auto-merge.test.ts:89` tests `mergeTick` with `mergerAppMissing` injected as a reading (`:124-127`). No test calls `runAutoMergePass`; `packages/fleet/test/unit/auto-writes.test.ts:28` replaces it with a stub. So the line at `:183` has no test today.
- `packages/domain/test/slice-pr-next.test.ts:405-408` asserts that `mergerAppMissing: true` holds and `false` merges. Under option 3 the domain arm `mergeArm` (`slice-pr-next.ts:346`) need not change at all: only the boolean's computation changes. So a test added to either named file that injects the boolean passes before the change too. It proves nothing about #3063.
- Under option 2 the existing test at `slice-pr-next.test.ts:407` must be deleted or inverted. The plan does not say which.
- The layering rule says no domain-specific code lives outside the domain. Which identity a fleet merge runs as is a domain decision. Today it is a fleet-side expression.

### F2. A failed config read must fail closed, and no test is named for it

- `readConfig` answers its `fallback` both for an absent key and for a read that fails (`packages/fleet/src/shared/config-reader.ts`, TSDoc of `readConfig`). Today the fallback `''` makes a failed read hold, which is the safe direction.
- Under option 3 an opt-in key read through the same function must also answer "not opted in" on a failed read. If the slice writes the opt-in as `readConfig(opts, KEY, 'true')` or parses `''` as consent, a broken config read merges as the admin with ruleset bypass. Nothing in the plan pins this, and no test is named for it.

### F3. Open Question 3 is already answered by the code

- `packages/domain/src/workflows/merge.ts:364-378` re-asks `ports.host.prReview(pr)` in `mergeAt`, and `merge()` refuses `review-not-passed` unless `plot/review` reads `success` on the pinned head (`merge.ts:209-212`). `runAutoMergePass` goes through `mergeAt` (`auto-merge.ts:115`). So the signed-in path already makes the same re-read `release-approve` makes. The plan can close this question and name the existing test of `review-not-passed` as the guard, rather than leaving it to an agent.

### F4. A live run cannot prove "fleetd merged with no person"

- `packages/fleet/src/shared/auto-writes.ts:92` calls `await runAutoMergePass(opts, mergeRefused);` and discards the result. `mergeTick` (`auto-merge.ts:89-117`) and `mergeAt` (`merge.ts:356-420`) append nothing to the action log. The review pass, by contrast, appends a `review-start` record (`plot-fleetd.mjs` bundle, `P6`).
- Under options 2 and 3, GitHub records the merge as the signed-in `gh` login, `jwloka`. A hand merge through `plot-ask.mjs merge` records the same login. The PR timeline therefore cannot tell a fleetd merge from a person's merge. This is Open Question 4, and it is also the only way to verify the plan's own one-line claim ("merges with no person").
- The hold reason `merger-app-missing` is also never surfaced: the steps that `mergeTick` returns are discarded at `auto-writes.ts:92`, and the board renders the reason nowhere (grep over `packages/` outside the domain rule and its test: zero hits). A person cannot see why fleetd holds, which is how the defect stayed silent across a whole sprint.
- The plan names no live verification step and no observable that would end the sprint-goal question.

### F5. The slice cannot be built and tested from the plan alone

- The option (1, 2 or 3), the key name, its accepted values and the fallback are all open. Each changes which tests fail before the change. An unattended Sonnet agent cannot write a failing-first test for an undecided rule. The option and the key belong to a person (jwloka): they decide whether the fleet merges with the admin's ruleset bypass. That is a security-posture decision, not an implementation detail.
- Option 1 changes no code. If a person picks option 1, the slice as written (`feature/fleetd-merges-with-the-signed-in-identity`) has no code to test, and the verification is entirely live.

### F6. Bitbucket parity has no test named

- The plan states that `mergerAppMissing` is false off GitHub (`auto-merge.ts:183`), which is true. A test that the new rule leaves Bitbucket unchanged (no hold, no opt-in read) is cheap once the rule is a pure function, and none is named.

## Amendments required

1. A person decides the option and records it in the plan before approval. If option 3: name the key (for example `Merge as signed-in identity`), its one accepted value (for example `true`), and state that absent, empty, any other value and a failed config read all mean "not opted in".
2. Move the identity decision into the domain as a pure function over values, for example `mergeIdentity({ backend, mergerApp, signedInOptIn }) → 'app' | 'signed-in' | 'held'` in `packages/domain/src/rules/`, and make `auto-merge.ts:183` only read the config and call it. `mergeArm` then holds on `'held'`.
3. Name the tests case by case, each stated to fail on origin/main:
   - domain: GitHub, no App, opt-in `true` → not held (fails before: the function does not exist / `:183` holds);
   - domain: GitHub, no App, opt-in absent, empty, `false`, `yes` → held `merger-app-missing`;
   - domain: GitHub, App declared, opt-in any value → `'app'`, not held (D4 stays the default);
   - domain: Bitbucket, any combination → not held, and the opt-in is not consulted;
   - fleet: `runAutoMergePass` (or the thin reader it calls) with a config read that fails → held, never merged. This needs a seam for `readConfig` and `hostOf`; name it.
   - Keep `slice-pr-next.test.ts:405-408` unchanged under option 3; under option 2, state which assertion inverts.
4. Close Open Question 3 with the code: `mergeAt` re-reads `plot/review` (`merge.ts:209-212`). Name the existing `review-not-passed` test as the guard on the signed-in path.
5. Make a fleetd merge observable: `runAutoMergePass` appends one action-log record per merge attempt (step `merge`, PR, head, outcome, identity `app`/`signed-in`), the same way the review pass appends `review-start`, and appends one record per (PR, head) the first time it holds on `merger-app-missing`. Name a fleet unit test that asserts the record. Without this, the plan's claim is unverifiable live.
6. Name the live proof in `## Notes` or a verification section: after the slice merges and the key is declared, the next slice PR with green CI and `plot/review` success merges with no `plot-ask.mjs merge` call and no person; the evidence is the fleetd action-log `merge` record with identity `signed-in` and outcome `merged`, matching the PR's `mergedAt` and head SHA from `gh pr view <n> --json mergedAt,mergedBy,headRefOid`. A `mergedBy` of `jwloka` alone is not evidence.
7. Add the board/status surface decision: either the board renders `merger-app-missing` (and then a browser test proves it shows), or the plan states that the action-log record is the only surface.

## Decisions that need a person

- Which option, and whether the fleet may merge with the Admin role's `bypass_mode: always` (ruleset 24412719). This reverses #2902's D4 for this repository and is jwloka's to make.
- The opt-in key's name and accepted value, and whether `plot-init` or `plot-board-setup` proposes it.
- Whether a fleet merge must be distinguishable on the host (PR comment, merge-commit trailer) or only in fleetd's own log.

## What I ran versus what I only read

Ran (read-only): `gh issue view 3063`; `git fetch origin main`; `git show origin/main:` of `packages/fleet/src/shared/auto-merge.ts`, `packages/domain/src/rules/slice-pr-next.ts`, `packages/fleet/test/unit/auto-merge.test.ts`, `packages/domain/test/slice-pr-next.test.ts`, `packages/domain/src/workflows/merge.ts`, `packages/fleet/src/shared/auto-writes.ts`, `packages/fleet/src/shared/config-reader.ts`; `git grep` over origin/main for `runAutoMergePass`, `MERGER_APP_KEY`, `Merger app`, `merger-app-missing`.

Only read, not executed: every test file. I ran no test suite, so "passes before the change" in F1 is from reading the test bodies against the code at `auto-merge.ts:183` and `slice-pr-next.ts:346`, not from a run.

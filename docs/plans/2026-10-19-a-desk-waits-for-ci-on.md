# A desk waits for CI on a PR that conflicts with main and asks a person why no build answered

> A desk reads its PR's mergeability before the CI wait, merges the default branch on `CONFLICTING`, and names the mergeability when it still asks a person.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #2106
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2110 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/a-no-answer-question-names-mergeability`

## Changelog

- Fix: a desk whose PR conflicts with the default branch merges the default branch before it waits for CI, instead of waiting `Checks wait` for a build that cannot start.
- Fix: the `PLOT-BLOCKED` question for a `no-answer` ending names the PR's mergeability.

<!-- Board impact: none for the plan format, template or docs/plans layout. The change is in the agent loop and the marker text; the board reads `mergeable` through `checks-reading.ts` and is unchanged. -->

## Motivation

On 2026-10-19 two desks wrote the same `PLOT-BLOCKED` question: `No build ever answered for bug/a-click-on-a-plan-story (no-answer): the wait for CI ran out with nothing from the build connector.` PR #2104 (head `0c0513dbf`) had `mergeable: CONFLICTING`, and `gh run list --branch bug/a-click-on-a-plan-story` listed no run. GitHub starts no `pull_request` workflow while a PR's merge ref cannot be built, so no build could answer. `bug/an-scp-style-remote-with-a` (#2068) wrote the same question earlier that day.

Each desk waited the whole `Checks wait` (3600 s) and then asked a person a question whose answer was in the host's PR state from the first minute.

Today the CI wait does not read mergeability. `ciWait` (`packages/domain/src/workflows/agent-loop.ts`, ROW 16) ends `checks-unanswered` with detail `no-answer` when the wait reaches its bound with nothing conclusive. `needsPersonMarker` (`packages/domain/src/rules/ending-action.ts:529`) turns that detail into the question above and offers three choices: wait longer, check the build connector, or resume without a CI answer. None of them is "merge the default branch". The board already reads `mergeable` — `checks-reading.ts:102` and `:207` label a PR with no checks and `conflicting` as *no checks — conflicts* — so the reading exists and the desk ignores it.

## Design

### Approach

Two changes, in the order the issue lists them.

1. **Read mergeability before the wait.** The agent loop takes a `mergeable` reading (`Mergeability`: `mergeable | conflicting | unknown`, `entities/pr.ts`) beside its checks reading. On `conflicting` the loop does not enter the CI wait: it resumes the agent with a correction that says to merge the default branch into the slice and push. The correction restores generated bundles from the merge base against `origin/main` and does not commit a rebuild, as CLAUDE.md's board-artifact rule states. `mergeable` and `unknown` leave the wait as it is. GitHub computes mergeability lazily, so `unknown` is not evidence either way.
2. **Name the mergeability in the question.** `needsPersonMarker` for `checks-unanswered` includes the PR's mergeability in the `no-answer` question. The cause then appears in the question, whatever path led to the ask.

The domain takes readings as values (CLAUDE.md, *The Layering Rule*), so `mergeable` arrives as a field of `AgentLoopReadings` and the rule stays synchronous. The host adapter already emits `mergeable` (`host-shell.ts:92`); no new host call is added for the PR state the loop already reads.

### Open Questions

- [ ] Does the loop read `mergeable` from a PR state it already fetches for the checks reading, or does that read need a new field on the readings the agent loop receives?
- [ ] How often does a desk see `conflicting` after it merged the default branch once? A second `conflicting` reading after a clean merge push is a real conflict the agent could not resolve; the loop needs a bound so it hands that case to a person instead of looping.
- [ ] `ending-action.ts` passes only `detail` to `needsPersonMarker`. Does the mergeability travel in `detail` (`no-answer: mergeable=conflicting`) or as a new parameter? The `tip-moved` branch already parses `detail` with `includes`.
- [ ] Bitbucket reports mergeability differently from GitHub. Which Bitbucket states map to `conflicting`, and does `unknown` stay the safe answer there?

## Slices

### Question

- `bug/a-no-answer-question-names-mergeability` — the `no-answer` marker text names the PR's mergeability <!-- builds: mergeability in the checks-unanswered marker text -->

### Reading

- `bug/a-desk-merges-main-when-its-pr-conflicts` — the agent loop reads mergeability before the CI wait and resumes the agent to merge the default branch on `conflicting` <!-- builds: a conflicting-PR row in ciWait -->

## Notes

- Source: issue #2106. Observed on PRs #2104 and #2068, 2026-10-19.
- Slice order: the question names the cause first, so a desk that still asks a person after slice 2 ships tells the reader why.

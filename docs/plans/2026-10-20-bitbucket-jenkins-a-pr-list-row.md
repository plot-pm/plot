# Bitbucket + Jenkins: a pr-list row past the lookup cap reads as Jenkins unknown

> Under `CI: jenkins`, `pr-list --rich` reads `checks: unknown` with an empty `checksSha` both for a row past `SHA_LOOKUPS_PER_PASS` and for a row Jenkins cannot answer. A reader cannot tell "not looked up" from "Jenkins has no build".

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2170
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2184 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/bitbucket-jenkins-a-pr-list-row`

## Changelog

- `plot-host.sh pr-list --rich` on Bitbucket with `CI: jenkins` distinguishes a row it did not look up from a row Jenkins could not answer, or looks up every open PR within a bounded number of passes.

Board impact: the board, the merge queue and `pr-refresh.ts` read `checks` and `checksSha` from `pr-list`. A new `checks` word or a new field changes that contract, so the slice lists every reader first. No plan-format change.

## Motivation

Field test on 2026-10-20 of main `45cd9fd71` (after #2160 for #2154) against ewz-kus-portal. `plot-host.sh pr-list --state open --rich` returned 9 rows. 5 rows bind (`checksSha` equals `headSha`). The 4 rows past `SHA_LOOKUPS_PER_PASS = 5` (PRs 3509, 3237, 3210, 3094) read `checks: unknown` with an empty `checksSha`. Jenkins has builds for those heads: the branch of 3509 #3 SUCCESS, `add-bdd` #2 FAILED, `typesafe-routes` #2 SUCCESS.

#2160 stopped these rows from reporting a stale branch colour and gave them `unknown`. `unknown` is also the word for a head with no Jenkins build (`bindChecks` in `packages/domain/src/rules/jenkins-pr-checks.ts`) and for a non-conclusive Jenkins word such as `ABORTED`. A reader of the row cannot tell the cap from a Jenkins answer. The cap is fixed at 5, so on a repository with more than 5 open PRs the same rows are skipped on every pass: the 5 newest rows bind, and the rest never do.

## Design

### Approach

The plan states the target behaviour and leaves the mechanism to the Open Questions. Two mechanisms meet the issue, and they combine.

- **A distinct state.** A row the pass did not look up carries a word that no Jenkins answer produces. `$named` in the `pr-list --rich` arms of `skills/plot/scripts/plot-host.sh` already separates a row past the cap from a row whose ask broke early. The choice is a new `checks` word (for example `unbound`) or a separate field (for example `checksLookup: skipped`). A new word changes the vocabulary that `checks-reading.ts`, the board and `pr-refresh.ts` read. A separate field leaves `checks: unknown` as it is and adds one for readers that care.
- **Rotation across passes.** The caller picks the rows to look up by `updatedAt`, newest first, so a stable set of rows is never reached. A pass would pick the rows with the oldest lookup, or skip rows already bound to their current `headSha`, so that every open PR gets a bound answer within ceil(rows / cap) passes. This needs memory between passes. The repo rule "a decision reads the index" applies: the memory is a bound answer in the PR index (`checksSha` against `headSha`), not a new store, and `pr-refresh.ts` stays the only writer.

### Open Questions

- [ ] New `checks` word or separate field for "not looked up"? Which readers branch on `unknown` today?
- [ ] Does rotation belong in `rowsToBind` (pure, no memory) or in the caller that holds the PR index?
- [ ] What does one Jenkins sha lookup cost on ewz-kus-portal, and does a higher cap or rotation cost less per pass than the fleet's rate budget allows? Measure before choosing a number.
- [ ] Does the GitHub-plus-Jenkins arm of `pr-list --rich` have the same gap?

## Slices

### Not looked up

- `bug/bitbucket-jenkins-a-pr-list-row` — a row past the lookup cap reads distinct from a row Jenkins cannot answer, and every open PR binds within a bounded number of passes

## Notes

- Follows #2154 / `2026-10-20-bitbucket-jenkins-pr-list-rows-past` (delivered, #2160), which chose `unknown` for rows past the cap. This plan replaces that word with an honest one or removes the skipped rows.
- Source: issue #2170. The plan records the link one way; nothing is written to the tracker.

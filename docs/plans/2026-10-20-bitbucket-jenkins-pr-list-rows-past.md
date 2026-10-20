# Bitbucket + Jenkins: pr-list rows past the lookup cap show unbound check colours

> Under `CI: jenkins` on Bitbucket, `pr-list --rich` binds the checks of the 5 most recently updated rows to their head and leaves every other row on the branch colour. On ewz-kus-portal 4 of 11 rows read `green` or `failing` with `checksSha: ""`.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:**
- **Issue:** #2154
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2157 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/bitbucket-jenkins-pr-list-rows-past`
- **Delivered:** 2026-10-20

## Changelog

- `plot-host.sh pr-list --rich` on Bitbucket with `CI: jenkins` no longer reports `green` or `failing` for a row whose checks are not bound to its head.

Board impact: the board and the merge queue read `checks` and `checksSha` from `pr-list`. A row past the cap stops showing a colour that belongs to an older build. No plan-format change, no rebuild of the board artifact expected unless the board needs a new word for the unbound state.

## Motivation

Field test on 2026-10-20 against ewz-kus-portal. `plot-host.sh pr-list --state open --rich` returned 11 rows in 7.5 s. 5 rows carry `checksSha` equal to `headSha`. 4 rows (PRs 3509, 3094, 3237, 3210) report `green` or `failing` with an empty `checksSha`. Their colour is the branch's last build, not a build of the PR head. `pr-state` on the same PRs binds each of them correctly.

Cause: `SHA_LOOKUPS_PER_PASS = 5` (`packages/domain/src/rules/jenkins-pr-checks.ts:38`) caps `rowsToBind` at the 5 most recently updated rows. The doc comment of `rowsToBind` states the outcome: "A row past the limit keeps its branch colour, unbound." The delivered plans for #2053 and #2075 made the binding work on a real Jenkins. This is the next gap in the same path: the binding works, and the cap leaves rows outside it.

A branch colour carries no commit, so after a push it keeps the previous head's result. The board and `merge` (`checks-unbound`, `packages/domain/src/workflows/merge.ts`) read that colour. The merge guard refuses a green that names another commit, but the board shows the colour as is.

## Design

### Approach

The plan states the target behaviour and leaves the choice of mechanism open (see Open Questions).

- **A row whose checks are not bound to its head does not read `green` or `failing`.** Either it carries a distinct word (the issue suggests `unbound`), or the cap rises until every row binds.
- **Option A, a distinct state.** `rowsToBind` already knows which rows it dropped. Those rows read `unknown` (the word `bindChecks` uses for a colour with no build of the commit) or a new `unbound`. A new word changes the `checks` vocabulary that the board, the merge queue and `pr-refresh.ts` read, so the slice lists every reader first.
- **Option B, a higher cap.** Each lookup is one Jenkins call. The 11-row run took 7.5 s with 5 lookups. The slice measures the cost per lookup against a real Jenkins before choosing a number, per the repo's rule to measure before implementing an optimisation. A cap still leaves rows unbound on a repository with more open PRs than the cap, so Option B alone does not meet the first bullet.
- **Both may apply:** raise the cap where the measured cost allows it, and give a row past the cap an honest word.

### Open Questions

- [ ] Does a row past the cap read `unknown` (existing word) or a new `unbound`? A new word touches every reader of `checks`.
- [ ] What does one Jenkins sha lookup cost on ewz-kus-portal, and what cap does that allow?
- [ ] Does the GitHub arm of `pr-list` share the cap and the same gap?

## Slices

### Unbound rows

- `bug/bitbucket-jenkins-pr-list-rows-past` — rows past the lookup cap no longer report a branch colour as their head's checks → #2160

## Notes

- Related, both delivered: `2026-10-18-bitbucket-jenkins-pr-list-binds-a` (#2053), `2026-10-19-jenkins-checks-never-bind-to-the` (#2075).
- Source: issue #2154. The plan records the link one way; nothing is written to the tracker.

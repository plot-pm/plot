# pr-review accepts a plot/review status from any writer

> `plot-host.sh pr-review` reads the first `plot/review` status on a head without checking who wrote it, so a status posted under the operator's login reads as the review App's answer.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3072
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-host.sh pr-review` reports a `plot/review` status written by any identity other than the one `Review app` names as a refusal, not as `success`.

<!-- Board impact: none. The plan format, the template and the docs/plans layout stay unchanged. `pr-review` output gains one refusal shape that `packages/domain` consumers must decode. -->

## Motivation

`plot-host.sh pr-review` on GitHub (`skills/plot/scripts/plot-host.sh`, the `pr-review)` arm) reads `repos/{owner}/{repo}/commits/<head>/statuses` and takes the first status whose `context` is `plot/review`. It does not read the status's `creator`.

The ruleset on `main` accepts `plot/review` only from the plot-review App (integration 5317669). Plot's own merge controller (`mergeAt` in `packages/domain/src/workflows/merge.ts`, refusal `review-not-passed`) and the slice-PR rule read the answer of `pr-review` instead. Fleet desks and the master agent run under the operator's `gh` login, which posts a `plot/review` status with one `gh api` call. A status posted that way after the App posted `failure` reads as `success` to Plot.

The ruleset still refuses such a merge for a writer without bypass. The operator's login has the Admin role, which the ruleset lists with `bypass_mode: always`, so a merge through `plot-ask.mjs merge` as that login is not stopped by the ruleset. The safety and seams jurors of plan PR #3068 found this on 2026-11-03 from the code. It is not reproduced yet.

Refs #3063, #3068.

## Design

### Approach

Treat the writer as part of the answer. The GitHub arm reads each status's `creator` and keeps a `plot/review` status only when its writer matches the identity `Review app` names in `## Plot Config`. A `plot/review` status from any other writer yields a named refusal that `mergeAt` and the slice-PR rule read as not passed, never as `success`.

The Bitbucket arm (`plot-jenkins-pr-checks.mjs review`) decodes build statuses, which carry no comparable creator on every plan. That arm states which writer it trusts, in its header and in a test, instead of staying silent.

Layering: the identity comparison is a rule the domain owns, and `pr-review` stays a reading that reports the writer.

### Open Questions

- [ ] Which field on the GitHub status names the App: `creator.login` (`plot-review[bot]`) or an integration id? The `Review app` key holds an app id and a key path, so the comparison needs one mapping from id to login, and that mapping needs a source.
- [ ] What does `pr-review` report when no status passes the identity check but a foreign one exists: `absent` plus a `foreign` field, or a distinct `state`? Consumers decode both today.
- [ ] Which writer does the Bitbucket arm trust, and can a build status key be tied to one account?
- [ ] A repo with no `Review app` key: does `pr-review` keep today's behaviour, or refuse? Refusing breaks repos that never adopted the App.

## Slices

### Writer check

- `feature/pr-review-accepts-a-plot-review` — `pr-review` keeps a `plot/review` status only from the `Review app` identity and reports any other writer as a named refusal; a test posts a forged `success` after an App `failure` and reads the refusal; the Bitbucket arm states its trusted writer <!-- builds: the writer check in pr-review -->

## Notes

- Source: issue #3072, read from the tracker; nothing is written back to it.
- Not reproduced. The first step of the slice is to reproduce the forged `success` in a sandbox.

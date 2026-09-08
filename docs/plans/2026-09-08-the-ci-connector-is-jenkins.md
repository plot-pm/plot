# The CI connector is Jenkins

> `CI: jenkins` resolves to `buildNone()`, a connector that reaches nothing. The board's check column on a Jenkins team is empty — and the shell already holds a working Jenkins reader that the port cannot see.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** the-board-is-blank-where-it-matters
- **Review:** pr
- **Impl:** own branches

## Changelog

- Build state on a Jenkins team reaches the domain through a connector, so every reader of the build port sees it rather than only the board's `pr-list --rich` overlay.

<!-- Board impact: the check column fills on a Jenkins team. The rendering
     already exists; what is missing is an answer to render. -->

## Motivation

**`build-resolve.ts:35` has one arm.** `github-actions` returns `buildActions`; everything else — `jenkins` included — falls to `buildNone()`, and the file says so in its own comment: *"`jenkins` HAS NO CONNECTOR YET and therefore resolves to none, which is the honest answer while `build-jenkins.ts` does not exist."*

**The slice that was to write it merged carrying a `PLOT-BLOCKED.md` and nothing else.** PR #821. The plan `the-build-pipeline-is-its-own-connector` reads Delivered with three of four slices implemented.

**THE HARD HALF IS ALREADY BUILT, AND IT WAS BUILT AGAINST A REAL INSTANCE.** Measured 2026-09-08 in `plot-host.sh`:

| what exists | line | what makes it real |
|---|---|---|
| `jenkins_build_map()` | 557 | auth wording measured live against `jen 0.2.0` on 2026-08-26; percent-decodes `feature%2Ffoo`, else every slashed branch reads `none`; maps Jenkins colours onto the four `checks` words |
| the `jen` wrapper | — | takes a budget slot and records the call against the Jenkins axis, separately from the git host |
| `ci-limit` | 3114 | answers `predicted` for Jenkins with a stated basis — an absent limit is not a zero limit |
| the instance refusal | 2286 | exit 3, naming three repairs: add the key, set `JENKINS_INSTANCE`, or drop `CI: jenkins` |

**SO ONE READER SEES JENKINS AND EVERY OTHER READER DOES NOT.** `pr-list --rich` overlays the map onto its rows; the build port — which the board's check state, the BuildMonitor and `an-agent-learns-its-pr-failed` all read — gets `buildNone()`. That asymmetry is the defect: the same repository answers two ways depending on which door was used.

**`build-shell.ts` IS ALREADY GENERIC.** It takes the CI system as a parameter and `build-actions.ts` is a thin cap on it, which is why this connector is small for the same reason the tracker split was.

## What this is not

**Not a rewrite of `jenkins_build_map`.** It works and it was measured. The connector calls it.

**Not a claim that Jenkins is verified.** `jen` is not installed on the machine that ships this code, measured 2026-09-07 and again 2026-09-08. This slice is built against stubs the way the Jira connector was, and `the-connector-is-read-against-a-real-instance` is the separate slice that reads a real answer.

**Not a rate-limit implementation.** Jenkins reports no limit and `ci-limit` already answers `predicted`. An absent limit is an answer.

## Slices

### The run ops ask the CI backend (Branch: bug/the-run-ops-ask-the-ci-backend)

`plot-host.sh`'s `runs` and `run-for-sha` branch on `ci_backend()` instead of calling `gh` unconditionally.

**THIS COMES FIRST BECAUSE THE CONNECTOR HAS NOTHING TO CALL WITHOUT IT.** Measured 2026-09-08: neither arm mentions `ci_backend`, so a Jenkins repository asking for runs gets a GitHub answer about a repository whose CI is not GitHub, or nothing.

**A BACKEND WITH NO ARM ANSWERS `unaskable`, NEVER EMPTY.** An empty run list means *this branch has no runs*; not being able to ask means something else, and `ci-limit`'s `*)` arm already draws that line for an unknown connector.

**Done when** `runs` and `run-for-sha` dispatch on `ci_backend()`, a Jenkins repository reaches `jenkins_build_map` rather than `gh`, an unconfigured CI answers `unaskable` rather than an empty list, and `scripts/check-host-cli-callers.sh` still passes.

### `build-jenkins.ts` answers the three operations (Branch: feature/the-ci-connector-is-jenkins) <!-- waits: bug/the-run-ops-ask-the-ci-backend -->

The connector implements `BuildPort` through `plot-host.sh`, and `buildFor` gains its second arm.

**IT WAITS FOR THE ARMS ABOVE.** A connector whose script has no Jenkins branch would be tested against a stub and fail against the estate.

**`jen` IS NOT INSTALLED HERE**, and the estate already answers how to test that: `tracker-shell.test.ts:78` stubs `plot-host.sh` itself. That tests the connector's shape, its refusals, and what it does with an answer.

**WHAT THE STUB CANNOT PROVE IS THE ANSWER'S SHAPE**, and the PR must say so rather than implying coverage it does not have.

**Done when** `build-jenkins.ts` answers `runs`, `runForSha` and `limit`; `limit()` reports `predicted`; an unreachable Jenkins refuses rather than returning an empty list; `buildFor('jenkins')` returns it; and the PR states what a stub proved and what it could not.

## Notes

### Why the port matters more than the overlay — 2026-09-08

The board already shows Jenkins checks through `pr-list --rich`, so a reader might ask what this buys. **It buys every other reader.** `an-agent-learns-its-pr-failed` shipped in 2.15.0 and reads the build port: on a Jenkins team an agent whose PR goes red is told nothing, because the port answers `unaskable` while the board beside it shows the failure.

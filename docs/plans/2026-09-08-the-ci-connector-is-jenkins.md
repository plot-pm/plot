# The CI connector is Jenkins

> `CI: jenkins` resolves to `buildNone()`, a connector that reaches nothing. The board's check column on a Jenkins team is empty — and the shell already holds a working Jenkins reader that the port cannot see.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** the-board-is-blank-where-it-matters
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 5
- **Approved:** 2026-09-08, Jan Wloka, plan-PR #834 merged

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

**AND THE MAP DOES NOT FIT THE PORT, WHICH IS THE PLAN'S CENTRAL RISK.** `jenkins_build_map()` answers ONE state per branch — `{color, checks, job}`, the shape a board row needs. The port asks for two other things:

| port operation | what it needs | what the map has |
|---|---|---|
| `runs(branch, limit)` | a history: `BuildRun{workflow, conclusion, startedAt, url}` | one current state, no history, no timestamps, no URL |
| `runForSha(branch, sha)` | the run for a COMMIT | no commit at all |

**MEASURED AGAINST THE LIVE INSTANCE, 2026-09-08 — BOTH ANSWERS EXIST, AND THE REST API HAS THEM.** `jenkins-ci-webbloqs.internal.quatico.dev`, authenticated, reading the `quaweb` folder that builds `quaweb-website`:

| what the port needs | where it is | measured value |
|---|---|---|
| the job tree | `quaweb` is a `Folder`; `continuous-build` a `WorkflowMultiBranchProject` | 5 children, one multibranch |
| a branch's identity | branch jobs are percent-encoded | `bug%2Fkarussell-dreifach`, 92 of them |
| **a history** | `.../job/<branch>/api/json` → `builds[]` | present |
| `conclusion` | `lastBuild` → `result` | `SUCCESS` |
| `startedAt` | `timestamp` | epoch ms, converts to ISO-8601 |
| `url` | `url` | the build's address |
| **the commit sha** | `actions[]` → `BuildData.lastBuiltRevision.SHA1` | `10edd32d…`, paired with `branch[].name` = `bug/karussell-dreifach` |

**So `runForSha` is answerable and `runs` is a real history**, not one state dressed as a list. The shape mismatch above is a mismatch with `jenkins_build_map`'s *output*, not with Jenkins.

**AND THE `jen` CLI IS THE PART THAT IS NOT ATTESTED.** Exactly two subcommands appear anywhere in this estate — `jen auth status` and `jen job list`, both inside `jenkins_build_map`. The binary is in no PATH, at none of the usual install locations, and no npm global; `quaweb-website`, the repository this instance builds, does not mention `jen` at all and documents the web UI instead. A build history and a build's commit sha are attested nowhere **for the CLI** — while the REST API answers both.

**THIS IS THE ONE PLACE A STUB CANNOT STAND IN FOR THE INSTANCE.** A stub proves *given this output, the connector does X*; it cannot say the command exists or that its output looks like that. The Jira connector had the same shape of risk and the same answer — but Jira's operations were already driven by `plot-host.sh` arms somebody had run.

**THE INSTANCE WAS READ, SO THE OPEN QUESTION IS THE TRANSPORT, NOT THE DATA.** Everything the port needs is in Jenkins and was measured through its REST API. What no longer needs deciding: whether a history exists, whether a build names its commit, how a multibranch job is addressed.

**`jen` STAYS THE PRIMARY TRANSPORT AND REST IS ITS FALLBACK**, which is a shape this script already has rather than a new idea: `plot-host.sh:850` records `pr-state` as *"the only op with a REST fallback written"*, and the same two-transport arrangement applies here for the same reason — the CLI is the intended route, and the fallback exists for where it cannot go.

**AND THE FALLBACK IS NOT SPECULATIVE, WHICH IS WHAT SEPARATES IT FROM A SECOND IMPLEMENTATION NOBODY NEEDS.** `jen` is in no PATH here, at none of the usual install locations, and no npm global; nothing in this estate says where it comes from; and `quaweb-website` — the repository this very instance builds — does not mention it, documenting the web UI instead. **An agent on a machine without `jen` is the normal case, not the edge one.** Without the fallback that agent reports `unaskable` while a reachable Jenkins holds the answer.

**IT FALLS BACK ON ABSENCE, NEVER ON A BAD ANSWER.** `command -v jen` failing, or `jen` reporting `NOT reachable`, routes to REST. A `jen` that answers something unrecognised does not: that is the `unknown` case `jenkins_build_map` already degrades to failure-shaped, and retrying it over a second transport would turn *cannot verify* into a guess.

**NO SECRET REACHES `jen`'s ARGUMENT LIST, AND THE REASON IS THAT NOBODY HERE CAN CHECK IT.** `curl --user` is safe — measured 2026-09-08: with a connection held open, `ps -o args=` shows the flag with an **empty value**, because curl overwrites it in memory, which is what `plot-host.sh:1315` already claims for the Jira path. **`jen` cannot be measured the same way**: it is not installed, and its argv handling is a property of a binary this estate cannot inspect.

So the connector passes credentials to `jen` through the environment only — `JENKINS_USER` and `JENKINS_TOKEN`, which `jen auth status` already relies on — and never as a flag. A process table on a shared build machine is readable by every user on it, and *"the CLI probably blanks it"* is not a property to assume on a binary nobody here has run.

**THE FALLBACK NEEDS ONE MORE FACT THAN THE PATH IT REPLACES**, the same way the GitHub one does. `gh pr view` infers its repository from the remote while `gh api` must be told; likewise `jen -I <slug>` resolves an instance the REST path must be given in full, plus credentials. `JENKINS_USER` and `JENKINS_TOKEN` are read from the environment exactly as `JIRA_EMAIL` and `JIRA_API_TOKEN` already are at `plot-host.sh:1299` — **and an unauthenticated Jenkins must refuse rather than report an empty build list**, which is the failure direction that section states for Jira and that the 2026-08-17 GitHub outage established for the whole script.

**A stub cannot prove a CLI's output, and now it does not have to for REST.** The shapes above are recorded: `builds[]`, `result`, `timestamp`, `url`, and `actions[].BuildData.lastBuiltRevision.SHA1` paired with its branch name.

**Not a rate-limit implementation.** Jenkins reports no limit and `ci-limit` already answers `predicted`. An absent limit is an answer.

**Not the `Jenkins instance` key, though nothing here works without it.** `plot-host.sh:2286` exits 3 when it is missing, so a connector alone leaves a teammate with a refusal naming three repairs they were never told to make. Writing that key is an adoption question — it comes from the same signal as `CI: jenkins` and is proposed in the same breath — so it lives in `the-probe-reads-the-ci-system` rather than here. **This plan is not done in the sprint's terms until that slice lands.**

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

**Done when** `build-jenkins.ts` answers `runs`, `runForSha` and `limit`; `limit()` reports `predicted`; `buildFor('jenkins')` returns it; the REST fallback fires when `jen` is absent or reports unreachable and NOT when it answers something unrecognised; an unauthenticated Jenkins refuses rather than returning an empty list; credentials come from `JENKINS_USER`/`JENKINS_TOKEN` and appear in no command line a process table would show; and the PR states what a stub proved and what it could not.


## Notes

### Why the port matters more than the overlay — 2026-09-08

The board already shows Jenkins checks through `pr-list --rich`, so a reader might ask what this buys. **It buys every other reader.** `an-agent-learns-its-pr-failed` shipped in 2.15.0 and reads the build port: on a Jenkins team an agent whose PR goes red is told nothing, because the port answers `unaskable` while the board beside it shows the failure.

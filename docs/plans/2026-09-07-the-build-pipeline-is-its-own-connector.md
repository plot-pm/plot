# The build pipeline is its own connector

> A Bitbucket + Jenkins + Jira team has three remote services. Two have a port; the build pipeline has none, and `runs()` reaches `gh` alone from inside `host`.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #782 merged
- **Started:** 2026-09-07, Jan Wloka, `bug/a-pipeline-address-is-not-the-host`
- **Delivered:** 2026-09-08
- **Released:** 2026-09-08, 2.15.0

## Changelog

- The build pipeline becomes its own connector port with a Jenkins implementation, and the host adapter stops carrying a closed list of vendors — so a team whose code and builds live in different places is asked about each separately.

<!-- Board impact: the board renders check state from `runs()`. A capability
     that cannot be asked must render as *not asked*, never as no checks. -->

## Motivation

**Measured 2026-09-07.** `host.runs(branch, limit)` is the only way Plot learns a build's state, and `plot-host.sh`'s `runs` arm contains **one `gh` call and no other vendor**. `jen` appears in the script for exactly two things — `jen -` and `jen auth` — so the CLI is probed for credentials and never asked a question.

**On a Bitbucket + Jenkins team the board's check column is not wrong. It is absent** — and absence rendered as *no checks* is the one failure the estate's own rule forbids: `plot-board-probe.sh` treats an unrecognised auth answer as *cannot verify*, never as *authenticated*.

**THE SHELL ALREADY NAMES THE AXIS.** `plot-host.sh:260` documents `ci-limit` as *"the same question of the CI connector, which is a separate axis: this repo is GitHub + Actions, ekzweb is Bitbucket + Jenkins. Jenkins reports no limit, so it answers `predicted`."* The op exists, the separation is written down, and the port does not reflect it.

**AND THE CONNECTOR CONTRACT ALREADY DECIDED THIS.** CLAUDE.md: a **connector** reaches a remote service and *"has an account, credentials, a rate limit and a transport choice"*, and *"the rate-limit contract belongs to the connector kind, not to every adapter."* Jenkins has its own URL, its own token and its own window. Asking `host` about it makes one connector hold two accounts — the exact shape splitting `tracker` out of `host` was written to fix.

**THREE PORTS, EACH WITH TWO VENDOR CONNECTORS — AND ONLY ONE PORT HAS THEM TODAY.** Measured 2026-09-07:

| port | connectors on disk |
|---|---|
| `tracker` | `tracker-github.ts`, `tracker-jira.ts`, `tracker-none.ts`, `tracker-fixture.ts` — **the finished shape** |
| `host` | `host-shell.ts`, `host-fixture.ts` — **one shell that branches on vendor inside itself** |
| `build` | none — the operations live on `host` |

**A vendor branch inside one adapter is not two connectors.** `host-shell.ts` reaches GitHub and Bitbucket through one object, so both vendors share one refusal path, one budget and one `lastRefusal`. The connector contract says each remote service owns those — and a team on Bitbucket whose GitHub token expires should not see a Bitbucket refusal shaped by GitHub's state.

**ROUND 1 CUT THE HOST SPLIT FROM THIS PLAN.** The two-connector shape is right and `host` does not have it — but 81 working `bb` calls and their GitHub siblings would be restructured in a sprint whose goal is *a first unattended run working*. **Nothing in that run depends on separate budgets**; what blocks a third host is the vendor list, which is one slice below. The split earns its own plan when a cross-vendor refusal is actually met.

**So this plan builds the missing port and opens the closed list, and leaves the working path alone.**

**THE PRECEDENT IS THE TRACKER, AND IT IS COMPLETE.** `ports/tracker.ts` declares five operations; `tracker-resolve.ts` picks a connector from a declared scheme; `tracker-none.ts` answers `unaskable` on every operation **including the write**, because a silent success there would report a status that never left the machine. Four connectors, one port, no vendor branch in the domain. **This plan is that shape for builds.**

## What this is not

**Not a Jenkins client.** `jen` is the CLI and stays the CLI; the connector shells to it exactly as `host` shells to `gh` and `bb`.

**Not a change to what a build run means.** `BuildRun` — `workflow`, `conclusion`, `startedAt`, `url` — is vendor-neutral already and does not move.

**Not a second rate-limit mechanism.** `LimitReading` is shared; the point is that the CI connector reports its **own**.

## The three services are domain concepts, and two of them are not named

**`BuildPipeline` already exists** (`entities/build.ts:29`) — *"the thing that runs, stable across runs"*, with a name and a URL. **`GitHost` and `Tracker` have no entity at all.** Both exist only as ports and connectors, so the thing a team actually has — *this repository's code lives on that Bitbucket* — is expressed nowhere a rule can read it.

**THE CONFLATION IS ALREADY VISIBLE IN THE ONE ENTITY THAT EXISTS.** `BuildPipeline.url` is documented as *"its address on the host"*. On this repo that is true by accident — GitHub is both the git host and the CI system. **On a Bitbucket + Jenkins team it is false**: the pipeline's address is on Jenkins, and the host is somewhere else entirely. One word doing two jobs, in the entity that would have said so.

**SO ALL THREE GET AN ENTITY, AND THEY ARE THREE.** A `GitHost` is where branches and pull requests live. A `Tracker` is where issues live. A `BuildPipeline` is what runs when a branch moves. **A team names each independently** — `Git host`, `Tracker` and `CI system` are already three separate `## Plot Config` keys — and the domain should hold what the config already separates.

**WHAT AN ENTITY BUYS THAT A PORT DOES NOT.** A port is *how to ask*; an entity is *what is there*. Today a rule cannot say **"this plan's PR is on a host that cannot be reached"** without a connector in hand, because there is no value describing the host. That is why `unaskable` currently travels as a refusal shape rather than as a fact about a service.

## Slices

### `BuildPipeline` names the CI system, not the host (Branch: bug/a-pipeline-address-is-not-the-host)

`BuildPipeline.url` stops being documented as *"its address on the host"*.

**ONE LINE, AND IT IS THE MEASURED DEFECT.** `entities/build.ts:32` says the URL is on the host. On this repository that is true by accident — GitHub is both the git host and the CI system. **On a Bitbucket + Jenkins team it is false**: the pipeline's address is on Jenkins and the host is elsewhere. One word doing two jobs, in the entity that would have said so.

**NO NEW ENTITIES.** Round 1 tested the argument for `GitHost` and `Tracker` entities and it did not survive: I justified them by claiming a rule cannot express *"this service could not be asked"* without a connector. **`ConditionReading` already carries exactly that**, and `reapable`, `landed`, `movable` and `task` use it. **No rule reads a host fact at all today**, so the entities would arrive with no consumer — which is `scoreItem`, filed the same morning: exported, tested, documented, and called by nothing.

**AN ENTITY ARRIVES WHEN A RULE NEEDS ONE.** The layering rule says the domain defines what it needs, not what it might.

**Done when** `BuildPipeline.url` names the CI system rather than the host, and no entity is added without a rule that reads it.

### The build port exists, with two connectors (Branch: feature/the-build-port-exists)

`ports/build.ts` declares the operations `host` carries today; `build-actions.ts` and `build-jenkins.ts` implement them, with `build-none.ts` and a fixture beside them.

**THREE OPERATIONS, THE ONES THAT ARE ALREADY THERE:** `runs(branch, limit)`, `runForSha(sha)`, `limit()`. Do not invent a fourth while moving them.

**`buildNone` IS PART OF THIS SLICE, NOT A FOLLOW-UP.** The tracker's lesson: a repository that declared no CI must get a connector that answers `unaskable`, not an interface that throws or an empty array. **An empty run list and an unaskable CI are different facts**, and the board renders them differently.

**`host.runs()` IS REMOVED, NOT DEPRECATED.** One caller — `fleet.ts:2105`. Two ways to ask one question is the defect this plan exists to remove, and leaving the old one is leaving it.

**Done when** `ports/build.ts` declares the three operations, GitHub Actions answers them through a connector, a repository with no CI gets `buildNone` answering `unaskable`, `host` no longer declares `runs`, and `fleet.ts` asks the build port.

### The adapter stops judging vendors (Branch: bug/the-adapter-stops-judging-vendors)

`host-shell.ts` reports the backend the script named and refuses none of them.

**`const DRIVES = ['github', 'bitbucket']` AT `host-shell.ts:30` IS THE DEVIATION CLAUDE.md ALREADY NAMES.** `ports/host.ts:16` says `HostBackend = string` — the port is open and the adapter is closed, so *"adding GitLab is not an adapter-only change today"* is true of a list, not of a design.

**THE SCRIPT IS WHERE DRIVABILITY IS KNOWN.** `plot-host.sh` either has an arm for a backend or it does not, and it answers accordingly. An adapter that second-guesses that answer holds a copy of a fact it does not own.

**THE REFUSAL DOES NOT DISAPPEAR — IT MOVES.** A backend the script cannot drive must still refuse, and it must still name what it was told. What changes is who decides.

**Done when** `host-shell.ts` declares no vendor list, an unknown backend refuses with the word the script reported, and a new host backend needs no edit in `packages/domain`.

### The CI connector is Jenkins (Branch: feature/the-ci-connector-is-jenkins) <!-- waits: feature/the-build-port-exists -->

`build-jenkins.ts` answers the three operations through `jen`.

**IT WAITS FOR THE PORT.** No connector before the seam exists.

**`jen` IS NOT INSTALLED ON THIS MACHINE**, measured 2026-09-07 — and the estate already answers how to test that. `tracker-shell.test.ts:78` stubs `plot-host.sh` itself: `[ "$PLOT_TRACKER" = jira ] || exit 1; echo '{"number":"PROJ-1"}'`. **That is how the Jira connector is tested without Jira**, and it tests the right thing: the connector's shape, its refusals, and what it does with an answer.

**WHAT THE STUB CANNOT PROVE IS THE ANSWER'S SHAPE**, and the slice must say so rather than implying coverage it does not have. A fixture asserts *given this output, the connector does X*; only a real instance says the output looks like that. **Name that gap in the PR.**

**JENKINS REPORTS NO RATE LIMIT, AND THAT IS AN ANSWER.** `plot-host.sh:263` already says it answers `predicted`. An absent limit is not a zero limit and not an error.

**Done when** `build-jenkins.ts` answers the three operations, `limit()` reports `predicted`, an unreachable Jenkins refuses rather than returning an empty list, and the slice states what was tested against a real instance and what was not.

## Notes

### Why the tracker split is the right precedent — 2026-09-07

The tracker was moved off `host` for one measured reason: *"asking one interface about both made a capability belonging to one service report `not my department` through the other."* CI is the same relationship. A team's builds and its pull requests are two services that happen to be mentioned in one workflow.

**And the estate is already asymmetric in the right direction.** The tracker has four connectors and a resolver; the host has two adapters and a hardcoded vendor list. The tracker is the finished shape and this plan copies it.

### What is NOT missing, measured 2026-09-07

This plan is narrow because the rest of the chain is already built, and the sprint should not spend on it:

- **Jira is fully wired.** `ports/tracker.ts`, `tracker-jira.ts` with its own `statusWrite`, and `issue-list` / `issue-view` / `issue-status` all carry a `jira` arm in `plot-host.sh` — 38 mentions.
- **Bitbucket covers eight of eleven host operations.** `pr-list` and `issue-list` at 8 `bb` calls each, `issue-view` 4, `pr-state` 3, `default-branch` and `pr-ready` 2, `pr-body` / `pr-create` / `pr-merge` / `pr-merged` 1 each.

**The three Bitbucket has no arm for are `runs`, `run-for-sha` and `ci-limit`** — which is this plan. The gap is one axis, not three integrations.

### Round 1 — 2026-09-07

**Two of five slices were cut, and one of them on a false premise I had written myself.**

The `GitHost`/`Tracker` entity slice rested on *"a rule cannot state this service could not be asked without a connector in hand"*. **`ConditionReading` does exactly that**, and four rules already use it. Worse, **no rule reads a host fact at all**, so the entities would have arrived with no consumer — the shape of `scoreItem`, which I filed as a defect the same morning. What survived is the one measured line: `BuildPipeline.url` claims an address on the host, and on the target stack that is false.

The host split was cut for cost, not correctness. Two connectors per port is the finished shape and `tracker` has it; `host` restructuring 81 working `bb` calls buys separate budgets that **this sprint's goal does not need**. The `DRIVES` list is what blocks a third host, and it stays.

**What the round did not change:** the build port. `runs()` on `host` reaching `gh` alone is the gap a Jenkins team hits on day one, and nothing in the estate answers it.

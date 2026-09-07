# Three services, three ports, two connectors each

> A Bitbucket + Jenkins + Jira team has three remote services. Plot has one entity for one of them, one port that branches on vendor inside itself, and no port for CI at all.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

## Changelog

- Git host, tracker and build pipeline are three domain concepts with three ports, each reached by a connector per vendor — so a team whose code, issues and builds live in three places is expressed as three services rather than one.

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

**So the target is symmetric: three ports, each with a GitHub-family connector, a Quatico-stack connector, a `none`, and a fixture.**

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

### The three services are named in the domain (Branch: feature/a-git-host-is-a-domain-concept)

`GitHost` and `Tracker` join `BuildPipeline` as entities, and `BuildPipeline` stops claiming its URL is on the host.

**IDENTITY IS THE VENDOR PLUS THE ADDRESS**, the shape `BuildPipeline` already uses: a natural key, stable across the questions asked of it. `github`/`bitbucket` alone is not an identity — two teams on Bitbucket Cloud are two hosts.

**THEY CARRY WHAT A RULE NEEDS AND NOTHING ELSE.** No credentials, no tokens, no transport — those belong to the connector, and an entity holding them would put a secret in a value that gets logged.

**`BuildPipeline.url` IS CORRECTED IN THE SAME SLICE.** *"Its address on the host"* becomes its address on the **CI system**, because on the target stack those are different machines. One line, and it is the sentence that proves the split is real.

**ASKABILITY BECOMES A PROPERTY OF THE SERVICE.** A rule can then state *this host cannot be reached* as a fact about a `GitHost`, rather than every caller re-deriving it from a `PortResult`'s refusal shape.

**Done when** `GitHost`, `Tracker` and `BuildPipeline` are three entities with stated identities, none carries a credential, `BuildPipeline.url` names the CI system rather than the host, and a rule can express *this service could not be asked* without holding a connector.

### The build port exists, with two connectors (Branch: feature/the-build-port-exists) <!-- waits: feature/a-git-host-is-a-domain-concept -->

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

### The host port gets two connectors (Branch: feature/the-host-port-gets-two-connectors) <!-- waits: bug/the-adapter-stops-judging-vendors -->

`host-github.ts` and `host-bitbucket.ts` replace the vendor branch inside `host-shell.ts`, resolved the way `tracker-resolve.ts` resolves a scheme.

**THE SHELL LAYER STAYS AND STOPS DECIDING.** `tracker-shell.ts` is the model: one place that runs `plot-host.sh`, and connectors above it that own their vendor's shape. The script is not rewritten — 81 `bb` calls and their GitHub siblings already work.

**EACH CONNECTOR OWNS ITS OWN REFUSAL AND ITS OWN BUDGET.** That is the whole reason for the split: today one `lastRefusal` and one limit reading serve two accounts, so a Bitbucket team reads GitHub's exhaustion as their own.

**`hostNone` IS PART OF IT.** A checkout with no git host — a local-only adoption — must get a connector that answers `unaskable`, not a throw.

**Done when** `host-github.ts` and `host-bitbucket.ts` each answer the port, a resolver picks one from the declared `Git host`, each reports its own refusal and limit, `hostNone` answers `unaskable`, and no vendor name appears in `host-shell.ts`.

### The CI connector is Jenkins (Branch: feature/the-ci-connector-is-jenkins) <!-- waits: feature/the-build-port-exists -->

`build-jenkins.ts` answers the three operations through `jen`.

**IT WAITS FOR THE PORT.** No connector before the seam exists.

**`jen` IS NOT INSTALLED ON THIS MACHINE**, measured 2026-09-07 — so the slice must state how it was tested. A fixture connector proves the shape; only a Jenkins instance proves the connector.

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

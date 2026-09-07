# Sprint: The board serves a team

> Plot has been used by one person on one machine against GitHub. The next users are teammates on Bitbucket, Jenkins and Jira, and they will start it unattended — nobody will be sitting beside them to read a refusal aloud.

## Status

- **State:** Planning
- **Start:** 2026-09-08
- **End:** 2026-09-22
- **Release:** 2.15.0

## Sprint Goal

**A teammate on Bitbucket, Jenkins and Jira runs Plot unattended from adoption to a delivered plan, and every refusal on that path tells them what to do next.**

Two halves, and the second is what makes the first a goal rather than a port. **Working** means the commands complete against that stack. **Unattended** means a teammate who has never read this repository can act on whatever the commands say — because there is nobody to ask.

**Four conditions, all of which must hold.**

| condition | what it rules out |
|---|---|
| **adopted** | a first run that assumes GitHub, or asks a question whose answer is in the repo |
| **connected** | an operation that works on GitHub and is absent, not refused, on Bitbucket or Jenkins |
| **legible** | a refusal that names a cause without naming the repair |
| **unattended** | a path that needs somebody who already knows Plot |

**EVERY ITEM HERE IS A DEVELOPER-EXPERIENCE DEFECT, INCLUDING THE ONES THAT LOOK LIKE PLUMBING.** A rule with two implementations is not an architecture concern until a teammate reads two answers to one question and cannot tell which is Plot's. A `--stop` that refuses is not a lookup bug until somebody reaches for `kill` and loses a desk. A PR that goes red unnoticed is not a monitoring gap until the person who would notice is not the person who dispatched.

**On one machine each of these is an annoyance somebody absorbs. On a team each is a moment where Plot asks to be understood rather than used** — and that is the same failure the goal names, arriving through a different door.

### The estate is further along than it looks, and the gaps are specific

**Measured 2026-09-07.** `plot-host.sh` carries a Bitbucket branch for **eight of eleven** PR and issue operations: `pr-list` and `issue-list` (8 `bb` calls each), `issue-view` (4), `pr-state` (3), `default-branch` and `pr-ready` (2), `pr-body`, `pr-create`, `pr-merge`, `pr-merged` (1 each). The tracker port already has **four connectors**, `tracker-jira.ts` among them. `plot-board-probe.sh` already checks `gh`, `bb` **and** `jen` auth.

**So this is not a port. It is the last mile**, and the last mile is where a first run fails.

**THE CI OPERATIONS ARE THE HOLE.** `runs`, `run-for-sha` and `ci-limit` reach `gh` and nothing else — zero `bb`, zero `jen`. On a Jenkins team the board's check state is not wrong; it is **absent**, and `jen` is not even installed on the machine that ships the code calling it.

**AND ADOPTION NEVER ASKS ABOUT TWO OF THE THREE.** `plot-detect-repo.sh` names `bitbucket` seven times and **`jira` and `jenkins` zero times**. A teammate adopting Plot in a Jira shop is asked nothing about the tracker they use every day, and gets `trackerNone` — which answers `unaskable` on every operation, correctly and uselessly.

### What "unattended" means here

**A refusal names the repair, in the words of the stack the reader is on.** `plot-fleetctl.sh`'s node refusal is the working example: it does not say *wrong version*, it says `nvm use`. Every refusal a first run can hit must be that specific — and *"`jen` not found"* must say what to install, not what was missing.

**A first run must not require reading this repository.** The measure is blunt: a teammate follows `/plot-init`, then `/plot-idea` through `/plot-deliver`, and needs no file in `skills/` and no person. Anything they must be told is a defect in what they were shown.

**The board is the surface, and it must not lie by omission.** A check state the board cannot fetch must read as *not asked*, never as *no checks* — the same rule `plot-board-probe.sh` already applies to auth, where an unrecognised answer means *cannot verify* and never *authenticated*.

## MoSCoW

### Must Have

- [ ] [adoption-asks-about-the-stack] `/plot-init` probes for Jira and Jenkins as it already probes for Bitbucket, and proposes `Tracker:` and the CI connector from what it finds. Measured 2026-09-07: `plot-detect-repo.sh` names `bitbucket` 7 times, `jira` and `jenkins` **0**. A teammate in a Jira shop is asked nothing and silently gets `trackerNone`

- [ ] [the-build-pipeline-is-its-own-connector] Git host, tracker and build pipeline become three domain concepts with three ports, each reached by a connector per vendor. Measured 2026-09-07: `tracker` already has that shape with four connectors; `host` is **one shell branching on vendor inside itself**, so two accounts share one refusal path and one budget; `build` has no port at all and `runs()` reaches `gh` alone. **4 slices after round 1**, which cut the entity slice (no rule would have read it) and the host split (81 working `bb` calls restructured for a budget separation this sprint's goal does not need). Plan filed 2026-09-07

- [ ] [a-first-run-refusal-names-its-repair] Every refusal reachable in a first unattended run names the command that fixes it. The bar is `plot-fleetctl.sh`'s node refusal, which says `nvm use` rather than *wrong version*. Walk `/plot-init` → `/plot-deliver` on a Bitbucket/Jenkins/Jira checkout with no credentials and fix every message that only states a cause

### Should Have

- [ ] [the-board-says-what-it-could-not-ask] A capability the board cannot reach renders as *not asked*, never as an empty result. The supervisor badge shipped in 2.14.0 is the shape: three states, `unknown` first-class, and the prominence rule keyed on consequence

- [ ] [a-dispatch-stop-finds-the-desk] `plot-dispatch.sh:1171` rebuilds the desk path from the branch name, so `--stop` refuses every agent `--start` creates. A teammate whose first fleet stop refuses will reach for `kill`, which is the guess the one stop rule exists to prevent. Plan filed 2026-09-07

- [ ] [an-agent-state-has-one-deriver] The domain declares the eight agent states, validates transitions between them and **derives none** — `plot-worker-state.sh` decides all eight, and `observeAgentState` is reached only by a re-export. The state-declaration gate reads clean because it asks whether an enum declares its kind, not whether anything derives one. **The lifecycle the fleet reads most, and the third instance of this shape found in one session.** Plan filed 2026-09-07

- [ ] [a-sprint-item-has-one-scorer] `scoreItem` is exported, tested and documented in the domain, and **nothing calls it** — the live rule is 12 lines of bash that already disagree with it about an item with no plan. This is the previous sprint's own goal unmet in one place, and it is here rather than in its Notes because a team reads sprint status more often than one person does. Plan filed 2026-09-07

- [ ] [a-withdrawn-item-is-not-open] <!-- waits: a-sprint-item-has-one-scorer --> A sprint item whose plan was withdrawn reports as withdrawn rather than blocking a release forever. **It waits for the single scorer**: against today's split it is four edits with no gate, because the bash and the TypeScript cannot import each other. Plan filed 2026-09-07

### Could Have

- [ ] [an-agent-learns-its-pr-failed] An agent whose PR fails CI is told. Three PRs sat red in one session while their agents slept. On a team this is worse: the person who would notice is not the person who dispatched. Plan filed 2026-09-07

- [ ] [a-merged-ref-is-reported-too] The scan reports a remote ref whose PR merged. Nine accumulated unseen on this estate; a team generates them faster. Plan filed 2026-09-07

## Notes

### Why the goal is a walkthrough and not a feature list — 2026-09-07

Every previous sprint here could be measured by grepping the estate. **This one cannot.** *"A teammate can act on what they were shown"* is a claim about a person, and the only instrument is a person who does not already know the answer.

So the Must Haves are written to be **falsified by one walkthrough**: adopt on a Bitbucket/Jenkins/Jira checkout, run the lifecycle, and count the moments somebody had to be asked. That count is the sprint's real measure, and it should be zero.

### What this sprint inherits — 2026-09-07

2.14.0 shipped with three known holes, all of which a team hits sooner than one person:

- **`plot-sprint-release.sh` reaches the domain zero times** while six sibling scripts do — the previous sprint's own goal unmet in one place. `a-sprint-item-has-one-scorer` is filed and ordered before `a-withdrawn-item-is-not-open`.
- **The supervisor is removed by something unidentified**, does not restart itself, and needs a hand reload. Six explanations tested and disproved. On one machine that is an annoyance; on a team it is a fleet that stops without anyone being told.
- **One domain test is load-flaky** against the live host. On a team the suite runs more often, from more machines, and a flake nobody can distinguish from a break is a suite people stop trusting.

**Two of these ARE in this sprint's MoSCoW, and the third is not.**

`a-sprint-item-has-one-scorer` is a Should: two implementations of one rule that already disagree is a teammate reading two answers and having to know which one Plot means. It brings `a-withdrawn-item-is-not-open` with it, gated by a `waits:` annotation, because against today's split that plan is four edits with no gate.

**The supervisor's unexplained removal is deliberately not an item.** Six explanations have been tested and disproved, so nothing here could be written as a done-when — and a sprint item whose completion cannot be stated is a wish. What ships instead is 2.14.0's supervisor badge, which makes the absence visible while the cause is unknown; if a seventh explanation is found in this window it earns its own plan.

**`one-account-has-one-budget` was listed here and has been removed.** Its plan is `Released` — it settled shared budget arithmetic across boards on 2026-09-01. What this sprint actually needs from that area is the `DRIVES` vendor list at `host-shell.ts:30`, and that is a slice of `three-services-three-ports`. **An item pointing at a released plan claims work that already shipped.**

**The load-flaky domain test is not an item either**, for the opposite reason: the release list already tells a cutter to run the suite twice, which is the whole fix until it fails twice at the same assertion.

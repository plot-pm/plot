# Sprint: The board serves a team

> Plot has been used by one person on one machine against GitHub. The next users are teammates on Bitbucket, Jenkins and Jira, and they will start it unattended — nobody will be sitting beside them to read a refusal aloud.

## Status

- **State:** Active
- **Committed:** 2026-09-07
- **Started:** 2026-09-07
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

- [x] [adoption-asks-about-the-stack] `/plot-init` probes for Jira and Jenkins as it already probes for Bitbucket, and proposes `Tracker:` and the CI connector from what it finds. Measured 2026-09-07: `plot-detect-repo.sh` names `bitbucket` 7 times, `jira` and `jenkins` **0**. A teammate in a Jira shop is asked nothing and silently gets `trackerNone` <!-- pr: #781, status: delivered, branch: feature/adoption-proposes-the-stack>

- [x] [the-build-pipeline-is-its-own-connector] Git host, tracker and build pipeline become three domain concepts with three ports, each reached by a connector per vendor. Measured 2026-09-07: `tracker` already has that shape with four connectors; `host` is **one shell branching on vendor inside itself**, so two accounts share one refusal path and one budget; `build` has no port at all and `runs()` reaches `gh` alone. **4 slices after round 1**, which cut the entity slice (no rule would have read it) and the host split (81 working `bb` calls restructured for a budget separation this sprint's goal does not need). Plan filed 2026-09-07 <!-- pr: #782, status: delivered, branch: bug/a-pipeline-address-is-not-the-host>

- [x] [the-lifecycle-runs-on-the-other-stack] One e2e test drives `/plot-init` → `/plot-deliver` unattended on a Bitbucket + Jenkins + Jira sandbox. **`unattended` is the one condition of the four with no plan** — not because it is unimplemented but because it is implemented eight times over and never exercised as a path: every skill handles `PLOT_UNATTENDED`, and `lifecycle.test.mjs` names Jira only in a config string with zero `bb`, `jen` or `PLOT_TRACKER` calls. **It must fail on arrival**, and its failing assertions name the plan that turns each green. Plan filed 2026-09-07 <!-- pr: #783, status: delivered, branch: infra/the-lifecycle-runs-on-the-other-stack>

- [x] [a-first-run-refusal-names-its-repair] Every refusal reachable in a first unattended run names the command that fixes it. The bar is `plot-fleetctl.sh`'s node refusal, which says `nvm use` rather than *wrong version*. Walk `/plot-init` → `/plot-deliver` on a Bitbucket/Jenkins/Jira checkout with no credentials and fix every message that only states a cause <!-- pr: #784, status: delivered, branch: bug/a-first-run-refusal-names-its-repair>

### Should Have

- [x] [the-board-says-what-it-could-not-ask] A capability the board cannot reach renders as *not asked*, never as an empty result. The supervisor badge shipped in 2.14.0 is the shape: three states, `unknown` first-class, and the prominence rule keyed on consequence <!-- pr: #785, status: delivered, branch: bug/the-board-says-what-it-could-not-ask>

- [ ] [a-dispatch-stop-finds-the-desk] `plot-dispatch.sh:1171` rebuilds the desk path from the branch name, so `--stop` refuses every agent `--start` creates. A teammate whose first fleet stop refuses will reach for `kill`, which is the guess the one stop rule exists to prevent. Plan filed 2026-09-07

- [x] [the-outer-boundary-is-a-port] Every external dependency reaches the world through a port named for **the domain concept it holds**, not for the API it uses. Measured 2026-09-07 in `packages/board/src` outside `adapters/`: **132 filesystem calls, 19 spawn sites, 7 files naming a `plot-*.sh` directly** — and the spawn ratchet reads healthy at 19/28 because a script reached through a helper is one spawn line. The paths are not generic: 21 sites spell `PLOT-BLOCKED`, whose concept is `Agent`. **A `Files` port would move all 132 and name nothing.** The four DDD patterns appear **zero times** in the domain and all four shapes are in use — `plan-store` is a repository, `host`/`tracker` are services, `prCreate`/`trees.add` are factories, `Plan`→`Slice` is an aggregate — so the plan names them rather than introducing them. Plan filed 2026-09-07 <!-- pr: #787, status: delivered, branch: feature/the-agent-gets-a-repository -->

- [x] [a-shell-script-asks-the-domain] One contract for how a shell script reaches a domain rule and how a test proves a duplicate agrees. **Three plans in this sprint each proposed the same corpus test and none knew the others existed**, and two gave different answers to *how does bash call the domain* — one naming `plot-ask.mjs`, written before `node` was measured at 39 ms. The estate already settled the hard half undocumented: `plot-pr-merged.sh` is sourced by four scripts while `reapable.ts` answers the same question in TypeScript. **Found by challenging the sprint as a set; every plan had passed its own round.** Plan filed 2026-09-07 <!-- pr: #788, status: delivered, branch: infra/a-shell-script-asks-the-domain>

- [x] [the-worker-loop-asks-the-domain] `plot-worker-loop.sh` is 1,832 lines, reaches the domain zero times, and decides `desk_is_resettable` from three conditions — while `rules/reapable.ts` answers the same question from five. **A desk carrying a `PLOT-BLOCKED` marker is not reapable by the rule and is resettable by the loop**, because the loop never looks. Two answers to *is this desk finished with*, and the more destructive one checks less. Plan filed 2026-09-07 <!-- pr: #789, status: delivered, branch: bug/the-worker-loop-asks-the-domain>

- [x] [an-agent-state-has-one-deriver] The domain declares the eight agent states, validates transitions between them and **derives none** — `plot-worker-state.sh` decides all eight, and `observeAgentState` is reached only by a re-export. The state-declaration gate reads clean because it asks whether an enum declares its kind, not whether anything derives one. **The lifecycle the fleet reads most, and the third instance of this shape found in one session.** Round 2 reshaped it: five scripts source the shell answer, one being the agent's own loop, and `node` costs 39 ms a call — so the deliverable is a corpus test asserting the two agree, the shape `plot-pr-merged.sh` already has against `reapable.ts`. Plan filed 2026-09-07, 2 rounds <!-- pr: #790, status: delivered, branch: feature/an-agent-state-has-one-deriver>

- [ ] [a-sprint-item-has-one-scorer] `scoreItem` is exported, tested and documented in the domain, and **nothing calls it** — the live rule is 12 lines of bash that already disagree with it about an item with no plan. This is the previous sprint's own goal unmet in one place, and it is here rather than in its Notes because a team reads sprint status more often than one person does. Plan filed 2026-09-07 <!-- pr: #791, status: approved, branch: bug/a-sprint-item-has-one-scorer -->

- [ ] [a-withdrawn-item-is-not-open] <!-- pr: #792, waits: a-sprint-item-has-one-scorer , status: approved , branch: bug/a-withdrawn-item-is-not-open> A sprint item whose plan was withdrawn reports as withdrawn rather than blocking a release forever. **It waits for the single scorer**: against today's split it is four edits with no gate, because the bash and the TypeScript cannot import each other. Plan filed 2026-09-07

### Could Have

- [ ] [an-agent-learns-its-pr-failed] An agent whose PR fails CI is told. Three PRs sat red in one session while their agents slept. On a team this is worse: the person who would notice is not the person who dispatched. Plan filed 2026-09-07

- [ ] [a-merged-ref-is-reported-too] The scan reports a remote ref whose PR merged. Nine accumulated unseen on this estate; a team generates them faster. Plan filed 2026-09-07

## Can this sprint reach its goal?

**Measured 2026-09-07, before the sprint opens. The honest answer is: not as scoped.**

The goal is one walkthrough — *a teammate on Bitbucket, Jenkins and Jira runs Plot unattended from adoption to a delivered plan*. **Four plans serve it. Nine do not mention the stack at all.**

| | plans | slices |
|---|---|---|
| **goal-facing** — adoption, the CI port, first-run refusals, board askability, the unattended walkthrough | 5 | **9** |
| **domain cohesion** — the seam, the deriver, the repository, the scorer, the loop | 9 | **10** |

**The cohesion work is real and it is not this goal.** It arrived on 2026-09-07 in one afternoon of measuring the estate — `scoreItem` uncalled, the agent state derived in bash, seven files naming a script, three plans inventing one corpus test. **Every one is a defect worth fixing and none of them is what a teammate on Bitbucket meets.**

**AND IT CARRIES THE ONLY DEEP CHAIN.** `a-shell-script-asks-the-domain` → `an-agent-state-has-one-deriver` → `the-outer-boundary-is-a-port` is three sequential slices, none of which can start before the one above it lands. The goal-facing eight are almost all independent.

**THE TWO-WEEK WINDOW MAKES THIS A CHOICE, NOT A WORRY.** 18 slices in 14 days is not the problem; **18 slices where 10 serve a different goal** is. A sprint that ships all ten and six of the eight has a better-factored domain and **no teammate has run anything**.

### What was checked for gaps and found covered — 2026-09-07

The goal path was walked step by step after the fourth condition was found missing. **Nothing else is absent**, and the checks are recorded so the next reader does not repeat them:

| checked | result |
|---|---|
| **the lifecycle's host ops on Bitbucket** | `pr-state` (3 `bb` calls), `pr-ready` (2), `pr-create`, `pr-merge`, `pr-merged` (1 each) — **every op `/plot-approve` and `/plot-deliver` need has a Bitbucket branch** |
| **the board's PR links** | `branchUrlBase(origin)` derives from the remote; no vendor is hardcoded |
| **credential reporting** | `plot-board-probe.sh` answers per CLI — measured here: `gh` ok, `bb` ok, `jen` `{installed: false, auth: "unknown"}`. **An absent CLI reads as *cannot verify*, never as failed** |
| **the skills' own stack awareness** | thin by design — `plot-approve` and `plot-implement` name Bitbucket zero times because they delegate to `plot-host.sh`, which is where the branch belongs |

**The one thing the walk confirmed rather than found:** `plot-host.sh` never probes for `jen`, because `runs` reaches `gh` alone. That is [`the-build-pipeline-is-its-own-connector`](../plans/2026-09-07-the-build-pipeline-is-its-own-connector.md), already the sprint's second Must.

### The decision: all nineteen — 2026-09-07

**The cut was offered and declined.** The sprint carries **19 slices in 14 days**, goal-facing and cohesion together, and the reason to record that as a decision rather than an oversight is that the measurement above stands: **ten of the nineteen do not serve this goal.**

**What makes it workable is the shape rather than the count.** Measured before the sprint opens:

| | |
|---|---|
| slices | **19** |
| **unblocked on day one** | **12** |
| deepest chain | **3** — `a-shell-script-asks-the-domain` → the deriver → the repository, and the same root → the scorer → the withdrawn item |

**Twelve independent starts against a fleet that ran five agents at once this week** is a different proposition from nineteen sequential ones. The chains are short and both descend from one root, so the seam landing early unblocks four.

**THE RISK IS NAMED AND IT IS NOT CAPACITY.** It is that the goal is a walkthrough and the cohesion work is not. A sprint that ships all ten cohesion slices and six of the nine goal-facing ones has **a better-factored domain and no teammate who has run anything** — and the tiers do not prevent that, because eight of the nineteen sit under Should.

**SO THE ORDER IS THE MITIGATION.** `the-lifecycle-runs-on-the-other-stack` is written to **fail on arrival** and to name which plan turns each assertion green. **Land it first and it becomes the sprint's progress meter**, not its finish line — the one artefact that says, on any day, how much of the goal is actually reachable.

**If the window closes with cohesion done and the walkthrough still red, the sprint missed its goal and will be able to say so precisely.** That is the whole reason for taking the measurement now rather than at the end.

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

# Sprint: The Jenkins team sees its builds

> 2.15.0 shipped for a team on Bitbucket, Jenkins and Jira. Two of its slices merged carrying no work: `feature/the-probe-reads-the-ci-system` (PR #811, **zero files**) and `feature/the-ci-connector-is-jenkins` (PR #821, a `PLOT-BLOCKED.md` and nothing else). Both plans read Delivered. On a Jenkins team the board's check column is empty, and adoption never proposes `CI:` at all.

## Status

- **State:** Closed
- **Actual End:** 2026-09-11
- **Committed:** 2026-09-08
- **Started:** 2026-09-08
- **Start:** 2026-09-09
- **End:** 2026-09-23
- **Release:** 2.16.0

## Sprint Goal

**A teammate on Bitbucket and Jenkins clones a repository, runs `/plot-init`, and sees real build status on the board — without being told which keys to set.**

Two halves. **Connected** means the Jenkins build state reaches the domain through a connector, not through a rendering special case. **Adopted** means the probe proposes `CI: jenkins` and its instance from what the repository shows, so nobody has to know the key exists.

**Four conditions, all of which must hold.**

| condition | what it rules out |
|---|---|
| **proposed** | a first run that reports no `ci_system`, so the `CI:` proposal it documents is inert |
| **connected** | a Jenkins answer that reaches the board through `pr-list --rich` but is absent from the port every other reader uses |
| **verified** | a connector whose answer shape was assumed from a stub rather than read from a real instance |
| **counted** | a slice that merges carrying no work and is counted as delivered |
| **judged** | a setup decision that lives as prose or as a threshold inside a collector, where no test can reach it |

### The estate is much further along than 2.15.0's summary suggested

**Measured 2026-09-08, and it changes the size of this sprint.** `plot-host.sh` already carries the hard half:

| what exists | where | evidence it is real |
|---|---|---|
| `jenkins_build_map()` | `plot-host.sh:557` | auth wording measured live against `jen 0.2.0` on 2026-08-26; percent-decodes `feature%2Ffoo`; maps Jenkins colours onto the four `checks` words |
| the `jen` wrapper | `plot-host.sh` | takes a budget slot and records the call against the Jenkins axis, separately from the git host |
| `ci-limit` for Jenkins | `plot-host.sh:3114` | answers `predicted` with a stated basis — an absent limit is not a zero limit |
| the instance refusal | `plot-host.sh:2286` | names three repairs: add the key, set `JENKINS_INSTANCE`, or drop `CI: jenkins` |
| `ci_signals` | `plot-board-probe.sh:34` | already reports `{jenkinsfile, gh_workflows}` |

**So this is not "write a Jenkins integration". It is wiring, and one measurement.**

**THE TWO REAL HOLES ARE NAMED PRECISELY.** `plot-host.sh`'s `runs` and `run-for-sha` arms call `gh` with no `ci_backend` branch at all, so a Jenkins repo asking the port for runs gets GitHub's answer or nothing. And `plot-detect-repo.sh` emits no `ci_system` field, which `plot-init/README.md:206` already records as inert.

**`build-shell.ts` is already generic** — it takes the CI system as a parameter and `build-actions.ts` is a thin cap on it. `build-jenkins.ts` is small for the same reason the tracker split was.

### A real instance exists, is reachable, and disproved an assumption already

**`quaweb-website` is the stack this sprint is for**, measured 2026-09-08: a `bitbucket.org` remote built by `jenkins-ci-webbloqs.internal.quatico.dev`, whose job `quaweb` is nested (`job/quaweb/job/release`) — the folder-inside-folder shape `plot-host.sh:541` already describes. The host answers **HTTP 403** on `/api/json`: present and refusing, not absent.

**It disproved a guess before a line was written.** Its three Jenkinsfiles live at `.build/pipelines/<project>/<pipeline>/Jenkinsfile` — none of the four paths reasoned from convention, root included. A root-only probe reads this repository as having no CI, so `the-probe-reads-the-ci-system` now searches `git ls-files` instead of a guessed list.

**What is missing is `jen` and a token, not a Jenkins.** The binary is in no PATH, at none of the usual install locations, and no npm global; nothing in this estate records where it comes from. So the connector is still built against stubs the way the Jira connector was — but the verification slice is now a **measurement with a named target**, not an aspiration: two subcommands against a job that exists.

## MoSCoW

### Must Have

- [x] [the-probe-reads-the-ci-system] `plot-detect-repo.sh` emits `ci_system` as signals, shaped after `plot-board-probe.sh`'s `ci_signals`. The `CI:` proposal in `/plot-init` is specified against this field and is inert without it. **Waits on `a-probe-reports-and-the-domain-judges`** — both change the same collector, and the word `ci_system` proposes belongs in the domain rather than written here and moved a week later. Re-filed: PR #811 merged zero files.
- [x] [the-ci-connector-is-jenkins] `build-jenkins.ts` answers the three port operations through `plot-host.sh`. Re-filed: PR #821 merged a marker and no code.
- [x] [the-run-ops-ask-the-ci-backend] `runs` and `run-for-sha` branch on `ci_backend()` rather than calling `gh` unconditionally. Without this the connector above has nothing to call.
- [x] [a-merged-pr-carried-work] `/plot-deliver` distinguishes a slice whose PR carried work from one whose PR carried a marker. Two slices passed that gate in one sprint and nothing reported it.
- [x] [the-master-agent-uses-the-controllers] A lifecycle action goes through its controller, and a refusal ends it. Measured 2026-09-08: four of five actions in one session had a controller and none was used — a sprint activated with `sed` while `setSprintState` sat there with nine refusals and zero callers.
- [x] [a-sprint-transition-is-performed] `/plot-sprint` start, commit and close call `setSprintState`. The rule is written, tested, exported and dead.
- [x] [the-registry-sweeps-what-it-did-not-start] The supervisor reports registered worktrees nobody dispatched. Measured 2026-09-08: twelve hand-made trees in `/private/tmp` made `git worktree list` report 34 where 22 were real, and the fleet scan timed out at 90 s — the board fell back to a stale pulse and showed no PRs.

### Should Have

- [x] [a-rejection-is-a-controller-command] `/plot-reject` moves Delivered → Approved through an endpoint. The one backwards move, and it has no rule at all today.
- [x] [a-release-is-a-controller-command] `/plot-release` asks a controller for its verdict. The facts are collected; the judgement is still skill prose in front of the one action nobody can undo.
- [x] [adoption-is-a-controller-command] `/plot-init` writes its config through an endpoint asking `proposeStack`. The only command that writes into a repository Plot does not own.
- [x] [a-pr-is-opened-by-a-controller] A slice's PR is opened by a controller. No skill, no rule, done by hand three times today and fifteen branches went unseen last sprint.
- [x] [a-lifecycle-field-has-one-writer] A hook refuses a commit editing a `State:` line outside the scripts that own it. Last, because a gate refusing the only available method stops work.

- [x] [the-connector-is-read-against-a-real-instance] Measured 2026-09-10 against `jenkins-ci-webbloqs.internal.quatico.dev`. **Build history is askable through `jen`; a commit sha is not, and is askable over REST.** Both halves are now recorded — see the note below.
- [x] [a-probe-reports-and-the-domain-judges] `proposeStack` in the domain decides what a probe's readings propose. **Runs before the CI slice**, which reports into it. Seven thresholds live inside the two collectors today — `node >= 20`, three commit-style counts, the ticket-prefix floor and the language count — and each is a decision a test cannot reach.
- [x] [two-signals-ask-rather-than-tie-break] `/plot-board-setup`'s stated rule — *one signal proposes, two signals ask* — becomes a domain property rather than a paragraph an agent is asked to follow.

### Could Have

- [x] [the-board-says-which-ci-answered] The board names the CI system behind a check state, so an empty column on a Jenkins team reads as *Jenkins said nothing* rather than as *no CI*.
- [x] [a-lifecycle-action-needs-a-controller-receipt] A hook refuses a lifecycle script invoked without a controller receipt. Measured 2026-09-09: five dispatches in one session went to `plot-dispatch.sh` directly, by the agent that had read the rule with the board answering. It surfaced because a person asked.
- [x] [an-adopting-repo-installs-its-gates] `/plot-init` installs Plot's hooks and proves the install by firing a gate. Measured: `plot-state-gate.sh` is registered at repo HEAD and in **no shipped plugin version** — it has never enforced anything on any machine, including the one that wrote it.
- [x] [the-supervisor-is-loaded-or-it-is-reported] `--start` cannot leave a written-but-unloaded unit behind, and a stopped fleet is announced in a person's words. The fleet was down for hours on 2026-09-09 with a correct plist on disk that launchd was never told about.
- [x] [reconcile-is-a-controller-action] Reconcile becomes the tenth endpoint, scoped to a plan, a sprint or the workspace. Nine actions are controller endpoints; this one runs a shell script from skill prose.
- [x] [a-plan-row-shows-its-phase] A plan row reports its phase whichever path renders it. Two arms of one projection disagree, so a Draft awaiting approval reports `green` — its PR's CI, on a row about a decision nobody has taken.

### Won't

- **A Jenkins connector for the tracker axis.** Jenkins is CI. Jira is the tracker and already has a connector.
- **GitLab.** `HOST_DRIVES` is an open list and GitLab is named as next, but not here.

## Notes

### The instance key moved into Must, because the goal fails without it — 2026-09-08

**Reading the four plans as one system found a gap none of them showed alone.** The goal is a path: clone, `/plot-init`, build status on the board. `plot-host.sh:2286` exits 3 without a `Jenkins instance` key, and no Must slice wrote one — so all four could pass and a teammate would still see an empty check column, with a refusal naming three repairs they were never told to make.

**A Should that every Must depends on is a Must.** It sits in `the-probe-reads-the-ci-system`, because it is an adoption question: the instance is proposed from the same signal as `CI: jenkins`, in the same breath, and a slice cannot wait on two branches. The connector plan names it as the thing it is not done without.

### Each plan stands alone, and the waits are about order rather than survival — 2026-09-08

**Three slices start with no wait, and they touch four disjoint sets of files.** `a-merged-pr-carried-work` reaches `plot-deliver.sh` and `rules/branch-state.ts`; `the-run-ops-ask-the-ci-backend` reaches `plot-host.sh`; `a-probe-reports-and-the-domain-judges` reaches the two collectors. None of them needs another to be correct.

**So a failure is partial rather than total.** If the verification slice found that `jen` reports no build history *and* the REST API were closed to ordinary accounts, `connected` would be out of reach — and the delivery gate, the judgements and the run-op routing would still be worth having. There is no single finding that stops this sprint, which is the property the four-condition split was chosen for.

**The waits exist because two slices would otherwise write the same field twice**, not because either cannot ship without the other.

### Why the delivery gate is in Must and not Could — 2026-09-08

**Two slices of one sprint merged carrying no work, and every counter on the estate read them as delivered.** `/plot-deliver` asks whether each branch's PR merged; a blocked agent commits its marker, the marker is a commit, the PR merges, and the slice is indistinguishable from a finished one.

Without the gate this sprint can fail the same way it is meant to repair — and nobody would see it until a teammate on Jenkins opened the board.

### Why the collectors keep collecting — 2026-09-08

**The question was whether `plot-board-probe.sh` belongs in the domain, and the answer is no — but it exposed something that does.**

The probe reaches the machine: `node --version`, `git rev-parse`, whether `jen` is authenticated, whether a `Jenkinsfile` exists. The domain takes readings as values and performs no I/O, so a collector cannot move inward. The layering rule points the other way — a script sits at the outer edge and is reached only from an adapter.

**What is misplaced is not the script but the judgements inside it.** `node_ok: true when node's major >= 20` is not a fact about the machine; it is a decision about what Plot supports, hardcoded in a file whose own header says *"It DECIDES NOTHING"*. `plot-detect-repo.sh` carries six more: `>= 2` three times for commit style, `>= 2` for a ticket prefix, `>= 3` for German.

**And the same is true of the setup workflow's stated rule.** *"One signal proposes, two signals ask"* is written as prose in `/plot-board-setup` step 2. An agent can rationalise around it and no test can assert it — which is the difference this repo draws between a rule and a gate.

The precedent is already stated for rendering: *a view state that cannot be asserted without a browser is a domain property that has not been extracted yet.* A setup decision that can only be checked by reading skill prose is the same thing.

**So the split is: the probe measures, the domain judges, the skill asks and writes.** This sprint adds `ci_system` to a collector, which is exactly where the next threshold would otherwise land.

### `jen` answers with builds and never a sha — 2026-09-10

**The blocker this sprint recorded is gone, and the open question is half answered.** `jen 0.4.0` is installed at `~/.local/bin/jen` and authenticated against `jenkins-ci-webbloqs.internal.quatico.dev` (Keycloak plus a Jenkins token in the keychain). The sprint's *"what is missing is `jen` and a token"* no longer holds.

**Build history is askable.** `jen build list quaweb/release --json` returns builds with `id`, `status`, timings and per-stage detail. `jen job list quaweb` reports the job shape, including a multibranch `continuous-build` whose branches arrive percent-encoded (`bug%2Fkarriere-...`) — the form `jenkins_build_map()` already decodes.

**A commit sha is not.** A build entry carries exactly `_links, id, name, status, startTimeMillis, endTimeMillis, durationMillis, queueDurationMillis, pauseDurationMillis, stages`, on a plain pipeline and on a multibranch branch alike. A case-insensitive search for `sha|commit|revision|scm` over the whole payload matches nothing, and `jen build view` adds none in either mode. `_links` holds `self` and `changesets`; `jen` has no changesets subcommand and no raw-API passthrough, and the bearer from `jen auth token` gets Jenkins' login redirect rather than the endpoint.

**So `run-for-sha` cannot be a sha lookup on Jenkins.** The only mapping `jen` exposes is branch → builds, through `--branch` on a multibranch job. Either the op resolves a sha to a branch before asking, or the port grows a branch-shaped question. That is a design constraint on `the-run-ops-ask-the-ci-backend`, which is already merged — so it is a finding to file rather than a slice to re-open.

### The two re-filed Must items are true now — 2026-09-10

**Both boxes were ticked by the empty PRs they were re-filed for.** `the-probe-reads-the-ci-system` (#811, zero files) and `the-ci-connector-is-jenkins` (#821, a marker) each ticked their item on merge, so the sprint recorded two conditions as met while neither had code. That is the shape `a-merged-pr-carried-work` was added to catch, and it caught nothing retroactively — a checkbox, once ticked, states no evidence.

**`proposed` holds as of PR #879.** `plot-detect-repo.sh` emits `ci_signals`, and the field name was the defect: `stack-readings.ts:104` reads `report.ci_signals`, this skill's docs said `ci_system` in six places, and the probe emitted neither. A probe emitting the documented name would have produced the same `ci: null` — *nobody looked* — with every consumer already built and green.

Measured against `quaweb-website`, the stack this sprint is for:

| reading | value |
|---|---|
| `git_host` | `bitbucket` |
| `ci_signals` | `{jenkinsfile: true, gh_workflows: false}` |
| `ci` | `propose: jenkins` |
| `ciInstance` | slug found, `ask: path` |

**`connected` is PR #880.** `build-jenkins.ts` gives the port a connector; the shell arm for `runs` had existed since #837, so the domain could not ask what the script could already answer.

**`runForSha` is `unaskable` on Jenkins, and that is measured rather than deferred.** `jen 0.4.0` against the live instance: a build entry carries `id`, `status`, timings and stages, and no `sha`, `commit`, `revision` or `scm` anywhere in the payload. `_links` offers `changesets`, which `jen` cannot reach and which rejects the Keycloak bearer. The answer is in Jenkins at `actions[].BuildData.lastBuiltRevision.SHA1` over REST — so the remaining half of **verified** needs a `JENKINS_API_TOKEN`, which `jen` keeps in the keychain and will not print.

### The sha is askable, over REST and not through `jen` — 2026-09-10

**The open question this item existed for is answered: a build names its commit, and `run-for-sha` has a route on Jenkins.**

`jen 0.4.0` answers build history and never a sha. A build entry from `jen build list --json` carries `_links, id, name, status, startTimeMillis, endTimeMillis, durationMillis, queueDurationMillis, pauseDurationMillis, stages`, and a case-insensitive search of the whole payload for `sha|commit|revision|scm` matches nothing — on a plain pipeline and a multibranch branch alike. `_links` offers `changesets`, which `jen` has no subcommand for and no raw-API passthrough to reach.

**REST answers it, with the token `jen` already stored.** The Jenkins API token lives in the login keychain under service `jen`, account `jenkins-token:<host>`, beside `jenkins-user:<host>`. With Basic auth from that pair, `/job/quaweb/job/release/187/api/json` returns HTTP 200 and 145 KB carrying `actions[].lastBuiltRevision.SHA1` — exactly where `plot-host.sh:2993` predicted on 2026-09-08, now confirmed against the instance rather than reasoned.

**The Keycloak bearer is the wrong credential and that is the trap.** `jen auth token` prints a valid bearer, and Jenkins' own endpoints answer it with an HTML login redirect. A first measurement using it concluded the sha was unreachable; the transport was wrong, not the answer.

**One call answers a whole history, filtered server-side.** A `tree=` query over `builds[number,result,actions[lastBuiltRevision[SHA1,branch[name]]]]{0,5}` returned 4855 bytes and five builds, each with a distinct sha and its branch:

```
#187 SUCCESS b0a2517aa107 refs/remotes/origin/develop
#186 SUCCESS 49cafe06563f refs/remotes/origin/develop
#185 SUCCESS bcccd644f3a6 refs/remotes/origin/develop
```

**So `run-for-sha` on Jenkins is a REST call, not a `jen` call**, and the `exit 4` in `plot-host.sh`'s `jenkins` arm is now a gap with a known fix rather than a transport limit. The URL must be percent-encoded: `tree=` uses `[]` and `{}`, which a shell expands.

### Every item is closed, and two were closed twice — 2026-09-10

**The sprint's last two items shipped as #881 and a measurement.**

`the-board-says-which-ci-answered` (#881): the board named *the host* where it needed to name the system, so an empty check column could not be told from a stack with no CI. `ServerInfo` now carries the CI system, read once per process, and `checksUnaskableNote` names it. Verified on a board started from main's own artifact: `server.ci = "GitHub Actions"`.

**The vendor mapping lives in `server-info.ts`, not the domain.** The first version put `github-actions -> GitHub Actions` in `rules/checks-reading.ts` and CI's *domain names no vendor* gate refused it — correctly, and for the reason `rules/stack.ts` states: a rule that knows which systems exist needs editing when the third one arrives. A CI system with no entry is shown as its key, so a third one reads well with an entry and works without one.

`the-connector-is-read-against-a-real-instance`: **the sha is askable, over REST.** `jen` answers build history and never a commit; the Jenkins REST API answers both, using the API token `jen` already stores in the keychain. The first measurement used `jen auth token` — a Keycloak bearer, which Jenkins answers with a login redirect — and wrongly concluded the sha was unreachable. The transport was wrong, not the answer.

**So `run-for-sha` on Jenkins is a gap with a known fix**, not a transport limit: `plot-host.sh`'s jenkins arm exits 4 and `build-jenkins.ts` answers `unaskable`, both honestly, and neither has been taught REST yet. That is the follow-up this sprint hands on.

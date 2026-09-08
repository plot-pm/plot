# Sprint: The Jenkins team sees its builds

> 2.15.0 shipped for a team on Bitbucket, Jenkins and Jira. Two of its slices merged carrying no work: `feature/the-probe-reads-the-ci-system` (PR #811, **zero files**) and `feature/the-ci-connector-is-jenkins` (PR #821, a `PLOT-BLOCKED.md` and nothing else). Both plans read Delivered. On a Jenkins team the board's check column is empty, and adoption never proposes `CI:` at all.

## Status

- **State:** Active
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

### Must

- [ ] [the-probe-reads-the-ci-system] `plot-detect-repo.sh` emits `ci_system` as signals, shaped after `plot-board-probe.sh`'s `ci_signals`. The `CI:` proposal in `/plot-init` is specified against this field and is inert without it. **Waits on `a-probe-reports-and-the-domain-judges`** — both change the same collector, and the word `ci_system` proposes belongs in the domain rather than written here and moved a week later. Re-filed: PR #811 merged zero files.
- [ ] [the-ci-connector-is-jenkins] `build-jenkins.ts` answers the three port operations through `plot-host.sh`. Re-filed: PR #821 merged a marker and no code.
- [ ] [the-run-ops-ask-the-ci-backend] `runs` and `run-for-sha` branch on `ci_backend()` rather than calling `gh` unconditionally. Without this the connector above has nothing to call.
- [ ] [a-merged-pr-carried-work] `/plot-deliver` distinguishes a slice whose PR carried work from one whose PR carried a marker. Two slices passed that gate in one sprint and nothing reported it.

### Should

- [ ] [the-connector-is-read-against-a-real-instance] Run two `jen` subcommands against `jenkins-ci-webbloqs.internal.quatico.dev` and record what they print. The instance answers (HTTP 403 — present, refusing) and the job `quaweb` exists; what is missing is `jen` and a token. Whether a build history and a build's commit sha are askable at all is the open question the connector's shape rests on.
- [ ] [a-probe-reports-and-the-domain-judges] `proposeStack` in the domain decides what a probe's readings propose. **Runs before the CI slice**, which reports into it. Seven thresholds live inside the two collectors today — `node >= 20`, three commit-style counts, the ticket-prefix floor and the language count — and each is a decision a test cannot reach.
- [ ] [two-signals-ask-rather-than-tie-break] `/plot-board-setup`'s stated rule — *one signal proposes, two signals ask* — becomes a domain property rather than a paragraph an agent is asked to follow.

### Could

- [ ] [the-board-says-which-ci-answered] The board names the CI system behind a check state, so an empty column on a Jenkins team reads as *Jenkins said nothing* rather than as *no CI*.

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

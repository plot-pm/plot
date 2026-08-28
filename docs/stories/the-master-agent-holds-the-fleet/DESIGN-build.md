---
title: Build — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Build — domain object specification

What CI said about a PR — and the entity split by what each answer costs.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [PR](DESIGN-pr.md) ·
> [Branch](DESIGN-branch.md) · [Plan](DESIGN-plan.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Build is](#1-what-a-build-is) | the verdict, and the history |
| 2 | [Posture](#2-posture) | the CI system's, and `CI:` is unread |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | five conclusions, and the ambiguous one |
| 5 | [Direction](#5-direction) | inbound only, and Plot never triggers |
| 6 | [Relations](#6-relations) | PR · Branch |
| 7 | [Actions](#7-actions) | none — Plot reads |
| 8 | [Scope](#8-scope) | **the price split** — free per PR, metered per history |
| 9 | [The collaborators](#9-the-collaborators) | one op, two budgets |
| 10 | [Fleet control](#10-fleet-control) | what a supervisor may conclude |
| 11 | [Views](#11-views) | the check chip, and the three evidence lines |
| 12 | [Setup](#12-setup) | `CI:` is recorded and unread |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a Build is

**A Build is what CI said about a PR** — and it exists as two things at two
prices:

- **the verdict** — did the checks pass? — arrives **free**, in the PR bundle
- **the history** — what has this branch's CI done lately? — costs **one request
  per branch**

**That split is the entity's whole shape**, and §8 is where it decides the
design.

### It is evidence, never a gate

**Plot has no CI gate.** No command refuses on a red build: the delivery gate
asks whether PRs *merged*, and merging is a person's act which the host may
itself gate. So a Build informs a reader and blocks nothing in Plot.

**And nothing interprets a failure.** `failing_checks[]` carries names *"and
nothing interprets them. A heuristic mapping a failing check to the paths a
branch changed was explicitly rejected: that table is unmaintained by
construction and goes silently wrong the first time a workflow is
restructured."*

---

## 2. Posture

**The CI system owns a Build, and Plot does not know which system that is.**

`CI:` is a declared config key — `jenkins` \| `github-actions` \| `none` — and
`/plot-board-setup` records it carefully, proposing from a `Jenkinsfile` or a
workflow directory and **asking where both are present**, because *"a team on
GitHub running Jenkins is common… and a silent wrong `CI:` key sends every
build-status lookup to the wrong system."*

**And it IS read — the Jenkins arm is built.** `plot-host.sh:966` reads `CI:`,
resolves `Jenkins instance` (falling back to `JENKINS_INSTANCE`), calls
`jenkins_build_map`, and merges the result into `pr-list --rich`. A repo
declaring `CI: jenkins` gets Jenkins build status on its PR rows.

> **Corrected while writing this.** A first draft recorded *"nothing reads
> `CI:`"* as a measured gap, on the strength of `/plot-board-setup`'s own
> warning — *"the keys are recorded and verified, and a board consumer is
> separate work."* **That warning is stale**, exactly like the `Tracker: jira`
> one this session found earlier: a backend landed and the skill that warns of
> its absence was not updated. Same pattern, second instance.

**Two failure modes are kept apart in that arm**, and both are the
absent-is-not-false rule: a missing `Jenkins instance` under `CI: jenkins`
**exits 3** rather than guessing, and a dead Jenkins yields `unknown` on the
affected rows rather than darkening every row.

---

## 3. The domain object

### Identity

**A Build has no identity of its own.** It is *the CI verdict for a PR*, so it
is addressed as its PR — there is no build id in the model, and none is needed
while the verdict is a rollup rather than a run.

**The history's entries do have identities** (a workflow name and a start time),
which is the first hint that these are two things.

### Fields

| field | type | price | note |
|---|---|---|---|
| `conclusion` | `green`\|`pending`\|`failing`\|`none`\|`unknown` | **free** | the rollup, from `pr-list --rich` |
| `failingChecks[]` | string[] | **free** | which checks failed — **names only** |
| `asked` **`+`** | `answered`\|`not-asked`\|`failed`\|`unsupported` | — | **proposed** — whether the history was fetched |
| `runs[]` | `{workflow, conclusion, startedAt, url}[]` | **metered** | one request per branch |

**`asked` is proposed and absent.** Today a branch whose history was never
fetched and a branch with no history are indistinguishable — the same
absent-is-not-false shape Issue's `IssueAnswer` fixes for the tracker (§8).

### `conclusion: 'none'` needs `PR.mergeable`

**Measured live, 2026-08-28** — three PRs with no rollup at all:

| PR | `mergeable` | why there is no build |
|---|---|---|
| #475 | **CONFLICTING** | GitHub started no workflow — the PR does not merge cleanly |
| #473 | **CONFLICTING** | as above |
| #442 | MERGEABLE | the release PR; its workflow simply has not run |

**Three PRs, one value, two meanings** — and `mergeable` is the only field that
separates them. That is the PR spec's claim demonstrated rather than argued,
sitting in this repo right now.

---

## 4. Lifecycle

### Five conclusions

| conclusion | means | a reader may |
|---|---|---|
| `green` | every check passed | merge |
| `pending` | at least one is still running | wait |
| `failing` | at least one failed | read `failingChecks[]` |
| `none` | **no rollup at all** | **ask `mergeable` first** (§3) |
| `unknown` | the host could not be asked | conclude nothing |

**`none` and `unknown` are different**, and collapsing them would report *no
checks ran* for a host that was never reached.

### A build is not a state that transitions

Like a Wave's verdict, it is **re-read rather than moved through**: a
`pending` build becomes `green` because CI finished, not because Plot did
anything. Nothing in Plot ever writes a Build.

---

## 5. Direction

**Inbound only, and Plot never triggers one.** No command starts, reruns or
cancels a build. `plot-host.sh runs` **reads** — *"no rule here compares runs,
decides 'transient', or reruns anything. This collects, a human concludes."*

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| PR → Build | the check rollup | **built, free** |
| Branch → Build history | `runs <branch>` | **built, metered** |

**The history is keyed by branch, the verdict by PR** — which is why a branch
with several PRs (Branch §3, one carries ten) has one history and many verdicts.

---

## 7. Actions

**None.** Plot reads a Build and never acts on one. The nearest thing to an
action is a **repair** — `plot-resolve-artifact.sh` rebuilds the board artifact
and pushes *"only on green"* — and even there the build is a **precondition it
reads**, not something it triggers.

---

## 8. Scope

### The price split is the design

| half | cost | fetched for |
|---|---|---|
| **verdict** | **free** — rides the bundled `pr-list --rich` | **every PR** |
| **history** | **one REST call per branch** | **at most 8**, failing and watched only |

**The metering is deliberate and documented at the source:** *"METERED, so
callers must ask only where the question arises — a branch whose PR is already
known to be failing… a caller that asked for every branch would spend a budget
the board has already exhausted once."*

### What bounds the history fetch

| bound | value | why |
|---|---|---|
| `RUN_FETCH_MAX` | **8** branches | the budget |
| `RUN_HISTORY_LIMIT` | **5** runs | enough to see a pattern |
| `branchIsWatched` | a filter | **applied before the cap** |

**The filter comes first, and that ordering is the point:** *"the eight slots go
to branches whose answer can still move rather than being spent on landed work —
a fleet with nine merged failures and one live one would otherwise fill the cap
with history nobody is waiting on and render the live branch's as
unavailable."*

### Skipping must not drop what was already known

*"A branch this pass declines to ask about would lose a history it already had —
and a row losing a line it carried a minute ago reads as the branch changing
rather than as a fetch being skipped."*

**So a skipped fetch keeps the last good history**, exactly as a *failed* one
does — *"a skipped one is not a worse case than a failed one."*

---

## 9. The collaborators

**One op, and it is the only metered one in the adapter:** `plot-host.sh runs`.

| | |
|---|---|
| cost | one REST call per branch |
| bound | `--limit`, default 10; the board asks 5 |
| Bitbucket | **reports nothing** — `bb` has no run listing |

**Bitbucket's silence is honest, not empty:** *"an empty history renders as
'unavailable' — never as 'this branch has never failed before'."*

---

## 10. Fleet control

**What a supervisor may conclude from a Build is narrower than it looks.**

The history exists for one purpose, and it is stated: *"on 2026-08-17 a `403`
from the Playwright CDN failed a markdown-only branch, and what proved it
transient was the run history — the same branch was green two minutes earlier.
A real failure presents identically in every other respect."*

**So the history distinguishes flaky from broken, and only a human draws that
conclusion.** The estate's own memory carries the same lesson twice — *"CI is
red on main"* and *"rapid pushes starve CI"* — both cases where a red build said
nothing about the branch under it.

---

## 11. Views

| view | shows |
|---|---|
| check chip on a PR | `green` · `pending` · `failing` |
| the stuck cell | `failingChecks[]`, **by name** |
| run history | up to 5 recent runs, where fetched |

**Naming the check is the whole point:** *"`failing` names a symptom and
withholds which machine produced it. On 2026-08-17 a markdown-only branch failed
`validate` because the Playwright CDN answered `403 — this service is not
available in your location`, and reaching that sentence took ten minutes of
opening logs — from a row that already held the check name and did not say
it."*

---

## 12. Setup

**`CI:`** — `jenkins` \| `github-actions` \| `none`, and **nothing reads it**
(§2). `/plot-board-setup` records it, verifies Jenkins auth if `jen` is present,
and says plainly that the board does not render Jenkins status.

**`Jenkins instance`** — the slug a Jenkins CLI needs. Refused rather than
guessed under `PLOT_UNATTENDED`, because *"`jen -I <bogus> auth status` prints
`Keycloak: signed in` and exits 0"* — a wrong slug verifies successfully.

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **`/plot-board-setup` still warns that `CI:` is unread** — the Jenkins arm has since landed; stale documentation, the second such case this session | **now** |
| 2 | **No `asked`** — a history never fetched is indistinguishable from a branch with none | now |
| 3 | **`conclusion: 'none'` is ambiguous alone** — measured, 3 PRs, 2 meanings | **now** |
| 4 | Bitbucket has no history at all | now |

---

## 14. Invariants and open points

### Invariants

1. **A Build is evidence, never a gate** — Plot refuses nothing on a red build.
2. **Nothing interprets a failure** — names are reported, conclusions are the
   reader's.
3. **`none` ≠ `unknown`** — no checks ran is not the same as could not ask.
4. **`none` is meaningless without `mergeable`.**
5. **The verdict is free and universal; the history is metered and bounded.**
6. **A skipped fetch keeps the last good history.**
7. **Plot never triggers, reruns or cancels a build.**

### Open points

- **Which other config keys have stale warnings?** Two found this session
  (`Tracker: jira`, `CI:`), both of the same shape: a backend landed and the
  skill warning of its absence was not updated.
- **Should the verdict carry `mergeable` beside it?** They are always read
  together and separately meaningless.

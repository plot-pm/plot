---
title: PR — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# PR — domain object specification

A branch's bid to land, and the evidence a plan was implemented.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Branch](DESIGN-branch.md) ·
> [Wave](DESIGN-wave.md) · [Plan](DESIGN-plan.md) · [Issue](DESIGN-issue.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a PR is](#1-what-a-pr-is) | the bid, and the evidence |
| 2 | [Posture](#2-posture) | the host's, in every posture |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | and why `state` cannot be trusted alone |
| 5 | [Direction](#5-direction) | outbound only |
| 6 | [Relations](#6-relations) | Branch · Plan · Build |
| 7 | [Actions](#7-actions) | create · ready · merge — none of them Plot's |
| 8 | [Scope](#8-scope) | which PRs a plan's, and the budget |
| 9 | [The collaborators](#9-the-collaborators) | one adapter, one metered gate |
| 10 | [Fleet control](#10-fleet-control) | the gate everything defers to |
| 11 | [Views](#11-views) | the PR chip |
| 12 | [Setup](#12-setup) | `Git host` |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a PR is

**A PR is a branch's bid to land, and afterwards the evidence that it did.**

Two roles, and the second is the one Plot depends on: *"which PRs are a plan's
evidence"* is what `plot-deliver.sh` asks, and a plan is deliverable when every
non-deferred branch has one that merged.

### It is foreign, and Plot never writes it

**No Plot command creates, readies or merges a PR as its purpose.** The delivery
skill marks a draft ready *"as part of the delivery flow"*, and
`plot-approve.sh` merges the **plan PR** — but the implementation PRs a plan
cites are opened by the implementing session and merged by a person.

`plot-merge-queue.sh` computes order and predicts collisions; **it merges
nothing**, and says so in its own description.

---

## 2. Posture

**The host owns a PR in every posture** — it is the one entity whose source is
foreign regardless of `Tracker:`. A repo that tracks in Jira still opens PRs on
its git host, because `Git host` and `Tracker` are independent keys (Issue §2).

**And a PR is never published**: the feature ticket a plan publishes describes
the *work*, not the pull request. So a PR appears in no tracker, in any posture.

---

## 3. The domain object

### Identity

```
PR.number : number          within one repo
PR.repo   : string          `owner/repo`, `''` for this one
```

**The number alone is not the identity** — a plan may cite `owner/repo#N` for a
split-home implementation, so the pair is what resolves. `plot-plan-meta.sh`
parses the repo half *"but does not retain it: callers ask which PRs are a
plan's evidence, and `plot-host.sh` resolves where each one lives."*

### Fields

| field | type | note |
|---|---|---|
| `number` | number | the identity, within `repo` |
| `repo` | string | `''` where the PR is in this repo |
| `head` | string | **the Branch it belongs to** |
| `state` | `OPEN`\|`MERGED`\|`CLOSED` | **not trustworthy alone — see §4** |
| `mergedAt` **`+`** | ISO-8601 \| null | **the truth about landing** |
| `mergeCommit` | sha | `''` for anything unmerged — *"the honest answer rather than a guess"* |
| `draft` | bool | is it asking for review |
| `mergeable` | `mergeable`\|`conflicting`\|`unknown` | **a separate question from `checks`** |
| `review` | `APPROVED`\|`CHANGES_REQUESTED`\|`REVIEW_REQUIRED`\|`''` | informational only |
| `checks` | `green`\|`pending`\|`failing`\|`none`\|`unknown` | the **Build**, summarized |
| `failing_checks[]` | string[] | which ones — **names only, nothing interprets them** |
| `url` | string | verbatim from the host; `''` renders as plain text |

**`mergedAt` is proposed and absent today** — it reaches only `plot-reap.sh`,
which calls `gh` directly, bypassing the adapter CLAUDE.md names as *"the ONE
place that talks to the host CLI"* (Issue §13).

### `mergeable` disambiguates `checks`

*"A separate question from `checks`, and the one that disambiguates it. GitHub
starts no workflow for a PR that does not merge cleanly, so a conflicting PR
reports an empty rollup — `checks: 'none'`, indistinguishable from a bot PR
whose run is waiting for a human to approve it."*

**And `unknown` is not `clean`.** Bitbucket cannot answer it at all, and every
payload written before the field existed reports the same — *"consumers must not
read it as clean: absent is not false."*

---

## 4. Lifecycle

### Three states, and one of them lies — but only on one surface

| state | means |
|---|---|
| `OPEN` | live |
| `MERGED` | landed |
| `CLOSED` | closed unmerged |

**Measured across all 490 PRs in this repo, 2026-08-28:**

```
OPEN 4    MERGED 466    CLOSED 20
466 of 466 merged PRs carry mergedAt; none reports CLOSED
```

**So `gh pr list` is honest**, and the estate's own rule — *"a merged PR reports
`CLOSED`; trust `mergedAt`, not `state`"* — needs to name **which surface** it is
about, because it is false for the one most callers use.

#### The same PR, two answers

```
gh api repos/…/pulls/495   →  { "state": "closed", "merged": true }
gh pr view 495 --json state →  { "state": "MERGED" }
```

**REST says `closed`; GraphQL says `MERGED`.** REST models a PR as an issue,
where `state` has only two values and merging is a separate boolean — so
`state: closed` there means *not open*, not *not merged*.

**Two more surfaces make it three-way:**

| surface | a merged PR reports |
|---|---|
| `gh pr list` / `pr view` (GraphQL) | **`MERGED`** |
| `gh api …/pulls/N` (REST) | **`closed`** + `merged: true` |
| Bitbucket via `bb` | `DECLINED` → normalized to `CLOSED` by the adapter |

**So the rule survives, with its reason corrected:** read `mergedAt`, because
**`state` means different things on different surfaces** — not because GitHub's
GraphQL lies.

**And it explains where the estate hit it.** `plot-reap.sh` reads `mergedAt` and
calls `gh` directly; a caller on REST or Bitbucket sees `closed`/`CLOSED` for a
landed PR, and *"squash-merge leaves the branch permanently ahead of main"*, so
ancestry does not rescue it — measured, ancestry cleared **1 of 29** finished
worktrees and the host cleared the other 28.

### `draft` is a fourth axis, not a state

A draft PR is `OPEN`. It is *"asking for review"* that is false — which is why
`plot-approve.sh` refuses a draft plan PR: *"the approval is the PR's non-draft
state"*, a fact the script reads rather than a state it infers.

---

## 5. Direction

**Outbound only, and Plot is not the author.** A PR is created by whoever pushed
the branch — the implementing session, per the hand-off brief's bookkeeping. Plot
*reads* PRs and annotates plans with their numbers.

**There is no inbound PR**: nothing outside creates a PR that becomes a Plot
artefact, the way an issue can become a plan.

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| Branch → PR | the host, by `head` | **built** — see Branch §3 |
| Plan → PR | `→ #N` / `PR: #N` annotation | **built, and optional** |
| PR → Build | `checks`, `failing_checks[]` | **built** |
| PR → Wave | via its branch | derived |

**The plan's annotation is a convenience, not a precondition.** The delivery
gate resolves an unannotated branch *"by matching the branch NAME against the
heads of merged PRs"* — the same derivation the reconcile scan uses — so a plan
whose worker never annotated still verifies.

**Matching never weakens the gate:** a branch with no merged PR head and no
annotation *"resolves nothing — it is never fabricated as merged."*

---

## 7. Actions

| action | who | Plot's part |
|---|---|---|
| **Create** | the implementing session | annotate the plan with `→ #N` |
| **Ready** | `/plot-deliver`, for drafts | part of the delivery flow |
| **Merge** | **a person** | `plot-merge-queue.sh` orders; it merges nothing |
| **Merge (plan PR)** | `plot-approve.sh` | **the approval act** |

**The one PR Plot merges is the plan's own**, and that merge *is* the approval —
not an implementation act (Plan §6).

---

## 8. Scope

**Which PRs are a plan's** is answered two ways, in this order: the annotation,
then the branch head. **Which PRs the board holds** is a different question,
bounded by a budget.

### The budget is the entity's defining constraint

**PRs are the only entity Plot pays per-request for**, and everything about the
refresh follows:

- **one bundled call** — `pr-list --rich --state all` for the whole fleet
- **a shared gate** — the issue poll rides it *"so the issue lookup cannot become
  a second cadence quietly spending the host budget"*
- **cost per host** — 1 request on GitHub, **4 on Bitbucket** (`pr-list` needs
  three states plus `issue-list`), and the cadence stretches by that multiplier
- **backoff is extend-only** — a longer wait another fetch set is *"a floor the
  host named"*

**And a rate limit is not an outage.** GraphQL and REST meter separately, so a
spent GraphQL budget leaves a full REST one — the fallback rescued in this
session's own `plot-host` work.

---

## 9. The collaborators

**One adapter, and it is the only place a host is spoken to:** `plot-host.sh`.

| op | shape |
|---|---|
| `pr-state <n\|branch>` | one PR: number, state, draft, url, mergeCommit |
| `pr-list [--rich]` | the fleet's PRs, one bundled call |
| `pr-create`, `pr-merge`, `pr-body` | writes, used by the spoke commands |
| `runs <branch>` | the **Build**'s history — metered separately |

**`plot-reap.sh` bypasses it** to read `mergedAt` (§4) — the one measured
violation of the one-place rule.

---

## 10. Fleet control

**Every gate defers to a PR**, which is what makes it load-bearing:

| gate | asks |
|---|---|
| delivery | did every non-deferred branch's PR merge? |
| `--restart` | **does this branch have a PR?** — asked *before* the state word |
| reap | is there a merged PR? — `mergedAt`, never `state` |
| release | are the sprint's plans delivered? (transitively) |

**`--restart` asks the PR first, and the reason is measured:** five of five
`failed` worktrees held a PR (four open, one merged), so *"a gate on the state
word alone would restart all five and destroy what the `finished` refusal
protects."*

---

## 11. Views

| view | shows |
|---|---|
| PR chip on a branch row | `#N`, state, checks |
| the stuck cell | `failing_checks[]` by name |

**`url: ''` renders as plain text**, never a fabricated link — *"an invented URL
is indistinguishable from a real one until it 404s."*

---

## 12. Setup

**`Git host`** — `github` \| `bitbucket`, resolving `gh` versus `bb`. Independent
of `Tracker` (§2), and `/plot-board-setup` proposes it from the origin URL and
verifies auth as `ok` / `failed` / **`unknown`**, never rounding the third up.

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **`mergedAt` is not in the adapter** — only `plot-reap.sh` has it, via a direct `gh` call | **now** |
| 2 | **The `state` rule is stated without its surface** — false for `gh pr list`, true for REST and `bb` | now |
| 3 | `checks: 'none'` is ambiguous without `mergeable` | now |
| 4 | Branch → PR flattened in the plan record (Plan §4) | now |

---

## 14. Invariants and open points

### Invariants

1. **`mergedAt` decides whether a PR landed**, never `state`.
2. **A PR's identity is `repo#number`**, not the number alone.
3. **`unknown` is never `clean`** — for `mergeable`, `checks`, or auth.
4. **Plot merges exactly one kind of PR: the plan's own.**
5. **The annotation is a convenience; the branch head is the fallback.**
6. **Never fabricate a URL** — `''` renders as text.
7. **One bundled call per refresh, on a shared gate.**

### Open points

- **Should `state` be dropped in favour of `mergedAt` + `draft` + `closed`?**
  It carries no information the three do not, and it misleads per surface.
- **Should the adapter expose `mergedAt`?** Two consumers want it and one has
  already reached past the adapter to get it.

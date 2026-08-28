---
title: Release — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Release — domain object specification

A version, and the set of plans that shipped in it.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Plan](DESIGN-plan.md) ·
> [Sprint](DESIGN-sprint.md) · [PR](DESIGN-pr.md) · [Issue](DESIGN-issue.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Release is](#1-what-a-release-is) | the version, and what it contains |
| 2 | [Posture](#2-posture) | the epic it publishes |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | RC, then cut — and the tag is the truth |
| 5 | [Direction](#5-direction) | outbound only |
| 6 | [Relations](#6-relations) | Plan · Sprint · Issue |
| 7 | [Actions](#7-actions) | cut · record — and what Plot hands off |
| 8 | [Scope](#8-scope) | which plans are in a release |
| 9 | [The collaborators](#9-the-collaborators) | three scripts, one hand-off |
| 10 | [Fleet control](#10-fleet-control) | the gate, and what it decides |
| 11 | [Views](#11-views) | the Released column |
| 12 | [Setup](#12-setup) | none of its own |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a Release is

**A Release is a version, and the set of plans whose work it contains.**

It is the third grouping (Sprint §1), and its axis is neither subject nor time
but **what shipped together**:

| | groups by |
|---|---|
| Story | **subject** |
| Sprint | **time** |
| **Release** | **version** — what a tag contains |

### Only features and bugs need one

*"Docs/infra work is live when merged"* — `/plot-deliver` says so to their
authors, and `/plot-release` skips them: *"marking them Released contradicts a
message Plot itself sends."*

**So a Release is the last phase of a `feature` or `bug` plan and no phase at
all of a `docs` or `infra` one.**

### The tag is the truth

**A Release exists because a git tag does.** The `Released:` record in a plan is
Plot's reflection of that fact — *"the tag stays the git truth and this merely
reflects it"* — and the version is resolved with `git tag --contains`, never
from a date:

> *"The delivery date is when the plan was **booked**, not when its code merged
> — those can be months apart, and two tags may share a date. Dates get this
> wrong; `--contains` cannot."*

---

## 2. Posture

| posture | what a Release is |
|---|---|
| `plot` | a tag, and a `Released:` record per plan |
| `plot` + a tracker | **the epic's key** — the epic closes with the release (Issue §8) |
| `jira` leads | a projection, unbuilt |

**Under publishing, the release version is the epic's identity.** `epic(2.11.0)`
collects the feature ticket of every plan in that release, and *"closes with the
release"* — so a Release is the one entity whose **version** is a foreign key.

---

## 3. The domain object

### Identity

```
Release.version : string      the tag, canonically `vN.N.N`
```

**The tag is the identity**, and the estate is inconsistent about how it is
written down.

**Measured across 113 released plans, 2026-08-28** — the version as recorded in
`Released:`:

```
2.9.0   38      ← no prefix
v2.5.0  26      ← with prefix
v2.7.0  25
v2.5.1   6
v2.5.2   4
```

**Verified independently across every `Released:` line: 70 carry the `v`, 40 do
not** — both spellings in one field, in one estate.

Every git tag here is `vN.N.N` (129 of them), so a consumer matching the
recorded string against `git tag` resolves 70 and misses 40. That is the
**Person** finding in a different field: free text where a normalized value
belongs.

**3 released plans carry no `Released:` record at all**, which the scan reads as
having no version.

### Fields

| field | type | source | note |
|---|---|---|---|
| `version` | string | the git tag | **the identity** — normalize the `v` |
| `date` | date | the tag | when it was cut |
| `commit` | sha | the tag | what it points at |
| `plans[]` | Plan[] | **derived** | see §8 — never stored |
| `channel` **`+`** | `release` \| `rc` | the tag's suffix | `v2.1.0-rc.1` is not a release |
| `checklist` | path \| null | `docs/releases/` | RC only — **2 of 129** |

**`plans[]` is derived and must stay so**, for the reason every other membership
in Plot is: a stored list goes stale the moment a plan is released, and the plan
already records the version.

---

## 4. Lifecycle

### Two shapes, and one is rarely used

```
(delivered plans)  ──rc──►  v2.1.0-rc.1 + a checklist  ──►  v2.1.0
                   └──────────── cut directly ─────────────┘
```

**Measured: 129 tags, 2 RC checklists.** The RC path exists, is fully
specified, and this estate has used it twice.

**The gate differs between them, deliberately.** `/plot-release rc` **proceeds**
past open Must Haves while the final cut **refuses**:

> *"A release candidate is how a sprint's remaining work gets verified, so
> gating it would take away the tool operators use to finish the very items
> being gated on. The gate fires when the version becomes real."*

### The version is not Plot's to choose

**Plot hands off.** `/plot-release` step 4 says the mechanics — `CHANGELOG.md`,
the version bump, the tag, the push — *"belong to the project's own release
process, not to `plot-release`."*

Here that is **changesets**: `changeset version` computes the bump from
`.changeset/*.md` files, writes `CHANGELOG.md` and `package.json`, and a
release PR carries it. **So the version is derived from accumulated intent**,
not decided at cut time.

**Plot's contribution is the cross-check** (§7) and the records (§10).

---

## 5. Direction

**Outbound only.** A release is something Plot's estate produces; nothing
outside creates one. Under publishing it produces an epic (§2), and under
`Tracker: plot` it produces nothing beyond the tag.

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| Plan → Release | `Released: <date>, <version>` | **built** |
| Sprint → Release | `Release: <version>` in the sprint | **built** — the gate's key |
| Release → Issue | the epic, keyed by version | posture 2, **unbuilt** |
| Release → Plans | **derived** — `git tag --contains` | **built** |

**Two sprints may target one release** — *"two teams, one train"* — so a Release
has no single sprint, and any derivation that assumes one is wrong.

---

## 7. Actions

| action | who | what |
|---|---|---|
| **Cut an RC** | `/plot-release rc` | tag + a verification checklist |
| **Cross-check** | `/plot-release` step 3 | **the command's primary value** |
| **Cut** | **the project's release process** | changesets, here |
| **Record** | `/plot-release` step 5b | `Released:` per plan, from `git tag --contains` |
| **Note an override** | step 5c | `--ignore-sprint` written into the sprint |

**The cross-check is what the command is for:** *"verifying that release notes
accurately reflect delivered work"* — comparing the generated changelog against
delivered plans and commits, flagging *"a delivered feature completely missing
from the changelog, or a changelog entry that doesn't match any actual work."*

**And a sign-off is never filled by an agent.** Under `PLOT_UNATTENDED` the RC
checklist's sign-off lines stay blank: *"those two blanks are the record of a
person taking responsibility; an agent writing into them forges it."*

---

## 8. Scope

**Which plans are in a release is derived from git, per plan:**

```sh
SHA=$(plot-host.sh pr-state <N> | jq -r '.mergeCommit')
TAG=$(git tag --contains "$SHA" | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | sort -V | head -1)
```

**Three rules fall out of that**, and each is a refusal:

| case | what happens |
|---|---|
| no `→ #N` annotation | **left alone**, reported as unresolvable |
| no merge commit | as above |
| `docs`/`infra` plan | **skipped** — live on merge (§1) |

*"An invented version in a transition record is a claim nobody re-checks."*

**And the symlink does not move.** `delivered/` means *no longer active*, not
*phase is exactly Delivered*.

---

## 9. The collaborators

| script | answers |
|---|---|
| `plot-sprint-release.sh` | the sprint gate's facts — target, and every item's state |
| `plot-host.sh pr-state` | a PR's merge commit, for `--contains` |
| `plot-reconcile-scan.sh` | `unreleased_delivered` — plans that shipped and were never recorded |

**No monitor and no connector.** A release is a git tag: local, free to read,
and changing only when a person cuts one.

---

## 10. Fleet control

**The release gate is the estate's last gate**, and it is the clearest example
of the collect/decide split:

| tier | on an open item |
|---|---|
| **Must** | **refuses** — names each one and stops |
| **Should** | **asks** — and answering no cuts nothing |
| **Could** | reports |

**`plot-sprint-release.sh` supplies the facts and decides nothing** — *"it never
exits non-zero for an unfinished item; a script that refused would be making
this call itself."*

**The Should tier has no flag, deliberately:** *"a hard gate on stretch goals is
one operators learn to force past, and a flag typed reflexively has stopped
being a gate. But silence is the failure this whole step exists to fix… **the
confirmation is the record that a person looked**."*

**And `PLOT_UNATTENDED` never converts a refusal into a pass:** *"a variable set
in the least-supervised environment must have strictly less power than the
operator."*

---

## 11. Views

| view | shows |
|---|---|
| the **Released** column | plans whose state is `released` |
| a release row | the version a branch would ship in |

**Released plans drain from DONE** — the board's own rule, so a released plan
leaves the fleet view rather than accumulating in it.

---

## 12. Setup

**No key of its own.** A Release inherits the plan directory and the git host;
its version comes from the project's release tooling, which `/plot-deliver` and
`/plot-release` **discover** rather than configure — changesets first, then
`CLAUDE.md`/`AGENTS.md` instructions, then `package.json` scripts.

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **The version is recorded two ways** — 70 lines carry the `v`, 40 do not; every tag is `vN.N.N` | **now, measured** |
| 2 | **3 released plans carry no `Released:` record** — invisible to a version query | now |
| 3 | **`channel` is not modelled** — an RC tag and a release tag are the same string type | now |
| 4 | Release → epic unbuilt (posture 2) | posture 2 |

**Gap 1 is the actionable one**, and it is a normalization: strip or add the `v`
at the parser, the way `state` is normalized, and record which form the estate
uses.

---

## 14. Invariants and open points

### Invariants

1. **The tag is the truth**; `Released:` reflects it.
2. **The version is resolved with `git tag --contains`, never from a date.**
3. **`docs` and `infra` plans are never released** — live on merge.
4. **Membership is derived**, never stored.
5. **Plot does not cut the version** — the project's release process does.
6. **A Must Have refuses; a Should asks; neither is silent.**
7. **An agent never fills a sign-off.**
8. **An unresolvable version is left blank, never invented.**

### Open points

- **Should `version` be normalized at the parser?** 70 lines say `v2.5.0` and 40
  say `2.9.0` for the same kind of thing.
- **Should an RC be the same entity?** It has a tag, a checklist and a gate that
  behaves differently — arguably `channel` is enough, arguably it is its own.

# A slice row finds its PR by head

> An agent opened its slice PR and annotated the plan on its own branch, exactly as `/plot-implement` instructs. The board reads plans from `origin/<main>`, so the annotation is invisible until the PR merges — and the PR the operator must review to cause that merge is the one the board will not show.

## Status

- **State:** Rejected
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1057
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- A slice whose PR is open shows it, without waiting for the plan annotation to reach the main branch.

Board impact: this is the board's slice row. No payload field is added.

## Motivation

Reported from a Bitbucket estate, Plot 2.21.0, `Main branch: develop`. A fleet agent:

1. opened PR #1109 with `plot-open-pr.sh`, as the brief requires
2. wrote the slice heading and `→ #1109` into the plan **on its own feature branch**, as `/plot-implement` step 4 instructs

The board reads plans from `planSource.ref`. **So both the slice's name and its PR number sit on a branch the board does not read**, and the row renders `(unnamed)` with *"worker finished — review it"* and no link.

**The deadlock is the point:** the annotation becomes visible when the PR merges, and the PR merges when somebody reviews it, and the board is where they would find it.

### Neither half is wrong

- **Reading plans from the main ref is deliberate** — a plan on a feature branch is a proposal, and the board showing it would make every agent's in-flight edit look like estate state.
- **Annotating on the branch is what the skill instructs**, and the alternative (an agent committing to main mid-slice) is worse.

### The board already has the answer

`fleet.ts:2651`/`:2674` build **`byHead: Map<string, PrRecord>`** — every PR keyed by its head branch, from the host, **independent of any plan annotation.** The slice row knows its branch. So the fact the operator needs is already in the payload's source; nothing new is fetched.

## Design

### The rule

**A slice row resolves its PR by head branch, and the annotation is a confirmation rather than the source.**

The plan's `→ #N` stays exactly as it is — it is the durable record, it survives the branch being deleted, and `plot-impl-status.sh` and `/plot-deliver` read it. **This plan changes what the BOARD renders, not what a plan records.**

### Precedence, and why this direction

Where both exist they agree. Where they disagree the **annotation wins**, because it is the plan's own statement and `plot-impl-status.sh` already treats it that way. Where only `byHead` has an answer — the live case — the row shows it.

**`plot-impl-status.sh` already resolves un-annotated branches by head**, which is the same derivation this asks the board to make. The estate settled the direction; the board did not follow.

### What this does NOT do

- **It does not read plans from a feature branch.** That is the rule this respects, not one it bends.
- **It does not write the annotation for the agent**, and it does not make the annotation optional.
- **It does not change `/plot-implement` step 4.**
- **It does not add a payload field** — `byHead` already exists server-side.

## Done when

- **A slice whose branch has an open PR renders that PR**, asserted with a fixture where the plan on the read ref carries no `→ #N`.
- **An annotated slice is unchanged**, asserted — the regression this must not cause.
- **A slice with neither still renders as it does today**, asserted.
- **Where the two disagree the annotation wins**, asserted, and the PR says why that direction.
- The row does not read `(unnamed)` when the host knows a PR for its branch. **The name and the link are two facts and the PR says whether both are fixed or only the link.**

## Slices

### A slice row finds its PR by head (Branch: bug/a-slice-row-finds-its-pr-by-head)

Resolve a slice row's PR from `byHead` where the plan carries no annotation, keeping the annotation authoritative where it exists.

## Notes

**The agent did everything right and the board still could not show its work.** That is what makes this worth a plan rather than a brief instruction change: no participant misbehaved, and the gap is between two correct rules.

**Its sibling is [`a-sprint-view-says-what-it-hid`](2026-09-29-a-sprint-view-says-what-it-hid.md) (#1058)** — both are the board declining to show a PR an operator must act on, from the same estate on the same day, for unrelated reasons.


## Rejected, 2026-09-29

One juror, **reject**, **executed**. Moderation: `.plot/panels/2026-09-29-a-slice-row-finds-its-pr-by-head/panel.md`.

**The mechanism this plan proposes is on `main`, and this plan's own citation is the answer.** `fleet.ts:6440-6441`, inside the slice loop:

```ts
const held = prsByHeadMap?.get(b.branch) ?? null;
const linked = held && held.state === 'CLOSED' ? pr : (held ?? pr);
```

`held ?? pr` — **the head map is asked FIRST**, and `fleet.ts:6675` is the row's `pr` field. `prsByHeadMap` is `entry.prsByHead`, which is the `byHead` map this plan cited at `:2674` as an unconsumed fact. The distance from the cited line to the shipped fix is under fifty lines, with a measurement in its comment (#252/#253/#254).

**The precedence this plan argued for would have been a regression.** *"Where they disagree the annotation wins"* describes a coupling that does not exist: no `agentPr` call site reads `plan.prs`, and the scan emits no per-branch PR number. It would have added plan text as an input to a host-derived field, against the shipped direction.

**Verified live, on the estate, with the discriminating case.** `origin/main`'s copy of `a-row-is-owned-by-more-than-its-pr` carries **zero** `→ #N`; its branch has open PR #1060; the board renders `{"number": 1060, "url": …, "author": "jwloka"}`. This plan's first `Done when` passes on `main` today.

**The half of the symptom that is real is the half this mechanism cannot touch.** `(unnamed)` is `UNNAMED_SLICE` (`schema.ts:1429`) — the slice's **name**, from a `###` heading missing on the read ref. `byHead` can never supply a slice name. The plan conflated the name and the link and proposed a fix for the one that works.

**#1057 is rephrased, not closed.** The reporter saw something real on Bitbucket. What a replacement must establish first: was `prsByHead` populated at all when that row rendered? Bitbucket refreshes at 4× the GitHub period (`prRefreshMsFor`), so a cold map is the likelier cause — and if it was empty, reading it harder cannot help.
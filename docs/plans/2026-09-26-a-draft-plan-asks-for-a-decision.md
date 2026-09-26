# A draft plan asks for a decision

> A plan being drafted appears nowhere on the Agents tab. WAITING ON YOU answers *what needs a person* and a Draft plan awaiting approval is the plainest case there is, but every row on that tab is derived from a branch and a Draft plan correctly has none. Measured 2026-09-26: `/api/fleet` served 28 rows, 0 without a branch, 0 Draft plans, while an operator and an agent worked on one.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1009
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)

## Changelog

- A Draft plan awaiting approval gets a WAITING ON YOU row naming how many rounds it has been through. The board stops going silent during the phase when a plan most needs a person.

Board impact: **entirely board.** One new row source and one new field on the fleet payload; no scan change, no domain rule.

## Motivation

**The board is silent exactly while a plan needs a person.** Branches exist for review and for parallelism, and a plan being drafted needs neither — so it correctly has no branch, and the Agents tab cannot represent it.

Measured 2026-09-26 on `/api/fleet`:

```
rows                    28
rows with no branch      0
Draft plans among rows   0
```

This is not an edge case. Branches are cut at dispatch, which happens *after* approval, so **every** plan is branchless for its whole drafting life. The board goes blind for the entire phase in which somebody must read, question and approve it.

### The estate's posture makes this the common path

| | count |
|---|---|
| plans declaring `Review: in-session` | **257** |
| plans declaring `Review: pr` | 88 |
| plan starts committed to the default branch, last 200 commits | **11** |
| merged `idea/` pull requests, last 100 | **1** |

`/plot-idea` routes a `Review: pr` plan onto `idea/<slug>`, and that branch is created about once in a hundred merges. Plans live on the default branch here, so the branchless case is the normal one rather than a deviation.

### The board already knows what to say

`fleet.ts:4429` returns `{ group: 'waiting-on-you', note: DRAFT_PLAN_NOTE }`, and `:4299` states the sentence: *"plan not approved yet — still in review."* That arm sits inside the per-branch classifier, so it fires for a Draft plan that HAS a branch row and never for one that does not — the case it was written for is the case it cannot reach.

`rounds` is already in the payload (`schema.ts:172`, `:410`) and already rendered on the Plans tab. The fact a reader needs — *this plan has been interrogated N times and awaits your decision* — is measured, serialised, and shown somewhere else.

### A non-branch row is not a new kind

**This is the finding that settles the design, and an earlier reading of this issue got it wrong.** It argued that plan-level rows would change the tab's subject from *branches* to *things needing a person*, and treated that as an open question.

`brokenAgentRows` already does it. `working-agents.ts:58`:

> **One WAITING ON YOU row per BROKEN registry entry** — a problem report for an agent that stopped and needs a person.

Its subject is an **agent**, not a branch, and its own comment names the section's subject: *"All three say go look at this — exactly what WAITING ON YOU exists to say."*

So the tab already carries rows that are not branches, and the section's subject is already *what needs a person*. A Draft plan row is the second instance of a shipped pattern, not a change of subject.

## Design

### The rule

**A plan at `Draft` that names no branch carrying work gets one WAITING ON YOU row.** Its note is the sentence the board already has — *plan not approved yet — still in review* — and it names the plan's `rounds`.

### Where it comes from

Beside `brokenAgentRows`, as its sibling: a function taking the plans and returning the rows that need a person. The two answer the same question about different subjects, and the section already composes rows from more than one source.

**It is not the per-branch classifier**, and must not be: that path needs a branch by construction, which is the whole defect.

### Which Draft plans qualify

**A Draft plan whose branches carry no work.** A plan may be Draft and already have a dispatched branch — `/plot-idea`'s `Impl: same branch` posture puts the plan's first commit on the work branch — and that plan already has a row through the existing arm. Emitting a second would double it.

The test is the branches, not the phase alone: no branch of this plan appears in the row set.

### Rounds is reported, never judged

The row names the count and draws no conclusion from it. `Rounds: 0` is a recorded value meaning *interrogated and found nothing*, and a plan with no field is honestly unquestioned — the distinction `schema.ts:163` already makes, and this row must not flatten it into a badge that implies one is worse.

### What this does NOT do

- **It DOES add a payload field, and an earlier draft said otherwise.** That draft cited `rounds` as already served at `schema.ts:172` and `:410`. Both lines are real and **both are the wrong payload**: `:172` is `PlanMetaSchema` (the parser) and `:410` is `CardSchema` (`/api/board`, the Plans tab). The Agents tab renders `AgentRow` from `/api/fleet`, which carries neither the phase nor the rounds — confirmed live against the running board. The field is added to the fleet payload, and the slice is sized for a contract change both sides read rather than a row source alone.
- **It changes no scan and no domain rule.** The plan's phase is read where it already is.
- **It does not move the Plans tab's rows.** A Draft plan stays there too; the tabs answer different questions and both answers are true.
- **It does not decide anything about the plan.** No approve action, no phase write. The row says a decision is owed and a person makes it.
- **It does not touch the `draft` arm at `fleet.ts:4405`.** That arm is correct for the plan it can see; this adds the source it cannot.

## Done when

- A Draft plan with no branch carrying work appears in WAITING ON YOU, naming its rounds.
- A Draft plan that already has a branch row does not appear twice.
- An Approved, Delivered or Released plan produces no such row.
- A plan with no `Rounds:` field renders differently from one recording `Rounds: 0`.
- A unit test asserts each of the four above from the domain, with one browser test that the row is seen.

## Slices

### A draft plan asks for a decision (Branch: bug/a-draft-plan-asks-for-a-decision)

The row source beside `brokenAgentRows`, the four cases above as unit tests, and one browser test.

## Notes

This issue was filed with two wrong framings before this one. The first said a Draft plan has no branch *by definition* and treated the absence as unavoidable; the second said the branch is `main`, which the board does display as `masterAgentBranch`. Both were corrected on #1009. The right statement is that the plan correctly has no branch, and the tab lacked a row source for work that is not one — which `brokenAgentRows` shows it does not lack after all.

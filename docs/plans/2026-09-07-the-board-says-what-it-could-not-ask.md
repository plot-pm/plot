# The board says what it could not ask

> `Checks` already admits `unknown`. The board's PR rows carry `number`, `url`, `draft`, `state` and `states` — and no checks at all, so a build the board could not ask about and a PR with no CI look identical: blank.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A capability the board could not reach renders as *not asked*, so an unreachable service is visibly different from a service with nothing to report.

## Motivation

**The domain already has the word.** `entities/pr.ts:32` — `ChecksSchema = z.enum(['green', 'pending', 'failing', 'none', 'unknown'])`. Five states, and `unknown` is one of them.

**The board does not carry it.** Measured 2026-09-07 against the live `/api/fleet`: the keys present across every row's `pr` object are **`number`, `url`, `draft`, `state`, `states`**. No `checks`. **72 of 72 rows carry no build field.**

**SO THE DISTINCTION EXISTS IN THE DOMAIN AND DIES BEFORE THE SCREEN.** `none` means *this PR has no CI*; `unknown` means *we could not find out*. On a GitHub repo the difference is academic. **On a Jenkins team where `runs()` reaches `gh` alone, every PR is `unknown` and the board shows what looks like a fleet with no CI at all.**

**THE ESTATE ALREADY DECIDED THIS RULE TWICE.** `plot-board-probe.sh` treats an unrecognised auth answer as *cannot verify*, never as *authenticated*. The supervisor badge shipped in 2.14.0 with `up` / `down` / `unknown` and 19 domain tests, because *"a board that cannot ask must not render `down` — that is an alarm nobody can act on — and must not render `up`, which is the failure being removed."* **This is the same rule, for the capability a team looks at most.**

**AND `issueAnswer` SHOWS THE SHAPE ALREADY WORKS.** The fleet payload carries `issueAnswer: "answered"` beside `issueError: null` — askability travelling as its own field rather than being inferred from an empty list. The pattern is in the payload; checks are missing from it.

## What this is not

**Not a new state.** `unknown` is in `ChecksSchema` today. This carries it.

**Not a fix for the CI gap.** `three-services-three-ports` makes Jenkins answerable. **This plan makes the unanswerable visible**, and is worth doing whether or not that lands — a service can be down on any stack.

**Not a badge on every row.** A PR whose checks are green needs no annotation. Only the absence of an answer is a finding.

## Slices

### A row carries its checks, including unknown (Branch: bug/the-board-says-what-it-could-not-ask)

The fleet payload carries `checks` per PR, and the board renders `unknown` as *not asked*.

**THE FIVE STATES TRAVEL, NOT A BOOLEAN.** `green`, `pending`, `failing`, `none`, `unknown` — collapsing to *ok / not ok* recreates the defect one layer up.

**`none` AND `unknown` MUST NOT RENDER THE SAME.** That is the whole plan. A PR with no CI configured is a fact; a PR whose CI could not be reached is a question.

**THE DECISION IS A DOMAIN PROPERTY.** Per the layering rule, what a reader sees for each state is decided in a rule and asserted in a unit test — the supervisor badge is the worked example, with its prominence keyed on consequence rather than on the state alone.

**ONE UNREACHABLE SERVICE IS NOT SEVENTY-TWO FINDINGS.** When the connector itself cannot be asked, the board says so **once**, not on every row. A per-row `unknown` means *this PR*; a service-level refusal means *this stack*, and a reader must be able to tell which they are looking at.

**Done when** `checks` travels per PR with all five states, `none` and `unknown` render differently, the mapping is asserted in a unit test with no browser, one browser test proves the render, and an unreachable connector reports once rather than per row.

## Notes

### Why this is a Should and not a Must — 2026-09-07

A teammate can adopt, plan, dispatch and deliver without ever reading a check state. **They cannot do any of it if adoption defaults their tracker silently or a refusal names no repair**, which is what the three Musts fix.

But this is the first thing they will *misread*. A board showing no CI on a team that runs CI every hour is not a missing feature — it is the board being wrong in a way that costs trust before anyone thinks to check.

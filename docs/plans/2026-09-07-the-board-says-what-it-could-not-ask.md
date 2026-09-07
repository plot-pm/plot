# The board says what it could not ask

> `Checks` already admits `unknown`. The board's PR rows carry `number`, `url`, `draft`, `state` and `states` — and no checks at all, so a build the board could not ask about and a PR with no CI look identical: blank.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #785 merged
- **Started:** 2026-09-07, Jan Wloka, `bug/the-board-says-what-it-could-not-ask`

## Changelog

- A capability the board could not reach renders as *not asked*, so an unreachable service is visibly different from a service with nothing to report.

## Motivation

**The domain already has the word.** `entities/pr.ts:32` — `ChecksSchema = z.enum(['green', 'pending', 'failing', 'none', 'unknown'])`. Five states, and `unknown` is one of them.

**And so does the board's server — the gap is one contract field.** Round 1 measured the chain end to end and this plan's opening was wrong about most of it:

| layer | state |
|---|---|
| `ChecksSchema` | five states including `unknown` |
| `plot-host.sh pr-list --rich` | branches on **backend × rich × Jenkins** already |
| `fleet.ts:345` | defines `checks` with all five states |
| `schema.ts:257` | states the rule: *"Bitbucket's `checks:"unknown"` renders as unavailable rather than green"* |
| **`CardPrSchema`** | **`number`, `url` … and no `checks`** |

**The concept, the states, the Jenkins branch and the rendering rule all exist. The contract drops the field**, so 229 cards and 58 fleet rows carry none of it.

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

**ONE FIELD ON `CardPrSchema`, AND THE REST IS WIRING.** The reading is fetched, the states exist, the rule is written. Do not re-derive any of it — carry `checks` through the contract and fill it from what `fleet.ts` already holds.

**THE FIVE STATES TRAVEL, NOT A BOOLEAN.** `green`, `pending`, `failing`, `none`, `unknown` — collapsing to *ok / not ok* recreates the defect one layer up.

**`mergeable` DISAMBIGUATES `checks` AND MUST TRAVEL WITH IT.** `fleet.ts:349` records why: GitHub starts no workflow for a PR that does not merge cleanly, so a conflicting PR reports `checks: 'none'` — indistinguishable from a bot PR waiting for approval. Carrying one without the other ships a known ambiguity.

**`none` AND `unknown` MUST NOT RENDER THE SAME.** That is the whole plan. A PR with no CI configured is a fact; a PR whose CI could not be reached is a question.

**THE DECISION IS A DOMAIN PROPERTY.** Per the layering rule, what a reader sees for each state is decided in a rule and asserted in a unit test — the supervisor badge is the worked example, with its prominence keyed on consequence rather than on the state alone.

**ONE UNREACHABLE SERVICE IS NOT SEVENTY-TWO FINDINGS.** When the connector itself cannot be asked, the board says so **once**, not on every row. A per-row `unknown` means *this PR*; a service-level refusal means *this stack*, and a reader must be able to tell which they are looking at.

**Done when** `checks` travels per PR with all five states, `none` and `unknown` render differently, the mapping is asserted in a unit test with no browser, one browser test proves the render, and an unreachable connector reports once rather than per row.

## Notes

### Why this is a Should and not a Must — 2026-09-07

A teammate can adopt, plan, dispatch and deliver without ever reading a check state. **They cannot do any of it if adoption defaults their tracker silently or a refusal names no repair**, which is what the three Musts fix.

But this is the first thing they will *misread*. A board showing no CI on a team that runs CI every hour is not a missing feature — it is the board being wrong in a way that costs trust before anyone thinks to check.

### Round 1 — 2026-09-07

**This plan opened by claiming the board had no checks concept. It was wrong on four of five layers.** The domain's enum, the script's Jenkins branch, the server's field and the documented rendering rule were all already there — including a sentence in `schema.ts` stating exactly the behaviour this plan proposed to introduce.

**What survived is one line of a schema.** `CardPrSchema` carries `number` and `url` and not `checks`, so everything upstream is computed and dropped at the wire.

**The round is the argument for the sprint's own goal.** A capability that exists at four layers and dies at the fifth is invisible to a reader who greps for the concept and finds it — which is what I did when writing the plan, and what a teammate would do when wondering why their board shows no CI.

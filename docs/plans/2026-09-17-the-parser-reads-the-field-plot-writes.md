# The parser reads the field Plot writes

> Front matter takes precedence over `## Status`, and no lifecycle script writes front matter — so on a plan carrying both, every transition Plot performs is invisible to every reader.

## Status

- **State:** Released
- **Type:** bug
- **Issue:** #933
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-domain-knows-what-plot-knows
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-17, jwloka, in-session
- **Delivered:** 2026-09-17
- **Released:** 2026-09-20, 2.19.0

## Changelog

- `plot-plan-meta.sh` reads the `State:` field Plot's own scripts write, rather than front matter that nothing updates. A plan carrying both reported its front-matter value forever, so an approved plan scanned as unapproved and dispatched nothing.

<!-- Board impact: the board reads every phase through this parser, so a plan
     whose transitions were invisible becomes visible. No plan format change:
     both shapes still parse, only the precedence moves. -->

## Design

**`plot-plan-meta.sh:443` gives front matter precedence:**

```awk
if (fm_status != "" || fm_phase != "") {
    fmt = "frontmatter"
    praw = (fm_status != "") ? fm_status : fm_phase
} else if (canon_state != "" || canon_phase != "") {
```

**And the writers touch only `State:`.** Verified: `plot-approve.sh` contains
zero front-matter references, and `plot-deliver.sh`'s five are all about
REFUSING the case, not writing it.

So on a plan carrying both, the parser reads a field nobody maintains:

```
status: Draft          <- untouched by every transition
phase:  Draft          <- untouched
- **State:** Approved  <- what /plot-approve wrote
```

**Measured by the reporter**: `/plot-approve` reported all seven steps clean,
and `plot-fleet-scan.sh` answered `Wave 1 — unapproved, eligible=0`. Editing the
two front-matter lines by hand made it `eligible=1` immediately.

### This is the root of a defect already patched at the surface

[`a-plan-has-one-phase`](2026-09-16-a-plan-has-one-phase.md) shipped in v2.18.0
and made `plot-deliver.sh` **refuse** a delivery whose write the parser would not
read (`plot-deliver.sh:472`). That gate is right and stays.

**But a refusal is not a fix.** The delivery stops and the operator is told to
edit one of two records by hand — a hand edit `plot-state-gate.sh` then refuses,
because no script owns that write. **The two gates leave a plan that cannot move
without the named escape**, and nothing in the lifecycle writes the field the
parser prefers.

### The precedence inverts; the format does not change

**Both shapes keep parsing.** A plan with only front matter reads exactly as
today — that is the population this precedence was presumably written for, and
breaking it would trade one silent failure for another.

**What changes is which wins when BOTH exist**: `State:` is the field Plot's own
scripts write, so it is the field the parser believes. Front matter becomes the
fallback it already is for the other direction.

**`phase_alt` already carries the loser.** The parser reports the second value
rather than dropping it, so a reader — and `plot-deliver.sh`'s own gate — can
still see the disagreement. **That is what keeps this from hiding the drift it
stops causing.**

### The blast radius is one test, and it pins the contract being inverted

**Zero plans on this estate carry both shapes** — measured 2026-09-17. So a gate
asserting *"all 292 plans parse byte-identically"* is satisfied by doing nothing
and **cannot see this defect at all**. It stays as a regression lock and is not
evidence.

**The one artifact that carries both is a test**, and it exists to pin the
precedence this plan inverts — `parser.test.mjs:582`, *"front matter design:
outranks a `## Status` Design: line"*, whose comment reads *"Front matter wins
over the canonical body, the rule every other transition record follows."*

Run against the inversion: **96 pass, 1 fail, and it is that one.**

**So the test changes, deliberately, and this plan says so rather than leaving
an implementer with a red suite and no instruction.** What moves is its `format`
assertion; `design_raw` stays front-matter-wins either way, because `Design:` is
not a field any lifecycle script writes — **the precedence moves for the fields
Plot owns, not for every field.**

### What this does not do

**It does not remove front matter from the format.** Plans in the wild carry it,
`plot-plan-meta.sh` has parsed it since before `State:` existed, and a parser
that refused it would break every such plan at once.

**It does not make the writers write front matter.** Two records of one fact is
the defect; adding a second writer entrenches it. The plan's own
`a-withdrawn-item-is-not-open` records the same reasoning about a `<!-- status
-->` annotation nobody read.

**It does not relax `plot-deliver.sh`'s refusal.** That gate fires when writer
and reader disagree, and after this change they agree — so it stops firing
because the condition is gone, not because it was softened.

## Slices

### The parser reads the field Plot writes (Branch: bug/the-parser-reads-the-field-plot-writes, PR: #944)

- `bug/the-parser-reads-the-field-plot-writes` — invert the precedence in `plot-plan-meta.sh` so a canonical `State:`/`Phase:` wins over front matter where both exist, keeping `phase_alt` as the loser and every single-shape plan byte-identical

**Done when** a plan carrying front matter `Draft` and `State: Approved` reports
`phase: approved` with `phase_alt: draft`, pinned by a fixture holding both; a
plan with **only** front matter reports exactly as today, pinned across all
seven phase values; a plan with only a `## Status` block reports exactly as
today; **all 292 plans on this estate parse byte-identically**, which is a regression
lock rather than evidence — zero of them carry both shapes, so the clause is
satisfied by construction and the defect is invisible to it;
**`parser.test.mjs:582` is updated rather than deleted**, its `format`
assertion moved and its comment rewritten to state the new rule, since it is the
only both-shapes artifact in the repository and silently dropping it would
remove the pin instead of moving it; `design_raw` still prefers front matter,
pinned, because no lifecycle script writes a `Design:` field; `fmt` still reports which shape was read, so
a consumer can tell; the reporter's sequence works end to end — approve a
both-shapes plan, then `plot-fleet-scan.sh` answers `eligible=1`, pinned by a
test that performs the approval rather than by editing a fixture; and `pnpm run
test:contracts` passes.

## Notes

**Reported 2026-09-17 from a real approval that silently did nothing.** The
seven-step summary said `phase=flipped record=written push=clean` and the scan
said `unapproved`.

**The repository in the report is the same one that filed #928, #929 and #930** —
an adopter on an enterprise stack, which is the population
`the-board-is-blank-where-it-matters` has an open question about.

**Two of the report's own statements are narrowed above rather than repeated.**
`plot-deliver.sh` does hold five front-matter references, and all five refuse
rather than write; and the report's table lists a `plot-release.sh` that does not
exist on this estate.

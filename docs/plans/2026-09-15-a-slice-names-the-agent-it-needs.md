# A slice names the agent it needs

> A plan declares which kind of agent a slice wants, and dispatch selects that charter without an operator typing it.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-agent-identity
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-15, jwloka, in-session
- **Started:** 2026-09-15, jwloka, `feature/a-slice-names-the-agent-it-needs`

## Changelog

- A slice can name the agent kind it needs, and a dispatch selects that charter automatically. Until now the kind was an operator's `--agent` flag, so an unattended fleet ran every slice as the same undifferentiated worker.

<!-- Board impact: the plan format gains a per-branch annotation, parsed
     alongside `waits:` and `builds:`. `plot-plan-meta.sh` is the contract; the
     board consumes its JSON and ignores a key it does not read. -->

## Design

**`--agent <name>` shipped in v2.18.0 and only an operator can type it.**
`plot-dispatch.sh:294` takes a charter name, refuses a value starting with `-`,
and requires the value because an agent name is a bare word and so is a plan
slug — an unconsumed value would let the `*)` arm read the agent name as the
plan. That flag is the whole selector today.

**So an unattended fleet cannot differentiate anything.** `plot-registryd` hands
a queued slice to a free agent with no `--agent` in sight, which is exactly the
half of the story that was never started: *"a slice says what kind of agent it
needs, and the fleet's capacity stops being one undifferentiated number."*

### The field is a per-branch annotation, and two already exist

**Every `## Status` field is plan-level.** Measured against
`.plot/templates/plan.md`: `State`, `Type`, `Sprint`, `Issue`, `Story`,
`Review`, `Impl`, `Rounds` — all describe the plan. A `Agent:` line there could
only ever declare one kind for a plan with several slices, which is the
population this exists for: a reviewer slice beside an implementer slice.

**So it is per-branch, and the shape is already settled by precedent.** Two
optional per-branch annotations exist today, both HTML comments on the branch
list item:

```
- `feature/x` — description <!-- waits: bug/other -->
- `feature/y` — description <!-- builds: normalizeVersion, a shared helper -->
```

The parser reports them as `waves[].branches[].waits_on` and `.builds`, and the
key is **ABSENT where no annotation was written — never `""`**. `agent:` joins
them as a third:

```
- `feature/x` — description <!-- agent: reviewer -->
```

**The wave heading was the first draft and is rejected, by measurement.**
`plot-plan-meta.sh:886` decides a heading's shape with
`index($0, "(Branch:")` — the literal `(Branch:` must open the parenthesis. A
heading written `(Agent: reviewer, Branch: feature/x)` parses to **zero
branches**, *and* the wave name becomes the entire heading text,
`'N (Agent: reviewer, Branch: feature/x)'`, which the board renders as a prose
slice name. Both failures are silent.

Requiring `Branch:` first would work and would make the plan format depend on
field order in one place and not others. The annotation avoids the question
entirely: **it touches no existing parse path**, so the 280-plan regression risk
drops to whatever a new, independently-matched comment introduces.

### The parser is the contract, and four scripts read it

`plot-plan-meta.sh` owns *what a plan says* — CLAUDE.md calls it "the
plan-format contract". Its `waves[].branches[]` output is consumed by
`plot-approve.sh`, `plot-deliver.sh`, `plot-fleet-scan.sh` and
`plot-boardctl.sh`, and by the board through the scan's JSON.

**A new optional annotation must not move any existing reader.** The key is
absent where unwritten — the contract `waits_on` and `builds` already state —
every plan on the estate parses byte-identically to today, and no consumer that
ignores the field changes behaviour. That is the property to test first, across
all 280 plans, because the parser is `awk` and a new pattern is exactly where a
silent mis-parse hides.

**And the risk is smaller than the heading draft's**, which is the point of the
change: an annotation is matched on its own, so nothing that reads a heading, a
branch name or a PR number is touched at all.

### Dispatch prefers the flag, and the plan is the default

**An operator's `--agent` wins.** A flag typed on this run is the more specific
answer than a field written when the plan was drafted — the same rule
`plot-dispatch.sh` already applies when `--agent` overrides an inherited
`PLOT_AGENT`.

**A slice naming no kind behaves exactly as today**, which is the whole estate:
no charter resolves, the three variables export empty, and the launch is
byte-identical. That property was established by v2.18.0 and this plan must not
weaken it.

**A slice naming a charter that does not exist is REPORTED, not refused.**
`resolve_launch` already refuses a charter it cannot believe and a harness not
on `PATH`; those stay. But a *missing* charter file is the adoption case — a
plan written on a machine that declares `reviewer` and dispatched on one that
does not — and refusing it would make a plan undispatchable on any clone lacking
the charter. It falls back to the default launch and says which name it looked
for, in the manifest and in the dispatch output.

### What this plan does not do

**It does not make the cap count by kind.** `rules/fleet-size.ts:145` is still
`Math.min(wanted, ceiling)`, and making the budget a vector is the story's third
bullet and its own plan. This plan makes the *declaration* reach dispatch;
whether the fleet reserves slots per kind is a separate question with its own
refusals.

**It declares no new charter.** One exists — `reviewer` — and a second would be
inventing a role this estate has not asked for.

## Slices

### A slice names the agent it needs (Branch: feature/a-slice-names-the-agent-it-needs, PR: #915)

- `feature/a-slice-names-the-agent-it-needs` — parse an optional `<!-- agent: <name> -->` annotation on a branch line in `plot-plan-meta.sh`, emitted as `waves[].branches[].agent` and absent where unwritten; have `plot-dispatch.sh` read it when `--agent` is absent; report a named-but-missing charter without refusing; document it beside `waits:` and `builds:` in both plan templates

**Done when** a branch line carrying `<!-- agent: reviewer -->` parses to that
value on that branch and the key is **absent** on a branch without one; all 280
existing plans parse **byte-identically** to today, checked by diffing the
parser's full output before and after; no wave heading is read differently than
it is today, since no heading shape changes; a dispatch of a slice naming
`reviewer` selects that charter without `--agent`; `--agent` on the command line
overrides the field; a slice naming no agent produces a launch byte-identical to
today; a slice naming a charter that does not exist dispatches anyway and names
what it looked for; and `pnpm run test:contracts` passes.

## Notes

**The second Must of sprint W41**, and the half of `plot-agent-identity` that was
never started. The first — the charter itself — shipped as
[`a-charter-reaches-the-agent-it-declares`](2026-09-14-a-charter-reaches-the-agent-it-declares.md)
in v2.18.0.

**Drafted after that slice landed rather than beside it**, deliberately: the
`--agent` spelling, its refusal on a leading `-`, and the required-value rule are
facts on main rather than intentions, and this plan builds on all three.

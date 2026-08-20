---
"@plot-pm/board": minor
---

board: a wave is a kind, and its status is not a sentence

The scan has emitted `{name, verdict, branches}` per wave since waves
existed. The board read the name onto the branch row as a string, dropped
the verdict onto that same row as a nullable field nothing rendered, and
then rebuilt the verdict as English in `blockedNote()`. Every piece was
already on the wire.

Measured on the mock before the change: a three-wave plan rendered four
rows all labelled `PLAN`, each naming its **branch** with the wave name as
a trailing badge, each linking `PLAN fleet-scan-asks-the-host` — directly
beneath the plan row heading those three rows — each showing `open` where
the scan had computed `eligible`, `blocked`, `blocked`, and one spelling
`blocked by Shaped — 1 outstanding` in prose one line below the `Shaped`
row itself.

`wave` becomes the eighth kind, with Octicons' `stack` for its glyph. A
wave row names the wave, carries the scan's verdict as its status, and
links its **branches** — unprefixed, and with no link to its plan, because
the plan is the row it is nested under and that placement is the statement.

The sentence `blocked by Relocated — 1 outstanding` was three facts, and
each now has a slot: `blocked · 2 left` is the verdict with the wave's own
count in slot 5, `— blocked by Relocated` is a **reference beside the
name**, and the count moved to the **Relocated** row, which is the wave it
counts. A wave holding three others back used to print that count three
times, each time describing a row the reader had to find by name.

The reference took three placements to land, each rendered before the next
was tried. Slot 4 as a link put a pointer **up** among links pointing
**down**, in a column headed `Related` whose every other kind reads one
direction. Beside the name it was worse than crowded: `Relocated` rendered
as `R…` and `Moved` as `M` — the blocker text won the width fight against
the name, so the row lost the one thing it exists to say. It is now an
**info mark beside the status**, with the wave in the tooltip and in the
accessible label: `blocked` is what a reader scans down the column, and
*which wave* is a follow-up about one row.

**What a container states, its children do not repeat.** A row inside a
wave's fold showed `open`, its own age, a link to the plan two rows up, and
`blocked by Relocated — 1 outstanding` — four facts already on screen
above it, all four now suppressed. The status one is worth naming: a first
attempt suppressed only `state === 'open'`, and counted over the estate
that guard **never fires** — a child row renders only inside a multi-branch
unfinished wave, there is exactly one, and all five of its branches are
`wip`. A rule beat the exception list. (The branch state says nothing about
startability anyway: inside `blocked` waves its branches are `open` × 9 and
`wip` × 5; inside `eligible` waves, `open` × 8 and `wip` × 3.)

A **deferred** branch is not a wave's unbegun work and keeps its own row
beside the waves — `isUnbegun` already drew that line, and a wave row shows
the wave's verdict and clock, so a deferred branch folded into one would
lose the PR and age that appear nowhere else.

**Counted in waves, not in rows.** `waveSummaryFor` printed
`${rows.length} wave(s)` — the unit name was right and the number was of
something else, so this estate's five-branch wave would have reported
`5 waves` for a plan whose file lists one. `showsWaveFold` had the same
defect: a fold promising five and revealing one.

Measured over `last-pulse.json` — 35 plans, 71 waves — to decide whether a
wave row replaces its branches or sits above them: 57 waves hold one
branch, 14 hold more, and of those 14 **thirteen are `complete` and one is
`blocked`**. All 11 `eligible` waves hold exactly one. So one row is the
common case and the fold is the exception; a wave holding several gets its
own disclosure, and its branches indent beneath it.

Also: the link prefixes in slot 4 (`PLAN`, `BRANCH`, `PR`) are now the same
Octicons that name those kinds in slot 1 — one vocabulary read in two
columns instead of a word and a glyph for one fact. Slot 2 keeps the row's
own kind as a **word**, so a row is never iconography alone.

Two fixture defects surfaced and are fixed: the mock carried four
`kind: 'plan'` rows, a kind `rowKind` never returns and no pulse has ever
emitted — it read correctly only while a not-started row stood for its
plan. And six of the estate's 71 waves have no name, so a nameless wave
renders `(unnamed)` as text rather than failing: the board is not where a
plan-authoring convention is enforced.

## Two projections had no caller, and three kinds read wrong because of it

`tupleFromBuild` and `tupleFromAgent` were written, tested, and **called by
nothing** — a build row and an agent row arrive from the server as
`AgentRow`s, so both fell through `tupleFromRow`'s branch fallback. Their
branch became the subject and the row's real subject had nowhere to go.

Measured on the mock:

| kind | was | now |
|---|---|---|
| Build | `feature/a-build-is-running` · *a sentence* · `CI running 283` | `CI 283` · PR + branch · `CI running` · `10m` |
| Agent | `feature/an-agent-is-working` · `open` | branch · plan · **`working`** |
| Release | `240` · branch · `no checks 240` | `240` · branch · `no checks` |

`open` on an agent row was the **branch's** state, on a row about the agent
that took it. Every worker exits 0, so `worker` is the only field that can
say what an agent is doing — `working`, `waiting on you`, `stalled` — and it
falls back to the branch state only for `none`/`elsewhere`, where this
machine has nothing to report.

**The PR number is out of the status column on every kind.** It rendered
there as a badge, under a comment arguing correctly that *"the PR is a
second destination worth reaching rather than a fact to read"* — which is
the definition of an artifact link, and slot 4 is where those go. `no checks
240` and `CI running 283` were the cost of having it in the one slot whose
whole purpose is a single scannable word. `PrGlyph` went with it:
`TupleLinkView` draws the mark from `KIND_ICON_PATH.pr`, so the shape has
one definition rather than two.

A build's name **should** link to the pipeline run and cannot yet: no run or
checks URL is on the wire. It renders as text rather than a guessed
`<repo>/pull/<n>/checks`, by the rule `CardPrSchema` states for the same
reason — *"the same arithmetic produces a confidently wrong link for GitHub
Enterprise or a self-hosted Bitbucket."* Finishing it needs a `checksUrl`
from the host adapter on the server.

The blocked-wave reference is a real **hover overlay** with the wave as a
control, not a `title`: a native tooltip renders plain text, waits a second,
and cannot hold a link. Clicking the name scrolls to the blocking wave's row
and flashes it — the row is always a sibling in the same list, so this needs
none of the cross-section reveal machinery. It opens on hover *and* focus,
because a hover-only disclosure holding a control is a control nobody can
tab to.

## A plan awaiting approval is a plan, not a PR

`rowKind` gained one arm: an `idea/` branch with a PR is a **`plan`**.
Technically it is a pull request — which is exactly why the mark is needed,
since without it a plan awaiting APPROVAL renders as one more open PR
awaiting review, and the two ask for different acts. Merging it is
`plot-approve.sh`'s job, which takes a plan and no branch.

**The branch name decides, not the draft flag.** `rowKind` never receives
`draft` at all, which is the strongest form of that independence — a plan
PR marked ready for review is still a plan. The mock carries one of each so
the independence is visible rather than asserted. The detection is a
convention Plot itself writes (`/plot-idea` names the branch after the
plan's slug), the same argument the row-building site already makes when it
recovers the slug from that name.

`tupleFromRow` gained the matching arm: the plan is the subject, its PR and
branch are the artifacts — a PR row's split with the roles exchanged.

## Three more rows, three more artifacts on the wire and unrendered

**`fleet.agents` had no consumer.** The scan collected the registry, the
contract carried it, and the client's only mention was a comment — so an
agent row had no session id, no worktree and no command, and named its
branch instead. It now joins on branch: the name is the session id and
**opens the agent panel** (a `<button>`, since the destination is a local
overlay and not a URL), and the artifacts are wave, branch, worktree, plan.

**A PR carries its wave** where its branch belongs to one — `row.wave`, on
the row all along. Ordered plan → wave → branch, the chain narrowing. Not
every PR has one: planless PRs (`changeset-release/*`, `idea/*`) reach the
board through a loop that sets `wave: ''`, so the mock holds both.

The wave BADGE now renders only where the row does not already link its
wave — measured as `Inverted` twice on the agent row and `Modelled` twice on
PR 304. It stays on a branch row, whose artifact slot holds plan and PR but
not wave, so there it is the wave's only statement.

## Two fixes reported from screenshots

**The ticket kind said `Story`.** A story is a Plot artefact — an umbrella
over several plans in `docs/stories` — and this row is a host issue no plan
references. Two different things, one labelled with the other's name.

**The inferred plan name was in slot 5**, crushing the ticket's status to
`o…` and reading as though `fleet-scan-asks…` were its condition. It is a
proposal, not a status; this component's own docstring sketch had always put
it in the plan column and the collapse moved it without following the
sketch. Slot 4 now holds it.

**Marks aligned to the row's centre, not its first line.** With
`self-stretch` the cell is as tall as the row, so `justify-center` floats the
mark to the middle of a row that WRAPPED — measured, an agent row at 56px
with its dot at y=24 while the name sat at y=9. `justify-start` puts it at
y=11. Two unit tests asserted `justify-center` while their own TITLES said
*first line*: the two agreed only while rows were one line tall, and the
titles were right.

**The mock served no cards**, so every card-gated control was invisible —
`Start work`, `Approve`, `Commission design`, and the plan row's whole `⋯`
menu (`[data-plan-actions]` count: 0). An absent control looks exactly like
a control the code fails to render, which is the same class of defect as the
four `kind: 'plan'` rows this fixture used to carry.

**`Start work` went missing with the branch rows** it hung off. It is on the
ELIGIBLE wave row now: the plan warned that a dispatch control would *"have
to guess which of the plan's waves it meant"*, and one level down there is
nothing to guess — `StartWorkButton` takes a `Card` and a dispatch binding,
never a branch. A blocked wave offers no control at all rather than a
disabled one.

**An eligible wave's note reads `you`, not `click`** — the amber *this needs
a decision* tone. `waitingTone` gives `click` the ordinary colour on the
argument that the section would *"shout twice and mean once"*, which holds
where every row waits on a click; here three verdicts sit side by side and
one of them can be started.

## A release names its version, read from the branch

`RELEASE 240` named its **PR**. `releaseVersion` tested whether the plan slug
looked like a version, which is true for no row this board has ever rendered
— changesets names its branch `changeset-release/<base>`, so the slug carries
the base and the PR-number fallback fired every time.

The version is a **fact on the branch**: changesets consumes the
`.changeset/*.md` files and writes the bumped version into `package.json`
there. Verified — `origin/changeset-release/main:package.json` reads `2.7.0`
where `main` reads `2.6.0`. So the server reads it (`releaseVersions`, one
`git show` per release branch, "" on anything unreadable) and carries it as
`AgentRow.version`.

The refusal that shaped the old behaviour stands and is worth keeping
straight: *deriving* the version by summing pending changeset bumps is *what
would this ship*, a question the board must not answer. Reading a file the
release tool wrote is not deriving a decision.

## Status colours came back

`conflicts`, `green` and `no checks` all rendered the identical grey —
reported from a screenshot, and a regression from
`one-component-renders-every-row`, which replaced three row components with
one grid and kept the WORDS while dropping the tones. The palette is the
deleted `PrCell`'s verbatim, and so is its rule: **the state is a word and
colour only reinforces it**, for the two values a reader acts on.

Keyed on the status WORD rather than on `pr.state`, because slot 5 holds one
string whatever the kind: a wave's `blocked`, a worker's `failed` and a PR's
`conflicts` are all *something is wrong here*. `blocked` is deliberately not
coloured — an earlier wave holding this one back is the system working.

## Plan grouping is off in WAITING ON YOU

`showPlanHeading` measures the right thing — two rows under one plan, so the
name prints once instead of twice — and it is wrong for this section. Its
rows are a mixed bag (a PR, a plan under review, a release, a ticket), so
grouping two of them by a shared plan says *these belong together* about rows
whose only relation is a name they each already print in slot 4. The heading
saved no repetition.

The other sections keep it, and where it renders its rows are now **indented**
with a left rule: measured, a headed group's rows sat at the same x as the
ungrouped ones beside them, so the heading read as no group at all. *Grouping
means indented* — the same `ml-6` the wave list carries. On the wrapper rather
than the group box, which keeps the cross-section column alignment the
outline's own comment protects.

## What a PR with a wave is NOT

A PR whose branch belongs to a wave **has** a wave; it is not one. Measured:
39 branches sit in multi-branch waves, so the estate's five-branch
`Implementation` wave would render five rows all named `Implementation`, each
claiming to be the same wave with a different CI status — the conflation this
whole wave removed, reversed. A wave's status is `eligible|blocked|complete`,
computed by the scan from ordering; a PR's is `green|conflicts|failing`,
reported by the host from CI. And you merge a PR, while a wave completes when
its last branch lands.

Also: the ticket's inferred plan name renders through `TupleLinkView`, so it
wears the plan glyph like every other named thing in slot 4 — it was the one
name in the column with no icon. And the fold caret is centred against the
kind label: measured 3px low, because its 24px hit area (a WCAG 2.2 minimum,
not up for negotiation) sits against a 14px label, so the box keeps its size
and moves up by half the difference.

<!--
bumps:
  skills:
    plot: patch
-->

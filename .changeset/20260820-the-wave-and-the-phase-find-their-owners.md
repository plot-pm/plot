---
"@plot-pm/board": minor
---

board: the wave and the phase find their owners

The row's second column read a **wave name**, a **plan phase**, **nothing**, or
**a plan phase on a ticket** — four meanings in one unlabelled cell, and which
one arrived depended on how many waves the row's plan had. A reader cannot see a
plan's wave count, so the cell could not be read at all without knowing
something the board never printed.

`a-row-is-a-tuple` (#293) landed the shape that ends this: slot 2 holds the
**kind**, always the same sort of word. This is the wave that empties the cell
first, so no pulse renders a row that has lost a fact and not yet gained its
replacement.

**Both occupants moved to the objects they describe.** The plan phase to the
plan heading, where `PlanRow` already states it once per group — 71 branch rows
printed their plan's word (36 `Development`, 26 `Endgame`, 9 `Design`), a fact
about the plan on a row about a branch. The wave beside the **branch name**,
extending `a-branch-row-names-its-wave` (#275): it names a slice of the plan
that THIS branch belongs to, so it belongs next to the branch, where the
association is positional and needs no rule.

**The wave's gate is now a property of the row, not of the fleet.** It was
`waveCount > 1`, computed across every row of the pulse — defended, correctly
for where the label then sat, as *a caption over a partition of one is noise*:
the wave shared a cell with the plan phase, so an uninformative wave name
displaced a different fact. Beside the branch name it displaces nothing, so the
count has nothing left to arbitrate, and a branch of a plan divided once now
names its wave instead of showing nothing. What survives of the old gate is the
half that was never about counting: `(unnamed)` is not a name, and a
parenthesised non-answer beside a branch name is worse than blank.

`waveCountByPlan` went with it. It existed to feed that gate and had no other
reader — the plan row's summary counts the waves in its own group — and an
exported pure function with only a test to call it is dead code wearing a
contract. Its assertions are kept as assertions about `waveLabel`, because what
they were really pinning is which strings mean *no wave to name*.

**A property the count made impossible now holds.** The label was a function of
the fleet, so the same branch could name its wave in one render and not the next
as sibling rows appeared and vanished between polls. It is a function of the row,
and the same row always answers the same way.

**A ticket is no longer labelled `Discovery`.** That is a plan phase on a thing
that is not a plan and has never entered the lifecycle the word comes from — the
fourth of the column's four meanings, and the one where the mismatch is total.
It was defended as *not a fifth phase; the first one, worn by something that is
not a plan yet*, which is coherent and still borrows another object's vocabulary.
Worse, the sentence that explained it was a **tooltip** — hover-only text doing a
label's job. The word `Story` says in the cell what the tooltip was explaining.

**No tooltip is the only place a kind is stated.** The old cell carried
`title={waveName ? "Wave: …" : "Phase: …"}`, which was the sole place it said
which of its four facts it held; a single-meaning cell has nothing to
disambiguate, so the attribute is **gone rather than reworded**, and a test
asserts its absence. The `columnheader` reads `Kind` where it read `Phase`, and
the `sr-only` prefix returns below `sm` — where there is no header to name the
column — and only there.

**The deferred exception is gone, and what it protected is stronger.** A
deferred branch was the one row allowed to keep its phase inside a plan group,
because *bare `Design` is indistinguishable from a branch nobody ever started*.
Re-read what that test also asserted — `not.toContain('Development')`: what it
cared about is that the row must not read as actively worked on. The fact that
discriminates *handed back* from *never started* is the **badge**, which stays
and still carries its reason in its title. With no branch row printing a plan
phase, that property holds for every row rather than being arranged per row.

**The relocation is not a wide-viewport rule.** The card form below `sm` drops
the phase too — it is where a relocation is most tempting to skip, because the
row is already a stack of everything and one more word looks free, and it is
exactly where the reader has the least room for a fact about another object.

**The grid did not move.** The wave badge went into the branch cell — the `1fr`
track — rather than earning a track of its own, which is the obvious
implementation and the one that re-opens the defect: an eighth track crosses the
`CARD_BELOW_PX` arithmetic `ROW_TRACKS` records having already crossed once by
8 px. A test pins seven tracks and asserts a row with a badge and a row without
start their branch cell at the same x.

**One robustness defect found while testing, and it was not hypothetical.**
`RowKindSchema` declares `.default('branch')`, but that default is applied by Zod
*on parse* — and the client does not parse, it casts (`(await res.json()) as
Fleet`). So a payload with no `kind` arrives as `undefined` with TypeScript none
the wiser, `data-kind={undefined}` omits the attribute entirely, and the cell
renders blank on every row. An older server on the other end of a poll is the
case the board already handles for `prNextInSeconds`. `rowKindOf` restates the
schema's default at the render site; it reads no other field, so it cannot
reclassify a row the server did label.

The geometry constant `PHASE_CELL` was renamed `KIND_CELL` with the column's
meaning. Its own comment warned that a stale `nth()` would keep **passing** while
measuring a different column — the quietest way for a geometry test to stop
meaning what it says — and a name that no longer matches its cell is that
staleness made invisible.

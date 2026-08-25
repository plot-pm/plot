# A count answers to the section beneath it

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-25, Jan Wloka, `bug/a-section-counts-what-it-shows`
- **Started:** 2026-08-25, Jan Wloka, `bug/a-filtered-section-says-what-it-hid`

## Changelog

Every count the board renders beside a section is derivable from that
section's rows, and a section that hides rows says how many. A control and the
section under it cannot disagree about the same fleet.

## Motivation

### The measurement, and the half that #403 fixed

The first report was `WORKING · 2 working` beside a section reading `none`.
`the-working-section-shows-every-worker` wave *Counted* (#403) answers that
half, and answers it better than either draft of this plan did: it makes
`working` **`entry.agents.length`** — literally the size of the set WORKING
renders — and relabels the stepper `parallel agents (cap)`. `liveAgentCount`
stops being called for the DISPLAY number and keeps feeding the dispatcher
(`auto-dispatch.ts:368`), so the objection this plan raised — a cap that moves
when a reader toggles a control — does not arise. That half is settled.

**The other half is not, and it is the larger one.** Measured from
`/api/fleet` with `Sprint only` ON, 2026-08-25:

| section | header says | rows the reader sees |
|---|---|---|
| DONE | **19** | **10** |
| WAITING ON YOU | 11 | 7 |
| NOT STARTED | 3 | 1 |
| QUIET | 0 | 0 |

Both numbers are correct and both are derivable. They count different things:
`countOf = rows.length` (`AgentList.tsx:636`) counts **branch and wave rows**,
while a plan-grouped section renders **plan heads**, each folded with its own
wave count in parentheses — `(2)`, `(3)`, `(5)`. Adding the parentheses up
reaches 19.

So a reader looking at `DONE (19)` above ten rows cannot reconcile the two
without expanding every head and doing the arithmetic. That is the same
complaint as `2 working / none`, in the section where it is largest.

QUIET agreeing at `0/0` is not a counter-example — it is the degenerate case,
and it is why the fix must not simply swap one unit for the other.

### The rule this is an instance of

**Any count the board renders beside a section must be derivable from that
section's rows, or must say what else it counts.**

No test asserts this today, which is why seven of this sprint's defects arrived
as screenshots rather than CI failures. The rule is checkable and general; the
`2 working / none` pair is just where it first became visible.

## Design

### The header names both units where they differ

`DONE (13 plans · 33 waves)` — the first matches what a reader can count, the
second is the scope the bare `33` was reaching for. Where the two agree, one
number only: `QUIET (0)`, never `QUIET (0 plans · 0 waves)`.

Re-measured 2026-08-25, after the day's merges: DONE **33 against 13**, WAITING
ON YOU 10 against 6, NOT STARTED 3 against 1. The gap widened as work landed —
19 against 10 when this plan was written — which argues for fixing the rule
rather than the number.

### The header counts what the section renders

A grouped section renders plan heads; its header counts plan heads. An
ungrouped one renders rows; its header counts rows. One rule, applied to
whichever unit the section actually shows — so the number is always the count
of the things beneath it.

### The total is not lost

`DONE (10 plans · 19 waves)` keeps both facts and says which is which. The
plan count matches what the reader can see; the wave count is the scope that
`19` was reaching for. A section whose two numbers are equal — an ungrouped
one — renders the single number, so nothing gains a redundant clause.

### Not chosen: count rows and expand every head

Making the number true by rendering 19 rows defeats the grouping, which exists
because DONE is the section that grows fastest over a working day.

### Not chosen: leave it and document the unit

A tooltip explaining that the number counts waves while the rows are plans is
a workaround for a number that is simply reporting the wrong unit.

## Waves

### Counted (Branch: bug/a-section-counts-what-it-shows, PR: #414)

A section's header counts the unit the section renders — plan heads where it
groups, rows where it does not — and names both where they differ.

### Withheld (Branch: bug/a-filtered-section-says-what-it-hid, PR: #417)

Each filtered section reports how many rows the filter withheld, so `none` is
never the whole answer when rows exist.

## Done when

1. Every section's header number equals the count of the things rendered
   directly beneath it. Asserted per section, with plan-grouping ON and OFF —
   a fix that only works grouped leaves the ungrouped sections wrong.
2. Where a grouped section's plan count and wave count differ, the header
   states both and says which is which.
3. **QUIET at `0/0` still renders one number.** This is the assertion a naive
   implementation fails: a section whose two counts agree must not grow a
   redundant clause, and QUIET is where that first shows.
4. `working` is left as #403 made it — `agents.length`, with the stepper
   labelled as the cap. A test pins that `liveAgentCount` still feeds
   `auto-dispatch.ts` and is NOT what the control renders.
5. A filtered section says how many rows it withheld **in its heading**,
   whether or not the section is empty — a section showing 13 of 46 looks
   complete, which is the harder case to notice. A genuinely empty one still
   says `none`, and the two stay distinguishable, so printing `0 hidden` on an
   unfiltered section fails.
6. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by looking, not by testing

Reported from a screenshot of the running board, like the seven defects before
it in this sprint. The filter's own tests pass: they assert that membership
decides which rows show, and it does. No test compares a control's number
against the section under it, which is the whole defect.

That comparison is worth having as a rule rather than a case: **any count the
board renders beside a section must be derivable from that section's rows.**

### It appeared because the fix worked

Worth recording plainly. The old filter (`r.sprint === '' || sprintFilter.has(
r.sprint)`) admitted 53 plan rows it should have excluded, so `Sprint only`
barely narrowed anything and the counter agreed with the section by accident.
Wave **Joined** made the join exact; the accident stopped, and the disagreement
surfaced. A fix that reveals a second defect has not caused it.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "DONE reads 33 over 13 visible rows \u2014 both true (33 waves in 13 plans). Which belongs in the bracket?",
      "a": "Both, named: `DONE (13 plans \u00b7 33 waves)`. Where they agree \u2014 ungrouped or empty \u2014 one number only, so QUIET stays `(0)`",
      "category": "ux"
    },
    {
      "q": "Where does the hidden-row count go?",
      "a": "Beside the section's own number in the heading, and not only where the section is empty: a section showing 13 of 46 looks complete, which is the harder case to notice",
      "category": "ux"
    },
    {
      "q": "The plan belongs to no sprint \u2014 what becomes of it?",
      "a": "Into the sprint as a Could: same class of defect as the sprint goal, and a Could neither blocks a release nor prompts about one",
      "category": "domain"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": false
    },
    "domain": true,
    "ux": {
      "happyPath": true,
      "edgeCases": true,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": false,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

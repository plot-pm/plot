# A startable wave says so

> `statusTone` colours the values a reader **acts on** — `green` and `delivered`
> in emerald, `conflicts` and `failed` in rose. A wave that can be started now
> reads `eligible` in the ordinary grey, and starting it is the most actionable
> thing on the board.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** working-shows-the-agent
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `bug/an-eligible-wave-takes-the-actionable-tone`
- **Delivered:** 2026-08-23

## Approval

- **Assignee:** Jan Wloka

## Changelog

- A wave that can be started now says so in colour: `eligible` takes the same
  emerald tone as `green`, because both are states a reader acts on.

<!-- Board impact: one function, `statusTone` in `tuple-row.ts`, plus its
     tests. No contract change, no server change — `verdict` is on the wire and
     already renders as the word. -->

## Motivation

**The rule is already written, and `eligible` is on the wrong side of it.**
`statusTone` colours two groups and says why:

    rose      conflicts | checks failing | failed | stalled     — bad news
    emerald   green | delivered | finished                      — good news
    (none)    everything else

Its docstring states the principle: *"the state is a WORD and colour only
reinforces it, **for the two values a reader acts on**. Everything else keeps
the ordinary tone — a third and fourth colour would make the column a legend to
learn rather than a word to read."*

So the test is not *is this good or bad* but *does the reader act on it*.
`green` earns emerald because a green PR is one you merge. **An eligible wave is
one you start** — the same shape of prompt, and the one the whole NOT STARTED
section exists to surface.

Measured on the live board 2026-08-22, NOT STARTED held 16 rows:

    eligible   6
    blocked    7
    complete   3

Six startable waves, every one in the same grey as the seven a reader can do
nothing about.

**`blocked` stays uncoloured, deliberately**, and the same docstring says why:
*"`blocked` is deliberately NOT here — an earlier wave holding this one back is
the system working, not a fault, and its note already carries the dimmed `time`
tone."* This plan does not revisit that.

## Design

### One word joins the emerald branch

`statusTone` is keyed on the **word**, not on a kind's field, and the reason is
recorded at its definition: *"slot 5 holds one string whatever the kind: a
wave's `blocked`, a worker's `failed` and a PR's `conflicts` are all something
is wrong here, and a reader scanning the column should see one vocabulary."*

`eligible` joins `green | delivered | finished` for exactly that reason — a PR
you can merge and a wave you can start are the same prompt in one column.

**Still two colours, not three.** The palette does not grow; a word moves into a
group that exists. The docstring's objection — *a third and fourth colour would
make the column a legend to learn* — is unaffected.

**Colour still only reinforces.** `eligible` is already the word in slot 5 and
stays it. Nothing here is expressible by colour alone, which is the rule the
contract states for the reason it states: *"roughly one man in twelve
distinguishes red from green poorly, and the same page shows up in greyscale
screenshots."*

**`complete` is left alone.** It is arguably finished-like, but a complete wave
prompts nothing: its branches have landed and its plan moves on. Colouring it
would put emerald on rows a reader scrolls past, which is the dilution the
two-value rule guards against.

### Open Questions

- [ ] Does the plan-head aggregate need the same treatment? `planPrAggregate`
      folds branch PR states onto a folded plan row; a plan whose waves are
      eligible has no equivalent fold today. Probably a separate finding.

## Waves


### Toned (Branch: bug/an-eligible-wave-takes-the-actionable-tone, PR: #343)
- `eligible` joins the
  emerald branch of `statusTone`. Tests: `statusTone('eligible')` returns the
  emerald class, the same one `green` returns; `blocked` still returns `''`;
  `complete` still returns `''`; the rose group is unchanged; a wave row
  rendering `eligible` carries the tone in the DOM, and the WORD is unchanged —
  colour reinforces it rather than replacing it.

## Notes

Raised 2026-08-22 while asking whether NOT STARTED should colour its wave
states. The first answer given was to tone `blocked` and leave `eligible`
plain — corrected by the operator: *"isn't that the other way around, like with
PRs? eligible is the interesting one because users could act and start the
work."*

The correction is right and the code proves it: `green` already takes a colour,
so the rule was never *colour the problem* — it is *colour what a reader acts
on*. Reading `statusTone`'s own docstring settled it in one line.

This finding would have belonged to `the-row-is-legible`, which gathered the
legibility findings for exactly this kind of change. That plan was superseded
the same day — every one of its waves had already been delivered by other work —
so this arrives on its own rather than reopening a finished plan.

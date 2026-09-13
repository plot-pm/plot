# A claimed slice does not say nobody took it

> The row says *approved — nobody has taken it* while an agent is visibly working on it, because the sentence reads the wave's verdict and not the row's own startability.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-13, jwloka, in-session
- **Started:** 2026-09-13, jwloka, `bug/a-claimed-slice-does-not-say-nobody-took-it`
- **Delivered:** 2026-09-13

## Changelog

- A slice somebody is already working on no longer reads *approved — nobody has taken it*. The sentence follows the row's own startability, which already knows a claim was made.

<!-- Board impact: this IS the board. rows.tsx wording only; rebuild the artifact. -->

## Motivation

**Reported by the operator from their own board, 2026-09-13.** The slice `a-harness-this-machine-cannot-run-refuses` appeared in WORKING with its agent, its desk and its branch — and the same line ended *"eligible — nobody has taken it"*. The same slice appeared again under NOT STARTED saying *"approved — nobody has taken it"*.

**The payload contradicts itself, so this is not a stale page.** Asked directly while the agent was running:

```
row  kind=wave  verdict=eligible  startability=someone-is-on-it
AGENT branch=bug/a-harness-…  state=running
```

**`startability` is right and the sentence does not read it.** `row-identity.ts:98` documents the value as *"`someone-is-on-it` — `wip` or `claimed` — not yours to start"*. The wording at `rows.tsx:1069` instead branches on `group.verdict === 'eligible'`, which answers a different question: whether the slice's prerequisites are met, not whether somebody is already on it. A claimed slice is still eligible in that sense, so the two disagree by construction rather than by timing.

**It tells the reader to act on work already in flight.** That is the same defect `a-slice-shows-that-its-brief-was-asked-for` fixed one state over, and the argument transfers exactly: `row-identity.ts:153` — *"an operator told `nobody has taken it` runs `/plot-dispatch`"*. Here that command would refuse, or worse, race a live agent.

## Design

### Approach

The sentence reads `startability` first and falls back to the wave verdict only where startability does not apply.

`someone-is-on-it` gets its own wording — *somebody is on it* — which is what the value already means. `eligible` keeps today's sentence word for word, because a genuinely unclaimed slice is the case that phrase was written for and it is correct there.

### The wave verdict is not wrong, it is answering something else

`verdict: 'eligible'` means *every prior slice has landed, so this one may be started*. That stays true after a claim; the claim does not un-satisfy a prerequisite. So this is not a staleness bug to be fixed by recomputing the verdict — the verdict is right, and the sentence is reading the wrong field.

Changing the verdict to follow claims would be the worse repair: `--next` and the dispatcher both read it as eligibility, and a claimed slice that reported itself ineligible would change what the fleet starts.

### Both places, or the contradiction moves

The phrase renders twice — inside the WORKING row and again in NOT STARTED. Fixing one leaves the two sections disagreeing, which is how the operator noticed it. The fix is in the shared wording helper, and the test asserts a claimed slice says the same thing in both.

### Open Questions

- [ ] Should a claimed slice appear under NOT STARTED at all? It is arguably a section-membership question rather than a wording one. Out of scope here: this plan makes the sentence true wherever the row renders, and moving rows between sections is a separate argument with its own risk.

## Slices

### A claimed slice does not say nobody took it (Branch: bug/a-claimed-slice-does-not-say-nobody-took-it, PR: #907)

The wording change in `rows.tsx`, reading `startability` before the wave verdict, plus a fixture where a row carries `startability: 'someone-is-on-it'` with `verdict: 'eligible'` — the combination measured today — asserting both render sites agree.

## Notes

Found by the operator watching an agent work on the very slice that closes the story's last Definition-of-Done criterion. The board reported *nobody has taken it* about work it was simultaneously showing in progress.

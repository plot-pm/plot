---
"@plot-pm/board": patch
---

board: the agent panel's COMMAND field has a size — three lines, then a scroller

The COMMAND field expanded, which is the half that worked. Neither of its
states had a **size**, and that is one mistake measured in two opposite
directions.

Collapsed it was one truncated line, and the clip landed inside
`Read .plot/brief…` — **before the brief's path**, which is the first thing a
reader opening this panel wants. Expanded it was `whitespace-pre-wrap
break-all` with no bound: fifteen unbroken lines, with words split at the
character rather than the space — `im`/`mediately`, `5`/`03`. Below it the log
pane was squeezed to a strip, the panel's other half pushed out by the half
that expanded.

| State | Was | Is |
|---|---|---|
| collapsed | 1 line, clipped mid-path | **3 lines**, wrapped at word boundaries |
| expanded | all 15 lines, unbounded | **bounded**, and scrolls |

**Three, not one and not five.** Three reaches past `Read .plot/briefs/…` to
the first full instruction, which is where a reader stops needing more. Five
would take half the frame, and a fact that takes half the frame is not a fact
any more — the log below is the other half of this panel.

**Bounded when expanded, for the same reason from the other side.** The modal
is a fixed-height column: the facts block is `shrink-0` and the log is
`flex-1`, so every line this field grows is a line taken from the log.
Measured against the unfixed build, expanding dropped the log pane from 207px
to 105px. `max-h` with its own scroller returns that space, so the log keeps
its pane in both states.

**`break-words`, not `break-all`.** `break-all` exists for strings with no
spaces; this command has spaces throughout, and breaking inside them made
readable text unreadable. Its one genuinely unbreakable token — the
shell-interpolated brief path — is short enough to wrap whole.

**Copy still yields the original string, in both states.** That was the
previous wave's contract, and a bounded render is exactly the case where it
must hold. It holds structurally rather than by a second code path: the bound
is applied to the BOX, so the complete command stays in the DOM either way and
can be selected by hand as well as copied.

Tests: `command-fact.test.ts` keeps pinning the lossless collapse without a
page. `command-copy.browser.test.ts` now MEASURES the sizes against the
shipped artifact — three painted lines collapsed, a scroller rather than growth
when expanded, the log pane's height in both states, and `word-break` that is
not `break-all`. Heights are read off the rendered boxes rather than counted in
the string, because a clamp is a paint-time bound and the full text stays in
the DOM underneath it by design; `innerText` would report every wrapped line
and never see the clamp at all. Verified against the unfixed build: exactly
those four assertions fail there, and the content and Copy assertions — which
were never broken — still pass.

---
"@plot-pm/board": minor
---

The activity mark becomes a glowing bar down the row's left edge — prominent enough to spot from across the board, and **static**.

**The wave before this one made the mark honest; this one makes it loud.** `isActive` reads `localLocked || localDirty`, so there is finally something true to make prominent — and the order was paid for: a glow over `group === 'working'` would have been *a livelier lie*, which is why the quiet rendering shipped first.

**It does not animate, and that reverses two-thirds of what was asked for.** The report asked for *pulsing, left-right movement, and a glow*; only the glow is adopted. The plan settled this when two elements on a row animated. Measured on `main` before this branch, there are now **four** — so the argument is stronger rather than weaker:

| Selector | Animation | Means | Lifetime |
|---|---|---|---|
| `[data-live-dot]` | `animate-pulse` | in the WORKING group | hours |
| `[data-change-mark]` | `animate-pulse` | a PR state just changed | ~3 s |
| `[data-stuck-cue]` | `animate-ping` | an unanswered request | until acted on |
| *(the change-mark's dark variant)* | | | |

A fifth at a fifth scale competes rather than adds. The ordering principle that settles it: **a fact true for hours has less claim on motion than a fact true for three seconds.** Motion is the scarce channel and the transient marks hold it. Activity is persistent by nature — someone is writing, and will be for a while — so it takes **presence**, with its appearance and disappearance carrying the change. The travelling motion is refused for a second reason of its own: motion that traverses implies a destination, and this has none.

**A bar rather than a bigger dot**, because the reported problem is spotting it *from a distance*: a vertical stroke at a fixed x reads as a mark down the side of the list, where a dot must be hunted among the row's words. `h-3 w-0.5` becomes `h-5 w-1` — a stroke spanning nearly the row's full height rather than a tick beside it. It also scales to the group heading a later wave adds: a heading can carry the same stroke, where a dot would read as a bullet.

**The glow is what carries the prominence the motion was asked to carry**, and it is an explicit emerald `shadow-[…]` rather than a step on the neutral shadow scale — those are greys for lifting a surface off the page, and a grey blur around a 4 px bar reads as a smudge rather than a light.

**`motion-reduce` leaves the mark and its glow completely unchanged**, because nothing here animates. The repo's rule — *keep the mark, stop the movement* — has no movement to stop, and what it must not do is strip the glow: the glow is the channel that will separate this mark from the unpushed mark a later wave adds (*glow means someone is here*). A reduced-motion rule that removed it would take that distinction with it before it is built.

**It keeps its left-padding home**, hanging beside `LiveDot` via `sm:absolute`, deliberately outside the six grid tracks so the columns do not move in from the edge on every row in the fleet to reserve room for a mark most rows never carry. Asserted in pixels: a row without the mark renders its columns at the same x as one with it.

**`aria-hidden`, and the `title` keeps its limit.** Every signal behind the mark is local — `fleet.ts` is explicit that these are *"true only on the machine doing the looking"* — so an agent on another machine produces no mark here, ever, and that absence means **not visible from here**, never *not happening*. The mark goes on saying *A write is in progress in this checkout* rather than letting absence speak for itself.

**`isActive`, the lock echo, and the contract are untouched**, as are `[data-live-dot]`, `[data-change-mark]` and `[data-stuck-cue]`: four marks, four meanings, and no mark implemented by modifying another.

The claims are pinned in two places, split by what each can actually answer. The class list — no `animate-*`, no `motion-reduce:` variant, an emerald `shadow-[…]`, a bar rather than a dot — is read out of the source in `test/unit/agent-list.test.ts`. What only a page can state moves to a new `test/integration/activity-mark.browser.test.ts`: that the glow is a *computed* `box-shadow` and not a class Tailwind never emitted, that reduced motion renders the mark byte-identically, and that the six tracks do not move.

Two of those assertions were written weaker first and strengthened by mutating the implementation to check they went red. `boxShadow !== 'none'` passes on a glow stripped by `motion-reduce:shadow-none`, because Tailwind v4 resolves that to five transparent shadow slots rather than to the literal string `none`; the assertion now names the emerald layers. And a source-reading helper that walked forward from `data-live-dot` landed in the wrong element's class list, because every mark names the other three in its doc comment — it now anchors on the JSX attribute.

<!--
bumps:
  skills: {}
-->

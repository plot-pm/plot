# Slicing lens — the board updates an index

Position: amend

## 1. The defect is real, and the diagnosis is sound

Verified. `App.tsx:283` is the only `setFleet` call site and it assigns the whole payload. The failure path (`App.tsx:292-317`) genuinely never calls `setFleet`, so the plan's correction of its own first reading holds: a successful partial response is what erases rows, and the banner only froze what was already gone. The server's `pulseComplete` (`fleet.ts:909`) exists for exactly this and is documented as such.

## 2. FALSE CLAIM: `complete` has a reader, and it is in the file slice 1 must edit

The plan states, in bold, at line 37:

> **It has zero readers in `packages/board/src/app/`.** The server states the answer is incomplete; the client renders it as whole.

`AgentList.tsx:2206` reads it:

```
{!fleet.complete && ' so far'} · scanned{' '}
```

with a 16-line comment above it (`AgentList.tsx:2195-2205`) explaining precisely the plan's own argument — that the count is of what arrived, that the 18 s scan against the cadence makes this window most of the time, and that *"the rows themselves are NOT qualified … Only the TOTAL is provisional, so only the total says so."*

This is not a pedantic correction. **That comment is a deliberate, argued decision that the rows are not qualified by `complete`, and this plan reverses it without knowing it exists.** The reversal may well be right — the comment's premise ("each row is exactly as true now as it will be") is about a row's *content*, not about a row's *absence*, and the plan's insight is that absence is the thing `complete` should have gated. But a plan that says "zero readers" will produce an implementer who adds a second, contradictory reading of `complete` three files away from the first, and leaves the comment standing. The plan must name `AgentList.tsx:2206`, state that the existing reading is correct and stays, and say that what it adds is a reading of absence rather than of the total.

## 3. Slices 1 and 2 cannot land independently — there is no context in this app

`grep -rn "createContext\|useContext" packages/board/src/app` returns **zero matches**. Every cross-component value is prop-threaded. `onStarting` is the precedent: 65 occurrences across 9 files (`App.tsx`, `AgentList.tsx`, `rows.tsx`, `menus.tsx`, `PlanCard.tsx`, `Board.tsx`, `Swimlanes.tsx`, plus two buttons).

So slice 2's "twelve POST sites write to the index" requires an index-write callback threaded from `App.tsx` (where the index lives, beside `setFleet`) down to each button. The chain is `App.tsx` → `AgentList.tsx` (2228 lines) → `rows.tsx` (2704) → `menus.tsx` (1850) → button. **Slice 1 must also edit `App.tsx` and `AgentList.tsx`** — that is where the index is created and where the rows are consumed.

The plan asserts the opposite at line 168: *"No action endpoint changes here, so the accumulation can be proved before anything writes to it."* True of the endpoints; false of the files. Both branches edit `App.tsx` and `AgentList.tsx`, the two highest-traffic files on this estate. Two agents dispatched at once conflict on both, and `AgentList.tsx` is 2228 lines of dense commentary where a conflict is expensive to resolve by hand.

**Amendment:** slice 1 must ship the write API — the index plus the callback threaded to the button call sites, unused. Slice 2 then edits only the twelve button files, and the two touch disjoint sets. That is a real slicing change, not a rewording: it moves the prop-threading (the bulk of the conflict surface) into slice 1.

## 4. FATAL to slice 2 as written: the actions do not know what the plan says they know

This is the finding that changes the verdict from "proceed with notes".

The plan's premise (line 80): *"A dispatch that returned 202 for a slug knows something no poll has yet observed; a deliver that succeeded knows the plan moved."*

**A deliver that returned 202 does not know the plan moved.** `approve.ts:199-206`:

> Handle `POST /api/approve`. Refuses, or spawns and answers 202 — **never both, and never a result.** … Detached and immediate … **The outcome therefore cannot ride on this response** — it is read back from `GET /api/approve/<slug>` once the command has finished.

`dispatch.ts:247` says the same. Every one of the nine server files (`approve`, `deliver`, `implement`, `reslice`, `commission`, `idea`, `dispatch`, `drop`, `continue`) contains a 202.

And the client bodies confirm it. Measured across all twelve sites, the success branch of every one is either empty or absent — the only field any of them destructures is the *refusal* text:

- `ApproveButton.tsx:191` — `as { error?: string }`
- `DeliverButton.tsx:173`, `ResliceButton.tsx:165`, `ImplementButton.tsx:160`, `CommissionDesignButton.tsx:164` — `as { error?: string; detail?: string }`
- `StartWorkButton.tsx:260` — `{ slug?, log?, error?, detail?, reason? }`, and `:282` says *"Nothing to store"*

The plan quotes that last line as evidence there is nowhere to store an outcome. **It is evidence there is no outcome.** The 202 body carries a log path and a slug echo. There is no row state in it, because the work has not happened yet.

So slice 2's `Done when` — *"A successful action writes its outcome to the index and the row moves without waiting for a poll"* — **cannot be satisfied by the twelve POST answers.** The one thing a 202 licenses is the plan's own weaker sentence at line 92: *"a 202 from `dispatch` says the dispatch was accepted, not that a worker is running."* The plan states the correct constraint and then writes a `Done when` that violates it. Under the constraint, an index entry from a dispatch 202 says "accepted" — which is exactly what the existing `starting` spinner already renders, so the slice buys nothing.

What *could* satisfy it is the readback route the plan never mentions: `GET /api/approve/<slug>` (`index.ts:575`) and `GET /api/deliver/<slug>` (`index.ts:662`) exist precisely to carry the outcome. Two of the ten endpoints have one. An index fed by readbacks is a real design; an index fed by 202s is not. **Slice 2 must be respecified around the readback routes, and must say what the eight endpoints without one do.**

`/api/registry` (FleetControls.tsx:57) is the single exception — it returns `Fleet['fleetControls']`, a real value. One of twelve.

## 5. Slice 3 is an escape hatch, and it is load-bearing for the design

Slice 3 is not an unspecified *detail* — it is the slice that carries the plan's central architectural claim. Lines 96-107 argue the index "is not a render cache" and must serve the scan, the reconcile sweep and the supervisor, and lines 109-129 spend twenty lines defending that against `fleet.ts:2173`'s *"A DERIVATION, NEVER A RECORD"*. All of that reasoning is about slice 3. Slices 1 and 2 are a render cache — `App.tsx` `useState`, in-memory, dead on reload (line 150 says so).

So the plan's answer to "is this the record the estate refused?" is: *not once slice 3 lands*. And slice 3 is the slice that is not specified, and is explicitly last.

That is dishonest scoping, not honest scoping. Honest scoping is "slices 1 and 2 are a client-side render index; whether it becomes a shared store is a separate plan." The plan instead takes credit for the shared-store design while deferring every hard question about it. Concretely: an agent dispatched onto `bug/the-index-serves-its-consumers` gets a brief whose specification is *"the shape is for whoever takes it"* — it will either stall, write `PLOT-BLOCKED`, or invent a persistence design across the scan, the reconcile sweep and the supervisor with no review. On this estate, where `plot-dispatch.sh` claims a branch by ref push within ~60 s of approval, that dispatch happens automatically.

**Amendment:** drop slice 3 from this plan and file it. The plan's motivation and the "not a render cache" section must then be rewritten to claim only what slices 1 and 2 deliver, or the plan is claiming a design it does not ship.

## 6. Two `Done when` items no test can assert; one miscount

- *"A held row is distinguishable from a freshly measured one, by its own age."* — Assertable only if the plan says **where** the distinction renders. `AgentList.tsx:2206` currently renders one fleet-level age. Nothing says whether a held row gets a per-row age cell, a title attribute, or a badge, so no test can be written from this line and no two implementers write the same thing.
- *"A refused action writes nothing to the index."* — Assertable, but only against an index that has a write path. It is slice 2's, and slice 2 is unbuildable as specified (§4).
- *"the row moves without waiting for a poll"* — not assertable at all, per §4.

Miscount: **"Twelve POST sites across ten endpoints"** and the list that follows names `fleet-controls`. The endpoint is `/api/registry` (`FleetControls.tsx:51`). Measured distribution: `/api/dispatch` ×2 (`StartWorkButton.tsx:256`, `menus.tsx:1276`), and one each for `story`, `reslice`, `registry`, `implement`, `idea`, `deliver`, `continue`, `commission`, `approve`. Ten endpoints is right; the tenth is `registry`, not `fleet-controls`. Minor, but the list is what an implementer works from.

## 7. What breaks when two agents take slices 1 and 2 at once

Both edit `App.tsx` (index state + callback definition) and `AgentList.tsx` (consuming the index / threading the callback). Slice 2 additionally edits `rows.tsx` and `menus.tsx` to thread the callback onward. `AgentList.tsx` is 2228 lines, `rows.tsx` 2704, `menus.tsx` 1850. The conflict is not incidental — it is the prop chain, which is the substance of slice 2's mechanical work.

Slice 2 is also not one slice by volume: twelve files plus four threading files, each button needing its own decision about what its endpoint's answer licenses. With §4 applied it is smaller (only `registry` has a usable answer today) but it is then a different slice.

## What must be said before anyone builds this

1. `complete` already has a reader at `AgentList.tsx:2206`, with an argued comment; say it stays and say what the new reading adds.
2. Slice 1 ships the prop-threading, unused, so slice 2 touches only button files.
3. Respecify slice 2 around `GET /api/approve/<slug>` / `GET /api/deliver/<slug>`, and say what the eight endpoints with no readback do. Or cut slice 2 to `/api/registry` alone and say so.
4. Cut slice 3 and rewrite the "index serves every consumer" section, or keep the section and admit the plan does not deliver it.
5. Name where a held row's age renders.
6. Fix `fleet-controls` → `/api/registry`.

---
"@plot-pm/board": patch
---

`Start work` and `Approve` now really do refuse a second click inside one tick — and there is finally a test that says so.

**The test came first, and it came out RED.** Both buttons carried a comment claiming a double click could not fire two runs, and both implemented it by reading a value derived from `useState`: `const blocked = starting || !dispatch.available`, checked in `onClick`. `setState` does not take effect until the next render, so two clicks in one tick both read `idle` and both called `fetch`. Nothing in this repo had ever checked that, on either button — so the first thing written here was the assertion, not the latch, and it failed with **two POSTs where one was asserted, on both buttons**. Writing the fix first would have made a green run unreadable: it could not distinguish a real defect caught from React's batching having covered it all along.

**Two clicks in ONE TICK, not two awaited clicks.** Playwright's `locator.click()` waits for actionability between calls, which hands React a render in between and makes `blocked` true by the second — the defect is invisible that way, which is very likely why it survived this long. The test dispatches both events from a single synchronous block inside the page, which is what a fast physical double click delivers to the handler.

**A `useRef` latch, because a ref changes synchronously.** The second click of a same-tick pair sees the flag already set. `blocked` **stays**: it carries the *other* refusals — no dispatch binding, a non-localhost host — and those answer *may this act at all*, a different question from *is one of mine already running*. Both are asserted: a board bound to `0.0.0.0` still refuses every click on both buttons, and posts nothing.

**The latch releases where the STATE does, never in a `finally` beside the fetch.** The button stays pending until the pulse confirms or the poll answers; a ref released when the request returned would re-arm it while it still reads `starting…` — clickable again behind a label saying it is busy. Pinned as its own assertion, since a `finally` passes the same-tick test and reintroduces the defect one beat later.

**On `Approve` the guarded click is the SECOND one.** The first click arms and posts nothing by design, so the pair that fires two merges lands on the *armed* label. A latch on the idle click would guard the wrong transition and pass a test that only clicked twice from idle.

**Local only, no server-side in-flight registry.** A second browser tab is a different question with a different answer — git holds the claim for dispatch, and the host refuses a second merge — and an in-flight registry would be state the board does not otherwise keep. This fixes the case that produced the report: one person, one tab, two clicks.

The pairing that matters is asserted too: **a slow single click still works.** A latch that never releases passes every same-tick assertion above and breaks the button completely.

<!--
bumps:
  skills: {}
-->

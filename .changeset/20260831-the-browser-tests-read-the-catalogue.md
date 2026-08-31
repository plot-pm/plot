---
'@plot-pm/board': patch
---

The browser tests read the catalogue instead of starting a board.

Every fully-stubbed browser test — one that supplies both `/api/board` and
`/api/fleet` itself — now serves its state by name through `openCatalogue()`.
A test that supplies both payloads has nothing to start a board FOR, and 42 of
them were starting one anyway: a full `board-server.mjs` with its refresh timer
and its estate scan, so that the fixture could be ignored.

**A gate rather than a rule.** `stubbed-tests-start-no-board.test.ts` greps the
suite for a fully-stubbed test that still reaches for the artifact and fails
naming the file. Two counts sit beside it — files and `it(` — so the gate cannot
pass by subtraction: a migration moves assertions, it does not delete them.

**The last file exposed what a cast fixture hides.** `unreachable-overlay`
built its fleet as a raw object literal cast to `Fleet`, which satisfies `tsc`
structurally while `.parse()` never runs — so Zod defaults never apply and a
wrong shape renders nothing at all, silently. Four of its tests reached for the
action menu on an eligible branch and found none, and three separate gaps were
behind it, each invisible for the same reason:

- the row carried no `kind: 'wave'`, and since `a-wave-is-a-kind` an eligible
  branch renders as its WAVE, which is what carries the menu;
- the fleet named a plan the served board had no card for, and `Start work` is
  gated on `verdict === 'eligible' && card && dispatch` — a missing card is a
  `null` branch in a ternary, not an error;
- `BoardSchema.dispatch` defaults to `available: false`, so the menu was
  already `aria-disabled` while the server was healthy, and the two assertions
  reading that attribute would have passed vacuously.

None of the three was reachable before, because `/api/board` used to fall
through to a real board server over the tiny-garden fixture, which supplied the
waves and cards the fixture never mentioned. The payload was half real; serving
the whole state is what made the fixture answerable for itself.

`BOARD_DEFAULTS` now states `server` — a plausible restart command, port,
branch and repo — for the same reason the catalogue states `generatedAt`: the
schema's empty-string default is right for a parser and wrong for a catalogue,
because a component that renders a field only when the server sent one is
otherwise untestable.

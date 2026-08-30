---
'@plot-pm/board': patch
---

A browser test asks for a board state **by name**, and gets it without starting a board.

`test/catalogue` is one `row()`/`wave()`/`card()`/`column()`/`fleet()`/`board()`
builder, a set of named scenarios, and a mock server that answers `/` with the
built client and `/api/{board,fleet}` with the named state. It never imports
`board-server.mjs`, starts no refresh timer and runs no `git`.

**The census it answers, re-measured 2026-08-30:** 43 browser tests, 43
asserting rendered UI, 39 stubbing `/api/*`, 42 starting a full board — and
**0** importing a shared fixture. Every test builds its own state inline, so a
schema change breaks them one at a time and *quietly*: the client CASTS its
payload, so a field a fixture omits reaches the renderer as `undefined` rather
than as an error.

**The builders PARSE.** That moves the failure to the earliest place that can
see it — a missing required field throws naming the field, and a required field
the schema *gains* fails `tsc` on the builder's defaults, which are typed as
`z.input<…>` so that exactly the defaulted fields are optional. It found two
fixture bugs while being written: `phase: 'Approved'` — a PLAN phase, where
`AgentRow.phase` and `Card.phase` carry one of the five BOARD phases — at five
places, and `checklist` declared on `Card` where the schema puts it on `Board`.

**That guarantee needed a gate, not a rule.** `tsconfig.json` included only
`src`, so `test/` was outside the typecheck entirely and a deliberate type error
in it passed `pnpm run typecheck` silently. `test/catalogue` is now in `include`;
a test asserts that it stays there. The rest of `test/` is deliberately still
out — it carries 26 pre-existing errors, and widening to it is the migration
slice's call rather than this one's.

**It is a server rather than a bundle, and the precedent was read first.**
`tuple-row.browser.test.ts` already starts no server: it bundles a component
with `esbuild` and `page.setContent`s it. That works because it mounts ONE
COMPONENT and hands it data as props — it never fetches. The board's client
does: `App.tsx` polls `/api/board` and `/api/fleet` on relative URLs and reads
`location.search` for `?tab=agents`. Under `setContent` the origin is
`about:blank`, so a relative fetch has no base, `page.route` has no request to
intercept, and the query string the tab reads cannot be set. The departure is
that the subject here IS a fetching, routing application. What the two shapes
share is what matters: neither starts the board.

**Demonstrated on one existing test, and only one.**
`wave-status-speaks-verdict.browser.test.ts` now reads `a-done-wave`: 62 lines
of inline assembly gone, every `expect` unchanged character for character, and
no mention of `startServer` left. Its old fixture was cast (`as Fleet`) and
carried the invalid phase plus three missing required `Wave` fields. Migrating
the suite is a separate slice on purpose — doing both at once means a reviewer
cannot tell a broken catalogue from a badly-moved test.

The catalogue is a CLAIM about what the server emits, and a claim can drift.
Nothing in it proves the real board would produce these payloads; the remaining
end-to-end browser tests are what keep it accountable, which is why they stay.

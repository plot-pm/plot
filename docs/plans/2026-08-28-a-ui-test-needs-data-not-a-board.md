# A UI test needs data, not a board

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

Browser tests render from a named fixture served by a mock, instead of starting
a board whose scan they discard.

## Motivation

### What the browser tests are for, and what they pay for

Measured 2026-08-28 across `packages/board/test/integration/`:

| | count |
|---|---|
| browser tests | 46 |
| asserting on rendered UI (`getByText`/`getByRole`/`locator`) | **43** |
| stubbing `/api/*` with `page.route` | **35** |
| importing a shared fixture module | **0** |

The three that also read a response assert 38-44 UI expectations each, so the
suite is **entirely** a UI suite. That is the right subject: whether the board
renders a given state correctly. Everything else — how the state is derived — is
already covered by 73 unit tests that need no server.

**But each browser test spawns a full board server.** From
`agent-panel-links.browser.test.ts`:

```ts
server = spawn('node', [ARTIFACT], {
  cwd: tmp,                                    // an EMPTY temp dir
  env: { PORT: '0', PLOT_REPO_ROOT: tmp, … },
});
…
await page.route('**/api/fleet',  r => r.fulfill({ body: … }));
await page.route('**/api/board',  r => r.fulfill({ body: … }));
await page.route('**/api/agent-panel*', r => r.fulfill({ body: … }));
```

A board is started against an empty directory, then every route it would answer
is intercepted. The server exists to serve one synchronous
`res.end(clientHtml)` — the whole UI is inlined into one HTML string by
`vite-plugin-singlefile`, so serving it needs no scan, no git, and no timers.

### The cost, measured

A board process starts refresh timers and estate-scan machinery whether or not
anything asks it. Running the suite alongside an operator's own board on
2026-08-28: **six board processes**, spawn cost **3.6 ms → 162 ms**, and the
operator's board stopped answering inside its 90 s budget. The suite was not
leaking — `PLOT_EXIT_WITH_PARENT` covers that, and the servers were live test
servers doing their job. They simply do a great deal of work no test reads.

### The correctness cost is the larger one

**Zero tests import a shared fixture.** Each hand-builds `row()`, `fleet()`,
`board()`. So a schema change breaks 35 files, and it breaks them *quietly*: the
client CASTS the payload rather than parsing it, so a field a fixture omits is
`undefined` in the renderer rather than an error. Two defects from exactly this
shape were recorded in this repo's memory before this plan was written.

One fixture module fails **once, loudly**. That is the same argument
`plot-worker-state.sh` settled after five of its six states had drifted in
duplicate.

## Design

### The mock owns a catalogue; a test asks for a state by name

A test says which board it wants, not how to build one:

```ts
const page = await open('five-working-agents');
const page = await open('blocked-wave', { rows: [{ state: 'wip' }] });
```

Named scenarios are built from ONE shared `row()`/`fleet()`/`board()` builder,
and a test may override specific fields. Names carry the intent that today lives
in 40 lines of inline assembly, and the override keeps a test's local meaning
readable without letting it diverge silently.

### It serves the page too, so routing stays real

The mock serves `dist/client/index.html` on `/` and the catalogue on `/api/*`.
One process, no scan timers, no git.

**Not `page.setContent`.** That is faster still and needs no process, but the
page then has no real origin: relative fetches, same-origin behaviour and the
client's own routing go untested, and those are UI behaviour. The mock keeps the
transport honest and removes only the machinery nothing reads.

### Three tiers, and each keeps its own subject

| tier | asks | needs a server |
|---|---|---|
| unit (73) | does the server DERIVE the right data? | no |
| browser (46) | does the UI RENDER this state? | mock only |
| HTTP route (22 `.mjs`) | does the endpoint accept/refuse? | **yes, a real one** |

The 22 top-level `.mjs` tests (`write-gate`, `approve`, `dispatch`) exercise
endpoints and are server tests by definition. They are **out of scope** and keep
the real board.

### What the real board is still for: smoke, not coverage

Eleven browser tests do NOT stub the API and read a live board end to end —
`tiny-garden.data`, `tiny-garden.plan`, `tiny-garden.story`, `approve`,
`dead-fetch`, `spinner`, `double-click`, `start-work-refusal`, `story-overlay`,
`tuple-row`, `wave-leaves-the-kind-alone`. These stay, and their PURPOSE
changes: they stop being where UI behaviour is covered and become the check that
**the real pieces still fit together** — that a real scan produces a payload the
real client can render, through a real HTTP origin.

That is a smoke test, and smoke tests earn their cost by being few. Once
rendering is covered against the catalogue, an end-to-end failure means the
seam moved, which is exactly the signal a small set of slow tests should carry.

**This is what keeps the split honest in both directions.** A catalogue can
drift from what the server actually emits — a fixture is only a claim about the
payload. The eleven are what tests that claim, so the mock never becomes a
parallel truth. Deleting them to make the suite faster would remove the only
thing checking the fixtures are still real.

### Not chosen: share the builders and keep the real board

It fixes the schema drift and is a much smaller change. Rejected because it
leaves 35 estate scans per run and the contention that prompted this — and
because a rendering test taking a live scan as input has an uncontrolled input,
which is a correctness argument rather than a speed one.

### Not chosen: convert the browser tests into unit tests

They assert rendered output, which is what a browser test is for. Moving them
down a tier would trade real assertions for approximations of them.

## Branches

### Catalogued

- `infra/the-mock-board-serves-named-states` — a mock server exporting one `row()`/`fleet()`/`board()` builder and a catalogue of named scenarios, serving `dist/client/index.html` on `/` and the catalogue on `/api/*`. Tests: a named state renders; an override changes only the named field; a schema field missing from the builder fails the build rather than rendering `undefined`

### Moved

- `infra/the-browser-tests-read-the-catalogue` — the 35 fully-stubbed browser tests take their state from the mock instead of spawning a board. Tests: no fully-stubbed browser test spawns `ARTIFACT`, asserted by grep so it cannot regress; the suite's assertions are unchanged, asserted by a green run

## Done when

1. **No fully-stubbed browser test starts a board.** Asserted by grep for
   `spawn(` / `startServer` in files that also `page.route('**/api/board'`, so
   the split cannot silently reverse.
2. **The 22 HTTP-route tests AND the 11 unstubbed browser tests still start a
   real board.** The regression this invites: a sweep that mocks everything
   would delete the only coverage of whether an endpoint accepts or refuses,
   and the only check that the catalogue still resembles what the server emits.
   Asserted by count, so "mock everything" cannot pass.
3. **Assertions are unchanged.** This moves where data comes from, not what is
   checked. A diff that alters an `expect` is out of scope.
4. **A schema field the builder omits is a BUILD error, not an `undefined`
   render.** The whole correctness argument; without it the catalogue is a
   thirty-sixth place for a fixture to drift.
5. **The suite runs with no `git` subprocess.** Asserted by count, not duration —
   a timing assertion is flaky and the count is the fact that produces it.
6. `pnpm run test:board` green; `pnpm run validate` green; artifact rebuilt.

## Notes

Asked as *"can't we make test runs on a mock board?"*, then sharpened twice:
*"the purpose of the board test is UI — anything else should be covered by unit
tests"*, and *"actual e2e tests would then rarely be needed and act more like
smoke tests"*.

The second framing is what makes the split principled rather than an
optimisation: a rendering test's input is DATA, so serving it from a catalogue
is the honest shape, not a compromise. The third is what stops the split
becoming a hiding place — the few remaining end-to-end tests are not leftovers
to be minimised away, they are what keeps the catalogue accountable to the real
payload.

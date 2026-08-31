## Implementation brief — a-browser-test-serves-its-own-state (slice 1: Survey)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/the-browser-tests-say-which-need-a-server` (base: `main`)
- **Ends as:** one PR to `main`

**First, and everything else waits on it.** Six slices size themselves from this
table. Nothing here changes a test.

### What to build

A classification of all 33 board-spawning browser files, a wall-clock baseline,
and the state list `agents-tab` needs. **Read-only: no test moves in this slice.**

The deliverable is the `## Survey` section written into the plan file, plus the
baseline recorded in the changeset.

### The measurements already taken — start from these, do not re-derive

Measured 2026-08-31 on `origin/main`, all in `test/integration/`:

| | count |
|---|---|
| browser test files | 44 |
| spawn a real board | **33** (365 tests) |
| serve their own state | 11 (of which 8 also spawn) |
| gate's tripwire | `EXPECTED_FILES = 48`, `EXPECTED_TESTS = 479` — both exact |

`agents-tab.browser.test.ts` holds **111** `it(` by the gate's own comment-stripped
count (the plan says 117 counting comments; use 111). It routes `/api/fleet` 14
times and `/api/board` once, as `route.abort('connectionrefused')`.

**Write-route candidates** — 6 files, likely "must stay real": `approve` (2),
`button-claims` (3), `double-click` (10), `fleet-settings` (1), `spinner` (7),
`start-work-refusal` (2), counting `POST` and `/api/{approve,dispatch,claim,transition}`.

**`tiny-garden` has 29 browser-test readers and 34 readers overall.** That is
larger than this plan and its fate is not this plan's to settle — record which
consumers are browser tests and which are not, and hand the rest on.

### Each file gets one of three verdicts

- **catalogue candidate** — its board state can be named
- **must stay real** — and *why*, in one clause: process behaviour, or a write that reaches a script
- **interception over baseline** — a board that cannot answer (`abort`, HTTP 500, malformed JSON), the `unreachable-overlay` pattern

The three named in the plan are hypotheses to check, not conclusions:
`lifetime.test.mjs` and kin (process behaviour — 71 process-shaped references,
0 write-shaped), `write-gate.test.mjs` and the approve/dispatch routes, and
`tiny-garden.browser.test.ts`, whose verdict the plan explicitly calls a
judgement rather than a grep.

### The baseline, and why it is taken here

`pnpm run test:board` wall-clock, on a **stated machine and load** — record the
`uname`, the core count and the load average, because a number taken later
against a different machine is not a comparison. `test:board` is bounded at
1200 s by `scripts/bounded.sh`; if the run hits that bound, say so, since a
truncated run is not a baseline either.

*"Faster is expected"* is not a measurement. The final slice states the delta
against this number, so if it is not written down here the plan's last
`Done when` item cannot be satisfied at all.

### Read `agents-tab` in full, though it migrates last

Its 14 `/api/fleet` routes are the best statement available of what the
catalogue must express. A catalogue shaped without them is one the largest
consumer discovers it cannot use — and that discovery would land in the slice
with 111 tests riding on it. Analysis early, migration late.

### Done when

- Every one of the 33 files carries a verdict and, for the exceptions, a reason.
- The baseline is recorded with its machine and load.
- The states `agents-tab` needs are enumerated.
- The plan's `## Survey` section is written; **no test file is modified**.
- Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24 (`nvm use`).

### Scope guard

Read-only. If this slice changes a test, it has taken the next slice's work and
the table it was meant to produce went unreviewed.

## Implementation brief — one-pr-reader-per-machine-and (wave: fleetd lock)

- **Plan (canonical):** `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Branch:** `feature/fleetd-holds-the-pr-index-lock` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention (CI green + review)

This is the third named slice. `feature/pr-index-lock-beside-the-index` (PR
#2718) is **merged** — it shipped the `ReaderLock` port, the
`reader-election.ts` rule, the `reader-lock-file.ts` adapter and the
`ReaderState` codec, with no caller. This branch is the first caller: fleetd
elects before every PR beat, fences before `writePrStore`, and publishes the
reader state file and its own heartbeat. A fourth slice,
`feature/boards-share-one-pr-reader`, wires the board and the standalone
reader process on top of what this branch produces.

### What to build

Wire `fleetPrs` (`packages/fleet/src/shared/fleet-clock.ts:166`) — the
function `registryd-main.ts:2200` builds and hands to `startFleetClock` as the
`prs` subscriber — so that each PR beat:

1. Calls `ReaderLock.elect(key, claim)` **before** the existing
   `prGateOpen(state.prNextAt, state.prNextIsBackoff)` check. The plan is
   explicit this ordering is load-bearing: *"The reader and fleetd call
   `elect` on every PR beat … before the cadence gate and before the host
   request. A holder therefore renews during a host-named backoff longer than
   `READER_STALE_MS`."* A renewal that waited behind the gate would let the
   claim go stale mid-backoff and hand the lock to a board-started reader for
   no reason.
2. On `held`, skips the pass entirely — no host request, no store touch. This
   is a new early return in `fleetPrs`, ahead of today's `prGateOpen` check,
   not a replacement for it: the gate still applies once this process holds.
3. On `elected`, adopts the reader state file (`ReaderLock.readerState(key)`)
   into `prState` **once, on first adoption only** — the plan: *"Every new
   holder (the reader and fleetd) adopts the file into its fresh `PrState`
   before its first host request."* A holder that re-adopts every beat would
   overwrite its own in-memory progress with what it itself last wrote, which
   is harmless but pointless; adopt once when `prState` is still the
   fresh/cold value (e.g. `prAt === null`), not on every elected beat.
4. Runs `refreshPrs` as today, but fences before the fold inside
   `writePrStore`'s caller: re-read `ReaderLock.holder(key)` immediately
   before the fold and skip the fold (not the whole pass — the host request
   already happened and its answer is still good for `prState`) when the
   highest claim's `pid`/`generation` no longer names this process. See
   "Done when" for why the fence lives where it does, not inside the domain
   fold itself.
5. Writes the reader state file (`ReaderLock.writeReaderState`) and this
   process's heartbeat (`ReaderLock.heartbeat(key, 'fleetd', now)`) at the end
   of every pass that held the lock — elected or renewed, whether or not the
   fold happened, so a reader watching the `fleetd` heartbeat sees fleetd is
   alive even on a beat the cadence gate or the fence skipped.
6. On `failed` (the lock directory itself could not be written — not
   `held`), skips the pass and warns once per cause, not once per beat. The
   plan: *"the lock directory sits beside the index, so a `failed` lock means
   `writePrStore` would fail too, and skipping loses no write."* There is a
   "warn once" precedent already in this file for the same reason
   (`registryd-main.ts:1309`, *"A failed append is reported on `warn` once per
   memory"*) — follow that shape rather than inventing a new one.

**The lock's key.** `(realpath(common git dir), connector)` — the adapter
resolves this from `cwd`/`home`, same as `prIndexFile`. Fleetd already builds
`prIndexFile({ cwd: repoRoot })` at `registryd-main.ts:2204`; build
`readerLockFile({ cwd: repoRoot })` from `@plot-pm/domain/adapters` the same
way, passed into `PrWorld` or built alongside it — whichever keeps the lock
calls in the same function that calls `refreshPrs`, since `PrWorld` itself
(`pr-refresh.ts:127`) is the interface the index-lock slice deliberately did
not touch (brief: *"this branch adds no caller"*). The connector name fleetd
passes is `prState.backend` once resolved (`registryd-main.ts`'s `gitHost`
resolution above the `readPrs` build) — the same string the index file is
already keyed by. **No account segment anywhere in this slice's code.** If
you find yourself reading `prState.prAccount` or calling a `spend-rate`-style
lookup to build the lock key, stop — the whole point of this lock design, per
the merged slice's brief, is that the key has none.

### The decisions already settled — do not re-derive them

**There is no `holds` method on the shipped `ReaderLock` port, despite the
plan's Index-lock-slice text saying `PrWorld` gets a `holds` check.** The
merged port (`packages/domain/src/ports/reader-lock.ts`) ships exactly seven
methods: `holder`, `elect`, `release`, `readerState`, `writeReaderState`,
`heartbeat`, `heartbeats`. The fence this slice needs is built by calling
`holder(key)` again and comparing its `pid`/`generation` against this
process's own claim — there is no separate boolean-returning primitive to
look for. Searching the merged `packages/domain/src` for `holds` as of
2026-10-26 finds nothing; this is a gap between the plan's prose and what
actually shipped, not a hint to go looking harder.

**The fence narrows a window; it does not close one, and that is correct.**
The plan: *"The fence narrows the window to the time between the read and the
store's `rename`. A lost update in that window costs one pass of freshness,
not a wrong decision, because the index never says no."* Do not try to make
the fence atomic with the fold (e.g. by holding the lock directory open
across both calls) — the design accepts the gap because the cost of losing it
is bounded and the index's own invariant (never serve "no PRs" from an
incomplete read) absorbs it.

**`held` skips the whole pass; `failed` also skips the whole pass, but for a
different reason, and the two must not be merged into one code path.** `held`
means another live process legitimately owns the lock — correct, expected,
silent after the first beat. `failed` means the lock directory itself
couldn't be written, which the plan reasons is equivalent to `writePrStore`
also being unable to write — so skipping costs nothing, but it is a real
degraded state worth a warning, unlike `held`.

**Adopting the reader state file happens once per becoming-holder, not once
per elected beat.** `elect()` returns `'elected'` on both a fresh takeover and
an ordinary renewal (per `electReader`'s rule: *"THIS PROCESS ALREADY HOLDING
THE LOCK IS `elect`"*) — the port does not distinguish "I just took over" from
"I'm renewing what I already hold" in its return value. Use `prState`'s own
cold-start shape (fresh fields, e.g. `prAt === null`) as the "just became
holder" signal for adoption, the same way `freshPrState()` already marks a
cold process. A naive implementation that checks `elect()`'s return value
alone for "did I just take over" will re-adopt the state file every single
beat, silently discarding whatever `refreshPrs` wrote to `prState` on the
immediately preceding beat.

**Post-merge refinement: a released highest claim now reads as no holder.**
After the index-lock slice merged, `d5b560829` ("release and renewal rename
onto the holder's own owner file", #2719 HIGH) changed `holder()` so a
released claim at the highest generation is read as `null`, not as a stale
claim to take over — and renewal/release now **rename** onto the holder's own
`owner.<n>` rather than linking a new generation, so a generation number is
never freed. This landed on `main` after the slice's own brief was written;
if you read that brief's description of "link owner.<n+1>" for renewal, trust
the shipped `reader-lock-file.ts` over the superseded brief text, not the
other way round — the port's TSDoc (`reader-lock.ts`, `reader-lock-file.ts`)
is the current description.

**This is still not a fourth connector** (CLAUDE.md's connector test): no
account, no credentials, no rate limit, no transport choice. The lock calls
sit in `fleet-clock.ts`/`registryd-main.ts` alongside the existing `Host`
reach, not inside it.

### Done when

The plan's own observable for this slice: **a fleetd restart inside a
host-named backoff sends no PR request before `prNextAt`.** Concretely: stop
and restart a fleetd-equivalent world mid-backoff (`prNextIsBackoff: true`,
`prNextAt` in the future) with the reader state file already published by the
prior "instance," and assert the new instance's first beat adopts
`prNextAt`/`prNextIsBackoff` from the file and makes no host call before that
time arrives — this is what a naive restart (fresh `PrState`, no adoption)
would fail, because `freshPrState()` zeroes `prNextAt` to 0 and the first pass
runs at once regardless of what the host said before the restart.

Also prove, since they are the concrete mechanics "Done when" rests on:

- **Election ordering.** A beat during an open backoff still calls `elect`
  and renews the claim (proving the heartbeat/claim does not go stale purely
  because the cadence gate is shut) — assert the claim's `at` advances across
  a beat where `prGateOpen` returns false.
- **`held` skips cleanly.** With another live claim already present, a beat
  makes no host call and the existing (non-lock) `PrState` is untouched.
- **The fence actually fires.** Construct the case the plan calls out: a
  process whose host request is already in flight when a second process takes
  over the lock (e.g. by faking a takeover between the `refreshPrs` call and
  the fold). Assert the fold is skipped and no `prError`/`prAt` corruption
  results — the in-flight answer is not silently discarded in a way that
  crashes the pass, it is just not written to the store.
- **`failed` warns once per cause, not once per beat.** Simulate an
  unwritable lock directory across several beats and assert exactly one
  warning line, following the `registryd-main.ts:1309` "warn once per memory"
  shape.
- **The heartbeat file exists and renews.** After a beat that held the lock,
  `ReaderLock.heartbeats(key)` includes a `fleetd` entry whose `at` matches
  that beat's time.

**State inventory.** This slice adds no new path shapes — the lock, heartbeat
and reader-state file rows (`*.lock/owner.*`, `*.lock/.*.tmp`,
`*.lock/board.*`, `*.lock/fleetd`, `*.reader.json`, `*.reader.json.*.tmp`)
were already added to `scripts/state-inventory.json` by the merged index-lock
slice (and refined again by `d5b560829`). Confirm `check-state-inventory.mjs`
still passes; do not add rows.

**Stale text.** Per the plan's "Stale text" section for this slice: update
the `fleetPrs` doc at `fleet-clock.ts:161` to describe the elect/fence/warn
behaviour this slice adds, and update the *One writer* paragraph of *A
Decision Reads The Index* in `CLAUDE.md` to name the lock and the reader
state file as now in use by a real caller (today it describes them only as
shipped-but-uncalled).

Plus the repo's gates: build artifacts stay out of the diff
(`scripts/check-no-bundle-diff.sh`), a changeset per `## Versioning` in
CLAUDE.md, and platform constraints (`nvm use` — Node 24, pnpm crashes on
Node 26).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints — this slice touches `packages/fleet/**`
(vitest + typecheck) and `packages/domain/**` not at all (it calls the
shipped port, it does not change it). The suites in the `CI suites` config
key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, the
reconcile test glob) run in CI on every PR; do not run them locally as a
matter of course.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a pull request whose
shell under `skills/` is longer than at its merge base. This slice is
TypeScript under `packages/fleet` — it should not touch any `.sh` file. If it
turns out to need one, that growth is paid for in the same change per *A
Shell Script Asks The Domain* in CLAUDE.md.

### Bookkeeping

Open the PR through the controller, never `gh pr create` directly:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads which plan names the branch and opens the PR with the plan and this
brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section, under the `### fleetd lock` heading.

### Scope guard

This branch owns: `packages/fleet/src/shared/fleet-clock.ts` (the `fleetPrs`
builder), `packages/fleet/src/server/entry/registryd-main.ts` (where
`readerLockFile` is built and wired into the `prs` subscriber's world), and
their tests. It calls the `ReaderLock` port and the `reader-election.ts`
rules the prior slice shipped — it does not modify
`packages/domain/src/ports/reader-lock.ts`,
`packages/domain/src/rules/reader-election.ts`, or
`packages/domain/src/adapters/reader-lock/*`. If a defect in the shipped lock
protocol surfaces while wiring this (for instance if `elect`'s behaviour on a
released-then-restale claim does not match what `d5b560829` documents),
report it in the PR rather than silently patching the domain package from
this branch's scope.

This branch does **not** touch `packages/board/src/server/fleet.ts`, add any
new entry point under `packages/fleet/src/server/entry/` beyond wiring the
existing `registryd-main.ts`, or implement the board's own `Detached`-seam
spawn of a standalone reader. Those belong entirely to the fourth slice,
`feature/boards-share-one-pr-reader`. If you find yourself writing a
`plot-pr-reader.mjs` entry or a board-side heartbeat writer, stop — that is
not this slice's scope.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

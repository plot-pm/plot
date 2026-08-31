## Implementation brief — a-browser-test-serves-its-own-state (slice 7: Closing)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/every-browser-test-serves-its-own-state` (base: `main`)
- **Ends as:** one PR to `main`

**Last. Every migrating slice must land first.**

### What to build

Extend the gate from *"a fully-stubbed file must not start a board"* to *"only
the classified exceptions may"*, and state the wall-clock delta.

### The gate's final form

Today `stubbed-tests-start-no-board.test.ts` refuses a board start only in files
that already supply **both** payloads — so the 33 were outside it **by
construction**. It is a ratchet against regression. This slice makes it the
mandate: a browser test starts a board only if it declares
`// @needs-real-board: <reason>` **and** the declaration survives the structural
check the Deciding slice built.

**The exception population is derived, never listed.** The Deciding slice
settled the mechanism; this slice turns it on for the whole suite. A hand-kept
array fails open — a new test simply is not on it — which is the reasoning the
existing gate already records and this must not undo.

### The wall-clock number

The Survey recorded the baseline with its machine and load. Re-measure the same
way and state the delta in the changeset.

**The number matters more than the direction.** Faster is expected; if it did
NOT get faster, the servers were not the cost, and that finding is the slice's
most valuable output. Say so plainly rather than burying it — something else
should then be looked at, and nobody will know to look if this reads as a
success by default.

### Report what the migration found

Across seven slices this work will have exposed fixtures that were always
incomplete, hidden by a real dependency supplying what they omitted. Collect
those findings into the final changeset. `a-ui-test-needs-data-not-a-board` found
one that cost two agents an evening; the plan expects more, and expects the
finding to be the value rather than an obstacle.

If `tiny-garden`'s remaining consumers are now only process-behaviour tests,
record that too — 29 browser tests and 34 files read it as of 2026-08-31, and
whether it still needs plans in it is a question this plan hands on rather than
answers.

### Done when

- The gate refuses any browser test that starts a board without a verified
  declaration, and the exception population is derived.
- The suite's wall-clock delta is stated against the Survey's baseline, on a
  comparable machine and load.
- The assertion count is unchanged across the whole plan except where a slice's
  changeset named an addition.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`).

### Scope guard

The gate and the report. No test migrates here — anything still spawning a board
at this point is either a classified exception or a gap the Survey missed, and
the second is a finding, not a fix to slip in.

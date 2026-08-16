## Implementation brief — board-reads-git, branch 1 of 2

- **Plan (canonical):** `docs/plans/2026-08-16-board-reads-git.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #120 merged
- **Branch:** `bug/board-claimed-from-git` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Fixes — runs **concurrently** with `bug/dispatch-records-started`.
  They share no file: that branch touches only `plot-dispatch.sh` and its test,
  and does not rebuild the board artifact. Do not edit anything outside
  `packages/board/**` and the rebuilt artifact.

### What to build

Three changes to one package, one cause: **the card asks the plan file about
facts that live in git refs.**

**1. `pulseFor(opts)` in `fleet.ts`, beside `prsByNumber`.**

Wave 1 of the previous plan already built this route — `board.ts` imports
`prsByNumber(opts)` from `fleet.ts`, which reads the cache synchronously and
returns `| null` when it is empty. Add a second export of exactly that shape
returning `FleetPulse | null`. Do **not** make `buildBoard` async: `/api/board`
would then block on a 0.5–1.05 s scan, which is the reason the cache exists.
There is no import cycle — `fleet.ts` takes only a *type* from `board.ts`.

**2. `waveSummary` from the pulse, not from `meta.waves`.**

    claimed  = branches whose git state is `claimed`
    eligible = branches in a wave whose verdict is `eligible`, still `open`

`WaveSummarySchema` gains `eligible`. **Both counts are optional**, and a card
built while the pulse is null omits them rather than showing zeros — `claimed:
0` and "I have no pulse yet" must not render identically; that
indistinguishability is the whole defect. `waves` and `branches` stay
plan-derived and keep rendering: they genuinely come from the plan file and are
still true when git is unreadable.

**Delete `summariseWaves`** rather than leaving it beside its replacement. It
reads `b.claimed`, a field `plot-plan-meta.sh` parses from a plan annotation
nobody writes — which is why the count was always 0 and can never be anything
else. A function that reads a field nobody writes is a trap for the next
reader.

**Compute the summary for single-wave plans too.** Today `board.ts` guards with
`if (meta.waves.length > 1)`. That guard is right about "waves · branches" —
noise when there is one of each — and wrong about `claimed`/`eligible`: whether
someone is working on a single-wave plan's one branch is the same question.
Compute always; what the tile renders stays a display decision.

**3. Give the PR refresh its own timer.**

`refresh()` runs every 5 s and fires both `plot-fleet-scan.sh` (git, local,
free) and `pr-list --rich --state all --limit 300` (GitHub GraphQL, metered).
720 calls an hour exhausts a 5000/hour budget in under a working day — and did,
on this repo, on 2026-08-16 (`remaining 0/5000, used 5007`).

    git   → every 5 s      (unchanged)
    PRs   → every 60–120 s, with backoff when the host reports a rate limit

`refreshPrs` already has its own `prAt`, its own `prError`, and a comment
stating the sources are independent — this separates a cadence that was never
deliberately joined. **Keep `--limit 300`**: without it the board sees only the
newest 30 PRs and exactly the finished work goes unlinked. The defect was
frequency, never page size.

When the host reports a rate limit, wait for the reset it gives rather than
continuing to fire. Keep the existing behaviour of retaining the last good map
and surfacing the error — that part is already right, and is why the problem
was visible at all.

### Done when

- A card for a plan with a claimed branch reports `claimed: 1`. Show it against
  a real dispatch or a fixture, not by reading the code.
- A card built with a null pulse omits both counts (no zeros).
- `summariseWaves` is gone, with no callers left.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

Do **not** wire the *Start work* button's disabled state to the new `eligible`
count — that card belongs to the delivered `board-acts-through-plot` plan and
is a recorded open question. Do not touch `plot-dispatch.sh`; that is the other
branch. Drift → back to the plan.

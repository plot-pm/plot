## Implementation brief — the-board-shows-no-rows-when

- **Plan (canonical):** [docs/plans/2026-10-19-the-board-shows-no-rows-when.md](../../docs/plans/2026-10-19-the-board-shows-no-rows-when.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2087 merged
- **Branch:** `bug/the-board-shows-no-rows-when` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review required on `main`)

Single slice, no wave structure — nothing else is in flight against this file.

### What to build

The board client aborts every `/api/board` poll before the answer arrives, so the overlay reports `Failed to load board: Fetch is aborted` and shows no rows, even though the server is up and answering every request. Measured 2026-10-19 (issue #2083): `/api/board` took 4.38–4.59 s and `/api/board?show=tickets` took 4.91 s at load average 11.2, against a `POLL_TIMEOUT_MS` of `3_500` (`packages/board/src/app/App.tsx:113`). The abort fires at `App.tsx:330` (board poll) and the same constant times out `/api/fleet` at `App.tsx:371`.

**The plan has not picked a fix — that choice is yours, and it is the first thing to settle, not the last.** The Open Questions section lists four unresolved items; the PR must answer all of them, not just implement option 1 by default. Read them as the actual scope of this slice:

1. Which option (or combination) — a longer bound, a stale-but-shown last board, or a server-side cached answer?
2. Does `/api/board` genuinely need 4.4 s under load, or is there a cheaper fix in the handler itself (git scan / host calls / plan parse)? A mechanism fix can remove the need for any client change — measure before choosing a client-side tolerance.
3. If the timeout rises, what still guarantees "at most one board request live at a time" — the property `POLL_TIMEOUT_MS` exists to hold (see the comment at `App.tsx:90-110`)?
4. Does `/api/fleet` need the same look — it shares `POLL_TIMEOUT_MS` at a 4 s cadence, a much tighter margin than the board's 30 s.

### Decisions already settled — do not re-derive them

- **The 3.5 s bound is deliberate, not a bug.** It exists so a `node --watch` restart (which kills a fetch mid-response without rejecting it) still counts as a failure, and so two board requests are never in flight at once (out-of-order responses would show stale data over fresh). Any fix must preserve both properties — raising the timeout alone is fine for the board's 30 s cadence, but do not simply delete or wildly inflate the bound without re-stating why both properties still hold.
- **The 3.5 s figure comes from the fleet's 4 s poll, not the board's.** The board polls every 30 s (`DIM_AFTER_FAILURES` cadence), so it has 26 s of slack the fleet poll never had — that slack is why option 1 (a longer, board-specific bound) is plausible at all without re-opening the restart-detection problem.
- **Measure before implementing.** [[measure-before-implementing-a-plot-optimisation]] — the plan explicitly asks for before/after answer times recorded in the PR, on a loaded machine (the issue's own ask). Don't guess at the server-side cost; read where the 4.4–4.9 s actually goes if you're considering option 2 or 3.
- **Rendered states are domain properties (CLAUDE.md, "Every rendered state is a domain property").** If the fix adds a stale marker or a degraded-state banner, its wording and visibility need a unit test on a domain object, plus one browser test proving the marker renders — not logic decided inline in `App.tsx`.
- **Absent is not false.** If the fix reads a stored/cached answer (option 3), a missing or stale cache entry must not be read as "no board" — same invariant this estate re-learns elsewhere (ancestry/index rules in CLAUDE.md).

### Done when

The plan's acceptance is the slice description: *the board poll shows a slow `/api/board` answer, with before and after answer times recorded in the PR.* Concretely:

- All four Open Questions in the plan have an explicit, stated answer in the PR body (not just an implementation that implies one).
- Before-fix and after-fix `/api/board` answer times, measured under comparable load, are recorded in the PR.
- The "at most one board request live" property still holds after the change — state explicitly how.
- If `/api/fleet` turns out to need the same treatment, say so (or say explicitly why it doesn't, given its tighter 4 s cadence).
- If the client's rendered state changes (stale marker, degraded banner, etc.), it is backed by a domain-level property with a unit test, plus a browser test that the marker shows.

Plus the repo's gates: no generated board bundle committed (`scripts/check-no-bundle-diff.sh`); a changeset if this bumps `@plot-pm/board`; run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites in the `CI suites` config key run in CI, not here, and a failure there comes back as a correction.

`scripts/check-shell-lines.sh` ratchets shell line count — this slice is client/server TypeScript, so it should not touch `.sh` files; if it ends up needing to, growth must be paid for in the same change.

### Bookkeeping

- Open the PR through the controller: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

- Owns: `packages/board/src/app/App.tsx` (client poll), and possibly the `/api/board` handler (`packages/board/src/server/board.ts` and whatever it calls for the slow path) — scope depends on which option(s) you choose per the Open Questions.
- No other branch is in flight against this plan or these files as of 2026-10-19.
- If you find something the plan did not anticipate (e.g. `/api/fleet` needs its own fix, or the slow path is a quick win unrelated to the poll bound), report it in the PR rather than silently expanding scope.

## Implementation brief — an-agent-knows-what-it-spent (slice Knowing what it spent)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/an-agent-knows-what-it-spent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 6 of eight. The reading `a-worker-names-its-session` made possible.

### What this branch owns

**The context reading.** The transcript yields `message.usage`; the domain turns it into a verdict.

**PER SESSION, never per worktree.** `plot-transcript-quiet.sh:44` deliberately takes *"the newest line across ALL of a worktree's sessions"* — correct for *is anything happening*, wrong for *what has this agent spent*. Measured 2026-09-03: one project directory held **45 session files, 30 of them subagents**. A sum across them belongs to no one. Same file, opposite joins, which is why `a-worker-names-its-session` (#689) had to land first — it is what makes a transcript attributable at all.

**The domain exposes no percentage.** A threshold inside a value is a threshold every consumer owns and none agrees on. `Machine` reports `Headroom`, not milliseconds; do the same here.

**A missing or unattributable transcript answers `unknown`, never `ample`.** Silence is not headroom. `plot-worker-state.sh` already applies that rule to an unreadable worktree, and `rules/free.ts` applies it to an unmerged slice — *"Silence is not landed."* Follow both.

### What it does NOT own

**Ending on the reading.** `an-ending-carries-its-reason` merged as `3e518d40` and built the channel; deciding to end because context ran out is a policy this slice does not set.

**The session id.** #689 merged it.

**The daemon.** Slices 7 and 8.

### Done when

- The reading is per session, and a test proves a worktree with several sessions does not sum them.
- No percentage or threshold crosses the domain boundary.
- A missing transcript answers `unknown`, with a test.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed — **a shell-only change still needs it**; #687 failed CI's freshness gate for exactly that.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.

**A corpus floor reading `> 20` is a bug, not your failure.** Three were fixed on 2026-09-04 as delivered plans took the estate below the floor. Fix it to `> 0` and say so.

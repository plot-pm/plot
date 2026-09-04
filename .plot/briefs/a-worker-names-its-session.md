## Implementation brief — a-worker-names-its-session (wave Reading what an agent has spent)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/a-worker-names-its-session` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 5 of eight. One argument, and it unblocks two things.

### The measurement

**Verified 2026-09-04:**

- `plot-dispatch.sh:774` exports `PLOT_SESSION_ID` into the worker's environment.
- `plot-worker-loop.sh:661` prints the fix in its own diagnostic: `claude -p "..." --session-id "$PLOT_SESSION_ID" --permission-mode bypassPermissions`.
- `.plot/worker-prompt.sh` contains **zero** occurrences of `session-id`.

So the id is exported, documented, and never passed. Nothing can attribute a transcript to an agent, and `plot-worker-loop.sh:1063` reports that in prose and then ends the worker because nothing could tell.

### What this branch owns

**Pass `--session-id "$PLOT_SESSION_ID"` from the prompt file**, so the runtime writes its transcript under the id the manifest already carries.

**`.plot/worker-prompt.sh` is this repo's own file, not a shipped one.** It is the `Worker command`'s prompt for this estate. If a shipped template or the docs show the same command without `--session-id`, fix those too — `plot-worker-loop.sh:662` says this is *"the one place a person writes the command"*, so it is the place an adopting repo copies from.

**Handle the id being absent.** A prompt file invoked outside dispatch has no `PLOT_SESSION_ID`, and passing `--session-id ""` is worse than passing nothing. Guard it.

**Do not invent an id.** If it is missing, the transcript is unattributable and that is the honest answer — the same direction `plot-worker-state.sh` already takes, where an unanswerable question is not answered zero.

### What it does NOT own

**Reading the spend.** Wave 6, `an-agent-knows-what-it-spent`. This makes the reading *possible*; it does not take it.

**Resume.** `an-agent-remembers-its-session` merged already and added `resumeId` to the manifest. This unblocks resume as a side effect; do not extend it here.

**The ending channel.** Wave 4 merged as `3e518d40`.

### Done when

- A dispatched worker's transcript is attributable to its `PLOT_SESSION_ID`, proven by a test rather than asserted.
- A prompt file invoked with no id does something defensible, and a test says which.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed. **This wave changes shell scripts that are vendored into the board bundle**, and #687 failed CI's freshness gate for exactly that reason — a shell-only change still needs the rebuild.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.

**A corpus floor that reads `> 20` is a bug, not your failure.** Three were fixed on 2026-09-04 after delivered plans took the estate below the floor. Fix it to `> 0` and say so.

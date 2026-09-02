## Implementation brief — a-thinking-agent-has-a-quiet-stretch (wave Measuring what a working agent looks like)

- **Plan (canonical):** `docs/plans/2026-09-01-an-idle-agent-is-not-a-stalled-one.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `bug/a-thinking-agent-has-a-quiet-stretch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's first wave of three, and the two after it consume what this one produces. `bug/the-loop-reads-the-agents-own-stream` needs a threshold — *how long may a live transcript stay quiet before the agent has genuinely stopped* — and `bug/an-ended-worker-names-its-reading` needs to know which readings are distinguishable at all. Choosing that threshold rather than measuring it repeats the defect: today's rule fires because somebody picked a number that a working agent violates constantly. **This wave changes no production behaviour.** It samples, it records, and it hands the next wave a figure with evidence behind it.

### What to build

A measurement, its corpus, and the record of what it found.

Sample real dispatched sessions — their transcripts and their CPU clocks together — and record, for agents that **finished successfully**, the longest stretch during which the transcript was quiet. That number is the floor any threshold must clear. Record alongside it what the CPU sampler said during those same stretches, because the plan's claim is that the two disagree and the measurement is what proves it.

The corpus is on this machine already. `~/.claude/projects/<slug>/*.jsonl` holds one directory per worktree, keyed by the cwd slug, and 96 transcripts were present on 2026-09-02. Reaped desks keep theirs: `-Users-jwloka-Quatico-Agentic-Tools-plot--worktrees-bug-a-budget-belongs-to-the-computer` still exists though that worktree is gone. So the seven desks named in the plan's Motivation can be re-read even where the worktree was removed.

### The decisions the plan settles — do not re-derive them

**The reading is transcript quiet, not CPU.** The plan's Design settles this in a table and states why: *"a slow model response is indistinguishable from a dead one by CPU alone"*, and *"no sampling interval closes the gap"*. Two alternatives are argued and rejected by name — widening the sample (*"makes the false positive rarer without making it wrong less often"*) and requiring more consecutive idle passes (*"three zeros are three readings of a waiting process"*). Do not reopen either; measure what the chosen reading looks like.

**The CPU sampler stays exactly as it is.** `plot_worker_activity` at `plot-worker-state.sh:494` reads the subtree's CPU clock, sleeps `PLOT_ACTIVITY_INTERVAL` — 0.4 s, set at `plot-worker-state.sh:493` — reads it again, and prints `idle` when the two are equal. It is sourced by `plot-dispatch.sh` and `plot-fleet-scan.sh` both, so a syntax error there breaks the fleet. This wave does not touch it; it measures against it.

**The monitor and the kill stay as they are too.** `monitor_activity` at `plot-worker-monitor.sh:274` delegates wholesale to that sampler. The four conditions that publish `idle` sit at `plot-worker-monitor.sh:409` — this pass quiet, the previous pass quiet, the tree unchanged between them, and commits already on the branch. `_on_monitor` at `plot-worker-loop.sh:392` traps `USR1` and ends the worker with the detail *"the WorkerMonitor reported idle"*. **Wave 2 owns the swap and wave 3 owns the message.** Changing either here would ship a behaviour change inside a measurement.

**A transcript is findable without a session id, and that corrects the plan's Design.** The Design says the reading depends on the adopter passing `--session-id`, and treats its absence as making the capability *unavailable*. Measured 2026-09-02: this repo's `Worker command` is `PLOT_UNATTENDED=1 skills/plot/scripts/plot-worker-loop.sh`, that loop forwards no `PLOT_SESSION_ID` to the runtime, and the transcripts exist anyway — `transcriptFile` at `packages/board/src/server/transcript.ts:77` takes `sessionId` as **optional**, and `transcriptDir` at `:58` derives the directory from the cwd alone. So the id narrows a directory to one file; it is not what makes the reading possible. Report this rather than assuming the plan is right about it: if the reading works without the id, the `unavailable` fallback covers a smaller population than the Design expects, and wave 2's shape changes.

**`lastActivity` already exists.** `TranscriptFacts` at `packages/board/src/server/transcript.ts:21` carries *"ISO-8601 timestamp of the last assistant turn — when the agent last spoke"*, and `readTranscriptFacts` at `:139` reads it from a bounded tail (`TRANSCRIPT_TAIL_BYTES`, 256 KB, at `:117`). The quiet-stretch reading is a delta against that field, not a new parser.

### A measurement already taken, and what it is worth

`bug/a-budget-belongs-to-the-computer` — one of the seven desks in the plan's Motivation, which finished and shipped as #621 — has a 609-line transcript holding 559 timestamped turns. Its five longest gaps between consecutive turns:

```
73.1s   52.5s   43.5s   42.4s   31.7s
```

**A successful agent was quiet for 73 seconds.** The monitor requires two quiet passes about 30 s apart, so this session alone crosses the current rule's window more than once. Treat that as a single data point rather than the answer: it is one session on one machine, the gap distribution across the corpus is what the next wave needs, and the tail matters more than the maximum. Reproduce it as part of the measurement rather than citing it.

### Done when

- **The longest quiet stretch of a successfully finished agent is recorded, with the session it came from named.** A number with no provenance is a chosen number wearing a measurement's clothes.
- **The distribution is recorded, not only the maximum** — enough of it that wave 2 can pick a threshold and say what fraction of real sessions it would have killed.
- **The seven desks named in the plan's Motivation are re-read**, and for each one the record says whether its transcript shows an agent that had genuinely stopped or one that was waiting. That is the plan's own Done-when item, and it is the check that tells thinking from stuck on the population that was actually killed.
- **What the CPU sampler said during those same stretches is recorded beside them.** The plan claims the two readings disagree; this is the evidence.
- **The `--session-id` question is answered from the filesystem rather than from the Design.** State whether a transcript was findable for each desk sampled, and by which derivation.
- **No production behaviour changes.** `plot_worker_activity`, `monitor_activity`, the four `idle` conditions and `_on_monitor` are untouched. A diff that changes any of them is wave 2's or wave 3's.
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and a changeset.

### You are exposed to the bug you are fixing

The rule this plan removes is live on `main` and it will try to end you. It has killed ten dispatched workers across two days — seven recorded on 2026-09-01 and three more on 2026-09-02, the latter within minutes of dispatch, each holding uncommitted work including new test files.

**Commits survive it and uncommitted work does not.** Every rescue of those desks recovered what was committed and had to reconstruct what was not.

So commit early and often, even when the work is incomplete, and say in the message that it is incomplete — *"wip: the measurement so far, not yet a distribution"* costs nothing and loses nothing. A worker that commits every few minutes treats this rule as an interruption; one that works for an hour and then commits treats it as a catastrophe.

`PLOT_MONITOR_ENDS_WORKER=0` (`plot-worker-loop.sh:106`) removes the kill and leaves the finding published. It is a seam rather than the fix, and whether your own dispatch used it is not yours to change — read it as context for why a kill may or may not arrive.

### Repo gates

Node 24 first: `nvm use`. Then, as your diff touches them:

- `pnpm test` — every skill parses
- `pnpm run test:reconcile` — the plan-format contract, and the shell suites with it
- `pnpm run test:board` — rebuilds the board artifact and runs its tests
- `pnpm run typecheck` — **board only.** The root script is `pnpm --filter @plot-pm/board typecheck` and it never reaches `packages/domain`. A change touching that package also needs `cd packages/domain && npx tsc --noEmit`, and `packages/domain` additionally has `pnpm run test:corpus` on its own vitest config, which is **not** part of `test:board`.

Do **not** run `pnpm run test:e2e`. It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes and a board that could not answer in 25 seconds.

The changeset carries the description **first** and the `bumps:` block **last** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description never ships.

### Scope guard

This branch owns the measurement, its script or test, and whatever it writes the findings into. It owns no production reading.

**Do not touch** `plot_worker_activity`, `monitor_activity`, the `idle` publish conditions, `_on_monitor`, or `PLOT_MONITOR_ENDS_WORKER`. Wave 2 replaces the reading; wave 3 renames what the log says. A measurement wave that also changes behaviour leaves the next wave nothing to measure against.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` — every board suite rewrites it.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and marked `-merge`. Never read its diff on a conflict: take either side, run `pnpm build:board`, and commit the rebuild.

If the measurement contradicts the plan — and the `--session-id` question above may — report it rather than implementing around it.

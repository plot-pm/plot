## Implementation brief — a-hung-child-does-not-hold-the-loop (wave Bounded)

- **Plan (canonical):** `docs/plans/2026-08-25-a-hung-child-does-not-hold-the-loop.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/the-loop-bounds-its-child` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 3. `Reaped` (the exit trap) and `Counted` (the cap) follow.

### What to build

`plot-worker-loop.sh` runs its prompt under a time bound. When the bound fires,
the worker logs why and **exits** — it does not hop to the next wave.

The measured failure, 2026-08-25: 13 live workers, 11 of them with an
already-merged PR, all with the same last line in `.plot-worker.log`:

```
Error: No messages returned
    at NO9 (…/@anthropic-ai/claude-code/cli.js)
```

An unhandled rejection **inside the agent CLI**. The process did not exit —
state `S`, CPU unchanged over a two-second sample, one of them for 10 hours:

```
child 75757   elapsed 10:07:04   cpu 1:07.19 → 1:07.19
```

Line 88 sources the prompt, so the loop waits on a child that never returns.

### START WITH THE SPIKE — the mechanism is not settled

**Do not assume `timeout $B . "$prompt_file"` works.** Line 88 is
`. "$prompt_file"`, a shell **builtin**; `timeout(1)` execs a process and cannot
wrap a `source`. Two candidates:

| Candidate | Cost |
|---|---|
| `timeout $B bash -c '. "$f"'` | Needs `timeout(1)` — see below, it cannot be assumed |
| bash watchdog: background sleep + `kill` | No dependency; the watchdog is code that must clean up on **every** exit path |

**The spike answers one question for whichever you pick:** does the bound
survive (a) Ctrl-C, (b) a kill of the loop itself, and (c) a child that ignores
SIGTERM? A bound that leaks its watchdog, or dies with the shell it was meant to
outlive, is worse than none — it looks like protection and is not.

**One objection I raised was WRONG, and you should not re-derive it:** the
subshell does **not** lose `$PLOT_BRANCH`. `plot-dispatch.sh:1038` sets the
variables as a prefix assignment, so they are in the environment and survive any
subshell; the loop's own `export` at lines 120–121 keeps that true after a hop.
The subshell's real cost is the `timeout(1)` dependency, nothing else.

### The decisions the plan settles — do not re-derive them

**`timeout(1)` is NOT available.** Measured here: `/opt/homebrew/bin/timeout` —
coreutils, not macOS. A mac without Homebrew has neither `timeout` nor
`gtimeout`, and Plot's helpers assume nothing beyond POSIX tools and git. **The
bound is bash-only.**

Reporting the absence and carrying on was rejected: the protection would vanish
silently on exactly the systems lacking it, turning a gate back into a rule
(CLAUDE.md — *can you answer "did I complete this?" without doing the work?*).

**The bound is measured, not guessed.** Honest runs on this estate, PR creation
to merge: #414 9 min, #417 9 min, #419 13 min, #416 29 min — against hangs of up
to 10 hours. Two orders of magnitude, so ~1 h never truncates real work. It is a
`## Plot Config` key with that default (Principle 5).

**A timed-out worker must NOT hop.** Its worktree is in a state nobody measured;
starting a second branch on top of that guess is worse than stopping.

**Do not try to catch the CLI error.** It happens in a foreign process, and
there is no exit code because the process does not exit — that IS the defect.
Matching the log for `No messages returned` was rejected: it recognises only the
hang already seen.

### Done when

The plan's `## Done when` items 1–6 and 12 are this wave's specification (7–8
belong to `Reaped`, 9–11 to `Counted`). Three exist because a naive
implementation passes without them:

- **Item 2** — a prompt finishing just under the bound is never truncated. A
  bound that fires on slow-but-honest work trades a visible hang for silent data
  loss, which is strictly worse.
- **Item 5** — the bound works with `timeout` and `gtimeout` absent from `PATH`.
- **Item 6** — the watchdog leaves nothing behind after a normal finish, a
  timeout, **and** a kill of the loop itself.

Test the bound with a **stub prompt that sleeps**, not against the real CLI —
it cannot be made to hang on demand.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

**`plot-worker-loop.sh` is what launches every dispatched worker.** A syntax
error there breaks the whole fleet, so run the shell suites before pushing.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Bounded (Branch: bug/the-loop-bounds-its-child, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-worker-loop.sh` and its tests, plus
the config-key documentation in CLAUDE.md and `plot-config.sh`.

**Do not add the exit trap** — that is wave `Reaped`, deliberately separate.
**Do not touch `liveAgentCount`** — that is wave `Counted`.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: generated, marked `-merge`. Never read its diff — take
either side, run `pnpm build:board`, stage the **rebuild** (not the merge's
copy), then commit. Staging before rebuilding produces a commit that looks
repaired and fails CI's freshness gate.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it, and a dirty copy makes
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

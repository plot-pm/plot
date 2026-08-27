## Implementation brief — a-dispatch-hands-over-a-brief (wave Gated)

- **Plan (canonical):** `docs/plans/2026-08-20-a-dispatch-hands-over-a-brief.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/a-dispatch-without-a-brief-refuses` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Handed over` (`feature/the-board-asks-for-a-brief`) is **not being
dispatched** — it needs an `Implement command` config key, and this repo has none
set (`plot-config.sh get "Implement command"` → unset). This wave stands alone.

### What to build

`plot-dispatch.sh` **refuses to launch a worker for a branch with no brief**,
with `--no-brief` as the named escape.

### The script already knows — that is the whole defect

Its footer reads:

```
summary: dispatched=2 reused=0 skipped=1 started=2 brief=missing worker=unconfigured
```

It **detects the gap and starts the worker anyway**. That is a rule where a gate
belongs, in CLAUDE.md's exact sense: the condition is measured, printed, and not
acted on.

Measured 2026-08-20: an agent ran **2:12 against a 700-line wave with no
specification** before being stopped, because the `Worker command`'s first
instruction is *"Read `.plot/briefs/${PLOT_BRANCH##*/}.md` first — it is the
specification"* and the file did not exist. It read nothing and improvised —
the one thing the brief exists to prevent.

### Fresh evidence from 2026-08-27 — two more instances the same day

**1. A wave sat eligible and unclaimed for a full day.**
`bug/the-scan-sees-a-stale-sprint-tally` showed *"approved — nobody has taken
it"* for 24 hours. Auto-dispatch was skipping it, correctly, because it had no
brief on main. A brief was written and it dispatched within seconds. **The
absence was invisible until someone went looking.**

**2. Four briefs were hand-written before pushing an approval**, purely to beat
auto-dispatch to the claim — the race was measured at **51–60 seconds** and lost
four times in one session. That workaround exists because the gate does not.

### The decisions the plan settles — do not re-derive them

**`--no-brief` is the named escape**, in the tradition of `--allow-local` and
`--during-release`. A gate with no exit is one people route around by not using
the tool.

**A missing brief PREPARES but does not START.** The worktree is created and the
claim is pushed — that work is correct and stays. Only the worker launch is
refused, so the operator can write the brief and start it without redoing setup.

**An unreadable brief is treated as missing, not as present.** A zero-byte or
permission-denied file is not a specification. This is the assertion a naive
`[ -f ]` check fails.

**The footer must agree with what happened.** Today `brief=missing` prints
beside `started=2`, which is the contradiction this wave removes. After it,
`brief=missing` and a non-zero `started` must not co-occur without `--no-brief`.

### Done when

The plan's `### Gated` wave lists its own tests, and they are the specification:

- a branch with **no brief** is prepared and **not started**, and the message
  names the file and the two ways forward
- a branch **with** a brief starts as before
- `--no-brief` starts it **and says so in the log**
- an **unreadable** brief is treated as missing, not as present
- the footer still reports `brief=` and now **agrees with what happened**
- the plan gate and the held-branch refusal are **unchanged**

Plus: `pnpm run validate`, `pnpm run test:reconcile`. Node 24 (`nvm use`); use
`corepack pnpm` if the homebrew one misbehaves. **`pnpm test` is NOT a test run
in this repo** — it is `skills add . --list` and prints an installer listing.

Add a changeset with a `bumps:` block for `plot`.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Gated (Branch: bug/a-dispatch-without-a-brief-refuses, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns the brief check and its refusal in
`skills/plot/scripts/plot-dispatch.sh`, plus its tests.

**Do not touch `/api/dispatch` or the board's Start work button** — that is wave
2 (`feature/the-board-asks-for-a-brief`), which is blocked on an `Implement
command` key nobody has configured.

**Do not change the plan gate, the held-branch refusal, or the claim mechanism.**
The wave's own test list pins all three as unchanged.

`plot-dispatch.sh` was edited on 2026-08-26 by `the-worktrees-live-in-one-place`
(#445, #448) which added `Worktree root` and `--migrate`. Rebase onto current
main and read the flag parsing as it is now.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

# Panel — the board port is configured, not typed (#1056)

Subject: `docs/plans/2026-09-29-the-board-port-is-configured-not-typed.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| consequence | amend | executed |

## The premise verified in full

`grep -rn 'Board port'` exits 1. No `PLOT_BOARD_PORT`, no `.plot/` port file, no `.env` — the only routes are `--port N`, the `PORT` env var, and two hardcoded defaults. All three cited lines are correct: `plot-boardctl.sh:78`, `index.ts:49`, `:400`/`:402`.

The motivation reproduces live: `:7777` serves this repo, `:7778` serves `ewz-kus-portal`.

## The worktree hazard I predicted was tested — and absorbed

I briefed the juror to hunt a shared-config collision across desks. **The mechanism is real and it proved it:** `plot-config.sh:167` resolves the worktree's own tracked `CLAUDE.md`, so **nine checkouts of this repository all read one `Board port`** — eight of them desks.

**The per-worktree pidfile is what makes that safe.** `plot-boardctl.sh:86` keeps it at `$repo_root/.plot/state/board.pid`, gitignored, and measured: only the main checkout has one. So from a desk —

- `--start` finds the port held, refuses, names the other checkout
- `--stop` finds no recorded pid and refuses by the two-fact rule
- `--status` prints *"serving ANOTHER checkout"*, truthfully

**Every desk path refuses, and the key makes them refuse about the right board** rather than the default. `plot-worker-loop.sh` and the worker prompt name no board command, port or endpoint, so a desk never asks unprompted.

The predicted defect does not exist. It is now recorded as a property, because a board-per-desk feature would invert it.

## THE FINDING — `pnpm board` never touches `plot-boardctl.sh`

`package.json:14`:

```json
"board": "node --watch skills/plot/scripts/board/board-server.mjs"
```

No `PORT`, no config read. The plan's *"the shell owns it"* is true of `plot-boardctl.sh` and **false of the command this repository declares as its own**.

**And the board renders that command beside the bound port.** Measured live: `{"restartCommand": "pnpm board", "port": 7777}` — one object, from `server-info.ts`, whose header says its job is *"to name a way out when this server stops answering."*

So with `Board port: 7778` declared:

- `/plot-board --start` binds 7778 ✓
- the dead-board overlay says *run `pnpm board`* → binds **7777**

`server-info.ts:33-39` already refuses a **guessed** command for precisely this reason — *"a reader staring at a frozen board, ready to believe the one instruction on screen."* A declared-and-wrong command is the same failure, and the plan's `Done when` reached none of it.

## Two more corrections

**`AGENTS.md` too.** `plot-config.sh:173-180` reads both files, and the motivating repository configures Plot in `AGENTS.md` — where it already carries a hand-written `Fleet label` under a heading meaning *"not read by Plot yet."* The plan documented only `CLAUDE.md`.

**A rival override is already documented.** `skills/plot/SKILL.md:261` names `PORT=8080 pnpm board` as *the* way to change the port. Ship the key without retiring that and there are two documented answers that disagree.

## The test estate is not in scope, verified

`packages/board/test/port.test.mjs:158` spawns the server with no `PORT` and tests `index.ts:49`, which the plan leaves alone. The ~12 `port: 7777` literals construct option objects and bind nothing. **No browser test hardcodes a 7777 URL.** My brief's worry did not materialise.

## The honest reservation, kept in the plan

**What an operator loses today is one flag they must remember.** The plan's own Motivation concedes every part of the collision diagnosis already works — nothing is silently wrong.

The juror's case for the key anyway, which the plan did not make: the alternative is measured and worse. The motivating repository already carries a hand-written `Fleet label` note that no script reads, and **#1051 is the plan that exists because a note was not enough.** A note is a thing a person reads; a key is a thing a script reads.

## Amendments folded in

1. The `pnpm board` conflict, with the overlay consequence and `server-info.ts`'s own precedent.
2. The key read from `AGENTS.md` as well as `CLAUDE.md`.
3. `SKILL.md:261`'s rival override retired, with the full documentation sweep listed.
4. The repository-wide property recorded, with the desk refusals that make it safe and the future change that would invert it.
5. The test estate verified out of scope rather than assumed.

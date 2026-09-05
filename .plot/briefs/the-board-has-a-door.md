## Implementation brief — the-board-has-a-door (slice: Starting the board)

- **Plan (canonical):** `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md` on `main`
- **Design:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md`
- **Branch:** `feature/the-board-has-a-door` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 2 of five. Slice 1 (`the-fleet-changes-hands`) merged as **#712**, so `/plot-pulse` and `/plot-fleet` already exist — this one gives the board the same shape.

## What this delivers

`/plot-board` with `--start`, `--stop`, `--status`. `plot-board-setup` keeps only adoption.

**A NEW SKILL DIRECTORY.** Verified 2026-09-05: `skills/plot-board-setup` is the only match for `plot-board*`. `/plot-board` does not exist and this slice creates it.

## The starting logic MOVES, it is not rewritten

`plot-board-setup --start` already works and is documented at `SKILL.md:47` as *"probe for the artifact path, start the board, prove it answers, print the URL"*. It resolves the artifact through `plot-board-probe.sh`, refuses when `artifact_source` is `none`, and warns when `cwd_is_root` is false because the board compares realpaths.

**Take that behaviour whole.** The slice is about which command owns it, not about changing what it does.

**`plot-board-setup --start` is REMOVED, not aliased.** Slice 1 settled the reason: a flag that still works teaches the wrong command. `SKILL.md:33`, `:47`, `:49`, `:53` and the Model Guidance row at `:66` all document it and all go.

## `--stop` finds the board by TWO facts that must agree

**`--start` writes the pid; `--stop` reads it AND asks the port who is listening.** It stops only when the two describe the same process tree, and where they disagree it refuses and says which.

**Neither fact is sufficient alone.** A pidfile outlives its process — which is why `plot-worker-state.sh` never reads one without `ps` beside it. And the port alone finds whichever board answers, which on a machine running several is not necessarily this repository's.

**THE BOARD IS A TREE, NOT A PID.** Measured again 2026-09-05, on the live board:

```
 9518  9490  node --watch skills/plot/scripts/board/board-server.mjs
78298  9518  node skills/plot/scripts/board/board-server.mjs
```

`node --watch` (9518) supervises the child that binds the port (78298). Asking only the port finds the child; killing only the child lets the watcher restart it.

**THIS IS THE FAILURE THAT PROMPTED THE RULE.** On 2026-09-04 a `pkill -f 'board-server.mjs'` in this session killed the operator's board along with the stale jobs it was aimed at. A pattern match over process names is exactly the guess the two-fact rule refuses.

## `--status` reports processes, not work

Whether the board answers, on which port, since when. Cheap: the server already answers *"Plot board already running at …"* on its port.

**What the estate is doing is `/plot-pulse`'s question.** The two commands stay apart — one is about this machine, the other about the plans. That split is the same one slice 1 drew between `/plot-fleet` and `/plot-pulse`.

## The design constraint that governs this slice

`DESIGN-process.md` §1: **fleet control and the board are independent systems that share a machine.** Either runs without the other, neither is a component of the other, and the two process trees share no edge.

**So `/plot-board` must not touch the supervisor, and `/plot-fleet` must not touch the board.** A repository with no board still dispatches; a repository with no supervisor still shows a board with no agents on it, which is the truth.

**The board's cost is fixed at 2 processes** however large the fleet — §3 — so nothing here scales with N and nothing here needs a count.

## Testing

`pnpm test` validates that every skill parses and that every `bumps:` names a real directory — a new skill directory must be registered.

The root `README.md` skills table needs the new row; `CLAUDE.md`'s architecture table needs it too.

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

## Done when

- `/plot-board --start` starts what `plot-board-setup --start` started
- `--status` reports the port and whether it answers, without starting anything
- `--stop` stops the tree only when pidfile and port agree, and names the disagreement otherwise
- `plot-board-setup` no longer documents a `--start` step, and its README says where the flag went
- the skills tables in `README.md` and `CLAUDE.md` carry the new command
- the gates above pass

## Do not

- **Do not leave `plot-board-setup --start` working.** Removed, not aliased.
- **Do not stop the board by pattern match.** `pkill -f` is the measured failure this slice exists to prevent.
- **Do not kill only the port-holder.** `node --watch` restarts it; the tree is what stops.
- **Do not make either command depend on the other.** The board must run with no supervisor and the fleet with no board.
- **Do not give `/plot-board` any estate question.** That is `/plot-pulse`.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

# The board port is configured, not typed

> A second checkout's board runs on 7778 only because somebody typed `--port 7778`. Nothing records it, so the next `--start` there defaults to 7777, finds this repository's board, and reports it as already running.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1056
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, claude (unattended), `bug/the-board-port-is-configured-not-typed`

## Changelog

- A repository declares its board port in `## Plot Config`, so two checkouts stop colliding on 7777.

Board impact: the board's own port. No payload change.

## Motivation

Measured 2026-09-29, two boards on this machine:

```
:7777  cwd /Users/jwloka/Quatico/Agentic-Tools/plot
:7778  cwd /Users/jwloka/Quatico/ewz/ewz-kus-portal
```

`grep -rn 'Board port' skills/ CLAUDE.md` returns **nothing**. The 7778 exists only in the shell history of whoever started it.

The default is written twice — `plot-boardctl.sh:78` `DEFAULT_PORT=7777` and `packages/board/src/server/index.ts:49` `Number(process.env.PORT ?? 7777)` — and the port reaches the server as an env var (`plot-boardctl.sh:400`, `:402`).

### What the collision actually looks like

`--start` on a busy port does not crash. The server prints *"Plot board already running at …"* and **exits 0** — which `plot-boardctl.sh` already knows, which is why it fetches `/api/board` and reports the checkout rather than trusting the exit code.

So the second checkout's operator gets a truthful message about the **wrong repository's** board, having asked to start their own. The board that is running serves somebody else's estate, and `--status` says so only because `answers:` reads `server.repo`.

**Every part of that diagnosis already works.** The gap is that nothing prevents the collision, and nothing remembers the port that avoided it.

## Design

### The rule

**`Board port` is a `## Plot Config` key, read the way every other key is read.**

`plot-config.sh get "Board port" 7777` — the same shape as `Agent registry`, whose default `.plot/agents` leaves a single-checkout project unaffected. A repository that declares nothing keeps 7777 and nothing changes for it.

### Precedence

`--port N` on the command line beats the key, the key beats the default. The flag stays because a one-off run on another port is a legitimate thing to do, and because removing a flag that works would break callers for no gain.

### One default, not three

The value would then be written in three places — the shell, the server, and the config key's fallback. **The shell owns it**: `plot-boardctl.sh` already resolves the artifact and passes `PORT=`, so it resolves the port too and the server's `?? 7777` stays as the last resort for a board started by hand.

### `pnpm board` does not go through the shell, and that is the conflict

**`package.json:14` is `node --watch skills/plot/scripts/board/board-server.mjs`** — no `PORT`, no config read. So this repository's own declared start command never reaches `plot-boardctl.sh` and would keep binding 7777 while the key said otherwise.

**That disagreement reaches an operator at the worst moment.** `server-info.ts` renders `restartCommand` and `port` in one payload — measured live: `{"restartCommand": "pnpm board", "port": 7777}` — and its header says its job is *"to name a way out when this server stops answering."* With `Board port: 7778` declared, the dead-board overlay would hand a reader a command that starts it on 7777.

`server-info.ts:33-39` already refuses a *guessed* command for this reason: *"a reader staring at a frozen board, ready to believe the one instruction on screen."* **A declared-and-wrong command is the same failure.**

**The slice must reconcile them or say it does not.** Either `pnpm board` reads the key, or `Board command`'s rendered value and `Board port` are made consistent. Naming the conflict and deferring it is acceptable; leaving it unsaid is not.

### The key is read from `CLAUDE.md` OR `AGENTS.md`

`plot-config.sh:173-180` tries both, and **the motivating repository configures Plot in `AGENTS.md`** — where it already carries a hand-written `Fleet label` under a heading meaning *"not read by Plot yet — pass it on the command line today"*. That is the shape a port lives in now, and it is what #1051 is closing for the label. A declared-but-unread key is this estate's measured failure; a declared-and-read one is the fix.

### What this does NOT do

- **It does not pick a port automatically.** Deriving one from the repo path would change the port of every existing installation on upgrade, and an operator who has bookmarked a URL would find it dead.
- **It does not stop two checkouts sharing a port deliberately.** The key is a declaration, not a lock.
- **It does not touch `--stop`'s two-fact rule.** That reads the pidfile and the port's listener and is unaffected by where the number came from.
- **It does not change `--status`'s `answers:` line**, which already names the checkout a board serves and is the thing that makes a collision legible.

### The key is repository-wide, deliberately, and the pidfile is not

**Every worktree resolves the same `Board port`** — `plot-config.sh:167` reads the worktree's own checked-out copy of the tracked file. Measured: nine checkouts of this repository, eight of them desks, all reading one value.

**The pidfile stays per-worktree** (`plot-boardctl.sh:86`, `$repo_root/.plot/state/board.pid`, gitignored), and that asymmetry is what keeps a desk safe rather than what breaks it:

- `--start` from a desk finds the port held and refuses, naming the other checkout
- `--stop` from a desk finds no recorded pid and refuses: *"pid N holds port N, but this repository recorded no board"*
- `--status` from a desk correctly reports *"serving ANOTHER checkout"*

**Every desk path refuses, and the key makes them refuse about the right board** rather than about the default one. Measured, not argued.

**This is recorded as a property because a future change could invert it.** If a desk ever starts its own board, a repository-wide port with a per-worktree pidfile becomes a real collision, and these refusals become the normal path rather than the exceptional one.

**Desks do not touch a board today**: `plot-worker-loop.sh` and the worker prompt template name no board command, port or endpoint.

## Done when

- `Board port: 7778` in a repository's `## Plot Config` makes `--start` bind 7778, asserted by reading the bound port rather than the exit code.
- **`--port N` still wins over the key**, asserted.
- A repository declaring nothing still gets 7777, asserted — the case that must not change.
- `--status` and `--stop` operate on the configured port without `--port`, so an operator never types it twice.
- **The start command and the key do not disagree.** Either `pnpm board` (`package.json:14`) reads it, or the plan records why it cannot and what the overlay shows instead. `server-info.ts` renders `restartCommand` and `port` in one object, so a mismatch reaches a reader at the moment they can least check it.
- **The documentation sweep covers every place that names 7777**, and the second answer is retired: `skills/plot/SKILL.md:261` documents `PORT=8080 pnpm board` as *the* override and would otherwise become a rival to the key. Also `skills/plot/README.md:86`, `skills/plot/scripts/board/README.md:10`, `skills/plot-board/SKILL.md:47,95,97`.
- **The key is documented for `CLAUDE.md` AND `AGENTS.md`** — `plot-config.sh:173-180` reads both, and the motivating repository uses the second.
- **`packages/board/test/port.test.mjs:158` still passes untouched**, asserted: it spawns the server with no `PORT` and tests `index.ts:49`, which this plan leaves alone. No browser test hardcodes a 7777 URL — verified, so the test estate is not in scope.

## Slices

### The board port is configured, not typed (Branch: bug/the-board-port-is-configured-not-typed)

Read the key in `plot-boardctl.sh`, keep `--port` ahead of it, assert all three precedence cases.

## Notes

**Found while answering an operator's question about isolating two repositories' boards and daemons.** The isolation that exists on this machine is hand-made: a port in shell history, and a supervisor label edited into a plist by hand.

**Three plans cover the three pieces, and each is independent:**

- this one — the port survives a restart
- [`the-board-runs-the-artifact-its-repo-built`](2026-09-29-the-board-runs-the-artifact-its-repo-built.md) — the board runs its own build
- [`a-label-override-reaches-the-unit`](2026-09-28-a-label-override-reaches-the-unit.md) (#1051) — `PLOT_FLEET_LABEL` reaches the unit's `Label`, so two supervisors can coexist. Approved and dispatched 2026-09-29.

**`#1053` is the fourth**, and it is the Linux half: `PLOT_FLEET_LABEL` is inert on systemd, where two checkouts overwrite one unit file.


### Round 1, 2026-09-29

One juror, **amend**, **executed**. Moderation: `.plot/panels/2026-09-29-the-board-port-is-configured-not-typed/panel.md`.

The premise verified in full — no alternative configuration route exists, and all three cited lines are correct.

**The worktree hazard was tested and absorbed.** The juror proved the key is repository-wide across nine checkouts, then showed the per-worktree pidfile makes every desk path refuse *more* accurately rather than less. That is now recorded as a property.

**The finding is elsewhere: `pnpm board` never touches `plot-boardctl.sh`.** This repository's declared start command binds 7777 with no config read, and `server-info.ts` renders it beside the bound port — so a declared key would make the dead-board overlay hand a reader a command for the wrong port, the exact failure that module already refuses for guessed commands.

Also folded in: the key is read from `AGENTS.md` too, and `SKILL.md:261` documents a rival override that must be retired.

**The juror's honest reservation, kept:** what an operator loses today is one flag they must remember. Nothing is silently wrong — the collision diagnosis is loud and correct. The case for the key is that the alternative is measured and worse: the motivating repository already carries a hand-written `Fleet label` note nobody's script reads, which is why #1051 exists.
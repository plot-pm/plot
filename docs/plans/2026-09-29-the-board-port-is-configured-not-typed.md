# The board port is configured, not typed

> A second checkout's board runs on 7778 only because somebody typed `--port 7778`. Nothing records it, so the next `--start` there defaults to 7777, finds this repository's board, and reports it as already running.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1056
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

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

### What this does NOT do

- **It does not pick a port automatically.** Deriving one from the repo path would change the port of every existing installation on upgrade, and an operator who has bookmarked a URL would find it dead.
- **It does not stop two checkouts sharing a port deliberately.** The key is a declaration, not a lock.
- **It does not touch `--stop`'s two-fact rule.** That reads the pidfile and the port's listener and is unaffected by where the number came from.
- **It does not change `--status`'s `answers:` line**, which already names the checkout a board serves and is the thing that makes a collision legible.

## Done when

- `Board port: 7778` in a repository's `## Plot Config` makes `--start` bind 7778, asserted by reading the bound port rather than the exit code.
- **`--port N` still wins over the key**, asserted.
- A repository declaring nothing still gets 7777, asserted — the case that must not change.
- `--status` and `--stop` operate on the configured port without `--port`, so an operator never types it twice.
- **The key is documented in the `## Plot Config` block of this repo's own `CLAUDE.md`** and in `/plot-board-setup`, or it is a key nobody knows exists.

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

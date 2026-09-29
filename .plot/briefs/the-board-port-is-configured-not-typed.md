## Implementation brief — the-board-port-is-configured-not-typed

- **Plan (canonical):** `docs/plans/2026-09-29-the-board-port-is-configured-not-typed.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/the-board-port-is-configured-not-typed` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1056

One slice, one wave. Nothing waits on it and it waits on nothing. The sibling plans `the-board-runs-the-artifact-its-repo-built` and `a-label-override-reaches-the-unit` (#1051) are independent.

### What to build

A `Board port` key in `## Plot Config`, read by `skills/plot/scripts/plot-boardctl.sh` through `plot-config.sh get "Board port" 7777`. Today `plot-boardctl.sh:78` hardcodes `DEFAULT_PORT=7777` and `:217` assigns it before the flag loop. A second checkout on this machine serves on 7778 only because an operator typed `--port 7778`; the next `--start` there binds nothing, finds this repository's board on 7777 and reports it as running. The key makes the port survive a restart. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Precedence is `--port N` > key > 7777.** The flag stays: a one-off run on another port is legitimate, and removing a working flag breaks callers for no gain. Read the key once, before the argument loop, so the loop overwrites it.

**The shell owns the default.** `packages/board/src/server/index.ts:49` (`process.env.PORT ?? 7777`) stays untouched as the last resort for a board started by hand. `plot-boardctl.sh` already passes `PORT=` to the server (`:400`, `:402`), so it resolves the port and the server needs no config read. `packages/board/test/port.test.mjs:158` tests that line with no `PORT` and must pass unchanged.

**No automatic port.** Deriving a port from the repo path changes every existing installation's port on upgrade and kills bookmarked URLs. Rejected.

**No lock.** The key is a declaration. Two checkouts may share a port deliberately.

**`--stop`'s two-fact rule and `--status`'s `answers:` line do not change.** They read the pidfile and the listener; where the number came from does not matter to them. `--status` and `--stop` only need to act on the configured port without `--port`, which follows from resolving it before the loop.

**Repository-wide key, per-worktree pidfile — keep it that way.** Every worktree reads the same `Board port` (the tracked file); the pidfile at `$repo_root/.plot/state/board.pid` stays per-worktree. The juror measured every desk path (`--start`, `--stop`, `--status`) refusing, and naming the right board once the key exists. Do not "fix" the asymmetry.

**`pnpm board` is the conflict you must resolve or name.** `package.json:14` is `node --watch skills/plot/scripts/board/board-server.mjs`: no `PORT`, no config read. `server-info.ts` renders `restartCommand` and `port` in one payload for the dead-board overlay, and `server-info.ts:33-39` already refuses a guessed command because a reader at a frozen board believes the one instruction on screen. A declared `Board port: 7778` beside a `pnpm board` that binds 7777 is that failure. Choose one and state it in the PR:
- make `pnpm board` read the key (for example, the script resolves `PORT` from `plot-config.sh` before `node --watch`), or
- keep `pnpm board` and make the rendered restart command and port consistent, and record in the plan why.

Deferring with a named reason is acceptable. Silence is not.

**The key is read from `CLAUDE.md` or `AGENTS.md`.** `plot-config.sh` tries `CLAUDE.md` first, then `AGENTS.md` (the loop after `:180`). The motivating repository configures Plot in `AGENTS.md`. Document both.

**Carried-over invariants.** A busy port makes the server print *"already running"* and exit 0 — assert the bound port, never the exit code. Absent is not a value: a key with no value falls back to 7777, and a non-numeric value must be refused the way `--port` refuses one (`:231`), not passed to the server.

### Done when

The plan's `## Done when` list is the specification. The assertions that a naive implementation passes without:

- **Bound port, not exit code.** `Board port: 7778` → `--start` binds 7778, read from the listener or `/api/board`'s `server.port`. An exit-code assertion passes while the server attaches to someone else's board.
- **`--port N` beats the key.** A naive read placed after the argument loop inverts precedence and still passes the key-only test.
- **No key → 7777.** The case that must not change for every existing adopter.
- **`--status` / `--stop` without `--port`** act on the configured port.
- **Start command and key agree**, or the plan says why not.
- **Documentation sweep, rival retired:** `skills/plot/SKILL.md:261` (`PORT=8080 pnpm board` as *the* override), `skills/plot/README.md:86`, `skills/plot/scripts/board/README.md:10`, `skills/plot-board/SKILL.md:47,95,97`. Add `Board port` to CLAUDE.md's `plot-config.sh` key list.
- **`packages/board/test/port.test.mjs:158` untouched and passing.**

Existing boardctl tests live in `test/reconcile/boardctl.test.mjs`; add the three precedence cases there.

Repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` if `packages/board` or the artifact changes, `pnpm run typecheck`. Do not run `test:e2e` locally. Add a changeset (`'plot': patch` with a `bumps:` block for `plot` and `plot-board`, description first, `plan:` line optional).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to the branch's heading in the plan's `## Slices` — this plan uses the heading form: `(Branch: bug/the-board-port-is-configured-not-typed, PR: #N)`.

### Scope guard

This branch owns: `skills/plot/scripts/plot-boardctl.sh`, `test/reconcile/boardctl.test.mjs`, `package.json`'s `board` script (if that route is chosen), the five doc locations above, `skills/plot-board/SKILL.md`, CLAUDE.md's key list, and a changeset.

Out of scope: `packages/board/src/server/index.ts` (the plan leaves it alone), `plot-fleetctl.sh` and the supervisor label (#1051), the artifact-resolution work (`the-board-runs-the-artifact-its-repo-built`, which also touches `plot-boardctl.sh` — expect a merge on that file and keep edits to the port lines).

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — a-start-returns-while-its-agent-runs (wave 1: The launch gives back the caller's streams)

- **Plan (canonical):** `docs/plans/2026-10-01-a-start-returns-while-its-agent-runs.md` on `main`
- **Issue:** #1144 (duplicate report: #1147)
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-launch-gives-back-the-callers-streams` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

Wave 2, `bug/a-started-agent-leaves-its-starters-group`, waits on this branch and adds `set -m`. **Do not add `set -m` here**: without this slice's `exec`, `set -m` makes the forked bash the group leader instead of the wrapper.

### What to build

1. **At both launch sites**, the AND-list ends in `exec nohup sh -c '…'` instead of `nohup sh -c '…'`, and the outer subshell is redirected: `( … exec nohup sh -c '…' >"$log" 2>&1 </dev/null & ) >/dev/null 2>&1 </dev/null`. The sites: `start_worker` (the launch at `plot-dispatch.sh:1486-1536`) and the brief launch (`:801-806`, which today redirects only stderr on the outer subshell). `exec` replaces the forked bash with the wrapper, so no process with the dispatcher's command line remains. The inner redirect stays; the dispatcher's own `echo` lines are outside the subshell and still reach the caller.
2. **Rewrite the comment at `:1283-1287`.** It says an env prefix stops bash collapsing the AND-list; with `exec`, the forked child becomes the wrapper, so `$$` in the wrapper and the forked pid are one process.
3. **Rewrite `runDetached`** (`test/reconcile/dispatch.test.mjs:3350-3382`) and its docstring so they describe the fixed behaviour, and make one existing `--start` test read through a pipe, so the old workaround is what breaks if the hold returns.

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `plot-dispatch.sh` | 786-789 | brief-launch comment (`setsid` is not used) — wave 2 rewrites it |
| `plot-dispatch.sh` | 801-806 | brief launch, `( cd … && … nohup sh -c … & ) 2>/dev/null` |
| `plot-dispatch.sh` | 1283-1287 | the env-prefix comment |
| `plot-dispatch.sh` | 1486-1536 | `start_worker`'s launch, `nohup sh -c '…' >"$log" 2>&1 </dev/null & )` |
| `plot-dispatch.sh` | 3995 | `request_brief` runs under `--no-start` too |
| `test/reconcile/dispatch.test.mjs` | 3350-3382 | `runDetached` and its docstring |
| `packages/domain/src/adapters/performer/performer-shell.ts` | 93 | `runProcess(…, ['--start', '1'], …)` with `START_TIMEOUT_MS` 60 000 (`:24`) |
| `packages/board/src/server/claim.ts` | 54 | `CLAIM_TIMEOUT_MS = 60_000` |
| `plot-fleetctl.sh` | 1065-1067 | `--start` run inline |

Read `plot-dispatch.sh` with the Read tool: the controller-gate hook blocks any Bash command that names it.

### Tests (from the plan)

A contract test runs the **real script**: it starts a free agent in a sandbox repository whose loop never exits, reads `--start 1`'s output through a pipe, and asserts end-of-file within 5 s, `summary: agents=1`, the agent still alive, and the wrapper's parent not a process with the dispatcher's command line. The same test for `--restart`. A claim (`--no-start`) on a slice with no brief and a `Brief command` that never exits returns through a pipe before the 60 s timeout.

### Panel caveats a worker trips on

- **No panel juror ran these tests.** Every round measured the form on copies or the real script by hand; this slice's test is the first automated run of the real script. Measured by hand (macOS bash 5.3.15): `--start 1 | cat` took 20.39 s on `origin/main` and 1.12-1.15 s with `exec`; the wrapper's PPID was 1.
- **A test that invokes the script must write a receipt first** in a sandbox only if it goes through the controller gate; tests run under `node --test` are not Bash tool calls and are not gated.
- **Clean up every process the test starts by pid**, and wait for `.plot-worker.exit` before removing a sandbox (see the board-tests memory: a spawned worker races `rmSync`).

### Done when

`--start 1` with a loop that never exits returns within 5 s through a pipe and prints `summary: agents=1`; the agent still runs; its wrapper's parent is not a dispatcher-named process. `--restart` passes the same test, and a claim on a slice with no brief returns through a pipe before the timeout. `runDetached`'s docstring no longer describes a blocked pipe.

### Gates

`nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. **Do not run `pnpm run test:e2e`.** Run `test/reconcile/dispatch.test.mjs` alone first.

### Rules that bite this slice

- No domain rule changes and no new script; the defect is two launch sites.
- A changeset, description first and the `bumps:` block last (`plot` package; bump `plot-dispatch` if it names skills).
- Never signal the two hung dispatchers 34513 and 84589 or their children; they end when their agents exit.
- Use `trash`, never `rm`. Never `git stash`.

## Implementation brief — the-board-refuses-unauthenticated-remote-writes (wave 1: Loopback only)

- **Plan (canonical):** docs/plans/2026-11-23-the-board-refuses-unauthenticated-remote-writes.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-board-refuses-the-remote-write-opt-in` (base: `main`)
- **Ends as:** one PR to main, opened with `plot-open-pr.sh`
- **Review of the code:** `plot/review` on the PR, per repo convention

This is the only slice of the plan. No other branch waits on it.

### What to build

`PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` opens every route in `WRITE_ROUTES` (`packages/board/src/server/index.ts`) on any bind (issue #3311). `writeGate` in `packages/board/src/server/write-gate.ts` returns `allowed` when `remoteWritesAllowed(env)` is true, whatever `host` is, and `isSameOrigin` (`dispatch.ts`) passes a request with no `Origin` header. So `curl` from any machine that reaches the address can claim branches, approve plans and start agents.

Change `writeGate(host, env)` so that it allows a loopback host and refuses every other host. Delete `remoteWritesAllowed`, `ALLOW_REMOTE_ENV` and `ALLOW_REMOTE_VALUE`. Keep importing `dispatchAvailability` for the loopback set; do not restate it.

The refusal text has three parts:

- what was refused: the bind and the write endpoints;
- the two routes that keep the board on loopback: `tailscale serve` with `PLOT_BOARD_ORIGINS`, and `ssh -L <port>:localhost:<port> <machine>`;
- where the old variable is still set in `env`, a sentence that it no longer opens the gate. Read the name from a local constant, since the exports go.

Then update `skills/plot-board/README.md`: state the two remote routes and what each trusts (the tailnet's access rules for `tailscale serve`, the SSH account for a tunnel), and state that `tailscale funnel` publishes the board to the internet and must not front it. Also fix the stale comments that name the opt-in: `index.ts` (the `WRITE_ROUTES` comment) and `mock-fleet.ts` (it cites the variable only as an example of env configuration; name another variable).

### Settled decisions — do not re-derive them

- **Remove the opt-in; do not refuse it only on a non-loopback bind.** On a loopback bind the opt-in changes nothing, because `writeGate` allows loopback before it reads the opt-in. The opt-in has one effect, and that effect is the defect.
- **No new authentication.** A passkey on every route conflicts with the proxy route, because the passkey verifies against `http://localhost:<port>` only (`passkey.ts`). A shared secret is the scheme `dispatch.ts` refuses to invent. Neither is in this plan.
- **Reads stay served** on a non-loopback bind (`write-gate.test.mjs`, "still serves the READ endpoints"). Only write routes change.
- **The board does not refuse to start** when the old variable is set (plan question `question-refuse-start`, recommendation no). It may log one line that names the removed variable; it refuses writes per request.
- **Out of scope:** `Tailscale-User-Login` identity, and local callers with no `Origin` header (the boundary `dispatch.ts` states).
- **The operator's setup needs no opt-in.** The board stays on loopback, `tailscale serve` proxies to it, and `PLOT_BOARD_ORIGINS` admits the origin (#3527). A test must prove that path still works.
- Draft PR #3635 documents the opt-in in the same README. This slice edits only what main holds. Do not merge or rebase onto #3635's text; a person amends #3635.
- Carried rules: the gate sits in the router, not in handlers; the refusal stays 403, not 404.

### Done when

The plan's slice line is the specification:

- `packages/board/test/unit/write-gate.test.ts`: remove the `remoteWritesAllowed` and `ALLOW_REMOTE_*` cases. Add: `writeGate('0.0.0.0', { PLOT_BOARD_ALLOW_REMOTE_WRITES: 'i-understand' })` refuses and the reason names the removed variable, `tailscale serve`, `PLOT_BOARD_ORIGINS` and an SSH tunnel. Also assert that loopback hosts (`localhost`, `127.0.0.1`, `::1`) stay allowed with an empty env. The old-variable case is the one a naive implementation passes without: a gate that only deletes the opt-in branch still never tells the operator why their setting stopped working.
- `packages/board/test/write-gate.test.mjs`: replace the "opt-in is deliberate and exact" block, which expects 202, with `POST /api/dispatch` on `HOST=0.0.0.0` plus the old variable answering 403 and spawning nothing (`stub.runs()` is empty). Update the first block's `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` assertion to the new wording. Add a loopback board with `PLOT_BOARD_ORIGINS` that admits the declared origin on a write route. The "covers EVERY write route" test reads the built artifact's router table, so it needs a built board; `test:board` rebuilds it.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Do not commit `skills/plot/scripts/board/board-server.mjs` (`check-no-bundle-diff.sh`); `main` rebuilds it. Add a changeset for `@plot-pm/board` (patch) and `plot-board` (patch) with the description first and the `bumps:` block last, and `plan: docs/plans/2026-11-23-the-board-refuses-unauthenticated-remote-writes.md`. Run `./scripts/check-changeset-packages.sh`. Do not edit versions by hand.

The slice touches no `.sh` file, so `check-shell-lines.sh` stays unchanged.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to the slice line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/write-gate.ts`, `packages/board/src/server/index.ts` (comment only), `packages/board/src/server/mock-fleet.ts` (comment only), the two write-gate test files, `skills/plot-board/README.md` and one changeset. It changes no route table entry, no `dispatch.ts` rule and no domain code. Draft PR #3635 edits `skills/plot-board/README.md` too; expect a README conflict there and resolve it by keeping the loopback-only text.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

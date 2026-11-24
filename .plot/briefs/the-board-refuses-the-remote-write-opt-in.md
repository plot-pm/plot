## Implementation brief — the-board-refuses-unauthenticated-remote-writes (wave 1: Loopback only)

- **Plan (canonical):** docs/plans/2026-11-23-the-board-refuses-unauthenticated-remote-writes.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-board-refuses-the-remote-write-opt-in` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — plot-review on the PR, per repo convention

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

Issue #3311: `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` opens every route in `WRITE_ROUTES` (`packages/board/src/server/index.ts`) on any bind, with no authentication. `writeGate` in `packages/board/src/server/write-gate.ts` returns `allowed` when the opt-in is set, whatever `host` is. `isSameOrigin` (`dispatch.ts`) passes a request with no `Origin` header, so `curl` from any machine that reaches the address can claim branches, approve plans and start agents. On a loopback bind the opt-in changes nothing, because `writeGate` allows loopback before it reads the opt-in. The opt-in therefore has one effect, and that effect is the defect.

Change, in this order:

1. `write-gate.ts`: `writeGate(host, env)` allows a loopback host (via `dispatchAvailability(host).available`, imported as today) and refuses every other host. Delete `remoteWritesAllowed`, `ALLOW_REMOTE_ENV` and `ALLOW_REMOTE_VALUE`. Keep the `env` parameter only where the refusal still reads it: where `PLOT_BOARD_ALLOW_REMOTE_WRITES` is set to any value, the refusal says that the variable no longer opens the gate. Do not import the removed name from a constant; write the literal string in the one place that mentions it.
2. The refusal text names both routes that keep the board on loopback: `tailscale serve` with `PLOT_BOARD_ORIGINS` (the board stays bound to loopback, the tailnet decides who reaches it), and `ssh -L <port>:localhost:<port> <machine>`. It no longer names an escape that grants access, and it no longer says what the escape costs.
3. `index.ts` (the `WRITE_ROUTES` comment above the table) and `mock-fleet.ts` (the doc comment on the mock variable) mention the opt-in. Edit those comments so no comment describes a switch that no longer exists. Edit no code in either file beyond that.
4. Documentation: `skills/plot-board/README.md` states the two remote routes and what each trusts (the tailnet's access rules for `tailscale serve`, the SSH account for a tunnel). It states that `tailscale funnel` publishes the board to the internet and must not front it. `skills/plot/README.md` line 92 says "set `HOST=0.0.0.0` to expose the board": correct it to say that a non-loopback bind serves reads only.
5. Tests, below.
6. A changeset for `@plot-pm/board` (patch), description first, `bumps:` block last.

### Settled — do not re-derive

**Remove the opt-in; do not restrict it to some hosts.** The triage proposed "refuse the opt-in on a non-loopback bind". Read `writeGate`: loopback is allowed before the opt-in is consulted, so that restriction leaves an opt-in that does nothing anywhere. Removal is the same behaviour with no dead switch.

**No new authentication.** A passkey on every route conflicts with the proxy route: the passkey verifies against `http://localhost:<port>` only (`passkey.ts`). A shared secret is the scheme `dispatch.ts` states it refuses to invent. Do not add either.

**Reads stay served on a non-loopback bind.** `test/write-gate.test.mjs` asserts `/api/board`, `/api/fleet` and `/api/attention` answer 200 on `0.0.0.0`; keep that test. A phone may read a board bound wide.

**The board starts when the old variable is set.** Plan Open Question `question-refuse-start` recommends: the board starts, logs one line naming the removed variable, and refuses writes per request. Do not make startup fail. If the one log line needs a place, put it where `HOST` is read in `index.ts` and say so in the PR.

**Local callers are unchanged.** Every process on the machine reaches a loopback board with no `Origin` header, as today. This is the boundary `dispatch.ts` states; the plan accepts it (`question-local-callers`). `Tailscale-User-Login` is out of scope (`question-tailnet-identity`).

**The loopback set stays `dispatchAvailability`'s.** `writeGate` imports it. Do not restate `localhost`, `127.0.0.1`, `::1` in `write-gate.ts`, and change no domain rule.

**Rules carried over:** the router table `WRITE_ROUTES` is the only place a route is gated, and `refuseIfGated` stays the one check in the router. A refusal precedes any spawn.

### Done when

The plan's slice line is the specification: `writeGate` refuses every non-loopback host whatever the environment holds, the refusal names `tailscale serve` with `PLOT_BOARD_ORIGINS` and an SSH tunnel, and `skills/plot-board/README.md` documents both routes.

Assertions a naive implementation passes without:

- `packages/board/test/unit/write-gate.test.ts`: `writeGate('0.0.0.0', { PLOT_BOARD_ALLOW_REMOTE_WRITES: 'i-understand' })` is refused, and its reason names the variable as removed. A test that only drops the opt-in branch passes the "refuses without env" case and proves nothing about the env.
- The same file: the refusal contains `tailscale serve`, `PLOT_BOARD_ORIGINS` and `ssh -L`, and does not contain `i-understand` as an instruction to set. The removed-variable sentence may name the variable; assert it says "no longer".
- Delete the `remoteWritesAllowed` and constants tests (`describe('remoteWritesAllowed…')`, the `OPTED_IN` constant and the "truthy guess" cases); a test importing a deleted export fails typecheck, which is the intended signal.
- `packages/board/test/write-gate.test.mjs`: replace the "opt-in is deliberate and exact" suite, which asserts a 202 on `0.0.0.0` with the opt-in, by one that asserts `POST /api/dispatch` on `HOST=0.0.0.0` with the old variable answers 403 and `stub.runs()` is empty. Change the assertion at the refusal-content test that matches `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` ("names the escape exactly") to match the two remote routes instead. Keep the "covers EVERY write route" test: it reads the route table out of the built artifact, so build before running it.
- Add a case in `test/write-gate.test.mjs`: a loopback board with `PLOT_BOARD_ORIGINS=https://zio.example.ts.net` admits a request with that `Origin` and still refuses another origin. This is the supported remote route; it must keep working after the opt-in goes.
- `rg 'ALLOW_REMOTE|REMOTE_WRITES'` over `packages/` and `skills/` outside `skills/plot/scripts/board/*.mjs` and `CHANGELOG.md` returns only the removed-variable sentence in `write-gate.ts`, its tests, the changeset and (after #3635's text is dropped) the README line that says the variable is removed.

Plus: add the changeset (`.changeset/<slug>.md`, package `@plot-pm/board`, then run `./scripts/check-changeset-packages.sh`). Do not commit `skills/plot/scripts/board/board-server.mjs`; `scripts/check-no-bundle-diff.sh` refuses a generated bundle in a PR, and `main` rebuilds it. Run `pnpm build:board` only to run the board tests locally, then restore the generated paths before you push.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file; if that changes, pay for growth in the same change by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Commit subject: `plot-board: refuse remote writes on a non-loopback bind`.

### Scope guard

This branch owns `packages/board/src/server/write-gate.ts`, its two tests (`packages/board/test/unit/write-gate.test.ts`, `packages/board/test/write-gate.test.mjs`), the comment edits in `packages/board/src/server/index.ts` and `mock-fleet.ts`, `skills/plot-board/README.md`, line 92 of `skills/plot/README.md`, and one changeset.

Collision, verified 2026-11-24: draft PR #3635 (`plot-board: document the board's environment variables and remote access`) edits `skills/plot-board/README.md`, `skills/plot-board/SKILL.md` and adds a changeset, and it documents `PLOT_BOARD_ALLOW_REMOTE_WRITES` as an opt-in in four places. Plan Open Question `question-pr-3635` says to amend #3635 before it merges. If #3635 is still open when you start, edit only what is on `main` and say in your PR that #3635 must drop the opt-in text; if it has merged, edit its text to state the variable is removed. Do not edit `SKILL.md` for it: report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — who-may-approve-a-release-and (wave 1: Agent tool calls)

- **Plan (canonical):** docs/plans/2026-11-03-who-may-approve-a-release-and.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Branch:** `feature/the-gate-refuses-release-approve` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — the PR gets the `plot/review` status like every slice PR

This is the first slice of six and waits on nothing. The passkey slice (`feature/a-release-is-approved-with-a-passkey`) waits on `feature/one-rule-reads-the-caller` and on #3070 and #3071 slices, and it assumes this gate exists: after it merges, the board button is the only route a person's release approval takes.

### What to build

Today an agent releases by running `plot-ask.mjs release-approve <pr> <sha>` or by `curl`ing the board. Neither stops. `plot-ask.mjs` reads `PLOT_UNATTENDED` of its own process, so `env -u PLOT_UNATTENDED` or `PLOT_UNATTENDED=0` makes a master agent or a desk read as `person`. And the controller gate (`packages/board/src/server/entry/gate.ts`, `controllerGateOf`) returns `null` at `if (linked) return null;` for every desk call before it reads any action.

Build: the controller gate refuses, from any agent tool call, `plot-ask.mjs release-approve` and an HTTP client call (`curl`, `wget`, `http`, …) that POSTs to `/api/release`, `/api/release-approve` or `/api/restart`. It refuses at a desk and in the main checkout alike, and **no receipt clears it**. The refusal text names the person's route: the board's button. The gate stops an agent that runs the documented commands. It does not stop a script written to a file and run, and the plan says so rather than claiming identity.

Mechanism, on top of what exists:
- `controllerInvocation` (`packages/domain/src/rules/ci-suite.ts:216`) classifies a command into `GatedAction` (`:247`, `'dispatch' | 'approve' | 'deliver' | 'release' | 'restart'`). Add `'release-approve'` there, recognise the `plot-ask.mjs release-approve` call and the three board routes, and keep `GATED`'s existing arms and the read carve-outs (`isReadSegment`, `withoutDataLists`, `withoutComments`) working for the new matches.
- `ControllerAction` in `packages/domain/src/rules/controller-gate.ts:12` already has `release-approve`, and `ENDPOINT` (`:312`) already names its bundle. The refusal for these gets a different text: it names the board's button and offers no receipt escape.
- In `controllerGateOf`, read the new refusals **before** `if (linked) return null;` and before the receipt check. A desk, the main checkout and a root-unreadable call all refuse. A git reading that throws already refuses when a controller action is named; keep that.
- The master agent's route for a per-plan release and a restart becomes the bundles `plot-deliver.mjs --release` and `plot-restart-command.mjs`, under the existing receipt. The new refusal text for `/api/release` and `/api/restart` names those.
- Measure whether Claude Code's `!` prefix passes PreToolUse, and write the answer in the PR body and in the plan's Notes. The plan marks it unverified.

### Decisions the plan settles — do not re-derive them

- **A gate, not identity.** All local processes share one OS user and one `gh` login. Any value a process reads (env var, flag, file, header, token in the served page) another process can produce. So this slice claims "stops an agent's tool call" and nothing stronger. The proof of a person is the later passkey slice. Do not add an env or flag check to make this slice look like identity.
- **No receipt escape.** `plot-ask.mjs` writes its action receipt before it decides (`main.ts:220`), and the gate's receipt check reads it. A receipt escape on this action would clear the gate for the call it guards. The refusal is final: what the controller refuses does not happen.
- **Before the linked-worktree return.** `gate.ts` returns `null` for every desk call before reading an action. A desk is where a release attempt most likely comes from. Reading the action after that return refuses nothing there.
- **Do not widen `Caller`.** It keeps three values (`decision.ts:23`). This slice changes no workflow answer.
- **No per-board token.** Any local process can `GET /` and read it; `isSameOrigin` already gives the CSRF protection.
- **`POST /api/release` is `deliver --release`; `release-approve` had no board route until the passkey slice.** Match all three routes now so the later slice adds no gate change. The `release-approve` route does not exist yet; matching it early is intended.
- Rules carried over: absent is not false (a gate that cannot read git refuses a named controller action rather than allowing); read the exit code, not the emptiness.

### Done when

The plan's `## Slices` line for this branch is the specification. The tests, each failing on `origin/main`:
- `packages/domain/test/controller-gate.test.ts`: `controllerInvocation` answers `release-approve` for `plot-ask.mjs release-approve 1 abc1234`, and the gated action for `curl -X POST http://localhost:4000/api/release`, `/api/release-approve` and `/api/restart`.
- `packages/board/test/unit/controller-gate-readings.test.ts`: the gate refuses each of them from a linked worktree and from the main checkout **with a fresh receipt present**, and the text names the board button.

Lift these, because a naive implementation passes without them:
- the **fresh receipt present** case — catches an implementation that only adds the action to the existing receipt check;
- the **linked worktree** case — catches reading the action after `if (linked) return null`;
- a read-only mention (`grep release-approve docs`, `cat`, a heredoc body, a commented line) still allows — catches a match that is too loose and starts refusing documentation reads;
- `curl` with `-X GET` or no POST to those routes, and a POST to another route (`/api/dispatch`), keep today's answers.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice should touch no `.sh` file. Add a changeset (description first, `bumps:` block last, `plan:` line inside the block: `docs/plans/2026-11-03-who-may-approve-a-release-and.md`). The board artifact is generated and stays out of the diff. The gate text change touches `CLAUDE.md` only for the `release-approve` sentence; the plan assigns that edit to the passkey slice, so leave `CLAUDE.md` alone here.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ci-suite.ts`, `packages/domain/src/rules/controller-gate.ts`, `packages/board/src/server/entry/gate.ts`, and their tests named above.

Other branches in flight on the same plan: `feature/one-rule-reads-the-caller` (touches `callerOf` and eight entrances, not the gate), `feature/one-loader-reads-a-role-file` (fleet role files), then the waiting slices. Other plans that edit the `release-approve` sentence and `releaseApproveAt`: #3070 `feature/the-release-checks-are-counted`, #3071 `bug/release-approve-tells-its-tracker`, #3074. This slice touches none of those files, so no collision is expected.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

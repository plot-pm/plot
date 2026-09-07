## Implementation brief — the-board-says-whether-anything-supervises (slice: The board reads the supervisor)

- **Plan (canonical):** `docs/plans/2026-09-07-the-board-says-whether-anything-supervises.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/the-board-says-whether-anything-supervises` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice. The plan has no interrogation rounds — its motivation is a measurement taken on this machine on 2026-09-07, and the Notes section holds the six workers it was taken from.

## What this delivers

`/api/board` carries a supervisor reading, and the board renders it where a person watching agents will see it.

**The measured failure this removes:** `plot-fleetctl.sh --status` reported `supervisor=down` while six workers ran 23–25 hours against an 8-hour `Worker bound`. All six were spent — PR merged, tree clean, `PLOT-BLOCKED.md` written. The board showed six rows that looked exactly like six healthy ones, because it has no supervisor field at all.

## Where the reading comes from

**ASK `plot-fleetctl.sh --status`. Do not check a pidfile, a process name, or `launchctl` directly.**

It already answers this and its exit code is a contract: **0 when the supervisor is loaded, 1 when it is not.** A second implementation would drift, and it would drift toward *looks fine* — the direction nobody notices, which is the whole defect.

**A `pkill`-style match on process names is specifically refused.** `plot-boardctl.sh`'s header records why: a `pkill -f` over process names killed an operator's board on 2026-09-04. The same guess reads just as wrong as it kills.

## The three states, and why `unknown` is not optional

| state | when | how it must read |
|---|---|---|
| `up` | `--status` exits 0 | quiet |
| `down` | `--status` exits 1 | see prominence below |
| `unknown` | `--status` could not be asked at all | **neither up nor down** |

**`unknown` IS THE STATE THIS PLAN EXISTS FOR.** A board that cannot ask must not render `down` — that is an alarm nobody can act on — and must not render `up`, which is exactly the failure being removed. `plot-board-probe.sh` already takes this shape for auth (`ok`/`failed`/`unknown`, where an unrecognised output reads as *cannot verify*, never as authenticated). Follow it.

Note the asymmetry with the exit code: 0 and 1 are answers; **anything else, or no answer, is `unknown`.** A non-zero that is not 1, a timeout, a missing script — all `unknown`, never `down`.

## Prominence follows consequence, and the rule combines two facts

- `down` with **zero** agents running → a quiet fact. Nothing is being neglected.
- `down` with **one or more** agents running → **a warning.** Every one of those agents is now unreapable: nothing reaps a finished desk, nothing marks a spent one, nothing frees the agent.

The agent count is already on the board. **The combination is the rule**, and it is what makes the state actionable rather than decorative.

## Layering — this is where the slice will go wrong if it goes wrong

```
controller  →  domain  →  port  ←  adapter  →  script
```

**The state is a DOMAIN PROPERTY.** CLAUDE.md is explicit: *"every rendered state is a domain property"*, and *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."* Deciding `up`/`down`/`unknown` — and deciding that `down` + agents is a warning — happens in a rule, takes readings as values, and is asserted in a unit test with no browser and no server.

**What must NOT happen:** computing the badge's wording or its warning styling inside a `.tsx`. That is how 42 of this repo's 43 browser tests came to start a full board server.

**The port choice.** Read the existing ports before adding one — `packages/domain/src/ports/` has 13. `machine.ts` answers *how loaded is this box* (`loadAverage`, `cores`, `spawnCostMs`); `processes.ts` answers *is this pid alive*. Neither asks *is a named service loaded*, so decide deliberately whether this is a new operation on an existing port or a new port, and say which in the PR body.

**It is an ADAPTER, not a connector.** `launchctl`/`systemctl` is the local machine: no account, no credentials, no rate limit, no transport choice. Do not give it the connector's rate-limit contract.

## Cost

One local query per pulse. **No host call, no network.** If the reading turns out to cost more than a few tens of milliseconds, say so in the PR — the board's pulse is 5 s and the fleet scan already spends 18.3 s of it.

## What this slice is NOT

- **Not a control.** No button that starts or stops a supervisor. `DESIGN-process.md` §1 makes the board and fleet control independent systems sharing a machine, and their process trees share no edge. `/plot-fleet` owns the lifecycle.
- **Not a health check on the supervisor's decisions.** Whether a tick decided well is `--once`'s question.
- **Not agent-row state.** An agent's own state is already rendered and is correct. This fact is about the FLEET, so it does not belong on a row.

## Repo gates

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run typecheck
pnpm run test:board          # rebuilds the artifact, then runs its tests
```

**Do NOT run `pnpm run test:e2e`.** It is CI's gate, not a local one — it dispatches real workers into sandbox repos, and two agents running it once produced 53 concurrent `node --test` processes at load 8.69 on the machine the board lives on.

**The domain package demands 100% branch coverage.** An unreachable `?? null` fails CI — narrow the type rather than testing dead code.

**Arrow functions in the domain package**, and in anything you newly write elsewhere. The unit is the function, not the file.

**On a conflict in `skills/plot/scripts/board/*.mjs`: do not read the diff.** Generated bundles marked `-merge`. Take either side, run `pnpm build:board`, commit the rebuild.

## Done when

- The board reports whether a supervisor is running.
- `unknown` renders as neither up nor down.
- `down` with live agents is visibly a warning; `down` with none is not.
- The reading comes from `plot-fleetctl.sh --status`, not a second rule.
- The state is asserted in a **unit test with no browser**, and one browser test proves the badge shows it.

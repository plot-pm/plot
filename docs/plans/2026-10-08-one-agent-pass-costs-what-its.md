# One agent pass costs what its launchers cost

> Measure what one agent pass costs today, with every per-pass script as a launcher, and with the same questions answered inside one long-lived fleet process; record the route the numbers choose.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #1406
- **Story:** the-shell-holds-no-behavior
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `scripts/measure-pass.mjs` measures the CPU and wall time of one agent pass at 1, 4 and 8 agents in three variants: the scripts as they are, each per-pass script as a launcher over a bundle, and each question answered in one long-lived process. `docs/shell-and-domain.md` records the result and the route it chooses.

<!-- Board impact: none. The plan changes no script, no plan format and no board code. -->

## Motivation

`docs/shell-and-domain.md` §1 keeps a script that runs once per agent per pass in shell. Its reason is a measurement from 2026-09-07: `node -e ''` starts in 34 ms and a bundle under `skills/plot/scripts/board/` answers in 39 ms. The story `the-shell-holds-no-behavior` sets the target that every `.sh` is a launcher, and a launcher adds one Node start to every call. The story's decision *"Per-pass scripts: measure, then decide"* puts that measurement before any per-pass script changes.

The 2026-09-07 figure measures one start on an idle machine. It does not measure a pass: how many calls one pass makes, which scripts they reach, and what the calls cost at N agents under load. The scan's cost is CPU-bound under load (memory: *measure the Plot scan by CPU, not wall clock*), so wall time alone hides the cost the fleet pays.

**The premise moved since the cost rule was written.** The worker loop runs in JS since `the-worker-loop-runs-in-js` (v2.24.0, `d90120b79`): `plot-worker-loop.sh` is an 18-line launcher that `exec`s `board/plot-worker-loop.mjs`. §1 still names `plot-worker-loop.sh` as the per-pass case. A per-pass question asked from the JS loop already pays a process start for `bash` and the script; a launcher adds a `node` start behind it, and an in-process call removes both. The measurement compares those three, not shell against Node.

## Design

### Approach

**Inventory.** List every script and bundle that one agent pass reaches, with its call count per pass, from `packages/board/src/server/entry/worker-loop.ts` (2,397 lines), from the supervisor (`registryd.ts`, `registryd-main.ts`) and from auto-dispatch. A first grep of the entry files names `plot-plan-meta.sh`, `plot-dispatch.sh`, `plot-config.sh`, `plot-agent-manifest.sh`, `plot-agent-settings.sh`, `plot-host.sh` and `plot-reap.sh`. The issue names `plot-fleet-scan.sh`, `plot-worker-state.sh` and `plot-budget.sh`, which these files do not name directly, so the inventory follows the adapters as well. The count comes from a trace of real passes, not from the grep: a call site inside a branch or a loop does not give its count per pass.

**Measurement.** One script, `scripts/measure-pass.mjs`, modelled on `scripts/measure-tick.mjs`: it reads and decides and performs nothing, so it runs safely on a live estate. For each variant and for 1, 4 and 8 concurrent agents it reports user+system CPU and wall time per pass, as a median over several runs, with the machine's load average at the start.

| variant | what one per-pass call costs |
|---|---|
| today | `bash` + the script, spawned from the JS loop |
| launcher | `bash` + the launcher + `node` + the bundle |
| in-process | a function call inside one long-lived process, no start |

The launcher variant needs no converted script: it times the bundle start that a launcher adds (`node` on an existing bundle, which answers the same question or a stand-in of the same size) on top of today's call. The in-process variant imports the domain rule or adapter once and calls it per pass.

**Decision.** The numbers choose one of two routes, recorded in the story's *Decisions* table and in `docs/shell-and-domain.md` §1:

1. Amend the cost rule, and convert the per-pass scripts as launchers.
2. Answer per-pass questions inside the fleet's own long-lived process. The board is not that process; the story separates the fleet from the board (Phase 3).

The same change corrects §1's statement that `plot-worker-loop.sh` is the per-pass case, since it is a launcher now.

**Scope.** The plan changes no script under `skills/plot/scripts/`. Its deliverables are the measurement, the script that takes it, and the recorded decision.

### Open Questions

- [ ] Which scripts does one pass reach through the adapters, and how often? The grep above names seven; the trace decides.
- [ ] What threshold separates the routes? A proposal: route 1 if the launcher variant adds less than 5 % CPU per pass at 8 agents, else route 2. The reader sets the number before the measurement, so the result cannot choose its own bar.
- [ ] Do 1, 4 and 8 agents stay the right sample? `Worker bound` and the fleet size on this machine may suggest another top value.
- [ ] Does route 2 need the fleet process of Phase 3 first, or can the JS loop answer its own per-pass questions in process today? The loop is already one long-lived process per agent.

## Slices

### The pass is measured

- `feature/the-pass-is-measured` — inventories the scripts one agent pass calls, measures today, launcher and in-process variants at 1, 4 and 8 agents by CPU and wall time, and records the chosen route in `docs/shell-and-domain.md` and the story <!-- builds: scripts/measure-pass.mjs, a per-pass cost measurement -->

## Notes

- 2026-10-08: drafted from issue #1406 by an unattended `/plot-idea` run. The issue labels itself *infra*. The prompt for this run gave `Type: feature`, and the plan records the prompt's value, as `the-shell-sheds-its-decisions` did.
- 2026-10-08, deliverable search (`plot-deliverable-search.sh`): `measure-pass` returned nothing. `per-pass cost` found `scripts/measure-tick.mjs`, which measures one supervisor tick rather than one agent pass; the new script follows its shape and does not replace it.
- 2026-10-08, duplicate detection: no plan or branch named `one-agent-pass-costs-what-its` exists. The story's Phase 2 describes this plan.
- 2026-10-08: the machine date (UTC) is 2026-10-08; the story and its first plan carry 2026-10-09.

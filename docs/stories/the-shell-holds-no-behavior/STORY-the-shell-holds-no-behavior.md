---
title: The shell holds no behavior
author: jwloka
status: active
created: 2026-10-09
updated: 2026-10-09
---

# The shell holds no behavior

## Objective

Every `.sh` file under `skills/plot/scripts/` is a launcher: it resolves its bundle and `exec`s it, and holds no other behavior. Decisions, orchestration and readings all live in `@plot-pm/domain` and its adapters. The `.sh` paths stay, because skills, `scripts/owned-run.sh`, `plot-state-gate.sh` and `plot-controller-gate.sh` call them by name.

The fleet runs apart from the board. The supervisor, the registry and the agent loop run without a board process, and the board reads the fleet's state instead of hosting it.

## Why Now

`the-shell-shrinks-into-the-domain` (#1245, Released in v2.23.0) set a narrower target: no shell script decides. It delivered the inventory in `skills/plot/scripts/README.md`, the line ratchet `scripts/check-shell-lines.sh` and one launcher, `plot-deliver.sh`. Measured on `main` at `0b749ca9e`, 2026-10-09: 56 `.sh` files, 35,128 raw lines, and the README table gives 33 *readings*, 16 *decision*, 6 *orchestration* and 1 *launcher*. At one conversion per plan the narrower target alone takes 22 plans, and the readings stay shell after it.

## Decisions Taken in Scoping

- **Every `.sh` becomes a launcher, readings included.** A reading that collects a fact from git, the host or the file system becomes an adapter behind a port. *paired* (a shell rule held against a domain rule by a corpus test) is a step on the way and not a resting state. — jwloka, 2026-10-09
- **The `.sh` files stay as launchers; removing them is not the target.** Callers and both gates name the `.sh` paths. — jwloka, 2026-10-09
- **Per-pass scripts: measure, then decide.** `docs/shell-and-domain.md` keeps a script that runs once per agent per pass in shell, because a Node start costs 34 ms and a bundle answers in 39 ms (measured 2026-09-07). The story measures the real per-pass cost with N agents before the cost rule changes. — jwloka, 2026-10-09
- **The fleet separates from the board entirely.** A long-lived process that answers per-pass questions is the fleet's own process and never the board. — jwloka, 2026-10-09
- **Structure: one story, several plans.** `the-shell-sheds-its-decisions` is the first plan. — jwloka, 2026-10-09

## Current Plan

### Phase 1: The gate and the first two launchers 🔄

- 🔄 [`the-shell-sheds-its-decisions`](../../plans/2026-10-09-the-shell-sheds-its-decisions.md) (#1404, Approved). Slice 1 *The gate counts decisions* is PR #1405. Slices 2 and 3 convert `plot-reap.sh` and `plot-approve.sh`.
- ⏸️ A follow-up slice widens the gate: it counts every row whose kind is not *launcher*, with target 0. *paired* rows count.

### Phase 2: Measure the per-pass cost ✅

- ✅ [`the-pass-is-measured`](../../plans/2026-10-08-one-agent-pass-costs-what-its.md) measured, on a 16-core machine at 1, 4 and 8 concurrent agents, what the launcher variant (bash + launcher + node + bundle) adds in CPU over today's bash-only call, against `plot-worker-loop.sh`'s `readPass` call sites (`plot-config.sh`, `plot-host.sh`, `plot-worker-state.sh` and the rest of the scripts a busy pass reaches) — a trace, not a grep count. `scripts/measure-pass.mjs` holds the measurement; `docs/shell-and-domain.md` §1 holds the table.
- ✅ The measurement decided the route: launcher adds **1750 % CPU per pass at 8 agents**, three orders of magnitude over the fixed 5 % threshold — route 2, answering per-pass questions inside the fleet's own long-lived process. Recorded in the Decisions table below and in `docs/shell-and-domain.md` §1.

### Phase 3: The fleet runs without the board ⏸️

- ⏸️ A plan names every place where the fleet depends on the board today (the supervisor's endpoints, bundles built from `packages/board`, `plot-registryd.mjs`, `plot-worker-loop.mjs`, auto-dispatch) and moves the fleet runtime into its own package and process. The board reads the fleet's state.

### Phase 4: The readings move ⏸️

- ⏸️ One plan per group of reading scripts, each converting its group to launchers over adapters.
- ⏸️ `plot-host.sh` (1,742 code lines) waits for the connector split in `the-build-pipeline-is-its-own-connector`, because `host-shell.ts` shells to it.
- ⏸️ `plot-dispatch.sh` (1,639 code lines) gets a plan of its own.

## Open Points

- ✅ What does one agent pass cost with every per-pass script as a launcher? → Phase 2. 1750 % CPU overhead at 8 agents against the launcher variant — route 2.
- ⏸️ Which board dependencies does the fleet have today, and which process hosts the supervisor after the split? → Phase 3.
- ⏸️ Order of the reading groups in Phase 4. Candidate rule: most callers first.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-09 | PR #1405 merges as built, and a follow-up slice widens the gate | The gate never lets the count rise, so it stays valid under the wider target. Rewriting a finished slice costs more than one more slice. |
| 2026-10-09 | Per-pass scripts take route 2: answer the question inside the fleet's own long-lived process, not as launchers | The fixed threshold was route 1 if the launcher variant added less than 5 % CPU per pass at 8 agents, else route 2. Measured: 1750 % (40 ms today against 740 ms launcher, 16-core machine, medians over 7 runs) — three orders of magnitude over the threshold. |

## Session Log

### 2026-10-09

- Measured the inventory and drafted `the-shell-sheds-its-decisions` from #1404. The plan dropped JS-loop parity (the shell loop went in #1337) and the `plot-worker-state.sh` pair (it exists as `rules/agent-state.ts` with `agent-state.corpus.test.ts`).
- jwloka answered the plan's open questions (*paired* kind, enforced evidence for a relabel), approved it, then widened the target to "every `.sh` is a launcher" and asked for the fleet to separate from the board. This story holds that target.
- The repo's `README.md`, the configured `Story index`, has no *Active Stories* section, so the story is not indexed there.

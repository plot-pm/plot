# The shell sheds its decisions

> CI counts the scripts that still decide, the count may only fall, and `plot-reap.sh` and `plot-approve.sh` become launchers over JS entries.

## Status

- **State:** Delivered
- **Type:** infra
- **Issue:** #1404
- **Story:** the-shell-holds-no-behavior
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-09, jwloka, in-session
- **Started:** 2026-10-09, jwloka, `feature/the-gate-counts-decisions`
- **Started:** 2026-10-09, jwloka, `feature/the-gate-counts-every-script`
- **Started:** 2026-10-09, jwloka, `feature/a-declared-bundle-is-evidence`
- **Started:** 2026-10-09, jwloka, `feature/the-reaper-becomes-a-command`
- **Started:** 2026-10-09, jwloka, `feature/approval-becomes-a-command`
- **Delivered:** 2026-10-09

## Changelog

- CI refuses a change that raises the number of scripts in `skills/plot/scripts/README.md` whose kind is neither *launcher* nor *readings*. The gate compares the table at the merge base with the table after the change and stores no number.
- `plot-reap.sh` becomes a launcher over a JS entry. The reap decision runs in `rules/reapable.ts` and no longer in four `node` heredocs inside the script.
- `plot-approve.sh` becomes a launcher over a JS entry, the second operator command after `plot-deliver.sh`.

<!-- Board impact: none to the plan format, template or docs/plans layout. Each launcher slice adds a bundle under skills/plot/scripts/board/, declared in packages/board/build.mjs and built on main by build-bundles.yml. -->

## Motivation

`the-shell-shrinks-into-the-domain` (#1245, Released 2026-10-04, v2.23.0) set the target: every `.sh` file under `skills/plot/scripts/` is a launcher that resolves its bundle, `exec`s it and decides nothing. It delivered the inventory (the *kind*, *runs* and *replaced by* columns in `skills/plot/scripts/README.md`), the line ratchet `scripts/check-shell-lines.sh` and the first launcher, `plot-deliver.sh`. No follow-up plan exists.

Measured on `main` at `0b749ca9e`, 2026-10-09:

- 56 `.sh` files hold 35,128 raw lines.
- The README table gives 33 *readings*, 16 *decision*, 6 *orchestration* and 1 *launcher*. 22 scripts still decide or orchestrate.
- Only `plot-deliver.sh` fills the *Replaced by* column.
- `plot-worker-loop.sh` is 7 code lines that `exec` `board/plot-worker-loop.mjs`, but its README row still reads *orchestration*.
- `plot-reap.sh` has 489 code lines and contains four `node --input-type=module` heredocs (`:747`, `:986`, `:1109`, `:1192`). That is the shape the ratchet's header says it cannot see: *"a rule moved into a `node -e` heredoc lowers nothing here"*.
- `plot-approve.sh` has 494 code lines and asks `board/plot-transition.mjs` twice (`:353`, `:653`).

`check-shell-lines.sh` measures size and holds the direction. It does not measure where decisions live, and no gate does. The *kind* column records that, and nothing reads the column.

## Design

### Approach

**Three slices: a gate, then two launchers.** The gate comes first, for the reason the predecessor's ratchet came first: a migration with no gate loses to the next brief. The reaper comes before approval, because each slice holds one branch and the two may add writes to the same ports.

**Slice 1: the gate counts decisions.** A check script reads the *Kind* column of the README script table at the merge base and at `HEAD`. It counts the rows whose kind is none of *launcher*, *readings* or *paired*, and it fails when the count at `HEAD` is higher. Like `check-shell-lines.sh`, it stores no number, takes the CI event as a mode argument (`pr`, `push`) and fails when it cannot read the base. A new script row with kind *decision* or *orchestration* raises the count, so a new deciding script pays by converting another one in the same change. The slice also corrects the `plot-worker-loop.sh` row to *launcher*, replaced by `board/plot-worker-loop.mjs`, and that correction lowers the count from 22 to 21. The brief decides whether the check is a sibling script or a mode of `check-shell-lines.sh`. The deliverable search found no existing check of that kind.

**What the gate counts is a label, and a label can be wrong.** The gate counts what the README says. It does not read the scripts. `plot-approve.sh` merges a plan PR, flips the phase and pushes `main`, and its row reads *readings*. Changing *decision* to *readings* in a row lowers the count without moving a rule. The slice therefore makes a change of kind toward *readings* or *launcher* name its evidence in the same row: for *launcher*, the bundle in *Replaced by*; for *readings*, the bundle that holds the decision. The brief decides whether the check enforces this or leaves it to the reviewer, and records the choice.

**Slice 2: `plot-reap.sh` becomes a launcher.** It runs once per operator command, so the cost rule in `docs/shell-and-domain.md` permits a JS entry. `rules/reapable.ts` already holds the reap rule, and the four heredocs import it. The entry goes under `packages/board/src/server/entry/` and follows `deliver.ts`. It reads through adapters, and its decisions stay in `packages/domain/src/rules/` with unit tests. `scripts/check-script-names.sh:141` says *"no port answers this yet. Removing a desk is a `trees` write beside `add` and `prune`"*, so the slice adds that write to the `trees` port. `plot-pr-merged.sh`, `plot-desk-root.sh` and `plot-desk-dirt.sh` are sourced by other scripts as well, and they stay. The launcher keeps the name and the arguments (`--dry-run`, `--yes`, `--max N`, `--sweep-temp`), because `scripts/owned-run.sh` and the skills call the `.sh` path. It exits 2 with the missing-bundle message that `plot-deliver.sh` uses.

**Slice 3: `plot-approve.sh` becomes a launcher.** It runs once per operator command, and `plot-deliver.sh` is the template. `scripts/check-script-names.sh:139` says *"Approving is a plan lifecycle write and `plan-store` reads only"*, so the slice adds the write that `deliver.ts` already needed, or reuses it if that slice added one. The launcher keeps the receipt contract. `plot-state-gate.sh` accepts a `State:` change only from a script that leaves a `plot-state-receipt.sh` receipt, and `plot-controller-gate.sh` refuses `plot-approve.sh` invoked with no controller receipt. Both gates name the `.sh` path, so the launcher keeps that name. The row's kind becomes *launcher* and does not lower the decision count, because the row reads *readings* today. Slice 1's evidence rule exists for this case.

**Out of scope, with the reason.**

- **The issue's slice 1, JS loop parity (#1312, #1392, #1375).** `f60a9da75` (*The shell loop goes*, #1337) deleted the shell loop. `plot-worker-loop.sh` is now the 7-line launcher, so no second loop can disagree with the JS one. #1312 and #1375 are defects of the JS loop, and #1392 is about the double-claim sweep. None of them blocks a change to `plot-reap.sh` or `plot-approve.sh`. Each stays an issue of its own. `2026-10-08-a-blocked-agent-s-question-has` (Delivered) names #1375 in its `Issue:` field, and the issue is still open.
- **The issue's slice 4, the `plot-worker-state.sh` rule and its corpus pair.** These already exist. `rules/agent-state.ts` exports `agentState`, `board/plot-agent-state.mjs` reaches it, and `packages/domain/corpus/agent-state.corpus.test.ts` compares it with `plot_worker_state` on every desk on the machine. The README row still reads *decision*. The open question below covers how the gate counts a declared duplicate.
- **`plot-host.sh` (1,742 code lines).** `host-shell.ts` shells to it, so a move is circular until `the-build-pipeline-is-its-own-connector` removes the `DRIVES` list at `host-shell.ts:30`.
- **`plot-fleet-scan.sh` (1,452) and `plot-plan-meta.sh` (547).** These run once per agent per pass, so the cost rule keeps them in shell, with corpus pairs.
- **`plot-dispatch.sh` (1,639 code lines).** It has the largest payoff and needs a plan of its own.

### Open Questions

- [x] Which kind does a declared duplicate take? — *answered 2026-10-09, jwloka: a kind of its own, **paired**.* A row qualifies for *paired* when it names the domain rule export and the corpus test that holds the pair. The gate does not count *paired* rows, so its floor is 0. `plot-worker-state.sh` (`rules/agent-state.ts`, `agent-state.corpus.test.ts`) moves to *paired* in slice 1 and names both.
- [x] Does slice 1 enforce the evidence rule for a change of kind? — *answered 2026-10-09, jwloka: enforce.* The gate refuses a row whose kind changes to *launcher*, *readings* or *paired* without its evidence: the bundle in *Replaced by* for *launcher*, the bundle that holds the decision for *readings*, the rule export and corpus test for *paired*. A row mislabelled from the start is corrected by naming the bundle that already exists.

## Slices

### The gate counts decisions

- `feature/the-gate-counts-decisions` — a CI check counts the README rows whose kind is neither *launcher* nor *readings* at the merge base and at `HEAD`, and fails when the count grows; the `plot-worker-loop.sh` row becomes *launcher* → #1405 <!-- builds: a decision-count gate over the README kind column -->

### A declared bundle is evidence

- `feature/a-declared-bundle-is-evidence` — the decision gate accepts a bundle that `packages/board/build.mjs` declares, with its entry source present, as evidence for *launcher* and *readings*, so a conversion PR can flip its row in the same change that adds the bundle → #1414 <!-- builds: declared-bundle evidence in check-decision-count.sh -->

### The gate counts every script

- `feature/the-gate-counts-every-script` — the decision gate counts every README row whose kind is not *launcher*, *paired* included, so its target is 0 and a reading script counts like a deciding one (story `the-shell-holds-no-behavior`) → #1416 <!-- builds: a wider count in the decision gate -->

### The reaper becomes a command

- `feature/the-reaper-becomes-a-command` — `plot-reap.sh` becomes a launcher over a JS entry that asks `rules/reapable.ts`; desk removal becomes a `trees` port write → #1432 <!-- builds: a JS reap entry and a trees-port desk removal -->

### Approval becomes a command

- `feature/approval-becomes-a-command` — `plot-approve.sh` becomes a launcher over a JS entry modelled on `deliver.ts`, and it keeps the receipt contract with both gates → #1446 <!-- builds: a JS approve entry -->

## Notes

- 2026-10-09: drafted from issue #1404 by an unattended `/plot-idea` run. The issue proposed five slices. This plan keeps three of them and records why the other two are out of scope. The issue labels itself *infra*. The prompt for this run gave `Type: feature`, and the plan records the prompt's value.
- 2026-10-09: the issue gives the README kinds as 31 *readings* and 15 *decision*, which totals 53 for 56 scripts. A recount at `0b749ca9e` gives 33 *readings*, 16 *decision*, 6 *orchestration* and 1 *launcher*.
- 2026-10-09, deliverable search (`plot-deliverable-search.sh`): `plot-reap.mjs`, `entry/reap`, `plot-approve.mjs`, `entry/approve` and a decision-count check returned no existing artifact. The search found only `check-script-names.sh:139` and `:141`, which name the missing write ports quoted above.

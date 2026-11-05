# A second mode flag in plot-fleetctl.sh replaces the first

> `plot-fleetctl.sh --start --stop` runs the `--stop` arm, because each mode flag assigns `mode=` again and the last one wins; two different mode flags in one call should refuse with exit 1 before any side effect.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3119
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3128 merged
- **Started:** 2026-11-05, Jan Wloka, `feature/a-second-mode-flag-in-plot`

## Changelog

- `plot-fleetctl.sh` refuses two different mode flags in one call. `--start --stop` and `--stop --start` exit 1 before the first side effect, and the message names both flags. Before this change the last flag won, and `--start --stop` stopped the fleet.

Board impact: none. The one package caller, `packages/board/src/server/supervisor-reading.ts:152`, passes `['--status']` alone. No payload field and no board source changes.

## Motivation

Issue #3119, found by the safety juror of the panel on `docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md` (finding 2). That plan keeps this out of its slice.

The argument loop in `skills/plot/scripts/plot-fleetctl.sh` (the `while [ $# -gt 0 ]` loop after `wait_bound=30`) assigns `mode=` in each of the `--status`, `--once`, `--start` and `--stop` arms. The last mode flag wins and nothing reports the conflict. `plot-fleetctl.sh --start --stop` runs the `--stop` arm (`if [ "$mode" = "stop" ]`): it calls `plot-dispatch.sh --stop` for every running desk, writes `.plot/state/fleet-stopped.json`, unloads the supervisor and removes the start marker. An operator who typed `--start` first gets a stop. `plot-fleetctl.sh --stop --start` runs the `--start` arm: it fills and loads the unit and starts agents.

Line numbers on `origin/main` at `fbf670eaf`, for orientation only: the loop is `:771-793`, the mode assignments `:773`, `:774`, `:777`, `:782`, the mode-required line `:795`, the `--stop` arm `:1276`. The sibling slice edits this file first, so the slice finds every site by its content, never by these numbers.

## Design

### Approach

**Merge the four mode arms into one arm that refuses a second, different mode.** The loop's `--status`, `--once`, `--start` and `--stop` arms become one arm:

```bash
    --status|--once|--start|--stop)
              [ -z "$mode" ] || [ "$mode" = "${1#--}" ] || { echo "plot-fleetctl: --$mode and $1 are different modes; give one; nothing was done" >&2; exit 1; }
              mode=${1#--}
              case "$1:${2:-}" in
                --start:|--start:*[!0-9]*) ;;
                --start:*) start_count="$2"; shift ;;
              esac ;;
```

- **The check runs while the loop reads arguments**, so it exits before `plot_repo_root`, any `launchctl`/`systemctl` call, any bundle call and any `plot-dispatch.sh` call. The refusal writes nothing.
- **The message names both flags in the order given**: `plot-fleetctl: --start and --stop are different modes; give one; nothing was done`. It goes to stderr with exit 1, the same shape as the unknown-argument refusal in the same loop.
- **The same flag twice passes** (`--stop --stop` runs `--stop` once).
- **`--start N` keeps working.** Only a bare number after `--start` is consumed, as before; `--start --dry-run` still reads `--dry-run` as a flag. `--stop 3` still refuses as `unknown argument '3'`, as before.
- **A mode added later** joins the arm's pattern list and gets the check with no new line.
- **One comment line** above the merged arm states the rule: `# Two DIFFERENT mode flags refuse; the same flag twice is one mode.` The usage header (`:2-27`, printed by `-h`) does not change, so the sibling's `-h` range fix stays correct.

A prototype of this arm was run under `bash` against `--start 3`, `--stop --stop`, `--start --stop`, `--stop --start`, `--status --once`, `--start 3 --stop`, `--start --dry-run`, `--start x` and `--stop 3`; each gave the result this section states.

**Relation to `2026-11-04-plot-fleetctl-stop-ignores-dry-run` (#3099).** That plan is Approved and Started on `feature/plot-fleetctl-stop-ignores-dry-run`. It edits the `-h` arm of the same loop, adds a `--dry-run` refusal after the mode-required line, and inlines `running_major()` and `home_short()` as its shell-lines offset. This slice carries `<!-- waits: feature/plot-fleetctl-stop-ignores-dry-run -->` on its branch line, so the fleet does not offer it until that branch's PR merges (`plot-plan-meta.sh` reads `waits:` into `waits_on`; a waited-on branch with no PR reads `blocked`). The slice starts from a `main` that holds the sibling's change. After both land, `--start --dry-run --stop` refuses on the mode conflict first, and the sibling's post-loop `--dry-run` refusal reads one unambiguous `$mode`. The sibling's text "`--stop --dry-run --start` previews a start" stops being true; its tests each pass one mode, so none breaks.

### Exit code

Exit 1 is shared with `--status`'s "supervisor not loaded" answer (usage header `:7-10`). This is safe: the only package caller, `supervisor-reading.ts:152`, passes `['--status']` alone and cannot reach the refusal, and every `plot-fleetctl.sh` call in `skills/plot-fleet/SKILL.md` and in `plot-fleetctl.sh` itself passes one mode. The `plot-fleetctl:` stderr prefix tells a refusal from a status answer.

### Shell-lines offset

`scripts/check-shell-lines.sh` refuses any growth of the command count under `skills/`. The merged arm pays for the refusal inside the loop, so no other code moves. Measured with the gate's own awk (`COUNT_AWK`) on `origin/main` `fbf670eaf`:

| scope | before | after |
|---|---|---|
| the `while` loop (`:771-793`) | 46 | 43 |
| `plot-fleetctl.sh` | 1089 | 1086 |

Net: −3. The sibling's edits to the loop (`-h` range) do not change the loop's count, so the net holds on the post-sibling base. The slice re-measures with `./scripts/check-shell-lines.sh --per-file` before and after, and states both counts in the PR body.

**Not candidates for any offset**: `running_major` and `home_short` (the sibling takes them), `desk_running` (the `--stop` arm passes it to `poll_while` as a callback), `process_cwd` and `plot_process_candidates` (they decide which processes belong to this repository), and every line of the `--stop` arm. If the merged arm does not reach net ≤ 0 on the real base, the slice inlines `tick_age_seconds()` into its one caller in the `--status` arm (`tick_age=$(tick_age_seconds)`), held by `--status carries the tick age on the running summary line, and only with a log`, `--status reads the tick age from registryd.log while fleetd.log is absent` and `--status prints no tick age outside the running arm`; it touches nothing else.

### Tests

All new cases go in `test/reconcile/fleetctl.test.mjs`, built from the existing `sandbox()`, `run()`, `fakeHome()`, `armedMarker()`, `stubUnload()` and `signalOwn()` helpers. Every conflict case asserts the stderr message, not only exit 1: before the change, `--stop --start` reaches `--start` arm refusals that also exit 1.

1. `a second mode flag refuses: --start --stop signals no agent, writes no record, unloads nothing`. Fixture: a desk with a live `sleep 30` worker and a `plot-dispatch.sh` stub that appends to `calls.log`, as in `--stop calls plot-dispatch --stop once per branch, and the supervisor last`; plus `armedMarker(root)`, `stubUnload(box, { workdir: root })` and `fakeHome(box, { unit: true, label: fleetLabel })`, as in `--stop polls the unload past a still-loaded first answer, clears the marker, exits 0`. Assert: exit 1; output matches `/--start and --stop are different modes/`; `calls.log` does not exist; `<box>/unload-ticks` does not exist; `.plot/state/fleet-start.done` still exists; `.plot/state/fleet-stopped.json` does not exist. Clean the sleeper with `signalOwn`. On `main` the run records `dispatch --stop feature/a`, so the case fails.
2. `a second mode flag refuses: --stop --start fills no unit, loads nothing, starts no agent`. Same fixture, with `fakeHome(box)` (no unit) and `PLOT_FLEET_LABEL: fleetLabel`. Assert: exit 1; output matches `/--stop and --start are different modes/`; no unit file under the fake HOME; `calls.log` holds no `dispatch --start` line; the stub init system recorded no bootstrap or load; `calls.log` holds no `dispatch --stop` line either. On `main` the message is absent, so the case fails.
3. `a second mode flag refuses: --status --once`. Assert exit 1 and `/--status and --once are different modes/`. On `main` the run execs the stub `plot-fleetd.mjs` and exits 0.
4. `a second mode flag refuses: --start 3 --stop names --start, not the count`. Assert exit 1 and `/--start and --stop are different modes/`.
5. `the same mode flag twice is one mode: --stop --stop`. Nothing running. Assert exit 0, the `--stop` report (as in `--stop with nothing running still reports, and does not invent an agent`), and no `different modes` text. Green before and after.
6. `--start N still takes its count: --start 3 --dry-run`. Assert exit 0, output matches `/plot-dispatch\.sh --start 3$/m` (the `--dry-run` preview line), and no `different modes` text. Green before and after; it holds the count consumption that the merged arm rewrites.

Regression cases that stay green: `fleetctl: no verb is a refusal, not a default`, `fleetctl: an unknown argument is named rather than ignored`, `fleetctl: --wait takes a number`, `--dry-run reports the state it would act on, and writes nothing`, and the sibling's four `--dry-run` cases.

**Red first.** The slice runs cases 1–4 against the base before the fix, confirms each fails, and names the failing assertion of each in the PR body.

**Mutation check.** After the fix passes, the slice deletes the conflict line from the merged arm, runs case 1, and confirms it fails on the `calls.log` or `unload-ticks` assertion. It restores the line from git (`git checkout -- skills/plot/scripts/plot-fleetctl.sh` after committing the fix), and states the result in the PR body.

### Changeset

One changeset, `'plot': patch`, description first: "`plot-fleetctl.sh` refuses two different mode flags in one call, and names both, before it acts." The `bumps:` block last names `plot: patch`.

### Checks

Before each push:

- `node skills/plot/scripts/board/plot-local-checks.mjs`, and run what it prints.
- `./scripts/check-shell-lines.sh pr` — must pass with net ≤ 0.
- `./scripts/check-bash32-syntax.sh`.
- `node --test --test-name-pattern 'mode|--wait|unknown argument|no verb|--dry-run' test/reconcile/fleetctl.test.mjs` — the names the slice touches; a whole-file run can stall.

No board source changes, so `pnpm run typecheck` and `test:board` are not required.

### Decisions

- **`--stop --stop` passes as one mode** (caller). The issue names two *different* mode flags, and a repeated flag does no harm.
- **`--start 3` keeps working** (caller). Only a bare number after `--start` is consumed.
- **Two different mode flags refuse with exit 1 before any host, init-system or bundle call, and the message names both** (caller). Exit 1 is shared with `--status` "not loaded", which is safe for the reason in *Exit code*.
- **The order against the sibling plan is a `waits:` annotation** (caller), not prose.
- **The offset is the merged mode arm** (caller offered it; the measurement chose it). It pays −3 inside the loop and moves no other code, so it cannot collide with the sibling's offset.
- **`-h` keeps exiting 0 in its own arm** (plan author, kept). `--start -h` prints the usage and exits 0; `--start --stop -h` refuses on the conflict first, because the loop reads left to right. Reason: `-h` acts on nothing, and the conflict is the first fact the loop finds.
- **The usage header does not change** (amender). Reason: a header line moves the `-h` print range the sibling fixes; the rule lives in a comment above the arm instead.
- **The same defect in `plot-boardctl.sh` and `plot-dispatch.sh` is out of scope**, filed as #3138.

## Slices

### Refuse two mode flags

- `feature/a-second-mode-flag-in-plot` <!-- waits: feature/plot-fleetctl-stop-ignores-dry-run --> — merge the four mode arms of the `plot-fleetctl.sh` argument loop into one arm that refuses a second, different mode with exit 1 and a message naming both flags (net −3 shell commands); six cases in `test/reconcile/fleetctl.test.mjs` per *Tests*, red first and a mutation check; one changeset. → #3168

## Notes

- Created from issue #3119 by `/plot-idea` with `PLOT_UNATTENDED=1`. Stops at Draft.
- Deliverable search for "plot-fleetctl.sh mode flag conflict refusal" found no existing mode-conflict refusal in the estate.
- Round 1 panel (layering, safety, testability, seams): unanimous amend. Moderation in `.plot/panels/2026-11-04-a-second-mode-flag-in-plot/panel.md`.
- Follow-up: #3138, the same last-flag-wins defect in `plot-boardctl.sh:243-245` and `plot-dispatch.sh:310-333`.
- The sprint file `docs/sprints/2026-W45-follow-ups-2-30-1.md` on `origin/main` does not list this plan yet, while its `Sprint:` field names that sprint. The sprint line belongs to the sprint controller at approval.

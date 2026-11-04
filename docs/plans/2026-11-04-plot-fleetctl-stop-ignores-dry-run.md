# plot-fleetctl --stop ignores --dry-run and stops the fleet

> `plot-fleetctl.sh --stop --dry-run` signals every agent, unloads the supervisor and removes the start marker, because the parser accepts `--dry-run` with every mode and only `--start` reads it.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3099
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-fleet --stop --dry-run` no longer stops the fleet. It refuses the combination, names the modes that accept `--dry-run`, and exits non-zero before it signals an agent.

Board impact: none. No board or package source passes `--dry-run` to `--stop`, and no payload field changes. The change touches one helper script, its tests, and two documents.

## Motivation

Measured 2026-11-03 by the safety juror of the panel on `docs/plans/2026-11-03-plot-fleetctl-stop-unloads-another-checkout.md` (#3060), which keeps this out of its slice. Issue #3099 records the evidence.

The parser sets `dry_run=1` for `--dry-run` in any mode. On `origin/main` at `e54e53815`, `dry_run` is read at three places in `skills/plot/scripts/plot-fleetctl.sh`: `:654` (`retire_old_label`), `:1146` (the `--start` arm) and the declaration at `:764`. The `--stop` arm reads none of them. `--stop --dry-run` therefore runs `plot-dispatch.sh --stop <branch>` for every claimed branch, writes the stop record, calls `unload_supervisor` (`launchctl bootout`) and removes the start marker. It also unloads the configured label for real while `retire_old_label` only reports the old label.

The usage text (`:5`) and `skills/plot-fleet/SKILL.md:44` document `--dry-run` with `--start` only. Nothing tells an operator that `--stop` ignores the flag, and an operator who types it expects a preview.

Line numbers drift: the issue cites `791be809d`, and this plan re-read them on `e54e53815`. The slice re-reads them again before it edits.

## Design

### Approach

**Refuse the combination, do not preview.** `--dry-run` is accepted only with `--start`. Any other mode with `--dry-run` prints one line that names the flag, the mode and the one mode that accepts it, and exits 1 before the first side effect. The check sits directly after the argument loop, so it holds for every arm and for any arm added later.

Reasons to refuse rather than preview:

- A preview of `--stop` needs a second code path through a 150-line arm (`:1252-1405` in the issue's reading) whose steps each have a dry-run twin to keep in step. `scripts/check-shell-lines.sh` ratchets the shell's line count against the merge base, so a preview pays in lines removed elsewhere; a refusal costs about four lines.
- The expected behaviour in the issue allows either. A refusal also covers `--once` and `--status`, which accept the flag today and ignore it.

**The gate is a test, not prose.** A contract test in `test/reconcile/` runs `--stop --dry-run` in a sandbox with a loaded supervisor and a claimed branch, and asserts three facts: exit status 1, no agent signalled (the dispatch stub records no call), and the supervisor still loaded. A mutation check removes the new line and confirms the test fails.

**Documents state the rule.** The usage block at `:2-5` and the `--dry-run` row of `skills/plot-fleet/SKILL.md:44` say `--dry-run` is `--start` only and that other modes refuse it.

### Open Questions

- [ ] Does any caller pass `--dry-run` with `--once` or `--status` on purpose? Search `skills/`, `packages/` and `docs/` before the refusal covers them. If one does, restrict the refusal to `--stop` and leave the other modes as they are.
- [ ] Is a real `--stop` preview wanted later? If yes, it becomes its own plan, and this plan's refusal is the safe state until then.

## Slices

### Refuse dry-run outside start

- `feature/plot-fleetctl-stop-ignores-dry-run` — refuse `--dry-run` with any mode but `--start` before the first side effect; contract test; usage text and `skills/plot-fleet/SKILL.md` <!-- builds: a mode check for --dry-run in plot-fleetctl.sh -->

## Notes

- Created from issue #3099 through `/plot-idea`, unattended. Review `pr` and Impl `own branches` follow the repo's `Plan PRs: required`; the design question was not answered in the prompt, so the plan starts in Draft.
- Deliverable search for "plot-fleetctl --stop --dry-run" found only citations in comments, no existing mode check.
- The sibling plan #3060 edits the same `--stop` arm. Its slice is delivered, so this slice starts from its result.

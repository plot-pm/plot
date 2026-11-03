# Layering juror — plot-fleetctl --stop unloads another checkout's supervisor

Position: amend

## Summary

The plan fixes the right defect at the right point in time (before the agent loop, before `bootout`). Its layering claim is half true. It reuses the READING (`supervisor_checkout`), but it adds a third, shell-only MAPPING from that reading to an action. The domain already owns the same kind of mapping for the old label (`oldLabelAction`), and `plot-fleetctl.sh` is a once-per-operator-command script, which `docs/shell-and-domain.md` §1 says calls the domain. As written, the plan also refuses every `--stop` whose supervisor is not loaded, which breaks an existing path and an existing test.

## Findings

1. **The domain already owns a supervisor-ownership rule, and the plan does not mention it.** `packages/domain/src/rules/old-label-migration.ts` exports `oldLabelAction(reading, verb)`. Its input type `OldLabelReading` is exactly `supervisor_checkout`'s line (`this <path>` / `another <path>` / `unknown`). `packages/board/src/server/entry/old-label.ts` parses that line and ships as `skills/plot/scripts/board/plot-old-label.mjs`. `plot-fleetctl.sh:607-611` (`old_label_action`) pipes `supervisor_checkout` into it, and `retire_old_label` (`:623`) acts on the answer. So the estate has already moved one "which checkout does this job serve, and what may this verb do about it" decision into the domain. The plan's Notes say "Nothing else by that name duplicates the slice", which is true by name and misses this rule by meaning.

2. **The plan adds a decision in shell, not only a call.** The plan says the check "is a call to an existing function, so no new duplicate of a domain rule appears". `supervisor_checkout` (`:238-249`) only reads. The decision is the `case` that maps `this`/`another`/`unknown` to stop/refuse/refuse. Today that mapping exists in shell once, inside `--start` (`refuse_label`, `:1102-1109`). The slice writes a second copy in `--stop`. Its policy also differs from the domain's old-label policy: for the old label, `retire` maps `another` to `leave` (skip silently), while the plan maps `another` to a refusal with exit non-zero for the configured label. Both policies are defensible. The point is that they now live in two languages, and no test sets them side by side.

3. **`refuse_label` cannot be reused as the plan says.** It is a function defined inside the `if [ "$mode" = "start" ]` arm (`:1013`, defined at `:1102`), so the `--stop` arm (`:1252`) cannot call it unless it is hoisted. Its `unknown` branch prints `$plat`, which only `--status` (`:781`) and `--start` (`:1067`) set; `--stop` sets no `$plat`. Its `this` text ("The fleet is already supervised here … To restart it: /plot-fleet --stop") is wrong for a stop. "Reuses the wording of `refuse_label`" therefore needs a decision the plan does not make: hoist and parameterise it by verb, or print the stop wording separately.

4. **Refusing `unknown` without a `supervisor_loaded` guard breaks the stop path.** `supervisor_workdir` prints nothing for a label launchd does not hold (comment at `:232-237`: "EMPTY IS `unknown`"), so a not-loaded supervisor reads `unknown`. The plan says the check runs before the agent loop and refuses `unknown`. As written, `--stop` then refuses whenever the supervisor is down, and no agent is stopped. Today that case stops every agent and prints `supervisor was not loaded` (`:1364` region). `test/reconcile/fleetctl.test.mjs:419` ("--stop with nothing running still reports…") runs under a `launchctl` stub that answers `exit 113` (`:221`), so it reads `unknown` and would fail. `--start` guards its own check with `supervisor_loaded &&` (`:1107`); the stop check needs the same guard.

5. **The shell-lines ratchet is not addressed.** `scripts/check-shell-lines.sh` refuses any net growth of shipped shell against the merge base and has no exemption. A shell-only fix adds a `case`, a hoisted function and refusal text to `plot-fleetctl.sh`. The plan does not say which lines pay for them. A domain rule that both `--start` and `--stop` call shrinks `refuse_label`'s `case` and can pay for itself.

6. **The trailing `retire_old_label` at the end of `--stop` (`:1391`) is already domain-routed.** A domain fix for the configured label makes `--stop` consistent with its own last step. A shell fix leaves one arm of `--stop` deciding in TypeScript and the other in bash.

7. **Open question 1 is a separate reading, not part of this slice.** Finding a job under another label whose working directory is this checkout means enumerating loaded jobs. `retire_old_label` does not do that; it asks one known label. The closest existing reading is `plot_processes_block` (`:381`), which finds supervisors by process. That is a new reading with its own failure modes and belongs in its own plan or slice.

8. **Open question 2 has a factual answer.** `--stop` writes no `State:` line and is not one of the controller actions in CLAUDE.md's list, so no state or action receipt applies. The refusal prints and exits non-zero.

## Amendments required

1. **Put the reading-to-action mapping in the domain.** Add a rule beside `oldLabelAction` (for example `labelAction(reading, verb)` with verbs `start` and `stop`, or extend `old-label-migration.ts` with a label kind), unit-tested in `packages/domain/test/`. Reach it through a bundle that reads `supervisor_checkout`'s line on stdin, as `plot-old-label.mjs` does: either new verbs on that bundle, or a sibling entry with a row in `skills/plot/scripts/README.md`. Both `--start` (refusal 4) and `--stop` call it, so the shell keeps one `case` over the rule's answer word and the wording only. A missing or silent bundle refuses through `broken_install` and unloads nothing. If a person rejects this, the plan must instead say plainly that the slice adds a shell decision and must name the lines that pay for it under `check-shell-lines.sh`.
2. **Guard the check with `supervisor_loaded`.** Only a LOADED label is asked which checkout it serves. A not-loaded label keeps today's path: agents are stopped and `supervisor was not loaded` is printed. Name `fleetctl.test.mjs:419` as a test that must stay green.
3. **Decide the refusal text's home.** State whether `refuse_label` is hoisted to top level and takes the verb, and where `$plat` comes from in `--stop` (call `platform` directly, or set `plat` in the arm).
4. **Close both open questions before approval.** Move question 1 to a follow-up issue. Answer question 2 with "no receipt: `--stop` writes no `State:` line".
5. **Name the test assertions.** For `another` and `unknown` on a loaded stub: exit non-zero, the stderr names the served path or the `launchctl print` command, the `launchctl` stub records no `bootout`, `plot-dispatch.sh --stop` is never called, and the start marker is kept. For `this`: today's output, unchanged. Each fails on `origin/main` today, because the `--stop` arm boots out without reading the checkout.

## Decisions that need a person

- Domain rule versus shell `case`. Precedent (`plot-old-label.mjs`) and `docs/shell-and-domain.md` §1 point to the domain. A person may accept the shell `case` for a three-way map, but that acceptance must be written into the plan with its shell-lines payment, so an agent does not decide it.
- On `another`, should `--stop` still stop THIS checkout's agents? The plan refuses everything. That is the conservative choice, because another supervisor under another label may restart them, but it is a policy choice and the issue does not settle it.

## What I ran versus what I read

- Ran: `git show origin/main:skills/plot/scripts/plot-fleetctl.sh` (1405 lines) and `grep`/`sed` over it; `git grep` for `old-label`, `oldLabel` and `unload-and-remove` over `packages/`, `scripts/` and `skills/plot/scripts/`; `git ls-tree` for supervisor and label files under `packages/`; `git show` of `old-label-migration.ts`, `entry/old-label.ts`, the `README.md` row for `plot-old-label.mjs`, the head of `check-shell-lines.sh`, the head of `docs/shell-and-domain.md`, and a grep over `test/reconcile/fleetctl.test.mjs`; `gh issue view 3060`.
- Read only: the `fleetctl.test.mjs` case bodies (only the titles and stub lines were seen; the claim about `:419` follows from the `exit 113` default stub at `:221` together with the plan's unguarded `unknown` refusal, and no test was run); the systemd arm (unverified, as the script's own comment at `:200` says).

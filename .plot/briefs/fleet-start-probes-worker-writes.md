## Implementation brief — an-agent-refused-every-write-ends (wave 3: Probe)

- **Plan (canonical):** `docs/plans/2026-10-24-an-agent-refused-every-write-ends.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2509 merged
- **Branch:** `bug/fleet-start-probes-worker-writes` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Waves 1 (`bug/refused-writes-end-as-permission-denied`, #2545) and 2 (`bug/loop-writes-blocker-for-refused-agent`, #2599) are merged. This branch waits on neither. Wave 4 (`bug/claim-only-branch-returns-to-queue`) waits on wave 1 only, so it is eligible in parallel; it owns claim release and desk reaping, and this branch owns none of that.

### What to build

Observed 2026-10-23 in ewz-kus-portal: a `claude -p` worker command with no `--permission-mode` and no settings file allowing Edit, Write and Bash. Three slices were handed over, the harness refused every write of each agent (13, 5 and 4 calls), and the claims were already pushed. Waves 1 and 2 make that failure readable after the fact. This wave stops it before the claim exists: `plot-fleet --start` and `--once` run one `-p` command that touches a file in a scratch desk, and when the write fails the fleet refuses to hand over, so no claim ref is pushed for an agent that cannot write.

The two entry points, read on 2026-10-26:

- `skills/plot/scripts/plot-fleetctl.sh` `--start` (around `:1002`) refuses in numbered steps (REFUSAL 1 no artifact, 2 wrong node, 2b no harness, …) before it fills and loads the unit, then calls the dispatch script's `--start`. The probe is one more refusal in that sequence, placed before `launchctl bootstrap` so a refused start leaves no loaded unit. `--dry-run` must report the probe it would run and run nothing.
- `--once` is `exec node "$fleetd" --once` (`:994-999`): the shell hands over to `packages/fleet/src/server/entry/registryd-main.ts` and decides nothing. The probe for `--once` therefore lives behind that entry point (`startAgents` there is the flag that lets a tick hand a slice over), not in the launcher.

### Decisions the plan settles — do not re-derive them

**The rule is in the domain, the run is in an adapter.** The question "did the probe prove the command can write, and so may a claim be pushed" is a decision, so it takes the probe's result as a value and answers refuse or proceed (layering rule: controller → domain → port ← adapter; *a shell script asks the domain*). The `-p` run and the scratch-desk file check are the only code that reaches the world, and they sit in an adapter behind a port the domain owns. The shell launcher may call the bundle and may not hold the rule. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, with no number stored and no override: a probe written as shell in `plot-fleetctl.sh` must pay for itself with removed shell in the same change, and the cheaper way is a bundle call.

**Absent is not false.** A probe that cannot run (no harness on `PATH`, the scratch desk cannot be cut, the command times out) did not observe a refused write. It answers `unanswerable`, never `refused`, and the two lead to different messages. Only an observed absence of the touched file, after the command exited, is a refused write. The same rule as `permissionDenials` in `agent-loop.ts`: `yes` / `no` / `unanswerable`.

**The scratch desk is not the claim.** The probe cuts its own scratch directory (a detached worktree or a temp directory under the run's private `TMPDIR`) and removes it by the exact name it created. It pushes no ref, writes no manifest and touches no registry entry. Remove by the exact path `mkdtempSync` returned, never by a glob over the shared temp directory (`test:contracts` fails a run on a leaked `plot-run.*` entry).

**The refusal names its cause.** Reading `rules/ending-action.ts` on `permission-denied`: the board already says "agent was refused every write — check the worker command's permissions". The probe's refusal uses the same cause and the same advice, so one fault has one wording.

### Open questions this slice must answer, and say so in the PR

The plan's third open question: probe per fleet start, or per registered worker command, given a project can declare several. The Plot Config in this repo declares a `Worker command` and one command per role (`Idea`, `Story`, `Brief`, `Implement`, `Interrogate`, `Verify`, `Design`), all `claude -p` with `--permission-mode bypassPermissions` except the worker. Which of these writes to a desk and so matters to a claim was not checked when this brief was written. Measure which roles run in a desk (grep `usableCommand` and `Worker command` callers in `packages/fleet/src/shared/`) before choosing. The smallest answer that closes the observed failure is the command the loop runs for the slice, because that is the one that held the claim on 2026-10-23. Probing every declared command costs one `-p` start each (seconds and tokens, per start), so a decision to probe more than one needs the measurement that justifies it.

Also decide and state: a probe costs one model call. `--once` is described as free in `skills/plot-fleet/SKILL.md` ("`--once` first; it is free"). If the probe makes `--once` spend, the skill text and README change in this branch, and the probe should be skipped when a recent probe of the same command and settings already passed. Say which.

### Done when

The plan has no `## Done when` list; its Changelog line and the Probe item of the Approach are the specification: *`plot-fleet --start` and `--once` run one `-p` command that touches a file in a scratch desk, and refuse to push a claim when the write fails.* Assertions a naive implementation would pass without:

- A worker command whose settings deny writes makes `--start` exit non-zero **before** the unit is loaded and before any ref is pushed. Catches a probe that reports the failure but runs after `launchctl bootstrap` or after the dispatch call. Assert on the absence of the loaded unit and of a pushed ref, not only on the exit code.
- A command that can write passes, and the scratch directory is gone afterwards. Catches a probe that leaks desks, and a probe that passes on a command that never ran.
- A command that cannot be started answers `unanswerable` with its own message and does not claim a permission fault. Catches the absent-is-false collapse.
- `--dry-run` runs no `-p` command and creates no scratch directory.
- `--once` with a refused probe starts no agent and pushes no claim, and a `--once` run without `--start-agents` is unchanged.
- The corpus rule applies if any part of the decision is duplicated between shell and TypeScript: a duplicated rule joins `packages/domain/corpus/` and a disagreement stops the branch.

Plus: a changeset (`plot` and `bumps:` for `plot-fleet` if the skill text changes; description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Domain code is arrow functions with factual TSDoc and no decision history in comments. A new test helper is an arrow too. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite locally, and not `test:e2e`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Probe` in the plan's `## Slices`. Push the first real commit as soon as it exists. Update `skills/plot-fleet/SKILL.md` and its README if `--start` or `--once` gain a refusal, and the Model Guidance table if a step changes.

### Scope guard

This branch owns the probe rule and its port in `packages/domain`, the adapter that runs it, its call from `registryd-main.ts` (`--once`) and from the `--start` path in `plot-fleetctl.sh`, the `plot-fleet` skill text, and their tests.

Not this branch: the `permission-denied` ending (wave 1, merged), the loop's `PLOT-BLOCKED.md` write (wave 2, merged), and any claim release, ref pruning or desk reaping (`bug/claim-only-branch-returns-to-queue`, which reads `mergedAt`).

If you find something the plan did not anticipate, report it rather than improvising outside scope.

# The gates are launchers

> The five PreToolUse gate scripts become launchers over one JS entry, the five decisions move into `@plot-pm/domain`, and one `node` start per Bash call replaces five `bash` + `jq` starts.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** the-gates-and-the-review-findings
- **Issue:** #1341, #1449
- **Story:** the-shell-holds-no-behavior
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-brief-name-gate.sh`, `plot-bundle-commit-gate.sh` and `plot-controller-gate.sh` become launchers. Each decision runs in `packages/domain/src/rules/`, and one bundle, `board/plot-gate.mjs`, answers all five.
- The plugin registers one PreToolUse hook on Bash instead of five, so a Bash tool call starts one `node` process for the gates and no `bash` gate script.
- The controller gate allows a read-only `for` loop whose word list names a gated script, and its refusal says to run the receipt bypass as its own command first (#1341).
- The controller gate refuses `plot-approve.mjs --who --dry-run <slug>` and the same shape for `plot-approve.sh`, `plot-deliver.sh` and `plot-deliver.mjs`, and it gates a `.mjs` glob such as `plot-appro?e.mjs` (#1449).

<!-- Board impact: none to the plan format, the template or the docs/plans layout. The scaffold slice adds one bundle, board/plot-gate.mjs, declared in packages/board/build.mjs and built on main by build-bundles.yml. hooks/hooks.json changes from five entries to one over the course of the plan. -->

## Motivation

`the-shell-holds-no-behavior` sets the target: every `.sh` under `skills/plot/scripts/` is a launcher. `the-shell-sheds-its-decisions` (Delivered 2026-10-09) converted `plot-reap.sh` and `plot-approve.sh`. The five PreToolUse gates are the next group: they share one caller (`hooks/hooks.json`), one input (the hook JSON on stdin), one exit contract and one verifier (`plot-install-hooks.sh --verify`).

Measured on `main` at `c9d63311d`, 2026-10-10:

| Gate | Raw lines | Code lines | README kind |
|---|---|---|---|
| `plot-phase-gate.sh` | 264 | 142 | decision |
| `plot-state-gate.sh` | 218 | 118 | decision |
| `plot-controller-gate.sh` | 321 | 126 | decision |
| `plot-brief-name-gate.sh` | 185 | 109 | decision |
| `plot-bundle-commit-gate.sh` | 111 | 59 | decision |
| **Total** | **1,099** | **554** | 5 of 52 counted rows |

- `scripts/check-decision-count.sh` counts 52 README rows whose kind is not *launcher* (15 *decision*, 32 *readings*, 4 *orchestration*, 1 *paired*). 4 rows are *launcher*. 56 `.sh` files exist.
- `hooks/hooks.json` registers five PreToolUse command hooks on the `Bash` matcher, one per gate.
- One gate decision is in the domain today: `controllerInvocation` in `rules/ci-suite.ts`, reached through `board/plot-controller-invocation.mjs` (1,969 bytes). `plot-controller-gate.sh` asks it only after a per-word prefilter and the desk exemption. `ciSuiteRefusal` in the same file is reached through `board/plot-local-checks.mjs` (346,007 bytes).
- Related code exists outside the gates. `rules/hold-clear.ts` exports `clearHolds` for `.plot/hold`. `packages/fleet/src/shared/brief-path.ts` exports `briefPath`. `packages/fleet/src/shared/action-receipt.ts` and `entry/ladder.ts` write receipts, and `corpus/state-receipt.corpus.test.ts` holds the writer pair. No TS code reads or spends a receipt: `receipt_clears` and `action_receipt_clears` exist only in `plot-state-receipt.sh`.
- The domain has no port operation for the staged index (`git diff --cached --name-status -M`). `Refs.workingChanges` lists modified, staged and untracked paths together.
- Config keys reach TS through `adapters/scripts/scripts-shell.ts`, which runs `plot-config.sh` once per key.

### Per-call cost

A PreToolUse hook on `Bash` runs once per Bash tool call. That is more often than once per agent per pass. `docs/shell-and-domain.md` §1 puts a script reached once per agent per pass in shell, because a `node` start costs 34 ms and a bundle answers in 39 ms (measured 2026-09-07). By that rule, **a launcher per gate is outside the rule.**

Measured 2026-10-10 on this machine (16 cores, load average 18.0 during the run), medians over 21 runs in the plot checkout, CPU as user + sys of the child:

| Shape | Wall ms | CPU ms |
|---|---|---|
| Five shell gates, `ls -la` (no commit, no gated script) | 70.5 (sum) | 59 (sum) |
| Five shell gates, `git commit` | 305.6 (sum) | 295 (sum) |
| `bash -c true` | 7.7 | — |
| `node -e ''` | 29.7 | — |
| `bash` + `exec node` over the 1,969-byte bundle (launcher shape) | 33.9 | 28 |
| `bash` + `exec node` over the 346,007-byte bundle | — | 62 |

Per gate on a non-commit call, the shell gates cost 10 to 18 ms CPU each. Per gate on a commit call, they cost 15 ms (controller) to 106 ms (phase), because the phase gate runs `plot-config.sh` four times and `plot-plan-meta.sh` once.

- **Five launchers, five starts:** 5 × 28 = 140 ms CPU per non-commit Bash call with a small bundle, and 5 × 62 = 310 ms with an adapter-sized bundle, against 59 ms today. That adds 81 to 251 ms CPU to every Bash call.
- **One hook, one start:** one launcher over one bundle that runs every gate costs 28 ms CPU per non-commit call with a small start path, against 59 ms today, and one start per commit call against 295 ms today.

The plan takes the second shape. It is within the purpose of the cost rule, because it costs less CPU per call than the shell it replaces. It is not within the letter of §1, which names no case where `node` replaces several `bash` starts, so the scaffold slice amends §1 with this measurement.

## Design

### Approach

**One entry, five launchers, one hook.** `packages/board/src/server/entry/gate.ts` builds to `skills/plot/scripts/board/plot-gate.mjs`. It reads the hook JSON from stdin once, and it runs the gates named on its command line, or every gate it knows when it is given `--all`. It exits 2 when any gate refuses and prints each refusal to stderr. It exits 0 otherwise. Each `plot-<name>-gate.sh` becomes a launcher of the `plot-deliver.sh` shape that `exec`s `node board/plot-gate.mjs <name>`. A new launcher, `plot-gates.sh`, `exec`s `node board/plot-gate.mjs --all`, and `hooks/hooks.json` registers it as the one hook.

**Why the `.sh` names stay.** The story keeps every `.sh` path. Adopting repositories that ran `plot-install-hooks.sh` hold per-gate entries in `.claude/settings.json` (`"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/plot-state-gate.sh`), and the tests under `test/reconcile/*-gate.test.mjs` drive each gate by its path. A per-gate launcher keeps both working.

**The start path stays small.** A call that names no `git commit` and no gated script must not load the git adapters. The entry asks a pure domain rule first, which gates need readings for this command, and loads the adapters only for those. The brief chooses the mechanism (a dynamic import of a second bundle, or a split build). The acceptance figure is the measurement: a non-commit call costs no more CPU than the five shell gates do at the same load. The scaffold adds `scripts/measure-gates.mjs`, the instrument this plan used, so each slice records the figure in its PR.

**The layering.** Each gate's decision is a rule in `packages/domain/src/rules/` with unit tests: readings in, a verdict out, no I/O. The entry reads through ports: `Refs` (staged index, `HEAD` blobs, `origin/<main>` tree), the config, and a receipt port. The adapters do the I/O. The rule never spawns.

**The hook contract does not change.** Input: the hook JSON on stdin, `tool_input.command` the only field read, the working directory the hook's own. Output: exit 2 blocks and stderr reaches the agent, any other exit allows. Each gate keeps its own failure direction. Four gates fail open on their own machinery and say so on stderr. The controller gate refuses a command that names a gated script when its rule cannot be asked (#1245). One gate's exception in the entry does not decide another gate's answer: the entry catches per gate.

**A missing bundle allows, and says so.** A hook that exits 2 on every Bash call leaves the agent no Bash call to repair the install with. So a launcher that cannot find `plot-gate.mjs`, or cannot start `node`, prints `plot-gates: board/plot-gate.mjs is missing — the gates went UNVERIFIED` and exits 0. This is looser than the controller gate's #1245 rule for one case, a missing bundle. The open question below asks for the operator's decision.

**`plot-install-hooks.sh` follows the hook.** It reads the gate set from `hooks/hooks.json`. When that file names `plot-gates.sh`, the installer reads the gate names from `plot-gate.mjs --list`, registers the one launcher, and `--verify` drives each per-gate probe through `plot-gates.sh`. A repository that holds the old per-gate entries reports `present` and the installer names the one entry that replaces them; it removes nothing it did not write. The four probes that verify today (`state`, `controller`, `brief-name`, `bundle-commit`) keep verifying. The phase gate stays `unprobed` with its present reason.

**Order: the scaffold, then one gate per wave.** Every gate slice edits `hooks/hooks.json`, `plot-gate.mjs`'s gate table and the README, so two in one wave conflict. The order goes from the smallest gate to the gate with the most readings. The bundle gate proves the entry with no receipt and no remote. The brief-name gate adds command parsing. The state gate adds the receipt port and `effectivePaths`. The controller gate reuses the receipt port and carries the two issues. The phase gate reuses `effectivePaths` and adds the `origin/<main>` reading.

**The decision count, per slice.** `check-decision-count.sh` counts 52 today. The scaffold adds `plot-gates.sh` as a *launcher* row and leaves the count at 52. Each gate slice changes its row from *decision* to *launcher*, names `board/plot-gate.mjs` in *Replaced by* as evidence, and lowers the count by one: 51, 50, 49, 48, 47. The line ratchet `check-shell-lines.sh` falls by about the code lines of each gate, less the launcher's 7.

### The controller-gate defects

Both issues reproduce on `main` at `c9d63311d`, 2026-10-10, through `board/plot-controller-invocation.mjs`:

| Command | Answer | Correct answer |
|---|---|---|
| `for f in plot-deliver.sh plot-plan-meta.sh; do cmp -s $A/$f $B/$f; done` | `deliver` | none (#1341) |
| `bash plot-state-receipt.sh --unowned-action deliver s "r" && bash plot-deliver.sh s` | `deliver` | `deliver`, and the refusal names the two-call order (#1341) |
| `node skills/plot/scripts/board/plot-approve.mjs --who --dry-run some-slug` | none | `approve` (#1449) |
| `bash plot-approve.sh --who --status s` | none | `approve` (#1449) |
| `node skills/plot/scripts/board/plot-deliver.mjs --who --dry-run s` | none | `deliver` (#1449) |
| `bash plot-deliver.sh slug # --dry-run` | none | `deliver` (#1449) |
| `node skills/plot/scripts/board/plot-appro?e.mjs s` | none | `approve` (#1449, low 2) |
| `bash skills/plot/scripts/plot-appro?e.sh s` | `approve` | `approve` |

The installed 2.23.0 gate refused the measurement command itself, because its text named `plot-deliver.sh`. The measurement ran from a file.

The controller slice fixes them in `controllerInvocation`, because that rule decides. A `for … in` word list is not an invocation unless the loop body runs the loop variable in command position (`"$f"`, `bash "$f"`, `./$f`); the loop of dispatches that the gate exists for (`for s in a b; do plot-dispatch.sh $s; done`) stays refused. The rule skips the word after `--who` and after `--release` before it reads `NO_ENDPOINT`, and it reads no word after an unquoted `#`. `NO_ENDPOINT` lists `--dry-run`, `--help` and `-h` for both approve names and drops `--status`. A `.mjs` glob resolves like a `.sh` glob. `parseArgs` in `approve.ts` and `deliver.ts` refuses a `--who` value that starts with `-`. The refusal text for the receipt bypass says to run it as its own Bash call first. #1449's lows 3 to 5 (the `bookApproval` `finally`, the Delivered-plan slice state, the changeset `bumps:` block) are outside the gate and stay on the issue.

### Out of scope

- **`plot-config.sh` and `plot-plan-meta.sh`.** The gates reach config through `scripts-shell.ts` and plans through the domain's parser, and both scripts keep their rows. Their conversion belongs to the story's Phase 4.
- **`plot-state-receipt.sh`.** The owners source it to write receipts. This plan adds a TS reader that spends a receipt and a corpus pair for it; the shell file stays *readings*.
- **A long-lived gate process.** Claude Code starts a command hook per call. An HTTP or socket hook would remove the start, and it needs a process that outlives the session, which is the story's Phase 3 question.

### Manifesto check

1. Git stays the source: every reading is a git or file reading, as today. 2. Project-agnostic: the gates read the same config keys. 3. Each gate keeps its failure direction and names the repair. 4. Nothing new is enforced; the same five refusals fire. 5. Removing the change loses the domain tests and the per-call CPU saving. 6. A person can still run each gate by hand with the hook JSON on stdin. 7. The slices are mechanical against a written rule and a measured figure. 8. No effort tracking. 9. No new ceremony for a plan author.

### Open Questions

- [ ] One hook or five? The plan registers one launcher, `plot-gates.sh`, and keeps five per-gate launchers for direct callers. Five registered launchers would keep `plot-install-hooks.sh` unchanged and cost 81 to 251 ms more CPU per Bash call than today, measured above.
- [ ] A missing `plot-gate.mjs`: allow and say so (the plan's choice), or refuse every Bash call? Refusing matches #1245 for the controller gate and leaves no Bash call to repair the install.
- [ ] Does `plot-install-hooks.sh` rewrite an adopting repository's five per-gate entries into the one entry, or only report them as `present`? The plan reports and removes nothing, because the per-gate launchers keep working.
- [ ] Is the acceptance figure for the start path "no more CPU than the five shell gates at the same load", or a fixed number such as 35 ms? Load was 18.0 on 16 cores during this measurement, so a fixed number taken today is high.

## Slices

### One entry reads the hook

- `feature/one-entry-reads-the-hook` — `entry/gate.ts` and `board/plot-gate.mjs` read the hook JSON once and run named gates with the per-gate exit contract (none registered yet); `plot-gates.sh` is a *launcher* row; `plot-install-hooks.sh` expands `plot-gates.sh` through `plot-gate.mjs --list`; `scripts/measure-gates.mjs` measures per-call CPU; `docs/shell-and-domain.md` §1 records the one-start case. Decision count stays at 52 <!-- builds: plot-gate.mjs, the one gate entry and its launcher plot-gates.sh -->

### The bundle gate

- `feature/the-bundle-gate-is-a-launcher` — `plot-bundle-commit-gate.sh` becomes a launcher; `bundleCommitRefusal` decides from the staged paths and the `shipped*` declarations of `build.mjs`; a staged name-status operation joins `Refs`; `hooks/hooks.json` registers `plot-gates.sh` and drops this gate's line. Decision count 52 → 51 <!-- builds: bundleCommitRefusal and a staged-index Refs operation -->

### The brief-name gate

- `feature/the-brief-name-gate-is-a-launcher` — `plot-brief-name-gate.sh` becomes a launcher; `briefNameRefusal` decides from the staged adds and renames, the paths a chained `git add` or `git mv` would stage, and the `Branch prefixes`; the rule agrees with `briefPath`. Decision count 51 → 50 <!-- builds: briefNameRefusal -->

### The state gate

- `feature/the-state-gate-is-a-launcher` — `plot-state-gate.sh` becomes a launcher; `stateTransitionRefusal` decides from the `HEAD` and staged `State:` values; `effectivePaths` reads what a commit would carry; a receipt port spends a matching receipt, held to `plot-state-receipt.sh` by a corpus test. Decision count 50 → 49 <!-- builds: stateTransitionRefusal, effectivePaths and a receipt-spend port -->

### The controller gate

- `feature/the-controller-gate-is-a-launcher` — `plot-controller-gate.sh` becomes a launcher over the same entry; `controllerInvocation` reads a `for` word list as no invocation, skips the `--who` and `--release` value and an unquoted comment, gates a `.mjs` glob, and drops `--status` for approve; `parseArgs` refuses a `--who` value that starts with `-`; the refusal names the two-call order for the receipt bypass → #1341, #1449. Decision count 49 → 48 <!-- builds: the controller gate in plot-gate.mjs, and the #1341 and #1449 fixes in controllerInvocation -->

### The phase gate

- `feature/the-phase-gate-is-a-launcher` — `plot-phase-gate.sh` becomes a launcher; `phaseGateRefusal` decides from the branch, the plan's phase on `origin/<main>` or `origin/<branch>`, the `.plot/hold` line and `effectivePaths`; the phase comes from the domain's plan parser, not `plot-plan-meta.sh`; `hooks/hooks.json` holds one entry. Decision count 48 → 47 <!-- builds: phaseGateRefusal -->

## Notes

- 2026-10-10: drafted by an unattended `/plot-idea` run. Type, Review and Impl came from the prompt.
- 2026-10-10, deliverable search (`plot-deliverable-search.sh`): `plot-gate.mjs`, `entry/gate`, `stagedChanges`, `phaseGate`, `stateGate`, `briefNameRefusal`, `bundleCommitRefusal`, `receiptClears`, `hookInput` and `generatedBundles` returned no existing artifact. The search names `bundles.generated.ts`, which lists the built bundles for the contract; the bundle gate keeps the `build.mjs` derivation that `check-bundle-attributes.sh`, `scripts/main-bundles.sh` and `check-no-bundle-diff.sh` share.
- 2026-10-10, title similarity: no Draft or Approved plan shares three significant words with this title.
- 2026-10-10: the cost figures above come from a measurement script in `/tmp`, run at load average 18.0. The scaffold slice commits the instrument as `scripts/measure-gates.mjs`, so the figures can be taken again at a lower load.

## Implementation brief — approve-and-deliver-run-without-a-board

- **Plan (canonical):** docs/plans/2026-11-17-approve-and-deliver-run-without-a-board.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3494 merged
- **Branch:** `bug/approve-and-deliver-run-without-a-board` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plot-review GitHub App required on main since 2026-10-15)

The plan has one slice and one branch. Nothing waits on it and it waits on nothing.

### What to build

A person who runs `/plot-approve` or `/plot-deliver` in a main checkout with no board is refused by the controller gate, because `GATED` maps `plot-approve.sh`, `plot-approve.mjs`, `plot-deliver.sh` and `plot-deliver.mjs` to their actions and only a board or a fleet leaves the receipt (`handleApprove`, `handleDeliver`, `planAutoDeliver`). The only way through is `plot-state-receipt.sh --unowned-action`, which counts every normal use as a bypass in `.plot/state/unowned-action-writes.tsv`. The refusal text also offers `POST /api/approve` first and the receipt "where the board is not running", although the gate reads no board (#3489: a board on port 7777 served another clone 91 commits behind). `POST /api/deliver` refuses `no-deliver-command` when the repository has no `Idea command` (#2531).

Build, in this order of dependence:

1. **Two entries.** `packages/board/src/server/entry/approve-command.ts` and `deliver-command.ts`, built to `skills/plot/scripts/board/plot-approve-command.mjs` and `plot-deliver-command.mjs`. Each refuses `PLOT_UNATTENDED=1` before it reads anything (exit 1, naming the board button and the fleet as the unattended routes), then calls the existing entry's exported `run` (`entry/approve.ts` `run`, `entry/deliver.ts` `run`) in the same process with the same arguments, `cwd`, script directory and exit code. Approve takes `[--dry-run] [--spike] [--who <handle>] [--branch <name>] <slug>`. Deliver takes `[--dry-run] [--branch <name>] [--who <name>] <slug>` and refuses `--release` by name, pointing at the board's release button. Neither writes an action receipt. Precedent for shape and build wiring: `plot-restart-command.mjs` (`packages/fleet/src/server/entry/restart-command.ts`; `packages/board/build.mjs` has a `shippedRestartCommand` block, `.gitattributes` a `-merge` line, `packages/board/src/contract/bundles.generated.ts` a list entry). Do the same for both new bundles.
2. **The refusal.** `controllerRefusal` in `packages/domain/src/rules/controller-gate.ts` names `node <scriptDir>/board/plot-approve-command.mjs [--who <handle>] <slug>` (or the deliver command) first, with "which runs with no board and refuses PLOT_UNATTENDED=1.", then the board route as the button. A `--spike` command line names `--spike` on the command and the spike body on the route. The escape line reads "Or, if you accept the bypass" for every action. The TSDoc drops the sentence that says approve and deliver have no board-free command. In `skills/plot/scripts/plot-state-receipt.sh` the two echo lines that tie the escape to a board change in place to name the commands, with no change in line count.
3. **The deliver route.** `packages/board/src/server/deliver.ts`: with no usable `Idea command`, the route takes a script arm after its existing deliverability checks and after it writes the `deliver` receipt. The arm starts `plot-deliver.mjs [--branch <name>] <slug>` through the `Scripts` port, detached and not `unref`'d, with the agent arm's log and state files, no prompt file and no `PLOT_UNATTENDED`. `no-deliver-command` leaves `DeliverRefusal` and the TSDoc table. `packages/board/src/server/index.ts`: the `/api/deliver` comment says the route starts the skill when an `Idea command` exists and runs the script when none does, and that in the second case the merge check is the only check.
4. **The skills and docs.** `/plot-approve` steps 3, 3b, 3c and `/plot-deliver` step 7 (and its `--branch` form) call the commands in a person's session. Under `PLOT_UNATTENDED=1` they keep the `plot-approve.sh` / `plot-deliver.sh` call. The `--dry-run` calls in `/plot-deliver` stay. Both Model Guidance tables change the step-3 and step-7 rows. `skills/plot/scripts/README.md` gets two rows and four changed rows. The CLAUDE.md paragraph "These actions exist as controller endpoints today" lists approve and deliver among the board-free actions, names both commands and their unattended refusal, and drops the sentence that the gate refuses both bundles with no other route. Run `./scripts/check-agents-md.sh --write` afterwards.

The plan is canonical; this is orientation. Line numbers in the plan were read at `92d114d2a` and `main` has moved since, so find each site by name.

### Decisions the plan settles — do not re-derive them

**The commands write no receipt.** The alternative, a receipt before `run` as `handleApprove` and `plot-dispatch-command.mjs` do, leaves a file that a refused run also leaves, and that file clears the gate for the next bare `plot-approve.sh` call. `run` executes in the command's own process, so no gated tool call follows it and no receipt is needed. The dispatch command writes one only because it starts a gated child.

**Every caller under `PLOT_UNATTENDED=1` is refused, not only one with no receipt.** The alternative would let the board's agent arm call the command. The refusal is the whole decision the command adds: `plot-approve.mjs` refuses an unattended caller only for a person-arm plan, and the deliver entry only for `--release`, because the board's agent arm and fleetd's auto-deliver run those entries unattended under their own receipts. An ungated command that admitted an unattended caller would let any agent approve or deliver with no controller. This matches `plot-restart-command.mjs`, `plot-needs-design.mjs` and `plot-supersede.mjs`.

**The commands stay out of `GATED`.** `scriptNamed` then answers `null` for them and `controllerInvocation` answers `null`; `plot-approve.mjs` and `plot-deliver.mjs` stay gated for the board's agent arm and fleetd. Do not add the commands to `GATED` and do not add a receipt exemption. A glob `plot-approve*.mjs` must still read as `approve`.

**The gate reads no board.** The alternative, running `plot-boardctl.sh --status` inside the gate, is refused: the 2026-09-09 plan states that "Is a board running?" is not the question. The refusal names the command first and the board only as a button.

**The deliver command runs only the mechanical step.** It starts no skill and reads no `Idea command`. A person who runs `/plot-deliver` has already had the Frontier-tier verification. The route's `deliverability` pulse check exists to avoid an agent that can only refuse, so the command does not repeat it: the deliver entry asks the host about every slice and refuses an unmerged one itself.

**`--release` has no new ungated name.** A release needs a passkey proof on `POST /api/release`. The deliver command refuses `--release` by name.

**`POST /api/deliver` with no `Idea command` runs the script. This overrides the plan's own recommendation** (decision 4, answer (b)). The cost is stated in the plan and in the route's comment: that click delivers without the Frontier verification. The route's checks before either arm (same-origin gate, slug, `branch` field, `deliverability`, receipt) stay in front of both arms, and `branch-not-on-origin`, `plan-unreadable`, `already-delivered`, `scan-incomplete`, `merge-unconfirmed` and `not-deliverable` still refuse before anything is written.

**Rules carried over from related work.** A new function you write is an arrow (`export const f = (…) =>`), and the commands carry TSDoc that states what they do, take and return, with no history. The domain stays free of spawn sites: the *One place reaches a process* ratchet (`allowed=28`) must not move, and no shell/domain duplicate is added, so no corpus row changes. A new bundle is generated output: do not commit a rebuilt `board-server.mjs` or other generated bundle in the PR (`check-no-bundle-diff.sh`); the two new `.mjs` bundles are listed and attributed, and `main` builds them.

### Done when

The plan's `## Done when` table is the specification: 14 rows, one slice. The assertions that exist because a naive implementation would pass without them:

- **`controller-gate.test.mjs` › "plot-approve-command.mjs passes the gate in a main checkout with no receipt"** (and the deliver twin) fails on `main` because the bundle does not exist. It catches a command that was added to `GATED` or that needs a receipt.
- **The three existing gate cases at `:168`, `:183` and `:201` stay green.** They catch a fix that loosened the gate for the bundles and launchers instead of adding a new name.
- **`ci-suite.test.ts` › "the approve and deliver commands are not gated"**, including `plot-approve*.mjs` answering `'approve'`. It catches a glob that now matches the commands.
- **`controller-gate.test.ts` › "no controller refusal says where the board is not running"**, over every action `controllerRefusal` takes. It catches the one action whose escape text keeps the old claim.
- **`approve-command.test.ts` and `deliver-command.test.ts` › "refuses PLOT_UNATTENDED=1 before it reads the plan"**: exit 1, the refusal names the board and the fleet, zero `run` calls. It catches a command that reads first and refuses later.
- **`deliver-command.test.ts` › "refuses --release and names the board's release button"** catches a command that forwards `--release` to `run`.
- **`deliver-route.test.ts` › "with no Idea command a deliverable plan starts plot-deliver.mjs and writes the receipt"** (202, one `Scripts.start` for `plot-deliver.mjs` with the slug, the `deliver` receipt present, no prompt file), and **"… a plan with an open branch refuses not-deliverable and starts nothing"**. The two existing tests at `deliver-route.test.ts:198` and `:208` change from `no-deliver-command` to these. The second one catches a script arm placed before the deliverability checks.
- **`approve-entry.test.mjs` › "plot-approve-command.mjs approves an in-session plan with --who"** proves the command reaches the real entry in a sandbox, not only a stubbed `run`.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; it names the related domain and board tests, the typechecks, and the `scripts/check-*.sh` gates, including `check-bundle-resolution.sh`, `check-bundle-attributes.sh`, `check-helper-table.sh` and `check-agents-md.sh`. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. A changeset is required: package `plot`, patch, description first and the `bumps:` block last (`skills: plot: patch, plot-approve: patch, plot-deliver: patch`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches one `.sh` file, `plot-state-receipt.sh`, and the plan requires its two echo lines to change in place with the same line count. Do not add a line there, and do not join statements with `;` or `&&` to hold the count: the gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR through the controller once there is a commit to show:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while the work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Board-free approve and deliver` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/server/entry/approve-command.ts` and `deliver-command.ts` (new), `packages/board/build.mjs`, `packages/board/src/contract/bundles.generated.ts`, `.gitattributes`, `packages/domain/src/rules/controller-gate.ts`, `packages/board/src/server/deliver.ts`, `packages/board/src/server/index.ts` (the `/api/deliver` comment only), `skills/plot/scripts/plot-state-receipt.sh` (two lines), `skills/plot-approve/SKILL.md`, `skills/plot-deliver/SKILL.md`, `skills/plot/scripts/README.md`, `CLAUDE.md`, `AGENTS.md` (regenerated), the tests the plan lists, and one changeset.

No other branch of this plan exists. On origin at dispatch, no remote branch touches the gate, the deliver route or the receipt script (checked with `git ls-remote --heads origin`; the one unrelated head is `feature/delivery-machine-line`). `controller-gate.ts` and `deliver.ts` are busy files, so fetch `origin/main` before each push.

Out of scope, and already known: the gate refuses `grep -n "a\|plot-deliver.mjs" file | head` because `nonReadSegments` splits a pipeline on every `|`, including one inside quotes. The plan's Notes record it as needing its own issue. Report anything else the plan did not anticipate rather than improvising outside scope.

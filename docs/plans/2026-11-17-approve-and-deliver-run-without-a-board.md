# A person approves and delivers with no board

> `/plot-approve` and `/plot-deliver`, run by a person in a main checkout with no board, call `plot-approve-command.mjs` and `plot-deliver-command.mjs`, which pass the controller gate, refuse an unattended caller and run the same approve and deliver entries; the gate's refusal names these commands first and no longer claims a board check it does not make.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #3489, #2531
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-approve` and `/plot-deliver` run with no board: a person's session calls `plot-approve-command.mjs` or `plot-deliver-command.mjs`, and the controller gate needs no `--unowned-action` receipt for them. The board's Deliver button runs `plot-deliver.mjs` directly in a repository with no `Idea command`.

## Motivation

The controller gate refuses both approve and deliver in a main checkout when no action receipt exists. `GATED` maps `plot-approve.sh`, `plot-approve.mjs`, `plot-deliver.sh` and `plot-deliver.mjs` to their actions (`packages/domain/src/rules/ci-suite.ts:344-350`); the comment at `ci-suite.ts:327-333` names each bundle "a second name for the same gated action". `controllerGateOf` returns `null` for a linked worktree (`packages/board/src/server/entry/gate.ts:1045`) and otherwise refuses an action whose receipt file is absent (`gate.ts:1047-1058`).

Only three writers leave an approve or deliver receipt, and all three are a board or a fleet: `handleApprove` (`packages/board/src/server/approve.ts:377`), `handleDeliver` (`packages/board/src/server/deliver.ts:790`) and `planAutoDeliver` (`packages/fleet/src/shared/auto-deliver.ts:259`). The `/plot-approve` skill tells the agent to run `../plot/scripts/plot-approve.sh <slug>` (`skills/plot-approve/SKILL.md:249`, `:313`, `:381`), and `/plot-deliver` tells it to run `../plot/scripts/plot-deliver.sh <slug>` (`skills/plot-deliver/SKILL.md:425`, `:455`). A person who follows either skill with no board is refused, and the only way through is `plot-state-receipt.sh --unowned-action`, which appends a line to `.plot/state/unowned-action-writes.tsv` as a routing gap (`skills/plot/scripts/plot-state-receipt.sh:234-276`). The normal flow therefore counts as a bypass every time.

#2531 shows that deliver has no board route as a fallback either. `handleDeliver` refuses `no-deliver-command` when the repository declares no `Idea command` (`packages/board/src/server/deliver.ts:660-670`), because the route starts the `/plot-deliver` skill as an agent. With no `Idea command`, `/plot-deliver` has no route that the gate accepts. Reported 2026-10-23 on Plot 2.28.0 in `quatico-solutions/agent-skills`.

#3489 shows that the refusal text states a check that the gate does not make. `controllerRefusal` offers the receipt "where the board is not running" (`packages/domain/src/rules/controller-gate.ts:376`), and its first suggestion for approve and deliver is `POST /api/approve` or `POST /api/deliver` (`controller-gate.ts:368-370`). The gate reads no board. The 2026-09-09 plan that added it says so on purpose: *"Is a board running?" is not the question* (`docs/plans/2026-09-09-a-lifecycle-action-needs-a-controller-receipt.md:108`). In #3489 a board on port 7777 served another clone of the repository, 91 commits behind, and `plot-boardctl.sh --status` reported "serving ANOTHER checkout". The refusal's first suggestion would have run the approval in that other clone. Reported 2026-11-17 on Plot 2.29.1.

Dispatch and restart already have board-free controller commands that the gate admits: `plot-dispatch-command.mjs` is outside `GATED` and records its own receipt (`packages/fleet/src/server/entry/dispatch-command.ts:49-50`), and `controllerRefusal` names it first for dispatch (`controller-gate.ts:361-363`). The TSDoc of `controllerRefusal` gives the reason approve and deliver have no such command: *"`approve` and `deliver` take `--who`/`--release` modes the gate itself reads as a run"* (`controller-gate.ts:345-348`). The defect is on `origin/main` at `92d114d2a`.

## Design

### Approach

**Two board-free controller commands.** Add `packages/board/src/server/entry/approve-command.ts` and `packages/board/src/server/entry/deliver-command.ts`, built to `skills/plot/scripts/board/plot-approve-command.mjs` and `skills/plot/scripts/board/plot-deliver-command.mjs`. Each command is the person's controller for its action, in the shape of `plot-dispatch-command.mjs`:

- It refuses `PLOT_UNATTENDED=1` before it reads anything, and names the board button and the fleet as the unattended routes. This refusal is the decision that the command adds to the entry it wraps. `plot-approve.mjs` refuses an unattended caller only for a person-arm plan (`packages/board/src/server/entry/approve.ts:1054`), and the deliver entry refuses one only for `--release` (`packages/board/src/server/entry/deliver.ts:861-865`), because the board's agent arm and fleetd's auto-deliver run these entries unattended under their own receipts. An ungated command that admitted an unattended caller would let any agent approve or deliver with no controller.
- It then calls the existing entry's exported `run` in the same process (`approve.ts:751`, `deliver.ts:686`) with the same arguments, the same `cwd`, the same script directory and the same exit code. The approve workflow, its refusals and its receipt spend (`approve.ts:1273`, `deliver.ts:620`) stay in one place.
- `plot-approve-command.mjs` takes the arguments `plot-approve.mjs` takes: `[--dry-run] [--spike] [--who <handle>] [--branch <name>] <slug>`.
- `plot-deliver-command.mjs` takes `[--dry-run] [--branch <name>] [--who <name>] <slug>`, and refuses `--release` by name with the board's release button as the route. A release needs a passkey proof on `POST /api/release` (`packages/board/src/server/release.ts:165-167`), and a new ungated name for it would remove that proof.
- Neither command writes an action receipt (see Open Questions). No tool call that the gate reads runs after the command starts, because `run` executes in the command's own process.

**The deliver command runs only the mechanical step.** The board route starts the `/plot-deliver` skill through `Idea command` (`deliver.ts:797-822`) because a person's click carries no verification. When a person runs `/plot-deliver`, the skill already runs and has done the Frontier-tier verification. So `plot-deliver-command.mjs` does not start a skill and does not read `Idea command`; it runs the mechanical step that the skill's step 7 names. The route's pulse check (`deliverability`, `deliver.ts:676-735`) exists to avoid an agent that can only refuse. The command does not repeat it: the deliver entry asks the host about every slice and refuses an unmerged one itself (`skills/plot-deliver/SKILL.md:460`, "the merge check is `plot-deliver.sh`'s own").

**The gate admits the commands with no change to its reading.** `plot-approve-command.mjs` and `plot-deliver-command.mjs` are not keys of `GATED`, so `scriptNamed` answers `null` for them (`ci-suite.ts:390-398`) and `controllerInvocation` answers `null`. A glob such as `plot-approve*.mjs` still matches only `plot-approve.mjs` among `GATED_NAMES` and still reads as `approve`. The bundles `plot-approve.mjs` and `plot-deliver.mjs` stay gated: the board's agent arm and fleetd still reach them under a receipt.

**The refusal names the command first.** Change `controllerRefusal` (`controller-gate.ts:357-387`) for `approve` and `deliver`:

- The first route is `node <scriptDir>/board/plot-approve-command.mjs [--who <handle>] <slug>` or `node <scriptDir>/board/plot-deliver-command.mjs <slug>`, followed by `which runs with no board and refuses PLOT_UNATTENDED=1.`
- The board route follows as `With the board up, POST /api/approve {"slug":"<slug>"} is its button.` For a `--spike` command line the approve text names `--spike` on the command and the spike body on the route.
- The escape line changes from "Or, where the board is not running and you accept the bypass" to "Or, if you accept the bypass", for every action, because the gate checks no board for any action.
- The TSDoc of `controllerRefusal` drops the sentence that says approve and deliver have no board-free command.

The two echo lines in `plot-state-receipt.sh` that tie the escape to a board ("Where the board IS running, the controller is the route", "this exists for a machine running no board", `plot-state-receipt.sh:243-244`, `:274`) change in place to name the controller commands, with no change in the line count that `check-shell-lines.sh` ratchets.

**The skills call the commands.** `/plot-approve` step 3, 3b and 3c and `/plot-deliver` step 7 (and its `--branch` form) call `plot-approve-command.mjs` and `plot-deliver-command.mjs` in a person's session. Under `PLOT_UNATTENDED=1` the board or fleetd started the run and left the receipt, so the skill keeps the `plot-approve.sh` / `plot-deliver.sh` call for that case. Each skill's Model Guidance table changes its step-3 and step-7 rows to name the command. The `--dry-run` calls in `/plot-deliver` (`SKILL.md:142`, `:183`) stay, because `--dry-run` is a `NO_ENDPOINT` mode that the gate does not refuse (`ci-suite.ts:424-433`).

**Layering.** The commands are entries (controllers). They call the entry `run`, which calls the domain's approve and deliver transitions through the existing ports. No new port, adapter, domain rule or spawn site exists, so the *One place reaches a process* ratchet does not move. No shell/domain duplicate is added, so no corpus row changes.

**Docs.** The CLAUDE.md paragraph that starts "These actions exist as controller endpoints today" (`CLAUDE.md:546`) lists approve and deliver among the actions that run with no board and pass the gate, names both commands and their `PLOT_UNATTENDED=1` refusal, and removes the sentence that the gate refuses both bundles with no other route. `./scripts/check-agents-md.sh --write` regenerates `AGENTS.md`. `skills/plot/scripts/README.md` gets a row for each new bundle, and the `plot-approve.sh`, `plot-deliver.sh`, `board/plot-approve.mjs` and `board/plot-deliver.mjs` rows name the command as the person's route. `.gitattributes` marks both bundles `-merge`, and `packages/board/src/contract/bundles.generated.ts` lists them.

**The deliver route runs the script when no `Idea command` exists.** `handleDeliver` refuses `no-deliver-command` today when `usableCommand` finds no `Idea command` or finds the `none` sentinel (`packages/board/src/server/deliver.ts:660-670`). After the fix, that case takes a script arm, the way `handleApprove` runs `plot-approve.sh` through `scriptsFor(opts).start` when no `Approve command` exists (`packages/board/src/server/approve.ts:421-430`):

- Before either arm, the route still checks the same-origin gate, the slug and the `branch` body field, and the deliverability judgement from `deliverability` (`deliver.ts:676-735`). The refusals `branch-not-on-origin`, `plan-unreadable`, `already-delivered`, `scan-incomplete`, `merge-unconfirmed` and `not-deliverable` stay, and each one still runs before anything is written.
- The route then writes the `deliver` action receipt (`deliver.ts:790`) above both arms, as `handleApprove` does.
- The script arm starts `plot-deliver.mjs [--branch <name>] <slug>` through the `Scripts` port, detached and without `unref`, with the log and state files of the agent arm, so `GET` on the deliver status reads the exit code and the last lines of the log. The arm writes no prompt file and sets no `PLOT_UNATTENDED`. `plot-deliver.mjs` makes its own host merge check and spends the receipt on exit 0 (`packages/board/src/server/entry/deliver.ts:620`).
- With a usable `Idea command`, the route starts the `/plot-deliver` skill as before.
- `no-deliver-command` has no case left, so the slice removes it from `DeliverRefusal` and from the table in the TSDoc of `handleDeliver`.

**The cost of the script arm:** a click in a repository with no `Idea command` delivers the plan without the Frontier-tier verification that `/plot-deliver` makes, which compares each deliverable with what the merged PRs carry. The route's own checks prove only that every non-deferred slice has merged and that the scan is complete. The comment at `packages/board/src/server/index.ts:400-415` changes to say this: the route starts the skill when an `Idea command` exists and runs the script when none exists, and in the second case the click is the person's decision and the merge check is the only check.

**Board impact:** two new shipped bundles under `skills/plot/scripts/board/`, and the Deliver button works in a repository with no `Idea command`. The plan format and the card data do not change.

### Open Questions

- [x] **Does the command write an action receipt?** Decided (a). (a) Write none: `run` executes in the command's process, so no gated tool call follows, and a receipt left by a refused run would clear the gate for the next bare `plot-approve.sh` call. (b) Write the receipt before `run`, as `handleApprove` and `plot-dispatch-command.mjs` do, so the receipt file always means "a controller ran". **Recommendation: (a).** The dispatch command writes one because it starts `plot-dispatch.sh` as a child that runs its own receipt spend; these commands start no gated child.
- [x] **Which unattended callers does the command refuse?** Decided (a). (a) Every caller under `PLOT_UNATTENDED=1`. (b) Only an unattended caller with no receipt present, so the board's agent arm could call the command too. **Recommendation: (a).** It matches `plot-restart-command.mjs`, `plot-needs-design.mjs` and `plot-supersede.mjs`, and it keeps the skill's unattended branch on the receipt route that already works.
- [x] **Does the gate read which checkout a board serves?** Decided (a). (a) No: the refusal names the command first and the board route only as a button. (b) The refusal runs `plot-boardctl.sh --status` and names the board route only when the board serves this checkout. **Recommendation: (a).** The gate reads no board by design (`docs/plans/2026-09-09-a-lifecycle-action-needs-a-controller-receipt.md:108`), and with a board-free command the board route is no longer the first suggestion.
- [x] **Does `POST /api/deliver` run the script with no `Idea command`?** Decided (b), against the recommendation. (a) No: the route keeps `no-deliver-command`, and its detail names `plot-deliver-command.mjs` as the route from a session. (b) The route runs `plot-deliver.mjs` directly when no `Idea command` exists, as `handleApprove` runs `plot-approve.sh` with no `Approve command`. **Recommendation: (a)** for this plan. #2531 asks for a route for a person running `/plot-deliver`, which the command gives. Option (b) delivers with no Frontier verification from a click, which the route's comment (`packages/board/src/server/index.ts:409-415`) declines, and it needs its own plan.

### Decisions

Recorded 2026-11-17, from the person's answers to the four Open Questions.

1. **Receipt:** (a). `plot-approve-command.mjs` and `plot-deliver-command.mjs` write no action receipt.
2. **Unattended callers:** (a). Both commands refuse every caller under `PLOT_UNATTENDED=1`.
3. **Board check:** (a). The gate reads no board, and the refusal names the command first.
4. **`POST /api/deliver` with no `Idea command`:** (b). This decision overrides the recommendation (a). The route runs `plot-deliver.mjs` directly, after its deliverability checks and its receipt, and the click delivers without the Frontier verification. Approach states the route's checks and this cost.

## Done when

| Claim | Check | Slice |
|---|---|---|
| The gate admits the approve command in a main checkout with no receipt | `test/reconcile/controller-gate.test.mjs` › *"plot-approve-command.mjs passes the gate in a main checkout with no receipt"*; fails on `main`, where the bundle does not exist and the skill's call is refused | Board-free approve and deliver |
| The gate admits the deliver command in a main checkout with no receipt | `test/reconcile/controller-gate.test.mjs` › *"plot-deliver-command.mjs passes the gate in a main checkout with no receipt"* | Board-free approve and deliver |
| The gate still refuses the bundles and launchers with no receipt | the existing `controller-gate.test.mjs` cases at `:168`, `:183` and `:201` stay green | Board-free approve and deliver |
| `controllerInvocation` reads the commands as no action and a glob over the bundles as before | `packages/domain/test/ci-suite.test.ts` › *"the approve and deliver commands are not gated"* (`node .../plot-approve-command.mjs x` and `node .../plot-deliver-command.mjs x` answer `null`; `node .../plot-approve*.mjs x` answers `'approve'`) | Board-free approve and deliver |
| The approve and deliver refusals name the command first and the board route as the button | `packages/domain/test/controller-gate.test.ts` › *"an approve refusal names plot-approve-command.mjs before POST /api/approve"* and *"a deliver refusal names plot-deliver-command.mjs before POST /api/deliver"*; fail on `main` | Board-free approve and deliver |
| No refusal claims a board check | `controller-gate.test.ts` › *"no controller refusal says where the board is not running"*, over every action `controllerRefusal` takes; fails on `main` at `controller-gate.ts:376` | Board-free approve and deliver |
| The commands refuse an unattended caller and write nothing | `packages/board/test/unit/approve-command.test.ts` and `deliver-command.test.ts` › *"refuses PLOT_UNATTENDED=1 before it reads the plan"*: exit 1, the refusal names the board and the fleet, no `run` call | Board-free approve and deliver |
| The commands pass arguments and the exit code to the entry | `approve-command.test.ts` › *"passes --who, --spike, --branch and the slug to run and returns its code"*; `deliver-command.test.ts` › *"passes --branch, --who and the slug to run and returns its code"* | Board-free approve and deliver |
| The deliver command refuses a release | `deliver-command.test.ts` › *"refuses --release and names the board's release button"* | Board-free approve and deliver |
| An approval through the command records the plan in a sandbox | `test/reconcile/approve-entry.test.mjs` › *"plot-approve-command.mjs approves an in-session plan with --who"* | Board-free approve and deliver |
| With no `Idea command`, `POST /api/deliver` runs `plot-deliver.mjs` after its checks | `packages/board/test/unit/deliver-route.test.ts` › *"with no Idea command a deliverable plan starts plot-deliver.mjs and writes the receipt"* (202, a `Scripts.start` call for `plot-deliver.mjs` with the slug, the `deliver` receipt present, no prompt file); fails on `main`, which answers `no-deliver-command` | Board-free approve and deliver |
| With no `Idea command`, the route still refuses a plan that is not deliverable | `deliver-route.test.ts` › *"with no Idea command a plan with an open branch refuses not-deliverable and starts nothing"*; the tests at `deliver-route.test.ts:198` and `:208` change from `no-deliver-command` to these two cases | Board-free approve and deliver |
| The skills name the commands | `grep -n 'plot-approve-command.mjs' skills/plot-approve/SKILL.md` and `grep -n 'plot-deliver-command.mjs' skills/plot-deliver/SKILL.md` print the step-3 and step-7 calls | Board-free approve and deliver |
| The bundles are shipped, listed and documented | `./scripts/check-bundle-resolution.sh`, `./scripts/check-bundle-attributes.sh`, `./scripts/check-helper-table.sh` and `./scripts/check-agents-md.sh` pass | Board-free approve and deliver |

## Slices

### Board-free approve and deliver

- `bug/approve-and-deliver-run-without-a-board` — `packages/board/src/server/entry/approve-command.ts` and `deliver-command.ts` (new, arrow functions, TSDoc), `packages/board/build.mjs`, `packages/board/src/contract/bundles.generated.ts` and `.gitattributes` (two bundles), `packages/domain/src/rules/controller-gate.ts` (`controllerRefusal` text and TSDoc), `packages/board/src/server/deliver.ts` (the script arm with no `Idea command`, `no-deliver-command` removed from `DeliverRefusal` and the TSDoc table), `packages/board/src/server/index.ts` (the `/api/deliver` comment), `skills/plot/scripts/plot-state-receipt.sh` (two message lines in place), `skills/plot-approve/SKILL.md` and `skills/plot-deliver/SKILL.md` (the calls and Model Guidance rows), `skills/plot/scripts/README.md` (two new rows and four changed rows), `CLAUDE.md` and the regenerated `AGENTS.md`; tests in `packages/domain/test/controller-gate.test.ts`, `packages/domain/test/ci-suite.test.ts`, `test/reconcile/controller-gate.test.mjs`, `test/reconcile/approve-entry.test.mjs`, `packages/board/test/unit/deliver-route.test.ts`, and new `packages/board/test/unit/approve-command.test.ts` and `deliver-command.test.ts`; and a changeset for `plot` (patch, `bumps: skills: plot: patch, plot-approve: patch, plot-deliver: patch`) <!-- builds: board-free approve and deliver controller commands -->

## Notes

- Deliverable search: `plot-approve-command.mjs`, `plot-deliver-command.mjs`, *"board-free approve"* and *"board-free deliver"* found no existing command. The hits are reconcile-scan headings, `check-script-names.sh` comments and the `controllerRefusal` TSDoc at `controller-gate.ts:346`, which this slice changes. None is a duplicate.
- Precedent: `plot-dispatch-command.mjs` and `plot-continue-command.mjs` (plan `the-fleet-runs-without-the-board`, PR #1457) and `plot-restart-command.mjs`.
- `docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md:91` chose the `--unowned-action` escape for a session with no board. This plan replaces that route for approve and deliver; the escape stays for every action.
- Observed while this plan was written, and not in its scope: the gate refused `grep -n "a\|plot-deliver.mjs" file | head`. `nonReadSegments` splits a pipeline on every `|`, including one inside quotes (`ci-suite.ts`, the `pipeline.split('|')` in `nonReadSegments`), so a quoted `\|` in a `grep` pattern makes a word after it read as a run. It needs its own issue.

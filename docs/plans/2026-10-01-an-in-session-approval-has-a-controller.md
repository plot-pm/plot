# An in-session approval has a controller

> A plan reviewed in the session and a plan marked Released have no script that owns the write, so each one is a counted `--unowned` receipt. This checkout has recorded 237 of them: 109 `Approved` and 112 `Released`.

## Status

- **State:** Released
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1088
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Started:** 2026-10-02, Jan Wloka, `bug/the-transition-takes-the-reviewer`
- **Started:** 2026-10-02, Jan Wloka, `bug/the-scripts-own-the-approval-and-the-release`
- **Delivered:** 2026-10-02
- **Released:** 2026-10-04, v2.23.0

## Changelog

- `plot-approve.sh --who <handle> <slug>` approves a `Review: in-session` plan when `<handle>` is declared in the `People` config key, and records `Approved: <date>, <handle>, in-session`. It refuses an empty or undeclared handle, and it refuses under `PLOT_UNATTENDED=1`. Every in-session approval appends one row to `.plot/state/in-session-approvals.tsv`. `POST /api/approve` passes `who` through. The approval no longer needs an `--unowned` receipt.
- `plot-deliver.sh --release <version> <slug>` marks a Delivered plan Released and records `Released: <tag date>, v<version>`, after it checks that `v<version>` is the first release tag that contains the plan's merge commit. `/plot-release` reaches it through `POST /api/release`, so marking a release no longer needs an `--unowned` receipt.

Board impact: one new write route, `POST /api/release`, and one new body field, `who`, on `POST /api/approve`. No plan-format, template or payload change; the `Approved:` and `Released:` records keep their current form.

## Motivation

Measured 2026-10-01 in `.plot/state/unowned-state-writes.tsv` of the main checkout: 237 rows, of them 109 `Approved`, 112 `Released`, 11 `Rejected` and 5 `Superseded`; 39 rows on 2026-10-01 alone. The 109 `Approved` rows name 97 distinct plans, and every one reads `Review: in-session`; no `ballot` plan appears. Every `Released` row is `/plot-release` step 5. The receipt's own header (`plot-state-receipt.sh:12-17`) names both as writes that have no owning script.

The refusal is in three places on `origin/main`:

| Site | Text |
|---|---|
| `skills/plot/scripts/plot-approve.sh:200-202` | `die "plan '$slug' declares 'Review: in-session' — the reviewer is a human in the room.` |
| `packages/domain/src/transitions/plan.ts:257-262` | `review-human`, `the approval needs a human` (one arm for `in-session` and `ballot`) |
| `packages/domain/src/workflows/approve.ts:155-158` | `review-human`, `the reviewer is a human in the room` |

The refusal is right that a script cannot be the reviewer. It is wrong that nothing can record the reviewer: the person who said yes is a reading, the same way `/api/continue` takes an answer. `ApproveInput` in `transitions/plan.ts:186-195` already carries `who` and `channel`; only the refusal discards them.

The `Released` write is already decided in the domain. `release` in `transitions/plan.ts:542` accepts `delivered` and, as the idempotent case, `released`. `release` in `workflows/release.ts:164` writes `plan-phase Released` and, at `:270-277`, the `Released` record with each plan's own tag. The transition bundle accepts the verb: `packages/board/src/server/entry/transition.ts:44` declares `Verb = 'approve' | 'deliver' | 'release'`, and `:139` decides it. No script performs it: `skills/plot-release/SKILL.md:401-409` writes the field by hand under an `--unowned` receipt because no script owns `Released`.

### The controller gate

`skills/plot/scripts/plot-controller-gate.sh` refuses `plot-approve.sh` and `plot-deliver.sh` (`:83-84`) when a master agent runs them from the repository root without an action receipt, and names `POST /api/<action>` as the route (`:230`). Measured by the round-1 panel: `plot-approve.sh --reviewer jwloka x` exits 2 at the gate. So a skill step that "calls the script" is refused, and this plan routes both writes through a controller.

The gate's mode exemption at `:173-180` contains ` --release `, which was written for `plot-dispatch.sh --release` (`:166`). It matches every gated script: measured by the round-1 panel, `plot-deliver.sh --release 2.22.3 x` exits 0 at the gate today. This plan makes that exemption apply to `plot-dispatch.sh` only.

## Design

### The transition takes the reviewer

**The reviewer is `--who`.** `plot-approve.sh` already takes `--who` (`:3`, `:115`) and records it as the approver (`:293`). No second flag exists. For `Review: pr` nothing changes: `--who` defaults to `PLOT_APPROVE_WHO`, then `git config user.name`. For `Review: in-session`, `--who` is required, and neither `PLOT_APPROVE_WHO` nor `git config user.name` supplies it, because a default would let the machine name the reviewer.

**`transitions/plan.ts`.** The arm at `:257-262` splits. `ballot` keeps `review-human`. `in-session` gets its own arm:

- an empty or whitespace `who` refuses with `review-human`, and the text names `--who`;
- a `who` that is not in `input.people` refuses with a new reason, `reviewer-undeclared`, and the text names the `People` key;
- otherwise the arm proceeds, and the decided record is `<on>, <who>, in-session`.

`ApproveInput` gains `people: readonly string[]`, the handles declared in `People`. `RefusalReason` (`:86`) gains `reviewer-undeclared`.

**`workflows/approve.ts`.** Its `ApproveInput` (`:65-70`) gains `channel: string` and `people: readonly string[]`. The `in-session` arm at `:155-158` applies the same two refusals. When the review is `in-session`, the workflow skips the PR switch at `:169-182` and the PR writes at `:190-195`, and the record at `:208-215` writes `channel` instead of the `plan-PR #N` text, because an in-session plan has no plan PR. No file under `packages/*/src` imports `workflows/approve.ts` today, so its unit tests hold the parity rather than a caller.

**The bundle.** `entry/transition.ts` reads one tab-separated line (`:71`, parsed at `:90`). It gains a `people` column, comma-separated handles, passed to `approve` at `:131-136`. A malformed line still refuses the whole request.

### The script performs the approval

`plot-approve.sh --who <handle> <slug>` on a `Review: in-session` plan:

1. refuses when `PLOT_UNATTENDED=1`, naming that an in-session approval needs a person's session;
2. reads `People` through `plot-config.sh get People` and passes the handles to the bundle, which decides the refusals above;
3. skips steps 1-2, the plan PR, because none exists;
4. writes the decided phase and record, writes its state receipt, clears `.plot/hold` for each branch, updates the sprint annotation, and pushes through `plot-push-main.sh`, as for `Review: pr`;
5. after the push lands, appends `<date>\t<slug>\t<who>\t<entry>` to `.plot/state/in-session-approvals.tsv`, where `<entry>` is `board` when `PLOT_APPROVE_ENTRY=board` is set and `script` otherwise.

The log is machine-local, beside `unowned-state-writes.tsv`, for the same reason: it counts what happened on this checkout. It replaces the count the `--unowned` rows held, so the bypass count survives the bypass's removal. Without `--who`, the refusal at `:200-202` stays and names `--who`.

### The routes

**Approve.** `POST /api/approve` accepts `{"slug": "<slug>", "who": "<handle>"}`. The handler in `packages/board/src/server/approve.ts` already records the action receipt above both arms (`:293`), so the gate clears without a new exemption. For an in-session plan:

- with no `Approve command` declared, the route runs the script arm (`:302-303`) as `plot-approve.sh --who <who> <slug>` with `PLOT_APPROVE_ENTRY=board`;
- with `Approve command` declared, the route answers 409 and spawns nothing, because that arm runs `claude -p /plot-approve` unattended (`:294-301`) and `/plot-approve` refuses in-session when unattended (`plot-approve/SKILL.md:124-128`);
- a request without `who` answers the script's refusal sentence.

The board passes no name of its own. No config key or server field names the operator, so the person who clicks supplies `who`, and the domain refuses a handle `People` does not declare.

**Release.** A new route, `POST /api/release`, accepts `{"slug": "<slug>", "version": "<version>"}`. It records an action receipt for `release` and runs `plot-deliver.sh --release <version> <slug>` with no agent arm. `ControllerAction` in `packages/board/src/server/action-receipt.ts:39` gains `release`. `gated_action` in `plot-controller-gate.sh:80-86` maps `plot-deliver.sh` with `--release` to `release`, so the refusal names `POST /api/release`. The route joins `WRITE_ROUTES` in `packages/board/test/write-gate.test.mjs:38`. `/api/deliver` stays as it is, because it spawns an agent for a judgement act and a release write needs none.

**The skills.** `/plot-approve` step 3b asks the person for their handle and calls `POST /api/approve` with it. `/plot-release` step 5 calls `POST /api/release` once per plan. Where no board answers, both use the gate's existing named bypass, `plot-state-receipt.sh --unowned-action <action> <slug> "<reason>"`, which counts to `unowned-action-writes.tsv`. Neither SKILL.md tells an agent to write `--unowned` for these two state writes.

### The script performs the release

`plot-deliver.sh --release <version> <slug>`:

1. reads the plan's last `→ #N` annotation and asks `plot-host.sh pr-state <N>` for its `mergeCommit`; a plan with neither is refused as unresolvable;
2. refuses unless `v<version>` is the first `vX.Y.Z` tag that `git tag --contains <mergeCommit>` lists, sorted by version, which is the rule `plot-release/SKILL.md:381-382` applies by hand;
3. reads the tag date with `git log -1 --format=%as v<version>`, which is the `<tag date>` of `plot-release/SKILL.md:395`;
4. asks `plot-transition.mjs` for the `release` verb with that date and version, writes `State: Released` and `Released: <tag date>, v<version>`, writes its receipt, and pushes.

The domain decides the phase: `release` refuses Draft and Approved and accepts `released` as the idempotent case, so the script refuses a plan that is neither Delivered nor already Released. A Released plan with its record is a no-op, not a refusal. `/plot-release` keeps rule 1 of step 5, which skips docs and infra plans.

**Why `plot-deliver.sh` and not a new script.** The repository refuses a new `plot-*.sh` (`scripts/check-script-names.sh`), `plot-deliver.sh` already performs the transition bundle and owns a `State:` receipt, and Released is the transition after Delivered. A dedicated controller name belongs to the port work `check-script-names.sh:107` names for `plot-deliver.sh`, not to this plan.

### The overlapping brief

`.plot/briefs/a-release-is-a-controller-command.md` is the brief for the slice *Releasing asks the controller for its verdict* of `the-master-agent-uses-the-controllers`. It shipped as #848 (`96c20470`) and built the sprint gate in front of a release, `plot-release-gate.sh`. It decides whether a release may happen. This plan owns the write after the release, `State: Released`. `plot-release/SKILL.md:404-409` still says the `Released` gap stays open "until `a-release-is-a-controller-command` closes it"; the second slice rewrites that sentence to name `POST /api/release`.

### What this does NOT do

- **It does not approve a `Review: ballot` plan.** Reading a tally is a separate rule.
- **It does not remove `--unowned`.** `Rejected` and `Superseded` keep it until `/plot-reject` has an owner.
- **It does not let a script choose the reviewer.** The name comes from the person in the session, the domain checks it against `People`, and no default supplies it.
- **It does not authenticate the person.** The board's write routes are gated by loopback only (`packages/board/src/server/index.ts:218`), so an agent on the machine can send a declared handle. The counted log makes every such approval visible; it does not prevent one.

## Done when

- `plot-approve.sh --who jwloka <slug>` on an in-session Draft plan writes `State: Approved` and `Approved: <date>, jwloka, in-session`, updates the sprint annotation, commits, adds no row to `unowned-state-writes.tsv`, and adds one row to `in-session-approvals.tsv`.
- On an in-session plan it refuses without `--who`, with an empty `--who`, with a handle `People` does not declare, and under `PLOT_UNATTENDED=1`; each refusal writes nothing and names its cause.
- `plot-deliver.sh --release 2.22.3 <slug>` on a Delivered plan whose merge commit `v2.22.3` first contains writes `State: Released` and `Released: <tag date>, v2.22.3`, and adds no row to `unowned-state-writes.tsv`. It refuses a version with no tag, a tag that does not contain the merge commit, a later tag than the first that contains it, and a Draft or Approved plan.
- From the repository root with no action receipt, the controller gate refuses `plot-approve.sh --who jwloka <slug>` and `plot-deliver.sh --release 2.22.3 <slug>`, naming `POST /api/approve` and `POST /api/release`. With the receipt each clears. `plot-dispatch.sh --release <branch>` still clears without one.
- `transitions/plan.ts` and `workflows/approve.ts` answer the same for in-session with a declared, an undeclared and an empty `who`, at 100% branch coverage.
- `/plot-approve` step 3b and `/plot-release` step 5 call the routes; neither SKILL.md tells an agent to write `--unowned` for these two writes.

Tests that fail on `origin/main` today:

- `packages/domain/test/transitions.test.ts`: new cases *approves an in-session plan with a declared `who`* and *refuses `reviewer-undeclared` for an undeclared `who`* fail, because the case at `:132-142` asserts `review-human` for every in-session input. That case is rewritten to pass an empty `who` and keeps its refusal.
- `packages/domain/test/workflows-approve.test.ts`: the `it.each` at `:61` splits. New cases *approves in-session with no PR reading* and *refuses an undeclared `who`* fail today; `ballot` keeps the refusal.
- `test/reconcile/approve.test.mjs`: new cases fail, because `:238-243` asserts the refusal: *`--who` approves Review: in-session with one in-session row and no unowned row*; *self-approval is refused*, which runs with `git config user.name jwloka` and `People: jwloka = Jan Wloka` and asserts that no `--who`, `--who ""` and `--who claude` each refuse; and *unattended is refused*, which runs `--who jwloka` under `PLOT_UNATTENDED=1`. The `:238` case keeps the refusal without the flag and asserts the message names `--who`.
- `test/reconcile/deliver-phase-takes-effect.test.mjs`: *--release writes Released and its record with no unowned row* and *--release refuses a tag that does not contain the merge commit* fail, because `plot-deliver.sh` takes no `--release` today.
- `test/reconcile/controller-gate.test.mjs`: *plot-deliver.sh --release is refused without a receipt and names /api/release* fails, because the exemption at `:177` clears it today. *plot-approve.sh --who is refused without a receipt and clears with one* holds the route.
- `packages/board/test/write-gate.test.mjs`: the route list at `:163` fails until `/api/release` joins `WRITE_ROUTES`. A board test *POST /api/approve answers 409 for an in-session plan when `Approve command` is declared* fails, because the route spawns the agent today.

## Slices

### The transition takes the reviewer (Branch: bug/the-transition-takes-the-reviewer, PR: #1185)

The `in-session` arm split in `transitions/plan.ts` with `people` and `reviewer-undeclared`; the `channel` and `people` inputs and the PR skip in `workflows/approve.ts`, with a unit case that has no PR reading; one unit case per arm in each file: a declared `who` approves, an undeclared one refuses with `reviewer-undeclared`, an empty one refuses with `review-human`, and `ballot` refuses with `review-human`. Also the `people` column in `entry/transition.ts` and the changeset.

### The scripts own the approval and the release (Branch: bug/the-scripts-own-the-approval-and-the-release, PR: #1217) <!-- waits: bug/the-transition-takes-the-reviewer -->

`plot-approve.sh --who` for in-session with the unattended refusal and `in-session-approvals.tsv`; `plot-deliver.sh --release` with the merge-commit check and the tag date; `POST /api/approve` with `who` and the 409 on the agent arm; `POST /api/release`; the gate's `release` action and the ` --release ` exemption scoped to `plot-dispatch.sh`; the contract tests in `test/reconcile/` and the board tests; the two SKILL.md steps, including the sentence at `plot-release/SKILL.md:404-409`.

## Notes

Split from #1040 on purpose. #1040 is about the release PR's required CI check; this plan is about who writes a lifecycle field. They share the release moment and nothing in their mechanism, so #1040 has its own plan, `the-release-pr-is-checked-before-it-merges`.

Round 1 (`.plot/panels/2026-10-01-an-in-session-approval-has-a-controller/round1.md`) was unanimous `amend`. This version drops `--reviewer` for the existing `--who`, adds the `People` and unattended refusals and the counted log, routes both writes through the controller gate, and resolves the release version from each plan's merge commit.

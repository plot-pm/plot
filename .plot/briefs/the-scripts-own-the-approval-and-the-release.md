## Implementation brief — an-in-session-approval-has-a-controller (slice 2: The scripts own the approval and the release)

- **Plan (canonical):** `docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-scripts-own-the-approval-and-the-release` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`. Do not run `gh pr create`.
- **Review of the code:** PR review, as for any slice in this repository.

This slice waits for `bug/the-transition-takes-the-reviewer`. That slice merged as #1185 (`c78090ca`), so this one is eligible. It reads what #1185 built: `approveTransition` in `packages/domain/src/transitions/plan.ts` takes `who` and `people`, refuses `review-human` and `reviewer-undeclared`, and decides `<on>, <who>, in-session`; `entry/transition.ts` reads a twelfth tab-separated field, `people`, comma-joined.

### What to build

237 `--unowned` receipts sit in `.plot/state/unowned-state-writes.tsv` of the main checkout: 109 `Approved` and 112 `Released`. Each one is a `State:` line a master agent wrote by hand because no script owned the write. #1185 made the domain able to decide both. This slice makes two scripts perform them and puts a route in front of each, so the two writes stop needing a receipt.

Four pieces, in this order:

1. **`plot-approve.sh --who <handle> <slug>` on a `Review: in-session` plan.** The flag exists already (`:3`, `:115`); the refusal at `:200-202` stays for the case with no `--who` and now names `--who`. With `--who`, the script refuses under `PLOT_UNATTENDED=1`, reads `People` with `plot-config.sh get People`, passes the handles as the twelfth field to `plot-transition.mjs`, skips the plan PR (steps 1-2), and runs steps 4 on as for `Review: pr`. After the push lands it appends `<date>\t<slug>\t<who>\t<entry>` to `.plot/state/in-session-approvals.tsv`, where `<entry>` is `board` under `PLOT_APPROVE_ENTRY=board` and `script` otherwise.
2. **`plot-deliver.sh --release <version> <slug>`.** Reads the plan's last `→ #N`, asks `plot-host.sh pr-state <N>` for `mergeCommit`, refuses unless `v<version>` is the first `vX.Y.Z` tag in `git tag --contains <mergeCommit>` sorted by version, reads the tag date with `git log -1 --format=%as v<version>`, asks `plot-transition.mjs` for the `release` verb, writes `State: Released` and `Released: <tag date>, v<version>`, writes its receipt, pushes. A Released plan with its record is a no-op.
3. **Routes.** `POST /api/approve` takes `who` and passes it to the script arm; `POST /api/release` is new. `ControllerAction` in `packages/board/src/server/action-receipt.ts:39` gains `release`; `gated_action` in `plot-controller-gate.sh` maps `plot-deliver.sh` with `--release` to it.
4. **Skills.** `/plot-approve` step 3b and `/plot-release` step 5 call the routes, and the `plot-release/SKILL.md` sentence about `a-release-is-a-controller-command` closing the gap names `POST /api/release` instead.

### The decisions the plan settles — do not re-derive them

**`--who` is the reviewer; there is no `--reviewer`.** The round-1 panel measured `plot-approve.sh --reviewer jwloka x` and it exits 2 at the controller gate. For `Review: pr` the default chain stays (`PLOT_APPROVE_WHO`, then `git config user.name`). For `Review: in-session` neither supplies a name, because a default lets the machine name the reviewer. A test with `git config user.name jwloka` and `People: jwloka = Jan Wloka` must still refuse a missing, an empty and an undeclared `--who`: it catches an implementation that falls back to the git name.

**The release goes in `plot-deliver.sh`, not a new script.** `scripts/check-script-names.sh` refuses a new `plot-*.sh`, `plot-deliver.sh` already calls the transition bundle and owns a `State:` receipt, and Released is the transition after Delivered. A dedicated name belongs to the port work `check-script-names.sh:107` describes.

**The version comes from each plan's merge commit, not from a date or a PR title.** `plot-release/SKILL.md:381-382` applies this rule by hand: `git tag --contains <mergeCommit>`, first `vX.Y.Z` by version sort. Measured earlier on this estate, a plan booked 2026-08-19 had shipped in v2.5.0, so a date-based answer is wrong. The `mergeCommit` comes from `plot-host.sh pr-state`, never from `plot-impl-status.sh`: a branch resolved from the index carries no `mergeCommit` (`CLAUDE.md`, `plot-impl-status.sh` row). A plan with no `→ #N` or no `mergeCommit` is refused as unresolvable, and the refusal writes nothing.

**The domain decides the phase.** `release` in `transitions/plan.ts` refuses Draft and Approved and accepts `released` as the idempotent case. The script does not re-implement the phase check; it reads the bundle's answer. `/plot-release` keeps rule 1 of step 5, which skips docs and infra plans.

**The gate's ` --release ` exemption is for `plot-dispatch.sh` only.** `plot-controller-gate.sh:227` matches `*" --release "*` for every gated script, and the round-1 panel measured `plot-deliver.sh --release 2.22.3 x` exiting 0 at the gate today. Scope the arm to `plot-dispatch.sh` (`plot-dispatch.sh --release <branch>` must still clear with no receipt). Without this change the release write has no controller, which is the failure this plan exists to close, and the test *plot-deliver.sh --release is refused without a receipt and names /api/release* is the one that fails today.

**`POST /api/approve` answers 409 on the agent arm for an in-session plan.** With an `Approve command` declared, the route runs `claude -p /plot-approve` unattended (`approve.ts` agent arm), and `/plot-approve` refuses in-session when unattended (`plot-approve/SKILL.md:124-128`). Spawning it would start an agent that can only refuse. Answer 409, spawn nothing, record no receipt. With no `Approve command`, the script arm runs `plot-approve.sh --who <who> <slug>` with `PLOT_APPROVE_ENTRY=board`. The route already records the action receipt above both arms, so the gate clears with no new exemption. A request with no `who` answers the script's own refusal sentence.

**`POST /api/release` has no agent arm.** `/api/deliver` spawns an agent because delivering is a judgement act; a release write needs none. The route records a `release` action receipt and runs `plot-deliver.sh --release <version> <slug>` through the same script-start helper `approve.ts` uses. It joins `WRITE_ROUTES` in `packages/board/test/write-gate.test.mjs:38`. That list is asserted equal to the server's own route table (`:163`), so a route missing from it fails the suite, and a route missing from the table does too.

**The board passes no name of its own.** No config key or server field names the operator, so the person who clicks supplies `who`, and the domain refuses a handle `People` does not declare. This does not authenticate anyone: the write routes are gated by loopback only, so an agent on the machine can send a declared handle. The counted `in-session-approvals.tsv` makes it visible and does not prevent it. State that in the PR rather than hiding it.

**The log replaces a count, and it is machine-local.** `in-session-approvals.tsv` sits beside `unowned-state-writes.tsv` in `.plot/state/` for the same reason `plot-boardctl.sh:83` names: it counts what happened on this checkout. It is appended **after the push lands**, so a refused or interrupted approval leaves no row. Never put it in a commit.

**Where no board answers, the fallback is the gate's named bypass, not `--unowned`.** `plot-state-receipt.sh --unowned-action <action> <slug> "<reason>"` counts to `unowned-action-writes.tsv`. Neither SKILL.md tells an agent to write `--unowned` for these two state writes. `Rejected` and `Superseded` keep `--unowned` until `/plot-reject` has an owner; do not touch them.

**Rules carried over unchanged.** Absent is not false: a plan the parser cannot read, a missing tag and a missing `mergeCommit` refuse, and none reads as *nothing to do*. Read the exit code, not the emptiness (`plot-agent-settings.sh`'s rule). Each refusal writes nothing and names its cause. `Review: ballot` still refuses `review-human`; this plan does not approve a ballot plan. Every `State:` write goes through the script that owns it with its receipt: `plot-state-gate.sh` refuses the rest at the commit.

### Done when

The plan's `## Done when` list is the specification. The assertions a naive implementation passes without:

- **A refusal writes nothing.** For each in-session refusal (no `--who`, empty, undeclared, `PLOT_UNATTENDED=1`) assert a clean `git status`, no commit, no row in either `.tsv`. It catches a refusal placed after the plan edit.
- **The approval adds exactly one `in-session-approvals.tsv` row and no `unowned-state-writes.tsv` row.** Count both before and after. It catches a script that still declares `--unowned`.
- **The release tag rule has four refusals.** No tag for the version; a tag that does not contain the merge commit; a later tag than the first that contains it; a Draft or Approved plan. The third is the one a `git tag --contains | head -1` without a version sort passes.
- **A second `--release` on a Released plan is a no-op.** Same exit 0, no new commit.
- **The gate test pair.** `plot-deliver.sh --release` is refused with no receipt and the message names `POST /api/release`; `plot-approve.sh --who` is refused and names `POST /api/approve`; each clears with its receipt; `plot-dispatch.sh --release <branch>` still clears with none.
- **The 409 test.** `POST /api/approve` on an in-session plan with `Approve command` declared answers 409 and spawns nothing. It catches the route that starts an agent that refuses.
- **Reach.** The route tests drive a real server and a real script, not a stub of `scriptsFor`. #1185's rule is green in unit tests; the failure this repository keeps measuring is a rule nothing calls.

Plus the repository gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints: the tests that name a changed file, the related tests and typecheck of a changed package, the gate tests and `scripts/check-*.sh`. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run `pnpm build:board` so the committed `board-server.mjs` and the shipped bundles match their sources. Node 24 (`nvm use`). Add a changeset with the description first: the board code takes `'@plot-pm/board': patch`, and the scripts and skills take `plot: minor` with a `bumps:` block naming `plot-approve`, `plot-release` and `plot`, at the level that fits each. New functions are arrows; TSDoc states what an export does. Update the `plot-approve.sh`, `plot-deliver.sh` and `plot-controller-gate.sh` rows in `CLAUDE.md` only where this slice changes their behaviour, and the `Model Guidance` table in each SKILL.md whose steps change.

### Bookkeeping

Open the PR with `plot-open-pr.sh`, then append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-approve.sh`, `skills/plot/scripts/plot-deliver.sh`, `skills/plot/scripts/plot-controller-gate.sh`, `packages/board/src/server/approve.ts`, a new `packages/board/src/server/release.ts`, `packages/board/src/server/index.ts` (the route table), `packages/board/src/server/action-receipt.ts`, `skills/plot-approve/SKILL.md`, `skills/plot-release/SKILL.md`, the rebuilt bundles, and their tests under `test/reconcile/` and `packages/board/test/`. It does not touch `packages/domain/src/transitions/plan.ts`, `workflows/approve.ts` or `entry/transition.ts`: #1185 owns them and merged. If the bundle needs a change there, report it. The overlap with `a-release-is-a-controller-command` is documentation only (the SKILL.md sentence); that slice shipped as #848. At dispatch, verify other branches' holds with the dispatcher's overlap report rather than trusting this line.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

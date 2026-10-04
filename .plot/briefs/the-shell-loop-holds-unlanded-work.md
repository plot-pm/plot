## Implementation brief — the-shell-loop-holds-unlanded-work

- **Plan (canonical):** `docs/plans/2026-10-04-the-shell-loop-holds-unlanded-work.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/the-shell-loop-holds-unlanded-work` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the only slice of its plan. `infra/the-loop-has-a-workflow` in `the-worker-loop-runs-in-js` waits on it: that plan's loop table copies the `holding-work` row from here, and its baseline counts from the `endings.jsonl` file this slice starts writing.

### What to build

The shell loop in `skills/plot/scripts/plot-worker-loop.sh` ends a prompt turn that left work behind, and then goes on as if the slice were finished. Measured 2026-10-03 and 2026-10-04 (#1246): an agent ended its turn while it waited on a background job, the loop found the desk dirty, cut a new desk for the next slice, and left 14 files behind. It happened twice, on `the-queue-reads-the-scans-order` and `the-parser-reads-every-wait`. Each time a person found the work by hand, on a desk no agent and no manifest named.

Today the only place the loop reads `desk_reset_refusal` is the hop (`plot-worker-loop.sh:2977` to `:3000`), and there the dirty desk is left behind and a new desk is cut. By then `seal_declaration` and `clear_manifest_branch` have already run, so the agent has declared the slice finished and given it back to the queue.

The change has three parts:

1. **The loop asks about its own desk after a prompt exits `ran`.** Call `desk_reset_refusal "$PLOT_WORKTREE"` and read the **word it prints**, not its exit status. On `uncommitted-changes` or `unpushed-commits`, the loop writes the ending `holding-work`, actor `agent`, detail `desk_hold_reason`'s phrase; logs one line to stderr; and exits 0. It does not seal a declaration, does not clear the manifest's branch, and does not hop. Every other answer leaves today's path unchanged.
2. **The ending vocabulary grows by one.** `EndingReasonSchema` in `packages/domain/src/entities/ending.ts` gains `holding-work`. `endingIsAttributable` in `packages/domain/src/transitions/agent.ts` admits actor `agent` for it beside `unstarted`, `limited` and `unregistered`, and its refusal sentence names all four. The doc comment on actor `agent` in `ending.ts` says "failed to start" today, and it is rewritten to cover an ending the agent's loop records about its own desk. `packages/domain/test/ending.test.ts` and `packages/domain/test/transitions-agent.test.ts` grow with it, next to the `unregistered` cases (`ending.test.ts:127`, `transitions-agent.test.ts:296`).
3. **`write_ending` also appends each ending as one JSON line to `.plot/state/endings.jsonl` in the main checkout.** `main_checkout_path` (`:821`) already reads the first entry of `git worktree list`. `.plot/state/` exists and `endings.jsonl` is gitignored there, so the append adds nothing to a desk's dirty list. The append is best effort: a failed append logs once and changes no ending file, no exit code and no return status of `write_ending`.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**Ask the existing rule; do not write a second one.** `desk_reset_refusal` is the shell side of `resetRefusals` (`rules/reapable.ts`), and `packages/domain/corpus/desk-reset.corpus.test.ts` pairs the two. A new `git status` check in the loop would be a third copy of the same three questions. Rejected for that reason, and because the corpus test could not hold it.

**Read the refusal's word, never its status.** `desk_reset_refusal` prints a word and returns 0 for every condition it names, including `blocked-marker` and `no-desk`. A test of the exit status alone treats a desk holding an agent-written `PLOT-BLOCKED` marker as unlanded work. That desk keeps today's path: the marker already tells a person, and the plan scopes the new ending to the two unlanded-work words.

**`desk_hold_reason` stays whole.** The new ending's detail reuses the same two arms the hop's log line uses (`:760`). Their tests (`test/reconcile/deskreset.test.mjs:98` to `:123`) stay as they are. Splitting the function was raised in panel round 3 and rejected.

**Exit 0, not 124.** The dispatch wrapper turns exit 0 into a `clear` line and any non-zero exit into `gone`, and the board reads `gone` as "restart it". The loop stopped on purpose and recorded why, so exit 0 is the true answer. Exit 124 is the bound's own number and would tell an operator a clock fired.

**The position is the mechanism.** Put the check where `$_exit_verdict` says the prompt ran, **before** `seal_declaration` (`:2863`), `record_slice_spend` and `clear_manifest_branch`. After any of them the agent has already given up the desk, the claim and the branch, and the manifest reads the agent as free while its tree holds work. The same reasoning is written above `seal_declaration` and above the usage-limit arm; read both. Whether the check sits before or after `wait_for_checks` and the build-failed arm is a judgement for the implementer: unpushed commits have no CI run to wait on, and a dirty tree is not what the checks measure. State the choice and the reason in the PR body.

**What happens to the desk next is not this slice's to change.** `deskState` reads the desk as `holding-work`, `deskLifecycle` names a person for it, and `supervise` answers `correct` while `MAX_ATTEMPTS` lasts and `needs-a-person` after. No rule that reads the desk changes here. Do not touch `rules/` or `workflows/`.

**The hop's hold arm stays.** `:2996` to `:3000` still serves a desk that holds an agent-written `blocked-marker`. Do not delete it, and do not rewrite its log line.

**The ratchet is a rule of this slice, not an obstacle.** `scripts/check-shell-lines.sh` counts non-comment, non-blank lines under `skills/`, stores no number and has no override. The ending, the exit and the append add shell, and the PR pays for them with lines removed in the same change, measured with `scripts/check-shell-lines.sh pr`. Write the rule in the domain and ask it through a bundle where that is smaller; `docs/shell-and-domain.md` is the contract, and note that a per-pass call to a bundle costs about 39 ms against a once-per-ending call here. **If the lines cannot be found, stop and report with `PLOT-BLOCKED`. Do not widen the gate, do not add an exemption, and do not brief a shell helper to get around it.**

**Rules carried over unchanged.** Absent is not false: a missing main checkout, a missing `.plot/state` directory or a failed append means "not recorded", never a changed ending. Read the exit code, not the emptiness: `desk_reset_refusal` answers by its printed word. A function you write or rewrite is an arrow in TypeScript. Tests that spawn must wait for the process to exit, not for a file.

### Done when

The plan's tests are the specification. In `test/reconcile/`, with a prompt that exits `ran`:

- uncommitted changes, no marker: the ending is `holding-work`, the exit is 0, no `plot-wt-*` sibling exists, and the original desk keeps its files;
- unpushed commits, no marker: the same;
- an agent-written marker on a dirty desk: today's path, byte for byte;
- a clean, pushed desk: today's path, unchanged;
- each ending adds one line to `endings.jsonl`, and a missing main checkout changes no exit code.

The domain side: `ending.test.ts` accepts `holding-work` as a reason, and `transitions-agent.test.ts` admits actor `agent` for it and still refuses actor `agent` for `bound`, `quiet`, `unreadable` and `spent`.

Assertions that exist because a naive implementation passes without them:

- **The declaration is not sealed and the manifest keeps its branch.** A loop that writes the ending and exits 0 after `seal_declaration` passes every assertion above. Assert the manifest still names the branch and no declaration exists for it.
- **The marker case reads the word.** A status-only check makes the dirty-desk-with-marker case end `holding-work`. This case catches it.
- **The existing hop tests keep passing unchanged.** `workerloop.test.mjs:329` to `:335` counts `plot-wt-*` siblings and worktrees, and `:1405` drives a hop onto a new desk. Re-read both against the code on the day. If one of them leaves a dirty desk behind a `ran` prompt, that fixture now ends `holding-work`; say so in the PR rather than editing the assertion to match.
- **One line per ending, appended, never rewritten.** Two endings from one desk give two lines, in order.

Plus the repo's gates: a changeset (`'plot': patch` with a `bumps:` block naming `plot-dispatch` if its SKILL.md or README changes; description first, `bumps:` last), `scripts/check-shell-lines.sh pr` passing, and no built bundle in the diff (`scripts/check-no-bundle-diff.sh`). This slice changes no board code. The board reads the same ending file and `holding-work` is one more value of an enum its schema imports from the domain.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`), and run a failing `test/reconcile` file alone before believing it: those suites fail falsely under worktree contention.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. When the slice touches a `.sh` file, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-loop.sh` (the `ran` path, `write_ending`, and the lines removed to pay for them)
- `packages/domain/src/entities/ending.ts`, `packages/domain/src/transitions/agent.ts`, and their tests in `packages/domain/test/`
- `test/reconcile/` cases for the loop, the ending and `endings.jsonl`
- one changeset

Verified 2026-10-04 against every remote branch: none other changes `plot-worker-loop.sh`, `ending.ts` or `transitions/agent.ts`. The one plan that does depend on this slice is `the-worker-loop-runs-in-js`; its slice 1 adds `blocked` and `checks-unanswered` to the same enum and waits on this branch's merge, so the enum lines are yours alone for now. Do not add those two values.

**Open question, not yours to answer:** the plan's second half of #1246 — the worker prompt must say a turn ends only when work is pushed or blocked — may be its own plan. Do not edit `.plot/worker-prompt.sh` or any prompt text here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

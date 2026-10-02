## Implementation brief — an-in-session-approval-has-a-controller (slice 1: the transition takes the reviewer)

- **Plan (canonical):** `docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-transition-takes-the-reviewer` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the repo's PR review; the plan's `Review:` is `in-session`

Slice 2, `bug/the-scripts-own-the-approval-and-the-release`, waits on this branch: it calls the rule this branch changes. Do not touch `plot-approve.sh` beyond the one `printf` described below, and do not touch `plot-deliver.sh` beyond its one `printf`. Do not add `--who` handling, a route, or a gate change here.

### What to build

The domain refuses every `Review: in-session` approval with `review-human`, so 109 in-session approvals on this checkout were written under an `--unowned` receipt (`.plot/state/unowned-state-writes.tsv`, measured 2026-10-01). `ApproveInput` already carries `who` and `channel`; only the refusal discards them. This slice makes the rule accept a named, declared reviewer. It changes the rule and its bundle and nothing that calls them.

Three files, in this order:

1. `packages/domain/src/transitions/plan.ts`. The shared arm at `:257-262` splits. `ballot` keeps `review-human`. `in-session` gets its own arm: an empty or whitespace `who` refuses with `review-human` and a sentence naming `--who`; a `who` absent from `input.people` refuses with the new reason `reviewer-undeclared` and a sentence naming the `People` config key; otherwise it proceeds and the decided record is `<on>, <who>, in-session`. `ApproveInput` (`:186-195`) gains `people: readonly string[]`. `RefusalReason` (`:86`) gains `reviewer-undeclared`. `approvable` (`:382` in the test) stays `false` for `in-session`: it answers *should Approve be offered with no reviewer*, and none is named.
2. `packages/domain/src/workflows/approve.ts`. Its `ApproveInput` (`:65-70`) gains `channel: string` and `people: readonly string[]`. The `in-session` arm at `:155-158` applies the same two refusals as step 1. When the review is `in-session` the workflow skips the PR switch (`:169-182`) and the PR writes (`:190-195`), and the record write (`:208-215`) uses `channel` in place of the `plan-PR #N` text, because an in-session plan has no plan PR. The PR-state switch (`pr-closed`, `pr-absent`) must not refuse an in-session plan for want of a PR.
3. `packages/board/src/server/entry/transition.ts`. `requestFrom` (`:71`, `:90`) gains a twelfth column, `people`, comma-separated handles, passed to `approve` at `:131-136`. The count check, the TSDoc and the error text say twelve.

### Settled decisions — do not re-derive them

**The reviewer is `who`, and nothing supplies it by default.** The plan dropped `--reviewer` for the existing `--who` after the round-1 panel. A default from `PLOT_APPROVE_WHO` or `git config user.name` would let the machine name the reviewer. The rule sees only `who`; defaults belong to the script and slice 2 does not add one for in-session.

**An undeclared handle is its own reason.** `review-human` says *a human is needed*; `reviewer-undeclared` says *this name is not one the project declared*. Collapsing them gives a caller one sentence for two repairs (type a name, or add one to `People`). Do not reuse `review-unrecognised` — that reason means the `Review:` value is unknown.

**Compare handles, not display names.** `people` is the list of handles the `People` key declares (`jwloka = Jan Wloka` gives `jwloka`). `who` is matched against the handle exactly, case-sensitive, after trimming. Do not match against the spellings: the plan's text and the log record handles.

**Empty `people` refuses every in-session `who`.** A project declaring no `People` has declared no reviewer. Absent is not permission.

**The twelfth column is not optional, and that forces two edits outside the plan's file list.** `requestFrom` refuses any line that is not exactly its field count and does not pad (a short line would read as *no record written yet* and overwrite a dated approval). The two senders build the line with `printf`:

- `skills/plot/scripts/plot-approve.sh:516`: `'approve\t%s\t...\t%s\t%s\t%s\t\n'` ends in an empty `version` field. Append one more `\t` and pass an empty `people` for now.
- `skills/plot/scripts/plot-deliver.sh:396`: `'deliver\t%s\t...\t%s\t\t\t\n'` ends in three empty fields. Append one more `\t`.

Without both, every approval and every delivery refuses with `expected 12 tab-separated fields, got 11` the moment the bundle is rebuilt. The plan's slice 1 text lists the bundle and not the senders; this is the thing it did not anticipate. Keep the two `printf` edits to the format string only. Slice 2 owns passing real handles from `plot-approve.sh`. **Put the `people` column last**, after `version`, so both senders append and no existing field moves.

**Put the column in the field that cannot be confused.** `people` is comma-joined; a handle never contains a comma or a tab (`plot-config.sh get People` parses `handle = Spelling`). `requestFrom` splits on `,` and drops empty entries, so `''` yields `[]`.

**The ballot arm does not change.** `ballot` reads a tally; a `who` does not stand in for one. The plan says so in *What this does NOT do*.

**Rules carried over unchanged.** Absent is not false: an empty `who` is *no reviewer named*, never *the default reviewer*. Read the exit code, not the emptiness: the bundle exits 1 with a tab-separated `reason\tsentence` on a refusal and 2 on an unreadable line, and an approval with `people` unreadable must exit 2, not approve.

### Done when

The plan's `## Slices` entry for this branch is the specification. The assertions that exist because a naive implementation would pass without them:

- **Both files answer the same.** `transitions.test.ts` and `workflows-approve.test.ts` run the same five inputs against `approve` in `transitions/plan.ts` and in `workflows/approve.ts`: in-session with a declared `who` approves; with an undeclared `who` refuses `reviewer-undeclared`; with an empty `who` refuses `review-human`; with a whitespace `who` refuses `review-human`; `ballot` refuses `review-human`. A change in only one file passes its own tests and fails the parity.
- **The case at `transitions.test.ts:132-142` is rewritten, not deleted.** It passes an empty `who` and keeps asserting `review-human`. The `it.each` at `workflows-approve.test.ts:61` splits: `ballot` keeps the refusal, and `in-session` moves to the new cases.
- **A workflow case with no PR reading.** *approves in-session with no PR reading* uses `pr: { number: 0, state: 'NONE', ... }` and expects an approval whose writes contain no `pr-ready` and no `pr-merge`, and whose record is `<on>, <who>, in-session`. A workflow that still runs the PR switch refuses `pr-absent` and fails this.
- **Empty `people` refuses a named `who`.** Catches a membership test written as `people.length === 0 || people.includes(who)`.
- **The bundle is tested through `requestFrom` and `decide`**, in a new `packages/board/test/unit/transition-people.test.ts`: an eleven-field line refuses (`expected 12`), a twelve-field in-session line with a declared handle approves, an undeclared one answers `reviewer-undeclared`.
- **Both shell senders still work.** `test/reconcile/approve.test.mjs` and `test/reconcile/deliver-phase-takes-effect.test.mjs` pass unchanged after `pnpm build:board`. They are the proof that the two `printf` edits match the bundle.
- **Branch coverage 100%** on the new arms in both domain files, per the plan.
- **Prove each test by mutation.** Delete the `reviewer-undeclared` arm, then the empty-`who` arm, then the PR-switch skip, one at a time, and watch the matching test fail. Commit or stage the baseline first; `git checkout -- <file>` discards unstaged work.

Plus the repo gates: `nvm use` (Node 24; pnpm crashes on 26), `pnpm install` if `node_modules` is missing, `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and `pnpm build:board` so the committed `skills/plot/scripts/board/plot-transition.mjs` matches its source (a stale artifact fails reassuringly). Do not run `pnpm run test:e2e` locally; CI owns it. In `packages/domain/**` write arrow functions, not declarations, and keep TSDoc factual: what a function returns and how it fails, with the history in the commit message.

### Bookkeeping

- Changeset in `.changeset/the-transition-takes-the-reviewer.md`, description first, `bumps:` block last, with the `plan:` line. Both packages, as the usage-limit changeset does:

  ```
  ---
  'plot': patch
  '@plot-pm/board': patch
  ---

  <description with the measurement: 109 in-session approvals written under an --unowned receipt on 2026-10-01>

  <!--
  plan: docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md
  bumps:
    skills:
      plot: patch
  -->
  ```

  `.changeset/` holds siblings' files; add your own and touch none. Run `./scripts/check-changeset-packages.sh`.
- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/transitions/plan.ts`, `packages/domain/src/workflows/approve.ts`, `packages/board/src/server/entry/transition.ts`, their tests (`packages/domain/test/transitions.test.ts`, `packages/domain/test/workflows-approve.test.ts`, the new `packages/board/test/unit/transition-people.test.ts`), the rebuilt `skills/plot/scripts/board/*.mjs` artifacts, the one-token format-string edit in each of `plot-approve.sh` and `plot-deliver.sh`, and one changeset.

Not this branch's: `--who` handling, the unattended refusal and `in-session-approvals.tsv` in `plot-approve.sh`; `plot-deliver.sh --release`; `POST /api/approve` and `POST /api/release`; the controller gate; the two SKILL.md steps. All of it is slice 2.

**In flight, checked against every remote branch on 2026-10-02:** `bug/approval-refuses-an-unnamed-slice` (plan `an-approved-slice-has-a-name`) changes the same five source and test files plus `plot-approve.sh`: +30 lines in `transitions/plan.ts`, +27 in `workflows/approve.ts`, +76 in `entry/transition.ts` (a `--check-slices` flag), +92 and +52 in the two domain test files. It also regenerates the board artifacts. The changes are in different arms and a different part of `entry/transition.ts`, so the merge is textual. Whichever lands second rebases onto main and rebuilds with `pnpm build:board` rather than reading the artifact diff. That branch's TSDoc says a twelfth field "would have to be added to every sender in one commit"; this slice is that commit, and its `printf` edit in `plot-approve.sh` sits in a different hunk from that branch's refusal-4 block. If you find something the plan did not anticipate, report it rather than improvising outside scope.

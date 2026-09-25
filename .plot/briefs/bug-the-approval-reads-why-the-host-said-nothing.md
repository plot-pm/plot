## Implementation brief — a-throttled-host-is-not-a-missing-pr (wave 1: The approval reads why the host said nothing)

- **Plan (canonical):** `docs/plans/2026-09-25-a-throttled-host-is-not-a-missing-pr.md` on `main`
- **Approved:** 2026-09-25, Jan Wloka, in-session after panel
- **Branch:** `bug/the-approval-reads-why-the-host-said-nothing` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #985

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-approve.sh` tells an operator *"no PR found … Push the branch"* about a PR that is open. Measured 2026-09-25 on Bitbucket (`bb` 1.9.0): PR 3636 was OPEN and readable by number, while the listing answered HTTP 429. The cause is `skills/plot/scripts/plot-approve.sh:230-231`:

```bash
pr_json=$(bash "$script_dir/plot-host.sh" pr-state "$pr_branch" 2>/dev/null) || pr_json=""
[ -n "$pr_json" ] || pr_json='{"number":0,"state":"NONE","draft":false,"url":""}'
```

The line discards both the exit code and stderr, and the next line converts the empty result into `state: NONE`. The fix is to keep both. If `pr-state` exits non-zero, `plot-approve.sh` stops with the host's own stderr and prescribes nothing about the branch. If it exits 0, the existing `case "$pr_state"` block continues unchanged. The plan is canonical and this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Zero versus non-zero is the whole reading. Do not build an exit-code table.** An earlier draft keyed its design on exits 5 and 4. The panel juror stubbed both backends and measured `pr-state` exiting **3** on a rate limit (GitHub 403, Bitbucket 429, by branch and by number). Exit 5 belongs to `pr-list` (`pr_list_failed`, `plot-host.sh:528`). `pr-state` failures go through `host_miss_or_fail` (`plot-host.sh:1560`), which prints `plot-host: <err>` to stderr and returns 3. A lookup miss returns 0 with the `NONE` payload. So a non-zero exit always means the host was not asked, and a zero exit always carries an answer.

**The plan's slice line is stale on this point, and `## Done when` governs.** The `## Slices` bullet still says *"exits 5 and 4 stop"* and *"four arms"*. The Design and `## Done when` sections were amended after the panel, and the slice line was not. Build to `## Done when`: one non-zero branch, tested with 3, plus 4 and 5 as extra cases on that same branch.

**Exit 4 gets its own sentence, but it still stops.** `## Done when` asks for this: exit 4 means *this backend structurally has no answer*, and that is not evidence of a missing PR either. Use a separate message for 4, keep the same refusal, and include no push prescription.

**It is a refusal, not a pass.** Approving with an unread PR state flips the phase on an unread gate. Keep the stop before any write. Refusal 3 already sits ahead of the draft→ready step, the merge and the phase flip, so a `die` at that point leaves the plan untouched. The test must still assert this (see below).

**No retry.** A retry inside an approval turns one refused read into several, against a limit that counts them. Waiting is the operator's call.

**Do not touch `plot-host.sh`.** Its exit codes are already right.

**Do not sweep the other `pr-state` callers.** The plan counts 9 shell call sites. `plot-pr-state.sh:33` collapses the code in the same way, and its comment blesses the collapse. Leave that file alone: the sweep is its own slice, and the plan lists it as an open question.

**Worked example to copy:** `skills/plot/scripts/plot-agent-monitor.sh:242-260` (`monitor_pr_state`). It reads the exit status first ("THE EXIT STATUS DECIDES WHETHER THE HOST WAS ASKED") and the payload second. It also treats `state: null` on exit 0 as a miss, not as unaskable. Keep that `// "NONE"` jq default for the exit-0 path.

**Mechanics:** the script runs under `set -uo pipefail` (no `-e`), and `die` exits 1. Capture stderr to a `mktemp` file, not with `2>&1`: mixing the streams corrupts the JSON on the success path. Capture the code with `pr_json=$(…) ; rc=$?` or `|| rc=$?`. Remove the temp file on every path.

### Rules carried over

- Absent is not false (`plot-detect-repo.sh:94`), and unknown is not failed (`plot-board-probe.sh` auth). Read the exit code, not the emptiness.
- The host's words travel to the operator. `plot-host: …` on stderr is the text that tells them what to wait for.

### Done when

The plan's `## Done when` is the specification. These assertions exist because a naive implementation passes without them:

- **The throttled message does not contain the word "push".** This catches a fix that prints the host reason and then falls through to the old advice.
- **The genuine-absence message stays byte-for-byte the same** on exit 0 with `state: NONE`. This catches a refactor that rewords the existing arm.
- **Test with exit 3, not 5.** A test keyed on 5 alone passes against a mechanism that never fires. Add 4 and 5 as extra non-zero cases to show that the one branch covers them.
- **Assert the phase is not flipped on every stop arm.** Read the plan file on the origin/default branch after the refusal and check `Draft`, and check that the stub recorded no `pr ready` or `pr merge` call. Without this, a stop placed after the ready step would pass the message assertions.
- **The host stderr text appears in the refusal.** Stub it with a recognisable string (for example `HTTP 429`).

Write the tests in `test/reconcile/approve.test.mjs`. Its `gh.mjs` stub already answers `pr view` from a mutable state file. Add a state field that makes `pr view` write a message to stderr and exit non-zero. To produce exit 3 end to end, let the real `plot-host.sh` classify the stub failure. Make sure the stub's stderr is not a lookup-miss string that `is_lookup_miss` would treat as `NONE`. To produce exit 4 or 5, you may need a `PLOT_HOST_SCRIPT`-style override or a stub `plot-host.sh`: check how the adapter is resolved (`$script_dir/plot-host.sh`). If only 3 is reachable end to end, report that rather than bending the script.

Repo gates:

- `nvm use` (Node 24), then `corepack pnpm test` and `corepack pnpm run test:contracts`. Also run `node --test test/reconcile/approve.test.mjs` on its own.
- Do not run `test:e2e` locally. CI runs it.
- Add a changeset: `'plot': patch`, description first, then a `plan: docs/plans/2026-09-25-a-throttled-host-is-not-a-missing-pr.md` line and a `bumps:` block (`plot: patch`) at the end.
- The repo prose style applies to comments: state the current behaviour and give the measurement.

### Bookkeeping

- Push the first real commit as soon as it exists. The claim ref is already on origin.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- When the PR exists, change the slice heading to `(Branch: bug/the-approval-reads-why-the-host-said-nothing, PR: #N)`. This is a `### ` waves plan, so the annotation goes inside the heading, not as a trailing arrow. Make that edit on `main` from a scratch worktree.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-approve.sh`, the PR-state read at lines 230-247 only
- `test/reconcile/approve.test.mjs`
- one new `.changeset/*.md`

Do not touch `plot-host.sh`, `plot-pr-state.sh`, the other `pr-state` callers, or the `plot-approve` SKILL.md, unless the refusal wording the skill quotes changes. If it does, report that. Other in-flight work: `bug/an-insertion-point-is-not-inside-a-comment` (plan `a-record-is-written-where-it-can-be-read`) was claimed today and does not touch `plot-approve.sh`. Verify with `git log origin/main..origin/<branch> --name-only` before merging.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

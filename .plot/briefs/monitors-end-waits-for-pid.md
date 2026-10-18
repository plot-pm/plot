## Implementation brief — one-review-issue-per-pr-a (wave 3: Pid read waits)

- **Plan (canonical):** docs/plans/2026-10-17-one-review-issue-per-pr-a.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1955 merged
- **Branch:** `bug/monitors-end-waits-for-pid` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per `Review: pr` (plan config: Plan PRs required)

This is the plan's third and last wave. Waves 1 (`bug/plot-review-one-issue-per-pr`) and 2 (`bug/sprint-goal-reads-template`, → #2043) are independent of this one — nothing here waits on them, and nothing in this plan waits on this branch.

### What to build

`test/e2e/monitors-end.test.mjs` has two sites that read `run.pidFile` right after `waitForFile(run.pidFile)` returns (lines ~371 and ~411):

```js
assert.ok(waitForFile(run.pidFile), 'the wrapper never recorded the agent pid');
const agentPid = fs.readFileSync(run.pidFile, 'utf8').trim();   // line 372, string
// ...
const agentPid = Number(fs.readFileSync(run.pidFile, 'utf8').trim());  // line 411, number
```

`waitForFile` (line 102) only waits for the file to **exist**:

```js
function waitForFile(file, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!fs.existsSync(file) && Date.now() < deadline) execFileSync('sleep', ['0.2']);
  return fs.existsSync(file);
}
```

The wrapper that writes the pid file (`plot-dispatch.sh`'s `start_worker`, the `nohup sh -c '...'` body) writes it as a **plain redirect with no temp-file/rename**: `agent=$!; trap "" TERM; printf "%s" "$agent" > "$PLOT_PID_FILE"`. A reader can observe the file between its creation (by the shell redirect) and the `printf` actually landing bytes — a real, if narrow, race. `waitForFile` returning on existence alone lets a test read `''`, and `Number('')` is `0`. `alive(0)` (line 143) then polls `ps -p 0`, which this measured failure on PR #1892 (run 38950234603) shows does not fail the way an invalid pid should — the test hangs polling a pid that was never the agent's.

This fixes #1909 from the plan's Motivation section: `test/e2e/monitors-end.test.mjs` ("an agent killed at the bound is reported gone by the wrapper, not clear", ~line 404) failed this way.

### The decision the plan settles — do not re-derive it

**One helper, not two fixes.** The plan's Design section is explicit: "One helper in the test file waits until the pid file holds a positive integer and returns that integer. Every test in the file that reads `run.pidFile` ... calls it." That rules out patching each of the two call sites independently (e.g. retrying the read in place) — write one function, replace both call sites with it, and delete the now-redundant `waitForFile(run.pidFile)` + raw read pattern at each site.

**The wrapper itself is out of scope.** The plan's Open Points asked "does `plot-worker-loop.sh` write the pid file with a plain redirect today?" — it doesn't; `plot-dispatch.sh`'s wrapper body does, confirmed above, with a plain `printf ... > "$PLOT_PID_FILE"` and no atomic rename. The plan's chosen fix is a test-side wait, not a wrapper-side atomic write — do not add temp-file+rename to the wrapper as part of this slice. That would be a second, unapproved fix to the same symptom; the plan's Design section only commits to the helper.

**Returns a number, not a string.** Line 372's call site currently keeps `agentPid` as a string (used only in a regex match against `line.evidence`); line 411 converts it to `Number`. The new helper should return the parsed positive integer in both cases — it is what "holds a positive integer" in the plan's Design means, and it's what justifies looping past an empty read. Line 372's match only needs a string form, so convert back for the `RegExp` construction at that site (no change to its own behavior).

### Done when

The plan's `## Done when` list is the specification (this plan has no explicit `## Done when` section — the Design section's wording for #1909 is the spec: a helper that waits until the pid file holds a positive integer, used at both read sites).

Plus:
- Both `test/e2e/monitors-end.test.mjs` read sites (~372, ~411) go through the one new helper; no second ad hoc wait is introduced.
- The existing assertions each site makes (`alive(agentPid)`, the `RegExp` match against `line.evidence`, the `'gone'` finding assertion) still pass unmodified — this is a wait/parse fix, not a behavior change to what the test asserts.
- `node skills/plot/scripts/board/plot-local-checks.mjs` run from the repo root, and whatever it prints, run before each push. The suites in the `CI suites` config key (`pnpm run test:e2e` among them) run in CI; a failure there comes back as a correction — do not run `test:e2e` locally yourself (it dispatches real workers into sandbox repos and is CI's gate, not a local one — see CLAUDE.md's Testing section).
- No `.sh` file is touched by this slice, so `scripts/check-shell-lines.sh`'s shell-line ratchet does not apply — this is a pure test-file change in `test/e2e/`.

### Bookkeeping

- Open the PR through the controller once the branch exists and carries a commit: `skills/plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` directly.
- When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Pid read waits` heading, on main.
- Push the first real commit as soon as it exists — an empty claimed branch with no commit is indistinguishable from an abandoned one.

### Scope guard

- This branch owns `test/e2e/monitors-end.test.mjs` only. No production code changes are implied by the plan's #1909 design — the defect is in the test's own wait helper, not in `plot-dispatch.sh` or `plot-worker-loop.sh`.
- Sibling branches in this plan: `bug/plot-review-one-issue-per-pr` (owns `packages/board/src/server/entry/review.ts` and the tracker port, already started 2026-10-17) and `bug/sprint-goal-reads-template` (owns the sprint parser, delivered as PR #2043). Neither touches `test/e2e/monitors-end.test.mjs` or any file this branch owns — no collision expected.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

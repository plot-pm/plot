## Implementation brief — the-build-monitor-asks-for-the-pushed-commit

- **Plan (canonical):** `docs/plans/2026-10-05-the-build-monitor-asks-for-the-pushed-commit.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `bug/the-build-monitor-asks-for-the-pushed-commit` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Sole slice of a single-wave plan. Nothing waits on it and it waits on nothing.

### What to build

Two edits that together stop the BuildMonitor from settling a pushed commit on the previous commit's run.

The failure, measured 2026-10-05: PR #1279 went green on `2f7999714` at 09:03Z. The BuildMonitor's last finding was `head moved` at 08:41:28Z, naming the run of `cf4785cc5`, and it wrote none for `2f7999714`. The worker loop's checks wait ran to its 3600 s bound and logged "no CI answer … letting go of the slice". Two more desks hold the same `head moved` line (`infra/the-loop-has-a-workflow`, `infra/the-shell-loop-holds-unlanded-work`), and #1255 records it on PR #1269.

1. **`run-for-sha` answers only for the asked commit.** In `skills/plot/scripts/plot-host.sh`, the GitHub arm ends `'(map(select(.headSha == $sha)) | .[0]) // .[0]'` (about line 4534) and the Jenkins arm ends `((map(select(.sha == $sha)) | .[0]) // .[0])` (about line 4485). Drop the `// .[0]` from both. With no run for `<sha>` the op prints nothing and exits 0, which `monitor_run_for_sha` already reads as "no run yet".
2. **`head moved` settles nothing.** In `skills/plot/scripts/plot-build-monitor.sh`, `monitor_pass` runs `[ -n "$head" ] && settled_shas="$settled_shas $head"` after every published finding. Make that line skip `head moved`. Publish it and leave the HEAD unsettled, so the next pass asks again.

`packages/board/plot-host.sh` and `packages/board/plot-build-monitor.sh` are the same files as the `skills/plot/scripts/` ones — `diff` is empty — so there is one edit, not two.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Fix both steps, not one.** Removing the fallback alone leaves `head moved` reachable from a race: `monitor_pass` reads `monitor_head_sha` and `sample_finding` reads it again, so a push between the two reads still answers about a commit that is no longer HEAD, and the pass would settle the new HEAD. Unsettling `head moved` alone leaves the host answering with the wrong run for several seconds after every push. The cause is the pair.

**The shell loop is fixed where it runs today.** `the-worker-loop-runs-in-js` replaces this wait with `checksFromRuns` over `BuildPort.runForSha`, and its slice 6 deletes the BuildMonitor. Until slice 5 makes `js` the default, every adopting repository runs this shell. Do not defer the fix to that plan and do not port the wait to JS here.

**The domain side needs no code.** `checksFromRuns` already reads `run.sha` and treats a run for any other commit as no run (`packages/domain/test/checks-from-runs.test.ts:118`). `grep -rn 'runForSha(' packages/domain/src packages/board/src` finds no caller outside `adapters/` and `ports/` on the day of writing. The adapters (`build-shell.ts`, `build-actions.ts`, `build-jenkins.ts`) pass the script's answer through, so a null answer already becomes `null`.

**Callers of `run-for-sha`, found by grep on 2026-10-05** (this closes the plan's open question): `plot-build-monitor.sh` `monitor_run_for_sha` (line 268), the three TS adapters above, and tests. No other script asks. Re-run `grep -rIn 'run-for-sha\|runForSha' skills packages test scripts --exclude-dir=node_modules --exclude=board-server.mjs` before you start, and report a caller this brief missed.

**`head moved` stays in `sample_finding`.** After the fix the host cannot return a different sha for the asked one, so the arm is reachable only through the double HEAD read above. It is still the arm that stops a green run for superseded code from reading as `build passed`. Do not delete it, and do not move the `run_sha != head` test.

**Rules carried over unchanged.** Absent is not false: empty output with exit 0 means "no run yet", and exit 2 from `monitor_run_for_sha` means "could not ask" — keep the two apart. A `head moved` finding is published once per HEAD (`published`/`published_sha` already hold that); do not republish it each pass.

### Not measured — report, do not improvise

**Does Jenkins report the pushed commit as `lastBuiltRevision.SHA1`?** The Jenkins arm matches `.sha == $sha` where `.sha` is the build's `lastBuiltRevision`. A Jenkins job that builds a merge ref reports the merge commit there, not the pushed one. With the fallback gone, such a build is never matched and the wait runs to its bound — the same symptom this plan fixes, moved to a different backend. Nothing in the repo shows which case holds for a configured instance. If you can read a real build's payload, say what it carries. If you cannot, ship the GitHub arm and the monitor change as the plan says, keep the Jenkins edit, and name this risk in the PR body. Do not invent a second matching rule.

### Done when

The plan has no `## Done when` section; its **Tests** paragraph under Design is the specification (all in `test/reconcile/`):

- `run-for-sha` with runs for other commits only answers "no run yet", for each backend arm.
- A monitor pass whose host answers "no run yet" for HEAD publishes nothing and leaves HEAD unsettled; the next pass, whose host answers a finished run for HEAD, publishes `build passed` or `build failed`.
- A pass that sees a run for a commit other than HEAD publishes `head moved` once and leaves HEAD unsettled.
- The loop's checks wait, fed that sequence, ends on the new commit's answer and not on its bound.

The assertions that exist because a naive implementation passes without them:

- **The two-pass sequence on ONE sourced monitor**, not two fresh drives. `settled_shas` is shell state across `monitor_pass` calls; a test that restarts the monitor between passes passes with the bug in place.
- **Count the host calls on the second pass.** A fix that unsettles by clearing `published_sha` instead would still publish, but would also re-ask a settled `build passed` HEAD. `a settled sha is never asked about again` (`buildmonitor.test.mjs:229`) must stay green beside the new test.
- **A `build failed` after `head moved` on the same desk.** #1255 is exactly this: no second `build failed` after a corrected push. Pin the sequence `head moved` → `build failed` for the new HEAD.

Tests that currently assert the fallback and must change with it, each for a stated reason:

- `test/reconcile/buildmonitor.test.mjs:382` `run-for-sha falls back to the newest run, labelled with ITS sha` — inverts to "answers nothing". Its `runForSha()` helper copies the jq filter by hand; change the copy and the shipped filter together, or the test proves a filter the script no longer has. Prefer exercising the real op with a stubbed `gh`, as `host.test.mjs:1039` does.
- `test/e2e/build-monitor-follows.test.mjs:254` `a run for a superseded sha is reported as head moved` — its stub host holds only a run for another sha, which `run-for-sha` now answers with nothing. Rewrite it to assert the new behavior (no finding, HEAD unsettled), or move the `head moved` case to a unit test that redefines `monitor_run_for_sha`. `test:e2e` is CI's gate: do not run it locally.
- `packages/domain/test/build-shell.test.ts:161` `carries a sha that is NOT the one asked about` — the connector still must not flatten a sha it is handed, so keep the test, but its comment ("The script falls back to the branch's newest run") becomes false. Correct the comment.

Comments and docs that state the fallback and become false — correct them in the same change, as facts, without narrating the old behavior (CLAUDE.md, *Factual API documentation*): `plot-host.sh` usage text at line 222, the `run-for-sha)` header comments and the "WHY IT FALLS BACK" and "THE SAME FALLBACK RULE" paragraphs, the `sample_finding` comment "This fires when the host answered about a DIFFERENT sha", `packages/domain/src/ports/build.ts:85-100`, `packages/domain/src/rules/checks-verdict.ts:113-124`, and `packages/domain/src/adapters/build/build-jenkins.ts:43`. The usage text also says the op "EXITS 4 on jenkins"; the arm now answers, so correct that line too.

Plus the repo's gates. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction. `nvm use` first (Node 24). List no full suite and do not run `test:e2e`.

**The shell gate.** `scripts/check-shell-lines.sh pr` refuses a PR whose shell under `skills/` is longer than at its merge base. Both edits remove or rewrite existing lines, so growth should be zero. If a test helper or the settle condition needs an extra non-comment line, the PR removes the same number elsewhere in the same change. The gate stores no number and has no override.

A changeset is required: `'plot': patch`, the description first (state current behavior: a worker's checks wait ends when the CI run for its pushed commit finishes), the `bumps:` block last, `plan:` line inside it.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work is moving
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `run-for-sha` operation in `skills/plot/scripts/plot-host.sh` (both arms and its usage text), `monitor_pass` in `skills/plot/scripts/plot-build-monitor.sh`, the comments and tests listed above, and the changeset.

Verified at dispatch: `origin/infra/the-loop-writes-through-ports` is the only in-flight branch near this area — it moves the worker loop's writes behind ports. Check its diff against `plot-host.sh` and `plot-build-monitor.sh` before you push; a collision on the `run-for-sha` lines is a known fact to report, not to resolve silently. This branch does not touch `plot-worker-loop.sh`, `checks-verdict.ts` logic, or `BuildPort`'s shape.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

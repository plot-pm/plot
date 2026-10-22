## Implementation brief — jenkins-runs-lists-every-build-twice

- **Plan (canonical):** docs/plans/2026-10-22-jenkins-runs-lists-every-build-twice.md on main
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2331 merged
- **Branch:** `bug/jenkins-runs-lists-every-build-twice` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention; open the PR through `plot-open-pr.sh`

This is the only slice of the plan. Nothing waits on it.

### What to build

On ewz-kus-portal with `PLOT_JENKINS_JOB=kus-portal/continuous-deploy`, `plot-host.sh runs develop` printed 8 lines for 4 unique builds — found read-only during the ewz round-7 field test (main `da789acff`). A consumer that counts runs, or takes the first N, reads each build twice.

The defect lives in `headsha`, defined inline at `skills/plot/scripts/plot-host.sh:1858` and used at `:1866` and `:1868`. It is a jq generator: `[.br, .shas] | transpose[] | select(.[0] == $b) | .[1]` emits one value per matching `(branch, sha)` pair. A plain (non-multibranch) job's build carries one `lastBuiltRevision` action per branch it was *considered* for, so a build of `develop` can hold two `lastBuiltRevision` entries both naming `develop` — and `headsha` emits the sha twice, so `map(.sha = headsha($branch))` at `:1868` doubles that build's row. The defect shows only when the `Default branch job` key (#2278) or `PLOT_JENKINS_JOB` names a plain job; the sha-bound path (`:1866` when `$sha != ""`) filters by equality afterward and is not affected by the duplication itself, only by whichever match `headsha` happens to pick.

### Settled decisions and leads

**The fix is `first(...)` on the generator, applied in `headsha`'s true branch only.** `headsha($b): if (.br | length) > 0 then ([.br, .shas] | transpose[] | select(.[0] == $b) | .[1]) // (.shas | last // "") else (.shas | last // "") end` — wrap the `transpose[] | select | .[1]` pipeline in `first(...)` so it yields at most one value; the `// (.shas | last // "")` fallback is unchanged and still applies only when there is no match at all. Do not touch the `else` arm (no `.br` entries) — it already returns a single scalar.

**Open question the plan leaves unresolved — pin it with the fixture, don't just assume it:** do a plain job's two `lastBuiltRevision` entries for the same build always carry the same SHA? The plan's working assumption is yes (both name the branch the build was triggered for), and the fix is `first(...)` rather than a dedup-and-assert specifically because of that assumption. Write the regression fixture so it would catch a disagreement if one ever showed up (two entries for `develop` with *different* SHAs), even though the plan does not require handling that case specially — read the assumption, don't silently paper over a divergent answer.

**Second open question: does the sha-bound path (`$sha != ""`) need its own guard?** Read `:1866`'s `select(headsha(...) as $h | $h == $sha or ...)` — `select` only tests truthiness of the generator's first emission in this context since it's used as a binding (`as $h`), so confirm whether jq's `as` already collapses a multi-value generator to its first result, or whether it would silently re-run the `select` once per emitted value (which would show up as duplicate rows surviving the sha filter too, not just the no-sha path in the plan's Motivation). If `as $h` already behaves like `first`, say so in the PR and leave that call alone — don't change behavior the plan didn't ask you to change. If it doesn't, the same `first(...)` fix in `headsha` covers it for free since both call sites share the one definition.

**Rules carried over unchanged.** This is a one-function jq fix with no shell control flow around it — no new absent-vs-false distinction is introduced here, and none of the ancestry/index rules in CLAUDE.md apply to this slice.

### Done when

The plan's changelog is the specification: `plot-host.sh runs` lists each Jenkins build of a plain job once.

Assertions a naive implementation passes without:
- **A plain-job fixture with two `lastBuiltRevision` entries for the same build, both naming the asked branch, different `SHA1` strings from any other build in the fixture** — add it to the comparison corpus in `test/reconcile/host.test.mjs` alongside the existing plain-job cases (search `lastBuiltRevision` and `plain` in that file; e.g. the fixtures near `'host: runs on a plain Jenkins job reports only the asked branch\'s builds'`). Assert **one output line** for that build, not two. A fix that only changes `map(.sha = ...)` ordering without actually collapsing the generator would still pass a test that doesn't assert line count.
- **The multibranch path is untouched.** Run the existing multibranch fixtures in the same file unmodified — they must still pass, proving the `else` arm (`.br` empty) and the multibranch job shape are unaffected.
- **The sha-bound lookup path (`plot-host.sh run-for-sha` or equivalent `$sha != ""` call) still resolves correctly** against a plain-job fixture with duplicate branch entries, whatever the answer to the `as $h` question above turns out to be.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there returns as a correction. Run the whole `test/reconcile/*.test.mjs` glob the checks command prints, not only `host.test.mjs`. Add a changeset (description first, `bumps:` block last, package `plot`, no skill bump needed since this touches only a helper script, not a skill's own files — name `plot-host.sh`'s owning context in the description).

**Shell gate.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, with no number stored and no override. A `first(...)` wrap is a few characters inside an existing jq program, not a new line — this slice should not need to pay the gate, but check it before pushing if the fix grows the file.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `headsha` definition and its two call sites in `skills/plot/scripts/plot-host.sh` (`:1858`, `:1866`, `:1868`), the `test/reconcile/host.test.mjs` fixtures for the plain-job no-dedup case, and the changeset. It does not own the multibranch path, the `Default branch job` resolution (#2278, delivered separately), or any other `plot-host.sh` operation. No other branch of this plan is in flight — this is the plan's only slice. If you find something the plan did not anticipate (for example, the `as $h` question above resolving to "yes, it needs its own fix"), report it rather than improvising outside scope.

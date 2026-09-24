## Implementation brief — the-probe-asks-jenkins-by-its-slug

- **Plan (canonical):** `docs/plans/2026-09-24-the-probe-asks-jenkins-by-its-slug.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-probe-splits-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #968

One slice, one wave. Nothing waits on this branch, and it waits on nothing.

### What to build

`skills/plot/scripts/plot-board-probe.sh:316` runs `jen -I "$jen_instance" auth status` with the raw `Jenkins instance` value. An adopting repository (`ewz/kus-portal`) declares `ewz/kus-portal/continuous-build-multi`, which is the documented `<slug>/<job/path>` form. `jen` expects the slug alone, so the probe reports `auth: failed` for an instance that authenticates correctly. The same probe output parses `job` correctly from the same value.

The fix, in `plot-board-probe.sh` only:

1. Move the scheme-strip (`_ji`, now at `:376-381`) above the `jen_installed` block.
2. Derive the slug as `${_ji%%/*}`. `plot-host.sh:1228` uses the same expression.
3. Pass that slug to `jen -I` at `:316`.
4. Make the job split (`_jen_job_raw`) read the same hoisted `_ji`, so one computation feeds both answers.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The existing splitter computes a JOB, not a slug.** A panel caught this. `:376-394` produces `_ji` and `_jen_job_raw` and no slug, so "hoist the splitter and reuse it" moves code that does not answer the question. The slug is one new expression over the hoisted `_ji`.

**The computation stays OUTSIDE the `jen_installed` block.** The job reading is a string test on a config value, and it must answer on a machine that has the value and not the tool (comment at `:343-346`). Hoisting it above the block keeps that. Putting it inside the block makes `job` disappear when `jen` is absent, and an existing test covers that case.

**No second splitter.** The file keeps one. The four URL forms in the comment at `:356-364` were measured, and a fresh `${value%%/*}` over the raw value re-introduces the `https:` defect: `https://host/x` splits to `https:`.

**The URL form gives the host as the slug, and that is correct.** For `https://jenkins.example.com/quaweb/cb`, `_ji` is `jenkins.example.com/quaweb/cb` and the slug is `jenkins.example.com`. `plot-host.sh:1127` records that `jen -I` accepts a bare host or a URL, so the bare host is a valid `-I` argument.

**`plot-host.sh` is not touched.** The plan checked its three `jen -I` calls (`:1250`, `:1268`, `:1321`), and all three use the split slug. `plot-host.sh:1228` does not strip a scheme, so a URL-form value gives `https:` there. That is a separate latent defect, which the probe's own comment at `:369-371` already names as deliberately out of scope. Report it in the PR body and do not fix it here.

**`classify` and the `OK` match stay unchanged.** The value passed to `jen` is the defect. The reading of the answer (`:317-326`) is correct. **Do not change `auth` to `unknown`:** a real authentication failure must still report `failed`.

### Done when

The plan's `## Done when` list is the specification. Three of its assertions need a test shape that the current suite does not have:

- **The stub must discriminate on `-I`.** `jenFor` (`test/reconcile/boardprobe.test.mjs:440`) stubs `jen` to answer `OK` whatever its arguments are. That stub is why the defect passed CI: a probe that passes the full value still reads `ok`. Write a stub that prints `Jenkins auth:  OK` only when `-I` equals the expected slug and prints the failure text otherwise. Alternatively, use `countingJen` (`:423`) and assert the recorded `-I` argument. **Check that the new test fails against the current `main` code before you fix it.**
- **A slug-only value still reads `ok`.** It is the form that works today and the regression this fix can cause.
- **A job-path value reports `auth: ok`, and `job` stays `quaweb/continuous-build`.** Both fields come from one computation.
- **A URL-form value passes the bare host to `-I`, never `https:`.**
- **A real failure still reports `failed`:** the `NOT reachable` case at `:361` keeps passing.

Repo gates: `nvm use` (Node 24; pnpm crashes on 26), then `pnpm test` and `pnpm run test:contracts`. The probe test is `node --test test/reconcile/boardprobe.test.mjs`. Add a changeset: package `'plot': patch`, the description first and a `bumps:` block last, with `plan: docs/plans/2026-09-24-the-probe-asks-jenkins-by-its-slug.md` and `plot-board-setup: patch`. The plan's `## Changelog` line is the description. `./scripts/check-changeset-packages.sh` validates it. Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- When the PR exists, append `→ #<number>` inside the plan's slice heading: `(Branch: bug/the-probe-splits-once, PR: #N)`. This plan uses the heading form.
- Reference `#968` in the PR body.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-board-probe.sh`
- `test/reconcile/boardprobe.test.mjs`
- one new `.changeset/*.md`

On 2026-09-24 no other remote branch changed either file. `plot-host.sh`, `plot-config.sh` and the `/plot-board-setup` skill prose are out of scope.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

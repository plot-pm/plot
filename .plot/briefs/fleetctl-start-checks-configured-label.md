## Implementation brief — fleet-supervisor-holds-scale-slots-too (wave: Label)

- **Plan (canonical):** [docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md](../../docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2536 merged
- **Branch:** `bug/fleetctl-start-checks-configured-label` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (plot-review app required on `main`)

This branch is independent of the plan's other two waves (Liveness, Log and wording) — no file overlap, no ordering dependency. The Liveness slice (`bug/fleet-supervisor-liveness-bounds`) already has a `Started:` record; this one may run in parallel.

### What to build

`plot-fleetctl.sh --start`'s refusal 4 ("the label is taken", `plot-fleetctl.sh:1083`) checks `supervisor_loaded` against only `$LABEL` — the one label this run resolved (`PLOT_FLEET_LABEL` → `Fleet label` config key → the hardcoded default `com.plot-pm.fleetd`, resolved at `plot-fleetctl.sh:82-83`). A checkout that declares a custom `Fleet label` in its `## Plot Config` but still has a supervisor loaded under the OLD default — e.g. right after the checkout added the key but before anything unloaded the default-label unit — is invisible to that check: `--start` loads a second supervisor under the new label, and two supervisors now watch one estate's queue and scale slots concurrently.

The fix: before refusal 4 fires, also check whether the DEFAULT label (`com.plot-pm.fleetd`) is loaded, when `$LABEL` (the resolved/configured one) differs from it. If the default is loaded and serves this checkout, refuse the same way refusal 4 already refuses for `$LABEL` — naming the default label, not the configured one, so the operator knows which one to stop.

### The pattern already exists in this file — follow it, do not invent a second one

`retire_old_label` (`plot-fleetctl.sh:614-625`) is the precedent for checking a label other than the resolved `$LABEL`: it locally shadows `LABEL=com.plot-pm.registryd` in a subshell-scoped local, then calls the SAME functions (`supervisor_loaded`, `old_label_action`) that the rest of the file calls against the module-level `$LABEL`. Every `supervisor_*` function (`supervisor_loaded`, `supervisor_pid`, `supervisor_workdir`, `supervisor_checkout`) reads the global `$LABEL` rather than taking a parameter — that is why the old-label check has to shadow the variable rather than pass an argument. Do the same shape here: a local function (or a block inline before refusal 4) that shadows `LABEL=com.plot-pm.fleetd` only when the resolved `$LABEL` is NOT already that value, asks `supervisor_loaded`/`supervisor_checkout` under the shadowed value, and restores nothing afterward since it's function-local.

**Do not refuse unconditionally when the default is loaded.** The default label being loaded and serving ANOTHER checkout is not this checkout's problem — same three-way split (`this` / `another` / undetermined) that refusal 4 already prints for `$LABEL`, built on `supervisor_checkout`'s existing return shape (`"this <dir>"` / `"another <dir>"` / empty). Reuse that case statement's three arms rather than writing a second one; only the label name printed in the message differs between the two calls (`com.plot-pm.fleetd` vs the configured `$LABEL`).

**Skip the check entirely when `$LABEL` already equals the default.** `retire_old_label` has this exact guard (`[ "$LABEL" = com.plot-pm.fleetd ] || return 0`, line 1037, inverted sense) — there is nothing to additionally check when no override is in play, and running it anyway would make refusal 4 ask about the same label twice.

### Tests — extend the existing helper, do not copy it

`test/reconcile/fleetctl.test.mjs:1747` already has `startAndReadLabel(label, env)`, built for the precedence tests at lines 1760-1833 (`#2408`). The plan's own design section says: "Extend `startAndReadLabel` ... instead of copying it, and drop the neither-variable-nor-key test that duplicates an existing one." That duplicate is the test at line 1793, `'label: neither the variable nor the key falls back to the hardcoded default'` — it asserts exactly what `'label: an unset override writes the default Label, never an empty one'` (line 1765) already asserts (both run with no override and no config key, both expect `com.plot-pm.fleetd`). Delete it rather than leaving two tests pinned to one behavior.

New tests needed, in the shape of the existing sandbox-based tests in this file (`sandbox()`, `fakeHome()`, `stubPlatform()`, `run()` are all already imported/defined above — follow their existing calling convention exactly):

1. A checkout with a configured `Fleet label` key, where the DEFAULT label (`com.plot-pm.fleetd`) is loaded and serves THIS checkout (the stub platform needs to answer `launchctl print` for the default label, not the configured one) → `--start` refuses, naming `com.plot-pm.fleetd`.
2. Same setup, but the default label serves ANOTHER checkout (or is undetermined) → `--start` proceeds and loads under the configured label (today's behavior for every other case must not regress).
3. No configured `Fleet label` key (today's common case) → the new check does not run at all, confirmed by the default-label-loaded-elsewhere case still refusing correctly under existing refusal 4 semantics (no new refusal fires for the ordinary single-label path).

`stubPlatform` already supports making `launchctl print` answer per-label (see how the existing precedence tests key the plist file path off different labels) — read how `sandbox()` and `stubPlatform()` parameterize the loaded/not-loaded answer before writing a new stub shape; this slice should not need a new test double, only a new label argument through the existing one.

### Done when

The plan's `## Done when` is implicit in its Motivation section — this slice resolves exactly the third MEDIUM finding: *"`skills/plot/scripts/plot-fleetctl.sh:629`: only the resolved label is checked on `--start`. A checkout that declared `Fleet label` but still runs under the default label (after an upgrade) gets a second supervisor."* Done means:

- `--start` refuses when the default label is loaded and serves this checkout, even when a different `Fleet label` is configured and resolves cleanly.
- `--start` still proceeds exactly as before in every case that has no configured `Fleet label`, and in every case where the default label is not loaded or serves another checkout.
- `test/reconcile/fleetctl.test.mjs` extends `startAndReadLabel` for the new cases rather than duplicating it, and the superseded duplicate test at line 1793 is removed.
- No board impact — the plan's own changelog comment confirms this (`plot-fleetctl.sh` and `plot-config.sh` feed no board parser).

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related tests and gate scripts for the files you touched. The suites in `## Plot Config`'s `CI suites` key run in CI only; do not run them locally (`test:e2e` in particular dispatches real workers and is CI's job, not a local one).

Name the shell gate explicitly: `scripts/check-shell-lines.sh` refuses a PR whose non-comment, non-blank line count under `skills/` grows past its merge base. This slice adds a function (or inline block) to `plot-fleetctl.sh`, which is under `skills/` and counted; `test/reconcile/fleetctl.test.mjs` is NOT under `skills/` and is not counted. If the new shell lines in `plot-fleetctl.sh` push the count up, remove an equal number of comment-adjacent lines elsewhere in the same file in the same change, or push the rule into a `node -e` heredoc read through a bundle — the gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create` — it takes the title from the last commit subject rather than the plan's wave heading, and the plan requires this. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### Label` heading.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh` (the label-check region only — refusal 4 and the function(s) immediately around it) and `test/reconcile/fleetctl.test.mjs` (the `startAndReadLabel` helper and its callers). It does not touch `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/shared/queue-reading.ts`, `default-branch-refresh.ts`, `plot-config.sh`'s header, `com.plot-pm.fleetd.plist`, or `skills/plot-fleet/SKILL.md` — those belong to the plan's other two waves (`bug/fleet-supervisor-liveness-bounds`, already Started; `bug/fleet-review-followups-wording`, not yet claimed). A collision is unlikely since no file is shared across waves, but if you find a reason to touch one of those files, report it rather than expanding scope here.

If you find something the plan did not anticipate — e.g. `supervisor_checkout`'s three-way split not covering a case this slice needs — report it rather than improvising a new return shape outside what `retire_old_label` already established.

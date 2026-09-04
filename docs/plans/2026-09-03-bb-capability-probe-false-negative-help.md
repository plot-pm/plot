# bb capability probe reads help prose as a rejection

> `bb_test_json_support` consults a text heuristic before the exit code, so bb 1.9.0's own sentence documenting that `--json` is cheap — "a bare `--json`, costs nothing extra" — matches `--json.*not` and rejects a bb that works. Every Plot command that reads a PR then goes blind on Bitbucket.

## Status

- **Phase:** Approved
- **Type:** feature
- **Issue:** #668
- **Review:** in-session
- **Rounds:** 1
- **Approved:** 2026-09-04, Jan Wloka, in-session
- **Impl:** same branch

## Changelog

- Plot reads PRs on any `bb` whose help text mentions `--json` in prose. The capability probe now trusts the exit code of the help call and matches only what a CLI actually prints when it rejects a flag, so a newer `bb` is no longer refused for documenting the flag it supports.
- A refused `bb` is named by what was tested, not by provenance the probe cannot determine — the remedy no longer tells a working install to reinstall itself.

Board impact: indirect but real, and it is the reason this is worth doing. The board's PR timer and `plot-fleet-scan.sh` both read the host through `plot-host.sh`; on a Bitbucket repo the probe's `exit 3` makes the scan report `host` unreachable, so every PR-derived state on the board becomes unknown. No plan-format, template, or `docs/plans` layout change — no rebuild needed.

## Motivation

**A probe that punishes better documentation.** `skills/plot/scripts/plot-host.sh:1020` decides whether the `bb` on PATH understands `--json`:

```bash
out="$(bb pr list --help --json 2>&1)"; rc=$?

# craftamap 0.6.0 rejects --json with `Error: unknown flag: --json`
if grep -qiE 'unknown flag.*--json|invalid.*--json|--json.*not' <<<"$out"; then
  return 1
fi

# If help succeeded (even partially), assume --json is supported
if [ "$rc" = 0 ]; then
  return 0
fi
```

Line 33 of `bb pr list --help` on bb 1.9.0 reads:

```
other fields, or a bare --json, costs nothing extra.
```

`--json.*not` matches `--json, costs no`**`t`**`hing`. Verified 2026-09-03:

```console
$ printf 'other fields, or a bare --json, costs nothing extra.\n' | grep -qiE -- '--json.*not' && echo "read as rejection"
read as rejection
```

**The measurement is taken and then discarded.** The help call exits 0 — which proves the flag parsed, because a CLI that rejects a flag does not exit 0 — and prints valid help. Both facts are available at line 1017. The regex is consulted first, and its `return 1` wins before line 1025 ever asks `rc`.

Two oracles answer one question here, and the weaker one is asked first. `rc = 0` is a **measurement**; `grep` over prose is a **guess**. This repo settles that ordering elsewhere in the same voice — `plot-reap.sh` "refuses on five MEASUREMENTS, never a judgement", `plot-pr-merged.sh` reads `mergedAt` and never `state`. The probe inverts it.

**`.*not` is unanchored**, so any prose containing "not", "note", "nothing" or "notably" anywhere after the flag name trips it. The bug therefore **scales with documentation quality**: bb 1.0.0 lacks that sentence and passes; bb 1.9.0 explains that `--json` is cheap and fails. A dependency that improves its help text breaks Plot.

### What the operator sees

The probe's failure is fatal and cached (`plot-host.sh:1058`):

```
plot-host: bb on PATH (unknown/1.9.0) does not support --json for PR commands
  — install Quatico's bb or ensure it is first on PATH
```

`/plot-fleet` then reports:

> Fleet scan blind: the git host could not be reached, so no PR could be read. […] This is not a rate limit — waiting will not clear it; check the host and auth.

**Every sentence of that is false.** The host is reachable, `bb` is authenticated, and `--json` works:

```console
$ bb pr list --help --json >/dev/null 2>&1; echo $?
0
$ PLOT_BB_SKIP_CAP_CHECK=1 plot-host.sh pr-list
{"number":58,"title":"…","state":"OPEN","head":"…"}
```

With the check skipped, `plot-fleet-scan.sh` completes: `host=ok main=develop`. So the blindness is entirely the probe's, and the message sends the reader to check the two things that are fine.

### The remedy text sends people backwards

*"install Quatico's bb or ensure it is first on PATH"* — on the reporting machine `bb` **is** Quatico's: `~/.local/bin/bb` wraps the newest `working-with-bitbucket-api` plugin script. It is **newer** than the version the probe accepts, so the advice asks the operator to downgrade a working install.

The identity is a guess too. `bb_identify` (`plot-host.sh:978`) reports `unknown/1.9.0` because it looks for a sha in parentheses (craftamap) or the literal strings `quatico`/`plugin`, and Quatico's bb prints only `bb 1.9.0`. Provenance is not observable from `--version` output, so the probe should not claim it in a diagnostic — and should not prescribe a fix that depends on it.

### The test suite could not catch this

`test/reconcile/host.test.mjs:26` documents the fixture that was bent to fit:

> The bb stub now also handles the capability check: it responds to `--version` with a Quatico-style version (no sha), and accepts `--help --json` without error. This is because the adapter now checks bb's `--json` capability before any PR call, and the old stub shape failed that check silently.

The stub emits no help prose, so it passes. The suite proves the **stub** satisfies the gate, never that a real `bb` does. A fixture shaped to a buggy gate is how a false negative survives a green suite.

## Design

### Approach

**Ask the measurement first, and only then the guess.** Reorder so the exit code decides, and narrow the text patterns to what a CLI actually prints when it rejects a flag:

```bash
out="$(bb pr list --help --json 2>&1)"; rc=$?

# A help call that exits 0 proves the flag parsed — no CLI accepts an
# unknown flag and exits 0. This is a measurement; the grep below is a
# heuristic, so it is asked second and only when the measurement is absent.
[ "$rc" = 0 ] && return 0

grep -qiE 'unknown flag: --json|unknown option .?--json|flag provided but not defined: -?-json' <<<"$out" && return 1
```

Verified 2026-09-03 that this keeps the true negative rejected:

```console
$ printf 'Error: unknown flag: --json\n' | grep -qiE 'unknown flag: --json|unknown option .?--json|flag provided but not defined: -?-json' && echo "correctly rejected"
correctly rejected
```

craftamap 0.6.0 exits **non-zero** on `--json`, so it never reaches the early return, and its exact message still matches. The patterns are anchored to the flag name with no `.*` bridge, so prose can no longer reach them.

**An unrecognised non-zero failure now ACCEPTS, and that is a behaviour change beyond the ordering.** A non-zero exit with `not a bitbucket repo` was already a repo fact rather than a capability one and stays `return 0`. The arm that changes is the one below it: a help call that fails with wording matching no known rejection is more likely an environment problem than a missing flag, so refusing on it is the same mistake this plan is fixing, one arm along. The three patterns cover Cobra, getopt and Go's `flag`; a CLI outside them that genuinely lacks `--json` now reaches the first real call and fails there — with **bb's own error**, which is more accurate than any guess this probe could make.

**The cost is stated rather than hidden:** a genuinely incapable `bb` with unfamiliar wording gets through the gate and produces a downstream error instead of one clear message. That is the direction the probe should fail, because the alternative is refusing a `bb` that works — which is what #668 is.

**Say what was tested, not who shipped it.** The diagnostic names three observations and nothing else — the command run, its exit code, and the line that matched:

```
bb pr list --help --json exited 1
matched: unknown flag: --json

This bb does not support --json for PR commands.
```

An operator can paste the first line and reproduce it. The provenance claim and the install advice that rests on it both go. `bb_identify`'s `quatico`/`craftamap`/`unknown` verdict is unreliable by construction, and a message that guesses wrong costs the reader more than one that says less. Whether `bb_identify` should keep guessing at all is an open question below, not part of this fix.

**Test it as a false negative, not as a stub that passes.** `makeStubs` in `test/reconcile/host.test.mjs` already takes canned per-CLI output, so both cases are expressible offline and neither needs Bitbucket credentials:

- a bb stub whose `--help --json` **exits 0 and prints the poisonous sentence** — must be accepted (this is the regression lock; it fails today)
- a bb stub that **exits 1 with `Error: unknown flag: --json`** — must still be refused (this is what the narrowing must not break)

**A third test pins the rule rather than the sentence.** The two above lock this bb version's wording, and the next false negative will be different prose from a different release — bb 1.0.0 lacks the poisonous sentence and passes, bb 1.9.0 has it and fails, so the bug tracks documentation rather than capability. So:

- a bb stub that **exits 0 and prints arbitrary prose containing "not", "note", "nothing"** — must be accepted

**The reported sentence is the record; the arbitrary prose is the rule.** Keeping both is deliberate: a reader looking for #668 finds the exact string that caused it, and the general case is the one still meaningful after bb rewrites its help again.

The first test is the one that matters for the fix: it reproduces the reported failure in the harness that missed it. Writing it before the fix is what proves the fix is the reason it passes.

**Nothing here runs against a real `bb`.** This estate reports `backend github`, so no test in this repo can reproduce the bug against a live CLI; every case is a stub, and the plan claims no more than that.

### Manifesto check

The change replaces a heuristic with a fact the system already had, in the one place that talks to the host CLI (`plot-host.sh` is that place by design), adds no config, no state, and no new concept. It makes an existing script tell the truth. The diagnostic loses a claim it could not support — less asserted, not more.

### Open Questions

- [ ] Should `bb_identify` keep reporting provenance at all? It is unobservable from `bb --version` for Quatico's bb, so `unknown/` is its normal answer for a supported install. Options: keep it as a version-only report, or drop the provenance verdict. Out of scope for the fix; the diagnostic stops *depending* on it either way.
- [ ] Does `PLOT_BB_SKIP_CAP_CHECK` still earn its keep once the probe is correct? It is the documented workaround for exactly this bug. Keeping it costs nothing and is a genuine escape hatch for the next false negative; removing it narrows the surface. Recommend keeping.
- [x] **Is a probe warranted at all? Yes, and its cost goes in the code.** The probe turns a confusing downstream failure into one clear message, which is real value on a Bitbucket estate. It stays — and the sentence that argues against it goes in a comment above it, so the next person weighing this has the argument rather than rediscovering it: **a gate in front of a working call can only ever be wrong in the direction of refusing it.** That is why the unrecognised-wording arm now accepts.

## Branches

### Probe

- `bug/bb-capability-probe-false-negative-help` — Reorder `bb_test_json_support` so `rc = 0` returns early, narrow the rejection patterns to anchored flag-rejection forms, and drop the provenance claim and install advice from the `die3` diagnostic. Add both regression tests to `test/reconcile/host.test.mjs` — the false-negative lock first, then the true-negative guard. `Review: in-session` + `Impl: same branch`, so the plan and the fix ride this branch and one PR carries both.

## Notes

**Round 1, 2026-09-04, in-session.** Four challenges; three changed the plan and one settled an open question.

The change worth naming is the **unrecognised non-zero arm, which now accepts rather than refuses.** The plan originally kept it as `return 1`, describing it as unchanged. That is the same shape as the bug: a guess refusing a CLI that may work. A help call failing with wording outside the three known rejection formats is more likely an environment problem, and letting it through means the first real call fails with **bb's own error** — more accurate than anything this probe can say.

The probe itself stays, and the sentence arguing against it goes in a comment above it rather than being lost with the open question.

**No test here runs against a real `bb`.** This estate reports `backend github`, so the bug is unreproducible in this repo outside a stub — which is why the third test pins the ordering rule rather than one release's prose.


**Created from tracker issue #668 by `/plot-idea`, unattended.** The plan stops at Draft: whether this is worth doing is the reader's decision, and nothing past Draft was created. Nothing was written to the tracker — the `Issue:` field above is the only link, and it points one way.

**Every claim in the issue was verified against the source before this plan was written** (2026-09-03, worktree at `cd9457f6f`):

- `plot-host.sh:1013-1039` — `bb_test_json_support` is byte-for-byte as reported; the regex precedes the `rc = 0` test. The issue cites line 823 against Plot 2.12.0; the function now sits at 1013 because the file has grown. Same code, different line.
- `grep -qiE -- '--json.*not'` matches the bb 1.9.0 help sentence — reproduced.
- The proposed narrowed patterns still match craftamap's `Error: unknown flag: --json` — reproduced.
- `bb_identify:978-1001` — reports `unknown/<version>` for a `bb --version` output lacking both a parenthesised sha and the strings `quatico`/`plugin`, exactly as reported.
- `test/reconcile/host.test.mjs:26` — the stub comment confirms the fixture was adjusted to satisfy this gate.

**Ceremony recommendation and why.** `in-session` + `same branch` is the lightest allowed path, and the signals support it: one function in one file, a root cause verified rather than suspected, a fix whose true-negative behaviour is already checked, and an existing offline harness for the regression tests. Needing more ceremony is what would require a reason. Two questions went unasked because the run was unattended — see below; a reader who wants a plan PR instead should say so before approving.

**Unattended questions (`PLOT_UNATTENDED=1`):**

- `PLOT-UNASKED: Is this intentionally separate from existing plans? — default — proceeded; no overlap found. All four open plans (2 Draft, 2 Approved) are board/agent-lifecycle work and share no significant word with a Bitbucket capability probe; no plan in the estate mentions bb_test_json_support, PLOT_BB_SKIP_CAP_CHECK or bb_identify.`
- `PLOT-UNASKED: What Type is this plan? — answered in the invocation (feature) — used verbatim, not inferred. Read as a defect report, the content argues for bug; the caller's declaration stands, and a reader who wants it changed should change it before approving.`

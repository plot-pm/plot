## Implementation brief — bb-capability-probe-false-negative-help

- **Plan (canonical):** `docs/plans/2026-09-03-bb-capability-probe-false-negative-help.md` on `main`
- **Approved:** 2026-09-04, Jan Wloka, in-session
- **Branch:** `bug/bb-capability-probe-false-negative-help` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session
- **Issue:** #668

One slice. The plan carries the full argument and one round of interrogation — read it, not just this.

### The bug, reproduced

`bb_test_json_support` (`plot-host.sh:1013-1039`) consults a text heuristic **before** the exit code. bb 1.9.0's own help says *"a bare `--json`, costs nothing extra"*, and `--json.*not` matches `--json, costs no`**`t`**`hing`:

```console
$ printf 'other fields, or a bare --json, costs nothing extra.\n' | grep -qiE -- '--json.*not' && echo "read as rejection"
read as rejection
```

**The bug scales with documentation quality.** bb 1.0.0 lacks that sentence and passes; bb 1.9.0 explains the flag and fails.

### What this branch owns

**Ask the measurement first.** `rc = 0` proves the flag parsed — no CLI accepts an unknown flag and exits 0. Return early on it, and consult the text only when the measurement is absent.

**Narrow the patterns to what a CLI actually prints**, anchored to the flag with no `.*` bridge: `unknown flag: --json`, `unknown option .?--json`, `flag provided but not defined: -?-json`. craftamap 0.6.0 exits non-zero and still matches.

**An unrecognised non-zero failure now ACCEPTS.** This is the change round 1 added and it goes beyond reordering: a help call failing with wording outside those three is more likely an environment problem than a missing flag, and refusing on it is the same mistake one arm along. The first real call then fails with **bb's own error**, which beats any guess this probe can make. The cost is stated in the plan — an incapable `bb` with unfamiliar wording produces a downstream error instead of one clear message, and that is the direction to fail.

**Say what was tested, not who shipped it.** The diagnostic names the command, its exit code, and the matched line. The provenance verdict and the install advice resting on it both go.

**The probe stays, and the argument against it goes in a comment above it:** *a gate in front of a working call can only ever be wrong in the direction of refusing it.*

### Three tests, and the third is the one that lasts

- a bb stub exiting **0** printing the poisonous sentence → accepted (**the regression lock; fails today**)
- a bb stub exiting **1** with `Error: unknown flag: --json` → still refused
- a bb stub exiting **0** printing arbitrary prose containing "not", "note", "nothing" → accepted

`makeStubs` in `test/reconcile/host.test.mjs` already takes canned per-CLI output, so none needs Bitbucket credentials. **This estate reports `backend github`** — nothing here runs against a real `bb`, and the plan claims no more than that.

### What it does NOT own

**`bb_identify`.** Whether it should report provenance at all is an open question in the plan; the diagnostic simply stops depending on it.

**`PLOT_BB_SKIP_CAP_CHECK`.** Recommended kept as a genuine escape hatch.

### Done when

- The three tests above pass, and the first is verified to fail without the fix.
- The diagnostic names command, exit code and matched line — nothing about provenance.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus`.
- `pnpm build:board` run and the artifact committed — `plot-host.sh` is vendored into the bundle.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.

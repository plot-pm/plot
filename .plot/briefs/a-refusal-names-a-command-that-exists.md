## Implementation brief — a-plugin-install-finds-its-own-scripts (wave 2: A refusal names a command that exists)

- **Plan (canonical):** `docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md` on `main`
- **Approved:** 2026-09-25, Jan Wloka, in-session after two panel rounds
- **Branch:** `bug/a-refusal-names-a-command-that-exists` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review)
- **Issue:** #980

This is wave 2. It waits on wave 1 (`bug/the-installer-writes-a-path-that-runs`) by the plan's wave order, not by code: wave 1 touches `plot-install-hooks.sh` and its test only, and this branch touches neither.

### What to build

`plot-controller-gate.sh:232` prints the gate's named escape as a repo-relative path:

```
bash skills/plot/scripts/plot-state-receipt.sh --unowned-action <action> <slug> "<reason>"
```

On a plugin install, `skills/plot/scripts/` does not exist in the adopting repository, so the escape command fails. The gate itself runs from the plugin cache. Measured 2026-09-25 in the session that wrote this brief: the hook ran from `~/.claude/plugins/cache/plot-marketplace/plot/2.20.0/skills/plot/scripts/plot-controller-gate.sh` and printed `bash skills/plot/scripts/plot-state-receipt.sh …`. That command works only because this repository vendors the same path.

Build the escape line from `HERE`, which the gate already computes at `:187` and already uses at `:203` to source the same receipt script. The printed command then names the receipt script that sits beside the gate that is refusing, on every install. The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**`HERE`, not `$script_dir`.** The plan names this explicitly: `$script_dir` does not exist in this file. Do not add a second variable for the same directory.

**No install detection.** Wave 1's Design refutes plugin-vs-vendored detection, because the signal is absent and a wrong guess fails in the unsafe direction. This site needs none: `HERE` is correct on both installs, because the gate and the receipt script ship side by side.

**Print the path absolute and quoted.** `HERE` is absolute, and the plugin cache is outside the repository, so a repo-relative form cannot exist for a plugin install. The receipt script finds the repository from the working directory (`git rev-parse --show-toplevel`, `plot-state-receipt.sh:68,84,159,254,298`), so an absolute invocation from the repository root writes to the correct `.plot/state/`. Quote the path in the printed line, because a copied command with an unquoted path containing a space splits into two words.

**Only `:232` changes.** The comment at `:143` names `bash skills/plot/scripts/plot-dispatch.sh x` as an example of an invocation spelling. It is documentation of what the gate matches, not a command it prints; leave it.

**Carried-over rules:** the gate's decision is unchanged, and only the text of the refusal changes (plan, *What this does NOT do*). The refusal still names the endpoint, the escape, and the counted reason. The existing test at `controller-gate.test.mjs:70-74` matches `--unowned-action dispatch` and `unowned-action-writes\.tsv`, and it must stay green without edits.

### Done when

The plan's `## Done when` bullet for this slice: *"`plot-controller-gate.sh`'s refusal names a path that exists on the machine printing it"*, with a test per site. Assertions that exist because a naive implementation passes without them:

- **Run the gate from a copy whose layout differs from the caller's.** Copy `plot-controller-gate.sh` and `plot-state-receipt.sh` into a temporary directory that is NOT `<repo>/skills/plot/scripts/` (for example `<tmp>/plugin cache/plot/9.9.9/scripts/`), and fire it from a `repo()` fixture that has no `skills/` directory. The existing tests run the gate from this checkout, where the old repo-relative text also resolves, so none of them can catch the defect.
- **Extract the printed path and assert that it exists.** Assert on the file, not on a substring of the text. A test that only matches `plot-state-receipt.sh` in stderr passes on today's code.
- **Put a space in the fixture directory name, and run the printed command.** Take the escape line from stderr, replace `<slug>` and `"<reason>"` with real values, run it through `bash -c` from the fixture repository, and assert exit 0 and a new line in `.plot/state/unowned-action-writes.tsv`. This catches a missing quote, which an existence check on the extracted path does not.
- **The vendored arm is unchanged:** every existing test in `test/reconcile/controller-gate.test.mjs` passes untouched.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`. Not `test:e2e`, which is CI's gate. A changeset (`'plot': patch`, description first, `bumps:` block last) with `plan: docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md`. `.changeset/fleet-control-resolves-beside-itself.md` on `main` is the same defect class and a good model for the wording.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`).
- Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-controller-gate.sh` (the refusal text at `:232`), `test/reconcile/controller-gate.test.mjs`, and its changeset.

It does not touch:

- `plot-install-hooks.sh` or `test/reconcile/install-hooks.test.mjs` (wave 1, `bug/the-installer-writes-a-path-that-runs`, claimed 2026-09-25).
- `plot-state-gate.sh:138,143,144`, which carry the same repo-relative path in their own refusal texts. The plan defers them to a separate sweep by name.
- `plot-fleetctl.sh` (fixed by #986) and `hooks/hooks.json` (already correct).
- The gate's token matcher (`:141-160`). Observed 2026-09-25: a read-only `grep -n briefs skills/plot/scripts/plot-dispatch.sh` was refused as a dispatch, because the basename stands alone as a token. That is a separate defect with its own fix; report it in the PR body if it affects you, and do not fix it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

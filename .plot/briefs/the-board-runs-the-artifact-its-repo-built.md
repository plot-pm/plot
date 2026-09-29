## Implementation brief — the-board-runs-the-artifact-its-repo-built

- **Plan (canonical):** `docs/plans/2026-09-29-the-board-runs-the-artifact-its-repo-built.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session (panel round 1: amend, executed)
- **Issue:** #1055
- **Branch:** `bug/the-board-runs-the-artifact-its-repo-built` (base: `main`) — claimed 2026-09-29 by ref push
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review; CI is the authority for `test:e2e`

Single-slice plan: nothing waits on this branch and it waits on nothing. Its sibling `bug/the-board-port-is-configured-not-typed` is independent by the plan's own statement, but it touches the same files (see Scope guard).

### What to build

`plot-board-probe.sh:189-269` resolves the board artifact `plugin → npm → checkout`, so a repository that builds `board-server.mjs` runs the installed plugin's copy whenever a plugin exists. Measured 2026-09-29 with a fixture: the same repository answers `checkout` with `PLOT_PLUGIN_ROOT=/nonexistent` and `plugin` with the real plugin root. The two files are byte-identical today (`c0bff96a…`), so the defect is a latent shadowing: nothing keeps them in sync, and the day they differ `pnpm build:board` writes a file the board never reads.

Add a `Board artifact` key to `## Plot Config`. When the key is declared, the probe answers that file with `artifact_source: checkout` **before** the plugin search. When the key is absent, today's order stays exactly as it is. Declare the key in this repository's own `CLAUDE.md` `## Plot Config`, because Plot dog-foods its config. `plot-boardctl.sh:351` already obeys `artifact_source`, so no caller changes.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The test is the config key (candidate 1).** Two alternatives were measured and rejected:

- **"`packages/board/package.json` names `@plot-pm/board`" is false as a marker.** The plugin ships `packages/` (`~/.claude/plugins/marketplaces/plot-marketplace/packages/board/package.json` exists), a fork or vendoring repo carries it for free, and every dispatch desk is a full worktree that satisfies it. Five trees on this machine carry the marker, and their artifacts already disagree (`23eb76a3` in a scratch desk against `c0bff96a` in the checkout). Do not add it as a fallback or as a second signal.
- **"Newest mtime wins" is rejected.** A stale build after `git pull` wins silently.

**A relative key value resolves against the MAIN checkout, not against `--show-toplevel`.** The plan does not say this in one sentence, but its third `Done when` item requires it: *"a dispatch desk resolves the same artifact as the main checkout"*. The probe's `git_root` (`:109`) is `git rev-parse --show-toplevel`, which in a desk is the desk. A value resolved against it gives every desk its own copy, which is the disagreement the plan exists to end. Resolve against the parent of `git rev-parse --path-format=absolute --git-common-dir` instead. `board/plot-pr-index-lookup.mjs` made the same choice for the same reason (*"`--show-toplevel` resolves a DESK, and `plot-reap.sh` removes those"*). An absolute value is taken as given, the way `Worktree root` and `Agent registry` treat theirs.

**A declared key whose file is missing: the plan leaves this open, so say what you chose in the PR.** The reading most consistent with the rule (*"a repository that builds the artifact runs the one it built"*) is that a declared-but-missing file must not fall back silently to the plugin, because that fallback is the quiet wrong answer the plan removes. The plan also requires `artifact_source: none` to keep refusing unchanged. If you pick a different behaviour, name it in the PR body and do not decide it silently.

**Rules carried over from related work:**

- Read the key through `plot-config.sh get "Board artifact" ""`, the way `:127`, `:128` and `:176` read theirs. Do not grep `CLAUDE.md` a second way.
- Absent is not false: an empty value means "not declared" and keeps today's order.
- Add `Board artifact` to `plot-config.sh`'s known-keys header, beside `Agent registry`, with the same shape of entry: what reads it, the default, and what absent means.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **The declared-key test also has a plugin artifact available** (`fakePlugin()` in `test/reconcile/boardprobe.test.mjs`). Without it, the old fallback answers `checkout` and the test passes for the wrong reason.
- **The no-key test keeps asserting `plugin`** over a checkout artifact. The existing `probe: prefers the plugin artifact over a checkout one` (`boardprobe.test.mjs:195`) must stay green unchanged. That is the adopting project's case.
- **The desk test runs in a real `git worktree add` desk** and asserts the desk's `artifact` path is equal to the main checkout's path, with different bytes in the desk's own copy. A test that only compares `artifact_source` passes under the `--show-toplevel` reading and proves nothing.
- `artifact_source: none` still refuses (`boardprobe.test.mjs:187` stays green).
- **Update the exception text in `scripts/check-bundle-resolution.sh:30-37`.** It says the checkout path *"is reached only after both are absent"*, which stops being true. Keep the literal `$git_root/skills/plot/scripts/board/board-server.mjs` in the probe, or update `test/reconcile/bundle-resolution-gate.test.mjs:104-106` in the same commit: that test asserts the literal exists, and it fails with *"the exemption names a line that no longer exists"*.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, and `node --test test/reconcile/boardprobe.test.mjs test/reconcile/boardctl.test.mjs test/reconcile/bundle-resolution-gate.test.mjs`. No board source changes, so `pnpm build:board` is not needed. Do **not** run `test:e2e` locally. Add a changeset with `'plot': patch` and a `bumps:` block naming `plot: patch` and `plot-board-setup` only if its SKILL.md changes. Put the description first and `plan: docs/plans/2026-09-29-the-board-runs-the-artifact-its-repo-built.md` in the comment block. Update the `plot-board-probe.sh` and `plot-config.sh` rows in `CLAUDE.md` if their described behaviour changes.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section. The heading form is `(Branch: bug/the-board-runs-the-artifact-its-repo-built, PR: #N)`.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-board-probe.sh` (artifact block, `:189-269`, and its header `:36`)
- `skills/plot/scripts/plot-config.sh` (the known-keys header only)
- `scripts/check-bundle-resolution.sh` (exception text only)
- `test/reconcile/boardprobe.test.mjs`, `test/reconcile/bundle-resolution-gate.test.mjs`
- `CLAUDE.md` (one `## Plot Config` line and the two helper-table rows)
- one `.changeset/*.md`

Branches in flight, verified 2026-09-29 at dispatch:

- `bug/the-board-port-is-configured-not-typed` — claimed, no diff yet. Its plan names `Board port`, `CLAUDE.md`, `plot-boardctl.sh` and `plot-config.sh`. **Expect a small conflict in `CLAUDE.md`'s `## Plot Config` and `plot-config.sh`'s known-keys header.** Rebase and keep both keys.
- `bug/a-supervisor-says-which-checkout-it-serves`, `bug/a-label-override-reaches-the-unit` — `plot-fleetctl.sh`, units, `fleetctl.test.mjs`. No overlap.
- `bug/a-row-is-owned-by-more-than-its-pr`, `bug/a-sprint-item-names-a-plan-or-says-it-has-none` — domain and board artifacts. No overlap.

`plot-boardctl.sh` is out of scope: its `case` on `artifact_source` is already right, and `--dry-run` already names the artifact (`:357-359`). The plan also excludes a stale-build warning, a reorder for adopting projects, and restarting a running board. *A running board versus the probe* (`cache/2.21.0`) is a separate question and not this plan's.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

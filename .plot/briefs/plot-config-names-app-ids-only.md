## Implementation brief — app-keys-resolve-from-one-folder (wave 3: Config)

- **Plan (canonical):** docs/plans/2026-11-06-app-keys-resolve-from-one-folder.md on main
- **Approved:** 2026-11-06, Jan Wloka, plan-PR #3202 merged
- **Branch:** `infra/plot-config-names-app-ids-only` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (`plot/review` from the Review app, then merge)

This wave waited on `feature/app-keys-resolve-from-one-folder` (#3203, merged 2026-11-06) and on the Probe wave (#3205, merged 2026-11-08). Nothing waits on it.

### What to build

Two lines in `## Plot Config` of `CLAUDE.md` name a per-machine path: `Review app: 5317669 /Users/jwloka/.plot/plot-review.2026-11-06.private-key.pem` and `Merger app: 5599192 /Users/jwloka/.plot/plot-merger.2026-11-06.private-key.pem` (`CLAUDE.md:109-110`). The path is true on one machine only. `Writer app: 5656981` (`CLAUDE.md:111`) already names the id alone.

The change:

1. Edit `CLAUDE.md` so the two lines read `- **Review app:** 5317669` and `- **Merger app:** 5599192`.
2. Edit the HTML comment under the config block (`CLAUDE.md:115-122`). It says `— \`<app id> <key path>\`, the key outside the repo.` Change it to say the line holds the App id and that the key resolves from `${XDG_CONFIG_HOME:-~/.config}/plot/plot-<role>.<app-id>.private-key.pem` or from `PLOT_<ROLE>_APP_KEY`. Keep the rest of the comment.
3. Run `./scripts/check-agents-md.sh --write` to regenerate `AGENTS.md`. Never edit `AGENTS.md` by hand; CI refuses a mirror that differs.

After this change the resolver (`resolveApp` and `appKeyPath` in `skills/plot/scripts/plot-github-app.mjs`, on main since e501a2892) takes step 3 of its lookup for both lines: the fixed folder name.

### Settled decisions — do not re-derive them

- **The key files must exist before this PR merges.** Measured 2026-11-08 on the operator's machine: `~/.config/plot/` holds `plot-merger.2026-11-03.private-key.pem`, `plot-review.5317669.pre-2026-11-06.private-key.pem` and `plot-writer.5656981.private-key.pem`. It holds neither `plot-merger.5599192.private-key.pem` nor `plot-review.5317669.private-key.pem`. The 2026-11-06 keys still sit in `~/.plot/`. A merge now makes every merge through the merger app refuse `host-refused` and the review write refuse. That is the 2026-11-06 outage: #3199 waited about 30 minutes. The plan's Notes list the operator steps: move both keys to the id-named files with mode 600, remove the temporary symlink `plot-merger.2026-11-06.private-key.pem`, and remove `plot-merger.2026-11-03.private-key.pem` once the new key works. **An agent does not do these steps and does not merge this PR.** Open the PR, say in its body that the merge waits on those steps, and stop.
- **Do not keep the path as a fallback in the config.** A line that still names a path keeps working by design (resolver step 2), so a line left unedited would pass every test while the config keeps the per-machine path. The deliverable is the config line, not the resolver.
- **Do not touch the resolver, `plot-review-writer.mjs` or the probe.** The Resolver and Probe waves own them and both merged.
- **No new key location.** `~/.plot/` holds the state home (budget ledger, memo directories, slots); a private key does not belong there. `~/.config/plot/` is the folder `docs/review-status-rollout.md` already names.

Carried over unchanged from related work: an absent key line is not an empty one (`resolveApp` reports `absent: true` only where `plot-config.sh` exited 0 and printed nothing); read the exit code, not the emptiness.

### Done when

The plan's Config slice is the specification: `CLAUDE.md` `Review app` and `Merger app` lines name only the App id; `AGENTS.md` is regenerated. Assertions a naive change would pass without:

- `git grep -n 'private-key' -- CLAUDE.md AGENTS.md` prints nothing outside the comment that names the folder pattern. It catches a line edited in `CLAUDE.md` but not mirrored.
- `./scripts/check-agents-md.sh` exits 0 (no `--write`). It catches a hand-edited mirror.
- `bash skills/plot/scripts/plot-config.sh get 'Review app'` prints `5317669` and `... get 'Merger app'` prints `5599192`. It catches a line that still carries a trailing path.
- With the key files in place (operator step, or a scratch `XDG_CONFIG_HOME` holding both files with those names), `node skills/plot/scripts/plot-merger-token.mjs` resolves the key. Skip this check where no key exists; report that you skipped it.

Plus: no changeset is needed unless a gate asks for one (the change touches config text, not a skill or the board). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `CLAUDE.md` (the two config lines and the comment under the block) and the regenerated `AGENTS.md`. It owns nothing else. The other two branches of the plan are merged, so no collision is expected. Verify with `git log origin/main --oneline -5 -- CLAUDE.md` before the push: another change to `CLAUDE.md` in flight makes the `AGENTS.md` regeneration conflict, and the fix is to re-run `--write`, not to merge by hand.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

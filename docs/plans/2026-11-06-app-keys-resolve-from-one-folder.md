# App keys resolve from one per-user folder

> The `Review app`, `Merger app` and `Writer app` lines in `## Plot Config` name only an App id, and every script finds that App's private key in `~/.config/plot/` under a fixed name, so the checked-in config holds no per-machine path.

## Status

- **State:** Approved
- **Type:** infra
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-06, Jan Wloka, plan-PR #3202 merged
- **Started:** 2026-11-06, Jan Wloka, `feature/app-keys-resolve-from-one-folder`
- **Started:** 2026-11-06, Jan Wloka, `feature/fleetd-names-a-missing-app-key`

## Changelog

- The `Review app`, `Merger app` and `Writer app` keys in `## Plot Config` take only an App id. Plot reads the App's private key from `${XDG_CONFIG_HOME:-~/.config}/plot/plot-<role>.<app-id>.private-key.pem`, or from `PLOT_<ROLE>_APP_KEY` where that variable is set. A line that still names a key path keeps working. fleetd and the board name a missing or unreadable App key once, when they start.

<!-- Board impact: the board starts the probe in slice 2 and reports a missing key in its log. No change to the plan format, the plan template or the docs/plans layout. Helper scripts change: plot-github-app.mjs (resolveApp) and plot-review-writer.mjs. -->

## Motivation

- **A checked-in per-machine path.** `CLAUDE.md` names `/Users/jwloka/...` for every App key. The path is true on one machine only, so a second operator or a second machine needs a config change to run the same repository.
- **A config change that lands before its key.** #3196 merged at 2026-11-06 11:42 and named `~/.config/plot/plot-merger.2026-11-06.private-key.pem` before that file existed. Every merge through the merger app then refused `host-refused`: the main repair #3199 waited about 30 minutes, and fleetd could not merge either. #3200 re-pointed both lines at `~/.plot/` once the operator had placed the keys there.
- **Secrets in the state home.** `~/.plot/state/` holds the budget ledger, memo directories and slots, which tools and tests write and prune. A private key does not belong beside them. `docs/review-status-rollout.md` already names `~/.config/plot/` for keys.
- **A key rotation needs a PR.** A key file named with a date makes each rotation a config change that must merge before the new key works, the order that failed on 2026-11-06.

## Design

### Approach

- **One lookup rule, in one function.** `resolveApp(configKey, here)` in `skills/plot/scripts/plot-github-app.mjs:45` is the reader for `Merger app` (`plot-merger-token.mjs`), `Writer app` (`plot-push-writer-app.mjs`) and `Review app` (`plot-commit-status.mjs`). It resolves the key path in this order:
  1. `PLOT_REVIEW_APP_KEY`, `PLOT_MERGER_APP_KEY` or `PLOT_WRITER_APP_KEY`, where set.
  2. A key path on the config line, where the line still names one (the current form). An absolute path is read as written; a relative path resolves against the repository root, as today.
  3. `${XDG_CONFIG_HOME:-$HOME/.config}/plot/plot-<role>.<app-id>.private-key.pem`, where `<role>` is `review`, `merger` or `writer`.
- **The refusal names the path it tried.** A key that none of the three resolves to a readable file refuses with the same `reason` shape as today, naming the path from the first step that applied, so the operator sees where to put the file.
- **One reader, not two.** `plot-review-writer.mjs:69-76` parses `Review app` itself and resolves the key a second time. It calls `resolveApp` instead.
- **A rotation replaces a file.** The fixed name has no date, so a new key goes to the same path and needs no config change.
- **A probe at start.** fleetd and the board read every declared App key once when they start, through the existing `merger-app-shell.ts` adapter and its `plot-merger-token.mjs` call, and log one line per missing or unreadable key naming the path. Today the first sign is a refused merge.
- **The Bitbucket path is out of scope.** `plot-bitbucket-commit-status.mjs` reads no App key.

### Open Questions

- [ ] Does the probe also hold fleetd's merges until the key reads, or does it only log? The plan proposes log-only: `merger-app-missing` and `merger-app-invalid` already hold every row (`docs/review-status-rollout.md:150`).

## Slices

### Resolver

- `feature/app-keys-resolve-from-one-folder` — `resolveApp` takes an id-only line and resolves the key by the three steps above; `plot-review-writer.mjs` calls it; tests for each step and for the refusal's path; `docs/review-status-rollout.md` names the fixed location and the env variables; the changeset <!-- builds: appKeyPath, the key lookup in resolveApp --> → #3203

### Probe

- `feature/fleetd-names-a-missing-app-key` <!-- waits: feature/app-keys-resolve-from-one-folder --> — fleetd and the board read every declared App key at start and log one line per missing or unreadable key, naming the path; a test per daemon

### Config

- `infra/plot-config-names-app-ids-only` <!-- waits: feature/app-keys-resolve-from-one-folder --> — `CLAUDE.md` `Review app`, `Merger app` lines name only the App id; `AGENTS.md` regenerated

## Notes

- **Operator steps before the Config slice merges** (outside the repository; the operator does them, not an agent):
  - Move `~/.plot/plot-merger.2026-11-06.private-key.pem` to `~/.config/plot/plot-merger.5599192.private-key.pem`, mode 600.
  - Move `~/.plot/plot-review.2026-11-06.private-key.pem` to `~/.config/plot/plot-review.5317669.private-key.pem`, mode 600. The old key at that name is the pre-rotation key: move it aside first.
  - Remove the temporary symlink `~/.config/plot/plot-merger.2026-11-06.private-key.pem`, placed on 2026-11-06 to unblock #3199.
  - Remove `~/.config/plot/plot-merger.2026-11-03.private-key.pem` once the new merger key works.
- The Config slice merges only after the Resolver slice has merged and the operator has moved the keys; a merge in the other order repeats the 2026-11-06 outage.

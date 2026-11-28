## Implementation brief — a-desk-reads-quiet-from-its-live-signals (wave 2: Status Line)

- **Plan (canonical):** `docs/plans/2026-11-27-a-desk-reads-quiet-from-its-live-signals.md` on `main`
- **Approved:** 2026-11-27, jwloka, plan-PR #3747 merged
- **Branch:** `bug/fleetctl-status-asks-the-desk-quiet-reading` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 (`bug/a-desk-reads-quiet-from-its-live-signals`) merged as #3749: `deskQuietSeconds` (`packages/domain/src/rules/desk-quiet.ts`) exists and `logQuietSeconds` in `trees-git.ts` reads all four signals through it. This slice only changes the shell reader.

### What to build

On 2026-11-27 `plot-fleetctl.sh --status` printed `quiet 7178s` for three working agents (#3745). The board's desk walk now reads the newest of four signals; the status line still reads `.plot-worker.log` alone (`plot-fleetctl.sh:927-935`, a `stat -c %Y … || stat -f %m …` on the log), so the two disagree. Make the status ask the domain.

- Add one `plot-ask.mjs` question, `desk-quiet <desk>...`, beside `desk-states` (`packages/board/src/server/entry/main.ts:502`). It prints one line `<desk>\t<seconds>` per argument, in order, and `<desk>\t` with an empty second field where the rule answers `null` or the batch could not be read. Build it on `treesGit({ repoRoot, scriptDir }).logQuietSeconds(desk)` — the same call the desk walk makes, so the two readers cannot drift. Rebuild nothing by hand: `main` builds `plot-ask.mjs`.
- In `plot-fleetctl.sh --status`, call the bundle once for all running desks, next to the existing `desk-states` call (`:910`), and print `— quiet <n>s` from its answer. Delete the `stat` block at `:927-935`.
- Keep the usage-limit wait (`:937-952`) exactly as it is and after the quiet reading, so a future reset still overwrites `quiet`.
- The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**A bundle call, not a second shell reading.** `--status` runs once per operator command, so `docs/shell-and-domain.md` allows the call (34 ms node start, 39 ms bundle). Re-implementing the four-signal rule in bash would be a declared duplicate that pays in lines and needs a corpus pair. Not here.

**One call for all desks**, as `desk-states` does, not one per desk.

**No fifth signal and no log-output change.** The plan's two open questions (`[question-log-output]`, `[question-session-file]`) recommend no. The idle watch's `logActivity` reads the log's size (`worker-loop.ts:1367`); do not touch what the loop writes there.

**Absent is not zero.** An unreadable quiet prints no `quiet` text, as today for a desk with no log. Never print `quiet 0s` for `null`, and never fall back to `now`. Read the bundle's exit code and the field, not the emptiness of the whole output.

**Missing bundle prints no quiet**, as `desk-states` degrades (`2>/dev/null`). Status must not fail because the bundle is absent.

### Done when

The plan's slice `tests:` line is the specification. Lifted, with what each catches:

- **Stale log, fresh pass file.** A running desk whose `.plot-worker.log` is 2 h old and `.plot-worker.pass` 1 min old prints `quiet` near 60 s, not 7200 s. Catches a status still reading the log. Put it in `test/reconcile/fleetctl.test.mjs` beside the `desk-states` stand-in (`:419-445`); the stub there answers `desk-states` only, so extend it or use the real bundle after a build. Run the test against the unfixed script first and see it fail.
- **Usage-limit priority.** A desk with a future `.plot-worker.limited` reset still prints `waiting on a usage limit until …` and no `quiet`. Catches the new reading overwriting the wait.
- **Unreadable.** A desk with none of the four signals prints no `quiet` text. Catches `null` read as 0.
- **Ask test.** A unit test for `plot-ask desk-quiet` in the style of `packages/board/test/unit/ask-desk-states.test.ts`: order preserved, empty field for an unreadable desk, nothing printed for no desks.
- Style: any helper you write is an arrow function.

Plus the repo's gates:

- **Changeset.** `.changeset/<slug>.md` for `'plot': patch` — description first (20+ characters), `bumps:` block last with `skills: plot: patch`. Run `./scripts/check-changeset-packages.sh`.
- **Local checks.** Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.
- **Shell line budget.** `scripts/check-shell-lines.sh pr` refuses a PR whose shell under `skills/` is longer than at its merge base. Deleting the `stat` block (about 9 commands) pays for the one bundle call and the one print, so the slice should net below zero. Measure with the gate before the push. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.
- Add a row for any new script to `skills/plot/scripts/README.md`; this slice adds a question to an existing bundle, so none is expected. If `plot-ask.mjs` documents its questions (`main.ts` header comment, usage string at `:536`), add `desk-quiet` to both.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The PR body names issue #3745.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh` (the `--status` block), `packages/board/src/server/entry/main.ts` plus its unit test, `test/reconcile/fleetctl.test.mjs` and the changeset. It does not touch `desk-quiet.ts` or `trees-git.ts` (wave 1, merged).

In flight at dispatch (remote branches): `a-free-wait-writes-its-own-ending`, `a-held-stale-review-names-its-reason`, `a-launcher-names-the-bundle-it-runs`, `a-new-failure-on-main-starts-a-repair`, `a-waiting-release-holds-merges`, `the-release-head-is-reviewed-while-its-scope-waits`, `the-release-scope-reads-the-tag-range`. Names suggest release and repair code, not `--status`; a collision in `plot-fleetctl.sh` or `main.ts` is possible and not verified — rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

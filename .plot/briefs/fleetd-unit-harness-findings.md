## Implementation brief — fleetd-tick-stop-and-escalation-defects (wave 4: unit harness)

- **Plan (canonical):** `docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Branch:** `bug/fleetd-unit-harness-findings` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub, gated by the `plot-review` app

Fourth slice of six, all in one wave. Nothing waits on it and it waits on nothing. It owns the unit template and the `--start` fill code, which no sibling slice touches.

### What to build

Close the review findings of #1589 (The unit runs its harness), tracked as #1590 and folded into #1846, where it reads "(OPEN): M1 test; L1 quoting and `%` escaping; L2-L5". Find each site by name, not by line number: line numbers below were read on `main` on 2026-10-18.

- **M1 — no test proves the fixed-list dedupe.** `plot-fleetctl.sh:1138` holds `-e "/__NODE_DIR__/s|:$nd:|:|g"`, which removes node's directory from the template's fixed list (`/usr/bin` and the rest). Mutation result in the review: deleting that expression fails no test. A distro node in `/usr/bin` then puts `/usr/bin` twice on the unit PATH with CI green. Fix: fill the template with `node_bin=/usr/bin/node` (through a small harness or an extracted fill function) and assert `/usr/bin` appears once in the PATH. The test at `test/reconcile/fleetctl.test.mjs:744` covers `harness_dir = node_dir`, which the test at `:726` already covers, so drop or rename the duplicate.
- **L1 — the systemd unit breaks on a path with a space or `%`.** `skills/plot/units/plot-fleetd.service` quotes only the `PATH` line. `ExecStart=__NODE__ __FLEETD__` and `Environment=PLOT_REPO_ROOT=__REPO_ROOT__` are unquoted, so systemd splits at a space. systemd also expands `%` specifiers and C escapes in all three. Fix: quote those values and double `%` in the fill (`sed` at `plot-fleetctl.sh:1137`), or refuse such paths on systemd. The test "fills a node directory holding sed-special characters and a space verbatim" (`:779`) reads the text only; narrow its name and the changeset to what the test proves.
- **L2 — the PATH quoting is not tested.** The `unitPath` helper (`fleetctl.test.mjs:574`) accepts the line with or without quotes. Assert `^Environment="PATH=[^"]*"$` in "the filled systemd unit is well-formed" (`:857`).
- **L3 — #1487 L3 stays open.** `plot-fleetctl.sh:1050-1054` refuses a shadowed harness and does not add the symlink directory #1487 proposes. Node's directory still precedes `/usr/local/bin` and `/opt/homebrew/bin` for every binary it holds, including `git` and `gh`. This slice records that in the changeset or PR body and does not close #1487 as answered. It builds no symlink directory.
- **L4 — shadow check edge cases.** `shadow` tests `-x` only (`:1052`), so a directory named like the harness in node's directory refuses falsely. Use `[ -f "$shadow" ] && [ -x "$shadow" ]`. A Homebrew `node@24` pin now refuses `--start` when `/opt/homebrew/bin/claude` exists beside `~/.local/bin/claude`; the changeset names that.
- **L5 — changeset bump target.** The review says `plot-fleetctl.sh` and the unit ship in the `plot` hub skill while the original changeset bumped `plot-fleet`. Confirm which skill directory holds each file and bump that one (`plot`, with `plot-fleet` only if its `SKILL.md` changes).

### Decisions the plan settles — do not re-derive them

**The review marked none of these as blocking, and the plan still groups all of them.** The slice closes #1590 completely so no member stays half-done across slices (plan, Approach).

**L3 is documentation, not code.** The review's own words: "Do not close #1487 as fully answered". Adding the symlink directory is a design change and has no slice here.

**Absent is not false; read the exit code, not the emptiness.** The shadow test must not treat an unreadable path as a shadow.

**The shell gate applies.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. M1 and L4 touch `plot-fleetctl.sh`. Fill the template through an existing path where possible; each added line is paid for by removing a line elsewhere in the same change. Do not add a new script.

### Done when

The plan's Changelog carries no line for this slice, so the spec is the six findings above. Each lands with a test that fails before the fix:

- M1: mutation check — delete the `:$nd:` expression and the new test fails.
- L1: a unit filled for a path with a space and a `%` parses with `systemd-analyze verify` where available, or the test asserts the quoted and doubled text; the test name claims no more than it proves.
- L2: the strict `Environment="PATH=..."` match.
- L4: a directory named like the harness in node's directory does not refuse.

Plus: a changeset under `.changeset/` (description first, `bumps:` block last), `./scripts/check-changeset-packages.sh` passing, and `board-server.mjs` untouched. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` or the full suite list.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is moving
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/units/plot-fleetd.service`, the template-fill region of `skills/plot/scripts/plot-fleetctl.sh` (`:1050-1054`, `:1137-1138`), `test/reconcile/fleetctl.test.mjs`, `packages/board/test/unit/registryd-units.test.ts` and its changeset.

Sibling branches in this plan: `bug/fleetd-tick-guard-and-escalations` (#1995), `bug/fleetd-once-and-channel-output` (#1998), `bug/fleetd-retries-usage-limit-brief` (#1997), `bug/fleetd-stop-starts-no-agent` (claimed; its `wt_root` resolution is in `plot-fleetctl.sh`'s stop path, not the fill region) and `bug/refused-hold-names-its-reason`. Verify at dispatch which are claimed (`git ls-remote --heads origin 'bug/*'`).

If you find something the plan did not anticipate, report it rather than improvising scope.

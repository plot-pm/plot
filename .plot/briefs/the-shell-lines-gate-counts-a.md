## Implementation brief — the-shell-lines-gate-counts-a (wave: Count)

- **Plan (canonical):** docs/plans/2026-10-24-the-shell-lines-gate-counts-a.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2623 merged
- **Branch:** `bug/the-shell-lines-gate-counts-a` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

The plan has one wave and one branch. Nothing waits on it and it waits on nothing.

### What to build

`scripts/check-shell-lines.sh` counts non-comment, non-blank physical lines (`grep -vcE '^[[:space:]]*(#|$)'`) in `count_rev` and in `--per-file`. Joining two statements with `;` or `&&`, or folding a `fi`/`done` onto the previous line, lowers that count while the shell stays the same size. Observed 2026-10-24: #2468 (about 15 join commits in `plot-record-pr.sh`, `plot-open-pr.sh`, `plot-desk-root.sh`), #2591 (5669e01ea, ddf63c701) and #2617 (192e63932, e2a878c7d) each paid the gate with joins until a fix agent replaced them with a real payment.

Change the unit so a join does not lower it, in `count_rev` and `--per-file` alike (one definition, two readers). Then update the refusal text in `report()` and the desk-facing text so each names joining as not a payment. The plan is canonical; this is orientation.

### Decisions to settle with a measurement, not a preference

The plan leaves three questions open. Close them in this order and record the answers in the plan's `## Design` and in the commit message.

- **Unit: commands (option 1) or refusal of joined lines (option 2).** Option 1 re-bases the count for every file once, so a change that is neutral today can read as growth or shrinkage across the switch. Run `check-shell-lines.sh pr` over the last 20 merged shell changes under both definitions and compare verdicts. A verdict that flips on a change that joined nothing disqualifies that definition.
- **Tokenizer or conservative splitter.** An over-count refuses honest changes and an under-count keeps the hole. A `grep`-level splitter miscounts quoted separators, heredocs and `case` arms (`;;`). If a splitter is chosen, it over-counts only on ambiguous lines, and a test pins each ambiguous shape. `bash -n` parses but exposes no token stream: check what `ci.yml` installs before depending on a parser.
- **Where the correction template lives.** The gate is named in `skills/plot-implement/SKILL.md` (step 4, "Name the shell gate"), `skills/plot-implement/README.md:36` and `docs/shell-and-domain.md:48`. Find whether the worker brief and correction text quote the refusal or restate it. A restatement needs the same edit; a quotation follows `report()`.

### Rules carried over

- **The gate stores no number and has no override** (script header). The new unit keeps both: no baseline literal, no environment variable, no allowance.
- **A revert passes by tree, not by subject** (`reverted_commit`). It compares blobs, so the unit change must not touch that path.
- **An unreadable base fails and never passes.** Keep it.
- **A neutral change stays neutral.** `shell-lines.test.mjs` has "a net-zero change passes" and "a shrinking change passes"; both stay green unmodified.
- **Both sides of the comparison use the new unit.** Counting `before` in lines and `after` in commands reads every change as growth or shrinkage.

### Done when

The plan's slice line is the specification: the unit changed in `count_rev` and `--per-file`, `test/reconcile/shell-lines.test.mjs` holds a joined-line case, and the refusal and desk-facing text name joining as not a payment.

- **The joined-line case fails before the change.** Write it first and run it against the unmodified script to see the gate pass wrongly. A test that never failed proves nothing. Fixture: a change that adds shell and hides the growth by joining statements.
- **A `;` join, an `&&` join and a `fi`/`done` fold each get a case.** Those are the three shapes the desks used.
- **A quoted separator (`echo "a; b"`) does not count as two commands.** It catches a splitter that ignores quoting and refuses honest changes.
- **`--per-file` total equals `count_rev HEAD`** for the same tree. It catches the two readers drifting apart.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The script itself lives outside `skills/`, but any `.sh` file you touch under `skills/` pays for growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. Add a changeset (description first, `bumps:` last; `plot-implement: patch` if its SKILL.md changes) and run `./scripts/check-changeset-packages.sh`. If `CLAUDE.md` changes, run `./scripts/check-agents-md.sh --write`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `scripts/check-shell-lines.sh`, `test/reconcile/shell-lines.test.mjs`, the desk-facing text in `skills/plot-implement/` and `docs/shell-and-domain.md` that quotes the count, and the plan's `## Design` open questions. No other plan in flight names these files. If you find something the plan did not anticipate, report it rather than improvising outside scope.

# Safety juror — controller-gate-refuses-read-only-commands

Position: amend

## Lens

Safety: what the change lets the controller gate pass that it refuses today, and whether every uncertain reading ends in a named refusal.

## Findings

### 1. The defect is real; the reproduction the plan asks for is done

Run on the main checkout (not a linked worktree), with `plot-gate.mjs controller` and hook JSON on stdin, `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` unset:

| command | exit |
|---|---|
| `sed -n 1,5p skills/plot/scripts/plot-approve.sh` | 2 (refused) |
| `awk 'NR<3' skills/plot/scripts/plot-approve.sh` | 2 |
| `rg -n People skills/plot/scripts/plot-approve.sh` | 2 |
| `grep -n People skills/plot/scripts/plot-approve.sh` | 0 |
| `pgrep -f "plot-approve.mjs the-x"` | 2 |
| `lsof -c plot-deliver.mjs` | 2 |
| `ps aux \| grep plot-approve.mjs` | 0 |
| `pkill -f plot-approve.mjs` | 2 |
| `sed '1e plot-approve.sh x' /dev/null` | 2 |
| `rg --pre plot-approve.sh x .` | 2 |
| `awk 'BEGIN{system("plot-approve.sh x")}'` | 0 (allowed today) |

The plan's local run allowed `plot-approve.sh foo` because it ran in a linked worktree: `gate.ts:983` (`if (linked) return null;`) allows every call at a desk. The open question "does the gate refuse today" has its answer: yes, from the main checkout. The issue's latest comment says #2706 "fixed `grep`, `sed -n`, `awk` and `cat`"; that is false for `sed` and `awk` — `READERS` at `ci-suite.ts:66-68` on origin/main lists neither.

### 2. The for-loop carve-out reads `isReader`, not `isReadSegment` — the guards as placed open a bypass

`withoutDataLists` (`ci-suite.ts:105-116`) empties a `for` word list when every body segment passes `isReader` (`:111`), and checks only substitutions. The plan puts the new guards "beside the `git` run-option guard", which lives in `isReadSegment` (`ci-suite.ts:359-366`), not in `isReader`. Once `sed`, `rg` and `awk` join `READERS`, these commands lose the gated name before `controllerInvocation` reads them, and run the controller with no receipt:

- `for f in plot-approve.sh; do sed "1e $f slug" /dev/null; done`
- `for f in plot-approve.sh; do rg --pre "$f" x .; done`
- `for f in plot-approve.sh; do awk "BEGIN{system(\"$f slug\")}"; done`

The `git` guard has the same latent gap today (`for f in x; do git diff --ext-diff …`), but no gated name runs through it. This plan is the first to make the gap reach a controller.

### 3. A text guard on `system(` misses spaced forms

`awk 'BEGIN{system ("/p/plot-approve.sh x")}'` splits to words `'BEGIN{system`, `("/p/plot-approve.sh`, `x")}'`. Today `scriptNamed` reads the second word as `plot-approve.sh` and refuses. With `awk` in `READERS` and a guard that tests for `system(`, `isReadSegment` answers read and the segment is skipped. The same holds for `sed` scripts split across words (`'1 e`, `plot-approve.sh`), and for `s/x/plot-approve.sh y/e` where `e` is a flag, not a command. The plan names "no `e` or `w` command" and does not say how a whitespace-split word list detects either.

### 4. The segment split hides awk's `|` from the guard

`controllerInvocation` splits on raw `|`, `;` and `&&` before quotes are read (`ci-suite.ts:225`). An awk program's `|` therefore never reaches the awk segment's guard; the remainder becomes its own segment and is read as a run. That is safe today but makes the plan's `|` guard dead code, and a reader of the plan will believe it protects something.

### 5. The issue's residual case is not in the plan

The latest comment on #2530 (2026-11-04) names `pgrep -f "<bundle> …"` refused by the master session's wait loop, and asks that `pgrep`, `ps` and `lsof` read as reads while `pkill` with a signal and `pgrep … | xargs …` stay refused. The plan's single slice adds `sed` and `rg` only. A merged slice leaves #2530 open, and the master session still takes an unowned-action receipt — a counted bypass for an action that never ran — for every wait loop that names a bundle. That is an intervention the sprint goal counts.

### 6. Scope disagreement inside the plan

The Changelog and Approach admit `awk`; the Open Questions doubt it; the slice omits it. An unattended agent reads the Changelog as the deliverable and builds `awk`. A person decides this before approval.

### 7. Smaller points

- `READERS` is at `ci-suite.ts:66`, not `:60`.
- `sed -i` forms: `-i.bak`, `-Ei`, `-ni`, `--in-place=SUF`, BSD `-i ''`. A guard for `-i` must read clustered short options. Writing a gated file runs no controller, so this guard protects the file, not the gate; the plan states it as if it protected the gate.
- `rg` reads `RIPGREP_CONFIG_PATH`, which can set `--pre`. The command text cannot show it. Either pass the case as accepted risk in the plan, or require `--no-config` for `rg` to read as a read.
- `mergeCall` (`controller-gate.ts:263`) also calls `isReadSegment`. A looser predicate also loosens the unpinned-merge reading; `awk 'BEGIN{system("gh pr merge 1")}'` already passes today because `mergeCall` needs `gh` as the program, so nothing new opens there, but a test must pin it.

## Amendments required

1. Put every new guard in the predicate that `withoutDataLists` calls, or make `withoutDataLists` call `isReadSegment`. Add a test per new reader with the `for f in <gated>; do <reader-that-runs> "$f"; done` shape, each refused.
2. Read the new readers' segments through `readShell` word values (`shell-reading.ts:92`), so a script or pattern is one word. Admit a segment as a read only when no gated name appears inside the script, program or `--pre` value; a gated name as a whole file operand is a read. `readShell` returning `null` reads as a run, never as a read.
3. Replace "no `e` or `w` command" with an exact rule a test can pin, including `s///e`, `s///w`, `W`, and a spaced `1 e`. Same for awk: `system` followed by optional whitespace and `(`, `|&`, `getline`, `-f`/`--file`, `-l`/`--load`, `@load`. Any `-f`/`--file` (sed or awk) reads as a run, because the program is not in the command.
4. Add a slice, or a second wave of this slice, for the residual: `pgrep` (any options) and `lsof` read as reads; `pkill` and `kill` stay runs. Name the test `pgrep -f "plot-approve.mjs slug"` allowed and `pkill -f plot-approve.mjs` refused.
5. Remove `awk` from the Changelog, or add it to the slice with amendment 3's guard. Do not ship a Changelog line the slice does not build.
6. Replace the "not yet measured" paragraph with the measurement above, and note that a linked worktree allows every call, so a reproduction runs from the main checkout.

## Decisions for a person

- Whether `awk` is admitted at all. Its program is a language; a guard reading it as data is a parser the gate does not have.
- Whether the residual (`pgrep`, `lsof`) belongs in this plan or a second plan. The sprint goal favours this plan, because the master session hits it today.
- Whether `RIPGREP_CONFIG_PATH` is accepted risk or `rg` needs `--no-config`.

## Ran versus read

Ran: `plot-gate.mjs controller` on the main checkout for the 13 commands in the table (hook JSON from a file, no action receipt written; the gate reads receipts and leaves them). `gh issue view 2530 --comments`. `git show origin/main:` of `ci-suite.ts`, `controller-gate.ts`, `gate.ts`, `plot-controller-gate.sh`.

Read only: the bypass shapes in findings 2 and 3. They follow from `ci-suite.ts:105-116`, `:225-236` and `:359-366`; no code with the plan's change exists to run them against.

# Panel moderation: plot-fleetctl --stop ignores --dry-run

Round 1, 2026-11-04. Four jurors: layering, safety, testability, seams. Verdict: unanimous **amend**. The plan was amended in the same commit as this file.

## Positions

| Juror | Position | Decisions for a person |
|---|---|---|
| layering | amend | none |
| safety | amend | none |
| testability | amend | none |
| seams | amend | one: the sprint line for the `Sprint:` field |

## Disagreements

- **The supervisor observable.** Safety asks for a `launchctl` stub that logs its argv and asserts no `bootout`. Testability names two options: the existing `stubUnload` and its `unload-ticks` file, or an argv log. The plan takes `stubUnload` and `unload-ticks`, because the stub exists at `fleetctl.test.mjs:1742`, the `--stop` cases at `:583` already use it, and it writes the file on `bootout` only. A new argv-logging stub would be a second stub for one question.
- **Where the offset comes from.** Layering accepts a rule ("find dead or duplicated commands and remove them"). Seams proposes folding the check into the `:795` line or removing a dead command. Neither names a site. Measured with the gate's awk: a fold into `:795` as a `case` costs +7 and the plain line costs +6, so a fold does not pay for itself. `plot-fleetctl.sh` has no function without a caller. The plan names two single-caller functions instead (see Decisions).
- **The `-h` range.** Layering and safety ask only that `-h` keep printing the `--dry-run` rule. Seams asks to fix the range so `--wait` and `--dry-run` print, and to hold it with a test. The plan takes the seams form: a content-anchored range (`2,/^# Output:/`) and a test case, because the range is already wrong on `origin/main` and a number fixes nothing the next edit does not break again.
- **Exit code 1 for `--status --dry-run`.** Safety names the collision with `--status`'s own exit 1 and finds no caller; no other juror raises it. The plan keeps exit 1 with the `plot-fleetctl:` prefix, as safety concludes.

## Shared blind spots

- **No juror counted the offset.** Three jurors say the shell grows and the plan does not pay, and none measured a candidate. The moderation counted with the gate's own awk on `e54e53815`: refusal +6, `running_major` inlined -5, `home_short` inlined -3, net -2. The obvious candidate, `pinned_major`, fails: `fleetctl.test.mjs:380` and `:389` source the script and call it.
- **No juror checked that `--stop` reaches the dispatch stub in the sandbox.** The arm first asks `old_label_refuses` (`:1287`), which refuses when the serving checkout cannot be read. The plan therefore builds case 1 from the `:583` sandbox (`stubUnload` with `workdir: root`, `fakeHome` with a unit) and the `:426` desk, and requires the case to fail on `origin/main` before the fix is written.
- **The changeset bumps.** Seams names `plot-fleet: patch` only. The script lives under `skills/plot/`, so the plan bumps `plot: patch` too.

## Juror claims checked

| Claim | Juror | Result on `e54e53815` |
|---|---|---|
| `dry_run` declared `:764`, set `:788`, read `:654` and `:1146` | all | true |
| `--stop` arm calls `retire_old_label` at `:1441`; the plan's "reads none" is wrong | safety | true; plan corrected |
| `-h` prints `sed -n '2,27p'`, block ends `:32` | layering, safety, seams | true |
| one package caller, `supervisor-reading.ts:152`, `['--status']` only | seams, layering (`:52` is the `SCRIPT` constant) | true |
| `check-shell-lines.sh` in CI at `ci.yml:1509-1511`, absent from `Local checks` | layering | true; filed #3120 |
| `stubPlatform` records no call, so "still loaded" cannot fail before | testability | not re-read; the plan uses `stubUnload` and does not depend on it |
| the sprint file has no line for this plan | seams | true in the worktree; the caller writes it after approval |

## Ran versus read

- layering: ran `git show` and `git grep` on `origin/main` and a grep of `ci.yml`. Ran no gate and no test.
- safety: ran `git fetch`, `git show`, `git grep` and `gh issue view 3099`. Ran no test and no fleet command.
- testability: ran `git show`, grep over the script and the test file, `gh issue view 3099`. Ran no test.
- seams: ran `gh pr list`, `gh pr view --json files` on 9 PRs, `git show`, `git grep`, `git log`. Ran no gate and no test.
- moderation: ran the `check-shell-lines.sh` awk on the script and on each candidate snippet, `git grep` for callers of `pinned_major`, `running_major` and `home_short`, the `home_short` case block in bash, and `gh issue create` twice. Ran no test suite.

## Decisions

| Decision | By | Reason |
|---|---|---|
| The plan joins sprint `follow-ups-2-30-1`; the sprint file line follows approval | caller | answers seams' decision for a person |
| `--dry-run` with any mode but `--start` refuses (closes Open Question 1) | caller | no caller passes it |
| The slice runs `./scripts/check-shell-lines.sh pr` and names its offset | caller | the gate refuses any growth |
| The slice ships a changeset bumping `plot-fleet` | caller | `SKILL.md` changes |
| No `--stop` preview (closes Open Question 2) | moderation | a refusal writes nothing; a preview is its own plan if asked for |
| Offset from inlining `running_major` and `home_short` | moderation | single callers, covered by tests at `:2430` and `:3099`, net -2 |
| Refusal after the mode-required line, exit 1 | moderation | a bare `--dry-run` keeps its existing message; exit 1 matches unknown-argument refusals |
| `-h` range anchored on `# Output:` | moderation | count-neutral, and survives the next usage edit |
| Changeset also bumps `plot: patch` | moderation | the script ships in `skills/plot/` |

## Filed

- #3119: a second mode flag in `plot-fleetctl.sh` replaces the first (safety finding 2).
- #3120: the shell-lines gate is missing from the `Local checks` list (layering finding 4).

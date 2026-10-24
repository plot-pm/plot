# The main-checkout write gate misses git calls behind shell keywords

> The gate that refuses an unattended git write in the main checkout does not see a git call that follows a shell keyword, and several neighbouring gaps remain open.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2487
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2540 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/the-main-checkout-write-gate-misses`

## Changelog

- The main-checkout write gate refuses git writes that follow `if`, `for`, `{`, `!`, `time` or a single `&`, covers `tag`, `fetch src:dst`, `notes` and `clean -f`, and ignores heredoc bodies.
- A continuation launch clears `PLOT_MAIN_CHECKOUT_WRITER`, and the worker prompt records a slice PR number through the controller.

<!-- Board impact: none expected. The change touches the domain rule, the board's gate entry, the fleet's continuation launch, one prompt file and tests. No plan format, template or helper script changes. -->

## Motivation

Issue #2487 collects eleven follow-up findings from plot-review on #2313, #2316, #2318 and #2397, checked against `origin/main` at `84b1638e4` on 2026-10-24. Three groups:

1. **Gate coverage.** `packages/domain/src/rules/main-checkout-write.ts:158` finds a git call only at the start of a command, so a call behind a leading `if`, `for`, `{`, `!` or `time`, or after a single `&`, passes. `:36` (`MUTATING_GIT_SUBCOMMANDS`) omits `tag`, `fetch src:dst`, `notes` and `clean -f`. `:188` (`gitWriteDirs`) reads an unquoted heredoc body as commands, so a body line starting with `git checkout` is refused. `packages/board/src/server/entry/gate.ts:459` counts a failed linked-worktree read as the main checkout and refuses, which the docs do not state. `packages/fleet/src/shared/continuation.ts:1017` spreads `process.env` into the continuation launch without clearing `PLOT_MAIN_CHECKOUT_WRITER`.
2. **Writers test.** `test/reconcile/main-checkout-writers.test.mjs` passes the `plot-open-pr.sh` `pr-create` assertion on a comment line (`:189`), its `doesNotMatch` pattern misses `git -C <dir> commit` (`:189`), its header comments claim both halves are asserted for every candidate and each runs against a sandbox (`:6`), and its scratch-file check reads only top-level `.sh` files and exempts any write with an `mv` in the next three lines (`:81`).
3. **Prompt and plan text.** `.plot/worker-prompt.md:11` tells an agent to append the PR number to the plan on main, which is the write `recording-a-slice-pr-number-writes` investigates. That plan's candidate writer list (`:33`) omits the desk agent following the brief and names two candidates already ruled out, and its step 4 does not name the existing writers gate test (`:35`).

## Design

### Approach

1. Extend the command scanner in `main-checkout-write.ts` so a git call is found after `if`, `for`, `{`, `!`, `time` and a single `&`, and skip unquoted heredoc bodies. Add `tag`, `fetch src:dst`, `notes` and `clean -f` to the mutating set. Each case gets a domain unit test with a refused and a passing example.
2. Decide the failed linked-worktree read in `gate.ts`: either refuse and state it in the docs, or pass and state that. The docs and the code must agree.
3. Clear `PLOT_MAIN_CHECKOUT_WRITER` in the continuation launch environment.
4. Change `.plot/worker-prompt.md` to record a slice PR number through the controller. `.plot/worker-prompt.sh:186` holds a declared duplicate of that text, so both files change together.
5. Rewrite `main-checkout-writers.test.mjs` so it asserts what its comments claim: ignore comment lines, match `git -C <dir> commit`, and read nested scripts.
6. Edit the Approved plan `recording-a-slice-pr-number-writes`: name the desk agent as a candidate writer, remove the two ruled-out candidates, and name the existing writers gate test in step 4.

Step 1 changes a rule the gate and the shell share. A duplicated rule joins the corpus tier (`packages/domain/corpus/`), so check whether a shell-side copy of the scanner exists before the slice starts.

### Open Questions

- [ ] Does a failed linked-worktree read refuse or pass? Refusing is the safer default; passing hides a broken read.
- [ ] Does `clean -f` cover `-fd`, `-fx` and `-n` (dry run)? A dry run mutates nothing and should pass.
- [ ] Does the worker prompt name an existing controller route for recording a PR number, or does that route not exist yet? `plot-open-pr.sh` is the candidate.
- [ ] Does editing an Approved plan from this plan need a state receipt? The edit changes no `State:` line, so the state gate should not apply.

## Slices

### Gate

- `bug/the-main-checkout-write-gate-misses` — scanner, mutating set, heredoc handling, failed-read behaviour and the continuation env, with domain and board tests → #2579 <!-- builds: the shell-keyword prefix scanner in main-checkout-write.ts -->

### Writers

- `bug/the-main-checkout-writers-test-asserts` — the worker prompt records the PR number through the controller, the writers test asserts its claims, and the Approved plan's candidate list is corrected

## Notes

- Source: https://github.com/plot-pm/plot/issues/2487
- Follow-up to #2311 and `recording-a-slice-pr-number-writes`.
- The two slices are sequential: the writers test reads the prompt and the gate, so it follows the gate slice.

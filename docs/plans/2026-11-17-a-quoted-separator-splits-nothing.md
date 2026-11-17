# A quoted separator splits no command

> The controller gate splits a command only at an unquoted, unescaped `&&`, `||`, `;`, new line or `|`, so a read-only `grep` or `git grep` whose quoted pattern holds a separator and a gated name passes, and every unquoted run still refuses.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #3495
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3497 merged
- **Started:** 2026-11-17, Jan Wloka, `bug/a-quoted-separator-splits-nothing`

## Changelog

- The controller gate no longer refuses a read-only command such as `grep -n "a\|plot-deliver.mjs" README.md` whose quoted or escaped argument holds a `|`, `;`, `&&`, `||` or new line before a gated script name.
- At a fleet desk, the CI-suite refusal now catches a suite after an escaped quote, such as `cat it\'s; pnpm run test:e2e; cat 'y'`, which it passed before.

Board impact: none. The change is inside the domain rules `controllerInvocation` and `ciSuiteRefusal`; the plan format, the template, the helper scripts and the `docs/plans` layout stay the same.

## Motivation

`nonReadSegments` (`packages/domain/src/rules/ci-suite.ts:283-298`) splits the command into pipelines with `.split(/&&|\|\||[;\n]/)` (`:285`) and each pipeline into segments with `.split('|')` (`:286`). Neither split reads quotes or backslash escapes. `bodySegments` (`:119-127`), which decides whether a `for` loop's word list is data, uses the same plain split (`:121`).

For `grep -n "a\|plot-deliver.mjs" README.md | head`, the `|` inside the double quotes splits the command into the segments `grep -n "a\`, `plot-deliver.mjs" README.md` and `head`. The second segment's program word is `plot-deliver.mjs"`. `isReadSegment` (`:414-421`) asks `isReader` (`:108-113`), which finds no reader under that name, so the segment counts as a run. `controllerInvocation` (`:262-273`) then asks `scriptNamed` (`:395-404`) of each word. `wordBasename` (`:354-363`) drops the trailing `"` (`:358`) and answers `plot-deliver.mjs`, which is in `GATED`, so the command reads as `deliver`. A trailing quote or backslash is not the cause: the split is. The cause is the same for a single quote, a `;`, `&&`, `||`, a quoted new line and an unquoted `\|`.

**The issue's table holds a confounded measurement.** It reports that `grep -n "a|plot-approve.sh" README.md`, `grep -n 'x;plot-approve.sh' README.md` and `grep -n "a && plot-approve.sh" README.md` pass. They pass only because the main checkout holds the action receipts `.plot/state/action-receipts/approve` and `.plot/state/action-receipts/dispatch`, and the gate clears a named action that has a receipt (`packages/board/src/server/entry/gate.ts:1056`). In the same checkout the unquoted `true && plot-approve.sh x` and `cat x | plot-dispatch.sh y` also exit 0. Measured 2026-11-17 against this branch's `skills/plot/scripts/board/plot-gate.mjs controller` in a scratch repository with an empty `.plot/state/`, every quoted shape refuses:

| Command | Gate exit |
|---|---|
| `grep -n "a\|plot-deliver.mjs" README.md \| head` | 2, deliver |
| `grep -n "a\|plot-approve.sh" README.md` | 2, approve |
| `grep -n "a\|plot-dispatch.sh" README.md` | 2, dispatch |
| `grep -n "a\|plot-deliver.sh" README.md` and the same in single quotes | 2, deliver |
| `grep -n 'x;plot-deliver.sh' README.md` | 2, deliver |
| `grep -n "a && plot-deliver.sh x" README.md` | 2, deliver |
| `grep -n 'a \|\| plot-dispatch.sh x' README.md` | 2, dispatch |
| `grep -nE '(a\|plot-deliver.sh)' README.md` | 2, deliver |
| `git grep -n 'a\|plot-deliver.sh'` and `git log --grep 'a\|plot-deliver.sh'` | 2, deliver |
| `grep -n "a` new line `plot-deliver.sh" README.md` | 2, deliver |
| `grep a\\|plot-deliver.sh x` (an unquoted escaped pipe) | 2, deliver |
| `for f in plot-deliver.sh; do grep "a\|b" $f; done` | 2, deliver |
| `for f in plot-deliver.sh; do grep a $f; done` | 0 |
| `grep -n plot-deliver.sh README.md` | 0 |

The user sees a refusal that names a controller endpoint for a command that runs nothing. An agent that searches the code for a gated name with an alternation pattern is refused, and the live PreToolUse hook refused the same command twice in one session (#3495).

**The CI-suite gate has the opposite defect: it passes a suite it must refuse.** `ciSuiteRefusal` (`ci-suite.ts:185-198`) splits after `withoutQuotes` (`:188`, `:32-33`), which blanks every span the quote regex matches and does not read a backslash outside quotes. The gate asks it only for an unattended agent at a fleet desk: `PLOT_UNATTENDED=1`, a linked worktree whose root holds `.plot-worker.pid` (`gate.ts:1014`, `:1027-1034`; `local-checks.ts:382-389`). Measured 2026-11-17 with this branch's `plot-gate.mjs controller` in a scratch repository whose `CI suites` key lists `pnpm run test:e2e; pnpm run test:contracts`, from a linked worktree holding `.plot-worker.pid`, with `PLOT_UNATTENDED=1`:

| Command | Gate exit |
|---|---|
| `pnpm run test:e2e` | 2, CI suite |
| `cat x; pnpm run test:e2e` | 2, CI suite |
| `cat it\'s; pnpm run test:e2e; cat 'y'` | **0** |
| `echo it\'s; pnpm run test:contracts; echo 'y'` | **0** |
| `grep -n 'pnpm run test:e2e' README.md` | 0 |
| `grep -n "a\|pnpm run test:e2e" README.md` | 0 |

The regex reads `'s; pnpm run test:e2e; cat '` as one quoted span and blanks it, so no segment starts with the suite's words. In bash, `\'` is a literal apostrophe, and the line runs `pnpm run test:e2e`. A fleet agent can start a CI suite that the gate exists to refuse.

## Design

### Approach

**The fix lives in the domain rule `ci-suite.ts`, and it reuses the existing tokenizer.** `readShell` (`packages/domain/src/rules/shell-reading.ts:92`) already reads quotes, backslash escapes, substitutions, comments, the list and pipeline operators and heredocs, and returns each `ShellWord` with its `start` and `end` offsets. A word never holds an unquoted separator, because `WORD_END` (`shell-reading.ts:70`) ends a word at `;`, `&`, `|` and a new line. So every separator that lies inside a word's `[start, end)` span is quoted or escaped, and every separator outside all word spans is one the shell acts on. A second tokenizer would duplicate `readShell`, so the plan writes none.

- Add one arrow helper in `ci-suite.ts`, `unquotedSplit(text, separator)`. It calls `readShell(text)`, collects the spans of every word of every command (inner substitution commands lie inside an outer word span, and overlap is harmless), finds each match of `separator` in `text` whose offset lies outside every span, and returns the slices of `text` between those matches.
- Where `readShell` returns `null` (an unterminated quote, `case`, `;;`, a function definition), the helper falls back to today's plain `text.split(separator)`. The fallback over-splits, so an unreadable command keeps today's answer and the gate never loosens on it.
- `nonReadSegments` (`:285`, `:286`) and `bodySegments` (`:121`) call the helper in place of `.split`. Each segment's words stay a whitespace split of the original text (`:287`), with quote characters kept. This keeps a non-reader such as `bash -c "plot-deliver.sh x"` a run: its words stay `bash`, `-c`, `"plot-deliver.sh`, `x"`, and `scriptNamed` still finds the script. Using `ShellWord.raw` as the words would make `"plot-deliver.sh x"` one word whose basename names no script, and that would loosen the gate.
- `ciSuiteRefusal` (`:188`) splits the command with `unquotedSplit` on `&&`, `||`, `;`, `|` and new lines, in place of `withoutQuotes(command).split(...)`. Each segment's words are its whitespace split, as in `nonReadSegments`. A quoted suite stays a read: in `grep -n 'pnpm run test:e2e' README.md` the segment's program is `grep`, so `programWords` does not begin with `pnpm`. An escaped quote no longer hides a suite: `readShell` reads `it\'s` as one word, so `pnpm run test:e2e` is its own segment.
- `withoutQuotes` keeps callers after the change, so it stays exported: `controller-gate.ts:273`, `role-gate.ts:65`, `:76`, `:99`, `:135`, `main-checkout-write.ts:322`, `:420`, `:507`, and its own test (`ci-suite.test.ts:46`). Those callers share the backslash gap, and this plan does not change them.
- The TSDoc of `ciSuiteRefusal` (`:174-184`) states that the command splits at unquoted, unescaped separators, and that an unreadable command splits on every separator.
- The TSDoc of `nonReadSegments` and of `controllerInvocation` states that a separator inside quotes or after a backslash splits nothing, and that an unreadable command splits on every separator.

**Why not the `QUOTED` regex.** `withoutComments` (`:46-56`) already blanks spans that `QUOTED` (`:36`) matches. That regex does not read a backslash outside quotes. For `cat it\'s; plot-deliver.sh x; cat 'y'` it matches `'s; plot-deliver.sh x; cat '` as one quoted span, so a split on its blanked copy leaves one segment whose program is the reader `cat`, and the gate would pass a command that runs `plot-deliver.sh`. `readShell` reads `it\'s` as one word and keeps `plot-deliver.sh x` as its own command.

**What does not change.** An unquoted separator splits as before, so `a | plot-deliver.sh x`, `true && plot-approve.sh x` and `cat x | plot-dispatch.sh y` still refuse. An unquoted heredoc body is outside every word span, so it stays tokenised as the `controllerInvocation` TSDoc requires (`:243-246`). A gated name in a non-reader's argument, such as `echo "x plot-deliver.sh"`, is still read as a run (`:241-242`). `isProcessRead` (`:92-102`) already re-reads its segment through `readShell` and is unchanged. The `gate.ts` entry, the bundle and the receipt check are unchanged. No shell script holds this rule, so no shell/domain duplicate and no corpus row apply.

The rule is pure and synchronous, so the Layering Rule holds: no port, no adapter, no spawn. The helper is an arrow function, and its TSDoc states what it returns and how it fails, per the domain package rules.

### Open Questions

- [x] Does `ciSuiteRefusal` (`ci-suite.ts:188`) move onto `unquotedSplit` in this slice, or in a separate plan? Answer: in this slice (option b).

### Decisions

- 2026-11-17, Jan Wloka, in session: `ciSuiteRefusal` moves onto `unquotedSplit` in this slice and does not get a separate plan. The measurement in Motivation shows that `cat it\'s; pnpm run test:e2e; cat 'y'` exits 0 at a fleet desk today.

## Done when

| Claim | Check | Slice |
|---|---|---|
| A quoted escaped pipe before a gated name is a read | `packages/domain/test/ci-suite.test.ts` › `a separator inside quotes splits no command (#3495)`: `controllerInvocation('grep -n "a\\|plot-deliver.mjs" README.md \| head')` is `null`; it is `'deliver'` before the fix | Quote-aware split |
| Every quoted separator shape is a read | the same `describe`, one row each for a double- and a single-quoted `\|`, `;`, `&&`, `\|\|`, a quoted new line, `grep -nE '(a\|plot-deliver.sh)'`, `git grep -n 'a\|plot-deliver.sh'`, `git log --grep 'a\|plot-deliver.sh'` and the unquoted `grep a\\|plot-deliver.sh x`, across all three gated names; each is `null` | Quote-aware split |
| A quoted pipe in a `for` loop body keeps its word list data | the same `describe`: `for f in plot-deliver.sh; do grep "a\|b" $f; done` is `null`; it is `'deliver'` before the fix | Quote-aware split |
| An unquoted pipe into a gated script still refuses | `ci-suite.test.ts` › `an unquoted separator still splits (#3495)`: `a \| plot-deliver.sh x` is `'deliver'` and `cat x \| plot-dispatch.sh y` is `'dispatch'` | Quote-aware split |
| An unquoted `&&` before a gated script still refuses | the same `describe`: `true && plot-approve.sh x` is `'approve'` | Quote-aware split |
| An escaped quote outside quotes hides no run | the same `describe`: `cat it\'s; plot-deliver.sh x; cat 'y'` is `'deliver'` | Quote-aware split |
| A command `readShell` cannot read keeps today's split | the same `describe`: `case x in a) plot-deliver.sh y;; esac` is `'deliver'` | Quote-aware split |
| A quoted script name in a non-reader's argument stays a run | the same `describe`: `bash -c "plot-deliver.sh x"` is `'deliver'` | Quote-aware split |
| The bundle passes the issue's command and refuses an unquoted run | `test/reconcile/controller-gate.test.mjs` › `controller gate: a quoted separator before a gated name is a read (#3495)`: exit 0 for `grep -n "a\|plot-deliver.mjs" README.md \| head`, exit 2 for `a \| plot-deliver.sh x`, in a sandbox repository with no action receipt | Quote-aware split |
| A quoted CI suite inside a grep pattern is a read | `ci-suite.test.ts` › `a CI suite splits only at an unquoted separator (#3495)`: `ciSuiteRefusal('grep -n "a\|pnpm run test:e2e" README.md', ['pnpm run test:e2e'])` and `ciSuiteRefusal("grep -n 'pnpm run test:e2e' README.md", ['pnpm run test:e2e'])` are `null` | Quote-aware split |
| An unquoted CI suite still refuses | the same `describe`: `ciSuiteRefusal('cat x; pnpm run test:e2e', ['pnpm run test:e2e'])` is `{ suite: 'pnpm run test:e2e' }` | Quote-aware split |
| An escaped quote outside quotes hides no CI suite | the same `describe`: `ciSuiteRefusal("cat it\\'s; pnpm run test:e2e; cat 'y'", ['pnpm run test:e2e'])` is `{ suite: 'pnpm run test:e2e' }`; it is `null` before the fix | Quote-aware split |
| Every existing controller-gate and CI-suite row still holds | `pnpm --filter @plot-pm/domain exec vitest run test/ci-suite.test.ts test/controller-gate.test.ts` and `node --test test/reconcile/controller-gate.test.mjs` pass | Quote-aware split |

## Slices

### Quote-aware split

- `bug/a-quoted-separator-splits-nothing` — `packages/domain/src/rules/ci-suite.ts` (`unquotedSplit` over `readShell` word spans, used by `nonReadSegments`, `bodySegments` and `ciSuiteRefusal`; TSDoc of the three and of `controllerInvocation`), `packages/domain/test/ci-suite.test.ts` (three new `describe` blocks), `test/reconcile/controller-gate.test.mjs` (one bundle test), and `.changeset/a-quoted-separator-splits-nothing.md` for `plot` (patch, with a `bumps:` block naming `plot: patch`) <!-- builds: unquotedSplit, a quote-aware separator split over readShell --> → #3502

## Notes

- Deliverable search, 2026-11-17: `plot-deliverable-search.sh "quote-aware command splitting in nonReadSegments"` found `nonReadSegments` only at `ci-suite.ts:263` and no other quote-aware splitter; `"quoted separator"` found no deliverable; `"readShell"` found 16 lines in 3 files, all in `shell-reading.ts`, `controller-gate.ts` and `ci-suite.ts`. `readShell` is the tokenizer this plan reuses, so the slice builds no second one.
- `controller-gate.ts` uses `readShell` for `withoutQuotedHeredocs` (`:26`) and `withoutMessageSinks` (`:196`), which blank text before `controllerInvocation` reads it. Neither blanks a `grep` pattern, so neither answers #3495.
- The issue's measurement ran in the main checkout, where `.plot/state/action-receipts/approve` and `.plot/state/action-receipts/dispatch` exist. A gate measurement of `approve` or `dispatch` there answers 0 for an unquoted run too; measure in a repository with an empty `.plot/state/`.
- Found while writing the plan in #3494.

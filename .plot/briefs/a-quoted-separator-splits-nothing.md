## Implementation brief — a-quoted-separator-splits-nothing

- **Plan (canonical):** docs/plans/2026-11-17-a-quoted-separator-splits-nothing.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3497 merged
- **Branch:** `bug/a-quoted-separator-splits-nothing` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `plot/review` through the plan's `Review: pr` channel; CI is the authority for the suites

One slice, no other wave waits on it and it waits on none.

### What to build

The controller gate splits a command at every `&&`, `||`, `;`, new line and `|`, quoted or not. `grep -n "a\|plot-deliver.mjs" README.md | head` splits inside the quotes, the second segment's program word becomes `plot-deliver.mjs"`, `isReader` finds no reader under that name, and the command reads as `deliver`. The live PreToolUse hook refused that command twice in one session (#3495). The opposite defect sits in `ciSuiteRefusal`: `cat it\'s; pnpm run test:e2e; cat 'y'` exits 0 at a fleet desk, because the `QUOTED` regex reads `'s; pnpm run test:e2e; cat '` as one quoted span and blanks the suite.

The fix is one arrow helper in `packages/domain/src/rules/ci-suite.ts`, `unquotedSplit(text, separator)`, on top of `readShell` (`packages/domain/src/rules/shell-reading.ts:92`). `readShell` already returns each word with `start` and `end` offsets, and `WORD_END` (`:70`) ends a word at `;`, `&`, `|` and a new line. So a separator inside any word's `[start, end)` span is quoted or escaped, and one outside every span is real. The helper collects the spans of every word of every command, splits `text` at each match outside all spans, and returns the slices. Three callers switch to it: `nonReadSegments` (`:285`, `:286`), `bodySegments` (`:121`) and `ciSuiteRefusal` (`:188`, replacing `withoutQuotes(command).split(...)`). The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **No second tokenizer, and not the `QUOTED` regex.** The regex does not read a backslash outside quotes. For `cat it\'s; plot-deliver.sh x; cat 'y'` it matches `'s; plot-deliver.sh x; cat '` as one span, and a split on that blanked copy would pass a command that runs `plot-deliver.sh`. `readShell` reads `it\'s` as one word.
- **Segment words stay a whitespace split of the original text, quotes kept.** Using `ShellWord.raw` as the words makes `"plot-deliver.sh x"` one word whose basename names no script, so `bash -c "plot-deliver.sh x"` would stop reading as a run. That loosens the gate. The `Done when` row for it exists to catch exactly this.
- **`readShell` returning `null` falls back to the plain `text.split(separator)`.** Unterminated quote, `case`, `;;` and function definitions are unreadable. The fallback over-splits, so an unreadable command keeps today's answer and the gate never loosens on it.
- **`withoutQuotes` stays exported and unchanged.** It keeps eight callers (`controller-gate.ts:273`, `role-gate.ts:65/76/99/135`, `main-checkout-write.ts:322/420/507`) and its own test. They share the backslash gap and this plan does not touch them.
- **The issue's table is a confounded measurement.** Its "passes" came from the main checkout holding `.plot/state/action-receipts/approve` and `dispatch`; the gate clears a named action that has a receipt (`gate.ts:1056`). In that checkout the unquoted `true && plot-approve.sh x` also exits 0. Measure in a scratch repository with an empty `.plot/state/`, or the before/after proves nothing.
- **`ciSuiteRefusal` moves in this slice.** Jan Wloka decided this in session on 2026-11-17; it is not a separate plan.
- Unchanged by design: an unquoted separator splits as before; an unquoted heredoc body stays tokenised; a gated name in a non-reader's argument (`echo "x plot-deliver.sh"`) is still a run; `isProcessRead` and the `gate.ts` entry, bundle and receipt check do not change.

### Done when

The plan's `## Done when` table is the specification. Assertions that exist because a naive implementation passes without them:

- `bash -c "plot-deliver.sh x"` is `'deliver'`: catches the `ShellWord.raw` shortcut above.
- `cat it\'s; plot-deliver.sh x; cat 'y'` is `'deliver'` and `ciSuiteRefusal("cat it\\'s; pnpm run test:e2e; cat 'y'", …)` is `{ suite }`: catch a split that still reads the escaped quote as a span.
- `case x in a) plot-deliver.sh y;; esac` is `'deliver'`: catches a missing `null` fallback.
- `for f in plot-deliver.sh; do grep "a\|b" $f; done` is `null`, while `a | plot-deliver.sh x`, `cat x | plot-dispatch.sh y` and `true && plot-approve.sh x` stay refused: catch a fix that loosens everything.
- The bundle test in `test/reconcile/controller-gate.test.mjs` runs in a sandbox with no action receipt. With a receipt present it passes for the wrong reason.

Plus: the changeset `.changeset/a-quoted-separator-splits-nothing.md` for `plot` (`patch`), description first and the `bumps:` block last with `plot: patch`; run `./scripts/check-changeset-packages.sh`. No shell is touched, so `scripts/check-shell-lines.sh` has nothing to pay. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` too: the root typecheck skips the domain package. New functions are arrows, and the TSDoc states what the helper returns and how it fails, with no history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ci-suite.ts`, `packages/domain/test/ci-suite.test.ts` (three new `describe` blocks), `test/reconcile/controller-gate.test.mjs` (one bundle test) and the changeset. No other plan names this branch or these files. Verified at dispatch on 2026-11-17: no open PR touches `ci-suite.ts`. Do not edit `controller-gate.ts`, `role-gate.ts` or `main-checkout-write.ts`, and do not commit a rebuilt board bundle.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

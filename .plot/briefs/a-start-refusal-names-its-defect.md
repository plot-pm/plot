## Implementation brief — a-refused-start-is-retried-and-named (wave 3: Start refusal)

- **Plan (canonical):** `docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3614 merged
- **Branch:** `bug/a-start-refusal-names-its-defect` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Waves 1 (`bug/the-brief-ask-test-owns-its-clock`, #3620) and 2 (`bug/a-refused-brief-is-asked-again`, #3649) are merged. Waves 4 (`bug/the-probe-and-the-loop-name-the-charter-prompt`) and 5 (`bug/a-red-pr-is-re-run-once-per-head`) wait on this branch: wave 4 edits `start-command.ts` and builds on the `defect` word.

### What to build

`plot-dispatch.sh --start` prints `worker=no-loop` and the hint `A branch dispatch (--restart <branch>) starts a worker on any command.` for every `refused` answer of `startCommand` (#3141). Only the not-the-loop refusal has that defect and that repair. The charter refusal and the absent-prompt refusal print the same footer and a hint that repairs neither. The slice makes the refusal carry its own word, `no-loop`, `charter-refused` or `prompt-absent`, from the rule to the footer, and prints the `--restart` hint for `no-loop` only.

Two defects ride along, both in the same rule:

- `if (runner !== 'command') return null;` (`packages/domain/src/rules/start-command.ts:97`) runs before the `refused` check (`:98`). A refused charter on `Agent runner: sdk` therefore passes `--start`, a desk is cut, and the worker loop refuses later (`worker-loop.ts` refuses a refused charter on either runner). The charter check moves before the runner gate.
- The board entry (`packages/board/src/server/entry/start-command.ts`) says "It reads stdin, spawns nothing and opens nothing" (`:34`), yet it reads the charter with `readFileSync` (`:60`) and the prompt file with `existsSync` (`:90`). Its `readNamedCharter` (`:56`) is a copy of `read` in `packages/fleet/src/server/entry/prompt.ts:58`. The entry calls `read` instead, and its header states what it reads.

The plan's `### Approach › Start refusal` section is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The rule carries the word; the shell does not infer it.** `StartCommand`'s `refused` arm gains `defect: 'no-loop' | 'charter-refused' | 'prompt-absent'`. The not-the-loop arm answers `no-loop`, the charter refusal `charter-refused`, the absent file `prompt-absent`. Parsing the defect from `why` in shell was the obvious shortcut and it fails: `why` for a charter refusal is the charter's own text, so a match would key on prose that changes with the charter.

**The charter refusal comes first.** `missingPrompt` checks `resolution.resolve === 'refused'` before the runner gate. The `@param prompt` doc states that order. The `sdk` runner is still never refused for an absent file, only for a refused charter.

**The entry carries the word on its first line, and the repair stays whole.** The refused answer changes from `${why}\n${repair}\n` to `${defect}\t${why}\n${repair}\n`, exit 3 as today. Everything after the first newline is the repair, so `start_cmd_repair` reads as today. `read` answers `unnamed` for `''`, and `readCharter('', null)` returns `unnamed` too (`packages/domain/src/entities/charter.ts:217`), so the switch to `read` keeps every resolution. An unreadable charter file reads `unreadable` through the shared reader, and a test pins that.

**The shell reads the word and removes one line net.** In `ask_start_command` (`skills/plot/scripts/plot-dispatch.sh`, the `3:*)` case, now at about `:1010-1014`), `start_cmd_defect=""` joins the reset above it, and the two lines `start_cmd_verb=refused` and `start_cmd_why=${answer%%$'\n'*}` become one that also strips the defect: `3:*) start_cmd_verb=refused start_cmd_defect=${answer%%$'\t'*}; answer=${answer#*$'\t'}` followed by the existing `start_cmd_why` and `start_cmd_repair` lines unchanged. In the `refused)` branch (now at about `:2120-2127`) the footer prints `worker=${start_cmd_defect}`, and the hint line becomes `[ "$start_cmd_defect" != no-loop ] || echo "  A branch dispatch (--restart <branch>) starts a worker on any command." >&2`, one line for one line. Line numbers moved since the plan was written; find the blocks by their content. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: this slice adds no net line, and the gate counts commands, not lines, so joining statements with `;` or `&&` is not a payment. The gate stores no number and has no override.

**The performer reads every word.** `packages/domain/src/adapters/performer/performer-shell.ts:112` matches `worker=no-loop` only. It matches `worker=(no-loop|charter-refused|prompt-absent)` and still answers `unaskable` for each. Missing this leaves the footer word unread: a charter refusal would then fall through to a generic failure and the board would show a different reason than the shell printed.

**Do not touch the probe or the loop's own repair text.** `promptAbsentRepair`, the write probe's per-agent prompt resolution and the loop's absent-prompt message belong to wave 4. Do not extract the repair text here.

Rules carried over unchanged from related work: the word is a fact the rule decides and the shell only reads it (absent is not false: a bundle that answers neither a verb nor a defect stays `unaskable`, starts nothing, and is never read as `no-loop`). A refusal ends the action; nothing retries it.

### Done when

The plan's `### Approach › Start refusal` tests are the specification:

- `packages/domain/test/start-command.test.ts`: one cell per `defect`, and a refused charter on the `sdk` runner refuses with `charter-refused`. That cell catches an implementation that adds the word and leaves the runner gate first.
- `packages/board/test/unit/start-command-entry.test.ts`: the refused answer's first line is `<defect>\t<why>`, and an unreadable charter file reads `unreadable` through the shared reader. The second catches a copied reader that drifted.
- `packages/domain/test/performer-shell.test.ts`: each footer word reads `unaskable`.
- `test/reconcile/dispatch.test.mjs`: an absent prompt prints `worker=prompt-absent` and no `--restart` hint; the not-the-loop refusal prints `worker=no-loop` with the hint. The hint-absent assertion catches a footer that changed and a hint that did not.

Plus: write a changeset with the description first and the `bumps:` block last (`'plot': patch` and the skills whose files change; `scripts/check-changeset-packages.sh` refuses a bare comment opener as the description). Commit no board bundle: build with `pnpm build:board` only to test locally and restore generated paths before you push (`scripts/check-no-bundle-diff.sh`). A function you write is an arrow. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/start-command.ts`, `packages/domain/src/adapters/performer/performer-shell.ts`, `packages/board/src/server/entry/start-command.ts`, `skills/plot/scripts/plot-dispatch.sh` (the two blocks above only), their tests, and a changeset.

In flight: no other branch of this plan is on origin yet. `bug/the-probe-and-the-loop-name-the-charter-prompt` (wave 4) edits `start-command.ts`, `write-probe-shell.ts`, `registryd-main.ts` and `worker-loop.ts`, and starts after this merges. `bug/a-red-pr-is-re-run-once-per-head` (wave 5) edits the fixer files only. No collision.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

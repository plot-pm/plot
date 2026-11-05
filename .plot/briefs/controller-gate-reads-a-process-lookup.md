## Implementation brief — controller-gate-refuses-read-only-commands

- **Plan (canonical):** docs/plans/2026-11-04-controller-gate-refuses-read-only-commands.md on main
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3135 merged
- **Branch:** `feature/controller-gate-reads-a-process-lookup` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (`Review: pr` in the plan's Status block)

Single-slice plan — one branch, no waves to sequence against.

### What to build

The controller gate (`packages/domain/src/rules/ci-suite.ts`) refuses a
process-table read — `pgrep`, `ps`, `lsof` — that names a gated script or
bundle, even though the command runs nothing. Issue #2530's reported case:

```
while pgrep -f "plot-approve.mjs the-pulse-s-tracer-flag-means" >/dev/null; do /bin/sleep 15; done
```

This waits for a bundle to exit; it never runs `plot-approve.mjs`. Today it
is refused with `plot-approve.sh is a controller-owned action`, forcing a
manual name-split workaround or an unowned-action receipt for an action
that never happened.

Add one predicate, `isProcessRead(words)`, to `ci-suite.ts`, and wire it
into `isReader` (`ci-suite.ts:74`) so every caller — `isReadSegment`
(`:359`), `withoutDataLists` (`:111`'s loop body), `controllerHttpAction`
(`:253`) and the merge path (`unpinnedMerges` / `mergeCall` in
`controller-gate.ts:247`, through `isReadSegment`) — sees one answer.

### Decisions the plan settles — do not re-derive them

**The predicate goes in `isReader`, not a new parallel check.** `isReader`
today is `READERS.has(name) || (git reader)`
(`ci-suite.ts:74-78`, `READERS` = `cmp, diff, cat, ls, grep, head, tail,
wc, shasum, sha256sum, stat, test, [`). Extend its return to
`READERS.has(name) || (git reader) || isProcessRead(words)`. Putting it
anywhere else (e.g. only in `controllerInvocation`) would miss the loop-body
and merge paths, which is exactly the gap #2706 closed for `grep` the same
way — same shape, same reason.

**Read the segment with `readShell` (`shell-reading.ts:92`), never a
whitespace split.** `controllerInvocation`'s existing word-splitting
(`words.split(/\s+/)`-style) keeps literal quote characters, so
`wordBasename` strips only the opening `"` of `"plot-approve.mjs` and
`scriptNamed` reads a run. That bug is why adding `pgrep` to `READERS`
alone fixes nothing — verified: `READERS.has('pgrep')` would still see
`"plot-approve.mjs` (with the stray quote) as the operand and `scriptNamed`
would still match it. `isProcessRead` must independently call
`readShell(joined)` and require: a reading that is not `null`, exactly one
simple command, no heredoc. A pattern that puts `|`, `;` or `&&` inside
quotes is unreadable by the segment-split at `ci-suite.ts:225` (which cuts
the command before quotes are parsed) — treat anything `readShell` cannot
parse as a run, fail-closed.

**`while`/`until` only, one leading keyword.** After at most one leading
`while` or `until` word, the next word's basename must be `pgrep`, `ps` or
`lsof`. `if`, `elif`, `!` are explicitly NOT admitted — the caller measured
only the `while`/`until` form, and `until ! pgrep -f "plot-deliver.mjs x"; do
sleep 1; done` must stay `'deliver'` (fail-closed on the untested case, not
an oversight).

**Signal forms on `pgrep` still refuse.** `--signal`, `--signal=…`,
`-<digits>`, or `-` followed by two-or-more capital letters (`-KILL`,
`-SIGTERM`) all keep the command a run — `pgrep -KILL -f plot-approve.mjs`
stays `'approve'`. Single capital-letter flags (`-F`, `-G`, `-P`, `-U`) are
ordinary `pgrep` options and must pass as reads. This distinguishes "find
and act on PIDs" from "just look".

**No substitution, no assignment prefix — same guards `isReadSegment`
already has.** `pgrep -f "$(plot-approve.mjs x)"` and `X=1 pgrep -f
plot-approve.mjs` both stay runs. `isProcessRead` itself only needs to
reject `executes: true` words (the `$()`/backtick/`${}`/`$'...'` forms);
the assignment-prefix and `env`-prefix stripping are already handled
upstream by `programWords` before `isReader` sees the words, so do not
duplicate that logic inside `isProcessRead`.

**The pipe rule is shared, not duplicated.** `controllerInvocation`
(`:224`) and `controllerHttpAction` (`:253`) already split on `&&`, `||`,
`;`, newlines, then each list on `|` into segments. A segment
`isProcessRead` admits counts as a read only when *every other segment of
its own pipeline* also passes `isReadSegment` — otherwise the whole
pipeline's words still go through `scriptNamed` as today. Factor this as
one helper both functions call, so the splitting logic is written once.
This is what keeps `pgrep -f plot-approve.mjs | xargs kill` refused
(`'approve'`) while `ps aux | grep plot-approve.mjs` stays `null` (already
true today — `grep` is already a reader, this is a regression check, not a
new behaviour).

**Explicitly out of scope — do not widen past what's measured:**
- `sed`, `rg`, `awk` stay refused (#2706's panel decision, unanimous,
  unrelated to this plan — do not touch `READERS`).
- `pkill`, `kill`, `pkill -0` stay runs (they signal, not read).
- A gated name inside another program's embedded script (`awk
  'BEGIN{system("plot-approve.sh x")}'`) stays a run, reading `null` as a
  refusal today — filed as #3145, not this plan.
- The `GIT_RUN_OPTIONS` guard (`ci-suite.ts:352`) on `withoutDataLists`'
  loop-body path is a separate known gap — filed as #3146, not this
  plan's scope.

### Done when

The plan's `## Done when` is its test tables — reproduce both exactly,
they are the specification:

**`packages/domain/test/ci-suite.test.ts`** (`controllerInvocation(cmd)`),
new `describe` block `a process-table read is a read (#2530)`:

Fails-before / passes-after:
- `while pgrep -f "plot-approve.mjs the-x" >/dev/null; do /bin/sleep 15; done` → `null`
- `pgrep -f "plot-approve.mjs the-x"` → `null`
- `ps -o pid= -C plot-deliver.mjs` → `null`
- `lsof -c plot-deliver.mjs` → `null`

Holds before and after (regression rows — each catches a specific
over-widening):
- `ps aux | grep plot-approve.mjs` → `null` (already true; `grep` is already a reader)
- `pkill -f plot-approve.mjs` → `'approve'`
- `pgrep -f plot-approve.mjs | xargs kill` → `'approve'` — catches a missing pipe rule
- `pgrep -f "plot-approve.mjs|plot-deliver.mjs"` → `'approve'` — catches reading quotes by naive split instead of `readShell`
- `until ! pgrep -f "plot-deliver.mjs x"; do sleep 1; done` → `'deliver'` — catches admitting `!`
- `pgrep -KILL -f plot-approve.mjs` → `'approve'` — catches missing signal-form guard
- `X=1 pgrep -f plot-approve.mjs` → `'approve'` — catches missing assignment guard
- `pgrep -f "$(plot-approve.mjs x)"` → `'approve'` — catches missing substitution guard
- `for f in plot-approve.sh; do sed "1e $f slug" /dev/null; done` → `'approve'` — existing #1341 table row, must stay unchanged
- `for f in plot-approve.mjs; do pgrep -f "$f" | xargs kill; done` → `'approve'` — loop body is not all-reads
- `unpinnedMerges('while pgrep -f "gh pr merge 12" >/dev/null; do sleep 1; done')` → `[]` — merge path sees the same answer

`ci-suite.test.ts:287-291` (`sed`/`awk`/`rg` stay `'dispatch'`) must be
byte-for-byte unchanged — a passing diff there with no edits is the
correctness check for "did not touch `READERS`".

**`test/reconcile/controller-gate.test.mjs`**, one new hook case beside
`:841` (next to the existing `sed stays refused` case):
`run(repo(), 'while pgrep -f "plot-approve.mjs x" >/dev/null; do sleep 1; done').status`
is `2` before this change, `0` after. `repo()` builds a main checkout so
the hook actually fires — this is the one case that exercises the real
gate, not just the pure function. **Build the board artifact first**:
`pnpm build:board`, run the test, then restore the generated paths before
pushing (`git checkout -- <bundle paths>` or equivalent) — the repo's
standing rule that no PR carries a committed bundle diff.
`:841-847` (`sed` stays refused) stays unchanged.

**TSDoc:** update the reader-list prose in `withoutDataLists`'s TSDoc
(`ci-suite.ts:96-99`) and `controllerInvocation`'s TSDoc (`:197-205`) to
name the process-table read and the pipe rule — factual statement of what
the function now does, not narration of why (see CLAUDE.md's TSDoc rule:
say what, not the history of the decision).

**Changeset:** `.changeset/<name>.md`, package `plot`, description first
line, `plan:` pointing at this plan and `bumps:` block last (order is
load-bearing — changesets publishes whatever is first).

**Local checks**, run `node ../plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — do not run a named full suite.
It will print at minimum: `pnpm --filter @plot-pm/domain exec vitest
related --run <changed>`, `pnpm --filter @plot-pm/domain exec tsc --noEmit
-p .`, `node --test test/reconcile/controller-gate.test.mjs`, the gate
tests, and the `scripts/check-*.sh` list including
`./scripts/check-changeset-packages.sh` and
`./scripts/check-no-bundle-diff.sh`.

No `.sh` file changes in this slice, so `scripts/check-shell-lines.sh`
does not move and needs no shell-line payment. No board `.tsx`/type
changes, so `pnpm run typecheck` is not required by this slice.

### Bookkeeping

Open the PR through the controller once the branch has its first real
commit:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to
this branch's line under the plan's `## Slices` section (`###
Process-table read`), and push the first real commit as soon as it exists
rather than batching.

### Scope guard

This slice owns:
- `packages/domain/src/rules/ci-suite.ts` (`isProcessRead`, the `isReader`
  wiring, the shared pipe-rule helper used by both `controllerInvocation`
  and `controllerHttpAction`, two TSDoc blocks)
- `packages/domain/test/ci-suite.test.ts` (new describe block + two
  `#1341`-table rows)
- `test/reconcile/controller-gate.test.mjs` (one new hook case beside `:841`)
- `.changeset/<name>.md`

It is the plan's only branch — no sibling branches, no wave ordering to
check, no collision surface beyond whatever else happens to touch
`ci-suite.ts` concurrently (none known at plan approval time).

If you find something the plan did not anticipate, report it rather than
improvising outside scope — in particular, do not fold in #3145 or #3146
(embedded-script reads, the `GIT_RUN_OPTIONS` loop-body gap): both are
explicitly filed as separate, out of scope here.

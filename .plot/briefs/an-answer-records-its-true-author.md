## Implementation brief — a-desk-s-design-question-waits (wave 2: The record names its author)

- **Plan (canonical):** docs/plans/2026-11-03-a-desk-s-design-question-waits.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3067 merged
- **Branch:** `bug/an-answer-records-its-true-author` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required since 2026-10-15)

This branch is wave 2 of the plan's three-wave slice. Wave 1 (`feature/fleetd-starts-the-unblocker`, → #3084) must merge first — it is what makes an `author: 'unblocker'` row exist in production at all. Wave 3 (`feature/an-escalated-question-reaches-the-issue`) depends on this wave's `escalated <reason>` outcome existing, which wave 1 already writes; it does not depend on this wave's author fix.

### What to build

Today every `answered` row in `.plot/state/answers.tsv` that went through `continue` records `author: 'unblocker'` regardless of who actually answered — `continuation.ts:1502` writes `author: input.author ?? 'unblocker'`, and **no caller passes `author` today**: the board's `POST /api/continue` route (`packages/board/src/server/continue.ts:178-188`) reads `branch`, `answer` and `questionKey` from the request body and never reads `author`; `plot-continue-command.ts`'s `run()` (`packages/fleet/src/server/entry/continue-command.ts:69-107`) parses `argv` as `[branch, answer, questionKey]` with no flag for who is answering. So a person's answer and the master agent's answer are both recorded as the unblocker's — this plan's Motivation measured that on `origin/main`.

Three changes land the fix, all downstream of `continueOnDesk`'s existing `author?: string` field (`continuation.ts:436`) and `continueBranch`'s existing pass-through (`continue-command.ts:66,110`) — neither of those needs to change:

1. **The default moves.** `continuation.ts:1502`: `author: input.author ?? 'unblocker'` becomes `author: input.author ?? 'unknown'`. A call that names no author is now `unknown`, not a false claim of unblocker authorship.
2. **The board route reads and forwards it.** `continue.ts` reads `body.author` the same way it reads `body.questionKey` (string-typed, `undefined` otherwise) and passes it into the `continueBranch` call at line 178. The caller is a browser hitting a same-origin route, so the request names the signed-in operator's handle; decide where that handle comes from (session, a fixed config value, or the request body as today's `questionKey` pattern does) — the plan does not settle this, and it is the one real design choice in this slice.
3. **The CLI takes `--who`.** `plot-continue-command.ts`'s `run()` parses an optional `--who <handle>` out of `argv` before the positional `[branch, answer, questionKey]` triple (or after — pick one and update `USAGE` and the module doc comment at lines 14-18, 31 to match). `--who`'s value becomes `author` on the `continueBranch` call at line 97-107. No `--who` keeps today's behaviour of naming no author, which after change 1 means `unknown`, not `unblocker`.

### Decisions the plan settles — do not re-derive them

**The author field and its plumbing already exist; this slice is wiring, not a new mechanism.** `AnswerRecord.author` (`packages/domain/src/ports/answer-record.ts:14`), `continueOnDesk`'s `input.author`, and `continueBranch`'s `author` parameter are all already typed and threaded through to `continuation.ts:1502`. Grep for `author` in `continuation.ts` before adding a new parameter anywhere — the only line that changes in that file is the default.

**`unblocker` is only written by the role start itself, never by a caller leaving the field blank.** Wave 1 (#3084) is what makes `UnblockPorts.run` call `continueOnDesk` with `author: 'unblocker'` explicitly, as a real caller identity — not as this field's fallback. After this slice, the fallback for "nobody said" is `unknown`, and `unblocker` only appears where the unblocker itself is the caller. If wave 1 hasn't merged yet when you start, its caller passing `author: 'unblocker'` explicitly is wave 1's concern, not this one's — do not add that call here.

**`already-answered` is a new refusal, not an existing one you're miswiring.** `ContinueRefusal` (`continuation.ts:99-182`) has no `already-answered` member today — confirmed by reading the full union. Add it there with a doc comment in the same style as its neighbours (see `question-moved` for the shape: what triggers it, why it's checked before any write). `AnswerRecordStore.rowsFor(worktree, askedAt)` (`answer-record.ts:58`) already answers "every row for this question" — use it, not a new store method. The check belongs in `continueOnDesk`, checked at the same point `question-moved` is checked (before the lock, before any write) rather than after the lock is taken: a caller racing to answer an already-answered question should get a no-trace refusal, the same contract every refusal above the lock already keeps. `isAnswered` naming in this codebase is `PortResult`'s own domain-generic predicate (`port-result.ts:49`, "did the read succeed") — do not reuse that name for "does this question already have an answered row"; name the new domain check something that doesn't collide (e.g. `hasAnsweredRow` or similar), since a reader grepping `isAnswered` should find only the port-result predicate.

**A second answer on a key that already holds an `answered` row refuses; `started` does not count as already-answered.** The plan's test (Slice 2 / Tests section): "A second `continue` on a key that holds an `answered` row refuses `already-answered` and appends nothing. On `origin/main` it appends a second row." The motivating defect (Motivation, point 4) is rows 1447 and 1483 sharing one key — both `answered`. A `started` row with no following `answered`/`failed`/etc. is an in-flight or abandoned attempt, not a settled answer, so it must not block a retry the same way.

### Done when

The plan's `## Done when` is the Tests subsection under Slice 2:

- A `continue` with no author writes `author=unknown`. On `origin/main` it writes `unblocker`. — catches a silent revert of the default-value change.
- `plot-continue-command.mjs --who jwloka` and the board route with `author: "jwloka"` write `author=jwloka`. — catches a flag/field that's parsed but never threaded to the `append` call.
- A second `continue` on a key that holds an `answered` row refuses `already-answered` and appends nothing. On `origin/main` it appends a second row. — catches a refusal that's checked after the lock/write instead of before, which would still show the no-trace contract broken (a partial write before the refusal fires).

Plus: a changeset (`plot` package, patch — wording/behavior fix, no new section), and `scripts/check-bundle-resolution.sh`/`check-no-bundle-diff.sh`-class gates since `continue-command.mjs` under `skills/plot/scripts/board/` is a generated bundle — never hand-edit it; rebuild via the repo's board-build step and never commit source changes without the matching rebuild (or let CI/main's own rebuild handle it per the Testing section's bundle-conflict rule).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps changed paths (`packages/fleet/**`, `packages/domain/**`) to their related-test and typecheck commands. Do not run the full `test:e2e` or `test:board` suites as a matter of course; `plot-local-checks.mjs` tells you what this diff actually needs.

Name the shell gate: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is TypeScript plus a regenerated bundle, not new `.sh`, so it should cost nothing here — but if `plot-continue-command.mjs`'s regeneration happens to touch a `.sh` launcher, the growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # on this branch
```

It reads this plan, takes the wave heading ("The record names its author") as the PR title, and writes the plan + brief into the body. Do not run `gh pr create` by hand.

**The moment the PR is created**, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the line currently reading `- \`bug/an-answer-records-its-true-author\` — ... <!-- builds: answer author, already-answered refusal -->`), and set the PR to "Ready" on the project board if one is configured in `## Plot Config` (none is declared in this repo's config today, so this step is a no-op here).

### Scope guard

This branch owns:
- `packages/fleet/src/shared/continuation.ts` — the default-value line and the new `already-answered` refusal (plus its `ContinueRefusal` union member and doc comment)
- `packages/fleet/src/shared/continue-command.ts` — no change expected; it already threads `author` through
- `packages/board/src/server/continue.ts` — reading `body.author`
- `packages/fleet/src/server/entry/continue-command.ts` — parsing `--who`
- the generated bundle `skills/plot/scripts/board/plot-continue-command.mjs` (rebuild, never hand-edit)
- `packages/domain/src/ports/answer-record.ts` — only if the `already-answered` check needs a new port method beyond `rowsFor`/`rowsForDesk` (it should not; both already exist)
- associated test files under `packages/fleet/test/unit/` and `packages/domain/test/`

Other branches in flight, verified via `git worktree list` and `.claude/worktrees/` at dispatch time: `fix/pr-3084-unblocker` (worktree `agent-a2fefc147f4fc1856`) is actively fixing wave 1's PR #3084 — it may touch `continuation.ts` or `UnblockPorts.run`'s call into `continueOnDesk`. If both branches touch the same lines in `continuation.ts` near the `author` default, expect a rebase, not a design conflict: wave 1 adds a caller that passes `author: 'unblocker'` explicitly; this branch changes what happens when nobody passes one at all. A second worktree, `agent-acb1353d5f14ab745` (branch `merge-3087`), is an in-progress merge and unrelated to this slice's files.

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular, the one decision the plan leaves open (where the board route's `author` value comes from) should be resolved and named in the PR description, not silently picked.

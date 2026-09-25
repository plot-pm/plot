## Implementation brief — the-parser-reads-an-assignee-wherever-it-is (slice: The assignee is read in Status too)

- **Plan (canonical):** `docs/plans/2026-09-24-the-parser-reads-an-assignee-wherever-it-is.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-assignee-is-read-in-status-too` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention

The plan has one slice. Nothing waits on this branch, and it waits on nothing.

### What to build

`skills/plot/scripts/plot-plan-meta.sh` reads `Assignee:` only inside the `section == "approval"` block (`:861-865`). Both plan templates (`.plot/templates/plan.md`, `skills/plot/templates/plan.md`) offer `## Status` and neither offers `## Approval`. Re-measured at dispatch on 2026-09-25: 115 plans carry `- **Assignee:** <value>`, the parser reports 71 of 332, and **all 44 dropped lines sit under `## Status`** — no other section is involved.

The fix: the `section == "status"` block (`:816-860`) also reads `assignee`, with the same regex the approval block uses. Add contract tests. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Widen the section, keep the regex byte-for-byte.** The plan says "as a list item". The existing anchor is `^[ \t]*[-*]?[ \t]*\**assignee[:*]` — the bullet is OPTIONAL, and every other Status field uses the same shape. `test/reconcile/fixtures/plans/canonical-plain-fields.md` pins the no-bullet form for the other fields. Do not tighten the anchor to require `-`: that makes `assignee` the one field with a different grammar. The anchor already stops prose, because it matches only at the start of a line.

**Approval outranks Status when a plan writes both.** The plan does not settle this, and the estate has two such plans. They disagree:

| plan | `## Status` | `## Approval` | parses today |
|---|---|---|---|
| `2026-08-20-a-mock-row-shows-what-the-tuple-still-gets-wrong.md` | `jwloka` | `Jan Wloka` | `Jan Wloka` |
| `2026-08-21-a-wave-is-one-branch.md` | `jwloka` | `Jan Wloka` | `Jan Wloka` |

A shared `canon_assignee` slot with first-wins would take the Status line, because Status comes first, and change both answers. **The fix must add 44 values and change 0.** So give Status its own slot (for example `status_assignee`) and fall back to it in `emit_record` (`:480`) only when `canon_assignee` is empty. Front matter still outranks both. Which spelling is correct is the sibling plan's question (`the-board-shows-me-only-my-work`). This slice must not answer it by accident of line order.

**The fence case is already safe; its test is a lock, not a fix.** Fence markers are consumed at `:727-728`, before any section block runs. A fenced `- **Assignee:** x` under `## Status` therefore parses as `""` today and must still do so after the fix. Write that test anyway, because the plan names it. Expect it to pass before your change, too.

**The estate-wide count is differential, not a literal 115.** `parser.test.mjs:1411-1425` records why: a test asserting a number fails a correct implementation when the next plan lands. Compute the grep side in the test (`^- \*\*Assignee:\*\* *\S`, outside fences, in any section), parse the same files, and assert that the two SETS of files are equal. On a failure, name the file. Today the expected result is 115 = 115. Three further files mention `Assignee:` in prose. The grep pattern excludes them, and the parser must too.

**Placeholders count as absent.** `strip_placeholder` already runs over the chosen value in `emit_record`. Keep the new slot on that same path, so that `- **Assignee:** <!-- handle -->` under Status reads `""`. See the comment at `:826-849` for the first-wins-over-a-placeholder bug this estate already had once.

### Done when

The plan's `## Done when` is the specification. The assertions that exist because a naive implementation passes without them:

- **Status-only plan → value.** A new fixture (for example `canonical-status-assignee.md`) goes into the `SPEC` table beside `canonical-story-fields.md`, which already pins the Approval case.
- **Both sections, disagreeing → the Approval value.** Without this, a shared first-wins slot passes every other test and silently changes two real plans.
- **Prose under Status** (`The Assignee: line is ...` in a paragraph) **→ `""`.**
- **Fenced example under Status → `""`.** This is a lock (see above).
- **Placeholder under Status → `""`.**
- **Estate sweep: parsed-assignee files == grep files**, compared as sets.

Plus the repo gates. Run `nvm use` first (Node 24; pnpm crashes on 26):

- `node --test test/reconcile/parser.test.mjs`, then `pnpm run test:contracts`
- `pnpm test`
- `pnpm run test:board` — the board reads `assignee` through `packages/domain/src/adapters/plan-store/plan-store-shell.ts:103` and renders it in `PlanCard.tsx`. After this change, 44 more cards show an assignee, and no board code changes.
- A changeset: `'plot': patch`, description first, `plan:` line and `bumps:` block last (`skills: plot: patch`). Check it with `./scripts/check-changeset-packages.sh`.
- Do not run `pnpm run test:e2e`. CI runs it.

The script's header comment (`:110-111`) says "from the `## Approval` `Assignee:` line". Update it so that it names both sections and the precedence.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not use `gh pr create`.
- When the PR exists, append `→ #<number>` to the plan heading's form: `### The assignee is read in Status too (Branch: bug/the-assignee-is-read-in-status-too, PR: #<number>)`. The plan uses the heading form of `## Slices`, which parses `PR:` inside the heading. A trailing arrow parses as `prs=[]`.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-plan-meta.sh` — the status block, `emit_record`'s assignee line, and the header comment. Nothing else in the file.
- `test/reconcile/parser.test.mjs` and new files under `test/reconcile/fixtures/plans/`
- one `.changeset/*.md`

Out of scope, per the plan: writing `Assignee:` into any template or plan, normalising `jwloka` / `Jan Wloka` / `eins78`, and the gating of any other field. Do not edit the two disagreeing plans to make them agree. That is a person's call about identity.

Verified at dispatch (2026-09-25): no remote branch other than `main` touches `plot-plan-meta.sh`, `parser.test.mjs` or `test/reconcile/fixtures/plans/`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

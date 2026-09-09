## Implementation brief — every-issue-renders-as-open-issue (wave 3: Rendering)

- **Plan (canonical):** `docs/plans/2026-09-09-every-issue-renders-as-open-issue.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #856 merged
- **Branch:** `feature/the-inbox-shows-a-real-status` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (Definition of Done, `docs/definition-of-done.md`)

Rendering is the plan's last wave and both its predecessors are merged: Reading (`feature/an-issue-carries-its-status`, #857) and Identity (`feature/an-issue-key-is-a-string`, #859) both landed on 2026-09-09 in `07640b3a9`. Nothing waits on this branch. **The collision warning in the plan's `## Slices` preamble is spent** — it named `plot-host.sh`'s `issue-list` Jira arm against plan #850, and that file belonged to the Reading slice. This branch does not touch `plot-host.sh`, so there is nothing to rebase around.

### What to build

Four Jira tickets in *Internal Approving*, *In Progress* and *Reviewing* all render `open` on the board. Twelve tickets render `open` twelve times. The status is not mis-mapped — it is a literal, written at `packages/board/src/app/lib/tuple-row.ts:1096`:

```ts
// `open`, and it is the only status an UNPLANNED issue has: the tracker
// reports open issues and this list is filtered to the ones no plan
// references. A closed one is not here to have a status.
status: 'open',
```

The fact now exists and does not reach that line. Reading put `status` and `statusCategory` on the wire and on the domain entity; this branch carries them the remaining three hops to the cell.

**Trace the gap before editing — it is wider than the literal.** Measured against `origin/main` at `07640b3a9`:

| hop | file | state today |
|---|---|---|
| the wire | `skills/plot/scripts/plot-host.sh:3151`, `:3172`, `:3242` | **emits both keys**, all three backends |
| the entity | `packages/domain/src/entities/issue.ts` | **carries both**, with the amended refusal |
| the server projection | `packages/board/src/server/fleet.ts:2258–2270`, `:2286–2300` | **drops them** — a hand-written literal reading four keys |
| the contract | `packages/board/src/contract/schema.ts:2972` (`IssueRowSchema`) | **has no such fields** |
| the cell | `packages/board/src/app/lib/tuple-row.ts:1087` (`tupleFromIssue`) | **the literal** |

So the work is: widen `IssueRowSchema`, carry the two fields through `refreshIssues`' `open[]` type and both object literals, and replace the literal with the issue's own status. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Two fields, not one, and neither substitutes for the other.** `status` is the tracker's own word — *Internal Approving* — which is per-workflow and may be localised; a board grouping on it fragments across projects. `statusCategory` is the stable three-value vocabulary (`To Do` / `In Progress` / `Done`) a board can group and colour on. **The name is what a person reads; the category is what the board decides on.** Do not collapse them, and do not render the category where the plan asks for the name.

**`statusCategory` is legitimately empty, and Reading already decided when.** `plot-host.sh:3225` maps Bitbucket `NEW`/`OPEN` → `To Do` and `RESOLVED`/`CLOSED` → `Done`, and gives `ON HOLD`, `INVALID`, `DUPLICATE` and `WONTFIX` the empty string **deliberately** — they are terminal-without-being-done, which is not a Jira category. The comment states the reason: filing a `WONTFIX` as `Done` puts abandoned work beside finished work. **So the renderer must have an answer for `''`**, and inventing one (`unknown`, `open`, falling back to the old literal) re-opens the question Reading closed. This retires the plan's third Open Question — it is answered on main, not still open.

**The entity's refusal is amended, not deleted, and it still binds you.** `entities/issue.ts` now says `status` and `statusCategory` are the narrow exception because the refusal's real subject is a write-back loop. `assignee`, `labels` and `priority` **stay refused**. Do not add a fourth field because it was cheap to reach.

**Identity is a string and is already fixed — do not re-coerce it.** `IssueRowSchema.number` is `z.union([z.string(), z.number()]).transform(String)`, `issueKey()` normalises both sides, and `fleet.ts:2287` filters through it. `Number(` anywhere on the issue path reproduces the original bug behind a satisfied type. If you touch that filter, you are outside this slice.

**Absent is not false, and empty is not failed.** `IssueAnswerSchema` keeps `answered` / `unsupported` / `failed` apart, and `an-outage-is-not-an-answer` is why. A status this branch cannot read is `''` on a row that still renders; it is never a reason to drop the row or to touch `issueAnswer`.

### Done when

The plan's `## Done when` list is the specification. Beyond it, these are the assertions that exist **because a naive implementation passes without them**:

- **A Jira row renders its own word, not `open`.** Feed an `IssueRow` carrying `status: 'Internal Approving'` and assert the rendered status cell says so. Without this, the whole branch can be a schema widening that changes no pixel.
- **A row whose `statusCategory` is `''` still renders.** The Bitbucket `WONTFIX` case. Catches the fallback an implementer adds to make an empty cell look tidy.
- **The existing `tuple-row.test.ts` suite passes unchanged — and that is not evidence.** Its `issue()` helper at line 44 builds a row from four keys and omits both new ones, so if you give the schema fields `.default('')` every current assertion stays green while the board still shows one word. **Add a case to that helper's callers rather than trusting the suite's colour.**
- **The `status: 'open'` justification comment is rewritten, not orphaned.** The comment at `tuple-row.ts:1093` argues why the literal is defensible. Deleting the literal and leaving the argument makes the next reader trust a sentence about code that is gone.
- **`statusTone` is checked against the new vocabulary.** It keys on the *word* (`tuple-row.ts:344`) and matches `conflicts|checks failing|failed|stalled` for rose. A Jira workflow word may collide — a status literally named *Failed* would now colour a tracker row as a fault. Decide it deliberately and say what you decided.

Plus the repo's gates: `nvm use` (Node 24 — `pnpm` crashes on 26), `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`, and **`pnpm build:board`** — the board artifact is generated and CI gates a no-diff check, so a payload change that skips the rebuild fails there. **Do not run `pnpm run test:e2e`**; it is CI's gate, not a local one. Add a changeset naming this plan (`'@plot-pm/board': patch`, description first, `bumps:` block last — the order is load-bearing, a `bumps:` block written first becomes the published release note).

### Bookkeeping

- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). **Not `gh pr create`** — it takes the title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section, under `### Rendering`.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns three files:

- `packages/board/src/contract/schema.ts` — `IssueRowSchema` only
- `packages/board/src/server/fleet.ts` — `refreshIssues`' projection only
- `packages/board/src/app/lib/tuple-row.ts` — `tupleFromIssue` only

plus their tests (`test/unit/tuple-row.test.ts`, `test/unit/unplanned-issues.test.ts`, `test/integration/tuple-row.browser.test.ts`) and the regenerated `skills/plot/scripts/board/board-server.mjs`.

**Do not touch** `skills/plot/scripts/plot-host.sh` or `packages/domain/src/entities/issue.ts` — both are Reading's, both are merged, and both already say what this branch consumes. On a conflict in `board-server.mjs`: it is generated output marked `-merge`, so do not read the diff — take either side, run `pnpm build:board`, commit the result.

Sibling work in flight, verified at dispatch: plan #850 (`jira-inbox-is-instance-wide-the`, Approved) holds `feature/adoption-proposes-the-ticket-prefixes` and `feature/the-jira-jql-scopes-by-project` — both in `plot-host.sh` and the adoption probe, neither in these three files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

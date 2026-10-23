## Implementation brief — only-my-work-waiting-on-you

- **Plan (canonical):** `docs/plans/2026-10-23-only-my-work-waiting-on-you.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2415 merged
- **Branch:** `bug/only-my-work-waiting-on-you` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one wave. Nothing waits on it and it waits on nothing.

### What to build

`ownedFromRow` (`packages/board/src/app/lib/agent-rows/mine-filter.ts:87`) answers `{ kind: 'pr', author }` for a row with a PR and `{ kind: 'other' }` for every other row. `isMine` reads `other` as unknown and shows the row to every reader. Reported on 2.28.0 (Bitbucket and Jira): three Draft plans on `idea/` branches name `Christian Kehl` as assignee, `People` maps `ckehl` to that name, the Planning cards resolve to `ckehl`, and the three Delivery rows stay under *Waiting on you* for `jwloka`. While the host answers 429 the row has no `pr`, so nothing on it names an owner.

The change has two halves:

1. **Server.** `AgentRowSchema` (`packages/board/src/contract/schema.ts:2507`) gains `assignee`, `author` and `approver`, each `z.string().default('')`. The server sets them where it creates the row, from the plan's meta: `assignee` is `meta.assignee`, `approver` is `approverOf(meta.approved_raw)`, as `board.ts:2342-2346` does for the card. Row creation sites in `packages/board/src/server/fleet.ts`: `:6053` (a branch under a plan — the one that matters), `:6431` (an idea-branch PR row, `planFile` often empty), `:6755` (a branch no plan names — leave the three fields empty).
2. **Client.** `ownedFromRow` returns `{ kind: 'plan', assignee, author, approver }` for a row with **no PR** and at least one non-empty field, and `{ kind: 'other' }` otherwise. A row with a PR keeps `{ kind: 'pr', author }`. Its parameter type widens from `Pick<AgentRow, 'pr'>` to `Pick<AgentRow, 'pr' | 'assignee' | 'author' | 'approver'>`; `rowsForReader`'s generic constraint widens the same way.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The server sets the fields; the client does not derive them from `planFile`.** `AgentRowSchema.sprint` (`schema.ts:2540-2560`) states why at length: a derivation in the renderer is a guess with a rule attached, and it goes wrong first on rows that have no plan. A row with no plan leaves all three fields empty.

**The domain rule needs no change.** `OwnedRow` already has the `plan` arm and `planOwnership` (`packages/domain/src/rules/ownership.ts`) already reads all three fields. Do not touch `ownership.ts`. A new `OwnedRow` kind would make two tables a compile error for no behaviour.

**Field order is not a question.** The plan's second open question asks which field wins. `planOwnership` maps each field to `mine`/`theirs`/`unknown` and returns `mine` if **any** resolves to the reader, so no order exists to encode. The plan's "assignee, author, approver" is only the order of the object literal. Record this in the plan's Open Questions when the PR lands; do not write an ordering rule.

**A PR keeps precedence.** A row with a PR stays `{ kind: 'pr' }`. Do not merge the two arms: the PR author is a host handle compared exactly, the plan fields are free text resolved through `People`, and `personFieldOwnership` is deliberately stricter about `theirs` (only a declared spelling).

**The branch name stays unconsulted.** `ownedFromRow`'s docstring says `feature/jw-something` looks like a claim and is not one. Keep that paragraph true and amend only the sentence saying a row without a PR names no owner — a row without a PR and without a plan owner still names none.

**Absent is not false.** The client casts the payload. A server from before this change delivers `undefined` for all three fields, and `''` means the plan names nobody. Both read as no owner, so the row stays visible, as today. `ownedFromRow` must pass the values through, not normalise them, as `ownedFromCard` does.

**The waiting-on-whom question is out of scope.** The plan's first open question (should a Draft plan wait on its approver) changes what *Waiting on you* means. Do not build it. If the reader decides otherwise, it is a new plan.

### Done when

The plan has no `## Done when` list, so the specification is the Approach and the Motivation's reported case. Assert each of these; each exists because a naive implementation passes without it.

- A row with no PR whose plan assignee resolves through `People` to another person is hidden from the reader with the filter on. This is the reported case. A test that only checks the `plan` kind is returned passes with the fields never wired through the server.
- The same row is **shown** to the reader the assignee resolves to. Catches an implementation that hides every planned row without a PR.
- A row with no PR and a plan naming nobody stays visible. Catches `plan` returned with three empty fields reading as `theirs`.
- A row with a PR whose author is another person is still hidden, and one whose author is the reader is still shown, whatever the plan fields say. Catches a merge of the two arms.
- A payload with the three fields `undefined` keeps the row visible. Catches a `.trim()` on an absent field in the client.
- A server-side test over the fleet row: the row built at `fleet.ts:6053` carries the plan's `assignee` and `approver`, and the row at `:6755` carries empty strings. Without it, the client half is proved against a fixture the server never produces. The *Mine* chip count and the *Waiting on you* section both read `rowsForReader`; assert one of them, not only the helper.

Plus: this touches `packages/board` and the payload schema, so run `pnpm build:board` only to test locally and restore generated bundles before pushing (`scripts/check-no-bundle-diff.sh`). Add a changeset for package `@plot-pm/board` — description first, `bumps:` block last. Write any new function as an arrow. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Do not run board tests while an operator's board is open on this machine.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Had it touched one, growth would be paid for in the same change.

### Bookkeeping

When the PR is created, append `→ #<number>` to the branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/contract/schema.ts` (the `AgentRow` fields only), `packages/board/src/server/fleet.ts` (the three row sites), `packages/board/src/app/lib/agent-rows/mine-filter.ts`, their tests, and one changeset.

**One adjacent gap, reported and not fixed here.** `AgentList.tsx:489` builds `draftRows` from `fleet.draftPlans`, and nothing at `:1123` filters them with `rowsForReader`. A **branchless** Draft plan therefore shows under *Waiting on you* to every reader whatever its assignee, because `DraftPlan` (`schema.ts:4112`) carries no ownership fields either. The reported rows had `idea/` branches and so are `AgentRow`s, which this slice fixes. If a branchless Draft plan with another person's assignee still shows after this slice, file it as a follow-up issue rather than widening this branch.

No other branch of this plan is in flight.

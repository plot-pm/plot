## Implementation brief — agent-rows-line-up, wave 1 (Data)

- **Plan (canonical):** `docs/plans/2026-08-17-agent-rows-line-up.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #162 merged (one interrogation round)
- **Branch:** `feature/pr-state-travels-as-a-field` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The PR's condition stops being prose and becomes a field. Today `AgentRow.pr`
carries `{ number, url }` and nothing else, and the row's state — `green`,
`no checks`, `draft` — exists **only inside a sentence the server writes**.

This wave adds the field and the mergeability behind it. It renders nothing new;
wave 2 does that. Resist the urge to also fix the row layout — that is a
separate branch, and both waves touch `fleet.ts` and `schema.ts`.

### Read this first

`packages/board/src/app/components/AgentList.tsx:766` — `Note`:

```ts
const marker = row.pr ? `PR #${row.pr.number}` : '';
const at = marker && row.pr?.url ? row.note.indexOf(marker) : -1;
```

That `indexOf` is a **parser for a format nobody declared**. It searches the
server's sentence for a marker the server happened to write, and silently
renders an unlinked note the moment the wording drifts. It goes away in wave 2 —
but understanding it is what explains why this wave exists.

### Four decisions the plan settles — do not re-derive them

**`draft` stays a separate field; it is NOT one of the states.**

```ts
pr: { number, url, draft: boolean,
      state: 'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' }
```

A draft has CI like anything else, and `draftNote()` already reads `pr.checks`
to write *"draft, CI running"*. Folding draft into the enum would destroy an
answer the code already produces — and worse, it would rebuild a known defect:
the story's WAITING ON A MACHINE finding named *"a draft PR could not reach it"*
as the first of three causes, because the classifier short-circuited every draft
before consulting the checks. A single-value state moves that short-circuit from
the classifier into the contract, where it is harder to see and shared by every
consumer.

**`conflicts` is a real state and the reason this wave exists.** Measured three
times now — PR #149, PR #160, and again while writing the plan: a conflicting PR
has `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`, and `statusCheckRollup`
genuinely **empty**, because GitHub does not start CI for a conflicting PR. The
board reports the symptom (`no checks`) and withholds the cause. The same three
words also mean *a workflow is waiting for a human to approve it*. One wants a
rebase; the other wants a click.

**`conflicts` outranks `none` where both hold.** It is the cause; the other is
its consequence. A row saying `no checks` on a conflicting PR is telling the
truth about the symptom and hiding the reason — the exact defect being removed.

**Unknown mergeability must not read as clean.** `plot-host.sh pr-list --rich`
gains `mergeable` from `gh`'s `mergeable,mergeStateStatus`. **Bitbucket has no
equivalent**, and the precedent is already set two lines away: its branch sets
`checks:"unknown"` rather than guessing. Absent is not false — the rule this
repo applies to every other missing signal.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A conflicting PR says `conflicts`, not `no checks`.** Assert against the
  live shape: `mergeable=CONFLICTING` with an empty check rollup.
- **A workflow awaiting human approval still says `no checks`.** The pairing
  that matters: one label for both is the defect, and renaming all of them to
  `conflicts` is the same defect mirrored.
- **Unknown mergeability is not reported as clean.** Assert the Bitbucket path —
  no mergeability field — falls back rather than claiming a state.
- **`draft` and the state are independent.** Assert a draft PR with CI running
  carries BOTH.
- **The note still says what a PR state cannot.** Assert *uncommitted work*,
  *blocked by an earlier wave* and *claimed elsewhere* survive untouched — the
  note is not being replaced, only relieved of one duty.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists** — this repo lost sight of finished work three times on one branch in a
single day because it was never pushed.

### Scope guard

`skills/plot/scripts/plot-host.sh` (the `pr-list --rich` field list),
`packages/board/src/contract/schema.ts` (the `pr` shape),
`packages/board/src/server/fleet.ts` (setting the field in `classify()`), and
their tests.

**Do NOT change the row's layout.** No grid, no badge, no icon — that is
`feature/agent-rows-line-up`, wave 2, which rebases onto you. Wave 2 also edits
`fleet.ts` and `schema.ts`, which is precisely why the two are sequential rather
than parallel: on 2026-08-17 two branches adding neighbouring fields to the same
objects cost four manual conflict resolutions in one hour, every one of them a
union with no real disagreement.

**One other branch may be in flight:** `feature/board-approve-affordance` work
has merged, but check `plot-dispatch.sh --status` before assuming you are alone
in `schema.ts`.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter. Expect it: every board merge
invalidates every open board branch's artifact.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

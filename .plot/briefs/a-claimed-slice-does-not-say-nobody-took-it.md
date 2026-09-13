# Implementation brief — a-claimed-slice-does-not-say-nobody-took-it

- **Plan (canonical):** `docs/plans/2026-09-13-a-claimed-slice-does-not-say-nobody-took-it.md` on `main`
- **Approved:** 2026-09-13, jwloka, in-session
- **Branch:** `bug/a-claimed-slice-does-not-say-nobody-took-it` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI gates plus a reviewer who knows the domain's arrow-function rule

The plan has ONE slice and one branch, so nothing waits on this and it waits on nothing. It is the sibling of [a-slice-shows-that-its-brief-was-asked-for](../../docs/plans/2026-09-12-a-slice-shows-that-its-brief-was-asked-for.md), which fixes the same sentence one state over: that one makes the row say *a brief is being written*, this one makes it say *somebody is on it*. Both replace a sentence that invites `/plot-dispatch` against work already in flight.

## What to build

A slice with a live agent on it stops reading *approved — nobody has taken it*. Measured by the operator on their own board, 2026-09-13: the slice `a-harness-this-machine-cannot-run-refuses` appeared in WORKING with its agent, its desk and its branch, and the **same line** ended *"eligible — nobody has taken it"*. It appeared again under NOT STARTED saying *"approved — nobody has taken it"*.

Asked directly while the agent was running, the payload contradicted itself:

```
row  kind=wave  verdict=eligible  startability=someone-is-on-it
AGENT branch=bug/a-harness-…  state=running
```

`startability` is right and the sentence does not read it. The fix makes the sentence read `startability` first, falling back to the wave verdict only where startability does not apply.

The plan is canonical; this is orientation.

## The decisions the plan settles — do not re-derive them

### The two fields disagree by construction, and `verdict.ts:56` is the proof

This is not a staleness bug and there is nothing to recompute. `startabilityVerdict` in `packages/domain/src/rules/verdict.ts` answers both questions in one function, in a fixed order:

```
:56   if (state === 'wip' || state === 'claimed') return 'someone-is-on-it';
:63   if (verdict !== 'eligible') return null;
```

A claimed branch returns at line 56 and **never reaches** the slice-verdict gate at 63. So `verdict: 'eligible'` and `startability: 'someone-is-on-it'` are not two readings of one fact that drifted — they are two different facts, computed together, that were always going to say this. `eligible` means *every prior slice has landed*, and a claim does not un-satisfy a prerequisite.

**Changing the verdict to follow claims is the worse repair, and the plan rejects it explicitly.** `--next` and the dispatcher both read the verdict as eligibility. A claimed slice reporting itself ineligible would change what the fleet starts.

### There is NO shared wording helper — the plan says there is, and it is wrong

The plan's Design says *"The fix is in the shared wording helper."* **Verify this before designing around it.** Measured on `origin/main` at 509808260, the sentence has two independent producers:

| where | what it is | which row shows it |
|---|---|---|
| `contract/schema.ts:1419` | `export const ELIGIBLE_NOTE` — server-composed, written onto the row as `note` at `fleet.ts:4248` | the branch row's note |
| `app/lib/agent-rows/rows.tsx:1069` | a **client-side string literal** in the slice-note chain | the slice head's note |

They are not one helper with two callers. They are two spellings of one sentence, which is exactly why they could disagree. Extracting a shared helper is a legitimate way to build this — but it is work the plan assumed was already done, so budget for it and say in the PR which shape you chose.

`AgentList.tsx` holds the phrase a third time as the NOT STARTED **section label** (`sections.ts:43`). That one is a heading, not a row note, and it is correct — leave it.

### The `soleRow` arm fires before line 1069, and that is the arm that actually fired

**Patching only line 1069 may fix nothing.** `AgentList.tsx:1886` supplies `soleRow` for every one-branch slice:

```tsx
soleRow={wg.rows.length > 1 ? undefined : wg.rows[0]}
```

and `rows.tsx:1065` takes that arm first:

```tsx
soleRow ? soleNote
  : (groupedCount !== undefined ? groupedNote(…) : '')
    || (group.verdict === 'eligible' ? 'approved — nobody has taken it' : …)
```

The operator's slice has one branch. So it reached line 1069 **only because `soleNote` was falsy** — `soleNote` is `noteWithoutPr(soleRow.note, soleRow.pr)`, and a claimed branch with no PR strips to `''`. That empty-string fallthrough is documented in the comment at `rows.tsx:1041-1049`, where it caused the PR #323 defect: *"Empty is falsy, so the chain fell through to a verdict sentence about starting work that had already been done."*

**So the claimed slice reaches the verdict arm by the same accident that bug was about.** Two consequences:

- A fix at 1069 alone is correct for the measured case but leaves the `soleNote` path free to say something else once the branch gains a PR. Decide deliberately whether startability outranks `soleNote` too, and say which in the PR.
- The fixture must reproduce the fallthrough — a one-branch slice, `startability: 'someone-is-on-it'`, **no PR** — or the test exercises a path the operator never hit.

### Read the FIELD, never the sentence — and a gate enforces this

`packages/board/test/unit/verdict-not-prose.test.ts` is a structural check over the source text. It fails any file that does `note.includes('nobody has taken it')`, `/nobody has taken it/.test(…)`, `=== ELIGIBLE_NOTE`, or the same shape with `.match`/`.startsWith`/`.endsWith`/`.indexOf`/`.search`.

It is an ally here, but only if you know it before reaching for a string comparison. The contract states the rule at `schema.ts:2199`: *nothing new may be built on matching prose*.

The positive form is the precedent at `row-identity.ts:81`: *"READS THE FIELD, not re-derives. `startability` is computed in `classify` from plan phase, branch state, slice verdict, and brief state — four facts that are only all in scope there."*

**`SliceGroup.rows` is `AgentRow[]`** (`slices.ts:145`), so `startability` is already in scope at line 1069 through `group.rows` — no prop threading, no new contract field, no server change. Verify that before adding one.

### Copy `stateStatus`'s gate shape — four verdicts, not truthiness

`app/lib/tuple-row.ts:1061` already made this exact move for slot 5 and states why the gate is what it is:

```ts
if (row.startability) {
  return startabilityWord(row.startability);
}
```

> *"The gate is the four actual verdicts, not truthy: a null from an older server, or a merged branch with no startability question, falls through and renders its git state as before."*

`startabilityWord` (`tuple-row.ts:1009`) already maps `'someone-is-on-it'` → `'someone is on it'`. The plan's proposed wording — *somebody is on it* — differs by one word from the phrase already shipping in slot 5. **Prefer the existing string** unless a sentence needs different grammar from a column word; two spellings of one state is the defect class this whole plan is about. Say which you chose and why.

### The contradiction is within ONE line, not between two rows

Worth knowing before you go hunting: slot 5 **already says** *someone is on it* for this row, because `stateStatus` reads the field. So on the WORKING line the operator saw, the correct word and the wrong sentence were rendering side by side. There is no second broken note producer to find.

The NOT STARTED appearance is a genuinely separate render of the same slice, and it is the one the plan's *"Both places, or the contradiction moves"* is about.

### A claimed slice still appearing under NOT STARTED is OUT OF SCOPE

The plan records it as an Open Question and declines it: *"It is arguably a section-membership question rather than a wording one. Out of scope here: this plan makes the sentence true wherever the row renders, and moving rows between sections is a separate argument with its own risk."*

Do not reopen it. Moving rows between sections changes what operators scan for; this slice changes words.

## Done when

The plan's `## Slices` states the specification: *"The wording change in `rows.tsx`, reading `startability` before the wave verdict, plus a fixture where a row carries `startability: 'someone-is-on-it'` with `verdict: 'eligible'` — the combination measured today — asserting both render sites agree."*

Then these assertions, which exist **because a naive implementation passes without them**:

- **A row with `startability: 'someone-is-on-it'` AND `verdict: 'eligible'` says somebody is on it.** The measured combination. A fixture carrying only one of the two proves nothing — the whole defect is that they co-occur.
- **The fixture has ONE branch and NO PR.** That is what makes `soleNote` empty and routes the row to the verdict arm. A fixture with a PR takes the `soleNote` path and never reaches the code under test.
- **Both render sites agree.** The plan's own gate — assert the WORKING row and the NOT STARTED row say the same thing about the same slice. Fixing one leaves the disagreement the operator noticed.
- **A genuinely unclaimed eligible slice still reads `approved — nobody has taken it`, word for word.** `packages/board/test/integration/slice-head-says-its-verdict.browser.test.ts:145` asserts this string for the `Ready` wave, and its fixture carries no `startability`. **It must stay green untouched** — if it goes red, the fix is over-firing on the population the sentence is correct for.
- **A `null` startability falls through to today's behaviour.** An older server's payload, or a merged branch. This is why the gate is the four verdicts and not truthiness.
- **`verdict-not-prose.test.ts` still passes.** It will fail on any string-matching implementation, by design.

Plus the repo's gates:

```bash
nvm use                    # Node 24 — pnpm crashes on 26
pnpm test
pnpm run test:board        # rebuilds the artifact, then its tests
pnpm run typecheck
```

- **`pnpm run build:board` is a root script** — from `packages/board` it is `pnpm build`. A stale artifact fails every new-feature test reassuringly, and browser tests load the built artifact.
- **A changeset is required.** A `packages/board` change uses `'@plot-pm/board': patch` in the frontmatter with **no** `bumps:` block. Put the description FIRST; add a `plan:` line naming this plan. `.changeset/` holds other people's files — add yours, touch none.
- **Do NOT run `pnpm run test:e2e`.** It is CI's gate. It dispatches real workers into sandbox repos; two agents running it once produced 53 concurrent `node --test` processes and took an operator's board down.
- On a conflict in `board-server.mjs`, do not read the diff — it is generated output marked `-merge`. Take either side, run `pnpm build:board`, commit the result.

## Bookkeeping

- **Open the PR through the controller:** `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). It takes the title from the plan's slice heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- **Append `→ #<number>`** to this branch's line in the plan's `## Slices` section as soon as the PR exists.
- **Push the first real commit as soon as it exists.** A branch whose work is never pushed reads as `eligible` to the fleet scan, and two implemented green branches were lost that way.
- If the shared-helper extraction turns out larger than a wording change, say so in the PR body rather than growing the diff silently.

## Scope guard

**This branch owns** the slice note's wording and the fixture that proves it:

- `packages/board/src/app/lib/agent-rows/rows.tsx` — the `sliceNote` chain at 1036-1077
- `packages/board/src/contract/schema.ts` — only if the sentence is extracted to sit beside `ELIGIBLE_NOTE`; the client bundle cannot reach `fleet.ts`, which is why that constant lives in the contract
- its own tests under `packages/board/test/`

**Do not touch:**

- `packages/domain/src/rules/verdict.ts` — the verdict order is correct and is this fix's evidence, not its target
- `packages/board/src/server/fleet.ts` — `startability` already arrives on the row; no server change is needed, and `classify` is not the thing that is wrong
- `app/lib/agent-rows/sections.ts:43` — the NOT STARTED section label is a heading and is correct
- section membership anywhere — settled above as out of scope

**The client CASTS the fleet payload, it does not parse it.** If you do add a contract field, Zod defaults do not apply client-side and it arrives `undefined` in the renderer. `startability` is already on `AgentRow`, so the expected shape of this change adds no field at all.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

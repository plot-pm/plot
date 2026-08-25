## Implementation brief — a-state-is-a-word-not-a-sentence (wave Worded)

- **Plan (canonical):** `docs/plans/2026-08-25-a-state-is-a-word-not-a-sentence.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/a-running-agent-reads-running` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. Wave `Marked` (the idle cue) waits on this one.

### What to build

`agentStateStatus` returns `running` for a running agent, so the five registry
states share one vocabulary.

`tuple-row.ts:829` maps five states to five words. Four return their own name;
one returns a sentence:

| state | renders |
|---|---|
| `waiting` | `waiting on you` |
| `stalled` | `stalled` |
| `finished` | `finished` |
| `unknown` | `unknown` |
| **`running`** | **`someone is on it`** |

Reported by a reader on 2026-08-25 in exactly those terms: *"'someone is on it'
is no agent status."*

### The decisions the plan settles — do not re-derive them

**The column is the STATE, and four of five already agree on what that means.**
`someone is on it` answers a different question — *should you worry about this
row?* — in a different grammar. One word, one line.

**It carries no information where it is rendered.** Measured: WORKING held **11
rows, every one `running`**, so the column read the same sentence eleven times.
A field identical on every row in the only section that renders it is not
describing anything.

**The function's own docstring is the argument.** It states *"a row whose usual
state is a lie teaches its reader to ignore the row"* — and a word that is
always the same teaches the same lesson by being uninformative rather than false.

**Do NOT add a state.** `AgentStateSchema` stays five, and its size is pinned by
a test on purpose. The idle distinction is wave 2's subject and is a CUE, not a
sixth state.

### Done when

The plan's `## Done when` items 1–4 and 8 are this wave's specification (items
5–7 belong to wave `Marked`).

**The contract you are changing is asserted in 18 places across 8 files** — not
an oversight, a deliberate contract:

| file | refs |
|---|---|
| `src/app/lib/tuple-row.ts` | 3 |
| `src/app/lib/agent-rows/rows.tsx` | 2 |
| `src/app/lib/agent-rows/row-identity.ts` | 1 |
| `test/unit/tuple-row.test.ts` | 5 |
| `test/integration/working-shows-every-agent.browser.test.ts` | 2 |
| `test/integration/agents-tab.browser.test.ts` | 2 |
| `test/integration/unreachable-overlay.browser.test.ts` | 1 |
| `test/integration/wave-in-working.browser.test.ts` | 1 |

**Rewrite those tests, do not delete or loosen them.** Several assert the phrase
on purpose — `working-shows-every-agent` has a case named *reads "someone is on
it" for a running worker*. That test documents the behaviour this wave reverses:
it becomes the assertion that a running worker reads `running`, with its
docstring saying why the earlier contract was withdrawn. This is the same
anti-contract shape `plan-row-wave-actions` needed in #418.

**Item 3 is the one a partial implementation fails:** no occurrence of
`someone is on it` may remain in `src/` or `test/`. Changing the function while
leaving browser tests asserting the old string leaves a green suite over a
contradiction.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Worded (Branch: bug/a-running-agent-reads-running, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/app/lib/tuple-row.ts` and the eight files
above.

**Do not touch** `AgentStateSchema`, `isLiveState`, or `isBrokenState` — the
enum stays five members and both classifiers are unchanged.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: it is generated and marked `-merge`. Never read its diff —
take either side, run `pnpm build:board`, stage the **rebuild** (not the merge's
copy), then commit. Staging before rebuilding produces a commit that looks
repaired and fails CI's freshness gate.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it.

**`bug/a-filtered-section-says-what-it-hid` and other live branches hold
`rows.tsx`** — expect a rebase. That is a report, not a refusal.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

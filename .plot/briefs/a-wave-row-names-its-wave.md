## Implementation brief — one-wave-row-two-contents (wave 1: Named)

- **Plan (canonical):** `docs/plans/2026-08-24-one-wave-row-two-contents.md` on main
- **Branch:** `bug/a-wave-row-names-its-wave` (base: `main`)
- **Ends as:** one PR to `main`

### READ THIS FIRST: the plan does not know where the bug is

Three interrogation rounds each named a site and each was refuted. **Do not
trust the Design section's mechanism** — trust the symptom and the eliminations
below, and find the site by READING THE RENDER rather than reasoning about it.

### The symptom

On the live board, DONE expanded:

| plan | waves | the row shows |
|---|---|---|
| `a-plan-moves-through-the-sections` | 2 | **Reachable**, **Started** |
| `a-draft-plan-claims-no-approvals` | 1 | `bug/a-wave-head-says-what-its-verdict-says` |
| `a-marker-is-a-file-not-a-mention` | 1 | `bug/a-marker-is-a-file-not-a-mention` |

A wave holding one branch shows the BRANCH name where a wave holding several
shows the WAVE name.

### What has been eliminated — verified, do not re-check

**The server is right.** Both rows arrive as `kind: 'wave'` carrying
`wave: "Derived"` and `wave: "Named"`. The names are on the wire.

**The grouping is right.** `planHeads` (`AgentList.tsx:905`) requires
`waveGroupsFor(...).length > 0`, and both plans render a plan head — so the wave
grouped.

**`soleRow` is not it.** `tupleFromWave` is called with `name: group.wave`
**unconditionally** (`rows.tsx:965`); `soleRow` feeds only `soleStatus`,
`solePr`, `solePlan`. It never touches the name.

**`tupleFromWave` is right.** It renders `facts.name || UNNAMED_WAVE_LABEL`
(`tuple-row.ts:1150`).

So the name is populated correctly and dropped **after `tupleFromWave` and
before the screen**. Start at `TupleRowView`'s handling of the name slot —
`{ what: 'plan', label, href: '' }` — since the empty `href` is the one thing
distinguishing a wave's name slot from a branch row's. That is a STARTING POINT,
not a conclusion: verify it before building on it.

### The method that has worked here

Every wrong round inferred a mechanism from the symptom. The rounds that
succeeded read the actual call and compared payload against render. Print what
`TupleRowView` receives for one of these two rows and for a multi-branch wave,
and diff them.

### Done when

Plan items 1–4. Item 1 asserts the names **explicitly** (`Derived`, `Named`) —
a test for *"not the branch name"* passes on an empty string.

Item 2 is the regression this must not cause: a finished single-branch wave must
not read `approved — nobody has taken it`. That defect is why `soleRow` exists
(PR #323); keep its status behaviour.

Plus repo gates: `pnpm run test:board` green, `pnpm build:board` in THIS worktree
with the artifact committed, a changeset (`'@plot-pm/board': patch`), Node 24,
`trash` not `rm`. `auto-dispatch-spawn.test.ts` fails under contention and passes
alone.

### If you cannot find the site

Report what you eliminated and stop. Do NOT change `soleRow`, `waveGroupsFor`,
or `classify` on the theory that one of them might be it — three rounds have
already been wrong in exactly that way, and a speculative change to those three
would break behaviour that is currently correct.

### Bookkeeping

`### Named (Branch: …, PR: #N)`, inside the parenthetical.

### Scope guard

`packages/board/src/app/lib/agent-rows/rows.tsx`,
`packages/board/src/app/components/TupleRow.tsx`, and
`packages/board/src/app/lib/tuple-row.ts`. The `Spoken` wave owns `groupedWord`
— leave it alone.

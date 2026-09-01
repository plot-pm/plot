## Implementation brief — a-refused-dispatch-asks-for-a-brief (slice: Naming)

- **Plan (canonical):** `docs/plans/2026-09-01-a-refused-dispatch-asks-for-a-brief.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/a-brief-has-one-name` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of three. `feature/a-refused-dispatch-asks-for-a-brief` (the `Brief command` callback)
waits on it: a callback writing under the wrong convention produces a file the gate then
reports as missing, on every call, silently.

### What to build

One function that computes a brief's path from a branch name, used by every reader and every
writer, plus a test that no brief in `.plot/briefs/` can be invisible to the gate.

### The defect is in the DOCUMENTATION, and that is the finding

**Three implementations already agree.** All of them take the last path segment:

```
skills/plot/scripts/plot-dispatch.sh:336   brief_path() { printf '.plot/briefs/%s.md' "${1##*/}"; }
packages/board/src/server/auto-dispatch.ts:549   branch.split('/').pop()
packages/board/src/server/attention.ts:55        branch.split('/').pop()
```

**`/plot-implement` step 4 instructs the opposite:**

> Write it to `.plot/briefs/<branch-suffix>.md` (the branch name with `/` flattened to `-`, …)

`feature/the-refusals-are-domain-rules` under that instruction becomes
`feature-the-refusals-are-domain-rules.md`; every reader looks for
`the-refusals-are-domain-rules.md`. **So the skill tells its author to write a file the gate
cannot see**, and three briefs were written that way on 2026-09-01 by an agent following it.

**Fixing the code without fixing that sentence leaves the defect generating new cases.** The
skill edit is in scope and is arguably the more important half.

### What is NOT the reason, so do not spend time on it

**The 6 prefixed briefs on `main` name no branch that still exists.** Their refs were deleted
when their PRs merged, so the residue harms nothing today. Renaming them is cleanup carried
along; it is not why this branch is first. Do not build an argument on it, and do not let a
migration of old files grow into the work.

### The decisions the plan settles — do not re-derive them

**One function, four call sites.** `plot-dispatch.sh`, `auto-dispatch.ts`, `attention.ts` and
`/plot-implement`'s prose. The shell cannot import TypeScript, so the shell keeps its own
one-liner — **the test is what binds them**, not a shared module.

**The gate's rule is the rule.** `${1##*/}` is what actually decides whether a worker finds its
brief, so the documentation moves to match the code, never the reverse. Three readers already
agree; there is no design question here, only a correction.

**`same-branch` plans are the one real edge.** `/plot-implement` says *"or the plan slug for a
`same-branch` plan"* — those have no branch to take a segment from. Keep that path working and
say in the docstring why it differs.

### Done when

- **One function per language**, and the shell's and TypeScript's forms are asserted equal on
  the same inputs — including a branch with no `/`, a branch with two, and a `same-branch` plan
  slug.
- **A test walks `.plot/briefs/` and fails on any file whose name no reader would compute.**
  This is the gate: it must fail today against the 6 prefixed files, so fix them in the same
  PR or the test cannot land green. Confirm it fails *before* you fix them — a gate that passes
  on a broken tree is testing nothing.
- **`/plot-implement`'s step 4 wording matches the code**, and says which form and why.
- `pnpm run test:reconcile`, `pnpm run typecheck`, `pnpm build:board`, changeset
  (`'plot': patch` with a `bumps:` block naming `plot-implement`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** the four path computations, the new test, the 6 file renames, and
`skills/plot-implement/SKILL.md`'s step 4 wording.

**It does not own** the `Brief command` key or auto-dispatch's skip reason — those are the
plan's other two branches.

**In flight, 2026-09-01:** `feature/the-refusals-are-domain-rules` (`plot-dispatch.sh` — the
same file this branch touches at line 336, so expect a rebase),
`bug/a-test-teardown-does-not-call-rmsync` (41 test files), `docs/a-machine-has-an-identity`.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.

## Implementation brief — a-changeset-says-what-changed (slice 1: Gating)

- **Plan (canonical):** `docs/plans/2026-08-30-a-changeset-says-what-changed.md` on `main`
- **Branch:** `bug/a-changeset-says-what-changed` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

`packages/domain/src/rules/changeset.ts` — the rule. `scripts/check-changeset-packages.sh`
reduced to an adapter. One line in CLAUDE.md, one at the head of `CHANGELOG.md`.

### The decisions the plan settles — do not re-derive them

**The rule goes in the domain, NOT into the script.** The script decides today,
and deciding is what the domain is for — a second decision in shell would be the
shape this sprint removes. Measured 2026-08-30: `scripts/` has no tests at all,
while `packages/domain/src/rules/` already holds `deliverable.ts` at 100%.

```
packages/domain/src/rules/changeset.ts   is this changeset valid, and why not
scripts/check-changeset-packages.sh      reads files, calls the rule, exits
```

**The script keeps its name.** It is referenced by `ci.yml:333` and CLAUDE.md,
and once it stops holding the decision, *"run the changeset check"* is what it
still does. Renaming a file whose content is about to shrink is churn.

**Two named refusals, never a boolean:**

| refusal | measurement |
|---|---|
| `unknown-package` | the frontmatter names a package the workspace does not have |
| `no-description` | first non-empty line after the frontmatter opens an HTML comment, **or** the description is under 20 characters |

**The length floor is a labelled guess.** It catches `.`, `wip`, `TODO`. It sits
below anything a person writes — `Fix typo` is 8 characters and legitimate — so
if it ever refuses a real description, the floor is wrong, not the description.

**It checks syntax and size, never meaning.** A gate that judges whether a
description is *good* is one people route around, and this repo has measured
what a rule nobody follows costs.

**Why the defect exists at all:** Changesets publishes the FIRST line after the
frontmatter. A `bumps:` block written first makes that line `<!--`. Measured:
**19 of 169 published entries**, 11%, and CLAUDE.md documents the block without
saying where it goes — so both orders look right.

**The CHANGELOG line goes at the HEAD, not beside each entry.** 14 of the 19
have no recoverable changeset file, so a reader meeting a bare marker cannot
learn what it was; the line says the entries are broken, when it stopped, and
that the PR link still works. Nineteen annotations would be nineteen edits to a
file Changesets rewrites.

**Reach the domain through `node`** — settled precedent, seven scripts already
do, and `plot-sprint-candidates.sh` argues for it in its own comment.

### Done when

The plan's Gating `Done when` — all six points. In particular: **the decision
lives in `changeset.ts` at 100% coverage and the script contains no `if` about
validity.**

**The test is a mutation, not an example.** Removing the description assertion
must turn a test red — a gate whose test passes without it is a comment.

Repo gates: `pnpm test`, `pnpm run typecheck`, `./scripts/check-changeset-packages.sh`,
changeset. Node 24, `corepack pnpm`.

**Domain style** (CLAUDE.md § The Domain Package): arrow functions; factual
TSDoc that says what an export does, not why it was decided — the reasoning goes
in the commit.

### Scope guard

Owns `changeset.ts`, the script's reduction, the CLAUDE.md line and the
CHANGELOG head. **Does not touch `plot-plan-meta.sh`** — that is slice 2, and
its risk is different.

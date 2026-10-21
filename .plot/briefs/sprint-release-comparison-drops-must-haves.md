## Implementation brief — sprint-release-comparison-drops-must-haves

- **Plan (canonical):** `docs/plans/2026-10-21-sprint-release-comparison-drops-must-haves.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2252 merged
- **Branch:** `bug/sprint-release-comparison-drops-must-haves` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

The Sprint/Release comparison silently drops Must Haves whose Jira key is not
on an `Issue:` line, and reports them as "missing from release" with no
explanation.

The exact drop site is `firstJiraKey` in
`packages/board/src/server/entry/sprint-release-gate.ts:83-87`:

```ts
const firstJiraKey = (issues: unknown): string => {
  if (!Array.isArray(issues)) return '';
  const hit = issues.find((v) => typeof v === 'string' && JIRA_KEY.test(v));
  return typeof hit === 'string' ? hit : '';
};
```

`issues` here comes from `plot-plan-meta.sh`'s `issues` array, which is filled
**only** from a `- **Issue:**` line (`plot-plan-meta.sh:238`). A plan that
names its ticket in `ticket:` frontmatter or only inside the Must-have's own
item text produces `issues: []`, so `firstJiraKey` returns `''`. The domain
rule it feeds, `sprintReleaseDrift`
(`packages/domain/src/rules/sprint-release.ts:39-51`), then puts that item in
**neither list** — not `missingFromRelease`, not matched — per its own
docstring: *"A Must-have with key `''` names no issue: it appears in neither
list, and its text is never matched against the Release."* The item vanishes
with no trace in the output.

Measured 2026-10-21 on ewz-kus-portal (read-only): 33 of 40 EWZKUS plans carry
their key only in `ticket:` frontmatter and the title; the active sprint's 7
Must Haves name their keys in item text (e.g. `- [ ] Tracer … (EWZKUS-3858)`),
and the gate matched 0 of 7, reporting all 26 Release issues as
`missingFromSprint` with no indication that 6 of the 7 Must Haves were simply
never looked at.

### The decisions the plan settles — do not re-derive them

**Resolution order is fixed, first match wins:** `Issue:` line → `ticket:`
frontmatter → item text matched against `Ticket prefixes`. Do not re-derive a
different precedence — the plan chose `Issue:` first because it is the field
Plot itself writes and is unambiguous; frontmatter second because it is
structured but not Plot's own format; item text last and only because
`Ticket prefixes` scopes it to this repo's own Jira projects, so a stray
`PROJ-123`-shaped string in prose from an unrelated project is not
mis-matched.

**An unkeyed item is reported, never dropped.** `sprintReleaseDrift` must
return a third list — `notCompared` — carrying every Must-have whose key
resolution found nothing, and the gate (`sprint-release-gate.ts`) must print
it by item name. This is the whole point of the bug: silence is the defect,
not the missing match itself. Do not fold `notCompared` into
`missingFromRelease` — a Must-have with a real key the Release doesn't carry
and a Must-have with no resolvable key at all are different facts a person
acts on differently (chase the Release vs. fix the plan's key).

**The key resolver is a domain function, not a gate-script `if` chain.**
`resolveItemKey` (the plan's own name for it, see the `<!-- builds -->`
annotation on the branch line) belongs in `rules/sprint-release.ts` as a pure
function over the plan's reading and the item's text — per the Manifesto's
split (skills/scripts collect and report; the domain decides) and the same
split `sprintReleaseDrift` and `releaseIsRead` already follow in that file.
The gate script's only job stays collecting the three readings (`Issue:`
array, frontmatter, item text) and handing them to the resolver.

**`plot-plan-meta.sh` has no `ticket:` frontmatter field today — this slice
adds it.** Checked 2026-10-21: the only place the string `ticket` appears in
`plot-plan-meta.sh` is an unrelated comment at line 357; there is no parsing
of a `ticket:` YAML key anywhere in the script's `frontmatter` format (see
its header comment, `plot-plan-meta.sh:35-44`, which documents `status:`,
`phase:`, `type:` but no `ticket:`). This answers the plan's first Open
Question directly: it is not already exposed, so emitting it is part of this
slice's scope, following the same dual-field pattern the script already uses
for `status`/`phase` (frontmatter wins when both canonical and frontmatter
forms are present).

**Matching item text against `Ticket prefixes` reuses an existing read, not a
new one.** `Ticket prefixes` is already a declared `## Plot Config` key, read
today only by the Jira tracker connector
(`packages/domain/src/adapters/tracker/tracker-jira.ts:51,129`) to scope issue
search to this repo's own projects. The key resolver needs the same list to
avoid matching an unrelated `PROJ-123`-shaped token in a Must-have's prose —
read it through `plot-config.sh get "Ticket prefixes"`, the same shell call
`configShell` in `sprint-release-gate.ts:194-199` already demonstrates for
other keys, rather than inventing a second path to the tracker.

**Carry-over invariant from the sibling work this plan's Motivation cites:**
absent is not false. A Must-have with `issue: ''` is not "this Must-have has
no key" in the sense of a validated negative — it is "no source answered",
and `notCompared` must read that way (named, with the item's text) rather
than as a quiet `missingFromRelease` entry that looks like a real drift.

### Open Questions the plan left for this slice to close

The plan's `## Design › Open Questions` are not rhetorical — each needs an
answer recorded before or during this slice:

1. **Does `plot-plan-meta.sh` expose `ticket:` frontmatter today?** No (verified
   above) — the slice adds the field.
2. **When the three sources disagree, does the first win silently or does the
   gate report the conflict?** Not yet decided by the plan; the Design
   section's stated order ("first match wins") answers the resolution but not
   whether a disagreement is itself worth a line in the gate's output. Decide
   and record the answer in the plan or the PR description — don't leave it
   implicit in the code.
3. **Does the board render `sprintReleaseDrift`, and does it need a "not
   compared" row?** The plan's own Board-impact note says "none expected…
   confirm during design." Check whether any board view reads
   `SprintReleaseDrift` fields before assuming the new `notCompared` list is
   purely a gate-script concern.
4. **Does the shell/domain duplicate-rule contract apply, and does key
   resolution need a corpus test?** `docs/shell-and-domain.md`'s rule is about
   a rule implemented twice (once in bash, once in the domain) needing a
   corpus test proving agreement. Here there is exactly one implementation
   (the domain function) with one caller (the gate script) — so on the
   current reading this does **not** trigger the corpus-test obligation. If
   the implementation ends up reading the three sources in two places, this
   reading is wrong and the obligation does apply.

### Done when

The plan's own `## Design › Approach` paragraph is the specification: key
resolution checks `Issue:`, then `ticket:` frontmatter, then item text against
`Ticket prefixes`, first match wins; an item with no match goes into
`notCompared`; no item is dropped silently.

Concretely, verify with the ewz-kus-portal fixture named in the plan's Notes:
of the 7 Must Haves measured 2026-10-21 (EWZKUS-3845, 3869, 3858, 3859, 3860,
3861, 3862), all 7 must resolve to a key after this change — 1 from an
`Issue:` line (if any), the rest from frontmatter or item text — and the gate
must match all 7 against the Release's 26 issues rather than reporting 0.
Where the real fixture isn't available locally, write a unit test fixture that
reproduces the same shape (a plan with only frontmatter `ticket:`, a plan with
only item-text key, a plan with neither) and assert the resulting
`missingFromRelease` / `missingFromSprint` / `notCompared` partition.

Plus: the repo's gates — `scripts/check-bundle-resolution.sh` and the board
build gate, since `sprint-release-gate.ts` compiles into the shipped
`skills/plot/scripts/board/*.mjs` bundle (never hand-edit the `.mjs`; run
`pnpm build:board` only to test locally, then restore the generated artifact
before pushing — see Definition of Done § Resolving a board artifact
conflict if a merge touches it). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it resolves to the tests and typecheck for
`packages/domain` and `packages/board` plus the gate scripts this change
touches. The suites under `CI suites` in `## Plot Config` run in CI on every
PR; do not run them locally as a matter of course.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Never `gh pr create` directly. When the PR is created, append `→ #<number>`
to this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-21-sprint-release-comparison-drops-must-haves.md`).

### Scope guard

This branch owns:

- `packages/domain/src/rules/sprint-release.ts` (the `resolveItemKey`
  function and the `notCompared` addition to `SprintReleaseDrift`)
- `packages/board/src/server/entry/sprint-release-gate.ts` (replacing
  `firstJiraKey` with a call into the new resolver, printing `notCompared`)
- `skills/plot/scripts/plot-plan-meta.sh` (adding the `ticket:` frontmatter
  field to the emitted JSON)
- the generated bundle under `skills/plot/scripts/board/` (rebuilt, never
  hand-edited, never committed with a diff — restored before push per the
  Definition of Done)

No other in-flight branch was found naming these files at dispatch time
(checked `git branch -a` and the active worktrees under `.worktrees/`) — if
`/plot-pulse` or a later check shows one, treat that as new information and
report it rather than silently merging around it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

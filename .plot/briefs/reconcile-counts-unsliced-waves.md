## Implementation brief — a-wave-is-one-branch (wave: Counted)

- **Plan (canonical):** `docs/plans/2026-08-21-a-wave-is-one-branch.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `feature/reconcile-counts-unsliced-waves` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention

Wave *Sliced* landed as **#335** (`/plot-reslice`, the command that repairs what
you are about to count). Wave *Offered* — the board menu item — comes after and
is **not** yours. You are the middle wave: `/plot-reslice` can fix an unsliced
wave, and nothing yet tells anyone one exists.

### What to build

`plot-reconcile-scan.sh` gains **one new section**: every `### ` wave heading in
a plan that carries **more than one branch line**, reported with its plan file,
its heading, and its branch count — plus one machine-countable footer entry,
the way each of the seven existing sections has one.

It **reports and repairs nothing.** That is Manifesto Principle 3's split, and
it is the whole design: this collects, `/plot-reslice` and a person conclude.

### The decisions the plan settles — do not re-derive them

**It must NOT gate.** `attention=` stays exactly as it is. An unsliced wave is a
*shape to fix*, not a branch that cannot move — nothing is blocked by one.

This is not a preference, it is load-bearing: `/plot-deliver`'s delivery-landed
gate and the `/plot` hygiene line both read `attention=` from the footer. Adding
to it would make every delivery in this repo fail on a cosmetic finding. Section
7 exists as a separate section for precisely this reason, and its comment
(`plot-reconcile-scan.sh:806-820`) argues it out — read it before you place
yours, and follow it:

> a section that mixed "worth a glance" with "needs a decision" would leave
> every reader of that number to re-derive the split from the body — which is
> what reading a machine-countable footer is meant to avoid.

**Where it goes.** Section 7 is `Index drift (convenience — nothing depends on
these)` and is deliberately last. Yours is *actionable but non-blocking* —
someone can run `/plot-reslice` — so it belongs **before** section 7, i.e. as
the new section 7 with index drift renumbered to 8. Renumbering is a real cost
so **update every consumer of a section number**. Measured 2026-08-23 there
are exactly three, and this list is complete — grep confirmed no others:

| consumer | what it does |
|---|---|
| `skills/plot-deliver/SKILL.md:342` | `sed -n '/^== 7\./q;p'` — the delivery gate's **stop marker**, so its blocking sections are 1-6. If index drift becomes 8 and yours becomes 7, this must move or the gate starts blocking on your cosmetic findings, which is the exact failure this section is designed to avoid |
| `test/reconcile/scan.test.mjs:552` | asserts `/^== 6\. Delivered but already released/` |
| `test/reconcile/scan.test.mjs:595-596` | brackets section 3 by finding `== 4.` |

Sections 1-6 keep their numbers under this placement, so only the
`plot-deliver` marker actually moves. **Verify that by re-reading the gate's
grep as well as running the suite** — passing tests do not prove the skill's
prose was updated.

If renumbering breaks a consumer you cannot cleanly update, appending as
section 8 is acceptable — say which you chose and why.

**Print an actionable command,** following the existing convention: section 1
prints `fix:`, section 7 prints `optional:`. Yours suggests `/plot-reslice
<slug>`. Pick the verb that matches whether a person must decide — they must,
so it is not `fix:`.

**A file with no `Phase:` is not a plan and is skipped.** `docs/plans/` holds
decision logs and worker reports. The scan already applies this rule; do not
invent a second answer to it.

**Count branch LINES under the heading, not backticked names.** A plan's prose
mentions branch names in tables and sentences — `a-plan-branch-can-be-a-parser-artifact`
is exactly this failure, where every backticked name in `## Branches` got
dispatched, prose mentions included. Use the same rule `plot-plan-meta.sh` uses
for a branch line; do not write a second parser.

**A `complete` wave is history and still counts here.** The plan says
`/plot-reslice` must leave complete waves alone — that is a constraint on the
*repair*, not on the *report*. A section that silently hid seven of eight
findings would be lying about the estate. Report them all; `/plot-reslice`
declines the ones it should.

### Done when

The plan's `## Branches` → *Counted* entry is the specification. Its tests, and
what each one catches:

- a plan with a 5-branch wave is reported **once**, with its plan file, its
  heading and its count — not five times
- a plan whose waves each hold one branch is **silent** (no finding, no empty
  noise)
- a file with **no `Phase:`** is skipped — catches a second parser that treats
  every `.md` in `docs/plans/` as a plan
- the **footer count matches the number of findings** — catches a footer wired
  to a different variable than the body, which no other assertion here can see
- **`attention=` is unchanged** — assert it directly against a fixture that has
  an unsliced wave. This is the property a naive implementation breaks, and
  every other test above passes without it.

Tests live in `test/reconcile/scan.test.mjs` (fixtures in
`test/reconcile/fixtures/`). Run **`pnpm run test:reconcile`**.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
and a changeset with its `bumps:` block. No board rebuild is needed — you do not
touch `packages/board`. If you find you do, stop and report it.

### Bookkeeping

Push your first real commit as soon as it exists. When the PR is created, append
`→ #<number>` to this branch's line in the plan's `## Branches` section **on
main** — verify `git branch --show-current` is `main` before that edit.

### Scope guard

You own **`skills/plot/scripts/plot-reconcile-scan.sh`** and
**`test/reconcile/scan.test.mjs`** (plus fixtures and a changeset).

Four other agents are live right now. Three are in
`packages/board/src/app/components/` (`AgentList.tsx`, `TupleRow.tsx`) and one
is in `packages/board/src/server/`. **None of them touch your files, and you
must not touch theirs.** If the work seems to need `packages/board`, that is the
signal to stop and report rather than widen.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

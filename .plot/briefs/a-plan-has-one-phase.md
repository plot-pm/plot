## Implementation brief — a-plan-has-one-phase (wave: A plan has one phase)

- **Plan (canonical):** `docs/plans/2026-09-16-a-plan-has-one-phase.md` on `main`
- **Approved:** 2026-09-16, jwloka, in-session
- **Branch:** `bug/a-plan-has-one-phase` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

A delivery currently reports `phase=flipped` on the strength of having performed
a write, never on the strength of the write having taken effect. Filed as #924
from a real delivery in a project repository: the plan carried BOTH front matter
and a `## Status` block, the delivery wrote `Delivered` into the block, and
`plot-plan-meta.sh` went on answering `approved` — because the parser prefers
front matter whenever it exists and reads the Status block only in the `else if`
below it. The write succeeded, the outcome did not, and the summary line said
otherwise.

Build the gate: inside `write_transition`, parse the scratch copy through
`plot-plan-meta.sh` BEFORE the `mv`, and refuse where the phase the parser would
read disagrees with the phase being written. On a refusal, discard the scratch
file and leave the plan byte-identical.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Do not extend `phase_alt` to report the disagreement.** This was the first
draft and it is inert twice over. Reproduced 2026-09-16 against the reporter's
exact shape — both `status:` and `phase:` in front matter plus a Status block —
the output is `phase: approved | phase_alt_raw: "Approved" | format: frontmatter`.
**The slot is already occupied** by the within-format pair, and the two reported
values AGREE, so a consumer testing `alt != phase` sees nothing wrong while the
block's `Delivered` appears nowhere in the output. A one-slot `phase_alt` cannot
carry both disagreements. **And nobody reads it:** zero references across twelve
consuming scripts and the whole board; `DESIGN-plan.md:261` calls it *"a conflict
nobody has hit"*.

**Do not put the check after the write, and do not put it after the push.** Two
independent reasons, both measured:

- **The exit contract forbids it.** The script's header documents exit 0 as *"the
  plan is Delivered on the default branch"* — which, after a successful push, is
  exactly what a gate-tripping run has achieved. Refusing there exits 1 on a run
  where the documented exit-0 condition holds: a contract amendment, not a bug
  fix.
- **The caller that matters is automatic and detached.** `runAutoDeliver` spawns
  the delivery detached; its `onExit` reads `if (signal || code !== 0)` and then
  `console.log(...)` + `return` — no reap, no person. A post-push refusal leaves
  the plan delivered on main, the desk unreaped, and the line read by nobody.
  **The plan cites this as `fleet.ts:2986`; that reference does not resolve.**
  The real site is `packages/board/src/server/auto-deliver.ts` — `runAutoDeliver`
  at `:312`, the `onExit` handler at `:343-353`. Verified 2026-09-16. The
  argument is correct; only the path in the plan is stale.

**Do not change the parser, and do not change which format wins.** Front matter
keeps precedence. The disagreement is detected by re-reading, so no contract
field moves and no consumer changes. `plot-plan-meta.sh` already takes a path
(`:277`) and already says what it would read from it — that is the whole
mechanism. No new flag, no `--dry-run` on the parser, no contract change.

**Do not make the writers write both formats.** Three scripts writing two
formats is two records of one fact, and the reconcile scan counts that as drift.
The Status block stays the single write target; a refusal tells the person their
file holds two, which writing both would hide.

**Do not fix `/plot-approve` or `/plot-undeliver` here.** Both carry the same
shape and the same gate would serve them. This slice proves it on the path where
the defect was filed; the other two are a follow-up whose argument this slice
supplies.

**Read the second complaint correctly.** An earlier draft claimed a second run
reports `already` and therefore cannot repair the file. **Measured, it reports
`write`** — `decide_transition` asks whether the file carries the phase AND the
record, and the reporter's file carries a `Delivered` Status block with no
complete record, so it writes again. The defect is not that a re-run refuses to
act; it is that acting never takes effect. The gate stops the FIRST run instead
of letting every run write into a field nobody reads.

**What the code actually looks like at the seam** — verified 2026-09-16, and the
plan's prose is thinner here than the code:

- `write_transition` uses **two** scratch files and has **two** `mv` sites.
  `$a` is `$f.plot-phase` (the phase flip); `$b` is `$f.plot-record` (the flip
  plus the `Delivered:` record). The `recorded=yes` arm lands `$a`; the
  `recorded=no` arm lands `$b` and removes `$a`. **The file to parse is the one
  about to be moved on that arm** — parsing `$a` on the `recorded=no` path
  checks content that never reaches the plan.
- `flip_phase` **writes its output file either way** and returns 1 when nothing
  changed; `write_transition` reads that as `flipped=0` → `phase_report=already`,
  which is a success, not a failure. So the gate must distinguish *"already
  carries Delivered"* (pass) from *"written and unreadable"* (refuse). Refusing
  on `flipped=0` alone would break every re-run of a correct delivery.
- `flip_phase`'s awk matches only inside `section == "status"`. That single guard
  is the defect in ten lines: on a front-matter plan it edits the block and
  leaves the front matter untouched.
- `record_state_receipt "$f" "Delivered"` is called AFTER the `mv`, deliberately
  — *"a receipt written before a failed write would license a commit of the state
  that was refused."* A refusal must not reach it.

### Done when

The plan's `## Done when` list is the specification — read it there. It is a
single long paragraph in the slice section; every clause is a gate.

These are the assertions that exist because a naive implementation would pass
without them:

- **The parse happens on the SCRATCH COPY, before the `mv`** — asserted on `$a`
  (or `$b`, per the arm) rather than on the plan. Catches the obvious
  implementation that re-parses the plan after writing it, which is the design
  round 2 rejected and which passes a "does it refuse?" test perfectly.
- **The refusal names BOTH values and the file** — assert the message contains
  the written phase AND the parsed one. Catches a refusal saying only *"delivery
  failed"*, which throws away the half a person acts on.
- **Nothing is written, committed or pushed when the gate fires** — assert the
  plan file is byte-identical after a refused run. Catches a gate that refuses
  after landing the `mv`.
- **A second run on an unrepaired file refuses the same way** — pinned
  explicitly, because `decide_transition` answers `write` rather than `already`
  on that file, so the second run reaches the gate again and must not slip past.
- **A delivery where writer and parser agree is byte-identical to today** —
  pinned across BOTH formats separately. This is the no-regression gate covering
  every plan in this repository.
- **No parser field changes** — diff `plot-plan-meta.sh`'s full output over all
  289 plans before and after. Catches a fix that "helpfully" adjusts the parser.

The fixture is the reporter's exact shape: front matter `status: Approved` plus a
`## Status` block the script flips to `Delivered`. Reproduced 2026-09-16 as
`phase: approved`.

Plus the repo's gates: `pnpm run test:contracts` passes (`nvm use` first — Node
24; pnpm crashes on 26). A changeset is required — `'plot': patch`, description
FIRST and the `bumps:` block LAST, naming `plot-deliver`.

**Where the test goes:** `test:contracts` runs `test/reconcile/*.test.mjs`, so
the new fixture test is a `node:test` `.mjs` file there. `test/reconcile/deliver-headings.test.mjs`
is the model to copy: it builds a throwaway git repo in `os.tmpdir()`, writes a
minimal `CLAUDE.md` with a `## Plot Config` block, drops one plan file, and drives
the script — reading what it REPORTS rather than re-implementing any parse. Follow
that discipline; a test that copies the gate's logic passes while the script stays
broken.

**Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one — it
dispatches real workers and has taken this machine down.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Slices` section on `main`.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-deliver.sh` and the new test file
under `test/reconcile/`. It touches neither `plot-plan-meta.sh` nor
`packages/` — the parser is read, never changed, and `auto-deliver.ts` supplies
an argument rather than a diff.

Verified 2026-09-16: no other branch in flight touches the deliver script, the
parser, or the auto-deliver caller. Only `origin/changeset-release/main` touches
`skills/plot-deliver/SKILL.md`, which is the release PR and is not this branch's
file.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

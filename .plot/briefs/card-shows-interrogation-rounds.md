## Implementation brief — agent-rows-line-up, wave 3 (Rounds)

- **Plan (canonical):** `docs/plans/2026-08-17-agent-rows-line-up.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #162 merged (one interrogation round)
- **Branch:** `feature/card-shows-interrogation-rounds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

`plot-plan-meta.sh` reports the interrogation round, the contract carries it,
and a **Draft** card wears it as a badge — wearing nothing at all where no
interrogation has happened.

Waves 1 (#165, PR fields) and 2 (the grid) have landed. This is the smallest of
the three and deliberately last: the grid answers a defect visible in every row;
this answers a question a reader can still resolve by opening a file.

### The measurement

`/plot:challenge-the-plan` writes its state into the plan file as an HTML
comment. Real shape, from `docs/plans/2026-08-17-acting-buttons-show-they-act.md`
at line 385:

```
<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [ … ],
  …
}
END-CHALLENGE-THE-PLAN-METADATA -->
```

**Measured on 2026-08-17:** `plot-plan-meta.sh` on that exact file returns 22
keys and `round` is **not** among them. The parser skips the block entirely
today — so a test built on a hand-made fixture would pass while the real format
failed. Assert against a real plan file.

### Four decisions the plan settles — do not re-derive them

**Absent is not zero.** A plan with no metadata block shows **no badge at all**,
not `0 rounds`. `0 rounds` reads as *interrogated and found nothing*; the truth
is *never interrogated*. These want opposite actions from the reader — one says
the plan has been through the wringer and survived, the other says nobody has
looked. This is the rule the repo applies everywhere else (`claimed`/`eligible`
are `.optional()` for the same reason, and #174 landed a refusal rather than a
guess for exactly this case). Carry it in the contract as an optional field, not
as a defaulted number.

**The badge appears only on Draft cards.** Past Discovery the count is history,
and a number nobody acts on is the crowding this board keeps removing. Assert an
Approved card does not carry it.

**The agent row does NOT gain it.** The pairing that matters: 34 of the pulse's
rows carry a plan name whose plan is long settled, and putting the count there
would attach it to every one of them. This is a card-only badge.

**The script collects; the skill interprets** (Manifesto Principle 3).
`plot-plan-meta.sh` reports the number it finds and nothing more — no judgement
about whether two rounds is enough. The board renders what the script reports.

### Done when

- **A Draft card shows its interrogation round.** Assert against a **real plan
  file** carrying `"round": 2` — not a hand-made fixture. The parser skips the
  block today, so a fixture-based test passes while the real format fails.
- **A plan with NO metadata block shows no badge at all.** Assert the absence,
  not a zero.
- **The badge appears only on Draft cards.** Assert an Approved card does not
  carry it.
- **The agent row does NOT gain it.** Assert the row is unchanged.
- **`plot-plan-meta.sh` reports the round** and its absence is distinguishable
  from zero in the JSON — assert both shapes.
- **The parser does not break on a malformed block.** A plan whose metadata
  comment is truncated or is not valid JSON must still parse for every other
  field; the round is simply absent. `plot-plan-meta.sh` is the plan-format
  contract and every other command depends on it.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm test`, `pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset is
present with its `bumps:` block. **Do not edit versions by hand.**
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`skills/plot/scripts/plot-plan-meta.sh` (the field),
`packages/board/src/contract/schema.ts` (carrying it),
`packages/board/src/server/` (populating it),
`packages/board/src/app/components/PlanCard.tsx` (the badge), and their tests.

**Do NOT touch `AgentList.tsx`** — the row deliberately does not gain this
badge, and wave 2 just rewrote that file as a grid.

**Do NOT change the PR fields from #165** or the grid from wave 2. You add a
neighbouring field to `schema.ts`; keep the change narrow.

**One other branch may be in flight:**
`feature/acting-buttons-spin-while-acting` (`StartWorkButton.tsx`,
`ApproveButton.tsx`) — no overlap with you except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

**Note on test fixtures:** on 2026-08-17 a branch failed CI because a sibling
had added one contract field and a whole-object `toEqual` against a hand-written
fixture did not know about it — `merge-tree` compares lines, not expectations.
Prefer asserting the fields you care about over the whole object. This applies
doubly to you: you are the one adding the field.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

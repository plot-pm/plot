# Brief: feature/plot-board-setup-skill

Implement wave 2 (**Skill**) of `docs/plans/2026-08-18-plot-board-setup.md`.

Read that plan first, and then **`docs/superpowers/plans/2026-08-18-plot-board-setup.md`
Tasks 5–6** — the second file carries the step-by-step content, including a
drafted `SKILL.md` frontmatter block. Its decisions were settled during design;
do not re-derive them.

## What wave 1 already delivered

Both helper scripts exist on main and are what this skill drives:

- `skills/plot/scripts/plot-board-probe.sh` — adoption probe, emits one JSON
  object so the skill can **propose** from what is visible rather than
  interview the user about facts already on disk (PR #208)
- `skills/plot/scripts/plot-board-verify.sh` — trap-guarded verification that
  the board actually serves (PR #209)

Read both before writing the skill. The skill's job is to interpret what they
report, not to re-collect it (Manifesto Principle 3: scripts collect, skills
interpret).

## What to build

1. **`skills/plot-board-setup/SKILL.md`** — the new spoke. The plan drafts the
   frontmatter; follow it, including `metadata.version: 0.1.0`.
2. **`skills/plot-board-setup/README.md`** — required for every skill.
3. **The `--start` mode** — set the board running, not merely verify it.
4. **`plot-config.sh` key documentation** — the keys this spoke introduces.
5. **The `/plot-init` extension row** — offered only where a signal justifies
   it, which is how `/plot-init` treats every extension.
6. **Four documentation indexes** — the root `README.md` skills table,
   `CLAUDE.md`'s architecture table, and the two the plan names. CI validates
   that every skill named in a `bumps:` block is a real directory, but nothing
   checks the indexes — miss one and it stays missed.

## Use `/writing-skills`

CLAUDE.md requires it when creating or editing a skill. It is not optional
here: this is a new spoke joining a hub-and-spoke system whose conventions
(Model Guidance table, third person, progressive disclosure) are load-bearing.

## Do not

- **Do not re-implement what the scripts do.** If the skill shells out to
  reproduce a probe result, that is the duplication PR #218 was written to
  remove elsewhere in this repo.
- **Do not invent config keys.** Every key the skill documents must be one
  `plot-config.sh` actually reads, with the documented default.
- **Do not make `--start` silent about failure.** A board that did not come up
  must say so; `plot-board-verify.sh` exists precisely so the answer is
  evidence rather than assertion.

## Definition of Done

- `SKILL.md` + `README.md` exist and `pnpm test` (skill parsing) passes
- The Model Guidance table maps each step to a capability tier, as every Plot
  skill does
- `--start` starts the board and reports the verification result
- All four documentation indexes updated — check each by name, not by memory
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**; concurrent
  runs were measured producing false timeout failures
- A changeset with a `bumps:` block naming `plot-board-setup`

## A note on ports, measured today

`pnpm board` binds 7777 and **refuses rather than hunting for a free port** —
deliberately: several worktrees run boards side by side, and one shooting down
another is a worse failure. On this machine 7777 was already held by a
different Plot installation, so `pnpm board` reported "already running" and
exited 0 while the operator's board was not running at all.

If `--start` can hit that case, say what it means: *a board is on that port,
and it may not be yours.*

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.

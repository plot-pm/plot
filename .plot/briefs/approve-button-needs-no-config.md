## Implementation brief — approve-needs-no-agent, wave 2 (Board)

- **Plan (canonical):** `docs/plans/2026-08-17-approve-needs-no-agent.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #163 merged (four interrogation rounds)
- **Branch:** `bug/approve-button-needs-no-config` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

Two small changes with one shape: **the Approve button stops asking for
configuration its sibling never asked for**, and **it stops using the native
`disabled` attribute** its sibling deliberately abandoned.

Wave 1 landed as #168: `skills/plot/scripts/plot-approve.sh` now performs the
mechanical approval. So the reason `approveAvailability()` demanded an
`Approve command` — *there is nothing to call without one* — no longer holds.

### The measurement that produced this

A board where every eligible card offered `Start work` and none offered
`Approve`, and the question *if you can approve a plan, why can a button not?*

| Control | Calls | Works out of the box |
|---|---|---|
| `Start work` | `plot-dispatch.sh` — a script Plot ships | **yes** |
| `Approve` | `sh -c '<Approve command> "<prompt>"'` | **no** |

Live payload at the time:

```json
"approve": { "available": false,
             "reason": "no `Approve command` in this project's Plot Config
                        — add one to approve from the board" }
```

### Four decisions the plan settles — do not re-derive them

**`approveAvailability()` asks what `dispatchAvailability()` asks.** The binding
is the authorisation: is this a local, same-origin request. Nothing more. The
button then behaves exactly like `Start work` — offered where the action is
possible, refused with a reason where it is not.

**`Approve command` is demoted, not removed.** A project wanting the full skill
— the tracer suggestion, the ceremony questions — can still declare one, and the
board prefers it when present. Absent, the script runs.

**Both entrances run the SAME mechanical implementation**, and this is the part
that keeps demotion honest:

```
no Approve command:    board → plot-approve.sh
with Approve command:  board → agent → SKILL.md → plot-approve.sh
```

Wave 1 made `plot-approve/SKILL.md` call the script. So the seven mechanical
steps go through one implementation either way. Without that, demoting rather
than removing would leave two paths to one outcome, free to drift — the
duplication this plan exists to remove, reintroduced as a configuration option.

**Over a non-localhost binding the button is disabled, and that is correct.**
`dispatch.ts:51` already states it: a Tailscale address is **deliberately not
localhost**. So the same phone that reads the board perfectly well cannot
approve from it — approving merges a PR and writes to the default branch, a
different decision from reading a status away from the desk. `Start work`
behaves identically. **Do not "fix" this.**

### The `disabled` attribute

`ApproveButton.tsx` uses the **native** `disabled` attribute. #160 deliberately
abandoned that for `StartWorkButton`, and the reasoning applies unchanged: *a
natively disabled control leaves the tab order and takes its `title`
explanation with it, out of reach of exactly the reader who cannot see that the
page has dimmed.*

Two buttons on one surface with opposite patterns, because they were built in
parallel and the second did not see the first's decision. Move to
`aria-disabled` and keep the control focusable, so the reason is reachable by
keyboard. Read `StartWorkButton.tsx` for the shape rather than inventing a
second one.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A board with no `Approve command` can approve.** Assert against this repo's
  own config, which declares none — the exact state that produced the question.
- **`Start work` and `Approve` have the same availability rule.** Assert both
  read the same binding: two controls on one surface asking different questions
  is the defect, and a fix that only adds a fallback keeps it.
- **`Approve command`, when declared, still wins.** Demoted is not removed.
- **Both entrances end in `plot-approve.sh`.** Assert the skill path does not
  repeat its steps.
- **The button is disabled over a non-localhost binding**, with the binding's
  own reason.
- **The disabled button stays focusable.** Assert `aria-disabled` and *not* the
  native attribute, and that the reason is reachable by keyboard.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.

**Versioning:** do NOT edit versions by hand. Declare the bump in your changeset's
`bumps:` block — `CLAUDE.md` was corrected on 2026-08-17 after describing manual
bumps the repo has not done for six releases.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`packages/board/src/server/approve.ts` (the availability rule),
`packages/board/src/app/components/ApproveButton.tsx` (the attribute), and their
tests.

**Do NOT touch `skills/plot/scripts/plot-approve.sh` or
`skills/plot-approve/SKILL.md`** — wave 1 settled both in #168; you consume
their result.

**Two other branches are in flight**, both from `board-survives-its-agents`:
`feature/board-bridges-its-restart` (the pulse cache, `fleet.ts` and a new state
file) and `bug/scan-reports-a-locked-worktree` (`plot-fleet-scan.sh` and
`fleet.ts`). **Neither touches `approve.ts` or `ApproveButton.tsx`**, but both
rebuild the artifact — so expect the usual collision there.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

**Note on CI:** this repo saw two flaky failures on 2026-08-17 on branches
containing no code, both in suites that start real servers on real ports. If CI
fails on a test you did not touch, check whether it passes locally before
assuming you caused it — and say so in your report.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

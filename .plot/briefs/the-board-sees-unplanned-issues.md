# Brief: feature/the-board-sees-unplanned-issues

Implement wave 1 of
`docs/plans/2026-08-18-an-issue-is-a-signal-the-board-can-see.md`.

Read it first. **This wave is read-only** — the *Create plan* action is wave 2.

## The bug

Three issues sat open for hours — #226, #227, #228 — each written by the
operator with request counts, timings, file paths and line numbers already in
place. **None appeared on the board**, because the board reads `docs/plans/`
and an issue is not a plan.

Correct by the current design, and useless: the work exists and nothing
surfaces it.

## Why not a `Ticket` phase

The obvious fix is a fifth phase before Draft. The manifesto forbids it:

> Issues (or any equivalent) remain the **inbox** — signals, not commitments.
> […] Plans reference tickets; they never mirror their content, because copies
> age into lies.

The four phases describe **the path of a plan**. An issue has not entered it.
So this is **a row that is not a plan**, in WAITING ON YOU — the section for
what needs a human decision, and the decision here is *is this worth a plan?*

## What to build

The host adapter reports open issues; the board lists those **no plan
references**, read-only.

**The row takes the shape of a PR row** — the board already renders one and a
reader already knows how to scan it. Only the glyph differs:

```
WAITING ON YOU (4)
  Discovery  scan-asks-once-per-branch          🎫 #228   2h   ⋯
  Discovery  a-blocked-wave-is-not-eligible     🎫 #227   3h   ⋯
```

Three decisions, each with a reason:

- **The inferred plan name is NOT a link.** Nothing is behind it yet, and a
  link to a plan that does not exist is the fabrication this board keeps
  removing.
- **The branch column is EMPTY.** A derived branch name would put a plausible
  identifier where nothing exists, and a reader could not tell it apart from a
  branch nobody has claimed — a row this board already renders, meaning
  something else entirely.
- **The number links to the tracker**, following the PR cell's own rule
  exactly (`AgentList.tsx:3708-3722`): a host that reported no address renders
  plain text, never an invented link.

## Do not

- **Do not write to the tracker.** No labels, no assignees, no close-on-merge.
  Read-only in both directions.
- **Do not list every issue.** Only those no plan references. An issue someone
  decided against is closed on the tracker; one with a plan is already on the
  board as that plan.
- **Do not let a failed lookup read as "no issues".** That is the rule
  `an-outage-is-not-an-answer` established and this session applied five times.

## The open point you must answer

How is "referenced by a plan" detected? A plain `#228` in a plan body is cheap
and ambiguous — plans mention PR numbers constantly, and `plot-plan-meta.sh`
reads only `→ #NNN` for exactly that reason. A dedicated field (`Issue: #228`)
is unambiguous but is one more thing to remember. **Decide and say why.**

## Cost — read this

`docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md` is fixing a
measured rate-limit problem: 39 Bitbucket requests for 14 branches, and 34 s on
GitHub against a 30 s board timeout. **Adding a per-refresh call to a board
already exceeding its limit would make a measured problem worse.**

If that plan's wave 1 has not merged when you are ready, say so in the PR and
propose the ordering rather than landing this first.

## Definition of Done

- An issue with no referencing plan appears; one referenced by a plan does not
- The inferred name renders as text, not as an anchor
- The branch column is empty rather than carrying a derived name
- An issue whose host gave no URL renders its number as plain text
- A repo with no tracker renders nothing, rather than an empty section
- A failed issue lookup reads as unknown, never as "no issues"
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.

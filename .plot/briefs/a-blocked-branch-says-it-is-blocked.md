# Brief: bug/a-blocked-branch-says-it-is-blocked

Implement the remaining branch of
`docs/plans/2026-08-18-a-blocked-wave-is-not-eligible.md`. Read the plan first —
its two sibling branches (#231, #234) are merged and established the rule this
one completes.

## What is already true

NOT STARTED now holds only what an agent may actually claim: a Draft plan waits
in WAITING ON YOU, a finished plan appears in neither, and the section hint
reads *"approved — nobody has taken it"*
(`packages/board/src/app/components/AgentList.tsx:42`).

What is still wrong: **within** NOT STARTED, a branch whose wave is blocked
renders exactly like one that is claimable. An operator reading the section as
"work I can start" is offered branches that cannot begin.

`blockedBy` is already on the wire — `packages/board/src/contract/schema.ts:1338`,
`z.string().nullable()`. Nothing new needs to cross.

## What to build

**Only an eligible branch reads *eligible — nobody has taken it*.** A branch
whose wave is blocked renders as blocked and names what it waits on.

**The link points at the blocker, and its address depends on how far it got:**

| Blocker state | Renders as |
|---|---|
| open PR | link to the PR |
| commits, no PR | link to the branch |
| never started | its name as **plain text, no anchor** |
| `blockedBy` absent | blocked, with no name — never as eligible |

The last two rows are the load-bearing ones. Follow the rule the PR cell
already follows at `AgentList.tsx:3714-3722`: *a host that reported no address
renders text, never an invented link.* A branch nobody has started has no
address — it is a name in a plan, and a link to a non-existent ref is worse
than text.

**`blockedBy` absent must not fall back to eligible.** Absent is *cannot tell*,
and rendering that as claimable is the same defect the sibling branches removed
at the section level — it invites work onto something that cannot start.

**Merged branches do not appear as rows of an unstarted plan.**

## Definition of Done

- A blocked branch never renders as claimable and names its blocker
- A blocker with an open PR links to that PR
- A blocker with commits but no PR links to the branch
- A blocker never started renders as text with no anchor
- `blockedBy` absent renders as blocked without a name, not as eligible
- An eligible branch is unchanged — assert this
- Merged branches absent from an unstarted plan's rows
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not add a field to the row contract — `blockedBy` is already there
- Do not change which rows enter NOT STARTED; #231 and #234 settled that and
  their tests will tell you if you did
- Do not touch `plot-fleet-scan.sh` — this is a board-side rendering change

## Platform and machine notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs were measured producing false timeout failures that do not
reproduce serially.

**Other agents are running on this machine.** If `test:board` gives you
connection-refused failures, a sibling worktree's board server is the likely
cause. Kill only servers you started — `pkill -f board-server.mjs` matches
every board on the machine including the operator's, and doing that killed a
live board twice today. Bind `PORT=0` and record your own pid.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.

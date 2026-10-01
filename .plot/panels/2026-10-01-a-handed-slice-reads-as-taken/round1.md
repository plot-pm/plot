# Round 1 — moderation

**Subject:** `docs/plans/2026-10-01-a-handed-slice-reads-as-taken.md` (#1150, Draft), as read by the jurors on `origin/main` `5da3e923`. The amendment is checked against `origin/main` `385d6d7d`.

**Gate:** `unanimous amend skeptic,operator,domain`

## What each juror executed and what each read

| juror | executed | read |
|---|---|---|
| skeptic | A detached worktree at `5da3e923`, `pnpm install`, and a scratch vitest file that called `rowsFromPulse` for `bug/the-rule-names-a-usage-limit` with quiet = 30 over four readings. It reproduced the defect and the orphan placement past the window. | `fleet.ts`, `rows.tsx`, `stubbed-tests-start-no-board.test.ts` |
| operator | One `/api/fleet` read (three free agents, nothing handed). | Both plans, `fleet.ts`, `rows.tsx`, `working-agents.ts`, `AgentList.tsx`, `sections.ts`, `schema.ts`, `plot-fleet-scan.sh` |
| domain | Nothing. | `fleet.ts`, `schema.ts`, `rows.tsx`, `menus.tsx`, `stuck.ts`, the test count file |

Only the skeptic's finding about the quiet window rests on an execution. The other two jurors reach the same finding by reading `fleet.ts:5059-5096`.

## Agreed changes

1. **The orphaned claim moves too.** All three: past the 30-minute quiet window (`fleet.ts:102`), a held empty claim with no visible worker returns `waiting-on-you` with the orphan note (`fleet.ts:5059-5096`). `withHandOver` moves only `not-started`, so #1150's *"whether or not the branch carries a commit"* stays wrong, and the row claims that nobody holds the branch. The rule must move that row, with a unit case older than the window.
2. **The false claim goes.** All three: `handed to agent` and `not taken up` occur nowhere in `packages/board/src`. The note format is new.
3. **The browser test proves rendering only, or drives the server.** Skeptic and operator: a stubbed payload already carries the group, so the browser test cannot fail on `withHandOver`. The operator adds that the session prefix already renders in WORKING, so an assertion on it passes today.
4. **The `rows.tsx:1092` claim is wrong.** Operator, and the skeptic's table supports it: `rows.tsx:1088` renders a sole row's own note, so the verdict sentence at `:1092` never reaches a sole row.

## Changes one juror required and nobody contested

- Skeptic: every moved row carries `startability: 'someone-is-on-it'`, so no menu offers a start.
- Domain: unit cases lock #1090 — a `not-started` row with no matching agent, and one whose agent is not live, stay unchanged. Without them a `withHandOver` that ignores the registry passes every listed test.
- Domain: say whether a handed row offers "Open worker log" (`menus.tsx:68` reads the group only).
- Domain: pin `EXPECTED_TESTS` as "the value at rebase + N".
- Operator: specify the dead agent, the double hand-out and the `waiting` agent; drop the session from the note, because the note renders on the agent's own `RegistryRow` beside its session link.

## Disagreements

- **`rows.tsx:1092`.** The domain juror marked the claim true, because the string exists at that line. The operator marked it false, because a sole row never reaches the string. The operator is right on the reading the plan makes: the plan says the client renders a sole row's empty note *as* that sentence, and `:1088` takes the `soleRow` arm first. The observed text is `ELIGIBLE_NOTE` (`schema.ts:1563`) on an `open` row, NOT STARTED's section hint (`sections.ts:43`), and, for a claimed row, a note that `startableNote` blanks (`rows.tsx:1521`).
- **Double hand-out.** The plan answers `''` and leaves the row as it is. The operator calls that the case the operator needs most and asks for its own WAITING ON YOU note or a recorded gap. The domain and skeptic jurors do not address it. The amendment takes the operator's position: two live agents on one branch is a fault a person resolves.
- **`waiting` agents.** The plan excludes them because `waiting` reaches the row from the desk. The operator notes `LIVE_STATES` (`schema.ts:3407`) puts a `waiting` agent in WORKING whether or not its desk holds the branch. The amendment includes `waiting`, so the row agrees with the section its agent appears in.
- **#1161.** The operator and the skeptic both find no conflict, because a Draft slice leaves `not-started` first. Neither covers the orphan arm, which the amendment now moves and which #1161 leaves to the `claimed` arm.

## Shared blind spot

No juror ran the rule against a registry. The skeptic's scratch test found that `rowsFromPulse` takes no agents list, and stopped there. The behaviour of `withHandOver` over a real `buildBoard` call with a stubbed registry is unmeasured, and the plan's browser test cannot measure it.

## What an amendment changes

- `withHandOver` also moves a `claimed` row in `waiting-on-you` with no PR, with a unit case at 45 minutes against a 30-minute window.
- `handedTo` returns the live sessions naming the branch, `running` or `waiting`; one session moves the row to WORKING, two or more move it to WAITING ON YOU with its own note.
- Every moved row carries `startability: 'someone-is-on-it'`.
- Rows whose `verdict` is `unapproved` never move: #1161's Draft placement wins.
- The note reads `handed over — not taken up yet`, presented as new, with no session.
- Four operator cases, each with its group and note, and unit cases that lock #1090.
- "Open worker log" shows on a handed row and answers `no-worktree`.
- The browser test proves rendering only; `EXPECTED_TESTS` is "the value at rebase + 1".
- The `rows.tsx:1092` claim is replaced by the measured render path.

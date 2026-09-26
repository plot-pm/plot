## Implementation brief — a-card-sends-its-plan-to-the-jury

- **Plan (canonical):** `docs/plans/2026-09-26-a-card-sends-its-plan-to-the-jury.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `feature/a-card-sends-its-plan-to-the-jury` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI `validate`, PR review)

Single slice. Nothing waits on it and it waits on nothing.

### What to build

A Draft plan card shows a rounds chip and offers only **Open** and **Approve**. The board measures how interrogated a plan is and offers no way to interrogate it; `/plot-panel` is reachable only from a terminal. On 2026-09-23 five panels ran by hand in one session and none recorded a round.

Build one spawn action, `POST /api/interrogate`, that runs a new `Interrogate command` config key with a prompt asking for `/plot-panel <plan path>`. Add an **Interrogate** button beside **Approve** on Draft cards, and a read-back route that reports running/done plus the log path. The skill writes the verdicts, `panel.md` and the `Rounds:` increment. The board writes none of them.

Also make the rounds chip distinguish **no `Rounds:` field** from **`Rounds: 0`** in a way a reader sees.

### Settled decisions — do not re-derive them

**Copy `commission.ts`, not `idea.ts`.** The plan cites `idea.ts:369` (`ideaStatus`) for the read-back shape. The closest whole template is `packages/board/src/server/commission.ts`: it is SLUG-scoped, runs on a Draft, spawns a plot agent, imports `isSameOrigin`/`readJsonBody`/`SLUG_RE` from `dispatch.ts` and `usableCommand`/`lastLines` from `idea.ts`, has `commissionStatus` (the `ideaStatus` shape, slug-keyed), and is registered in the route table at `index.ts:211` with its read-back at `index.ts:632`. Import the guards and do not copy them. The estate's rule is that a second copy of a security decision is a second place to weaken it.

**Its own key, `Interrogate command`, not `Idea command`.** `commission.ts` reuses `IDEA_COMMAND_KEY`; this plan names a new key in its slice line and Changelog. Follow the plan. The key is REQUIRED in the way `Idea command` is (`plot-config.sh:72`): no script can run a panel, so there is no fallback. An absent key, or `none`, makes the button render disabled and name `Interrogate command` as the fix. Document the key in `plot-config.sh`'s header beside `Idea command`, and add it to CLAUDE.md's `plot-config.sh` table row.

**The name is `Interrogate`, never `panel`.** `agent-panel.ts` and `/api/agent-panel` already hold the word `panel` one file over. Use `interrogate.ts`, `/api/interrogate`, `InterrogateButton`, and `interrogate` in availability/status field names.

**Draft only.** Reuse `isDraft(card)` from `PlanCard.tsx`, the predicate the Approve button and the rounds badge use, so the three cannot drift. Approved, Delivered and Released cards do not offer the button. The server also refuses a non-Draft slug (`readPhase` from `transition.ts`, as `commission.ts` does).

**One panel per plan at a time.** A second click while the status reads `running` is refused on the server and the button is not offered on the client. The reason: two panels writing one `.plot/panels/<subject>/` interleave verdict files and the moderator reads a mixture. The status read-back is the source for both.

**The four refusals** (the slice line names four): key absent/`none`; plan not Draft; a panel already running for this slug; the availability binding (not localhost, via the `ideaAvailability`-style wrapper `commission.ts` uses). Each refusal carries a sentence. An empty reason reads as an absence.

**It decides nothing.** No phase write, no approval, no auto-reject, and no board-side `Rounds:` write, because the skill records the round and a second writer doubles it. The prompt names the plan path and chooses no lenses; `/plot-panel`'s Draft-caller defaults apply. If `/plot-panel` cannot run from a headless prompt, write that down as a finding and do not work around it in the board.

**Approve stays enabled at every round count.** It was asked and decided on 2026-09-26: 195 of 346 plans reached Delivered or Released with no `Rounds:` field. Do not add a gate or a disabled state to `ApproveButton`.

**Absent vs 0 is a render change, and today absent renders NOTHING.** Read the doc comment above the rounds-badge function in `PlanCard.tsx` (~line 120): an absent field shows no badge, and `Rounds: 0` shows `0 rounds` in the same grey as `no story`. The plan asks that an unquestioned plan be *marked* (absent → a visible "not interrogated" style state) and that `0 rounds` not look like it. Keep the existing contract rule: never `?? 0`, and test `undefined` itself (`schema.ts:163`). There is a second render site at `packages/board/src/app/lib/agent-rows/rows.tsx:~761` (`Interrogated: N of /challenge-the-plan`). Find which site the DISCOVERY section uses and keep the two consistent. Existing tests hold the current contract: `test/unit/rounds-badge.test.ts` and `test/integration/plan-rounds-badge.browser.test.ts`. When you change the absent case, you rewrite the assertion that says absent renders nothing. That is the intended change and not a regression. Keep one test that tells the two states apart.

**Carried-over rules this repo keeps re-learning:**
- A new `POST /api/*` joins `WRITE_ROUTES` in `packages/board/test/write-gate.test.mjs`. That test reads the route table out of the built artifact and fails on any route it does not list.
- A new capability flag needs about six touchpoints: the schema field, the `board.ts` placeholder, `index.ts`, the App guard, `AgentList`/`PlanCard` props at every call site, and the control. `tsc` walks you through them. The client CASTS the board and does not parse it, so a Zod default does not apply client-side.
- Browser tests load the BUILT artifact: run `pnpm build:board` before `test:board`. A stale artifact fails every new-feature test.
- A spawn test must wait for the child to exit (the `.plot-worker.exit`-style sentinel) before cleanup.

### Done when

The plan's `## Done when` list is the specification. These items catch a naive implementation:

- **"Clicking it runs the configured command and `Rounds:` increases by one."** Test it with a stub command that appends `Rounds:` the way the skill does, and assert that the board itself wrote nothing to the plan. This catches a board-side counter.
- **"A card whose panel is in flight does not offer a second."** Assert it on the server too (a second POST is refused while status is `running`), not only by hiding the button.
- **"No `Rounds:` renders differently from `Rounds: 0`."** Both must render something, and the two must differ. The current code renders nothing for absent, so a check for "does not show `0 rounds`" passes without the change.
- **"`Approve` is enabled at every round count, including none."** Assert it at absent, 0 and N.
- **Key absent → refusal names the key.** Assert the literal `Interrogate command` in the disabled reason.

Plus the repo gates, under Node 24 (`nvm use`; use `corepack pnpm` if homebrew pnpm crashes): `pnpm test`, `pnpm run typecheck`, `pnpm run test:board` (rebuilds the artifact), `pnpm run test:contracts` if you touch `plot-config.sh`. Do NOT run `test:e2e` locally; CI runs it. Commit the rebuilt `skills/plot/scripts/board/board-server.mjs`. Add a changeset with `'@plot-pm/board': patch` or `minor`, plus `'plot'` if `plot-config.sh` changes, description FIRST. Copy the format from git history if `.changeset/` is empty.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` on `main`, in the form `(Branch: feature/a-card-sends-its-plan-to-the-jury, PR: #N)`. Write it WITHOUT backticks: `plot-plan-meta.sh` does not read a backticked branch in a heading, and this plan parsed as branchless until that was fixed at dispatch (d111e1681).

### Scope guard

This branch owns:
- `packages/board/src/server/interrogate.ts` (new), `index.ts` (route + read-back + availability), `board.ts`/`contract/schema.ts` (capability field)
- `packages/board/src/app/components/PlanCard.tsx`, a new `InterrogateButton.tsx`, and the rounds render in `app/lib/agent-rows/rows.tsx`
- `packages/board/test/**` for the above, `write-gate.test.mjs`
- `skills/plot/scripts/plot-config.sh` (key docs), CLAUDE.md table row, the built board artifact, one changeset

In flight elsewhere, verified at dispatch (2026-09-26): `feature/one-monitor-watches-the-slice` (5 commits ahead) also edits `packages/board/src/contract/schema.ts`. Expect a rebase there and nothing more. No other remote branch touches `index.ts`, `idea.ts`, `commission.ts`, `PlanCard.tsx`, `ApproveButton.tsx`, `write-gate.test.mjs` or `plot-config.sh`.

If you find something the plan did not anticipate, report it and do not improvise outside scope.

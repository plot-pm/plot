# Acceptance criteria — 2.7.0

Derived from the 65 changesets. Each line is **one observation with a verdict**:
you can read it, do it, and say yes or no without knowing why it was built.

Where a criterion needs a precondition, it is named. Where a criterion is
**expected to FAIL in this release**, it says so — three defects were found
today and are not in it, and a tester who does not know that will report them
again.

Automated coverage on the candidate: **1658 vitest, 187 `.mjs`, 30 reconcile
files, 3 e2e — all green.** Nothing already decided by those is repeated here.

---

## A. The Agents tab, at rest

*Preconditions: `pnpm board`, Agents tab, a repo with several plans and branches.*

- [ ] **A1** Every row is one of: ticket, plan, PR, branch, release — and you can say which **without hovering**.
      ⚠ **Erwarteter Fehlschlag** — `TupleRow.tsx` shipped with zero call sites; the wave that wires it is not in this release
- [ ] **A2** A section heading, a plan heading and a row label read as three different levels.
      ⚠ **Erwarteter Fehlschlag** — all three are 12px. Filed as `a-section-is-not-a-row`
- [ ] **A3** The fold caret is legible at a glance, not merely clickable.
      ⚠ **Erwarteter Fehlschlag** — 12px glyph, 24px target. Same plan
- [ ] **A4** Sections are separated by visibly more space than rows are.
- [ ] **A5** Row height is the same as before this release.
- [ ] **A6** A branch row prints **no plan phase**.
- [ ] **A7** A branch row whose plan has more than one wave names its wave.
- [ ] **A8** A branch row whose plan has one wave names no wave.
- [ ] **A9** A branch row with a PR shows the PR number **as a link**.
- [ ] **A10** A merged branch's PR link is still there — merging did not erase it.
- [ ] **A11** A branch held by a local worktree reads as somebody working, and names the holder rather than a filesystem path.
- [ ] **A12** Every row in WAITING ON YOU has a `⋯` menu.
- [ ] **A13** A ticket row's menu offers **Create plan**; a plan row's offers **Approve**.
- [ ] **A14** A ticket row shows an age.
- [ ] **A15** The Design column holds only plans in the **Design** phase — approved-but-unstarted plans are in Development.
- [ ] **A16** An eligible row states whether it can actually be started.
- [ ] **A17** The foot of the page shows counts, scan age and PR-data age.

## B. The Agents tab, over time

*Precondition: leave it open and watch through several 5-second pulses.*

- [ ] **B1** NOT STARTED does not reshuffle between pulses when nothing changed.
- [ ] **B2** Two rows of the same age keep a stable order across pulses.
- [ ] **B3** A branch you push appears within one scan interval.
- [ ] **B4** A PR that turns green on the host is reflected within one **PR-refresh** interval (~60s), not one scan interval.
- [ ] **B5** While a scan is still running, rows already resolved are shown — the tab does not go blank and refill.

## C. Failure and degradation

- [ ] **C1** Statuses appear in **one** panel at the top, not one banner per condition.
- [ ] **C2** That panel names how many statuses it holds and pages between them.
- [ ] **C3** A newly arriving status is briefly prominent, then takes its place by severity.
- [ ] **C4** The panel is **absent** when there is nothing to report.
- [ ] **C5** The view-status line at the foot is **not** inside that panel and is always present.
- [ ] **C6** A failing check shows **which step** and **an age** — not an ISO timestamp.
- [ ] **C7** The changed-file list for a failing check is behind the `⋯` menu, not in the row.
- [ ] **C8** Kill the scan mid-run: the timeout note names the counts it measured.
- [ ] **C9** That note does **not** claim that pruning worktrees will help.
- [ ] **C10** Stop the board while the tab is open: the page says the server is unreachable and does not present stale data as live.

## D. The agent panel

*Precondition: a row in WORKING; open its panel.*

- [ ] **D1** It names pid, uptime, model and context.
- [ ] **D2** COMMAND shows about three lines, then scrolls — it neither clips to one line nor grows unbounded.
- [ ] **D3** COMMAND's **Copy** yields the whole original command, not the visible excerpt.
- [ ] **D4** BRANCH and PLAN navigate when clicked.
- [ ] **D5** WORKTREE offers **copy**, and is not a link.
- [ ] **D6** A fact that cannot be read is **absent** — no placeholder, no zero.
- [ ] **D7** The worker log is served on demand; opening the panel does not enlarge the pulse.
- [ ] **D8** The log overlay scrolls itself; the page behind it does not move.
- [ ] **D9** The overlay keeps its scroll position across a pulse.
- [ ] **D10** A worktree with no worker says so, rather than showing an empty log.

## E. Actions that write

*Each is one click and a wait. The failure being checked is a control that accepts a click and does nothing.*

- [ ] **E1** **Start work** on an eligible row: a worktree is created, a claim is pushed, a worker starts, and the row moves to WORKING.
- [ ] **E2** Its message is *Agent work will show up shortly* and nothing more — no log path, and not an amber warning.
- [ ] **E3** A real refusal from `/api/dispatch` is shown **in the server's own words**.
- [ ] **E4** A row that cannot be started refuses **before** the click, with the reason on the control.
- [ ] **E5** Two clicks in the same tick produce **one** request.
- [ ] **E6** An in-flight button carries a spinner **beside** its label, and the label still changes.
- [ ] **E7** **Create plan** on a ticket row starts an agent that writes a Draft plan naming that issue.
- [ ] **E8** **Approve** on a Draft plan row records the approval.
- [ ] **E9** **Continue** on an agent that stopped to ask starts a **new** run.
- [ ] **E10** After a board **Start work**, `.plot/briefs/<branch>.md` exists.
      ⚠ **Erwarteter Fehlschlag** — see §H

## F. Cost — measure, do not assert

*Precondition: **no agents running**, idle machine. Every figure in this release's perf work was taken under fleet load and is recorded as unestablished.*

- [ ] **F1** `time skills/plot/scripts/plot-fleet-scan.sh` completes without timing out  → ________
- [ ] **F2** `time pnpm run test:board` — the parallel split landed this release  → ________
- [ ] **F3** One board pulse costs no host call beyond the PR/issue timers  → ________
- [ ] **F4** The scan asks the host once per **plan set**, not once per branch  → ________

## G. The lifecycle (skills — no automated coverage)

*`CLAUDE.md`: "Behavioral testing is manual. The skills have no unit tests." Fifteen changesets touch skills or helper scripts.*

- [ ] **G1** `/plot-idea` → `/plot-approve` → `/plot-implement` → `/plot-deliver` completes on a throwaway plan.
- [ ] **G2** The same, in a repo with **no symlink index** — every step works and the board shows the plan.
- [ ] **G3** A plan in phase **Design** passes both pre-Approved gates.
- [ ] **G4** `/plot-reconcile` reports an unlinked plan as advisory, **not** as orphaned.
- [ ] **G5** `/plot-dispatch` refuses a **held** branch and names the worktree holding it.
- [ ] **G6** A dispatch writes `.plot/agents/<session>.json` with session, branch, worktree, command, startedAt — **and no pid**.
- [ ] **G7** The Agents tab lists an agent whose branch field is empty.
- [ ] **G8** An unattended skill run names each question it skipped, rather than exiting silently.

## H. Known gaps — background for A1–A3 and E10

Not a checklist. These are the reasons three criteria above are expected to
fail; read them before reporting those as new.

**H1 — rows of every kind render identically** (A1). `TupleRow.tsx` landed in
#293 with **zero call sites**, verified by grep across `src/app/`. Only
`bug/one-component-renders-every-row` wires it, and that wave is not in this
release. *No visible change* is the correct observation.

**H2 — section, plan heading and row are all 12px** (A2, A3). Measured:
`text-xs` on the `h2`, `text-xs` on the row, `mb-1` beneath a heading against
35–36px between rows. The fold caret is a 12px glyph in a 24px target — the
target was deliberately sized and is fine; the glyph was never revisited. Filed
as `a-section-is-not-a-row`, not in this release.

**H3 — a board *Start work* writes no brief** (E10). Only the `/plot-dispatch`
**skill** writes one, by invoking `/plot-implement` per branch;
`plot-dispatch.sh` cannot invoke a skill, and the board calls the script. Yet the
`Worker command`'s first instruction is *"Read `.plot/briefs/…` first — it is the
specification."* So a board-started agent reads a file that does not exist and
then improvises, which is what the brief exists to prevent. Measured 2026-08-20:
an agent ran 2:12 against a 700-line wave with no brief before being stopped.
**Not yet filed as a plan.**

## I. Needs a real host under pressure

*Not reproducible locally. Verify on a day the API is actually throttling, or mark **unverified** — do not pass these from a stub.*

- [ ] **I1** A spent rate limit produces a note that says so **and** names when service returns.
- [ ] **I2** That note is distinguishable from an unreachable-host note.
- [ ] **I3** The wait comes from the host's stated reset, not a fixed constant.
- [ ] **I4** The issue poll backs off on a rate limit the way the PR refresh does.

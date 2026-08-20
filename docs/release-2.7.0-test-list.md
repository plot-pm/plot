# Manual test list — 2.7.0

Derived from the 65 changesets awaiting this release. **This lists only what the
automated suites cannot decide**, because the suites already ran green on the
release candidate:

| suite | result |
|---|---|
| vitest | **1658 pass / 77 files** |
| `.mjs` server | **187 pass** |
| `test/reconcile` | 30 files |
| `test/e2e` | 3 files |

So a changeset whose claim is *"the field is on the payload"* or *"the parser
emits X"* is **not** in this list — a test decided it. What is here is the three
kinds of claim a test cannot settle:

1. **What a reader perceives.** *"A reader can tell a section from a row"* is a
   claim about a person, and every assertion about it can pass while the screen
   stays unreadable — this release contains a defect of exactly that shape
   (`a-section-is-not-a-row`), found by looking, not by testing.
2. **Cost.** *"The scan walks a branch once"* is true or false by measurement.
   Eight changesets in this release are performance claims.
3. **What needs a real host.** Rate limits, 503s, an actual `gh` under pressure.

## 1 — Look at the board and decide (∼35 changesets)

Start it on a repo with a real estate: `pnpm board`, then the **Agents** tab.

- [ ] **Every kind of row is distinguishable at a glance** — ticket, plan, PR,
      branch, release. *This is the one the operator reported as still broken.*
      `TupleRow.tsx` shipped in #293 with **zero call sites**; only
      `bug/one-component-renders-every-row` wires it, and that wave is not in
      this release. **Expect no change here, and confirm that is what you see** —
      the row is built, not connected.
- [ ] **Section, plan heading and row read as three levels.** Measured 12px for
      all three; `bug/a-section-is-not-a-row` is filed and NOT in this release.
      Same instruction: confirm the defect, do not be surprised by it.
- [ ] **The fold caret is visible, not just clickable.** 12px glyph in a 24px
      target. Also filed, also not in this release.
- [ ] A **WORKING** row opens a panel naming the agent, its pid, uptime, model
      and context — and the COMMAND field shows three lines with a scroller,
      not one clipped line (`the-command-has-a-size`).
- [ ] The panel's BRANCH, PLAN and WORKTREE are **destinations** — the first two
      navigate, the worktree copies (`the-panel-facts-are-destinations`).
- [ ] The **worker-log overlay** scrolls itself and not the page behind it, and
      keeps its scroll position across a pulse (`the-overlay-keeps-its-place`).
- [ ] **Statuses stack in ONE panel at the top**, most severe first, with a count
      and paging; a new one flashes then sorts in; the panel disappears when
      there is nothing (`a-degraded-view-says-so-at-the-top`).
- [ ] The **view-status line stays at the foot** and is not in that panel.
- [ ] A **failing check** shows its step and an age, not an ISO timestamp and not
      a wrapped file list — the files are behind the `⋯` menu
      (`a-failure-is-shown-not-dumped`).
- [ ] **Every row in WAITING ON YOU has a `⋯` menu**, and its entries fit the
      kind — a ticket offers *Create plan*, a plan offers *Approve*
      (`the-menu-fits-the-kind`, `every-action-is-in-the-menu`).
- [ ] **NOT STARTED holds its order across pulses.** Watch it for a minute
      through several 5s refreshes; equal-age rows must not reshuffle
      (`the-order-holds-still`, `plans-of-equal-age-order-by-name`).
- [ ] A **held branch reads as somebody working**, not as nobody, and names the
      holder rather than a raw path (`a-held-branch-is-not-idle`,
      `the-board-says-who-holds-a-branch`).
- [ ] The **Design column contains plans in the Design phase** — not
      approved-but-unstarted ones, which now sit in Development
      (`the-design-column-means-design`).
- [ ] A **branch row names its wave** where its plan has more than one, and
      prints **no plan phase** (`a-branch-row-names-its-wave`,
      `the-wave-and-the-phase-find-their-owners`).

## 2 — Click the things that write (∼8 changesets)

These call an agent or the host. **Each is one click and then a wait**; the
failure mode being tested is a button that accepts a click and does nothing.

- [ ] **Start work** on an eligible row. It must claim, create a worktree, and
      start a worker — and the row must move. *Known gap: the board's dispatch
      writes no brief. See §5.*
- [ ] **Start work on a row that cannot be started** refuses **with its reason on
      the control**, before the click (`the-button-claims-only-what-it-knows`,
      `eligible-says-whether-it-can-start`).
- [ ] **Create plan** on a ticket row. Newly configured this session (`Idea
      command`); `/api/board` reports `idea.available=true`. It must start an
      agent that writes a Draft plan naming the issue.
- [ ] **Approve** on a Draft plan row.
- [ ] **Continue** an agent that stopped to ask: answering must start a **new
      run**, not append to the old one (`continue-with-an-answer`).
- [ ] Both acting buttons **refuse a second click in the same tick** and carry a
      spinner beside their label while in flight.

## 3 — Measure, do not assert (∼8 changesets)

Do these on an **idle machine, no agents running**. Every figure in this
release's perf work was taken under fleet load and is recorded as unestablished.

- [ ] `time skills/plot/scripts/plot-fleet-scan.sh` — compare against the 22s
      this repo reached after batching (`the-scan-reads-refs-in-one-call`,
      `the-scan-walks-a-branch-once`, `the-scan-walks-history-in-one-call`).
- [ ] `time pnpm run test:board` — the parallel split landed
      (`unit-tests-run-in-parallel`); **this is the number the plan owes and does
      not have.**
- [ ] With the board open, watch a PR go green on the host: the row must follow
      within one PR-refresh interval, not one scan interval
      (`the-cadence-knows-what-a-refresh-costs`).
- [ ] Kill the scan mid-run and read the timeout note. It must name the counts it
      measured and **must not** claim pruning worktrees helps — that claim was
      falsified and removed (`the-timeout-report-drops-what-it-cannot-measure`).

## 4 — Needs a real host under pressure (3 changesets)

Not reproducible locally. Verify on a day the API is actually throttling, or skip
and record as unverified — **do not** mark these passed from a stubbed host.

- [ ] A spent rate limit produces a note that **says so and names when service
      returns**, distinct from an unreachable host
      (`the-note-names-the-rate-limit`).
- [ ] The wait comes from the **host's stated reset**, not a constant
      (`the-wait-comes-from-the-host`).
- [ ] The **issue poll** backs off on a rate limit the way the PR refresh does
      (`every-host-consumer-slows-down`).

## 5 — Full lifecycle walkthrough (the skills)

`CLAUDE.md`: *"Behavioral testing is manual. The skills have no unit tests."*
Fifteen changesets here touch skills or helper scripts, so this is not optional.

- [ ] `/plot-idea` → `/plot-approve` → `/plot-implement` → `/plot-deliver` on a
      throwaway plan, in a repo **with no symlink index**
      (`the-lifecycle-does-not-need-the-symlink`,
      `the-scan-derives-its-plan-list`, `reconcile-calls-the-index-advisory`).
- [ ] A plan in phase **Design** passes the two pre-Approved gates and appears in
      the Design column (`design-is-a-phase`, `the-gates-know-design`).
- [ ] `/plot-dispatch` on a plan with a **held** branch: it must refuse that one
      and name the worktree, not offer it (`dispatch-refuses-a-held-branch`).
- [ ] **KNOWN GAP — check and record, do not fix here.** After a **board** *Start
      work*, is there a `.plot/briefs/<branch>.md`? Measured today: **no.** Only
      the `/plot-dispatch` skill writes one, by invoking `/plot-implement`;
      `plot-dispatch.sh` cannot, and the board calls the script. Yet the
      `Worker command`'s first instruction is *"Read `.plot/briefs/…` first — it
      is the specification"*, so a board-started agent reads a missing file and
      improvises. Measured on `bug/one-component-renders-every-row`: an agent ran
      2:12 against a 700-line wave with no brief.
- [ ] The launch writes `.plot/agents/<session>.json` and the Agents tab lists an
      agent **with no branch** (`an-agent-outlives-its-branch`).

## What this list deliberately omits

- Anything a test already decides. 1845 automated assertions pass on this
  candidate; re-checking them by hand would find nothing and cost an evening.
- `a-row-is-a-tuple` beyond §1's first item. The slots exist and are unwired;
  there is nothing to see until `one-component-renders-every-row` lands.
- The three defects filed today and **not** in this release
  (`a-section-is-not-a-row`, and the two the tuple wave will fix). They are in
  §1 so a tester confirms them rather than reporting them again.

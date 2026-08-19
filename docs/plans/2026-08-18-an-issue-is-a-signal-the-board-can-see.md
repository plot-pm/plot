# An issue is a signal, and the board cannot see it

> Three issues sat open for hours with measurements, line numbers and a proposed fix in each. The board showed none of them, because the board reads plans and an issue is not one — so the operator asked why work they had written down was invisible.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Sprint:** the-board-tells-the-truth
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `feature/the-board-sees-unplanned-issues`
- **Delivered:**
- **Released:**
- **Started:** 2026-08-19, Jan Wloka, `feature/an-issue-becomes-a-plan`

## Changelog

- The board lists open tracker issues that no plan references, in WAITING ON YOU, with one action: turn it into a plan.

## Motivation

Observed 2026-08-18. Three issues were open — #226, #227, #228 — each written
by the operator with request counts, timings, file paths and line numbers
already in place. Each described a real defect. **None appeared on the board**,
and the operator's question was exactly right: *"ich sehe 228 nicht auf dem
Board?"*

The board reads `docs/plans/`. An issue is not a plan, so it is invisible —
correctly, by the current design, and uselessly, because the work exists and
nothing surfaces it.

### Why a phase called `Ticket` is the wrong answer

The obvious fix is a fifth phase before Draft. The manifesto forbids it, and
the reason is worth restating:

> Issues (or any equivalent) remain the **inbox** — signals, not commitments.
> […] Plans reference tickets; they never mirror their content, because copies
> age into lies.

The four phases describe **the path of a plan**. An issue has not entered that
path — it is the raw material, not the first step. A `Ticket` phase would make
Plot carry tracker state, which is the one thing the manifesto says it must
never do.

So the answer is not a new phase. It is **a row that is not a plan.**

### What the row is for

The section rule this repo settled on earlier the same day: **WAITING ON YOU is
for things that need a human decision.** An unplanned issue is precisely that,
and the decision is not *fix it* — it is *is this worth a plan?*

That distinction is what makes the row honest. A board that listed issues
alongside plans would be a second tracker. A board that lists issues **nobody
has decided about yet**, with one action, is an inbox with a door into the
workflow.

## Design

### Approach

**A third row type, read-only, with one action.**

The board already renders plan rows and branch rows. An issue row carries what
the host reports — number, title, age — and nothing Plot invents. It appears
only when **no plan references it**, and disappears the moment one does.

The row takes **the shape of a PR row**, which the board already renders and a
reader already knows how to scan: a glyph, a number, and a link when the host
gave one. Only the glyph differs — an issue is not a pull request, and the icon
is what says so at a glance.

```
WAITING ON YOU (4)
  Discovery  scan-asks-once-per-branch                🎫 #228   2h   ⋯
                                                                     └ Create plan
  Discovery  a-blocked-wave-is-not-eligible           🎫 #227   3h   ⋯
```

**The plan-name column carries an inferred name, and it is not a link.** The
name is derived from the issue's title so the row reads like every other row in
the section — but nothing is behind it yet, and a link to a plan that does not
exist is the fabrication this board keeps removing. A row whose name links
nowhere is honest about being a proposal.

**The branch column is empty**, because there is no branch. Showing a derived
branch name would put a plausible identifier where nothing exists — and the
next reader could not tell it apart from a branch nobody has claimed, which is
a row this board already renders and means something else entirely. The name
that `/plot-idea` eventually chooses is its decision, made with the whole
problem statement in hand rather than from a title.

**The number links to the tracker**, following the PR cell's own rule exactly:
a host that reported no address renders the number as plain text rather than as
an invented link (`AgentList.tsx:3708-3722`).

**The reference is what makes it disappear.** A plan that names `#228` in its
body removes the row — no state is written back to the tracker, no label, no
close. The link is one-directional and lives in the plan, which is the
manifesto's rule stated as a mechanism.

### The action

*Create plan* hands the issue to `/plot-idea` with its number and body as the
problem statement. `/plot-idea` already takes a free-form brain dump as its
preferred input (Manifesto Principle 11), which is exactly what a well-written
issue is.

**It creates a Draft, never an approved plan.** The decision the row exists for
is *is this worth planning*, and the answer to that is a plan to review — not
work already committed to.

### What it does not do

**It does not mirror issue state.** No labels, no assignees, no close-on-merge,
no status sync. The row shows number, title and age because those are what a
human needs to decide; anything more would be the copy the manifesto warns
about.

**It does not list every issue.** Only those no plan references. An issue
someone decided against is closed on the tracker, where that decision belongs;
an issue with a plan is already on the board as that plan.

**It does not write to the tracker.** Read-only, in both directions except the
plan's own reference.

### Cost

One `gh issue list` / `bb` equivalent per PR refresh — the same cadence, the
same adapter. `docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md`
is about exactly this cost on Bitbucket, and **this feature must not land
before it**: adding a per-refresh call to a board that already exceeds its rate
limit would make a measured problem worse.

### Open Points

- [ ] How is "referenced by a plan" detected? A plain `#228` in a plan body is
      cheap and ambiguous — plans mention PR numbers constantly, and
      `plot-plan-meta.sh` already reads only `→ #NNN` for that reason. A
      dedicated field (`Issue: #228`) is unambiguous but is one more thing to
      remember.
- [ ] Do repos without a tracker see anything? `plot-host.sh backend` knows,
      and a repo with no issues must render nothing rather than an empty
      section that implies something is missing.
- [ ] Should a *closed* issue with an open plan say something? That is the
      inverse drift — work planned for a signal that has been withdrawn.
- [ ] How is the plan name inferred from a title? A slug of the first words is
      cheap and often wrong; a model reading the issue produces the name a
      human would write. The row is a proposal either way, so a mediocre name
      costs little — but it is the name a reader scans, and the same question
      is answered elsewhere in this repo by naming the step Frontier.
- [ ] Does the empty branch column look broken rather than deliberate? Every
      other row in the section carries one. Worth a look at the rendered board
      before deciding whether it needs a dash, a word, or nothing at all.

## Branches

- `feature/the-board-sees-unplanned-issues` — the host adapter reports open issues, and the board lists those no plan references, in WAITING ON YOU, read-only. The row reuses the PR cell's shape with an issue glyph: an inferred plan name that is **not** a link, an **empty** branch column, and the number linking to the tracker. Tests: an issue with no referencing plan appears; one referenced by a plan does not; the inferred name renders as text and not as an anchor; the branch column is empty rather than carrying a derived name; an issue whose host gave no URL renders its number as plain text, as the PR cell already does; a repo with no tracker renders nothing rather than an empty section; a failed issue lookup reads as unknown rather than as "no issues" — the rule `an-outage-is-not-an-answer` established and this session applied five times. → #236

- `feature/an-issue-becomes-a-plan` — the row's one action hands the issue to `/plot-idea` as a problem statement, producing a Draft that references the issue. Tests: the created plan names the issue; the row disappears once it does; the plan is Draft, never Approved; nothing is written to the tracker.

## Notes

Prompted by an operator asking why an issue they had just written was not on
the board, then asking whether the answer was a `Ticket` phase. It is not — and
that question is what produced the design: the row is not a plan in an earlier
state, it is a signal that has not become one yet.

Depends on `2026-08-18-the-scan-asks-once-not-once-per-branch.md` for cost.

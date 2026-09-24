# The board shows me only my work

> A "My work" checkbox that filters the board to the rows a person is answerable for. The board today can render every row and name none of them as anybody's: there is no current-user concept in it, `Assignee:` is in the parser and in no template, and a PR row carries four fields of which none is an author.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #967

## Changelog

- The board offers a **My work** checkbox that hides every row nobody can attribute to the reader. WAITING ON YOU answers *what needs a person*; this answers *which person*, which on a shared estate are different questions and today only the first is asked.

Board impact: **yes, entirely.** New schema fields, a new domain rule, a new control. The reading that identifies the reader is a new adapter capability.

## Motivation

WAITING ON YOU is the board's answer to *what needs a human?* On a one-person estate that is the same as *what needs me*, and the board has been built and measured on a one-person estate. It is not the same question, and the section's name quietly asserts it is.

**The cost is paid at the top of the list.** WAITING ON YOU is the first section and the one that earns the board its place. Every row in it that belongs to somebody else is a row the reader must classify and dismiss, and that work scales with the team while the reader's attention does not.

## Design

### What was measured, 2026-09-24

**The board cannot name a row's owner, and the fields that look like they would do not.**

| Reading | Result |
|---|---|
| Current-user concept in `packages/board/src` or `packages/domain/src` | **none** — no `whoami`, no `currentUser`, no `user.email` |
| Plans carrying `Assignee:` | **71 of 321 (22%)**, and **none since 2026-08-30** |
| `Assignee:` in either plan template | **absent from both** — `.plot/templates/plan.md` and the shipped one |
| Spellings in those 71 | **three** — `eins78`, `jwloka`, `Jan Wloka`; the last two are one person |
| Fields on a PR row (`CardPrSchema:262-303`) | `number`, `url`, `checks`, `mergeable` — **no author** |
| Author fields anywhere in the schema | **one**, `StorySchema.author:836`, stories only |
| `gh api user --jq .login` | **`jwloka`** — the host knows |
| `git config user.email` | `jan.wloka@quatico.com` — the machine knows |

**So `Assignee:` cannot be the answer.** It is not under-used, it is **abandoned**: the parser reads a field nothing writes, no template offers it, and a filter keyed on it would hide 78% of plans while splitting one person's work across two spellings.

### The design question this plan exists to settle

**Who is "me", and what makes a row mine?** Those are two questions and both are open.

**Identity** has two candidate sources, and they disagree in spelling for the same person: `git config user.email` (`jan.wloka@quatico.com`) and the host login (`jwloka`). A reading that answers one cannot match a row annotated with the other.

**Ownership** has no source at all for three of the four row kinds:

| Row kind | What could make it mine | Available today? |
|---|---|---|
| Plan | `Assignee:` | abandoned — 22%, none since 08-30 |
| PR | its author | **not on the row** — 4 fields, no author |
| Issue | its assignee | not read; `issue-list` omits it |
| Agent | the desk I dispatched | **`start_marker` / the manifest are machine-local** — this machine's agents are mine |

**The agent row is the one that already works**, and it suggests the shape: *mine* is answerable from what this machine did, without anyone annotating anything.

### Three candidate definitions, and the recommendation

**A. Annotation** — revive `Assignee:`, add it to the template, backfill.
Honest and explicit; **rejected as the first slice.** It requires every plan author to maintain a field that has been ignored for a month, and it answers nothing until they do. A filter that is empty on an estate of 321 plans teaches the reader it is broken.

**B. Authorship, derived** — a row is mine when the host says I opened its PR, or git says I wrote its commits.
**Recommended.** It needs no new discipline, it is true retroactively over the whole estate, and both readings exist already: the host CLI is behind `plot-host.sh` and git authorship is one `git log` away. Its cost is a schema field on the PR row and a reading in the connector.

**C. Locality** — mine is what this checkout and this machine touched.
Cheapest and already true for agent rows. **Wrong alone**: it makes a colleague's PR mine if I fetched it, and stops my own work being mine on a second machine.

**The recommendation is B, with C for agent rows**, where the machine's own record is the better answer and already exists.

### Where each piece belongs

The layering rule decides this and there is no latitude:

- **Identity is a reading, so it comes through an adapter.** *Who is the user* is a fact about the world; the host connector already authenticates and can answer it. It is **not** a domain concern and must not be a `## Plot Config` key — a config key is a second copy of a fact the host already holds, and it goes stale silently.
- **Ownership is a rule, so it lives in the domain.** `isMine(row, identity)` is a pure function over a reading, unit-testable without a browser, and it is the plan's whole substance. CLAUDE.md: *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."*
- **The checkbox is a control, so it renders.** It flips a boolean, the domain filters, the component shows what survives.

### Where the state lives, and it is not the URL

`collapse.ts:20-38` settles the convention by argument, and the argument transfers exactly:

> **a URL is shareable, and collapse state should not be.** … A link carrying `?collapsed=quiet,done` would hand my personal tidying to whoever opened it.

**`?mine=1` is worse than `?collapsed=`**: it would hand my filter to a colleague whose *mine* is a different person, and rebuild their board around my identity. So: `localStorage`, beside the collapse key, for the same stated reason.

### What this does NOT do

- **It does not add an assignment workflow.** Nothing in Plot assigns work to a person, and this must not become the feature that quietly requires it.
- **It does not change what WAITING ON YOU means.** The section keeps answering *what needs a person*; the checkbox subtracts from the view, never from the section's rule.
- **It does not default to on.** An empty board is the worst failure here, and a reader who has not asked for a filter must never meet one.
- **It does not filter DONE.** *What shipped* is the estate's business, not the reader's.
- **It does not guess.** A row whose owner cannot be determined is **shown**, never hidden. Hiding on an absent reading is how a filter loses work silently, and this estate has already measured that shape: `plot-release-refs.sh` permits on `unknown` for the same reason.

### #967 answers this plan's biggest objection

**Filed 2026-09-24 from a four-contributor estate, and it supplies what this plan said it lacked.** The draft's riskiest assumption was that no shared estate existed to test against — *"a filter that hides nothing looks identical to a filter that works."* The issue measures one:

- **11 open PRs, 9 belonging to other people** — 4, 3 and 2 across three colleagues, 2 the reader's
- **18 rows in WAITING ON YOU, 2 actionable**
- three of the bare branches carry colleagues' open PRs

**And it confirms the author data exists at the host**: `bb pr list --json` returns an `author` field per PR, the GitHub arm the same, and `plot-host.sh` already knows the term. *"The gap is the hand-off"* — `plot-fleet-scan.sh` does not carry the author through, and `/api/board` exposes `author` only on stories.

That is precisely slice 2's scope, independently measured. **The recommendation of derived authorship over `Assignee:` is therefore no longer only an argument from this estate's abandoned field** — it is what the reporting estate's data already supports.

**The issue also proposes the larger version**: splitting WAITING ON YOU along three questions — *my tasks*, *my results*, *my problems* — noting the verdicts already carry enough, so *"the grouping is a rename of what the data says, not a new inference."* **That is deliberately not in this plan's slices.** It is a section redesign whose value depends on whether the filter alone suffices, and shipping the filter first is what answers that.

### Open Questions

- [ ] **Which identity is canonical when the two disagree?** The host says `jwloka`, git says `jan.wloka@quatico.com`. Does the connector answer both and the rule match either?
- [ ] **Does the filter alone suffice, or is the three-way split needed?** #967 proposes both. The filter is smaller and answers *most of this is not mine*; the split answers *these are different kinds of thing*. **Ship the filter and re-read the section before deciding** — and if the split wins, it is its own plan.
- [ ] **Is an unowned row mine if I dispatched its agent?** Locality and authorship disagree for a slice I dispatched but did not write.

### Done when

- A reader can tick **My work** and see only rows attributable to them; unticking restores every row.
- **`isMine` is a domain function with unit tests**, and the browser test asserts only that the checkbox shows what the domain decided.
- **A row with no determinable owner is shown**, and a test pins that — the regression this must not cause.
- The default is off, and a first visit sees an unfiltered board.
- The setting survives a reload and is **not** in the URL.

## Slices

Three slices, and the first is a reading with no UI. The order is deliberate: **nothing can be filtered before the board can name one owner.**

### The board knows who is asking (Branch: feature/the-board-knows-who-is-asking)

- `feature/the-board-knows-who-is-asking` — a connector reading that answers the current identity from the host CLI, with git's `user.email` beside it; carried in the board payload; no filtering and no control, so the reading can be proved before anything depends on it

### A row says whose it is (Branch: feature/a-row-says-whose-it-is)

- `feature/a-row-says-whose-it-is` — the PR row gains an author from the host, the agent row reports the machine's own record, and `isMine(row, identity)` decides in the domain with unit tests including the unowned-row-is-shown arm

### The board filters to my work (Branch: feature/the-board-filters-to-my-work)

- `feature/the-board-filters-to-my-work` — the checkbox, defaulting off, persisted in `localStorage` beside the collapse key; a browser test that the control shows what `isMine` decided and that unticking restores every row

## Notes

- The three slices are a wave order, not a cohort: slice 2 cannot be built before slice 1 answers *who*, and slice 3 has nothing to filter on before slice 2.
- **The riskiest assumption was that this estate could test it, and #967 removes it.** Every reading in this plan comes from a one-contributor repository, where a filter that hides nothing looks identical to one that works. The issue measures a four-contributor estate with 9 of 11 PRs belonging to other people — that is the mixed-ownership case, and slice 2's fixture should be built from its shape rather than invented.
- `Assignee:` is left alone. This plan neither revives nor removes it — that it is read by a parser and written by nothing is a separate finding, and deleting a field 71 plans carry is not this plan's call.

# Discovery and Planning filter to Only my work

> The Discovery tab gets an *Only my work* filter, and the Planning tab's existing filter learns who authored and who approved a plan. Both reuse the one ownership rule that the Delivery tab already uses.

## Status

- **State:** Released
- **Type:** feature
- **Issue:** #1751
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1755 merged
- **Started:** 2026-10-15, Jan Wloka, `feature/ownership-reads-story-authors`
- **Started:** 2026-10-15, Jan Wloka, `feature/a-plan-card-names-its-owners`
- **Started:** 2026-10-15, Jan Wloka, `feature/discovery-filters-to-only-my-work`
- **Delivered:** 2026-10-15
- **Released:** 2026-10-16, v2.27.1

## Changelog

- The Discovery tab has an **Only my work** checkbox. With it on, the tab shows the tickets assigned to the reader and the stories the reader authored.
- On the Planning tab, **Only my work** also keeps a plan the reader authored or approved, not only a plan whose `Assignee:` names the reader.

<!-- Board impact: yes. `OwnedRow` gains a `story` arm and its `plan` arm gains an author and an approver. The plan card in the board payload gains those two fields. Discovery gets a control and a domain filter over its lanes. The plan format and the helper scripts do not change. -->

## Motivation

Issue #1751 (maintainer, 2026-10-15) asks for one filter on two tabs. A reader on a shared estate sees every ticket, story and plan, and must skip the rows that belong to somebody else.

The board already answers this question on two other surfaces. The rule exists; two of the three tabs the issue names do not use it yet for the rows the issue lists.

## Design

### Measured state

Read on `origin/main` at `7a4ceaec4`, 2026-10-15. Nothing here is a runtime measurement.

| Surface | What it does today | Where |
|---|---|---|
| Delivery tab | **Only my work** hides PRs by author, registry agents by desk, and tickets by assignee | `AgentList.tsx:992`, `mine-filter.ts` |
| Planning tab | **Only my work** hides a plan card by its `Assignee:` line only | `App.tsx:1189`, `boardForReader` at `mine-filter.ts:192` |
| Discovery tab | No filter. Controls are the topic cloud, the `?show=` group control and the archived toggle | `StoriesTab.tsx` |
| The rule | `ownership` and `isMine` answer `mine`, `theirs` or `unknown` for a `pr`, `agent`, `plan` and `ticket` row. There is no `story` arm | `packages/domain/src/rules/ownership.ts:135` |
| Identity | The server holds the host login, git email and `People` directory. `readerFrom` hands them to the client | `server-info.ts`, `mine-filter.ts:119` |
| Ticket spelling | A ticket assignee matches by host login, or by a declared `People` spelling `<prefix><account>` for a tracker account | `ticketOwnership`, `ticketSourceOf` |
| Story author | `Story.author` is free text, and it is the only author field in the payload | `entities/story.ts:42` |
| Plan approver | `plot-plan-meta.sh` reports `approved_raw`, e.g. `2026-07-30, alice, in-session`. The plan card carries no approver and no author | `plot-plan-meta.sh:269` |
| Persistence | One `localStorage` key, `plot-board:agents:mine-only`, shared by every tab. `App.tsx:232` re-reads it when the tab changes | `mine-filter.ts:17` |

**The checkbox state is one value for all tabs today.** A reader who turns it on in Delivery finds it on in Planning and, after this plan, in Discovery. The plan keeps that and does not add a second state.

### Approach

The change has three parts, in the order the layering rule gives.

**1. The rule, in the domain.** `OwnedRow` gains `{ kind: 'story'; author?: string }`. A story is `mine` where its author resolves to the reader through `resolvePerson`. It is `theirs` only where the directory declares the author's spelling for another person, as `planOwnership` does. An undeclared spelling is `unknown` and stays in view. The plan arm gains `author` and `approver` beside `assignee`. A plan is `mine` where any of the three resolves to the reader. A plan is `theirs` only where a declared spelling names another person and none of the three names the reader. Everything else is `unknown`.

**2. The data, in the payload.** The plan card gains the approver, parsed from `approved_raw` in the domain. The author needs a source (see Open Questions). The story row already carries `author`.

**3. The control, in the view.** Discovery gets the checkbox. A pure function `lanesForReader` filters story lanes and tickets with `isMine`, and runs before `lanesForTopic`, so the topic cloud counts only the rows on screen. A lane that the filter empties says so, as a lane that a topic empties says so today. Tickets keep `ticketOwnership` unchanged: assigned to me is `mine`, assigned to another declared person is `theirs`, unassigned is `unknown` and stays.

**Reuse, not a second rule.** The issue says the Delivery owner filter's rule is reused. The Delivery tab reads `isMine`. This plan adds arms to that one function and writes no second predicate.

**Every rendered state is a domain property.** The filtered lanes, the topic counts after filtering, and the hidden-row sentence come from domain functions with unit tests. One browser test proves the checkbox shows them.

**A row with no determinable owner stays.** This is the rule of `rules/ownership.ts` and the plan keeps it. A filter that hides on an absent reading loses work silently.

### Open Questions

- [ ] **How does a plan have an author?** No field records it. Option A: the person named in `Approved:` and `Started:` counts, and "authored" means the `Assignee:` line plus the git author of the commit that added the plan file. Option B: add an `Author:` line to the plan template, written by `/plot-idea`. Option A reads existing plans with no backfill. It costs one `git log` pass in an adapter and needs the git email declared as a `People` spelling. Option B is explicit and costs a backfill. Recommendation: A, measured first for its cost per board refresh; B only if A is too slow or the email mapping is too fragile.
- [ ] **Does the state live in the URL or in `localStorage`?** The issue says the state survives a reload "as `?show=` does". `?show=` is in the URL. `collapse.ts` and the shipped *My work* plan (`the-board-shows-me-only-my-work`) settled that a personal filter stays out of the URL, because a shared link would rebuild a colleague's board around the sender's identity. Recommendation: keep `localStorage`, which survives a reload and is what the Delivery and Planning checkboxes use.
- [ ] **Does "approved" apply to a story?** Stories carry an author and no approval record. The plan treats a story as owned by its author only. Confirm.
- [ ] **One state or one per tab?** The shared key means one checkbox state across tabs. Confirm that this is wanted, since a reader may want Discovery filtered and Delivery not.
- [ ] **What does the filter do for a reader with no host login?** `unknown` rows stay, so the filter hides nothing. Decide whether Discovery shows a notice, as *Waiting on you* does for an unmatched reader.

## Slices

### The rule

- `feature/ownership-reads-story-authors` → #1771 — `OwnedRow` gains the `story` arm; the `plan` arm gains `author` and `approver`; unit tests in `packages/domain/test/ownership.test.ts` for each `mine`, `theirs` and `unknown` case. <!-- builds: storyOwnership, a story arm in the ownership rule -->

### The data

- `feature/a-plan-card-names-its-owners` → #1775 — the plan card carries the approver and the author; the story row carries `author` into the owned row. `Approved:` parsing lives in the domain. <!-- waits: feature/ownership-reads-story-authors --> <!-- builds: approverOf, the approver named by an approval record -->

### The control

- `feature/discovery-filters-to-only-my-work` → #1789 — the Discovery checkbox, `lanesForReader` ahead of `lanesForTopic`, the topic counts and the empty-lane sentence, and one browser test with a stubbed payload. <!-- waits: feature/a-plan-card-names-its-owners --> <!-- builds: lanesForReader, the Discovery filter over story lanes and tickets -->

## Notes

- 2026-10-15, drafted from issue #1751 by `/plot-idea`. Nothing was written to the tracker. The plan's `Issue:` field is the only link.
- 2026-10-15, ceremony: `Review: pr` and `Impl: own branches`. Three slices with a dependency order need a PR for plan review. The run was unattended, so the two ceremony questions were not asked.
- 2026-10-15, design question: no explicit `Design: yes` in the prompt, so the plan starts in Draft.
- 2026-10-15, deliverable search: `Only my work filter`, `storyOwnership` and `lanesForReader` found no existing artifact. `isMine`, `ownership` and `boardForReader` exist and are reused.
- 2026-10-15, overlap: `the-board-shows-me-only-my-work` (Released) built the checkbox and the rule. `the-board-has-three-tabs` extended it to tickets on the Delivery tab. This plan extends it to the two tabs and the two row kinds those plans left out.

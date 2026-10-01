# A plan row names its ticket

> A plan that answers a tracker issue records it in `Issue:`, and the board's plan row shows only the slug. A ticket row shows `1100: <title>`; the plan that answers it should show `1100: <slug>`.

## Status

- **State:** Released
- **Approved:** 2026-09-30, jwloka, in-session
- **Started:** 2026-09-30, jwloka, `feature/a-plan-row-names-its-ticket`
- **Type:** feature
- **Issue:** #1104
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Delivered:** 2026-09-30
- **Released:** 2026-10-01, v2.22.0

## Changelog

- A plan row names the tickets its plan answers before the plan link, as `1089: <slug>` or `EWZKUS-3430: <slug>`, the same shorthand a ticket row uses.

Board impact: yes. `CardSchema` and `DraftPlanSchema` gain an `issues` field, and the plan row's name cell gains a prefix.

## Motivation

A person reading the board meets a ticket by its key: the WAITING ON YOU ticket rows print `1100: The supervisor's queue ignores waits:…`, and Jira users know their work as `EWZKUS-3430`. Once a plan answers the ticket, the ticket row leaves the inbox, because the board lists only issues no plan references, and nothing on the board carries the key any more. The link between the ticket a person filed and the plan that answers it is then readable only inside the plan file.

## Design

### The key comes from the parser

`plot-plan-meta.sh` already parses `- **Issue:**` into `issues[]` (`plot-plan-meta.sh:318-327`). Measured 2026-09-30: `#1089` emits `[1089]` and `#1090, #1091` emits `[1090,1091]`, JSON numbers; with a `jira` or `linear` tracker `EWZKUS-3430` emits `["EWZKUS-3430"]`, a string; with any other tracker a key is dropped. Nothing new is parsed.

### The payload carries it

**The board's parse keeps it.** `readPlanMeta` (`board.ts:1121-1130`) parses each parser line through `PlanMetaSchema` (`contract/schema.ts:61`), which has no `issues` field, so zod drops it before either builder reads it. `PlanMetaSchema` gains `issues: z.array(z.union([z.number(), z.string()])).default([])`.

`CardSchema` and `DraftPlanSchema` (`packages/board/src/contract/schema.ts`) gain `issues: z.array(z.string()).default([])`, holding each key as the ticket row prints it: the number without `#` for a GitHub issue, the key as written for Jira or Linear. The card builder (`board.ts:2007`) and `draftPlanOf` (`board.ts:2278`) copy it from the parsed plan with `.map(String)`, so `1089` arrives as `"1089"`. `.default([])` keeps an older server's payload valid.

### The row prints it

`tupleFromPlan` (`packages/board/src/app/lib/tuple-row.ts:1269`) takes the plan's issues and builds the name label as `${issues.join(', ')}: ${plan}` where there is at least one, and `plan` alone otherwise. It is the ticket row's own form, `${issue.number}: ${issue.title}` (`tuple-row.ts:1193`), applied to the plan. The key is part of the label and of the plan link, and the link still opens the plan.

Every caller of `tupleFromPlan` passes the issues it has: the plan row in `rows.tsx` from the card, and the draft plan row in `draft-plan-row.tsx` from the draft entry. The board client casts the payload rather than parsing it, so each read uses `?? []`.

### What this does NOT do

- **It does not link the key to the tracker.** The prefix is part of the plan link; a ticket URL per key would need the tracker's URL form, which the plan row does not have.
- **It does not change which issues the inbox lists.**

## Done when

- Server tier: a fixture repository whose plan names `#1089` yields a card with `issues: ["1089"]`, and a Draft plan naming `#1090, #1091` yields a draft entry with `["1090", "1091"]`.
- Server tier: a fixture repository whose `CLAUDE.md` sets `Tracker: jira …`, served with `PLOT_REPO_ROOT` pointing at it, yields `issues: ["EWZKUS-3430"]` for a plan naming that key.
- Browser: a plan row whose card carries `["1089"]` renders `1089: <slug>`, one carrying `["1090", "1091"]` renders `1090, 1091: <slug>`, one carrying `["EWZKUS-3430"]` renders `EWZKUS-3430: <slug>`, and a Draft plan row prints its prefix the same way.
- Browser: a card with no `issues` field, as an older server sends, renders the slug alone and throws nothing.

## Slices

### A plan row names its ticket (Branch: feature/a-plan-row-names-its-ticket, PR: #1105)

`PlanMetaSchema`, the two payload schema fields, the two server builders, `tupleFromPlan` and its two callers, and the browser tests. <!-- builds: the plan row's ticket prefix -->

## Notes

**Implementation note from round 2.** `test/unit/draft-plan-row.test.ts:27` compares the whole draft entry with `toEqual` and changes when `draftPlanOf` adds `issues: []`; update it in this slice.

Requested by the operator on 2026-09-30, with the format `1089:` and `EWZKUS-3430:`.

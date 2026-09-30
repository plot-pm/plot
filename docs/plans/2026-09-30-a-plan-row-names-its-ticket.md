# A plan row names its ticket

> A plan that answers a tracker issue records it in `Issue:`, and the board's plan row shows only the slug. A ticket row shows `1100: <title>`; the plan that answers it should show `1100: <slug>`.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #1104
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan row names the tickets its plan answers before the plan link, as `1089: <slug>` or `EWZKUS-3430: <slug>`, the same shorthand a ticket row uses.

Board impact: yes. `CardSchema` and `DraftPlanSchema` gain an `issues` field, and the plan row's name cell gains a prefix.

## Motivation

A person reading the board meets a ticket by its key: the WAITING ON YOU ticket rows print `1100: The supervisor's queue ignores waits:…`, and Jira users know their work as `EWZKUS-3430`. Once a plan answers the ticket, the ticket row leaves the inbox, because the board lists only issues no plan references, and nothing on the board carries the key any more. The link between the ticket a person filed and the plan that answers it is then readable only inside the plan file.

## Design

### The key comes from the parser

`plot-plan-meta.sh` already parses `- **Issue:**` into `issues[]`: `#N` in every repository, and `KEY-N` where `Tracker` is `jira` or `linear` (`plot-plan-meta.sh:318-327`). Nothing new is parsed, and a repository whose tracker the parser does not read as keyed keeps `#N` only, unchanged.

### The payload carries it

`CardSchema` and `DraftPlanSchema` (`packages/board/src/contract/schema.ts`) gain `issues: z.array(z.string()).default([])`, holding each key as the ticket row prints it: the number without `#` for a GitHub issue, the key as written for Jira or Linear. The card builder and the draft-plan builder in `packages/board/src/server/board.ts` copy it from the parsed plan. `.default([])` keeps an older server's payload valid.

### The row prints it

`tupleFromPlan` (`packages/board/src/app/lib/tuple-row.ts:1269`) takes the plan's issues and builds the name label as `${issues.join(', ')}: ${plan}` where there is at least one, and `plan` alone otherwise. It is the ticket row's own form, `${issue.number}: ${issue.title}` (`tuple-row.ts:1193`), applied to the plan. The key is part of the label and of the plan link, and the link still opens the plan.

Every caller of `tupleFromPlan` passes the issues it has: the plan row in `rows.tsx` from the card, and the draft plan row in `draft-plan-row.tsx` from the draft entry. The board client casts the payload rather than parsing it, so each read uses `?? []`.

### What this does NOT do

- **It does not link the key to the tracker.** The prefix is part of the plan link; a ticket URL per key would need the tracker's URL form, which the plan row does not have.
- **It does not change which issues the inbox lists.**

## Done when

- A plan whose `Issue:` is `#1089` renders its plan row as `1089: <slug>`, and one naming `#1090, #1091` as `1090, 1091: <slug>`; a browser test asserts both, and a plan with no `Issue:` renders the slug alone.
- With `Tracker: jira …`, a fixture plan naming `EWZKUS-3430` renders `EWZKUS-3430: <slug>`.
- A Draft plan row prints the prefix the same way.
- A payload with no `issues` field, as an older server sends, renders the slug alone and throws nothing.

## Slices

### A plan row names its ticket (Branch: feature/a-plan-row-names-its-ticket)

The two schema fields, the two server builders, `tupleFromPlan` and its two callers, and the browser tests. <!-- builds: the plan row's ticket prefix -->

## Notes

Requested by the operator on 2026-09-30, with the format `1089:` and `EWZKUS-3430:`.

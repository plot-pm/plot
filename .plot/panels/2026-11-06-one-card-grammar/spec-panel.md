# Panel: one-card-grammar — Spec review before approval

- **Subject:** `docs/plans/2026-11-06-one-card-grammar.md` at round 4, `## Spec`
- **Date:** 2026-11-06
- **Commitment:** `Position: proceed | amend | reject`
- **Jurors:** operator (`spec-operator.md`), domain (`spec-domain.md`), implementer
  (`spec-implementer.md`), security (`spec-security.md`) — one rubric, the lens the
  only difference
- **Gate:** all four committed on the first pass; none sent back
- **Reconciliation:** `unanimous amend` — operator, domain, implementer, security

## What the jurors looked at

All four read the plan, `CLAUDE.md` and the code the plan cites, and checked the
citations — every juror reports them accurate. **None ran a test, a build or the
board**, and none called the host. Every finding below is from reading, so a
finding about runtime behaviour (what a throttled host renders, what an agent
writes) is a reading of the code, not an observation of it.

## Where independent lenses converged — the blocking set

The jurors were not told what the others found. A defect raised by two or more of
them from different positions is the strongest signal this panel produces.

| # | Finding | Raised by | Why it blocks |
|---|---|---|---|
| 1 | **`CardFacts` has no place for facts today's cards show**: type, rounds badge, spike state, cost / *not measured here*, verification, `notPushed`, the per-PR list, the story's objective preview. The schema gate would drop the free-text ones by construction. | operator, domain, implementer | The tracer deletes the plan's old fields; whatever has no facet disappears from the board. |
| 2 | **`next` cannot express the plan's own action table or today's refusals.** `primary` is required but three table rows have none; the `Reason` union lacks every reason `StartWorkButton.tsx:59-67` actually gives (no dispatch, no fleet scan yet, no eligible branch) and the `unapproved` the Open Questions name; `started` is not a disabling reason (Start work stays on to dispatch the next wave, `PlanCard.tsx:520`); `waits-on #3105` has no source and `Ref` has no slice kind; `ActionKind` lacks `needs-design` and story actions. | operator, domain, implementer | The schema gate freezes whichever guess the implementer makes. |
| 3 | **`lineage` cannot say "not read".** When plans are unreadable, `ticketPlansOf` returns null (`fleet.ts:1714`) and `ticketLanes` returns kept lanes; `lineage: Ref[]` then reads as *no plan* and offers *Create plan* — the 3102 defect, whenever the host is throttled. The PR-check counts have the same flaw: one `Known<…>` around the whole record cannot hold *5 green, 1 unknown*, and the vocabulary drifts from the domain's (`running` vs `ChecksSchema`'s `pending`, `conflicts` missing, a third unknown-reason set beside `HostReach`). | operator, implementer, domain | It breaks invariant 5, the one the plan leans on hardest. |
| 4 | **There is no ticket detail view to open.** Only `PlanModal` and `StoryModal` exist; ticket titles link to the host today (`StoriesTab.tsx:496`). No slice builds one. | operator, implementer | "Every title opens the board's own detail view" is unbuildable as sliced. |
| 5 | **The ticket → story link is underspecified at both ends.** The `issue:` validator is undefined: "this repository's git host" passes any github.com repo, and the `Tracker` key carries no project key to match a Jira key against (`plot-plan-meta.sh:376-384`). Most tickets reach a story through their **plan's** `Story:` field, which the index ignores. `DESIGN-story.md:484` already defines `issue:` in key form and is not cited. | security, operator, implementer | The trust boundary the plan names as its defence has no definition. |
| 6 | **`POST /api/idea` has no click-time behaviour** for two stories, a story closed since render, or an unreadable index; silence means *outside any story*, contradicting "unknown never reads as none" (`referencedIssues` refuses on a failed read, `idea.ts:403-416`). `add-plan` has no endpoint at all, and a story card's primary would send a slug from the browser. | security, implementer | The card's promise and the endpoint's behaviour can diverge. |

## Should-fix, also converging

- **Where facts are computed is misstated.** Ticket cards are decided in the
  browser (`StoriesTab.tsx:488`) and ticket lanes built in `discovery-lanes.ts:65`
  / filled at response time in `index.ts`, not in the `board.ts` build — operator,
  domain, implementer.
- **"Done when" can pass with the targeted defects intact** — no criterion names
  absence-as-content or the reasonless Start work on the Plans board, none covers
  a throttled host reading as unknown, `Swimlanes.tsx` is not covered, and the
  `Story:` / `issue:` criteria depend on what an LLM agent writes (test the prompt
  instead) — operator, domain, implementer.
- **More word-making domain rules than the two named**, and `statusDrift` has
  callers the plan misses (`standing.ts:83` → `plot-story-lint.sh`, `StoryModal.tsx`)
  — domain, implementer.
- **Undefined terms**: "live" story (does Draft count? 3170's story is Draft),
  each kind's `changedAt` source (tickets carry only `createdAt`), progress for a
  ticket with zero or several plans, `identity.number` for Jira keys — operator,
  domain.
- **Gate wiring**: the check script must be added to `ci.yml` and the `Local
  checks` key, then `./scripts/check-agents-md.sh --write` — implementer.
- **Trust details**: build the ticket → story index from `origin/<default>` (stories
  are read from the working tree today, `board.ts:2225-2262`); validate the slug's
  shape before it enters the brief and place it above the quoted issue body; state
  that `alerts[].value` and refs render as text only and cap `value` — security.

## Disagreements

**No juror disagreed on the position**, and none of the blocking findings is
contested by another juror. One tension is worth naming because it is the
decision the plan's author now owes:

- **Grow the plan or cut the promise.** Findings 4 and 6 can be closed two ways:
  build a ticket detail view and an `add-plan` endpoint inside this plan (operator
  and implementer read it this way), or narrow the Spec — a ticket title keeps
  opening the host, a story card offers no `add-plan` until an endpoint exists.
  Both are coherent; the panel does not choose.

## Shared blind spots

Four agreements from four lenses invite the question of what the lenses had in
common:

- **All four were the same kind of reader** — one model, one brief, reading code.
  None looked at the running board or a real reader using it, so the plan's core
  claim — that five fixed facets make cards findable without searching — is
  unexamined by everyone. Only a tracer in front of a person tests it.
- **No juror questioned the plan's size.** Every lens added scope (facets, reasons,
  views, endpoints, validators); none asked whether the Tickets wave should be its
  own plan, though the blocking set now touches three subsystems.
- **Not checked by anyone**: responsive / narrow layouts, the swimlane and modal
  views beyond citations, Bitbucket issue URL shapes, the cross-origin guard on the
  POST endpoints, and performance — the server-compute claim rests on reading,
  with nothing measured.
- **One pre-existing defect surfaced on this plan's path** (security, *could*):
  `StoryModal.renderMarkdown` (`StoryModal.tsx:14-31`) does not escape `"` and
  passes any link scheme, so a story's text could carry a `javascript:` link. Read,
  not demonstrated. The plan makes the story detail view the only place a story
  title opens, which raises its priority regardless of this plan's fate.

## For the caller

The panel's answer is **amend**: approve after the six blocking findings are
resolved in the Spec. Nothing here was acted on; the decision is the plan
author's.

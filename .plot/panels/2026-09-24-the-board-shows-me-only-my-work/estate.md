# Estate lens — the board shows me only my work

Position: amend

The plan's *direction* survives every check: no current-user concept exists, no filter has been attempted on ownership, `CardPrSchema` and `StorySchema.author` are quoted exactly, and the `collapse.ts` argument transfers. But **three claims in the measurement table are wrong or incomplete**, one of them load-bearing for the plan's central rejection of option A, and **slice 1's reading already exists in the estate, unexposed**. Amend, do not reject.

## What holds

| Claim | Verdict |
|---|---|
| No current-user concept in `packages/board/src` / `packages/domain/src` | **CONFIRMED.** Zero hits for `whoami`, `currentUser`, `current_user`, `user.email` across both trees. |
| PR row is 4 fields, no author | **CONFIRMED verbatim.** `packages/board/src/contract/schema.ts:262-303` — `number`, `url`, `checks`, `mergeable`. Nothing else. |
| Only author in the schema is `StorySchema.author` | **CONFIRMED.** `schema.ts:836`, `author: z.string().optional().default('')`, and it is the only `author:` *field* in 4000+ lines. |
| `gh api user` → `jwloka`; `git config user.email` → `jan.wloka@quatico.com` | **CONFIRMED both.** Also `git config user.name` → `Jan Wloka`. |
| `collapse.ts:20-38` argument | **CONFIRMED verbatim**, `packages/board/src/app/lib/agent-rows/collapse.ts:20-38`. The quoted sentence is exact. The transfer argument is sound and *stronger* than the plan states — see below. |
| #967's numbers | **CONFIRMED.** Issue filed 2026-09-24T10:26Z: 18 rows / 2 actionable, 11 open PRs / 9 others' (4+3+2), 13 bare branches. |
| No prior my-work / ownership filter | **CONFIRMED.** No plan proposes owner filtering. |

## Defect 1 — the Assignee count is right by accident, and the conclusion drawn from it is wrong

**"71 of 321 (22%)"** — the *number* 71 reproduces exactly via `plot-plan-meta.sh` (I ran it over all 331 plans: 71 non-empty `assignee`). **The denominator is stale: 331 plans, not 321**, so 21% not 22%. Minor.

**The real defect: 115 plan files carry an `Assignee:` line.** The parser reports 71 because `plot-plan-meta.sh:863` gates the field on `section == "approval"` — it reads `Assignee:` **only under `## Approval`**. 44 plans write it under `## Status` and the parser silently drops them:

```
docs/plans/2026-08-16-agent-view-phase.md:10  - **Assignee:** jwloka   → parser reports assignee:""
```

Recomputed spellings differ accordingly:

| | plan says | grep over files | parser |
|---|---|---|---|
| `jwloka` | — | 62 | 16 |
| `Jan Wloka` | — | 51 | 51 |
| `eins78` | — | 4 | 4 |
| **total** | **71** | **117 lines / 115 files** | **71** |

So the plan's sentence *"the parser reads a field nothing writes"* is **backwards**. The field is written 115 times; **the parser fails to read 44 of them.** That is a parser defect this plan has walked past while citing the parser as its evidence. Adoption is **35% (115/331), not 22%** — still a minority, so option A stays correctly rejected, but the stated reason ("abandoned", "nothing writes it") is false and must be replaced with the true one ("written inconsistently across two sections, read from one, and stopped 2026-08-30").

**The 2026-08-30 cutoff is CORRECT** — verified on both populations. Latest carrying file is `2026-08-30-two-monitors-watch-the-agent.md`; nothing after. That half of the claim stands.

## Defect 2 — "absent from both templates" is true but the plan misreads what it implies

**CONFIRMED literally**: neither `.plot/templates/plan.md` nor `skills/plot/templates/plan.md` contains `Assignee`. But both templates' `## Status` block is where the 44 dropped plans put the field — i.e. authors were writing it into the section the template *does* offer, and the parser was ignoring them. "No template offers it" is true; "therefore nobody writes it" does not follow, and 115 files disprove it.

## Defect 3 — slice 1's reading already exists

**`skills/plot/scripts/plot-host.sh:2557-2588`, `budget_account()`** already answers *who is the current user*, per backend, and the plan's own "Design" section does not know it:

- github arm reads `gh`'s `hosts.yml` directly — **I ran it, it returns `jwloka`**
- bitbucket arm derives the workspace owner from `remote.origin.url`
- it is **free** (a file read, no API call), cached in an exported variable, and answers `unknown` rather than skipping

The header comment even pre-argues the plan's identity question: *"`gh api user` would answer authoritatively and cost one request against the very bucket this is counting"* — so slice 1's proposed `gh api user` call is the route this estate **already rejected on cost**, and the plan proposes it unaware.

It is **not exposed as an op**: `plot-host.sh:4622` lists `backend|default-branch|pr-state|pr-create|pr-merge|pr-list|issue-list|issue-view|issue-status|pr-body|rate-limit|limit|ci-limit|spend-rate` — no identity op. So slice 1 shrinks from *build a connector reading* to **expose an existing internal function as a host op**, and must read the config file rather than call `gh api user`.

## The sprint-filter precedent claim — partly right, and the plan cites the wrong half

The plan says the sprint filter is the closest precedent. **It is**, and it is a better one than claimed, but the plan has not read it:

- `packages/board/src/app/components/SprintFilter.tsx` (199 lines) is the control precedent, including the rule *"when no sprint is Active the control is **disabled but visible** — a control that vanishes teaches a reader it does not exist"*, which directly answers the plan's unstated "what does the checkbox do on a one-person estate" question.
- **The rule does NOT live in the domain.** `slugPassesSprintFilter` is in `packages/board/src/app/lib/filters.ts` — app layer, zero hits in `packages/domain/src`. So the plan's `isMine`-in-the-domain requirement is a **departure from the precedent it cites**, not a continuation of it. That is arguably correct per CLAUDE.md's *"every rendered state is a domain property"*, but the plan must say it is changing the pattern rather than following it.
- **Persistence contradicts the plan.** The sprint filter is `useState` only — `AgentList.tsx:454`, `new Set()`, no persistence at all. And `Board.tsx:165-171` argues *against* both URL and localStorage for its own filter state. So "beside the collapse key" has exactly **one** precedent (collapse) and one counter-precedent (every other filter in the board). The localStorage choice is still defensible — the collapse argument transfers and `?mine=1` is genuinely worse than `?collapsed=` — but the plan presents it as settled convention when the board's actual filter convention is *component state*.

**Prior art on filter regressions exists and the plan misses it**: `docs/plans/2026-08-25-the-filter-does-not-hide-a-worker.md` (Released, v2.9.0) is precisely the failure mode this plan's "unowned row is shown" arm guards against — a filter and its section disagreeing about the same fleet, *"WORKING 2 working / WORKING none, one line apart"*. Slice 3's browser test should be built from that plan's shape; its first draft also blamed the wrong component, which is the documented trap here.

## Smaller corrections

- **"two sources disagree" is overstated.** `jwloka` and `jan.wloka@quatico.com` are not a disagreement in *spelling*, they are two different *kinds* of identifier — a host login and an email. Over the last 400 commits, git authorship is `jan.wloka@quatico.com` (359) **and** `870334+jwloka@users.noreply.github.com` (37), so the GitHub noreply address already contains the login and joins the two. The open question "which identity is canonical" has a cheaper answer than the plan implies: match on a **set**, and the noreply form links them mechanically.
- **`bb pr list --json` author** — the plan cites #967 for this. `plot-host.sh:3660` confirms `bb pr list` takes `--author`, and `:656` builds a `q=` filter for it, so the read path exists on the bitbucket arm. `pr-list --rich` (`:96`) currently adds `draft, checks, mergeable, review` — **author is not in the rich set**, so slice 2's host change is real work, correctly scoped.

## What to amend before approval

1. Replace the `Assignee:` row: **115 of 331 files (35%) carry the line; the parser reads 71** because `plot-plan-meta.sh:863` gates on `## Approval`. Keep the 2026-08-30 cutoff. Keep rejecting option A — for inconsistency, not absence.
2. Note the parser gap as a finding (the Notes section already reserves `Assignee:` as out of scope — say *which* defect is being left).
3. Rewrite slice 1: expose `budget_account()` (`plot-host.sh:2557`) as a host op. Do **not** call `gh api user` — the estate rejected that on rate-limit cost in the same comment block.
4. Say that `isMine` in the domain **departs from** `slugPassesSprintFilter`'s app-layer home, and why.
5. Acknowledge `Board.tsx:165-171` as the counter-precedent for localStorage, and that the sprint filter persists nothing.
6. Point slice 3's test at `the-filter-does-not-hide-a-worker` (v2.9.0) rather than inventing the regression shape.
7. Soften "two sources disagree" — the noreply address joins them.

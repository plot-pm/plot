# Layering juror: board-files-rows-in-the-wrong

Position: amend

All line numbers are on `origin/main` at `ee678d5c8`.

## Where the section and the label are decided today

| Decision | Site | Layer |
|---|---|---|
| Row `group` (section), 33 return arms | `classifyGroup`, `packages/board/src/server/fleet.ts:3784`–`~4893` | board server |
| Fresh claim, no known worker → `not-started` | `fleet.ts:4723` (note `claimed, no known worker`) | board server |
| Fresh `wip`, no worker → `not-started` | `fleet.ts:4845` | board server |
| Local activity, no worker → `not-started` | `localActivity`, `fleet.ts:5209`–`5230` | board server |
| Stale `wip`, no PR → section from `quietPlacement` | `fleet.ts:4889` → `packages/domain/src/rules/quiet.ts:196` | domain |
| Draft-plan override | `draftPlacement`, `packages/domain/src/rules/draft-placement.ts:53` | domain |
| Registry manifest moves a row to `working` | `withHandOver`, `fleet.ts:~6020`–`6035` | board server |
| Per-slice regroup on the client | `rowsBySection`, `packages/board/src/app/lib/agent-rows/sections.ts:149` | board client `.ts` |
| Startability label | `startabilityVerdict`, `packages/domain/src/rules/verdict.ts:48`, called at `fleet.ts:6557` | domain |
| Quiet label (`abandoned`) | `quietKind`, `quiet.ts:144` | domain |
| Note hidden when startability is `someone-is-on-it` | `startableNote`, `packages/board/src/app/lib/agent-rows/rows.tsx:1597` | component `.tsx` |
| Label word only | `startabilityWord`, `packages/board/src/app/lib/tuple-row.ts:1098` | board client |

No consumer outside the board reads `group`: `git grep` for `'not-started'` in `packages/fleet/src`, `packages/domain/src` and `skills/plot/scripts/*.sh` returns nothing. Auto-dispatch therefore does not pick work up from the section; the issue's "auto-dispatch might pick it up" risk is a reader's impression, not a code path.

## Findings

1. **The plan names the wrong decision site.** The board-impact comment (plan line 20) names `sections.ts` and `tuple-row.ts`. Neither decides the section for either case. The section comes from `classifyGroup` in the board server (`fleet.ts`), then `withHandOver`, and `sections.ts` only regroups a slice's rows. `tuple-row.ts:1098` maps a verdict to a word and decides nothing. An agent that follows the comment edits the client and leaves `/api/fleet`'s `group` unchanged, so the server answer and the rendered section disagree, and `GROUP_ORDER` in `fleet.ts` sorts rows into an order the sections then contradict (`sections.ts:19`–`23` names that hazard). This answers Open Question 2: the server `group` is the source and must change.

2. **Case 2 is not a two-enum defect; it is a deliberate domain rule.** `quietPlacement` (`quiet.ts:196`–`207`) already derives the section from `quietKind` on the same readings, and its TSDoc states `abandoned` → `waiting-on-you` on purpose ("revive or drop"). `fleet.ts:4889` calls it. Two tests pin the current answer: `packages/domain/test/quiet.test.ts:214` ("keeps abandoned and orphaned-claim in waiting-on-you") and `packages/board/test/unit/a-quiet-row-lands-in-quiet.test.ts:33`. The plan's claim "both defects have one cause" (plan line 29) is false for case 2. The fix is one arm of `quietPlacement` plus those two tests, and it reverses a recorded decision, which belongs to a person (see below). `quietNeedsPerson` (`quiet.ts:219`) is defined as `quietPlacement === 'waiting-on-you'`, so its answer for `abandoned` flips too; the plan does not mention it, and `fleet.ts:6452`, `7249`, `7284` reason from it.

3. **Case 1 is a real disagreement between a domain rule and a board-server rule, and it is wider than the plan says.** `startabilityVerdict` returns `someone-is-on-it` for every `claimed` and every `wip` branch (`verdict.ts:57`), with no worker reading. `classifyGroup` puts fresh claims, fresh `wip` branches and every `localActivity` row in `not-started` (`fleet.ts:4723`, `4845`, `5209`–`5230`), by the deliberate rule "WORKING IS ABOUT AGENTS" from `every-section-has-one-subject`, slice Inverted (`docs/plans/2026-08-20-every-section-has-one-subject.md:223`–`226`; comment at `fleet.ts:4706`–`4709`). So the invariant "`someone-is-on-it` never in `not-started`" fails today for three populations, not one. The same rule also contradicts itself on case 2: a stale `wip` row carries `startability: someone-is-on-it` and `quietKind: abandoned` ("nobody is on it") at once.

4. **The visible contradiction is produced by a decision in a component.** `startableNote` in `rows.tsx:1597` blanks the note when startability is `someone-is-on-it`. That is why the row showed "someone is on it" and not the server's own note, `claimed, no known worker`. Per CLAUDE.md "Every rendered state is a domain property", this is a rendered decision made in `.tsx`. The plan does not name it; a fix that leaves it in place keeps one decision outside the single mapping the plan promises.

5. **The seam is right in direction and too large as scoped.** One domain arrow function for `{ section, label }` follows the layering rule and the readings-as-values shape (`reap(readings, input)`). But the section is 33 arms in `classifyGroup` plus `withHandOver` plus `rowsBySection`. Moving all of it into the domain in one slice is a large refactor with no behaviour change across 30 arms, and an unattended Sonnet agent cannot do it safely from this plan. The plan does not say which arms move.

6. **The invariant mixes three vocabularies.** `abandoned` is a `QuietKind` (`quiet.ts:149`), not a startability label (`verdict.ts:18`–`20`). A third `abandoned` exists as an attention verdict for a failed worker (`packages/board/src/server/attention.ts:236`). The test as written ("every startability label maps to allowed sections ... `abandoned` never to `waiting-on-you`") cannot be stated over the startability enum.

7. **The new WORKING state conflicts with a standing rule.** "Claimed, nobody watching" in WORKING contradicts "WORKING IS ABOUT AGENTS" (`fleet.ts:4706`, `5185`) and the `withHandOver` contract, which moves a row to WORKING only when a manifest names it (`fleet.ts:~6010`). A row in WORKING with no agent is the shape the Inverted slice removed.

## Required amendments

1. Replace the board-impact comment: the section decision lives in `classifyGroup` and `withHandOver` in `packages/board/src/server/fleet.ts`; `sections.ts` and `tuple-row.ts` follow. State that `/api/fleet`'s `group` changes (closes Open Question 2).
2. Split case 2 from case 1. Case 2 is one change in `quietPlacement` (`quiet.ts:196`), with `quiet.test.ts:214` and `a-quiet-row-lands-in-quiet.test.ts:33` inverted, and a stated answer for `orphaned-claim` (stays in WAITING ON YOU, or moves too) and for `quietNeedsPerson`.
3. Scope the new domain function to the no-worker arms only: a rule such as `unworkedPlacement(readings) → { section, startability }` over `state` (`claimed`, `wip`), freshness, local activity and worker reading, called from those arms of `classifyGroup`. Name the arms it replaces (`fleet.ts:4723`, `4845`, the `localActivity` returns, `4889`). The other arms stay in `classifyGroup`.
4. Make `startabilityVerdict` (or the new rule) read the worker and quiet readings, so `wip`/`claimed` with no known worker does not answer `someone-is-on-it` where the section says nobody is on it — or state the opposite decision explicitly.
5. Move the `startableNote` decision (`rows.tsx:1597`) into the same domain answer, so the row's note visibility is a domain property and not a component branch.
6. Restate the invariant over the real enums: for every reachable `(section, startability, quietKind)` produced by `classify`, `someone-is-on-it` never pairs with `not-started`, and `quietKind: abandoned` never pairs with `waiting-on-you`. Run it over the existing totality fixture `packages/board/test/unit/classifier-is-total.test.ts`, so it fails today on all three case-1 populations and on case 2, and passes after.
7. List the tests whose assertions flip, at minimum: `packages/domain/test/quiet.test.ts`, `packages/board/test/unit/a-quiet-row-lands-in-quiet.test.ts`, `a-slice-with-no-work-waits-in-not-started.test.ts`, `a-handed-slice-reads-as-taken.test.ts`, `fleet.test.ts`, `attention.test.ts`, and the browser tests `quiet-kinds-render`, `row-placement-quiet-and-ended-desk`.

## Decisions that need a person

- **Reverse the Inverted rule for claims?** `every-section-has-one-subject` filed a claim with no known worker under NOT STARTED on purpose. The plan puts it in WORKING. The alternative that keeps the rule: leave it in NOT STARTED and change the label to "claimed, no known worker", which removes the contradiction without a WORKING row that has no agent.
- **Reverse `quietPlacement` for `abandoned`?** The domain rule and its test say WAITING ON YOU on purpose. Moving it to QUIET is a policy change, and `orphaned-claim` needs the same answer or a stated difference.
- Wording and the WORKING header count for the new state (plan Open Question 1).

## Ran versus read

Ran (read-only): `git fetch origin main`; `git show origin/main:<path>` for `sections.ts`, `fleet.ts`, `quiet.ts`, `verdict.ts`, `rows.tsx`, `tuple-row.ts`, `working-agents.ts`, `attention.ts`, `quiet.test.ts`, `a-quiet-row-lands-in-quiet.test.ts`, and `docs/plans/2026-08-20-every-section-has-one-subject.md`; `git grep` over `origin/main` for `group` consumers, `quietPlacement`, `startabilityVerdict`, `someone-is-on-it` and test files; `gh issue view 3096`. Ran no test suite, no board, no fleet and no host write.

Read only: the plan file and the juror brief. Did not execute `classify` against the issue's rows; the claim that case 1 reached `fleet.ts:4723` rests on the issue's "5m" age and the hand-started worker leaving no pid, and is not reproduced.

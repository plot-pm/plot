# Juror: deliverable

Position: amend

## Findings

1. **The four cited codes exist where the plan says.** Read: `skills/plot-idea/SKILL.md:281` ("D3 in `DESIGN-phases.md`"), `skills/plot-deliver/SKILL.md:580` ("decision D14"), `skills/plot-deliver/SKILL.md:612` ("decisions D5 and D14"), `skills/plot-approve/SKILL.md:128` ("(D10)"). The definitions are rows in `docs/stories/archived/plot-works-in-five-phases/STORY-plot-works-in-five-phases.md:79` (D3), `:81` (D5), `:86` (D10) and `:90` (D14). The plan's Approach step 4 is correct on file and code.

2. **The shipped skill tree cites three more such codes, and the plan does not mention them.** Read: `skills/plot/scripts/plot-host.sh:5328` "(D20)", `:5384` "(D20)", `:5387` "THE D23 INBOX READ" and `:5778` "(D6: recovering ticket lines …)". D20 and D23 are defined in the same archived story (`STORY-…:96`, `:99`). D6 at `:5778` does not match that story's D6, which is about tab names (`STORY-…:82`). I infer that it comes from a different plan's legend: `git log -S` names commit `b0093f0bf`, and seven plans under `docs/plans/` contain "D6". These are shell comments, not SKILL.md prose. The Motivation still applies to them in full ("a reader … cannot resolve a code such as D14 without the table"), and they ship under `skills/`. Amend: add them to step 4, or exclude code comments by name in the Changelog and Open Points. Without that, the Changelog's scope "the skill text" hides the exclusion.

3. **The plot-idea citation also points at the wrong file.** `plot-idea/SKILL.md:281` says "D3 in `DESIGN-phases.md`". `DESIGN-phases.md:293` only cites D3 in a responsibility table, and the definition is in the STORY file. Step 4 replaces the code but leaves the pointer unchanged. A builder who only swaps the code keeps a reference to a file that does not define the decision. The slice should say what the reference reads afterwards.

4. **D10's proposed name matches only the last clause of its definition.** `STORY-…:86` defines D10 as "the fleet commissions an agent to write [the spec] … After a person approves a spike, the fleet dispatches it. Approval stays a person's act." `[decision-person-approves-plans]` fits the citation at `plot-approve/SKILL.md:128`. Step 4 also writes the name into the story's Decisions table, where it then labels a row that is mostly about spec commissioning. This is a minor naming risk and does not block the plan.

5. **The Changelog is missing one built item.** Approach step 3 changes `skills/story-tracking/SKILL.md`, which adds two sentences near `:210` ("Story file: Update status markers, add decisions with rationale"). Neither Changelog bullet mentions the story-tracking skill. Step 4 also edits the archived story's Decisions table, and the Changelog does not mention that either. Add both edits to the Changelog, because the changelog is what publishes.

6. **The template headings and the board-impact claim check out.** Read: `skills/plot/templates/plan.md:36` `### Open Points` with `- [ ] ...`; `.plot/templates/plan.md:56` `### Open Questions`; `skills/story-tracking/STORY-template.md:48` `## Open Points` and `:55` the three-column Decisions table. `packages/domain/src/rules/story-record.ts:109` tests only `/^## Open Points\s*$/m`, as the plan's Notes say. Each slice item names a file that exists and ships.

7. **No sibling plan conflicts.** The active siblings (`delivery-machine-tickets-footer`, `delivery-release-progress-per-plan`, `delivery-tab-header-and-my-sprint`) are Delivery-tab board work and touch none of these files. I checked their names only and did not read their bodies.

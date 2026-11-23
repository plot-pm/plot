## Implementation brief — templates-show-named-identifiers

- **Plan (canonical):** docs/plans/2026-11-16-templates-show-named-identifiers.md on main
- **Approved:** 2026-11-21, jwloka, in-session
- **Branch:** `docs/templates-name-their-identifiers` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: in-session`)

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

A reader of a skill, plan or story cannot resolve a code such as "D14" without the table that defines it, and that table sits in another file. Measured at approval: legend-bound codes appear in 16 plans, 6 files under `skills/plot`, 2 stories and 2 other skills (24 files under `docs/stories` and `docs/plans`, 41 with `skills/` added). `plot-deliver/SKILL.md:580` cites "(decision D14)" and `:612` "(decisions D5 and D14)"; the definitions are in the Decisions table of the archived story `plot-works-in-five-phases`. This slice makes the templates teach a named identifier (`[decision-person-delivers-lone-tracer]`, `[question-…]`) in place of a number, renames the four cited codes, and makes the board's row text and refusal messages follow.

**Do all eight steps of the plan's `### Approach`, not only what the `## Slices` line lists.** The slice line names templates, story-tracking wording, four citations and one changeset. Approach steps 5 to 7 add board code (`planOpenQuestions`, the readers in `interrogate.ts` and `contract/schema.ts`, three refusal messages and `gate.ts`) and the `challenge-the-plan` wording. The plan is canonical; the Approach is the scope.

### The decisions the plan settles — do not re-derive them

**The convention is a default, not a check.** No gate, no config key, no lint finding. An adopter that numbers its items keeps doing so. Do not add a validator for the `[kind-name]` shape.

**Existing adopter templates keep their text.** `plot-init/SKILL.md:605-606` copies the shipped plan template once into an adopter's `.plot/templates/plan.md`. Do not migrate those copies; the Notes of the plan say so.

**The four names come from their definitions in `docs/stories/archived/plot-works-in-five-phases/STORY-plot-works-in-five-phases.md`:**

- D3 → `[decision-person-decides-design]`, in `plot-idea/SKILL.md:281`. The citation currently says "in `DESIGN-phases.md`"; it names the archived story's Decisions table instead.
- D5 → `[decision-tracer-is-a-full-plan]`, in `plot-deliver/SKILL.md:612`.
- D10 → `[decision-fleet-writes-design-specs]`, in `plot-approve/SKILL.md:128`. The name follows the definition's subject (line 86: the fleet writes the spec; "approval stays a person's act"). The citation's own point is that approval stays a person's act, so keep that sentence in the skill text; do not let the name carry it.
- D14 → `[decision-person-delivers-lone-tracer]`, in `plot-deliver/SKILL.md:580` and `:612`.

The story's Decisions table gets the name after the code at each of the four definitions (lines 79, 81, 86, 90). **The codes stay in the table**, because the story's own files cite them. `DESIGN-phases.md` keeps its codes too: it sits beside the table that defines them. The `plot-host.sh` comments citing D20, D23 and another plan's D6 stay as they are; they are out of scope.

**The shape of a named point (step 8).** A named Open Points line is the marker (`⏸️`/`✅`, where present), then `[kind-name]`, then the sentence: `- [ ] ⏸️ [question-name] <question>`. The identifier follows the marker, never leads it. A name is unique within its plan or story and stays fixed once another place cites it, even if the wording changes. The template comment states both rules. Prefixes: `decision-`, `question-`, `risk-`, `bug-` (a defect), `task-`.

**Templates (steps 1 and 2).** `skills/plot/templates/plan.md` (`### Open Points`, line 36) and `.plot/templates/plan.md` (`### Open Questions`, line 56) show `[question-…]` on the placeholder line with one comment line. `skills/story-tracking/STORY-template.md`: the `## Open Points` bullets start with `[question-…]`, and `[decision-…]` starts the Decision cell. **The Decisions table keeps its three columns**, so existing stories stay valid: `packages/domain/src/rules/story-record.ts` tests only for the heading `## Open Points` and no parser reads a Decision cell.

**Board row text (step 5).** `planOpenQuestions` (`packages/domain/src/rules/plan-open-questions.ts`) drops ONE leading `[kind-name]` token from the first unchecked line it returns, so a Draft plan row (`draft-plan-row.tsx:64-67`) shows the sentence without the identifier. Unit tests in `packages/domain/test/plan-open-questions.test.ts` cover three lines: a named line, an unnamed line, and a bare name. **A bare name still counts as open** (`[question-checklist-line-first-token]`): the `UNCHECKED` pattern stays as it is, the "n open" count stays a count of unchecked lines, and only the returned `first` text changes. A bare name with no sentence behind it returns the name itself rather than an empty string, because an empty row line would read as "no open point". Check `interrogate.ts` (the `:39` reference in the plan is a doc comment today, so confirm the current line) and `packages/board/src/contract/schema.ts` for the same token; change them only where they show the line.

**Refusal messages (step 6).** `packages/board/src/server/approve.ts:332` and `packages/board/src/server/entry/approve.ts:1060` print `[decision-fleet-writes-design-specs]` instead of "(D10)". `test/reconcile/approve.test.mjs:359` asserts `/D10/` today; it asserts the name after the change. `packages/domain/src/rules/auto-deliver.ts:325` names D14's decision. `packages/board/src/server/entry/gate.ts:438` says "D14" for a DIFFERENT decision (a squash of the state ref's tip); read its definition and give it that decision's own name, never `[decision-person-delivers-lone-tracer]`. Grep for the old wording in other tests before you push: a message asserted by regex in a test you did not touch fails in CI.

**challenge-the-plan (step 7).** `skills/challenge-the-plan/SKILL.md:514-525` and `:630` write deferred items and contradictions as `- [ ] [question-<name>] <question>` lines.

**story-tracking (step 3).** Two sentences where `SKILL.md` describes updating the story file: give a decision or question that another place refers to a descriptive name with a short prefix for its kind, in square brackets, as inline code; a repository with its own identifier style keeps it.

### Done when

The plan's Approach, the five Changelog lines and the plan's Open Points are the specification. Assertions that exist because a naive implementation would pass without them:

- The `planOpenQuestions` test for a **bare name** catches a regex that strips the token and leaves `first` empty, or one that makes the line stop counting as open.
- The test for an **unnamed** line catches a strip that eats a leading `[` of ordinary text such as `[x] …` or a Markdown link.
- The refusal-message test asserts the NAME, so a rename that leaves "(D10)" in one of the two files fails. `approve.ts` and `entry/approve.ts` are separate strings.
- `gate.ts:438` carries its own name; a test or a grep shows it differs from the D14 name used in `plot-deliver`.
- Four tests read the plan templates and run in this slice: `parser.test.mjs:2593-2605`, `skills-say-slices.test.mjs:63,83`, `approve-record-outside-comments.test.mjs:46` and `started-record-outside-comments.test.mjs:3`. The template change must not put a `State:`, `Approved:` or `Started:` line outside a comment. **The PR body records the result of these four.**

Plus: **one changeset** that bumps six skills (`plot`, `plot-approve`, `plot-deliver`, `plot-idea`, `story-tracking`, `challenge-the-plan`) and the package for the board. Put the description first and the `bumps:` block last, with `plan: docs/plans/2026-11-16-templates-show-named-identifiers.md` inside the block; `./scripts/check-changeset-packages.sh` refuses the other order. A change under `skills/plot/templates/plan.md` selects every CI job (`ci-selection-jobs.test.mjs:128-133`), so expect the full CI run.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits no `.sh` file; do not add one. It touches `skills/**/SKILL.md` text only, so the gate should read zero growth.

If you edit a `SKILL.md`, update its `## Model Guidance` table only if a step changed, and keep the root README skills table in sync only if a skill's purpose changed (neither is expected). `AGENTS.md` mirrors `CLAUDE.md`; this slice edits neither.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/templates/plan.md`, `.plot/templates/plan.md`, `skills/story-tracking/` (`SKILL.md`, `STORY-template.md`), `skills/plot-idea/SKILL.md`, `skills/plot-approve/SKILL.md`, `skills/plot-deliver/SKILL.md`, `skills/challenge-the-plan/SKILL.md`, `docs/stories/archived/plot-works-in-five-phases/STORY-plot-works-in-five-phases.md`, `packages/domain/src/rules/plan-open-questions.ts` and its test, `packages/domain/src/rules/auto-deliver.ts` (comment only), `packages/board/src/server/approve.ts`, `packages/board/src/server/entry/approve.ts`, `packages/board/src/server/entry/gate.ts` (comment only), `packages/board/src/server/interrogate.ts` and `packages/board/src/contract/schema.ts` (only where they show the line), `test/reconcile/approve.test.mjs`, and one changeset under `.changeset/`.

Do not touch the generated board bundle under `skills/plot/scripts/board/`; `main` builds it and `scripts/check-no-bundle-diff.sh` refuses it in a PR. Other branches in flight on these paths were not checked at dispatch beyond `git log`: run `git fetch` and look at open PRs that name `plan-open-questions.ts`, `approve.ts` or `plot-deliver/SKILL.md` before you push, and rebase onto `main` if one merged.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

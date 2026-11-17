## Implementation brief — delivery-tab-header-and-my-sprint (wave 2: Sprint owner)

- **Plan (canonical):** `docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` on `main`
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/sprint-owner-field` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

Wave 2 of 8. Nothing waits before it: it has no `<!-- waits: -->` marker and runs in parallel with `feature/delivery-section-header` (#3484). `feature/delivery-sprint-card` and `feature/delivery-release-card` wait on it, because both read the ownership rule and the fleet payload's new fields.

### What to build

The Delivery tab's **My sprint** toggle needs to know whose sprint is whose, and no sprint file says. Today a sprint's `## Status` block holds `State`, `Start`, `End` and optionally `Release`; `sprintRecordOf` (`packages/domain/src/rules/sprint-record.ts:62`) parses them, and `FleetSprintSchema` (`packages/board/src/contract/schema.ts:4269`) carries `start`, `timebox` and `timeboxLabel` but no end date, although `sprintRecordOf` already reads `end`. This slice adds four things:

1. **The field.** `- **Owner:** <handle>` in `skills/plot/templates/sprint.md`'s Status block, and `/plot-sprint` step 5 (`skills/plot-sprint/SKILL.md`, "Create Sprint File") writes the creating person's handle there.
2. **The parse.** `sprintRecordOf` reads the handle as the string `ownerHandle` on `SprintRecordSchema` (`packages/domain/src/entities/board-readings.ts:17`). It does not check the handle, because the domain package cannot read `People`.
3. **The payload.** `FleetSprintSchema` gains `ownerHandle` and `end`, each with a `.default('')`. Update `fleet.ts` (the object built near line 8315), `mock-fleet.ts` and every fixture that builds a fleet sprint.
4. **The rule.** A domain rule answers "does the reader own this sprint". The sprint card and the scope slice both read it.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

- **The name is `ownerHandle`, never `SprintOwner`.** `SprintOwner` is the type of the `Sprint owner` config key (`rules/issue-source.ts:116`). A second type of that name makes two meanings share one word. Deliverable search for "sprint Owner field" missed it, which is how the plan nearly collided with it.
- **The parser never refuses a sprint file for its Owner.** A sprint with no Owner, or with a handle `People` does not declare, still counts toward the release and belongs to nobody's toggle. Refusing would hide a whole sprint from the board over one missing line. No Owner backfill is needed: no sprint is Active on 2026-11-16.
- **The board server checks the handle against `People`, not the parser.** The server already builds the directory (`packages/board/src/server/server-info.ts:179`, `parsePersonDirectory`). A handle the directory does not declare reads as no owner, and the payload keeps the raw handle so the sprint card can name the unknown one.
- **The rule compares as PR ownership compares.** Mirror `prOwnership` (`packages/domain/src/rules/ownership.ts:103-109`): `samePerson(resolvePerson(<reader's host login>, directory), resolvePerson(<ownerHandle>, directory))`, over `Reader` (`ownership.ts:19-29`). Use `comparableLogin` for the login. The rejected alternative is comparing the handle to `Reader.gitEmail`: `ownership.ts` documents that the email is never compared against an author, and a handle is not an address.
- **A reader with no identity owns no sprint.** `readerIsKnown` (`ownership.ts:316`) reads false when both `hostUser` and `gitEmail` are empty. A reader whose login does not resolve to the Owner also owns none. Absent is not a match: do not default to true.
- **The rule lives in the domain, not in a component.** Every rendered state is a domain property (CLAUDE.md, *The Layering Rule*). A disabled toggle computed in `.tsx` could be tested only by starting a board.
- **Arrow functions, factual TSDoc.** New domain code is `export const f = (…) => …`, and a TSDoc block states behaviour, parameters, return and failure, not history.
- **This slice builds no UI.** The card, the toggle and the header belong to later slices.

### Done when

The plan's *Sprint owner* line in `## Done When` is the specification: a sprint file with `- **Owner:** <handle>` parses, and `/plot-sprint` writes it; a sprint with no Owner, or with a handle `People` does not declare, counts toward the release and belongs to no toggle; the fleet payload's sprint carries `ownerHandle` and `end`; the ownership rule answers true only where the reader's host login and the Owner resolve to one person, asserted in unit tests.

Assertions a naive implementation would pass without, and what each catches:

- A reader with no `hostUser` and no `gitEmail`, against a sprint whose `ownerHandle` is `''`: the rule answers false. It catches `'' === ''` reading as a match.
- A reader whose login is an alias declared in `People` for the Owner (`jwloka = Jan Wloka` style directory): the rule answers true. It catches a plain string compare.
- A sprint file with no Owner line parses with `ownerHandle: ''` and no refusal. It catches a parser that rejects the file.
- A sprint file whose Owner handle the directory does not declare reaches the payload as no owner, with the raw handle kept for the card. It catches a server that drops the handle or counts the sprint as owned.
- `end` on the payload equals the file's `- **End:**` line. It catches a schema default masking an unwired field (see *A version default hides stale store fixtures* in the project memory: a `.default('')` makes an old fixture pass while the field is never set).

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Run `pnpm build:board` only to test locally and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. The template and `/plot-sprint` change needs a `plot-sprint` bump declared in the changeset (description first, `bumps:` block last, package `plot`). The change touches `packages/domain` and `packages/board`, so the domain typecheck (`pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`) and `pnpm run typecheck` apply.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If `/plot-sprint`'s change turns out to need one, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section under `### Sprint owner`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/templates/sprint.md`; the sprint-creation step of `skills/plot-sprint/SKILL.md` (and its README only if it names the Status fields); `packages/domain/src/rules/sprint-record.ts` and `entities/board-readings.ts`; a new ownership rule next to `rules/ownership.ts`; `FleetSprintSchema`, `fleet.ts` and `mock-fleet.ts`'s sprint object; the server's handle check against `People`; and their tests and fixtures.

In flight: `feature/delivery-section-header` (#3484) owns `agent-rows/delivery-view.ts`, the Delivery section components and `glyphs.ts`. Stay out of them. A later slice, `feature/delivery-my-sprint-scope`, applies the rule to the toggle and the filters, so build no toggle, no card and no filter here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

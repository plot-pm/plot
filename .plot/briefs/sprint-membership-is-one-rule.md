## Implementation brief — a-plan-that-joins-a-sprint (wave: Membership rule)

- **Plan (canonical):** [docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md](../../docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3000 merged
- **Branch:** `feature/sprint-membership-is-one-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — standard PR review

This is the plan's first slice: nothing else waits on it being merged first, but every later slice (`feature/approve-and-deliver-find-the-sprint-by-rule`, `feature/a-plan-joins-a-sprint-through-one-command`, `feature/a-sprint-member-names-its-sprint`) names `feature/sprint-membership-is-one-rule` in its `waits` annotation. This branch has no caller changes — it adds the rule and its test only.

### What to build

A new domain rule file, `packages/domain/src/rules/sprint-membership.ts`, answering one question: *which sprint does a plan belong to?* Today nothing answers that — `approve.ts` and `deliver.ts` pick a sprint file by text search for `[slug]` anywhere in the directory, which is what let `f57425ec0` tick a Closed sprint's Deferred line while the plan named a different, open sprint. This slice supplies the rule those two callers will switch to in the next wave; it changes no caller itself.

Four exports, each an arrow function with factual TSDoc (`## The Domain Package` rules in `CLAUDE.md` — arrow functions, no narrated history):

- **`sprintMembers(content)`** — the slugs a sprint file lists on an unstruck Must/Should/Could line. Reuse `itemsFrom` (`packages/domain/src/entities/sprint.ts:129`), which already reads only lines under `TIER_HEADINGS` (`:59`) via `MEMBER_LINE` (`:95`) and skips `### Deferred`, `### Scope Changes`, `### Also shipped`. Drop the slugs `struckSlugs` reads.
- **`sprintOfPlan(slug, sprints)`** — takes `{ file, content }[]` for every dated sprint file, answers `{ sprint, file } | null`. Sprint slug via `slugOf('sprint', file)` (`packages/domain/src/rules/state-transition.ts:96`). Among sprints whose `sprintMembers` contain the slug: prefer not-Closed, then latest `Start:`, then file name sorting last.
- **`sprintsListing(slug, sprints)`** — every sprint that lists the plan, with its state. Not consumed yet in this slice; the writer and gate slices use it later to name "the other open sprint" in a refusal.
- **`memberLineIndex(content, slug)`** — index of the plan's member line under a tier heading, or `-1`.

### The decision this slice settles — do not re-derive it

**`struckSlugs` must become exported, not reimplemented.** It already exists at `packages/domain/src/rules/sprint-scope.ts:37` as a private `const` — confirmed still there and unexported at time of writing (`grep -n struckSlugs packages/domain/src/rules/sprint-scope.ts` finds only the definition and its one internal caller at `:99`). `rules/sprint-scope.ts` is already re-exported wholesale from the package index (`packages/domain/src/index.ts:625`, `export * from './rules/sprint-scope.js'`), so adding `export` to the `struckSlugs` declaration is the only change needed on that side — never copy its body into `sprint-membership.ts`. `sprintMembers` then imports it from `./sprint-scope.js`.

**`sprintMembers` answers a different question than `itemsFrom` and must not collapse into it.** `itemsFrom` is deliberately broader — it still lists a struck line as an item (the release gate reads that). This rule narrows to *unstruck* Must/Should/Could lines only, by subtracting `struckSlugs`'s result. Do not change `itemsFrom` itself or the release gate's use of it.

**No caller in this slice.** The plan's wave ordering means `approve.ts` and `deliver.ts` keep their current text-search behavior (including the `f57425ec0`-shaped bug) until `feature/approve-and-deliver-find-the-sprint-by-rule` lands. Resist the temptation to wire a caller here even if it looks like a two-line change — the next slice's `waits` annotation exists so its own tests and PR can isolate that change.

**Export from the package index.** The four new names (plus the now-exported `struckSlugs`, already covered by the `sprint-scope.ts` wildcard export) need `sprintMembers`, `sprintOfPlan`, `sprintsListing` and `memberLineIndex` reachable the same way every other domain rule is — add `export * from './rules/sprint-membership.js';` to `packages/domain/src/index.ts` alongside the existing `sprint-scope` line (`:625`).

### Done when

The plan's `## Done when` table names six rows tagged "Membership rule" (all in `sprint-membership.test.ts`):

- A tier line is membership — `[a]` under Should Have → `sprintMembers` holds `a`.
- A Deferred, struck, log or untiered line is not — none of `a`,`b`,`c`,`d` from fixtures under `### Deferred`, `~~[b]~~` under Must, `Added [c]` under `### Scope Changes`, `[d]` under `### Also shipped`.
- An open sprint wins over a Closed one — `a` on W42 Must (Closed) and `bugfix-2-28-1` Must (Planning) → `bugfix-2-28-1`.
- The newest open sprint wins — `a` in two Active sprints, `Start:` 2026-10-28 and 2026-10-29 → the 2026-10-29 one.
- Only Closed sprints list it — `a` in two Closed sprints → the later `Start:`.
- No sprint lists it — `a` only on a Deferred line → `null`.
- A sprint slug is cut by `slugOf` — file `2026-W36-the-board-shows-the-strategic-layer.md` → `the-board-shows-the-strategic-layer`.

Build one fixture from the real `f57425ec0^` texts of the W42 and `bugfix-2-28-1` sprint files (`git show f57425ec0^:docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md` and the `bugfix-2-28-1` equivalent) — this is the plan's named regression case (deliver ticked the Closed W42 Deferred line when the plan actually belonged to the open `bugfix-2-28-1`), and it is reused again in the Approve-and-deliver slice's `deliver-retry-real-repo.test.ts` row, so get the fixture right here.

Plus: the repo's gates — no committed `board-server.mjs` diff (this slice touches no board code, so this should be a non-issue, but the gate still runs), a changeset naming `plot` (this plan ships as a `plot` skill-adjacent change; confirm against `## Versioning` in `CLAUDE.md` once the writer/gate slices land — this slice alone may not need its own changeset since it has no user-facing behavior change yet, but check `scripts/check-changeset-packages.sh`'s expectations before pushing), and the usual TypeScript/domain gates (`pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file, so it should not trip the ratchet — but if anything under `skills/` changes, growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the first push. Once the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/sprint-membership-is-one-rule` under `### Membership rule`).

### Scope guard

This branch owns exactly:

- `packages/domain/src/rules/sprint-membership.ts` (new)
- `packages/domain/test/sprint-membership.test.ts` (new)
- `packages/domain/src/rules/sprint-scope.ts` (one-line change: export `struckSlugs`)
- `packages/domain/src/index.ts` (one new `export *` line)

No other files. In particular, do not touch `approve.ts`, `deliver.ts`, `sprint-annotation.ts`, `sprint-tick.ts`, the writer (`sprint-member.ts`), the gate (`sprint-member-gate.ts`), or any `SKILL.md` — those belong to the three later slices (`feature/approve-and-deliver-find-the-sprint-by-rule`, `feature/a-plan-joins-a-sprint-through-one-command`, `feature/a-sprint-member-names-its-sprint`), each of which `waits` on this branch merging first. No other branch is claimed yet as of this writing, so there is no known collision — but check `/plot-pulse` before pushing, since the other three slices may start concurrently once this one is claimed.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

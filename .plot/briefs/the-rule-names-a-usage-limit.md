## Implementation brief — a-usage-limit-is-not-a-broken-prompt (wave 1: The rule names a usage limit)

- **Plan (canonical):** `docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md` on `main`
- **Issue:** #1141
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-rule-names-a-usage-limit` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

Wave 2, `bug/the-loop-waits-out-a-usage-limit`, waits on this branch. It needs this slice's bundle and wires it into `plot-worker-loop.sh`. **Do not touch `plot-worker-loop.sh`, `plot-worker-monitor.sh` or `plot-fleetctl.sh` here.**

### What to build

The plan's section **Design › Approach** is the specification. Read it whole before you start; this brief names the parts this slice owns.

1. **The rule** `packages/domain/src/rules/prompt-exit.ts`, exporting `promptExit` as an arrow function. It takes the patterns as an argument and imports no adapter. It answers one of four words with tab-separated fields: `wait`, `end-limited`, `unstarted`, `ran` (the table in the plan). It owns every decision: the limit match (any line on a non-zero exit; only the last non-empty line, matched from its start, on a status-0 exit), reading the reset (wall-clock time plus IANA zone, resolved on the date of now; a reset up to 120 s in the past resolves to now; more than 120 s past resolves to the next day; unreadable is `unknown`), whether the wait is allowed (`Worker bound` cap; a bound of 0 disables the cap), and `no-progress` (prompt started after a wait, ran under 600 s, zero commits since the wait). With the wait flag `0` it reads neither the run time nor the commit count. All five limit names (`session`, `weekly`, `Opus`, `fast`, `monthly spend`) are limits. Every instant goes out as epoch seconds and as UTC ISO text.
2. **The adapter** `packages/domain/src/adapters/harness/limit-lines.ts`: a constant table keyed by harness name (line prefix `You've hit your `, the five limit names, the reset separator). **Data only, no function**: every match and parse stays in the rule, where the 100% branch gate applies (`packages/domain/vitest.config.ts:71` covers `src/!(adapters)/**`).
3. **The entry** `packages/board/src/server/entry/prompt-exit.ts`, the shape of `entry/slice-spend.ts`: reads seven arguments (status, effective harness, now epoch, `Worker bound` seconds, seconds the prompt ran, wait flag, commits since the wait) and the last 200 lines on stdin, passes the harness's table entry to `promptExit`, prints the one answer line. An unknown harness supplies no patterns.
4. **The bundle** `skills/plot/scripts/board/plot-prompt-exit.mjs`: its block in `packages/board/build.mjs`, its line in `packages/board/src/contract/bundles.generated.ts`, its `-merge` line in `.gitattributes`, the committed artifact, and a Helper Scripts row in `CLAUDE.md`.
5. **The ending:** `EndingReasonSchema` gains `limited`; `endingIsAttributable` admits actor `agent` for `limited` as for `unstarted`; `packages/domain/test/ending.test.ts:45`, which pins the reason list, gains it.
6. **`docs/shell-and-domain.md` §1** records the exception: a call made once per prompt exit asks the domain, while the loop's idle pass still duplicates.

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `packages/domain/src/entities/ending.ts` | 55 | `EndingReasonSchema = z.enum(['bound', 'quiet', 'unreadable', 'spent', 'unstarted'])` |
| `packages/domain/src/transitions/agent.ts` | 390 | `if (input.actor === 'agent' && input.reason !== 'unstarted')` |
| `packages/domain/test/ending.test.ts` | 45 | the reason-list pin |
| `packages/domain/vitest.config.ts` | 71 | 100% coverage for `src/!(adapters)/**/*.ts` |
| `packages/board/src/server/entry/` | — | `slice-spend.ts` is the precedent; no `prompt-exit.ts` yet |
| `skills/plot/templates/worker-prompt.sh` | 136 | `harness="${PLOT_HARNESS:-claude}"` |

### Tests (from the plan, all domain, 100% branch coverage)

- the #1141 line (`You've hit your session limit · resets 5:20pm (Europe/Zurich)`) across a day boundary answers `wait` with matching epoch and ISO fields;
- a reset 60 s past answers `wait` with the reset epoch equal to now; a reset 200 s past resolves to tomorrow;
- a line with no reset, and an unreadable time, answer `end-limited` with `no-reset`;
- a reset past the bound answers `end-limited` with `past-bound`, and a bound of 0 allows it;
- a limit after a wait, under 600 s, with no new commit answers `no-progress`; the same with one new commit answers `wait`;
- `fast limit` and `monthly spend limit` lines with no readable reset answer `end-limited`;
- a status-0 output whose last non-empty line is the limit line answers `wait`; a status-0 output that quotes the #1141 line before a final line of other text answers `ran`;
- an unknown harness and an empty pattern set answer `unstarted` or `ran` by status;
- an exit with the wait flag `0`, a run time of 5 s and a commit count of `0` that carries the #1141 line answers `wait`, never `no-progress`.

### Panel caveats a worker trips on

- **The bundle entry lives in `packages/board/src/server/entry/`**, not in the domain package (round 2 found the first draft placed it in a directory that does not exist).
- **The adapter holds no function.** `listingPagingFor` in `adapters/` branches; do not copy that shape. A function in the adapter escapes the coverage gate.
- **Nothing in this slice reads `PLOT_HARNESS` raw.** The loop (wave 2) sends `${PLOT_HARNESS:-claude}`; the rule only sees a harness name.
- **The vendor gate** (`ci.yml`) refuses vendor names in `packages/domain/src` outside `adapters/`. The harness name `claude` and its message text live in the adapter table only.

### Done when

The domain tests above pass at 100% branch coverage; the bundle answers the #1141 line with `wait` from the command line; `ending.test.ts` lists `limited`; the `CLAUDE.md` row and the `docs/shell-and-domain.md` §1 amendment are in.

### Gates

`nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and the domain coverage run. **Do not run `pnpm run test:e2e`**; CI runs it.

### Rules that bite this slice

- Domain first: the decision is the rule's; no new `plot-*.sh` script.
- New functions are arrow functions (`export const f = (…) => …`), and TSDoc says what, not why.
- A changeset, description first and the `bumps:` block last (`plot` package for the skills/scripts change; `'@plot-pm/board': patch` covers the entry and bundle).
- The controller-gate hook blocks any Bash command that names `plot-dispatch.sh`; read it with the Read tool.
- Use `trash`, never `rm`. Never `git stash`.

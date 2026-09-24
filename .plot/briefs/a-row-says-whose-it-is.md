## Implementation brief — the-board-shows-me-only-my-work (wave 2: A row says whose it is)

- **Plan (canonical):** `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `feature/a-row-says-whose-it-is` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #967

**This branch waits on wave 1.** `feature/the-board-knows-who-is-asking` puts the reader's identity in the board payload, and `isMine(row, identity)` takes that identity as its second argument. On 2026-09-24 wave 1 was claimed with no commits and no PR. Do not start until it has merged, then read the identity field's name and shape from the merged `ServerInfoSchema` rather than from wave 1's brief. Wave 3 (`feature/the-board-filters-to-my-work`) waits on this branch: its checkbox renders what `isMine` decides and decides nothing itself.

### What to build

#967 measured a four-contributor estate: 11 open PRs, 9 of them owned by three colleagues (4, 3 and 2), and 18 rows in WAITING ON YOU of which 2 were actionable by the reader. The board cannot tell those rows apart, because no row carries an owner. `CardPrSchema` (`packages/board/src/contract/schema.ts:262`) has four fields, `number`, `url`, `checks` and `mergeable`, and none is an author. The host knows the author, and `plot-host.sh pr-list` drops it.

This branch makes a row say whose it is, and filters nothing:

1. **The PR author travels from the host to the row.** `plot-host.sh pr-list` adds the author to its projection on both backends. Then `PrRecord` (`packages/board/src/server/fleet.ts:406`), `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:30`), the `Pr` entity (`entities/pr.ts`) and `CardPrSchema` each carry it. The card map at `server/board.ts:1997` passes it to the card.
2. **The agent row reports the machine's own record.** Per the plan's recommendation (*"B, with C for agent rows"*), an agent this machine's registry declares and whose desk is on this machine is the reader's. An agent in state `elsewhere` has no desk here, so its owner is undetermined.
3. **`isMine(row, identity)` decides in the domain,** in `packages/domain/src/rules/`, exported from the package index, with unit tests. The client already imports domain rules directly (`PlanCard.tsx:6` imports `checksVerdict` from `@plot-pm/domain`), so wave 3 calls it the same way.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Ownership is derived from authorship, not annotated.** The plan rejects reviving `Assignee:` for this feature. No template offers the field, and its spellings (`eins78`, `jwloka`, `Jan Wloka` for two people) do not match any identity reading. The plan also records that `plot-plan-meta.sh:863` reads `Assignee:` only under `## Approval`, so 44 of the 115 plans that carry it are invisible to the parser. That is a separate defect. Do not fix it here, and do not make `isMine` read `card.assignee` (`board.ts:2015`). The plan leaves `Assignee:` alone.

**A row with no determinable owner is SHOWN.** This is the plan's regression guard and the reason the filter is safe to ship. A boolean `isMine` that returns `false` for an unknown owner hides exactly the rows the plan promises to show. The domain answer must separate three cases: the row is the reader's, the row is somebody else's, and the owner cannot be determined. Recommended shape: an `ownership(row, identity)` rule that answers `'mine' | 'theirs' | 'unknown'`, and an `isMine` that wave 3 filters on and that returns `true` for `'unknown'`. The plan names `isMine` and does not fix its return type, so name the rule yourself, and state the three cases in the PR body. `plot-release-refs.sh` permits on `unknown` for the same reason.

**The unknown cases are these, and each needs a test:**

- The payload carries no identity. Wave 1 answers `''` when it cannot read an account, and on Bitbucket it may answer `''` for the login on every run (wave 1's brief records that `budget_account`'s Bitbucket arm answers the workspace, not the user).
- A PR row whose author the host did not answer. This includes every row in a PR index written before this branch (see the next decision).
- An agent row in state `elsewhere`.
- Every plan card, issue row and bare branch row, because this slice gives none of them an owner.

**Bump `PR_INDEX_VERSION`, or the author never arrives for old PRs.** The PR index is incremental: `refreshPrs` (`fleet.ts:2730`) asks the host only for PRs changed since the stored `updatedAt` watermark. A store written before this branch holds rows with no author, and a PR that has not changed since then is never asked about again. So on an existing estate most PR rows stay authorless for as long as they stay quiet. Raise `PR_INDEX_VERSION` (`entities/pr-index.ts:12`) from 1 to 2. `decodePrIndex` already reads an unrecognised version as `null` and falls back to one full read (pinned by `packages/domain/test/pr-index.test.ts:240`). That costs one full `pr-list` pass, once per machine.

**The author is optional in the store and has no default.** `PrIndexRowSchema` is `.strict()`, and its header forbids `.default()`: *"A default is how a cold store stops being byte-identical to no store."* Add `author: z.string().optional()`. Absent means the host did not answer, and `isMine` reads it as unknown. Never write `''` into the store for an unanswered author. `CardPrSchema` follows its own convention, `z.string().default('')`, like `url`, and `''` on the card means unknown.

**Reuse `Person` and do not write a second normalizer.** `packages/domain/src/entities/person.ts` already defines `Person`, `resolvePerson(raw, directory)` and `samePerson(one, other)`. It lowercases and trims, and it resolves spellings through a declared `PersonDirectory`. It has no production caller: only `test/person.test.ts` uses it (added by #515). The comparison in `isMine` goes through `samePerson`. No directory is configured anywhere, so pass none, and compare the normalized raw values. Do not add a `## Plot Config` key for a directory. The plan rejects config keys for identity, because a config key is a second copy of a fact the host already holds.

**Compare like with like.** The host login from wave 1 matches a PR author login. Git's `user.email` does not match a PR author login, because they are two spellings of one person. Do not bridge them with a heuristic, for example the local part of the email against the login. `resolvePerson` exists to refuse that guess: *"an unrecognised spelling is unresolved, never resolved to something similar."* If the payload holds no host login, a PR row is unknown, and it is shown.

**Git commit authorship is not this slice.** The plan's option B says *"or git says I wrote its commits"*, but this slice's line names only the PR author and the agent row. A branch row with no PR stays unknown. If you find that bare branches dominate the unknown rows on #967's shape, report the number in the PR body. Do not add a `git log` reading here.

**Ask the host, one call per list, never one per PR.** The author comes in the same `pr-list` call, from a field the call already fetches or can add to `--json`. `gh pr list --json` offers `author` (an object with `login`). The plan and #967 say that `bb pr list --json` carries an `author` object, but they do not name the field inside it. Measure the installed `bb`, pick the field that holds the login rather than the display name, and name it in the PR body. If `bb` gives only a display name, carry it and let the comparison answer unknown. Do not guess a login from it. `scripts/check-host-cli-callers.sh` keeps every host CLI call in `plot-host.sh`.

**Rules carried over unchanged:** absent is not false; read the exit code, not the emptiness of stdout; the host answers, git does not (`plot-pr-merged.sh`); the board client casts the fleet and does not parse it, so on the client a new field from an older server is `undefined`, not `''`, and `isMine` must treat both as unknown.

### Done when

The plan's `## Done when` list specifies the whole feature. This slice owns the domain half of it: *"`isMine` is a domain function with unit tests"* and *"A row with no determinable owner is shown, and a test pins that."* Beyond those:

- **A fixture of #967's shape:** 11 open PRs, 2 authored by the reader and 9 by three colleagues (4, 3, 2). `isMine` answers true for exactly the 2. **It catches** a rule that tests only a one-person estate, where a filter that hides nothing looks identical to one that works (the plan's Notes name this risk).
- **Each unknown case above answers "shown"**, one test per case, including an identity of `''` against a PR whose author is also `''`. **It catches** a comparison of `'' === ''` that reads an empty identity as a match and makes every authorless row the reader's.
- **Case and whitespace:** `JWloka ` and `jwloka` are one person, through `samePerson`. **It catches** a second normalizer beside `person.ts`.
- **An email identity never matches a login author.** **It catches** a heuristic bridge between the two spellings.
- **The PR index round-trip:** a store at version 1 decodes to `null`, and a store at version 2 keeps a row with no `author` key without the key. **It catches** a missing version bump and a `.default()` in the store.
- **A contract test on `plot-host.sh pr-list`** for each backend's projection that includes the author. **It catches** an author that reaches `PrRecord` on GitHub and is dropped on Bitbucket.
- **`/api/board` carries `author` on a card's PR.** **It catches** a field that the server parses and the client never receives (`board.ts:1997` has already dropped fields at this map once).

Plus the repo gates:

```bash
nvm use                     # Node 24; pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:contracts
pnpm run test:board         # rebuilds the board artifact first
pnpm run typecheck
./scripts/check-host-cli-callers.sh
./scripts/check-changeset-packages.sh
```

- Do not run `pnpm run test:e2e` locally. CI runs it.
- Write every new function in `packages/domain/src/` as an arrow function, with TSDoc that states the interface and not the history. The reasoning goes in the commit message.
- Commit the rebuilt `skills/plot/scripts/board/board-server.mjs`. On a conflict in it, take either side and run `pnpm build:board`.
- Add a changeset. The description goes first and the `bumps:` block goes last. Name the plan on a `plan:` line in the same block. This touches `plot-host.sh` (skill `plot`), `packages/domain` (`@plot-pm/domain`) and `packages/board` (`@plot-pm/board`). The check derives valid package names from the workspace.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- No project board is configured, so there is no board status to set.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh` (the author in the `pr-list` projection only)
- `packages/domain/src/entities/pr.ts`, `entities/pr-index.ts` (the field and the version), `rules/pr-index.ts` if the version needs it
- a new rule in `packages/domain/src/rules/` for ownership, and its export from `packages/domain/src/index.ts`
- `packages/domain/src/adapters/host/host-shell.ts` and `host-fixture.ts`, where `prList` maps the new field
- `packages/board/src/server/fleet.ts` (`PrRecord`, `storeRow`, `recordOf`, `refreshPrs`)
- `packages/board/src/contract/schema.ts` (`CardPrSchema`, and the agent row field if the machine's record needs one)
- `packages/board/src/server/board.ts` (the card's PR map at `:1997`)
- tests for the above, the rebuilt board artifact, one changeset

Not this branch: the checkbox, `localStorage` and any rendering are wave 3. The identity reading and `ServerInfoSchema` are wave 1. `Assignee:` and the `plot-plan-meta.sh:863` section gate are out of scope.

Other branches in flight, checked 2026-09-24 against every remote ref (no PR was open):

- `bug/a-row-with-no-plan-is-not-a-plan` edits `fleet.ts` in `rowsFromPulse` (`:7058`–`:7117`) and its imports (`:92`). This branch edits `PrRecord` (`:406`) and the PR index path (`:2523`–`:2730`). The import block may conflict and is trivial to resolve.
- `bug/the-board-shows-the-tick-age` edits `schema.ts` at `SupervisorSchema` (`:3534`), far from `CardPrSchema` (`:262`).
- `feature/one-monitor-watches-the-slice` edits `schema.ts` at `ProcessGroupSchema` (`:3035`), and its PR #741 merged.
- `feature/the-board-knows-who-is-asking` (wave 1) will touch `ports/host.ts`, `host-shell.ts`, `host-fixture.ts`, `plot-host.sh` and `schema.ts`. It merges before this branch starts, so rebase onto it rather than working beside it.

No other branch touches `plot-host.sh`, the host port or adapter, `entities/pr.ts`, `entities/pr-index.ts` or `entities/person.ts`. Line numbers are from `main` at `d15481b58`. Re-read them after wave 1 merges.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — tickets-for-the-release-and-loose (wave: Identity and reads, branch 1 of 2)

- **Plan (canonical):** docs/plans/2026-11-08-tickets-for-the-release-and-loose.md on main
- **Design (canonical):** docs/superpowers/specs/2026-11-08-delivery-tab-design.md, approved 2026-11-08
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Branch:** `feature/people-carry-a-tracker-identity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is the first slice of "Identity and reads". `feature/the-issue-index-reads-assignee-and-release` is the second and shares no file with it. Every slice under "Tickets on the board" waits on plan 1's `feature/delivery-tab-sections`, not on this branch. Nothing else waits on this one, so it owns the shape of the identity answer.

### What to build

A typed answer to one question: **which tracker account is this handle?** It is a value computed in the domain from the `People` config text, in `packages/domain/src/entities/person.ts` beside `parsePersonDirectory`, with unit tests in `packages/domain/test/person.test.ts`. The plan's example form is `jwloka = Jan Wloka <jira:jan.wloka@quatico.com>`.

Lead with what is already true, measured on `origin/main` 2026-11-08, because the plan's Motivation says "nothing maps a handle to a tracker account" and that is wrong in part:

- `parsePersonDirectory` (`person.ts:79`) already accepts a spelling `<tracker>:<account>` as free text. `jwloka = Jan Wloka, jira:jan.wloka@quatico.com` puts `jira:jan.wloka@quatico.com` in the directory as a spelling of `jwloka`.
- `accountNamesReader` and `accountTicketOwnership` (`rules/ownership.ts:~150`) already match a Jira assignee to the reader through that spelling. `TRACKER_LISTERS` (`adapters/tracker/tracker-listers.ts:20`) declares the prefix `jira:`. `ownership.test.ts:273-279` pins both directions.
- What does not exist: (1) the **forward** question, handle to account. A ticket query ("tickets assigned to this person") and the second slice's assignee read need it, and the directory is keyed spelling to handle, so nothing answers it. (2) The **angle form** from the plan and the design. Today `Jan Wloka <jira:jan.wloka@quatico.com>` is parsed as ONE spelling with that whole text, which no assignee ever equals. A person who writes the plan's own example gets silent no-match, the failure `ownership` reports as `unknown`.

### Settled decisions — do not re-derive them

**Keep the comma form working, and add the angle form as a second spelling of the same fact.** The comma form is in use and pinned by tests; a parser that replaced it would break `ownership.test.ts` and every board that declared it. The parser reads `Name <tracker:account>` as two spellings of the handle, `Name` and `tracker:account`. Result: `accountNamesReader` and the ownership rule need **no change**, and both forms give the same directory. A test asserts the two config texts produce equal directories. The plan says "the domain parses the form"; this is that, without a second matching path.

**The forward answer is a function over the directory, not a new field on it.** `PersonDirectory` stays `Readonly<Record<string, string>>`: seven files import it (`ownership.ts`, `ticket-lanes.ts`, `waiting-tickets.ts`, the three card-facts rules, `server-info.ts`) and changing its type is a repo-wide diff with no behaviour change. Add `trackerAccountsOf(handle, tracker, directory)` returning the accounts as a sorted `readonly string[]`, found by scanning for keys that start with `<tracker>:` and map to the handle. A list, not a single value, because one person may hold two accounts on one tracker and a single-valued answer would pick one silently. Empty list means no account declared: **absent is not false**, and the caller must read it as "unknown", never as "has no tickets".

**Accounts come back lowercased.** Directory keys are lowercased by `normalize` (`person.ts:30`). Jira accounts matched by email are case-insensitive, and `accountNamesReader` already compares lowercased. Do not store the original case in a second map to return it: that is a second source of truth free to drift. State the lowercasing in the TSDoc.

**A tracker name is the text before the first `:`, lowercased, and an empty or colon-free angle body is not an identity.** `<jira:>`, `<:acct>` and `<plain text>` declare no account and stay what they are today: a spelling, if anything. Do not guess a tracker.

**Two entries claiming one `tracker:account` for different handles resolve to nobody**, by the rule `parsePersonDirectory` already applies to any spelling. Do not special-case accounts.

**`peopleHandles` in `packages/board/src/server/entry/approve.ts:213` splits on `;` and `=` only**, and an angle body contains neither, so it needs no change. Confirm that with a test of the plan's example string rather than assuming it, and do not touch the file if the test passes. If the angle form puts a `,` or `;` inside `<…>`, that is not supported: say so in the TSDoc.

**The plan's `builds:` note names `parsePeople`, which does not exist.** The function is `parsePersonDirectory`. Keep that name and extend it; adding a second parser with the plan's name would create two parsers of one key. Say so in the PR body so the plan's note is read as shorthand.

**Out of scope, and each is another branch:** the tracker port reads, `issues.json`, `releaseOf`, any change to `ownership.ts` or `tracker-listers.ts`, and any `.tsx`. The plan has no `## Done when` section; the assertions below come from the slice line and the measured gap.

**Rules carried over unchanged:** absent is not false (an undeclared account is an empty list, never "none exist"); a value computed in the domain is tested in the domain; the directory is derived from the config text on every read and persisted nowhere.

### Done when

The slice line is the specification: the `People` key accepts `<tracker:account>` per person, the domain parses it, and it answers which account a handle is. Assertions that exist because a naive implementation passes without them:

- **Both forms, one directory.** `jwloka = Jan Wloka <jira:jan.wloka@quatico.com>` and `jwloka = Jan Wloka, jira:jan.wloka@quatico.com` give equal directories. Catches a parser that handles only the angle form and breaks the pinned comma form.
- **The plan's example, end to end through ownership.** With the angle form declared, `accountNamesReader(['jan.wloka@quatico.com'], 'jira:', reader)` is true for `jwloka`. Catches the silent no-match: a parser that keeps `Jan Wloka <jira:…>` as one spelling passes every parse test and fails this.
- **Forward answer.** `trackerAccountsOf('jwloka', 'jira', dir)` returns `['jan.wloka@quatico.com']`; a handle with no account returns `[]`; two accounts on one tracker return both, sorted; another tracker's account is not returned. Catches a single-valued answer and a tracker-blind prefix scan.
- **Case.** `<jira:Jan.Wloka@Quatico.com>` answers lowercased, and `' JWloka '` as the handle argument resolves. Catches a handle compared case-sensitively.
- **Conflict and malformed.** The same account claimed by two handles answers `[]` for both; `<jira:>`, `<:acct>` and `<plain text>` answer `[]`. Catches a half-parsed identity treated as an account.
- **A person with no extension keeps today's behaviour.** `parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht')` is unchanged: the existing `person.test.ts` cases stay green with no edit.

The domain branch gate is 100% (`pnpm --filter @plot-pm/domain exec vitest run --coverage` in CI), and `person.ts` already notes an unreachable branch it removed to meet it. Write each branch with a test that takes it, and assert an index you know is a string rather than adding an unreachable `?? ''`. New functions are arrows: `export const f = (…) => …`.

Plus: add a changeset (package `plot`; `@plot-pm/domain` is not a valid changeset package, `./scripts/check-changeset-packages.sh` refuses it) with the description first and the `bumps:` block last, and a `plan:` line naming this plan. Document the angle form where the `People` key is described. The plan's "rebuild the board artifact" note does not apply to this branch: it changes no board file, and a PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/entities/person.ts`, `packages/domain/test/person.test.ts`, at most one new domain test file for the ownership end-to-end case, the docs line for the `People` key, and the changeset. It does not touch `rules/ownership.ts`, `adapters/tracker/*`, `server/entry/approve.ts`, `packages/fleet/`, any `.tsx`, or `issues.json` handling. Collision check at brief time: `git ls-remote --heads origin` (16 heads) holds no `feature/delivery-*`, `feature/people-carry-*`, `feature/the-issue-index-*`, `feature/rows-share-*`, `feature/loose-ends-*` or `feature/tickets-reach-*` branch, so no pushed branch holds these files. The sibling plans name branches that touch other files: plan 1 the placement rule under `rules/` and board `.tsx`, plan 2 board `.tsx`. None is planned to edit `person.ts`. The one possible collision is the second slice of this plan, `feature/the-issue-index-reads-assignee-and-release`: if it needs `trackerAccountsOf`, it imports the one this branch lands and does not add its own.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

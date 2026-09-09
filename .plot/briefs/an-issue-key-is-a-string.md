## Implementation brief — every-issue-renders-as-open-issue (Identity slice)

- **Plan (canonical):** `docs/plans/2026-09-09-every-issue-renders-as-open-issue.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #856 merged
- **Branch:** `feature/an-issue-key-is-a-string` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention
- **Answers:** GitHub issue #849 (in part)

**In the SAME wave as `feature/an-issue-carries-its-status`**, running concurrently.
Both touch `plot-host.sh`'s Jira arm but different fields — Reading adds
`status` to the request and projection, you change the identity type across
four layers. Whichever lands first, the other rebases. **Also rebase onto
`feature/the-jira-jql-scopes-by-project` (#850) if it has landed** — it rewrites
the `jql=` line twenty lines above the projection.

### What to build

`number` becomes a **string** end to end, and `plot-plan-meta.sh` learns to read
a Jira key.

The concrete failure, measured 2026-09-09 during plan interrogation:

```
$ cat /tmp/plan.md
- **Issue:** PROJ-123
$ plot-plan-meta.sh /tmp/plan.md | jq .issues
[]
```

**A Jira ticket never leaves the inbox.** Write the plan, deliver it, release
it — the ticket still sits there.

Four layers disagree with the shell:

| layer | declares | reality |
|---|---|---|
| `plot-host.sh:3042` | `number: .key` | `"PROJ-123"`, a string |
| `schema.ts:2970` | `number: z.number()` | lies |
| `fleet.ts:2259` | `{ number: number; … }[]` | lies |
| `fleet.ts:2171` | `Promise<Set<number> \| null>` | lies |

**TypeScript cannot see it** because the shell's JSON arrives as
`JSON.parse(line) as { number: number; … }` — a cast, not a parse.

The damage is at `fleet.ts:2286`:

```ts
.filter((i) => !referenced.has(i.number))
```

That is the rule that makes the inbox an inbox — *open tracker issues no plan
references*. It compares a Jira string against a `Set<number>`, so it never
matches.

### The decisions the plan settles — do not re-derive them

**This applies an existing decision rather than making a new one.**
`entities/issue.ts` already states the rule the read path breaks:

> Identity: a natural key — **an opaque string**, which fails by the source lying.

The entity says string. Four consumers say number. You are making the code agree
with its own docstring.

**A GitHub number stringifies losslessly.** `123` and `"123"` name the same
issue and compare equal once both sides are strings. **A Jira key has no integer
form at all** — `PROJ-123` cannot be coerced, which is why the type is
unfixable in the other direction.

**Both halves must change together.** The parser reads only `#N` today, so even
with the types fixed, a plan answering `Issue: PROJ-123` still records nothing
and the filter still never matches. Changing one half alone leaves the bug.

**Not chosen: coercing at the boundary.** `Number(i.number)` satisfies the type
and produces `NaN` for every Jira key — a filter that never matches, which is
exactly today's behaviour with a cast in front of it. **An assertion below
checks no coercion was added.**

**Rules carried over:** absent is not false. A plan naming no issue records `[]`
because it references none — never confuse that with a plan whose key could not
be parsed.

### Done when

The plan's Identity assertions are the specification:

- **A plan naming `Issue: PROJ-123` parses as `issues: ["PROJ-123"]`.** Measured
  `[]` today; that is half the defect.
- **A Jira ticket answered by a plan LEAVES the inbox.** The whole point, and
  the assertion a type-only change would pass without.
- **A GitHub issue still drains** — `#849` in a plan against `849` from the
  host, both strings, still equal. This is the regression the change could most
  easily cause.
- **No consumer coerces** — `grep` finds no `Number(` on the issue path.

**`plot-plan-meta.sh` is contract-tested**: `pnpm run test:reconcile` covers the
plan-format parser, and `docs/plans/` holds 250+ real plans that must keep
parsing identically. A parser change that alters any existing plan's `issues`
array is a defect, not a feature.

**Beware the awk region in `plot-plan-meta.sh`**: it is single-quoted, so an
apostrophe anywhere inside it closes the shell string and produces syntax
errors.

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), then
`corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`,
`corepack pnpm run test:board`, `corepack pnpm run typecheck`, and
`corepack pnpm run build:board` with the artifact committed. Add a changeset
(`'plot': patch` plus `'@plot-pm/board': patch`, description FIRST, `bumps:`
block LAST, with a `plan:` line). **Do not run `pnpm run test:e2e`** — CI's gate.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Slices` section on `main` — check `git branch --show-current` is `main`
before that edit. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the identity type: `IssueRowSchema.number` (`schema.ts:2970`),
`fleet.ts`'s two local types and `referencedIssues`' `Set<number>`, and
`plot-plan-meta.sh`'s `Issue:` field parsing.

**Do not touch:** `status` or `statusCategory` anywhere — that is the Reading
and Rendering slices. **Do not touch the `jql=` line** — that is #850. **Do not
widen the `Issue` entity** beyond what the identity type requires.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

## Implementation brief — a-state-declares-its-lifecycle (slice: Refusing the next hidden one)

- **Plan (canonical):** `docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `infra/a-state-declares-its-lifecycle` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

The ratchet. Its three siblings have landed — `story` (#707), `agent` (#710), `worktree` (#716) — so this is what stops the next hidden lifecycle.

## What this delivers

`scripts/check-state-declarations.sh` — a CI gate counting state-shaped enums that have neither a `transitions/<entity>.ts` nor a stated reason they do not transition, failing when the count grows.

## THE NUMBERS HAVE MOVED AND THE STARTING POINT IS TODAY'S

The plan says *"37 `z.enum` occurrences, 1 rule"*, re-counted 2026-09-04. **Re-measured 2026-09-06:**

```
z.enum occurrences in packages/domain/src   35   (plan said 37)
transitions/*.ts rules                       4   (plan said 1)
```

The rules are `agent.ts`, `plan.ts`, `story.ts`, `worktree.ts` — three of them this plan's own siblings, landed while this slice waited.

**Start the ratchet at what you measure on the day you write it**, not at 37. A gate that starts above the real number passes on an estate that has already regressed.

## It counts occurrences, not exported names

**35 of the enums are named exports; two are not.** Verified 2026-09-06:

```
entities/charter.ts:81   atCeiling: z.enum(['finish', 'end'])
entities/fleet.ts:702    host: z.enum(['ok','throttled','secondary','failed','unknown'])
```

Both are inline field enums with no name to hang a declaration on. **A gate matching `export const …Schema = z.enum(` would report a clean estate while skipping them** — the blind spot a NUL byte already cost this repo across six gates.

## The declaration sits at the enum, and the file is checked separately

**A file cannot carry it.** `entities/sprint.ts` holds **three** enums — `SprintState` is a lifecycle, `MoscowTier` and `ItemStatus` are not — so a `transitions/sprint.ts` would satisfy a file-level gate for all three, including the two that must never have one.

`rules/verdict.ts` is worse: it holds `StartabilityVerdict` and `BriefState`, for entities that do not share its name. **There is no reliable enum → entity mapping**, so the unit is the enum, which is also the thing that can hide.

## The pattern is already in this repo

`scripts/check-ancestry-decisions.sh` bans an *undeclared decision* rather than a call, requiring `# plot-ancestry: prefilter|evidence` within five lines — because no grep can tell the two kinds apart and the difference is what the answer flows into.

**This gate is the same act:** a marker within N lines of each `z.enum` saying `lifecycle`, `reading` or `classification`, and a dedicated script rather than an inline `grep` in `ci.yml`.

**Where the marker says `lifecycle`, the gate also requires the rule.** Marker alone would let a lifecycle be declared and never written; the file check alone cannot see which enum it covers. Together they answer both halves, and neither can be satisfied by accident.

## Its job is to stop the next one, not to reach zero

Four rules exist. **The count ends near 31 and the target stays debt.** Every enum added after this must declare its kind — which is the failure this story exists to prevent.

**The declarations are themselves the review.** Writing 35 of them is what finds the next lifecycle nobody had noticed.

## Testing

**Asserted: the gate fails on a new enum added without either.** A ratchet nobody can trip is a comment — so the test adds one and watches CI go red.

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and the new script must pass on the estate after the 35 declarations land.

## Done when

- the gate counts undeclared state-shaped enums and fails when the number grows
- it catches the two inline enums, not only named exports
- a `lifecycle` marker without a `transitions/<entity>.ts` fails
- all 35 occurrences carry a marker
- adding an undeclared enum fails CI, proven by a test
- the gates above pass

## Do not

- **Do not match `export const …Schema = z.enum(`.** Two enums have no name.
- **Do not check per file.** `sprint.ts` holds one lifecycle and two non-lifecycles; `verdict.ts` holds enums for entities that do not share its name.
- **Do not start the ratchet at zero or at 37.** Measure on the day, state the target as debt.
- **Do not inline it in `ci.yml`.** A dedicated script, like `check-ancestry-decisions.sh`.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

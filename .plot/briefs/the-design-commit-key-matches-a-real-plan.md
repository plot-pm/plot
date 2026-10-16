## Implementation brief — fleetd-scan-cost-and-read-cadence (wave Implementation)

- **Plan (canonical):** `docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md` on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
- **Branch:** `bug/the-design-commit-key-matches-a-real-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate, required since 2026-10-15)

This slice is independent of the plan's other four branches — different files, no shared state — so it may run alongside them.

### What to build

`designCommitOf` in `packages/fleet/src/shared/auto-design.ts:462` and the near-identical helper of the same name in `packages/board/src/server/entry/design.ts:146-158` both read a plan's `Design:` commit with:

```ts
/^Design:\s*(\S+)/m.exec(text)?.[1] ?? ''
```

No real plan is ever written this way. A plan records the field as a bulleted, bold `## Status` line:

```
- **Design:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
```

(see `## Status` above in this very plan for `Approved:`/`Started:` in the same shape). The regex requires the line to *start* with `Design:` — no leading `- **`, no trailing `:**` — so it never matches, `designCommit` is always `''`, and every comparison keyed on it (`failures[slug]?.reading === designCommit`, `store.restart[slug] === designCommit`, the `declined` record's `commit`) is comparing against a constant empty string rather than a real commit. A plan whose spec run failed once can never be told apart from one whose run failed under a different, newer `Design:` record — `runRetryVerdict` and the restart-vs-stale check in `specStart` both silently degrade to "same key, always."

### The decisions this plan settles — do not re-derive them

**Read the key through `refs.recordCommit(file, 'Design')`, not through a regex on plan text.** The adapter already parses this exact shape for `Approved`/`Delivered`/`Started` style fields — `recordCommitOf` in `packages/domain/src/adapters/refs/refs-git.ts:309-318` walks a `git log -p` stream and matches `^\+[ \t]*[-*][ \t]*\*\*<field>:\*\*[ \t]*(?!<!--)\S`, i.e. exactly the bulleted-bold shape plans actually use, and resolves to the *commit that added the filled record* (not the field's literal text value). This is the mechanism `auto-verify.ts` and `verification-record.ts` already rely on for `Delivered`. Do not write a second regex that tries to parse `**Design:**` inline — reuse `recordCommit('Design')` through the `Refs` port both callers already hold (`refs` in `auto-design.ts`, `ctx.refs` in `design.ts`).

Both callers need an **async** read now (`recordCommit` returns `Promise<PortResult<string | null>>`), where the old `designCommitOf` was a synchronous string function. In `auto-design.ts`, `designCommit` is read inside the per-plan loop (`:584`) and inside the final `rows` map (`:642`) — thread the async call through both, and keep a `?? ''` fallback on a `PortResult` that isn't `ok` (an unreadable plan file should read as "no Design commit" the same way an unmatched regex used to, never throw). In `design.ts`, `designCommitOf` is already `async` and already resolves a `planFile` path — add one `ctx.refs.recordCommit(planFile, 'Design')` call in place of the manual `showFile` + regex, which also removes the now-redundant `ls-tree`/`showFile` plumbing there if `recordCommit` subsumes it (check the port's own file-resolution contract before deleting; `recordCommit`'s signature takes a `file` path, so the `ls-tree` lookup for the plan's path likely still has to run first).

**`specRow`'s `designCommit` parameter and `DesignWorkReadings`/`SpecStartInput`'s `designCommit` field do not change shape** — they still take a `string`. Only the two *producers* of that string change from sync-regex to async-`recordCommit`.

### The `open-pr` slot-refusal retry (#1673)

`design-work.ts:141-142`'s comment on `specStart` already names the contract: a restarting run "does not pass... the three slot refusals, so the restarted run still needs a command and a free slot" — `slotRefusal` runs unconditionally at `:145`. Re-read `auto-design.ts:588-600`: `specStart`'s `start: true` branch is marked `// unreachable per specStart's own contract; kept so the branch is exhaustive` — confirm that invariant still holds once `designCommit` is a real (non-empty) value rather than always `''`; a `restarting` check (`store.restart[slug] === designCommit`) that used to always compare against `''` now compares against a real sha, which is the entire point of this fix, but double check no code path assumed the old always-empty value when deciding `restart`.

### `specRow`'s section return (#1673, "returns an entry and no section")

Re-read `design-work.ts:201-240`'s `specRow`. The plan's finding is that the board's `spec-row.ts` (a different file, `packages/board/src/app/lib/agent-rows/spec-row.ts`) wraps this domain `specRow` into a row and loses the `log`/`restart`/`section` detail somewhere in that wrap — read that board-side file before assuming the domain function itself is the bug; `design-work.ts`'s `specRow` already returns `{ reason, log, restart, stopped, halted }` fully. If the board wrapper discards one of these fields, fix the wrapper, not the domain rule.

### The restart command judges "spec written" by commit count, not by content (#1685)

`design.ts:222-223`:

```ts
const text = await ctx.refs.commitSubjects(`origin/${defaultBranchName}..origin/${branch}`);
const written = text.ok && text.value.length > 0;
```

This reads "any commit exists past default" as "the spec was written." Compare against `settleDesignRun` in `auto-design.ts:398` (`specIsEmpty(text.value)`, reading the plan's actual `## Spec` section content at the branch tip) — that is the correct judgement already proven elsewhere in this file. A commit that touches something other than the `## Spec` section (or a commit that clears it back to the placeholder) reads as "written" under the CLI restart path but "empty" under the fleet's own settlement path — the two can disagree on the same branch. Fix `design.ts`'s `restart` to read the plan text at the branch tip and call `specIsEmpty` (exported from `packages/domain/src/rules/fleet-run.ts:20-23`), the same way `settleDesignRun` does, rather than counting commits.

### Six LOW findings (TSDoc, test names, fixtures)

The plan names these as in-scope but unspecified. They are not detailed above because tracking issue #1673 is the source — read it for the itemized list before this slice is called done; do not invent six findings to match the count.

### Done when

The plan's `## Done when` is not written as a separate section in this plan (check `## Changelog`/`## Design` — the operative line is: *"The fleet scan completes on a repository whose cold first scan exceeds 90 s, and the tick spends host calls only on desks that can release."* — that line names slices 1 and 2; this slice's own correctness bar is: a plan written in the real `- **Design:** ...` shape produces a non-empty `designCommit` from both `auto-design.ts` and `design.ts`, and a failed-then-retried spec run under the same `Design:` commit is recognized as the same run (not a fresh one every pass).

Add tests proving:
- `recordCommit(file, 'Design')` against a fixture plan written in the real bulleted shape returns a non-empty sha (a corpus-style test against `refs-fixture.ts`, or a focused test on the two call sites using the existing `refsFixture` adapter).
- `specRow`/`specStart`'s restart-vs-fresh-failure distinction still holds once `designCommit` is non-empty (a failure recorded under commit A is NOT read as matching a new failure under commit B).
- `design.ts`'s `restart` command refuses to call a branch "written" when its only post-default commit leaves the `## Spec` section empty — mirror `settleDesignRun`'s own test fixture for `spec-empty`.

Plus: build artifacts — this slice touches `packages/board/src/server/entry/design.ts`, so rebuild the board artifact (`pnpm build:board`) locally to confirm it compiles, but do not commit the rebuilt bundle (generated, `-merge` marked; CI rebuilds it after merge). No changeset packages beyond `plot` / `@plot-pm/board` are valid — see root `CLAUDE.md` Versioning section — and the changeset's description must be the first line, ≥20 characters, with any `plan:`/`bumps:` block last.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites named in `## Plot Config`'s `CI suites` key run in CI, not here; do not run `pnpm run test:e2e` locally (CI's job, not a local one per root `CLAUDE.md` Testing section).

`scripts/check-shell-lines.sh` is irrelevant here — this slice touches no `.sh` file (only `.ts`), so it pays nothing against the shell ratchet.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads this plan, titles the PR from the slice's wave heading, and refuses a branch no plan names or one a PR already carries. Push the first real commit as soon as it exists — do not wait for the slice to be "done" before the PR appears, since `plot-dispatch`'s board state and the `→ #<number>` annotation below both depend on it existing.

Once the PR is open, append `→ #<number>` to this branch's line in the plan's `## Slices` section (currently line 64: `` `bug/the-design-commit-key-matches-a-real-plan` — `designCommitOf`, the `open-pr` slot rule, `specRow` section, spec-written judgement (#1685, #1673) ``), committed to `main`.

### Scope guard

This branch owns:
- `packages/fleet/src/shared/auto-design.ts` (the `designCommitOf` helper, its two call sites, and the `specStart`/`specRow` wiring around `designCommit`)
- `packages/board/src/server/entry/design.ts` (the duplicate `designCommitOf` helper and the `restart` command's "written" judgement)
- `packages/board/src/app/lib/agent-rows/spec-row.ts` (only if the section-loss finding traces there — confirm before editing)
- `packages/domain/src/rules/design-work.ts` (read-only reference for `specRow`/`specStart`'s existing contract; edit only if the section-return finding requires a domain-level change, which is not expected)

Other branches in this plan, verified against the plan's `## Slices` section at dispatch time:
- `bug/the-cold-scan-converges` — `packages/fleet/src/shared/fleet-scan.ts` (#1756, already merged as #1892)
- `bug/the-tick-asks-nothing-for-an-ended-desk` — `registryd.ts`, `registryd-main.ts` (#1374, already merged as #1905)
- `bug/the-settled-walk-survives-a-burst` — `packages/domain/src/.../default-branch.ts` (#1582) — in flight
- `bug/the-issue-index-writes-at-on-an-answer` — `IssueIndexSchema`, `issue-refresh.ts` (#1652) — not yet started

None of these touch `auto-design.ts`, `design.ts`, or `spec-row.ts` — no file collision expected. If you find something the plan did not anticipate, report it rather than improvising outside scope.

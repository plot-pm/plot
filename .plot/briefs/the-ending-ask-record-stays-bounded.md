## Implementation brief — desk-markers-and-the-reaper (wave: Needs a person)

- **Plan (canonical):** [docs/plans/2026-10-17-desk-markers-and-the-reaper.md](../../docs/plans/2026-10-17-desk-markers-and-the-reaper.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1976 merged
- **Branch:** `bug/the-ending-ask-record-stays-bounded` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

`bug/the-reaper-reads-the-desk-loop-and-the-root-marker` goes first in this plan — it is the only slice that can delete work — but holds no file this slice touches, so there is no ordering dependency to wait on. `bug/a-fresh-agent-prompt-describes-no-question` also touches `registryd.ts`; see Scope guard.

### What to build

Issue #1843 folds #1393 and #1394 into this slice. **Re-check every finding below against main before changing anything — several of #1394's findings are already fixed by work that landed after the issue was filed, and the plan requires recording a reproduces/does-not-reproduce verdict for each before code changes.**

**Confirmed still open, reading `registryd.ts` on current `main`:**

1. **#1394's MEDIUM: a merged desk's stale marker keeps paging a person (`escalationDesks`/`escalationWrites`, `registryd.ts:356-403`).** `escalationDesks` builds its desk list from `supervise`'s registry agents plus every unregistered `freshAgentCandidateTrees` result — it reads no merge state at all. `escalationWrites` then reads each desk's marker and fires `questionEscalation` purely off the marker's age. A manifest-less desk whose PR merged and that still carries an old loop-written `PLOT-BLOCKED.md` (written before the fix in #1391) notifies at every age rung until the reaper removes the worktree — there is no merge check anywhere on this path. `mergedDeskState` (`packages/domain/src/rules/merged-desk.ts:47`) already exists and is exactly the rule this needs; nothing in this slice's territory calls it today (`grep -rn mergedDeskState packages/fleet/src` currently returns no production call site — only the domain's own module and `drop`, which is `bug/drop-reads-a-merged-desk-as-finished`'s territory, not this one). Fix: thread a merge reading into `escalationDesks` or `escalationWrites` (per-desk, from the tick's `merges` memo so it costs no extra call beyond what the tick already asks) and skip a desk `mergedDeskState` reads as merged before computing its rung.

2. **#1393's LOW: the ending's branch is not compared against the desk's branch (`registryd.ts:700-719`, the `escalated`/marker read inside `readFreshAgentCandidates`/the surrounding desk-state assembly).** `endingAsksFreshStart` (`ending-action.ts:191`, called from `continuation.ts:605`) takes the branch explicitly and compares it; the equivalent assembly in `registryd.ts` around the lines the issue cites does not carry the same comparison when deciding whether an existing marker or ending belongs to the branch now checked out. Re-read the current line numbers — `registryd.ts` has moved since #1393 was filed — and confirm whether a desk that took up a different branch after a stale ending can still be asked about the old one. If it reproduces, the fix is a branch-identity check before treating a marker/ending as current, mirroring `endingAsksFreshStart`'s own guard.

3. **#1393's LOW: the PR body never reported what the grep for `status === 'blocked'` readers found.** This is a reporting debt from #1391's brief, not a code defect — re-run the grep (`rg "status === 'blocked'"` or equivalent across `packages/`) and say in this slice's PR body what it finds, even if the answer is still "no reader."

4. **#1393's LOW: the `blocked` marker wording (`ending-action.ts:302`, "reported it could not proceed") misdescribes the `blocked` ending written for dropped background work (`agent-loop.ts:792`).** Read both sites on current main: confirm the `blocked` ending still covers both "the agent said it couldn't proceed" and "background work was dropped," and if so, reword the marker text to cover both cases rather than implying only the first.

5. **#1394's LOW: `.plot/state/ending-asks.tsv` only grows, and `asked` re-reads the whole file per candidate per tick.** Confirmed on main: `ending-ask-record-file.ts`'s `append` (`:92-99`) only appends, and `asked` (`:76-89`) calls `readFile` and re-parses every line on every call — `readFreshAgentCandidates` calls `asks.record.asked(...)` once per candidate (`registryd.ts:854`), so a tick with N candidates re-reads and re-parses the same file N times. There is no prune path anywhere in the adapter or its port (`ports/ending-ask-record.ts`) — grep confirms zero `prune`/`reap` references in that file or its port. Fix either half independently: read the file once per tick (a memo keyed the same way `worldForRepo`'s `merges`/`planLinesThisTick` memos already are — look at `beginTick`'s `memo = null` pattern at `registryd-main.ts:483-484` for the shape to match) and/or prune rows whose worktree the reaper has already removed. The plan slice's name — "the ending-ask record stays bounded" — is about the growth half; prioritize that even if the per-tick re-read is left as a separate, smaller finding.

**Re-check and likely already fixed — confirm and record rather than re-fixing:**

- **#1394's second MEDIUM, "an uncounted host call every tick" for a merged desk with an outright ending.** On current main, `readFreshAgentCandidates`'s `prMerged` read (`registryd.ts:878-881`) only fires `(endingAsksPersonOutright(ending) || isBoundEnding(ending)) && !endingAsked`, and `freshAgentDeskReads`'s own `prMerged` wrapper (`registryd-main.ts:1807` in the issue's citation, confirm the current line) increments `tally.calls` before calling `askMerged`. The tick's own `prMerged` on `worldForRepo` (`registryd-main.ts:498-509`) also increments `tally.calls` and reads through the per-tick `merges` memo cleared each `beginTick`. This reads as already fixed — the call is both counted and memoized. Verify by tracing one full tick for a merged desk with an outright ending and confirming `tally.calls` increments exactly once per distinct branch asked, then record "does not reproduce; counted via `tally.calls` and memoized via `merges`" in the plan rather than re-adding counting that already exists.
- **#1394's LOW, "the key is the ending file's mtime," asking for an `at` field.** `EndingAskRecord` (`ports/ending-ask-record.ts`) and `encodeRow`/`decodeEndingAskRow` (`ending-ask-record-file.ts:28-41`) already carry a fourth field, `at`, distinct from `endingAt` — the row format is `plan, branch, endingAt, at`. This reads as already fixed. Confirm `at` is actually populated with an ask-time (not re-derived from the same mtime) at its one call site and record the verdict.
- **#1394's LOW, "an answer before any `--start-agents` tick records the ask can be asked again."** Check whether `asks.append` is now called on every tick that sees the marker rather than only once — if the current code already does this, record "does not reproduce."
- **#1394's LOW, "an unreadable ending time leaves `endingAt` empty, re-asking every answer."** `readFreshAgentCandidates` (`registryd.ts:853`) sets `endingAt = ending === null ? null : await asks.endingAt(...)`, then `asked = endingAt === null ? null : ...` — an unreadable ending time already short-circuits to `asked = null`, read as not-yet-asked. Confirm this is the behavior wanted (re-ask on an unreadable time, rather than silently treating it as answered) and record the verdict either way.
- **#1394's LOW, "an unwritable record logs `escalation-failed` every tick, also when the marker did land."** Read `registryd.ts:1203` (`if (!recorded.ok) return failure('the ask could not be recorded...')`) against where the marker write and the record append happen relative to each other — confirm whether a landed marker with a failed record write is still reported as a full failure, and if the wording is still accurate given current call order.
- **#1394's LOW, "desks marked only by a `blocked` declaration before #1391 get one marker and one notify on deploy."** This was flagged as "probably wanted" in the issue itself — no fix needed, just confirm the release note (this slice's changeset or the plan's Changelog) states it if it still applies.
- **#1394's LOW, TSDoc at `ending-action.ts:316` arguing design rather than interface.** Read the current docblock at that function; if it still narrates a rejected alternative rather than stating the interface, move the argument into this slice's commit message and trim the comment, per `CLAUDE.md`'s Domain Package rule ("Factual API documentation").

### The decisions the plan settles — do not re-derive them

**Each of the ten findings folded into #1843 gets its own re-check against current main, recorded before any fix lands — a finding that no longer reproduces is recorded in the plan's notes and closed without a fix, never silently dropped.** The sibling brief for `bug/a-fresh-agent-prompt-describes-no-question` already found several of #1386/#1389's findings pre-fixed by `be2033d1e`; the same pattern holds here — `endingAt`/`at` key separation and the counted/memoized `prMerged` call both read as already landed. Do not re-implement either; confirm and record.

**`deskLoopAlive` and `mergedDeskState` already exist** (`rules/desk-loop-alive.ts`, `rules/merged-desk.ts`) — this slice routes a caller to `mergedDeskState`, it does not add a new rule. The reaper slice routes `deskLoopAlive` on its own territory; this slice's job is wiring `mergedDeskState` into the escalation/notify path (finding 1 above), which currently has no merge awareness at all.

**Rules carried over unchanged:** absent is not false — an unreadable `asked`/`endingAt`/`prMerged` read takes the same "ask again" or "unanswerable" arm as a genuine miss, never the same arm as a confirmed negative; read the result's `ok` flag, not the emptiness of its value. The host is asked only where its answer can change the verdict (`registryd.ts:874-877`'s own comment) — any change to the merged-desk check in finding 1 must keep that invariant: reuse the tick's existing `merges` memo rather than adding a second, unmemoized host call for the same question.

**Style:** a helper you write or rewrite is an arrow (`CLAUDE.md` Domain Package rule, applies to new code generally). Existing `function` declarations elsewhere in `registryd.ts` or the adapter stay untouched unless you are the one rewriting that specific function's body.

### Done when

The plan's `## Done when` list is absent; its Slices line is the specification, lifted into concrete assertions:

- A test reproduces finding 1 on unmodified main first — a manifest-less desk with a merged PR and a stale `PLOT-BLOCKED.md` marker still produces a `notify` write from `escalationWrites` — and fails before the fix, passes after it reads `mergedDeskState` (or an equivalent merge check sourced from the tick's memo) and skips the desk.
- For every other finding above, the PR body records a reproduces/does-not-reproduce verdict with the line read on current main — not just for the one finding fixed in code. This applies regardless of outcome, per the plan's Design section.
- Any TSV-growth fix (finding 5) ships with a test proving the file does not grow without bound across repeated ticks for the same desk, or — if only the per-tick re-read is fixed — a test proving the file is read once per tick rather than once per candidate.
- Every new or changed assertion fails on an unmodified `main` before the fix lands — mutate once per test and watch it fail, per `superpowers:verification-before-completion`.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This branch is expected to touch `packages/fleet/src/server/entry/registryd.ts` (escalation/notify path) and `packages/domain/src/adapters/ending-ask-record/ending-ask-record-file.ts` plus their tests — expect the fleet-side and domain-side vitest/typecheck entries from the `Local checks` config. The suites in the `CI suites` key run in CI on every PR; do not run `pnpm run test:e2e` locally — it is CI's gate, not a local one (`CLAUDE.md` Testing). Add a changeset for `plot` with the description first and the `bumps:` block last — this is a `bug/` branch, so `patch` unless a fix changes an observable contract.

Name the shell gate too: `scripts/check-shell-lines.sh` refuses growth of shipped shell against this branch's merge base. This slice is expected to touch no `.sh` file; if that changes, remove an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Needs a person` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the escalation/notify path in `packages/fleet/src/server/entry/registryd.ts` (`escalationDesks`, `escalationWrites`, and the `FreshAgentAskReads`/`readFreshAgentCandidates` assembly where finding 2's branch-identity check lands) and `packages/domain/src/adapters/ending-ask-record/ending-ask-record-file.ts` plus its port.

**`registryd.ts` is shared territory.** `bug/a-fresh-agent-prompt-describes-no-question` also edits this file, in `continueOnDesk`'s marker/fresh handling and `worker-loop.ts`'s empty-marker read — a different section (the fresh-agent decision path, not the escalation/notify path this slice owns), but the same file. Verify at dispatch time whether both branches touch overlapping line ranges; if so, that is a known collision to report at merge time, not a surprise. `bug/the-reaper-reads-the-desk-loop-and-the-root-marker` (reaper/`--stop`/marker-root-match) and `bug/drop-reads-a-merged-desk-as-finished` (drop/`mergedDeskState` in its own call site) touch different files entirely.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — the-task-state-is-a-domain-rule (wave Deciding in the domain)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/the-task-state-is-a-domain-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 2 of eight. The shell keeps reading the world; it stops deciding.

### What this branch owns

`plot_worker_task_state` (`skills/plot/scripts/plot-worker-state.sh:533`) decides `finished | waiting | stalled` from four booleans — `has_pr`, `blocked`, `dirty`, `unpushed`. **Move that decision into the domain**, behind a bundle, exactly as `plot-verdicts.mjs` already works.

**The function survives; only its body moves.** It stays a shell function that pipes its four readings to the bundle and prints the answer. Twenty files source this script — none of them changes.

**Follow the precedent at `plot-fleet-scan.sh:3436`**, including the part that is easy to skip: the caller checks the bundle answered for **every** input and exits 2 with a message naming `pnpm build:board` when it did not. A bundle that silently answers for fewer readings than it was given is the failure this guard exists for.

### The ordering is the rule, and it is measured

The four checks are not independent — their order carries the meaning:

1. `has_pr` → `finished`
2. `blocked` → `waiting`
3. `dirty` → `stalled`
4. `unpushed` → `stalled`

**Dirtiness is checked AFTER blocked**, deliberately. A blocked agent is usually also dirty; reporting it `stalled` would send a person to look at work on the floor when what is owed is an answer to a question.

**`unpushed` is only answerable through `@{upstream}`.** The comment at `:539` records what happened when it was not: a fallback counting against `origin/main` reported every clean branch `stalled` in a repo with no remote, because `rev-list --count "..HEAD"` with an empty left side counts the whole history. Nine commits of ordinary history read as nine commits of unpushed work. **Where there is no upstream the question is unanswerable, not zero.** Carry that into the rule's types: the reading is `boolean | null`, and `null` must not become `stalled`.

### What it does NOT own

**The 21 world reads.** They stay in shell. The rule takes readings as values and performs no I/O — the shape `packages/domain/src/rules/free.ts` and `rules/quiet.ts` already use.

**The eight states themselves.** `feature/the-registry-reads-eight-states` is wave 3.

**The other five process states.** This function answers three; `plot_worker_state` decides the rest and is untouched.

### Done when

- `plot_worker_task_state` prints the same answer for every combination it does today, proven by tests over all four booleans including the `null` upstream case.
- The decision exists **once**. No second implementation in shell — that drift is what this script carried until 2026-08-18, five of six states in duplicate.
- The caller verifies the bundle answered, and fails with a message naming the rebuild.
- All twenty sourcing callers are untouched, and `git diff` shows it.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here produced 53 concurrent test processes and a board that could not answer in 25 seconds.

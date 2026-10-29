## Implementation brief — the-fleet-answers-plot-blocked-questions (wave Answer record)

- **Plan (canonical):** `docs/plans/2026-10-29-the-fleet-answers-plot-blocked-questions.md` on main
- **Approved:** 2026-10-30, Jan Wloka, plan-PR #2913 merged
- **Branch:** `feature/the-answer-record` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + `plot/review`)

This is the plan's first wave. Nothing waits on it. `feature/fleetd-answers-a-question` waits on it, and also on #2898's two slices and #2900's `feature/fleetd-reviews-slice-prs`. This slice builds none of those.

### What to build

Every answer given to a blocked desk goes into one per-question record, and `continue` refuses an answer that targets a question the desk no longer holds.

Today a person's answer through `/api/continue` or `plot-continue-command.mjs` leaves no record. `continueOnDesk` (`packages/fleet/src/shared/continuation.ts:815`) leaves the marker in place, so every tick sees the same `askedAt` while an answer is in flight. `escalations.tsv` only deduplicates notification rungs, keyed by worktree and marker mtime (`packages/fleet/src/shared/escalations.ts:6-12`); it gates nothing.

Build three things:

- **The record, as a port.** A domain port in `packages/domain/src/ports/` and a file adapter in `packages/domain/src/adapters/`, shaped on `FreshAgentRecordStore` (`ports/fresh-agent-record.ts`, `adapters/fresh-agent-record/fresh-agent-record-file.ts`). The file lives under the common git dir at `.plot/state/`, append-only, tab-separated, with an env override for its home so a test never writes the operator's file. Key: `(worktree, askedAt)`, where `askedAt` is the marker's modification time. Row: the question's first line, the answer, the author (`unblocker` or a person's handle) and the outcome (`started`, `answered`, `refused <reason>`, `failed`). A missing file reads as no rows; an unreadable one is `failed`, which the caller reads as zero rows, never as "already started".
- **`continueOnDesk` writes the `answered` row.** A person's call and fleetd's later call share one source. This slice writes the row for the caller it has today; the typed `caller` reading belongs to #2898.
- **`question-moved`.** Add it to `ContinueRefusal`. `continue` takes the question key it answers and refuses when the desk now holds a different question, the way `merge` pins to a head. A refused call writes nothing on the desk, the same no-trace contract the other refusals keep. Wire the key through `/api/continue` and `plot-continue-command.mjs`; a caller that sends no key keeps today's behaviour.

### Settled decisions — do not re-derive

- **The record lives in `.plot/state/`, not in the plan issue's comment.** `planStateComment` rebuilds the whole body at each phase write (`tracker-plan-state.ts:44-47`), Jira answers `no-target` (`tracker-jira.ts:297-300`), and one answer may be 8 KiB (`ANSWER_MAX`), so about seven answers fill GitHub's 65,536-character comment limit. Decision D6; the comment's answers list belongs to #2905.
- **Key on `askedAt`, the marker's mtime.** It is the key `escalations.tsv` already uses. A new question has a new `askedAt`, so "once per question" needs no counter.
- **Write the `answered` row inside `continueOnDesk`, not in the callers.** Two callers (board route and command bundle) would each need the write, and a third would forget it. The refusal and the record share one place.
- **Do not reuse `Correction budget`.** The loop bound is `Slice max runs` and `Slice max spend`, which `continue` already enforces (`continuation.ts:947-951`). No new counter.
- **Carry over unchanged:** absent is not "already started"; a refused `continue` leaves nothing on the desk; the layering rule — the controller calls the domain, the adapter reaches the disk, and no new `spawn`/`execFile` site appears outside `adapters/`.

### Done when

The plan's `## Slices` line for this branch is the specification. The assertions a naive implementation would pass without:

- A mismatched question key refuses `question-moved` **and leaves the desk byte-identical** — it catches a refusal that still writes the row or stops the loop.
- Two callers at once start one run, and the record names the winner — it catches a row written before the per-desk continue lock is held.
- A refused call writes no `answered` row — it catches a record that counts attempts, not answers.
- A missing file and an unreadable file each read as zero rows — it catches a `failed` read treated as a started question.

Tests live beside the code: `packages/fleet` unit tests for `continueOnDesk`, `packages/domain` tests for the adapter. For checks, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Add a changeset (description first, `bumps:` block last). This slice adds a `ContinueRefusal` member, so check the board's refusal wording tables and `bundles.generated.ts` through the local checks. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: remove shell elsewhere in the same change, or write the rule in the domain. It counts commands, not lines. This slice needs no shell.

New functions are arrows. TSDoc states what an export does, its parameters, return and failure, not the history of the decision.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/ports/` (the new record port), `packages/domain/src/adapters/` (its file adapter), `packages/fleet/src/shared/continuation.ts`, the `/api/continue` handler (`packages/board/src/server/continue.ts`) and `packages/fleet/src/server/entry/continue-command.ts` for the key. It does not own `question-escalation.ts`, `registryd.ts`, `unblockerDue`, the `unblock` write or any role agent: those belong to `feature/fleetd-answers-a-question` and #2898. #2898 also adds the unattended refusal to `continue`; expect it to touch `ContinueRefusal` and `continueOnDesk` too, so keep this diff to the key and the record.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — a-blocked-agent-s-question-has (wave 1: The ending record routes an answer)

- **Plan (canonical):** `docs/plans/2026-10-08-a-blocked-agent-s-question-has.md` on `main`
- **Approved:** 2026-10-08, jwloka, in-session
- **Branch:** `feature/a-blocked-ending-routes-its-answer` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issue #1366

Wave 2 (`feature/a-blocked-desk-is-not-held-by-a-free-wait`) waits on this branch. It consumes `continueTarget`, so keep the readings' shape stable and exported.

### What to build

On 2026-10-08 the agent on `bug/local-checks-find-tests-in-a-temp-worktree` (desk `.worktrees/free-b5f1581a`) wrote `PLOT-BLOCKED.md` with a real question. The board listed the slice under WAITING ON YOU, and `POST /api/continue` answered `no-manifest`. The loop deletes its manifest when it leaves (`packages/board/src/server/entry/worker-loop.ts:2153`), and `continueOnDesk` demands a manifest (`packages/board/src/server/continue.ts:687`). The board asks a person for an answer that no controller can deliver.

Build, in this order:

1. **`continueTarget(readings)`** in `packages/domain/src/rules/` as an arrow function with a TSDoc block that states behaviour only. Readings are values: the manifest answer (`named` / `unnamed` / `several`, the `DeskManifest` shape from `rules/desk-manifest.ts`), the ending record (reason, branch), whether an unanswered marker exists, and the loop pids with their state (`rules/desk-loop-alive.ts`). It answers `continue` with the manifest to stamp, `continue` with a manifest to **write**, or a refusal named as today (`no-manifest`, `several`, `loop-alive`, `no-question`). It imports `zod` and nothing else.
2. **`continueOnDesk` calls it** in place of the bare `deskManifestFor` check. The route keeps its refusal order and keeps every refusal before any write to the desk.
3. **The manifest write.** When the rule answers "write", the route writes a manifest naming the desk through the existing manifest writer, before it starts the loop and after every refusal was asked. Mirror the fields of a dispatcher-written manifest (`.plot/agents/*.json`: `session`, `resumeId`, `branch`, `worktree`, `command`, `loop`, `slug`). `resumeId` must keep resuming the blocked agent's session: read it from the desk, do not mint a new one unless `fresh` is set.

### Settled decisions — do not re-derive them

- **Read the ending record; the manifest keeps its meaning.** The issue proposed that a blocked ending keeps its manifest. Answered 2026-10-08, jwloka: no. A manifest with no live loop reads as a registered agent to `registryd` and to `/plot-fleet --status` today, and keeping it would change what that means. Do not touch `leave` or `leaveNow` in `worker-loop.ts`.
- **The ending record is a fallback, not a second registry.** `.plot-worker.ending.json` (`ENDING_FILENAME`, `packages/domain/src/entities/ending.ts:15`) is desk-local and names the branch and the reason. Read it with `readEnding`, as `registryd.ts:668` does. A `blocked` ending whose branch differs from the asked branch is refused, so a stale record from an earlier slice cannot route an answer to the wrong work. Test this case by name.
- **`several` stays a refusal.** Two manifests on one desk are an estate defect (`continue.ts:122-131`). The fallback applies only when the answer is `unnamed`.
- **A refused continuation writes nothing.** No manifest, no `.plot-continuation.md`, no log append. The existing comment above `manifestAnswer` gives the reason; assert it for the new refusals too.
- **The `loop-alive` rule is unchanged in this wave.** A loop waiting free on the desk still refuses. That is the first Open Question, answered (b), and it is wave 2. Do not stop a loop in this branch.
- **Open Question 3 is measured first.** The plan asks why the registry held no manifest while pid 43381 ran: either `reexec` (`worker-loop.ts:335`) ran `leave`, or the restarted process lost `PLOT_MANIFEST_FILE`. Read `worker-loop.ts` around `reexec` and the `leave` call sites, write the finding in the PR body, and record it in the plan's Open Questions. If it shows the restart path deletes the manifest of a live loop, report that in the PR as a separate defect; do not fix it here.
- **Release is out of scope.** The ending record stops routing once the claim is released (#1276). Add no release path.
- Carried-over invariants: absent is not false (a missing ending file answers "no fallback", never "not blocked"); read the exit code, not the emptiness; an unreadable ending file is a refusal, not a guess.

### Done when

The plan's `## Notes › Done when` list is the specification. Its first two bullets belong to this branch: a blocked desk with no manifest and no live loop starts a loop with a manifest that names the desk, and the same desk with an ending for a different branch is refused with nothing written. The third bullet (the free-wait desk) belongs to wave 2.

Assertions that exist because a naive implementation passes without them:

- **Wrong-branch ending refused, directory listing unchanged.** A rule that only checks `reason === 'blocked'` passes the happy path and routes an answer to the wrong slice.
- **Ending says `blocked` but no marker in the tree: `no-question`.** The marker is the question; the ending alone is not.
- **One test per answer of `continueTarget`**, including `several` and `loop-alive`. A rule tested only on the new branch lets the old refusals drift.
- **The written manifest is found by `deskManifestFor` afterwards** and answers `named`. A manifest that exists but does not name the desk passes a file-exists check and fails `loopRegistration`.
- **A route-level refusal after the rule said "write" leaves no manifest.** For example, `no-worker-command`.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add a changeset (description first, `bumps:` block last). If the board's refusal sentences change in this branch, rebuild nothing to commit: a PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new rule and its test), `packages/board/src/server/continue.ts`, `packages/board/src/server/manifest-stamp.ts` if the manifest writer needs it, and their tests. Wave 2 owns `ContinueWithAnAnswer.tsx` and the free-wait handling; leave both alone. `worker-loop.ts` is read-only for this branch except for the Open Question 3 measurement. No other branch of this plan is in flight.

Related plans that built the readings you call: `a-desk-and-its-manifest-name-each-other` (`deskManifestFor`, `loopRegistration`, the `no-manifest` refusal) and `every-loop-ending-has-a-supervisor-rule` (what each ending does). If you find something the plan did not anticipate, report it rather than improvising outside scope.

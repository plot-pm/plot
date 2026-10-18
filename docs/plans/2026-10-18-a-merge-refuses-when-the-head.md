# Bitbucket: a merge refuses when the head moved since the check

> A Bitbucket merge re-reads the PR head and refuses with `head-moved` when it differs from the sha the caller checked, and the controller gate stops exempting Bitbucket.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2054
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2061 merged

## Changelog

- Bitbucket merges refuse with `head-moved` when the PR head differs from the sha the caller passed, as GitHub merges already do.

<!-- Board impact: none. The plan format, template and layout do not change. -->

## Motivation

`plot-host.sh pr-merge` takes `--match-head <sha>`. On GitHub it passes the sha to `gh pr merge --match-head-commit`, so a push after the review and the checks refuses the merge. On Bitbucket the same flag exits 4 with "cannot pin a merge to a commit" (`skills/plot/scripts/plot-host.sh`, `pr-merge` arm). A caller on Bitbucket therefore merges without a pin, and a push that lands after the checks merges unreviewed.

Three places encode the gap:

- `packages/board/src/server/entry/host-pin.ts` — `hostPinsMerges` returns false for Bitbucket.
- `packages/board/src/server/entry/gate.ts` — the controller gate lets an unpinned `plot-host.sh pr-merge` through where the backend is `bitbucket`.
- `CLAUDE.md`, *The Master Agent Uses The Controllers* — states the exemption.

`packages/domain/src/workflows/merge.ts` already refuses `head-moved` when the PR's `headSha` differs from the caller's sha. That check compares against the head read at decision time; the host call that follows is unpinned on Bitbucket, so the window between read and merge stays open.

Related: #1848 (Bitbucket parity).

## Design

### Approach

1. **Measure first.** Read Bitbucket Cloud's pull request merge endpoint (`POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/merge`) and record in this plan what it accepts: any head, commit or version precondition in the body or headers. The result decides the mechanism and goes into `## Notes` with the date.
2. **If the endpoint offers a precondition**, `plot-host.sh pr-merge --match-head` passes it on Bitbucket. A host refusal maps to the same refusal name as GitHub.
3. **If it offers none**, the Bitbucket arm re-reads the PR head immediately before the merge call and exits with the `head-moved` refusal on a mismatch. The plan states the window that remains: the time between that read and the merge call, one round trip. The plan names this as a reduced window, not a pin.
4. **Gate.** Remove the Bitbucket exemption from `controllerGateOf` and `hostPinsMerges`, or narrow it to what stays true after step 2 or 3. The `CLAUDE.md` sentence is rewritten to state the result, and `scripts/check-agents-md.sh --write` regenerates `AGENTS.md`.
5. **Refusal name.** Bitbucket uses `head-moved`, the name in `packages/domain/src/workflows/merge.ts`. No new refusal word is added.

### Open Questions

- [ ] Does the Bitbucket Cloud merge endpoint accept any head or version precondition? Measure before choosing step 2 or 3.
- [ ] Which exit code does a `head-moved` refusal use in `plot-host.sh`, and does `plot-ask.mjs merge` already map it?
- [ ] Does the `bb` CLI expose the precondition, or does the arm call the REST endpoint directly?

## Slices

### Bitbucket merge pin

- `bug/a-merge-refuses-when-the-head` — Bitbucket arm of `pr-merge` honours `--match-head` (precondition or re-read), the gate and `host-pin.ts` drop or narrow the exemption, `CLAUDE.md` states the result. Tests cover a head that moved between check and merge: the merge refuses with `head-moved` and nothing merges, and a matching head merges.

## Notes

- Created from tracker issue #2054. No tracker write was made.

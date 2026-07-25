# Iteration Deliverable Rubric

An iteration PASSES if at least one criterion holds. Each is checkable from git or
forge state without asking the agent what it did.

| # | Criterion | Check | Cost |
|---|-----------|-------|------|
| 1 | Main branch advanced | `git rev-parse origin/<main>` changed | local |
| 2 | A branch was pushed or updated | `git ls-remote --heads origin` diff | local |
| 3 | A PR changed state | `gh pr list --json number,state,isDraft` diff | 1 call |
| 4 | Review comments posted | PR comment count increased | 1 call |
| 5 | A review thread resolved | `isResolved` flipped true | 1 call |

FAIL if none hold.

Criteria 1–2 are evaluated every iteration by the runner (main SHA via
`git rev-parse`, branch refs via `git ls-remote`). Criteria 3–5 require a forge
query and are evaluated by a verifier agent only when 1–2 fail — so the common
case costs one lightweight remote read, and the expensive path runs only on the
stall boundary.

**Not deliverables**, regardless of how the iteration describes itself: reading
code, analysing state, re-verifying already-verified work, planning the next step,
or confirming that something is already correct.

## For the verifier agent

You are given this rubric and the forge state before and after one iteration.
Answer one question — **does any criterion hold?** — and return `pass <n>` or
`fail`.

Not whether the work was good, or whether progress was made in some broader
sense. You are not given the agent's account of the iteration and must not ask
for it.

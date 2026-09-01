## Implementation brief — a-refused-dispatch-asks-for-a-brief (wave Asking)

- **Plan (canonical):** `docs/plans/2026-09-01-a-refused-dispatch-asks-for-a-brief.md` on main
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/a-refused-dispatch-asks-for-a-brief` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's second wave. `Naming` landed as #603 — `brief-path.ts` is on main and
`briefPath()` is the one function that computes a brief's path from a branch.
Use it; do not compute a path here.

### What to build

A `Brief command` config key, read through `plot-config.sh`, that
`plot-dispatch.sh` invokes when its brief gate fires — and a named
`no-brief-command` refusal when the key is absent.

Today the gate refuses a branch with no brief and stops there. The operator is
told what is missing and nothing is done about it, which is why every brief on
this estate was written by hand.

### The decisions the plan settles — do not re-derive them

**ONE config key, the shape three keys already use.** `Idea command`,
`Story command` and `Approve command` each name how to run an agent headless for
one prompt. `Brief command` joins them:

    - **Brief command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

**Absent means the capability is unavailable, never an error.** `commission.ts`
models this with a named refusal — `no-idea-command` — and the same shape
applies: a project with no `Brief command` behaves exactly as today.

**What it is asked to do is run `/plot-implement <slug>`**, whose step 4 already
owns brief authorship. **This plan adds no second brief writer**, and that is the
whole reason it is a config key rather than a new script: `/plot-implement` is
where the interpretation lives, and a second author would drift from it.

**ABSENT GATES; STALE ONLY REPORTS.** Two triggers, one gate:

| | decidable by | behaviour |
|---|---|---|
| absent | `git cat-file -s` on `origin/<main>` — already implemented | refuse, then call |
| stale | brief's last commit older than the plan's | report, never refuse |

Do not add a staleness gate. Measured 2026-09-01, all three live briefs were
older than their plans and **all three were correct** — every plan edit was
bookkeeping. A timestamp gate would have refused 3 of 3 on the day it shipped,
and a gate that refuses everything is one people disable in its first week.

It would also have missed the real case: the teardown brief was written AFTER its
plan and was still wrong, citing 80 `fs.rmSync` sites where the tree held 76 —
**the code moved, not the plan.** Freshness against the plan is the wrong input.
The report names the plan commit it compared against, and says plainly that it is
a hint.

**Rejected — a stub brief.** A stub is present and non-empty, so it passes the
gate and starts a worker into a specification that says nothing. Strictly worse
than the refusal it replaces, because the refusal is visible and the stub is not.

**Rejected — spawning the brief agent inline from auto-dispatch.** Budget:
`auto-dispatch.ts` spends a bounded number of spawns per pass and a brief agent
is a `claude -p` session of unknown length. Queue and report; the operator or the
next pass acts. Same posture as `commission.ts`.

### Out of scope

`feature/auto-dispatch-says-why-it-skipped` is the next wave and owns the skip
REASON. Do not touch `auto-dispatch.ts:442` here.

### Done when

- A dispatch refused for a missing brief **names what it did next** — called the
  command, or refused with `no-brief-command`. Assert both paths.
- A brief written by the callback **lands where the gate reads it**, proven by
  dispatching the same branch again and having it start.
- Staleness is reported and **never refuses**; the report names the plan commit
  it compared against.
- `pnpm run test:reconcile`, `pnpm run typecheck`, `pnpm build:board`, changeset.

### Repo gates

Node 24 (`nvm use`). `pnpm test`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm build:board`. **Do not run `pnpm run test:e2e`** — it is CI's gate and
dispatches real workers.

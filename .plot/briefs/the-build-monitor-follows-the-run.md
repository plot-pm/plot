## Implementation brief — three-monitors-watch-the-work (slice: Watching the build)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/the-build-monitor-follows-the-run` (base: `main`)
- **Ends as:** one PR to `main`

Needs `feature/every-worker-is-born-monitored` for the attach point. Independent
of the other two monitors — different subject, different file.

### What to build

The BuildMonitor: four findings about a run, sampled **only while one is live**.

| finding | measurement |
|---|---|
| **build failed** | a run for this branch's head reached a failing conclusion |
| **build passed** | it reached success |
| **build needs approval** | it is `action_required` |
| **head moved** | a newer sha exists, so the run in flight answers about the past |

`plot-host.sh` gains the one operation it needs, and no more.

### The decisions the plan settles — do not re-derive them

**A Build is an entity, which is why it gets its own monitor.**
[DESIGN-build.md](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-build.md)
— *"is the thing that RUNS … one RESULT of one run"*, identified by its URL,
holding a state, a start time and a duration. A monitor per entity is the
pattern, not an exception to it.

**`head moved` is the finding that earns this monitor, and it is why the
AgentMonitor cannot absorb it.** A build's subject is a **sha**, not a branch. A
green result for code nobody will merge is worse than no result — it invites a
merge of the wrong thing. **Measured this session: two merge waiters reported on
superseded runs and had to be stopped and re-armed.**

**`action_required` is a real state here, not an edge case.** Bot branches hit
it — the release PR's runs need manual approval before they start. A monitor
that folded it into "not passed yet" would report a build as pending forever
while it waits for a click nobody knows is needed.

**It polls NOTHING when no run is live**, and that is what makes a 30-second
cadence against a host affordable. The AgentMonitor's five-minute budget exists
because it asks on every pass; this one asks only while there is something to
ask about. **Assert the silence** — a monitor that keeps questioning an idle
host is the rate problem this whole design avoids.

**This is where `until CI is green` becomes servable.** The channel refuses that
purpose until this slice lands, deliberately. **Do not satisfy it by adding a
host question to the AgentMonitor** — that is how a five-minute budget stops
meaning anything.

**The findings are transitions, not conditions.** The other monitors report
states that persist (`owes a review` holds until a PR exists). A build's answer
changes once and stays; publish the change, not a repeated assertion of the same
conclusion.

**Read the run for the branch's CURRENT head.** `gh run list --branch X` returns
runs for every sha that branch ever had; the newest run is not necessarily for
the newest commit, and this session hit exactly that.

### Done when

The plan's Watching-the-build `Done when`:

- each of the four findings fires on a real run and is individually triggerable
  against a **mocked host**
- **`head moved` fires when a newer sha exists**, and a finding about a
  superseded run is never reported as current
- **it polls nothing when no run is live** — asserted, not assumed
- `plot-host.sh` gains one operation and no more

**Unit against a mocked host reaches every branch**, including the ones a real
CI will not produce on demand: a run that vanishes, a host that refuses, two
runs for two shas at once. One e2e in `test/e2e/` proves the process boundary.

Repo gates: `pnpm test`, `pnpm run typecheck`, `pnpm run test:e2e` (with
`env -u PLOT_UNATTENDED`), changeset. Node 24, `corepack pnpm`.

**Domain style** (CLAUDE.md § The Domain Package): arrow functions; factual
TSDoc. A **Slice** holds one branch and belongs to one plan; a **Wave** is the
fleet's cross-plan cohort.

### Scope guard

Owns the BuildMonitor and the one new `plot-host.sh` operation. **Not the
channel** (its slice) and **not the AgentMonitor** — adding build questions
there is the thing this slice exists to prevent.

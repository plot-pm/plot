## Implementation brief — two-monitors-watch-the-agent (slice 6: Acting)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/a-report-can-open-the-pr` (base: `main`)
- **Ends as:** one PR to `main`

**Needs slices 1–5 AND
[`the-controller-answers-every-asker`](../../docs/plans/2026-08-30-the-controller-answers-every-asker.md)**
— it is the entry point the agent acts through, and building a second one here
would be the duplication that plan removes. **This is the only slice of the six
that waits on the controller.**

### What to build

The master agent subscribes with a purpose, and on `owes a review` opens a PR
through the controller. Nothing else acts on anything.

### The decisions the plan settles — do not re-derive them

**One action, and only one.** Opening a PR is the sole act safe to take without
judgement, and the reason is reversibility:

| act | if wrong |
|---|---|
| **open a PR** | close it — branch, worktree and work untouched |
| restart an agent | the running one's uncommitted work is at risk |
| reap a worktree | a checkout disappears |
| kill a worker | whatever it was mid-way through is lost |

**Only the first can be undone by the person who disagrees with it.** The rest
stay with `plot-reap.sh` and `plot-dispatch.sh`, behind refusals they already
own.

**A branch that also `owes a gate` still gets its PR**, and the body names the
missing gate. Withholding it would leave finished work invisible until someone
writes the changeset — the failure this plan ends, one step later.

**It does NOT write the missing changeset.** A changeset says what changed and
why it matters; that is a judgement about the work, and an agent guessing
produces the `<!--` class of entry this repo is fixing in
`a-changeset-says-what-changed`.

**Idempotence is the clause that bites.** The finding holds until the PR
appears, and the channel republishes on every interval — **an action that fires
per message rather than per state opens a PR a minute until someone notices.**
Act on the state, not the message.

**The monitors themselves still act on nothing.** The action belongs to the
agent reading the channel; keeping the watcher inert is what lets it run
unsupervised.

### Done when

The plan's Acting `Done when`: an `owes a review` finding results in a PR
without a person asking; the PR body names the finding, its evidence, and any
open gate; **a second finding for the same branch opens nothing** because a PR
now exists; and the monitors still write and start nothing.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns the master agent's subscription and the one action. **No second entry point
to the domain** — ask through the controller. No reaping, no restarting, no
killing.

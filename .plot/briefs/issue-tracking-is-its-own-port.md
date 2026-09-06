## Implementation brief — issue-tracking-is-its-own-port (slice: Giving issue tracking its own port)

- **Plan (canonical):** `docs/plans/2026-09-04-every-element-is-a-domain-concept.md` on `main`
- **Branch:** `feature/issue-tracking-is-its-own-port` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 3 of six. Slices 1 and 2 merged as **#706** and **#717**.

## What this delivers

`ports/tracker.ts` and two connector implementations. Issue tracking stops hanging off the git host.

## A tracker is not a git host

**The `Issue` entity exists; the port does not.** Verified 2026-09-06: `packages/domain/src/ports/tracker.ts` is absent, and the operations hang off the **`host` port**, whose own docstring says it *"Reads the git host"*.

**`Tracker` is a `## Plot Config` key independent of `Git host`.** So a Bitbucket repo using Jira has **two different foreign services answering through one interface**.

**The conflation is visible in the port's own text.** `issueList` returns `unaskable` *"where the host has no tracker at all"* — one interface reporting not-my-department for a capability belonging to a different service. That answer disappears once the tracker has its own port: a repo either declares a tracker or does not, and the question stops being asked of the git host.

## The port

An interface, no runtime code, with the two operations that exist plus the write that has nowhere to live:

| op | today | after |
|---|---|---|
| `issueList` | `host` port, gh + jira in shell | tracker port |
| `issueView` | `host` port, gh + jira in shell | tracker port |
| status write | `plot-update-board.sh`, `gh project`, **no abstraction** | tracker port |

## Two adapters, and they are CONNECTORS

**CLAUDE.md draws the line:** a connector reaches a *remote service* — account, credentials, rate limit, transport choice — where every other adapter reaches the local machine.

Jira has its own `JIRA_EMAIL`, its own token and its own limits, entirely separate from `gh`'s. So **`tracker-github` and `tracker-jira` are two connectors rather than one adapter with a branch**, and each owns its own budget.

## The write is the design decision this slice settles

**`plot-update-board.sh` never asks which tracker this repo uses.** Verified 2026-09-06: **zero** references to `Tracker`, `plot-host.sh` or `tracker` in the whole script. It calls `gh project` four times — `:35`, `:42`, `:49`, `:80` — reading its own `Project board: owner/number` key and going straight to one vendor.

**CLAUDE.md records the opposite contract today:** *"The two issue ops READ and never write."*

**That sentence is amended here rather than quietly broken.** The new contract: **Plot writes a status to the tracker it was told about, and writes nothing else.** A plan referencing an issue stays Plot's record; the status is the one fact the tracker owns a copy of.

**Two assertions:**
- **A Jira project's status updates reach Jira.**
- **A repo with no `Tracker` declared writes nowhere and says so** — never a silent no-op against a tracker somebody configured.

## Not Plot's board, and the name matters

`packages/board` — `pnpm board`, the Kanban a person reads — is host-agnostic and stays that way. Measured 2026-09-04: `packages/board/src` holds **zero** live `gh` calls, and its nine textual mentions are all comments.

**Two earlier drafts of this slice were rejected by name:** *the board is a GitHub capability* and *the project tracker is optional*. The first asserts the opposite of what is true about Plot's board; the second treats a supported integration as an extra.

## Shape

**The layering rule holds:** `controller → domain → port ← adapter → script`. The port is an interface the domain owns; it imports no adapter, and the dependency points inward.

**Scripts are reachable only from an adapter implementation.** `plot-host.sh`'s jira calls move behind `tracker-jira`, not beside it.

**Arrow functions**, purity gate holds, TSDoc says what an export does.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

The `unaskable` answer must keep working for a repo with no tracker — asserted, not assumed.

## Done when

- `ports/tracker.ts` exists as an interface with the three operations
- `tracker-github` and `tracker-jira` implement it as separate connectors, each with its own budget
- `issueList` and `issueView` leave the `host` port
- a status write reaches the declared tracker, and a repo with no `Tracker` writes nowhere and says so
- CLAUDE.md's read-only sentence is amended in this PR
- `packages/board/src` still holds zero live host calls
- the gates above pass

## Do not

- **Do not leave the issue ops on the `host` port.** A tracker is not a git host, and `Tracker` is configured independently of `Git host`.
- **Do not write one adapter with a vendor branch.** Two connectors, two budgets — Jira's credentials and limits are not `gh`'s.
- **Do not break CLAUDE.md's contract silently.** Amend the sentence in the same PR.
- **Do not make `packages/board` reach a host.** It has zero live calls and keeps them.
- **Do not widen the write beyond a status.** A plan referencing an issue is Plot's record and stays one-directional.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

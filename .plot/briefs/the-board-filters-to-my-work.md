## Implementation brief — the-board-shows-me-only-my-work (wave 3: The board filters to my work)

- **Plan (canonical):** `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `feature/the-board-filters-to-my-work` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #967

**THIS BRANCH WAITS ON WAVE 2, `feature/a-row-says-whose-it-is`.** It renders what `isMine` decides, and `isMine` is wave 2's export. Do not start until wave 2's PR is merged, and cut this branch from `origin/main` after that merge. **Read `isMine`'s real signature and the row field it reads from the merged code — do not guess either from this brief.** Measured 2026-09-25: `isMine` appears 0 times in `packages/domain/src/index.ts` on main.

### What to build

The checkbox. Wave 1 put the reader's identity in the payload and wave 2 decided per row whether it is theirs; nothing yet lets a person act on that. One control, defaulting **off**, persisted per viewer, that hides the rows `isMine` said are not theirs.

### What is already on main, and is a contract rather than a suggestion

Wave 1 shipped the identity as **two fields on `server`**, not one:

```
hostUser: z.string().default('')   // the host account, from gh's hosts.yml
gitEmail: z.string().default('')   // user.email in this server's checkout
```

`packages/board/src/contract/schema.ts:1026,1032`. The docstring states why both travel: *"the two spell one person two ways, and each matches a different kind of row."* A PR row matches on the host account; an agent row matches on the git email. **Wave 2 owns that decision** — this branch calls `isMine` and does not re-derive it.

`''` is the honest "not configured" value for either. A filter must not treat an empty identity as matching nothing and hide the whole board.

### Persistence: `localStorage`, beside the collapse key, and read the argument first

`packages/board/src/app/lib/agent-rows/collapse.ts:21-38` settles why view state of this kind is **not** in the URL, and the reasoning applies unchanged:

> a URL is shareable, and collapse state should not be. A link carrying `?collapsed=quiet,done` would hand my personal tidying to whoever opened it.

The same is true of a filter: a link that silently hides rows belonging to the person you sent it to is worse than no link. So use `localStorage` with a key in the same namespace (`plot-board:agents:*`), and copy the module's failure discipline: **every failure path yields the default rather than throwing** — `localStorage` throws outright in a blocked-cookie context, and a board that renders nothing because it could not remember a checkbox is the worse answer.

**COPY THE MECHANISM, NOT THE DEFAULT.** Collapse defaults to *collapsed* because a first visit should not ship the crowded view. This filter defaults to **off**, and the asymmetry is the point: hiding rows from a reader who never asked is a board that lies by omission. A first visit shows everything.

### Done when

- A checkbox in the agents view, off by default, that hides rows `isMine` returned false for.
- Its state survives a reload, per viewer, and never travels in a URL.
- Unticking restores **every** row — including rows that were never anyone's.
- A browser test asserting both arms: the control shows what `isMine` decided, and unticking restores the full set. One fixture with mixed ownership, since a filter that hides nothing looks identical to one that works on a single-contributor estate (#967's own finding).
- An unreadable or absent `localStorage` renders the default view rather than an empty one.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`.
- `pnpm run build:board` before committing if any board source changed — CI has a no-diff gate on the artifact.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `@plot-pm/board`, description first and the `bumps:` block last.

### Out of scope

- `isMine` itself, and which row field it matches — wave 2's.
- The identity fields — wave 1's, already merged.
- Any second filter, any server-side filtering, any URL parameter.

## Implementation brief — the-board-answers-where-the-browser-asks (wave 1: The board answers on both families)

- **Plan (canonical):** `docs/plans/2026-09-11-the-board-answers-where-the-browser-asks.md` on `main`
- **Approved:** 2026-09-11, jwloka, in-session
- **Branch:** `bug/the-board-answers-on-both-loopback-families` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

This slice waits on nothing and nothing waits on it. The plan's second slice — `bug/one-plan-is-one-card`, in `board.ts` — is independent by the plan's own statement, and the two share no source file. Do not wait for it.

### What to build

Bind both loopback families, so a browser that resolves `localhost` to IPv4 reaches the board instead of reporting a refused connection.

**The observed failure, with its numbers.** On the operator's own board, 2026-09-11, while this plan was being written: `lsof` reported `TCP [::1]:7777 (LISTEN)` and the page reported no contact for 18 polls. The process was healthy the whole time. The board was serving — to one address family, while the browser asked at the other.

**Reproduced in isolation on Node v24.4.1, 2026-09-12**, with six lines and no board:

```
listen(port, 'localhost')  →  family=IPv6  addr=::1
  reached via ::1        →  OK 200
  reached via 127.0.0.1  →  FAIL ECONNREFUSED
```

That `ECONNREFUSED` against a server that is up **is the defect**. If your change does not turn that line into `OK 200`, it is not the fix.

`packages/board/src/server/index.ts:49` reads `const HOST = process.env.HOST ?? 'localhost'`, and `git log -S"HOST = process.env.HOST"` returns exactly one commit — `c0cbbc764`, the commit that scaffolded the package. Nobody chose single-family binding; it fell out of a default.

The plan is canonical; this is orientation. Note the plan abbreviates the path to `index.ts:49` — the file is `packages/board/src/server/index.ts` and the line number is exact.

### The decisions the plan settles — do not re-derive them

**Binding the wildcard is refused, and the reason is an incident.** `index.ts:141` carries a 40-line comment recording that `HOST=0.0.0.0` published every write endpoint — including the one that spawns detached agents — to every interface the machine had, because `HOST` was read once and never checked. Binding both loopback families reaches a browser on this machine; binding every interface reaches the network. This slice does the first. The `0.0.0.0` path keeps whatever check it has, untouched.

**`listen(port)` with no host is the trap, and it is silent.** Measured on Node v24.4.1:

```
listen(port)        →  addr=::  ← the IPv6 WILDCARD, not loopback
listen(port, '::')  →  addr=::  ← same
```

`::` accepts IPv4 too on a dual-stack machine, so this is the network bind the paragraph above forbids — arriving by omission rather than by decision. **It also shuts every write endpoint.** `isLocalCaller` (`packages/board/src/server/controllers/caller.ts`) is a three-value string equality:

```ts
host === 'localhost' || host === '127.0.0.1' || host === '::1'
```

`'::'` is not in that set. The board would come up, serve `/api/board` correctly, and refuse all ten capabilities with *"the board is bound to :: , not localhost"* — a healthy process with broken buttons, the same shape of failure this slice is fixing. Do not reach for the one-argument `listen`.

**The shape that works is two servers on one port, one per family — measured, not proposed.** 2026-09-12, same harness:

```
listen(p, '::1')  then  listen(p, '127.0.0.1')   ← same port, both succeed
  reached via 127.0.0.1  →  OK 200
  reached via ::1        →  OK 200
```

A port is taken per-address, not per-machine, so the second bind is not a conflict. Both bind addresses are already in `isLocalCaller`'s set, which is what keeps the write gate open **by construction** rather than by a second edit.

**Order is load-bearing under `PORT=0`.** The default is 7777, but `PORT=0` asks the OS to assign (`index.ts:43`), and the assignment happens *during* the first `listen`. The second bind must ask for the port the first was given — read from `server.address()` — never `0` again, which would assign a second, different port. `boundPort` already exists for exactly this reason and is documented at `index.ts:52`: everything that NAMES this server's address reads it, never `REQUESTED_PORT`, which under `PORT=0` is the literal 0 and would make the same-origin allowlist read `http://localhost:0` and refuse every browser.

**`EADDRINUSE` means two different things after this change, and conflating them breaks a shipped contract.** `index.ts:791` exits the process 0 on `EADDRINUSE`, printing *"Plot board already running at ..."*. That is deliberate — `port.test.mjs` holds three assertions on it, including that a second `pnpm board` must not kill the running one, after seven board servers accumulated on 2026-08-16 at 80 GraphQL calls/hour each.

A **first**-bind `EADDRINUSE` still means another board owns this port. A **second**-bind failure does not: the first bind just succeeded, so this board is running. Handling them with one listener would report a healthy board as "already running" and exit it. Decide what a failed second family should do — the plan does not settle this, and a server that answers on one family is strictly better than today, so degrading rather than dying is defensible. Say which you chose and why.

**Do not pre-probe the second port.** `port.test.mjs:220` greps this very source and asserts it does **not** match `/net\.(createServer|createConnection|connect)/`, because probing before binding rebuilds the check-then-act race the current code exists to remove. The failed bind is the check. `http.createServer` is unaffected by that grep — only the `net` module is named.

**The startup line becomes true for the first time.** `index.ts:821` prints `http://localhost:${boundPort}` unconditionally. Today that URL is, as measured, the one that refuses. After this change it is reachable whichever family `localhost` resolves to. No edit is required there; it is worth knowing the line was already correct about intent and wrong about fact.

**A second server needs the same lifetime as the first.** `exitWithParent()` and `exitWhenIdle()` (`index.ts:806`, `:814`) are gates against orphaned boards — measured 2026-08-31, two vitest processes asleep at 0 % CPU for 33 and 47 minutes each holding a board. They act via `process.exit`, so a second server in the same process dies with it and needs no second registration. Check that this still holds for whatever shape you build; a second server that keeps the process alive after the first closes would reopen exactly that defect.

### Done when

The plan's `## Done when` content is the specification — it lives in the slice section *The board answers on both families*.

Then the assertions that exist because a naive implementation passes without them:

- **A request to `127.0.0.1` gets a response, and so does one to `::1`, against one running board.** The single assertion that separates the fix from the defect. A test that only reaches `localhost` passes today, unfixed — that name resolves to whichever family is bound.
- **A write endpoint still serves under the new bind.** Catches the `listen(port)` / `'::'` trap, which fails no other test: the board starts, `/api/board` answers, and only the capabilities are dead. Assert a write route is not 403, or that the capability flags report available.
- **Under `PORT=0`, both families answer on the *same* port.** Catches a second bind that asked for `0` and silently got a different port — the first family works, the second answers somewhere nobody is looking.
- **A second board on a taken port still names the first and exits 0, without killing it.** The three existing `port.test.mjs` assertions under *a second board names the first and exits*. These must keep passing; they are the contract the `EADDRINUSE` split above could break.

Plus the repo's gates:

- `pnpm build:board` — the artifact is committed, and a stale one fails new-feature tests reassuringly
- `pnpm run test:board`
- `pnpm run typecheck`
- A changeset. This is a board change, so it uses package frontmatter and **no** `bumps:` block:

  ```markdown
  ---
  '@plot-pm/board': patch
  ---

  The description, which is what the changelog publishes.

  <!--
  plan: docs/plans/2026-09-11-the-board-answers-where-the-browser-asks.md
  -->
  ```

  Description first, always — a `<!--` block written first becomes the published release note and the description behind it never ships. `./scripts/check-changeset-packages.sh` refuses that and any description under 20 characters. `.changeset/` holds siblings' files; add yours and touch none.
- Node 24 (`nvm use` first — `pnpm` crashes outright on Node 26 and a background job under it exits silently having produced nothing).
- **Do not run `pnpm run test:e2e` locally.** It is CI's gate. It dispatches real workers into sandbox repos; two agents running it once produced 53 concurrent `node --test` processes and load average 8.69 on this machine.
- If you add a recursive `fs.rmSync` to a test, use the `rmTree` helper instead. CI counts raw recursive `fs.rmSync` sites under `packages/board/test` against a fixed allowance and fails when the count grows.

### Bookkeeping

- **Push the first real commit as soon as it exists.** An unpushed branch is invisible to the fleet scan, which derives from `origin/<branch>`; work that exists only locally reads as a branch that was never started.
- **Open the PR with `skills/plot/scripts/plot-open-pr.sh`** (add `--draft` while the work is still moving). It takes the title from the plan's wave heading, and puts the plan and this brief in the body. **Do not run `gh pr create`:** measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- **When the PR exists, append `→ #<number>`** to this branch's line in the plan's `## Slices` section. Note this plan uses the `(Branch: x)` heading form — the annotation goes on the heading, as `(Branch: bug/the-board-answers-on-both-loopback-families, PR: #N)`. A trailing `→ #N` on a heading-form plan parses as `prs=[]`.

### Scope guard

This branch owns `packages/board/src/server/index.ts` and the bind path around it, plus `packages/board/test/port.test.mjs` for the new assertions.

**Verified at dispatch, 2026-09-12** — five remote branches live, and **no branch in flight touches `server/index.ts`**. Two touch `packages/board` at all:

- `origin/bug/one-cap-holds-across-boards` — `auto-dispatch.ts`, `fleet.ts`, `in-flight-store.ts` and their test. No source file overlaps yours.
- `origin/changeset-release/main` — the Changesets release PR.

**The one collision you should expect is the built artifact.** `skills/plot/scripts/board/board-server.mjs` is generated output that both branches regenerate. It is marked `-merge` in `.gitattributes`, so git keeps one version whole rather than splicing conflict markers into it. **Do not read that diff.** Take either side, run `pnpm build:board`, and commit the result — the rebuild overwrites whichever side was kept, so the choice cannot matter. Never phrase it as "take ours": *ours* inverts between `git merge` and `git rebase`. Full procedure: `docs/definition-of-done.md#resolving-a-board-artifact-conflict`.

The plan's sibling slice `bug/one-plan-is-one-card` works in `board.ts`. Leave it alone; it is not yours and it is not a dependency.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — a-partial-page-is-not-an-outage (wave 1: The arm reports the states that answered)

- **Plan (canonical):** `docs/plans/2026-09-18-a-partial-page-is-not-an-outage.md` on `main`
- **Approved:** 2026-09-18, jwloka, in-session
- **Branch:** `bug/the-arm-reports-the-states-that-answered` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

The plan holds one wave and one branch. Nothing waits on this and it waits on nothing.

### What to build

An operator on `quaweb-website` filed #912: three open PRs, and the board's Agents tab showed **nine branches all labelled `commits, no PR ever opened`** — two of them with live PRs (#358 OPEN, #405 DRAFT). *"A reader cleaning up stale branches would delete work that is under review."*

The cause is an asymmetry only Bitbucket has. `bb pr list` has no `all` state, so `bb_states_for all` expands to three (`open`, `merged`, `declined`) and the arm loops, calling `bb` once per state and printing each state's rows as it goes. When state 2 or 3 fails, `pr_list_call`'s `|| exit $?` leaves the script **after** the earlier states' rows are already on stdout. The transport then reads the exit code and throws the rows away.

Make a partial answer expressible: collect across the three states, exit with a **distinct** partial code when some states answered and some did not, and teach the two readers — the transport and the fleet scan — to read that code as *incomplete* rather than as *nothing*.

The plan is canonical and carries the full diagnosis, including three refuted hypotheses. This is orientation.

### The decisions the plan settles — do not re-derive them

**Exiting 0 on a partial answer is the obvious fix and it is wrong.** This was the plan's first remedy and the panel killed it. `plot-fleet-scan.sh:675` reads the exit code **directly**, not through the transport, and branches on 5/6/4. A partial run exiting 0 makes `rc -ne 0` false, sets `HOST_VERDICT=ok`, and reports a **complete** host reading over a page missing a whole state — the plan's own stated red line, violated by its own remedy, at the one caller that produced the bug. Worse, `plot-fleet-scan.sh:663` records that this guard *"until 2026-08-30 never fired, because `pr-list` swallowed its own failure and exited 0 with empty stdout"*. Exiting 0 re-creates the state that fix removed.

**So the partial answer gets its own non-zero code.** That keeps `rc -ne 0` true for every existing reader while letting the transport be taught to carry stdout for that one code. **`3`, `4`, `5` and `6` are taken** — `pr_list_failed` (`plot-host.sh:476`) exits 6 for a burst refusal, 5 for throttling, 3 for everything else, and 4 is the host having no such capability. Pick a free one and name it in a comment.

**The transport's type change is the real shape change, not a branch.** `HostAnswer` (`packages/domain/src/ports/scripts.ts:31`) makes `stdout` and `said` **mutually exclusive by construction**:

```ts
export type HostAnswer =
  | { answer: 'answered'; stdout: string }
  | { answer: 'failed'; said: string }
  | { answer: 'unaskable'; said: string };
```

A partial answer needs **both** — the rows that arrived and the sentence naming what did not. That is a new variant, not a new `if`. `scripts-shell.ts:88` is the one place the code is read (*"THE CODE IS READ EXACTLY ONCE, HERE, and what leaves is a word"*), so the reading stays there.

**Four callers read `hostSaid`, and each branches differently.** `fleet.ts:2483` (`throw new Error(said.said)` — the pr-list path this plan targets), `fleet.ts:1765` (`spend-rate`, returns null), `fleet.ts:2250` (`issue-list`, checks `unaskable`), and `idea.ts:197` (`issue-view`). Adding a variant makes every `answer !== 'answered'` test true for it — which for the three non-pr-list callers is the correct existing behaviour, since none of them can produce a partial. Check each, change what the plan names.

**`said` joins ALL of stderr, and that is why everyone misdiagnosed #912.** `said` is `run.stderr.trim()` — every stderr line. On Bitbucket `pr_list_report_truncation` fires for **any** non-empty page with a `--limit`, so the banner reads `PR data unavailable (plot-host: bitbucket ignores --limit 1000; … possibly truncated …)`. The exit was caused by a **failed state**; the text describes a **page-size warning** from the states that succeeded. That is why #912 was filed against `--limit`.

**This plan does not change `said`.** Making the message name the failure rather than the warnings is a second defect with its own blast radius — every `hostSaid` caller reads that string — and it is recorded, not folded in. Resist the tidy-up.

**Three hypotheses were checked against the source and refuted. Do not re-check them.**

1. *"The board discards rows it holds."* It does not. The happy path assigns the map; the catch keeps the previous one, deliberately (`fleet.ts`: *"An empty PR map would quietly move every row back to its git-only group, which looks like state changing rather than data missing"*). **That rule is right and stays.** It has nothing to keep on a **first fetch** — `prs: null, prsByNumber: null, prsByHead: null` — which is #912's nine rows.
2. *"A stderr warning causes the throw."* It does not. On exit 0 `hostSaid` returns `{ answer: 'answered', stdout }` with **no `said` field at all**, and `entry.prError` has exactly three assignments (`fleet.ts:2551`, `:2563`, `:2570`), the banner one inside the `catch`. A warning alone reaches nothing. **The measurement first offered for this was invalid and is withdrawn** — it was taken on GitHub, where `pr_list_report_truncation` returns early when `count < limit` (`plot-host.sh:1922`), so it could never have tested a Bitbucket-only warning.
3. *"The `hostSaid` refactor already fixed it."* That landed 2026-09-01; #912 was filed 2026-09-15 with that code in place.

**`|| exit $?` at every `pr_list_call` site is not a style tic and must not simply be deleted.** `pr_list_call` is invoked as `_raw="$(pr_list_call …)"` — a **command substitution, which is a subshell** — so the `exit` inside `pr_list_failed` leaves *that subshell only*. Its header says the trap plainly: without the propagation the outer script carries on with `_raw` empty and `jq` emits nothing — *"the silent empty list this whole helper exists to remove, rebuilt one layer further in and harder to see."* Collecting across states means the loop can no longer exit on the first failure, so whatever replaces `|| exit $?` must still distinguish *this state failed* from *this state returned nothing*, in a subshell whose exit code is the only channel out. `bb_states_for` documents the same trap a few hundred lines below.

**There are THREE loop sites, all identical**, and the issue hit one: `plot-host.sh:3118` (rich + Jenkins), `:3147` (rich, no Jenkins), `:3156` (plain). The plan's Done-when requires all three. The adapter's own precedent applies — `pr_list_call`'s header says *"a fix applied by hand six times is a fix that drifts, and the arm that drifts is the one nobody's repo exercises."* Prefer one mechanism the three sites share over three edits.

**The GitHub arm has no state loop and cannot reach this shape.** `--state all` is passed straight through to `gh` in one call (`plot-host.sh:3079`), so a failure there means nothing was printed. Leave it alone; the Done-when asks for a test pinning that its behaviour is byte-identical.

**`HOST_VERDICT` has more readers than the footer.** A fifth word must be handled at each or it falls through: `plot-fleet-scan.sh:3741` renders a per-branch note (`unknown — PR could not be read ($HOST_VERDICT host)`), `:4253`–`:4263` print a banner per word, and `:3167`, `:3278`, `:4206` pass it into the stream and JSON payloads. The footer at `:4331` carries `host=$HOST_VERDICT`, and the file's own header comment at `:91` documents the footer's shape — update it.

**The scan's control flow makes *degraded* and *parsed* mutually exclusive today.** The `if [ "$rc" -ne 0 ]` block sets a verdict and then `return 0` — **before** `$js` is parsed. A partial exit has to take the parse path *and* set a degraded verdict; that is a control-flow change, not another `case` arm. Note the scan redirects stdout to a file (`host_list_out`) and captures stderr separately, so the rows are already in hand on a non-zero exit.

**Extending `HOST_VERDICT` is following a precedent, not inventing one.** The vocabulary was built by `a-degraded-scan-says-why` (PR #475, released) and its design argument is in the scan's own comments — including why `unasked` is a third outcome rather than a flavour of `failed`. Read `:680`–`:702` before choosing the new word's meaning.

**Rules carried over unchanged from this adapter's neighbourhood.** Absent is not false. A list has no absent subject, so a failed list is *unknown* and never an empty list (`pr_list_failed`'s header: **NO EMPTY-LIST FALLBACK**). Read the exit code, not the emptiness. And the thing this must not do is report a short list as complete — *"the quiet wrong answer this adapter refuses elsewhere."*

### What this is NOT

**Not #333.** That is real pagination — `bb` caps at 50 per state — and needs a cursor or a different call. This makes *incomplete* distinguishable from *nothing* and does not page. #912 is *"the opposite end of the same code path"*, at **3 PRs, far below any page limit**.

**Not a change to the failure vocabulary for a total failure.** Exits 3/5/6 keep their meanings, and a run where **no** state answered still fails with the same code it does today.

**Not the second reading.** Once a partial answer is expressible, a caller could say *which* states are missing rather than *whether* the answer is whole. Not built here — it needs a shape change in `HostAnswer` and a consumer that wants it, and #912 needs neither.

### Done when

The plan's `## Slices` `Done when` list is the specification. Read it there; it is long and every clause is load-bearing.

These are the assertions that exist **because a naive implementation would pass without them**:

- **The code is not 0, 3, 4, 5 or 6.** Without this, a reviewer accepts a partial code that collides with throttling and the scan silently mislabels a rate limit.
- **`plot-fleet-scan.sh` learns the verdict**, pinned over `HOST_VERDICT` and the footer's `host=` field. **Without this the fix is invisible at the caller that produced #912** — the transport carries the rows and the scan still reports `ok` or `failed` over them.
- **A run where no state answered exits with the code it does today, pinned per kind** (3, 5, 6). Catches an implementation that turns *every* Bitbucket failure into the partial code, which would make a genuine outage read as a partial page — #912 inverted.
- **All three loop sites**, not just the one the issue hit. Catches a fix applied to `:3118` alone, leaving the plain and no-Jenkins arms as they were.
- **The GitHub arm is byte-identical.** Catches a refactor that hoists the collection logic across the backend branch and changes the single-call path on the way.
- **A single-state call (`--state open`) that fails still exits non-zero.** There is no partial answer to report when one state was asked; catches an implementation that keys on "the loop ended" rather than on "some states answered and some did not".
- **The failed state is named on stderr.** Catches a silent partial — the plan's red line.

Test it the way `the-bitbucket-arm-answers-with-a-merge-commit` did: **this repository is on GitHub, so the Bitbucket path cannot be exercised live.** Use a PATH-stubbed `bb`. `test/reconcile/host.test.mjs`'s `makeStrictBbStub` (line 81) already takes `perState` and already appends with `>>` "because `--state all` is expected to become SEVERAL calls" — extend it with a per-state *failure* (exit code plus stderr text) rather than building new infrastructure. The strict stub exists because a permissive one *"proved the adapter SENT the flag, never that `bb` understood it"*; keep that property.

**Say in the PR what was exercised and what was not.**

Plus the repo's gates:

- `nvm use` first — Node 24 per `.nvmrc`; **pnpm crashes on Node 26**.
- `pnpm run test:contracts` (the plan names it), `pnpm test`, `pnpm run typecheck`.
- `pnpm run test:board` if the board is touched. **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset: `'plot': patch` frontmatter, **description FIRST**, then the `<!-- plan: … bumps: … -->` block LAST. A `bumps:` block written first becomes the published release note. Add `plan: docs/plans/2026-09-18-a-partial-page-is-not-an-outage.md`. `.changeset/` holds siblings' files — add yours, touch none.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading and refuses a branch no plan names. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh` — the Bitbucket `pr-list` arm and its exit vocabulary
- `packages/domain/src/ports/scripts.ts` — the `HostAnswer` type
- `packages/domain/src/adapters/scripts/scripts-shell.ts` — `hostSaid`
- `skills/plot/scripts/plot-fleet-scan.sh` — `HOST_VERDICT` and its readers
- `packages/board/src/server/fleet.ts` — the `pr-list` consumer at `:2477`, only as far as the new variant requires
- `test/reconcile/host.test.mjs`, `test/reconcile/scan.test.mjs`, and any new test file

Verified at dispatch on 2026-09-18, two other branches are in flight and **neither touches these files**:

- `bug/the-index-is-read-once` — `plot-reconcile-scan.sh` and its test
- `bug/the-reading-carries-which-stopped` — `supervisor-reading.ts`, `plot-fleetctl.sh`, the registry and board entries

Both do rebuild `skills/plot/scripts/board/board-server.mjs`. If this branch ends up touching the board artifact, expect a conflict there: it is generated output marked `-merge` in `.gitattributes`, so **do not read the diff** — take either side, run `pnpm build:board`, commit the result. Never phrase it as "take ours"; *ours* inverts between merge and rebase.

The nearby plans that share this territory are finished, not live: `a-degraded-scan-says-why` (PR #475, released) built the verdict vocabulary, `a-scan-section-honours-offline` (PR #938) and `a-merge-commit-is-asked-of-the-host` (#947) are delivered.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

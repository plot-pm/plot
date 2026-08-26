## Implementation brief — an-unreachable-host-is-not-an-answer (wave Withheld)

- **Plan (canonical):** `docs/plans/2026-08-24-an-unreachable-host-is-not-an-answer.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/an-unknown-pr-withholds-its-verdict` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. `Told` merged as **#446** — the outage banner now fires when the
whole PR map is unknown. This wave is the ROW-side half: a row whose PR could
not be read must not state a verdict as though it had been.

### What to build

A row whose PR is `unknown` **withholds its verdict** — it does not read
`eligible` — while keeping every fact git still answers.

`Told` fixed the banner: the reader is now told the host is dark. This wave
fixes the rows underneath it, which still speak with full confidence.

### The decisions the plan settles — do not re-derive them

**`unknown` is a GAP, not a state.** It propagates as *the question was not
answered*, never as a value that a verdict can be computed from. This is the
same rule `plot-host.sh` states for its three-outcome issue ops and
`plot-board-probe.sh` states for `auth`: being wrong in the reassuring direction
is the worst way to be wrong.

**Withhold the verdict; withhold NOTHING else.** Done-when 4 is the assertion
that stops an over-fix: the row still reads `merged` where git says merged, and
still names its wave, plan and branch. Git did answer; only the host did not.

**Read `Told`'s code before writing.** #446 touched
`packages/board/src/server/fleet.ts` and
`packages/board/src/app/lib/agent-rows/host-notes.ts`, and it settled the
vocabulary for *unknown*. Adopt whatever it established rather than inventing a
second spelling — the plan says so explicitly.

**Host-agnostic wording (Done-when 7).** State the rule for *an origin*, not for
the GitHub PR map, so a backend added later inherits it instead of re-deciding.
This one is asserted by READING, not by a test. The sprint has just added
Bitbucket issues (#449) and Jenkins checks (#450); more origins are coming.

### Where the verdict is computed

`fleet.ts` computes `eligible` in several places — at least `:740`
(`b.state === 'open' && wave.verdict === 'eligible'`), `:3006`, and `:4330`.

**Find them all.** A fix applied at one site leaves the others confidently
wrong, and `:2999` carries a comment about exactly that class of mistake
("This read `verdict !== 'eligible'`, which sent three inputs to one…").

### Done when

The plan's `## Done when` list is the specification — items 3, 4, 7 are this
wave's core; 1, 2, 5, 8, 9 belong to `Told` and are already merged.

- **Item 3** — a row whose PR is `unknown` does not read `eligible`. The seven
  Testing plans from the original report are the measured case.
- **Item 4** — that row STILL reads `merged` where git says merged, and still
  names its wave, plan and branch. This is what a naive fix breaks: blanking
  the row throws away facts git answered.
- **Item 7** — the rule is written for an origin, not for GitHub.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`); `corepack
pnpm` if the homebrew one misbehaves.

**`pnpm test` is NOT a test run here** — it is `skills add . --list`.

Add a changeset with `'@plot-pm/board': patch` frontmatter (a board change uses
package frontmatter, NOT a skills `bumps:` block).

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Withheld (Branch: bug/an-unknown-pr-withholds-its-verdict, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns the verdict computation in
`packages/board/src/server/fleet.ts` and its tests.

**Do not change the banner** — that is `Told` (#446), merged and correct.

**Do not touch `plot-host.sh`** — #449 and #450 both landed there today.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild** (not the merge's copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it, and a dirty copy makes
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

## Implementation brief — a-ticket-becomes-a-plan-or-a-story (wave: Routed)

- **Plan (canonical):** `docs/plans/2026-08-20-a-ticket-becomes-a-plan-or-a-story.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/a-ticket-becomes-a-story` (base: `main`)
- **Ends as:** one PR to `main`

Single wave; depends on nothing.

### What to build

`/api/story` spawns a `Story command` for `/story-tracking` on a ticket, writing
the issue to a file exactly as `/api/idea` already does. `storyRefusal` becomes a
**not-configured** refusal rather than a categorical one.

Today the board refuses *Create story* on the grounds that *"a story is a
decision you make"* — a categorical claim, and it is false. The operator's
argument settles it: *"Wir machen das im Prompt mehrfach täglich."* A skill run
unattended many times a day cannot be categorically unrunnable unattended. The
skill names its own escape (one home → skip the question) and its own override
(explicit request beats triage), and this repo satisfies the first.

### The decisions the plan settles — do not re-derive them

**Count homes from `Story directory`, NEVER from the filesystem.** This is the
trap the design exists to avoid, and it was measured. A client repo
(`quaweb-website`) contains:

```
docs/stories/                                  ← the home
packages/website/content/de/stories/           ← website content
packages/website/content/en/stories/           ← website content
packages/website/images__deprecated/…/success-stories/…   ← image assets
```

A `git ls-files | grep stories/` counts four homes where there is one, and the
button would refuse *"more than one home"* in a repo with no ambiguity at all.
Principle 5: Plot discovers what a repo DECLARES, never infers structure from
names it did not choose (item 5).

Verified 2026-08-27: with `Story directory` unset here the default resolves to
`docs/stories/`, which exists holding four stories — so this repo takes the
single-home escape.

**Several declared homes refuse, naming the home question** (item 4) — never
guess. *A missing story is recoverable; a story in the wrong home is referenced
from elsewhere before anyone notices.*

**Nothing from the issue body reaches the shell.** The issue goes to a FILE and
only its path is passed, exactly as `/api/idea` does. This is a command-injection
boundary, not a style choice.

**Set `Story command` in this repo's `## Plot Config`** as part of this wave
(item 6), mirroring `Idea command`:

    - **Story command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

Measured: `Idea command` is set here and `Story command` is not, which is exactly
why one button works and the other refuses. Shipping only the capability leaves
*Create story* still refusing in the repo that dog-foods Plot, with its happy
path unexercised — and an unset key looks identical to a broken feature. The
refusal path stays asserted (item 3), because an unconfigured repo is the
ordinary adopting case.

**The board offers NO triage advice of its own** (item 8) — closed Open Point. A
second opinion rendered in a menu is a second place to keep the heuristic
correct, and it would drift from the skill's own triage. `/api/idea` already
behaves this way, and the parallel is the whole design.

**`/api/idea` is unchanged** (item 7), and the ticket menu still offers both
entries.

### Done when

All 9 items in the plan. Plus: `pnpm run validate`, `pnpm run test:board` green;
artifact rebuilt and committed (`pnpm build:board` from the repo root); a
changeset — this touches BOTH `packages/board` and `CLAUDE.md`, so use
`'@plot-pm/board': patch` frontmatter; Node 24; `trash` not `rm`.

**A new write route must join the write-gate test** — adding `POST /api/*` fails
`write-gate.test.mjs` until you add it to that file's `WRITE_ROUTES`.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns `/api/story` (a new route), `storyRefusal` in
`packages/board/src/app/components/AgentList.tsx`, the ticket menu, and this
repo's `## Plot Config`. Four sibling branches are in flight — two on board
client areas, two on `skills/plot/scripts/`. Rebase onto current main first.

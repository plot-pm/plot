## Implementation brief — an-unreachable-host-is-not-an-answer (wave Told)

- **Plan (canonical):** `docs/plans/2026-08-24-an-unreachable-host-is-not-an-answer.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session (2 rounds)
- **Branch:** `bug/an-unreachable-host-says-so` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Withheld` (a row with an unknown PR withholds its verdict) is
separate — do not build it here.

### What to build

The board says so when the host could not be asked: an all-`unknown` PR map
raises the banner, and the banner names which origins are dark and how old the
data still on screen is.

### THE DEFECT, EXACTLY — this is why it is silent today

`prError` **already exists**: `fleet.ts:522`, in the schema at `:3296`, rendered
in the fleet header. It is set in **one place only — a `catch` at
`fleet.ts:1720`**.

The quota failure does not throw. `gh` answers, the fetch succeeds, every PR
comes back `state: 'unknown'`, and the success path runs `entry.prError = null`
one line before at `:1714`.

So the field is right, the plumbing is right, and **nothing on the success path
ever looks at what came back**. You are adding a content-based trigger, not
plumbing.

### The trigger JOINS the catch — it does not replace it

**Done-when 9, and the regression this wave could quietly cause.** Most failures
DO throw; a content check that replaced the catch would lose all of them. Both
paths must set `prError`, and a thrown failure must still raise the banner.

### One banner, naming its origins

Not one per section. The plan argues it: these origins fail *together* — one
expired credential, one VPN off — and four messages for one cause reads as four
problems, where a reader who fixes the first still sees three.

Per-section blanks still need to say they are not an answer, but that is a label
belonging to whichever backend produced it, and it is **not this wave**.

### The age is free — use it

The catch deliberately keeps the last good map (an empty one *"looks like state
changing rather than data missing"*), which leaves a reader with PR data of
unknown age. The banner names it.

`prAgeSeconds` is already in the payload and **already rendered** at
`AgentList.tsx:1988` as `· PR data 45s ago`. This is placement, not computation.

### Write the rule for an ORIGIN, not for GitHub

Round 1 settled this and it costs nothing to honour: state the propagation
host-agnostically — *an origin that could not be asked propagates as a gap,
withholds every verdict depending on it, and withholds nothing else*. Three
enterprise backends land in this sprint and must inherit the rule rather than
each re-deciding.

### Done when

The plan's `## Done when` items 1, 2, 5, 9, 10 are this wave's specification
(3 and 4 belong to `Withheld`).

The two a naive implementation fails:

- **Item 2** — a single unknown PR among readable ones does NOT raise the
  banner. *One gap is a gap*; a trigger on "any unknown" fires constantly.
- **Item 9** — a thrown failure still sets `prError` and still shows the banner.

Plus `pnpm run test:board` green, artifact rebuilt and committed, and a changeset
with `'@plot-pm/board': patch` frontmatter.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Told (Branch: bug/an-unreachable-host-says-so, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists, and run
every test in the FOREGROUND — a `-p` run receives no notification.

### Scope guard

This branch owns the `prError` trigger in `fleet.ts` and the banner in the fleet
header, plus their tests.

**Do not touch** row verdicts — that is wave `Withheld`, and the two must not
both edit the classification.
**Do not add a backend.** Jira, Jenkins and Bitbucket are separate plans in this
sprint; this wave states the rule they will inherit.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild**, then commit. Do not commit
`packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

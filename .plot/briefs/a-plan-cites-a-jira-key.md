## Implementation brief — my-jira-tickets-are-in-the-inbox (wave Keyed)

- **Plan (canonical):** `docs/plans/2026-08-26-my-jira-tickets-are-in-the-inbox.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session (2 rounds)
- **Branch:** `feature/a-plan-cites-a-jira-key` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Listed` (the Jira backend) is blocked behind this and waits for a
real instance — **do not build it here**.

### What to build

`plot-plan-meta.sh` accepts `- **Issue:** PROJ-123` **where `## Plot Config`
declares a non-GitHub `Tracker:`**, reporting it in `issues` alongside `#228`.

### The exact code

`plot-plan-meta.sh:348-351`, inside the single-quoted awk region:

```awk
issue = strip_placeholder((fm_issue != "") ? fm_issue : canon_issue)
while (match(issue, /#[0-9]+/)) {
  issues[++n_issues] = substr(issue, RSTART + 1, RLENGTH - 1)
  issue = substr(issue, RSTART + RLENGTH)
}
```

`#N` only. `PLOT-412` yields `issues=[]` — **measured 2026-08-26**.

### Why this is a prerequisite, not a nicety

`fleet.ts:1401` defines the board's inbox as *"open tracker issues no plan
references"*, matched through this field. An unparsed Jira key does not merely
fail to display: a ticket a plan was written and DELIVERED for stays in the
inbox permanently, under a heading saying nobody has decided about it.

### The tracker gate, and the cost it carries

Read the key form **only** where `Tracker:` names a non-GitHub tracker. `#228`
is read everywhere, as today.

**This gives `plot-plan-meta.sh` its first configuration dependency.** Measured:
the script reads no config at all today, and eight callers parse plans through
it — the board's artifact, `plot-sprint-candidates.sh`, four skills and their
READMEs. Each inherits *the plan format now depends on where you are*.

So keep the dependency as narrow as it can be:

- read ONE key
- an unreadable or missing `## Plot Config` means **GitHub** — today's behaviour
- **never fail a parse for want of configuration**

**Accepting any `LETTERS-digits` token unconditionally was rejected** and must
not be re-proposed: a plan whose `Issue:` line says `WONT-FIX` or `TODO-later`
would start reporting an issue reference, and the inbox would hide a real ticket
on the strength of it. A format that guesses is worse than one that asks.

### THE TRAP THIS REPO HAS ALREADY PAID FOR

The awk region is inside a **single-quoted shell string**. **Never put an
apostrophe in a comment there** — `awk's` closes the quote early and produces
syntax errors that read as something else entirely.

### Done when

The plan's `## Done when` items 5, 6, 7 are this wave's specification (1–4 and
8 belong to `Listed`).

- **Item 5** — under a Jira tracker, `Issue: PLOT-412` reports `PLOT-412`, and
  `#228` still reports `228`.
- **Item 6** — **without a tracker key, `PLOT-412` still parses as absent.** The
  default is today's behaviour, so no existing repo changes meaning. This is the
  item a permissive regex passes item 5 without.
- **Item 7** — an unreadable or missing config never fails a parse.

Plus the 649 reconcile contract tests staying green with your new cases added.
This file is the plan-format contract and every Plot script is downstream of it.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Keyed (Branch: feature/a-plan-cites-a-jira-key, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists, and run
every test in the FOREGROUND — a `-p` run receives no notification.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh` and the reconcile
contract tests.

**Do not build the Jira backend** — that is `Listed`, and it waits on a real
instance for the token scheme.
**Do not migrate any plan** under `docs/plans/`.

`packages/board/plot-plan-meta.sh` is a VENDORED copy produced by
`pnpm build:board`; do not hand-edit it.

Add a changeset naming `'plot'` with a `bumps:` block. CI validates both the
package name and that each bumped skill is a real directory.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

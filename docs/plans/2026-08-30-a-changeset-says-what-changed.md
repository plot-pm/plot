# A changeset says what changed

> Nineteen of the published changelog's 169 entries print a bare comment-open marker instead of a description, because a `bumps:` block placed first becomes the first line — and the first line is what Changesets publishes.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `bug/a-changeset-says-what-changed`
- **Started:** 2026-08-30, Jan Wloka, `bug/a-plan-may-mention-a-comment-marker`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The release notes describe the change instead of printing a bare comment marker, and a changeset whose first line opens a comment fails CI rather than shipping.

## Motivation

**Measured 2026-08-30 on `main`: 19 of 169 published changelog entries — 11% —
have a bare comment-open marker as their entire description.** They look like this:

```
- [#520](…) Thanks [@jwloka](https://github.com/jwloka)! - (a bare comment-open marker, and nothing else)
```

**The cause is placement, not content.** Changesets takes everything after the
frontmatter as the description, and its changelog renderer publishes the first
line. A changeset that opens with the `bumps:` block —

```markdown
---
'plot': patch
---

COMMENT-OPEN          <- the real file has the two-character marker here
bumps:
  skills:
    plot: patch
-->

The real description, which nobody ever reads.
```

— publishes the marker alone. The same file with the comment at the END publishes
correctly. **CLAUDE.md documents the `bumps:` block and never says where it
goes**, so both orders look right to someone following it.

**This is a rule failing exactly as CLAUDE.md predicts.** *"Can you answer 'did
I complete this?' without actually doing the work? If yes, it's a rule."* — a
contributor can be certain they wrote a changeset without ever seeing what it
renders as. Twice in the last month it was written comment-first; the release
published both.

**What it costs is the one thing a changelog is for.** A reader scanning
2.12.0 sees three descriptions and one bare marker, and the only way to learn what
#520 did is to open the PR — which is the work the changelog exists to save.

## Design

### The rule is a domain rule, not another shell script

**`scripts/check-changeset-packages.sh` decides whether a changeset is valid,
and deciding is what the domain is for.** Adding a second decision to it would
be the shape this sprint exists to remove — a lifecycle rule living in shell,
where nothing can test it.

**Measured 2026-08-30: `scripts/` has no tests at all**, while
`packages/domain/src/rules/` already holds `deliverable.ts` under a 100%
threshold. The same rule expressed there is unit-testable against fixtures,
including the cases a real repository will not produce on demand.

**So the rule moves and the script becomes an adapter:**

```
packages/domain/src/rules/changeset.ts     is this changeset valid, and why not
scripts/check-changeset-packages.sh        reads the files, calls the rule, exits
```

**That is the same split the scripts are getting everywhere else** — the script
adapts the world into readings (which files, what they contain), the domain
decides (valid or a named refusal), and the exit code is the adapter's
translation of the answer.

**The script keeps its name.** It is referenced by `ci.yml:333` and by CLAUDE.md,
and once it stops holding the decision the name describes what it still does:
run the changeset check. **Renaming it would be churn for a file whose content
is about to shrink.**

**The rule reaches the domain through `node`**, which is settled precedent
rather than proposed here: seven scripts already invoke it, and
`plot-sprint-candidates.sh` argues for it in its own comment — *"node is already
required to run the board and every test suite."*

### What makes a changeset valid

Two conditions, and each is a named refusal rather than a boolean:

| refusal | measurement |
|---|---|
| `unknown-package` | the frontmatter names a package the workspace does not have |
| `no-description` | the first non-empty line after the frontmatter opens an HTML comment, **or the description is shorter than 20 characters** |

**The length floor is deliberately low.** It exists to catch `.`, `wip` and
`TODO` — not to police wording. `Fix typo` is 8 characters and legitimate, so
the floor sits below anything a person would actually write and above what an
agent produces when it has nothing to say. **Twenty characters is a guess and is
labelled one**; it should be revisited if it ever refuses a real description.

**It checks syntax and size, never meaning.** A gate that judges whether a
description is *good* is one people route around, and this repository has
already measured what a rule nobody follows costs.

### The fix for the 19 is not a rewrite

**The published CHANGELOG.md is a record of what shipped, and it is not
edited.** Rewriting past entries would make the file disagree with the git tags
it describes — and the descriptions those entries should have carried are not
recoverable without judgement about what each PR meant, months later.

**What is recoverable is the pointer.** Each broken entry carries its PR link
already; a reader who reaches a bare marker can follow it. **The fix is forward-only:
no new entry joins them.**

> An earlier draft proposed regenerating the changelog from the changeset files
> in git history. **Rejected on measurement — and the measurement was taken
> late.** That draft said "6 of the 19", which was a plausible figure I had not
> checked; this plan asserts elsewhere that a claim looking like a measurement
> must be one, so it is corrected here rather than quietly.
>
> **Measured 2026-08-30: 14 of the 19 have no recoverable changeset file.** The
> merge commit for each broken entry was searched for an added `.changeset/*.md`;
> five have one, fourteen do not — Changesets deletes them on version, and
> squash-merge leaves nothing of the branch behind.
>
> The correction strengthens the argument rather than weakening it: regeneration
> could restore under a third of the entries, and the rest would still read as a
> bare marker beside them.

### Where the rule is written down

CLAUDE.md's Versioning section shows the `bumps:` block without saying it goes
last. **It gains one line and one example**, so the gate has something to point
at when it fires.

## Slices

### Gating (Branch: bug/a-changeset-says-what-changed, PR: #535)

`changeset.ts` in the domain, the script reduced to an adapter, the CLAUDE.md
line, and a note at the head of the CHANGELOG.

**Done when**

- a changeset whose first non-empty line opens a comment is refused
  `no-description`; one with the block last passes
- a description under 20 characters is refused the same way
- an unknown package is still refused `unknown-package`
- **the decision lives in `packages/domain/src/rules/changeset.ts` at 100%
  coverage**, and the script contains no `if` about validity
- CLAUDE.md says where the `bumps:` block goes
- **the CHANGELOG carries one line at its head** saying that entries before
  2026-08-30 may show a bare comment marker instead of a description, and why

**The test is a mutation, not an example.** Removing the description assertion
must turn it red — a gate whose test passes without it is a comment.

> **The CHANGELOG line is the one write to a machine-generated file**, and it
> earns it: 14 of the 19 broken entries have no recoverable changeset, so a
> reader meeting a bare marker has no way to learn what it was. The line says
> the entries are broken, when it stopped happening, and that the PR link still
> works. **It is at the head, not beside each entry** — nineteen annotations
> would be nineteen edits to a file Changesets rewrites.

### Parsing (Branch: bug/a-plan-may-mention-a-comment-marker)

`plot-plan-meta.sh` stops treating a comment-open marker as a comment when it
appears inside a fenced block or inline code.

**Same family as the first slice, one layer up**: something that looks like data
is read as syntax. **Measured on this plan**: writing the marker in its one-line
summary made the whole file parse as `format: none` — no phase, no type, no
slices. A plan about a mishandled comment, defeated by a mishandled comment.

**Done when** a plan whose summary contains a backticked comment marker parses
with its phase, type and slices intact; a plan with a genuine HTML comment still
has it skipped; **every plan in `docs/plans/` parses identically before and
after**, which is the assertion that keeps this from breaking the format
contract for everything else.

**It is a separate slice because the risk is different.** The first slice adds a
rule nobody depends on yet. This one changes the parser **every component reads
plans through** — `plot-fleet-scan.sh`, `plot-deliver.sh`, the board. A mistake
there is not a bad changeset; it is a fleet that cannot see its plans.

## Notes

**Why `bumps:` is a comment at all.** It is read by the release tooling and
must not appear in the published note, so it is hidden from the renderer. That
is sound; the defect is only that hiding it FIRST hides the description behind
it.

### The same defect bit this plan, in a second parser

**`plot-plan-meta.sh` reads a comment-open marker anywhere in a plan — even
inside inline code — and skips to the close.** Writing the marker in this plan's
one-line summary made the whole file parse as `format: none`: no phase, no
type, no slices. A plan about a mishandled comment, defeated by a mishandled
comment.

**That is why the example above says `COMMENT-OPEN`.** The literal cannot appear
in a plan without swallowing everything after it, so this file describes the
marker instead of printing it.

**It is the same shape as the changeset defect and a different implementation.**
Changesets publishes the first line whatever it is; the plan parser treats the
marker as a comment wherever it is. Both hand a reader something that looks like
data and is really syntax. **The Parsing slice now covers it** — it was recorded
here as a finding first, and became a slice once it was clear that leaving it
would cost the next plan the same way it cost this one.

**The 19 are not evenly spread.** They cluster in releases from the period when
skill-bump changesets became routine, which is consistent with the cause: the
`bumps:` block is what a contributor adds, and adding it at the top is the
natural place if nothing says otherwise.

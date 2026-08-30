# A changeset says what changed

> Nineteen of the published changelog's 169 entries print a bare comment-open marker instead of a description, because a `bumps:` block placed first becomes the first line — and the first line is what Changesets publishes.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

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

### The gate goes where the existing one is

`scripts/check-changeset-packages.sh` already runs in CI (`ci.yml:217`) and
already parses every changeset for its package name. **It gains one assertion**:
the first non-empty line after the frontmatter does not open an HTML comment.

**One script rather than a second** — it already opens each file, and a second
walker over the same directory is a second place for the parse to drift.

Renaming it is deliberate scope creep and is not done: the file is referenced
by name in CI, in CLAUDE.md and in this repo's history, and a rename to
`check-changesets.sh` buys a better name at the cost of every one of those.

### The fix for the 19 is not a rewrite

**The published CHANGELOG.md is a record of what shipped, and it is not
edited.** Rewriting past entries would make the file disagree with the git tags
it describes — and the descriptions those entries should have carried are not
recoverable without judgement about what each PR meant, months later.

**What is recoverable is the pointer.** Each broken entry carries its PR link
already; a reader who reaches a bare marker can follow it. **The fix is forward-only:
no new entry joins them.**

> An earlier draft of this plan proposed regenerating the changelog from the
> changeset files in git history. That was rejected on measurement: of the 19,
> the changeset files for 6 are no longer in any branch — Changesets deletes
> them on version, and those releases predate the current retention.

### Where the rule is written down

CLAUDE.md's Versioning section shows the `bumps:` block without saying it goes
last. **It gains one line and one example**, so the gate has something to point
at when it fires.

## Slices

### Gating (Branch: bug/a-changeset-says-what-changed)

The assertion in `check-changeset-packages.sh`, the CLAUDE.md line, and a test.

**Done when** a changeset whose first line after the frontmatter opens a comment
fails the script; one with the comment last passes; the existing package-name
assertion still fires on an unknown package; and CLAUDE.md says where the block
goes.

**The test is a mutation, not an example.** Removing the new assertion must
turn it red — a gate whose test passes without it is a comment.

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
data and is really syntax. **The Gating slice covers the changeset side only** —
the parser side is a separate finding, and fixing it means teaching an awk
program about fenced blocks and inline code, which is a different plan with a
different risk.

**The 19 are not evenly spread.** They cluster in releases from the period when
skill-bump changesets became routine, which is consistent with the cause: the
`bumps:` block is what a contributor adds, and adding it at the top is the
natural place if nothing says otherwise.

# A complete page is not truncated

> Bitbucket returns a fixed page of 50, so three rows prove nothing was hidden — and the board discards them anyway, reading branches that have PRs as having none.

## Status

- **State:** Rejected
- **Type:** bug
- **Issue:** #912
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Rejected:** 2026-09-15, jwloka, two false premises — no fixed page size, and nothing consumes the warning

## Changelog

- A Bitbucket PR page smaller than the host's fixed page size is reported complete rather than possibly truncated. The board discarded complete pages, so branches with open PRs read as having none.

<!-- Board impact: the board consumes the warning this changes. No plan format,
     no template, no layout. -->

## Design

**The rule is right for GitHub and stops short for Bitbucket**, in one function.
`plot-host.sh:1818-1827`:

```sh
[ "$count" -gt 0 ] || return 0            # an empty page had nothing to hide
if [ "$be" = "github" ]; then
  [ "$count" -ge "$limit" ] || return 0   # fewer than the limit PROVES complete
fi
# bitbucket falls through: ANY non-empty page is called unprovable
```

**GitHub's arm states the reasoning this plan extends** (`:1787-1790`): *"a state
is possibly truncated when it returned AT LEAST the requested limit… Fewer rows
than the limit PROVES completeness."*

### Bitbucket has a page size, and the file already names it

The warning's own text says it: *"bitbucket ignores --limit; bb returns a fixed
page (50 at 1.0.0)"*. **So a page of 3 is proof, by the identical argument** —
fewer rows came back than the host would have returned had more existed.

The comment at `:1791-1795` concludes *"it can NEVER prove completeness"*, and
that is true of the **requested `--limit`** and false of the **host's page size**.
Those are two different numbers, and the rule reads only the first.

### What the wrong answer costs

Measured on `quaweb-website` (#912): **three open PRs, nine branches**, every one
rendered `commits, no PR ever opened` under a banner saying the data is
unavailable — while two of those branches had open PRs. **The board discards the
whole page rather than the rows it doubts**, so a complete answer becomes no
answer.

### The page size is read, never guessed

**It travels with the backend rather than as a constant in the comparison.** `bb`
reported 50 at 1.0.0 and a later version may page differently; a hardcoded 50
would turn a correct answer wrong the day that changes. **Where the page size is
not known, the current behaviour stands** — unprovable, warn — because this plan
narrows a warning and must never silence one it cannot justify.

### What this does not do

**It does not touch the GitHub arm.** Its rule is already correct and this plan
adds a second backend to the same shape.

**It does not fix #333.** That issue is the join going partial **past** the page
size, which is a real truncation and still warns. **This plan is the opposite
end**: a page below the size, wrongly doubted.

**It does not change what a consumer does with the warning.** The board's
handling of a genuine truncation is unchanged; it simply stops receiving one for
a complete page.

## Slices

### A complete page is not truncated (Branch: bug/a-complete-page-is-not-truncated)

- `bug/a-complete-page-is-not-truncated` — prove a Bitbucket page complete when it holds fewer rows than the backend's known page size, leaving the GitHub arm and every genuine truncation warning untouched

**Done when** a Bitbucket page of 3 rows with a known page size of 50 reports
**no** warning, pinned by a test; a page **at** the page size still warns, pinned
separately, since that is the case #333 describes and it must not be silenced; a
page whose size is **unknown** still warns, pinned explicitly, because a narrowed
warning must never rest on a guess; an **empty** page still returns early
unchanged; **the GitHub arm is byte-identical**, pinned across a page below, at
and above its limit; the page size is **read from the backend rather than
hardcoded at the comparison**, checked by asserting a different declared size
moves the threshold; and `pnpm run test:contracts` passes.

## Notes

**Filed as #912 with a live measurement** on `quaweb-website`: three open PRs,
far below any page limit, and the board discarded them.

**Follow-up to #333, which stays open.** The two are opposite ends of one code
path — that one is the join going partial past 50, this one is a page of 3 read
as unprovable. Fixing this does not close that.

## Why this was rejected

**A three-lens panel returned a unanimous `reject`** — the first this week — and
the moderator verified both findings. Record in
`.plot/panels/2026-09-15-a-complete-page-is-not-truncated/`.

### The warning has NO consumer, and this plan claimed it did

**Measured: `grep -rn 'possibly truncated' packages/board/src packages/domain/src`
returns ZERO.** This plan's own Board-impact comment asserts *"the board consumes
the warning this changes"*. It does not.

`pr_list_report_truncation` writes to stderr and **returns 0** — it never touches
an exit code. On a Bitbucket page of 3 the warning fires, `rc` is 0,
`HOST_VERDICT` is `ok`, and `host_err` is discarded unread. **Removing the
warning would change an unread string into a shorter unread string.**

**So the rendering the ticket reports is decided somewhere this plan never
looked.** Its *"What the wrong answer costs"* paragraph is the one connecting the
warning to the rendering, and it is the one paragraph with no `file:line`.

### `bb` has no fixed page size, and the comment saying so is stale

The plan read `plot-host.sh`'s *"bb returns a fixed page (50 at 1.0.0)"* as a
standing fact about the host. **Installed here is `bb` 1.9.0**, and the value is
a **client-side accumulator cap after a bounded page walk**, not a server page
size. Bitbucket's own `pagelen` is a separate number this plan never mentions.

**And a short page can still be truncated.** The walk breaks at page 10, so a
repository whose server `pagelen` is small enough returns **fewer than 50 rows
that are genuinely incomplete** — and an author-filter fallback filters
client-side from a truncated superset. **This plan's rule would call those
complete and silence the warning on exactly the case it exists for.**

**The GitHub argument does not transfer.** Its `--limit` is a value the script
requested and the host honoured, so `count < limit` means the host ran out of
rows. Bitbucket's 50 is a cap the script never requested and cannot observe.

### What survives

**The ticket is real and unexplained.** Three open PRs rendered as
`no PR ever opened` is a measured defect on `quaweb-website`. **This plan found
the wrong cause**, and the next one should start where the discard is actually
decided rather than at the warning.

**Nothing was implemented.** No branch, no PR, no `Started:` record.

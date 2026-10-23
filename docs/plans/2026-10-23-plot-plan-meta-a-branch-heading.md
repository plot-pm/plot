# plot-plan-meta: a (Branch: …) heading silently drops → #N and annotations from the list item below it

> A plan with a `### A (Branch: bug/x)` heading and a list item `- \`bug/x\` — foo → #12` below it parses with `prs: []`. The heading shape reads the heading only, so the PR annotation and the `builds:`, `waits:` and `deferred:` markers on the list item are lost, and no scan section reports the loss.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2368
- **Review:** pr
- **Impl:** own branches

## Changelog

- A plan whose slice heading carries `(Branch: …)` and whose list item below it claims the same branch keeps the `→ #N` annotation and the list item's markers. Where the parser cannot read such a list item, the reconcile scan reports it.

Board impact: plans in the mixed shape change from `prs: []` to their PR numbers. The board reads `prs` from `plot-plan-meta.sh`, so their rows gain PR links. No plan-format change.

## Motivation

### What happens

When any `### ` heading under `## Slices` carries `(Branch: …)`, `plot-plan-meta.sh` sets `slice_shape = "heading"` (`plot-plan-meta.sh:1265`). The heading handler then skips every line that is not a `### ` heading (`:1332`). A plan that also writes the conventional list item below the heading loses everything on that line:

- `→ #N`, the annotation `/plot-implement` and `/plot-open-pr` tell the implementer to append to the branch line (`skills/plot-implement/SKILL.md:322`). The plan reports `prs: []`.
- `<!-- builds: … -->`, `<!-- waits: … -->` and `<!-- deferred: … -->`.

No section of `plot-reconcile-scan.sh` reports the loss. Section 24 (`unread_branch_headings`) and section 24a (`unread_waits`) read fields the parser fills only for headings and for branch lines it reads, so a skipped list item fills neither.

### Reproduction

Reported against 2.27.0 and 2.28.0:

```markdown
## Status

- **Phase:** Delivered

## Slices

### A (Branch: bug/x)

- `bug/x` — foo → #12
```

`plot-plan-meta.sh` prints `"prs": []`. With ` (Branch: bug/x)` removed from the heading it prints `"prs": [12]`.

### Where it was hit

ewz-kus-portal (Bitbucket) holds five delivered plans in this mixed shape. None resolved to a release version until the parenthetical was stripped from their headings; afterwards the scan resolved four of the five to their tags. The visible symptom is scan section 6, "delivered, but no PR annotation → cannot resolve a version", for a plan whose branch line plainly ends in `→ #3712`. `/plot-release` step 5b refuses the plan for the same reason.

### Why it stays silent

The heading shape was designed so that "body lines are prose — never scanned for a branch or a PR" (`plot-plan-meta.sh:1330`). That guarantee protects a heading-shape plan from a backticked name in prose being read as a second claim. A list item that claims the same branch the heading names is not that case: it is the documented place for `→ #N`, and the two shapes in one section are a mistake the parser can recognise.

## Design

### Approach

The issue offers three repairs. Each one alone prevents the loss.

1. **Read the list item.** In the heading shape, a list item whose anchored branch claim (`branch_claim_re`) names the branch of the most recent heading contributes its `→ #N` and its annotations to that branch. A list item naming a different branch, and every prose line, stays unread, so the prose guarantee holds.
2. **Report the mixed shape.** A heading-shape section that contains a branch-claiming list item gets a finding in `plot-reconcile-scan.sh`, in the `unread_headings` / `unread_waits` family. The scan reports and never gates, like sections 24 and 24a.
3. **Write the PR into the heading.** `/plot-implement` and `/plot-open-pr` write `PR: #N` into the heading (`### A (Branch: bug/x, PR: #12)`) when the section is in the heading shape.

Recommendation, for the reader to confirm: repair 1 for the parser, and repair 2 for a list item the parser still cannot attribute (a claim naming a branch no heading names). Repair 3 changes what two skills instruct and leaves the five existing plans unread, so it is not enough alone.

### Open Points

- [ ] Which repair or repairs. The recommendation above is 1 with 2 as the fallback report.
- [ ] A list item that names the heading's branch and also carries `→ #N` where the heading carries `PR: #M`: both counts go into `prs`, or the heading wins. The existing plans decide: measure how many plans carry both.
- [ ] Corpus check. Run the parser over `docs/plans/` before and after, and list every record that changes. The 2026-09-28 latch change did this (355 of 357 byte-identical) and this change owes the same figure.
- [ ] A shell-and-domain duplicate: `rules/` and `packages/domain` may read the same section. Confirm whether the plan reader in the domain package has the same skip, and whether it needs the same repair under a corpus test.

## Slices

### Same-branch list item

- `bug/plot-plan-meta-a-branch-heading` — read a same-branch list item in the heading shape, and report the one that cannot be attributed

## Notes

- Raised from tracker issue #2368 (https://github.com/plot-pm/plot/issues/2368). The plan writes nothing to the tracker.
- Related, delivered: `2026-09-28-a-heading-names-a-branch-or-says-it-could-not.md` (backticked `Branch:` value) and `2026-09-28-a-section-latches-on-a-branch-not-a-heading.md` (first-heading latch). Both changed how the heading shape is entered; this plan changes what it reads once entered.
- Deliverable search for "heading-shape list item annotation reader" found no existing artifact with this purpose. The nearest are scan sections 24 and 24a, which this plan may extend.

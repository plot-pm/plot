# Adoption notices a stale default branch

> Plot resolves the default branch two ways: the host is asked, and `origin/HEAD` is read. In a clone whose `origin/HEAD` went stale they disagree, the board reads plans from the wrong ref, and neither `/plot-init` nor `/plot-board-setup` notices. Both reported the repository healthy.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #971

## Changelog

- Adoption compares the local `origin/HEAD` with the host's default branch and proposes the `Main branch` key where they differ. Measured on Plot 2.20.0: a clone whose GitHub default had moved to `develop` kept `origin/HEAD → main`; `/plot-init` wrote no key, `/plot-board-setup` verified the board as healthy, and the board then read `planSource.ref: origin/main` and showed one untitled group listing `develop` itself as a branch.

Board impact: **yes.** The wrong ref is what the board enumerates plans from; the symptom is entirely a board reading.

## Motivation

**Two resolutions, and only one asks the authority.**

| Reader | How | Answer in the reported clone |
|---|---|---|
| `plot-host.sh default-branch` | asks the host (`gh repo view`) | `develop` |
| `plot-detect-repo.sh` | `origin/HEAD`, else the current branch, else `''` | `main` |
| `board.ts:733-761` | `Main branch` key → local `origin/HEAD` → `main` | `main` |

`origin/HEAD` is a **local cache written at clone time**. A default branch changed afterwards does not update it, and nothing in git notices.

**Adoption is where this must be caught**, because it is the one moment Plot asks the host anything about the repository's shape and writes a config from it. Miss it there and every later reading is wrong in the same direction, silently.

### The symptom does not name the cause

The operator saw *"NOT STARTED (1 plan · 4 slices)"* listing `develop` and two feature branches as in-progress work, with only one plan recognised. **Nothing in that points at a default branch.** They found it by adding `- **Main branch:** develop` and watching three plan cards appear.

That is the cost: a reading that is wrong everywhere presents as a board that is wrong in a way no message explains.

## Design

### What was measured, 2026-09-24

`plot-detect-repo.sh:20` states its own rule:

> `default_branch    from origin/HEAD, else the current branch, else ""`

**The host is never asked**, though the probe already knows `git_host` and `plot-host.sh default-branch` exists and is the adapter's own op.

On this repository all three agree — host `main`, `origin/HEAD` `main`, probe `main` — **which is exactly why the defect is invisible here** and had to be reported from a clone where the default had moved.

### The shape of the fix

The probe gains one reading and no decision:

- keep `default_branch` as the local answer it already reports
- add the host's answer beside it, as its own field
- report both; **decide nothing**

Then `/plot-init` and `/plot-board-setup` act on the disagreement: where the two differ, propose `- **Main branch:** <host's answer>`.

**The split follows the probe's own settled rule** — `plot-detect-repo.sh` *"reports counts and never the answer they imply"*, with the thresholds living in `proposeStack`. A probe that decided this would be the second answer that split removed.

### Which answer wins, and why the host

The host owns the default branch; `origin/HEAD` is a cache of it. Where they disagree the cache is stale by definition.

**But the config key stays a proposal, not a write.** An operator may have a reason to work against a different ref, and `/plot-init`'s own rule is *propose, don't interrogate*. The disagreement is reported and the key offered; the operator accepts it.

### Failing to ask is not failing

The host may be unreachable, unauthenticated, or absent. **A probe that cannot ask reports that it could not**, never that the two agree — the same direction `plot-board-probe.sh` already takes with `auth: unknown`, whose comment reads *"Report that we cannot tell, never that it is fine."*

Silence here would be the worse failure: it reads as confirmation.

### What this does NOT do

- **It does not write `Main branch` automatically.** Adoption proposes.
- **It does not repair `origin/HEAD`.** `git remote set-head origin -a` is the operator's call on their own clone, and `plot-reconcile-scan.sh` already self-heals it during its fetch — mentioning that in the proposal is useful; doing it inside a probe is not.
- **It does not change `board.ts`'s three-step resolution.** That chain is correct and its first step is the key this fix gets written.
- **It does not add a host call to the board's hot path.** The question is asked once, at adoption.

### Done when

- The probe reports the host's default branch beside the local one, and reports *could not ask* where the host is unreachable.
- `/plot-init` and `/plot-board-setup` propose `Main branch` where the two disagree, and say nothing where they agree.
- **A repository where they agree gains no key** — the regression this must not cause, since that is every repository including this one.
- The proposal names both answers, so the operator sees what disagreed rather than a bare suggestion.

## Slices

### The probe asks the host what the default is (Branch: bug/the-probe-asks-the-host-for-the-default)

- `bug/the-probe-asks-the-host-for-the-default` — the adoption probe reports the host's default branch as its own field beside the local reading, with an explicit *unknown* where the host cannot be asked; it decides nothing

### Adoption proposes the key when the two disagree (Branch: bug/adoption-proposes-the-main-branch-key)

- `bug/adoption-proposes-the-main-branch-key` — `/plot-init` and `/plot-board-setup` compare the two readings and propose `- **Main branch:** <host>` where they differ, naming both answers; silent where they agree or where the host could not be asked

## Notes

- Reported from a clone whose GitHub default moved from `main` to `develop` after cloning. **Not reproducible here**: this repository's host, `origin/HEAD` and probe all answer `main`, which is why a defect affecting every reading Plot makes went unnoticed.
- Two slices rather than one, and the order is forced: the proposal cannot compare a reading the probe does not take. The first is a reading with no behaviour change and can land alone.

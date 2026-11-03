# fleetd merges no slice PR while no Merger app is declared

> A green slice PR with `plot/review` success and no HIGH merges with no person on this repository, which declares no `Merger app`.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3063
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd merges a green slice PR whose head has `plot/review` success in a repository that declares no `Merger app`, through the merge controller and its existing refusals. The exact rule is chosen in Open Questions.

<!-- Board impact: none expected. The board reads the hold reason `merger-app-missing` only if a view renders it; the slice confirms. -->

## Motivation

On 2026-11-02 and 2026-11-03 every slice PR of sprint `2026-W44-delivery-loop` with a green head and a clean `plot/review` waited for a person, or for an operator's job script that called `plot-ask.mjs merge`. The sprint goal says the fleet carries every plan to Delivered alone.

The cause is one rule. `packages/fleet/src/shared/auto-merge.ts:183` sets `mergerAppMissing` when the host is GitHub and `## Plot Config` declares no `Merger app`. `slicePrNext` then holds every PR with `merger-app-missing` (`packages/domain/src/rules/slice-pr-next.ts:346`). `plot-host.sh pr-merge` already merges as the signed-in `gh` identity when no App is declared and prints "Merger app not configured — merging as the signed-in gh identity", so a person merging through `plot-ask.mjs merge` succeeds where fleetd is held.

Plan `fleetd-merges-slice-prs-one-at` (#2902, Released 2026-11-03) decided D4: on GitHub fleetd merges nothing until `Merger app` is declared, so no fleet merge uses the admin bypass. Its finding 4 gives the reason: ruleset 24412719 grants the Admin role `bypass_mode: always`, and the signed-in `gh` identity is admin. This plan revisits D4 for a repository that has no App. It does not remove D4 for one that declares an App.

## Design

### Approach

Expected behaviour: a green slice PR whose head has `plot/review` success and no HIGH merges with no person, through the merge controller and its refusals (`default-branch-red`, `head-moved`, `release-pr`, the repair arm). The decision below chooses how the identity and the bypass are handled.

Three options, each with its cost:

1. **Declare and install a Merger app for plot-pm/plot.** No code change in the domain. The merge is attributed to the App. The App needs a place in the ruleset's bypass list, and the Admin role keeps `bypass_mode: always`. The operator creates the App, installs it, stores its key, and adds `Merger app` to `## Plot Config`; this repeats for every repository that adopts the fleet. A repository with no App stays held.
2. **Let fleetd merge as the signed-in identity when no Merger app is declared.** Removes the `merger-app-missing` hold (or turns it into a notice). The merge is attributed to the person whose `gh` login runs fleetd, and it uses that person's ruleset bypass (Admin, `bypass_mode: always`). This restores the exposure D4 closed: the gate that stands between a PR and the default branch is `plot/review` plus the controller's refusals, with no ruleset check in between. It needs no setup.
3. **Both.** An App when declared; the signed-in identity otherwise, behind an explicit opt-in key so the weaker path is a recorded choice and not a default.

Bitbucket: the key does not apply (`mergerAppMissing` is false off GitHub, `auto-merge.ts:183`), so fleetd already merges there as the signed-in `bb` identity. Option 2 would make GitHub match that behaviour; options 1 and 3 leave the two hosts different. Bitbucket's merge endpoint takes no head precondition, so its arm re-reads the head before merging.

Recommendation, for the reader to confirm or overturn: option 3 with the opt-in key. It keeps D4 as the default, lets this repository unblock the sprint goal with one config line, and makes the attribution and bypass a recorded decision. Option 1 stays the target for any repository that wants the merge attributed to a bot.

### Open Questions

- [ ] Which option: 1, 2 or 3?
- [ ] If 3: the key's name and where it lives (`## Plot Config`), and whether `plot-init` or `plot-board-setup` proposes it.
- [ ] Does the signed-in path need the same `plot/review` re-read that `release-approve` makes, since the identity can bypass the ruleset?
- [ ] Attribution: does the merge commit or PR comment name the identity that merged, so a person can tell a fleet merge from a hand merge?

## Slices

### Merge without an App

- `feature/fleetd-merges-with-the-signed-in-identity` — the `mergerAppMissing` reading and the `merger-app-missing` hold change per the chosen option; unit tests in `packages/domain/test/slice-pr-next.test.ts` and `packages/fleet/test/unit/auto-merge.test.ts`; update `docs/review-status-rollout.md` <!-- builds: the opt-in reading of the signed-in identity for fleetd merges -->

## Notes

- Refs #2902. Origin: tracker issue #3063, filed 2026-11-03. The plan writes nothing to the tracker.
- `plot-ask.mjs merge` is not changed by this plan: it already merges without an App.

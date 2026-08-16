---
"plot": minor
---

The board links to what its rows and cards name: the plan, the pull request, and the story.

Every one of those was a dead end. To see the PR you left for the browser, to read the plan you left for the editor — on a view whose whole job is telling you where work stands.

**The href had to come from somewhere, and it could not come from the board.** `pr-list --rich` projected `number, title, state, head, draft, checks, review` and dropped the URL on both backends, so the board had PR *numbers* and no way to turn one into a link. It must not learn one: nothing under `packages/board/src` distinguishes github.com from a self-hosted Bitbucket, and templating an address from a config key produces a plausible link and a wrong one for GitHub Enterprise. So `pr-list --rich` gains `url` — one jq field per backend, read from the same places `pr-state` already reads — and `plot-host.sh` stays the one thing that knows what a host URL looks like. Where the adapter reports no URL, the number renders as plain text. Inventing one where the adapter has the real one is how a link becomes confidently broken.

**PR numbers were parsed and dropped without anything in between.** `PlanMetaSchema` read `prs` as `z.array(z.number())`, `CardSchema` had no such field, and `board.ts` contained no occurrence of the string `prs` at all. Cards now carry them, each paired with the URL the host gave us or an empty string.

**`--state all` needed `--limit` to mean anything.** Both host CLIs page at 30. That is invisible with `--state open` — few repos have thirty open PRs — and bites the moment the board asks for merged ones too, where the newest thirty crowd out every older PR and leave exactly the finished work unlinked. `pr-list` takes `--limit` now; without it the host's own default stands, so no existing caller's result changes. The single fetch serves both indexes, and the by-head map the fleet classifies from is filtered back down to open, so a merged PR can never answer for a branch whose merge already answered.

Agent rows carry the plan's **filename** beside its display name. Stripping the date prefix is lossy on purpose (it is noise in a column), which is why the filename travels separately rather than being reconstructed by whatever needs to build a `/plan/` href.

Anchors throughout, following the card's existing convention: cmd/ctrl/shift/middle-click open natively and only a plain primary click is intercepted. A story badge is the one that needs help — lanes are what render a story as a row, so the jump turns lanes on first and scrolls on the next frame, once the row it aims at exists.

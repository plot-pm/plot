# Research: Editing plans from the board

> **Research only — not committed, not part of the approved plan.** Options for Max to react to; nothing here is scheduled or implied by the kanban-board-v1 plan. That plan keeps the board strictly read-only.

**Question (R1):** How could the board offer *editing* plans — starting with approval, potentially also changing text?

## Framing: what "approve" actually is

In plot, approval is not a field flip. `/plot-approve` merges the plan PR to main, flips the phase, moves the active symlink, and fans out implementation branches — judgment plus multi-step git writes. Any "approve button" is really choosing *where that work runs and who exercises judgment*. That framing sorts the options:

## Option A — Deep-link out (board stays read-only)

Cards link to the plan PR (`gh` URL) and to the file in the editor (`vscode://file/...`). "Approving" means clicking through to GitHub and doing what you do today; text edits open your editor.

- **Cost:** near zero. **Risk:** none. **Manifesto fit:** perfect (git stays the database, board stays a viewer).
- **Verdict candidate:** the honest v1.1. Solves "I'm looking at the board and want to act" without the board growing write authority.

## Option B — Intent queue (board writes requests, agent executes)

The board gets one write endpoint: `POST /api/intent` appends `{action: "approve", slug, requestedBy, at}` to a gitignored local file (e.g. `.plot/intents.jsonl`). It changes nothing else. The next agent session (or a `/plot` invocation) sees pending intents and runs the real `/plot-approve` flow — with all its guardrails, pre-flight checks, and judgment.

- **Cost:** small (one endpoint, one file convention, a `/plot` hook to surface pending intents).
- **Risk:** low — the board still cannot corrupt state; worst case is a stale intent file.
- **Manifesto fit:** strong. Commands-not-code is preserved: the skill still does the work; the board is a *request* surface. Phase guardrails still run.
- **Agent-friendly:** very — intents are structured input agents already know how to act on.
- **Open question:** intent expiry/dedup; whether an intent should also be visible on the board ("approval requested" badge).

## Option C — Server executes git/gh directly

The board server grows real write endpoints: approve runs the merge + symlink moves + branch fan-out itself (shelling out to `git`/`gh`, or driving a headless `claude -p "/plot-approve <slug>"`).

- **Cost:** high — the server must reimplement or invoke every guardrail (`cannot approve unreviewed draft`, drift checks…), plus auth for the gh writes.
- **Risk:** highest. A localhost HTTP server with merge authority is a footgun (any local process can POST to it). CSRF/localhost-binding mitigations needed. Failure modes are exactly the half-delivery drift #37 just spent a plan preventing.
- **Manifesto fit:** weak on Q3/Q6/Q7 — it moves judgment out of skills into code, and the headless-claude variant is expensive and opaque.
- **Verdict candidate:** only worth it if the board becomes the *primary* interface for a non-CLI audience — which is R2 territory, not a local-tool decision.

## Option D — Text editing via PR suggestions

For "changing text" specifically: the board posts GitHub PR review comments/suggestions on the plan PR (via `gh api`) instead of editing files. Review happens where review already lives.

- Piggybacks on GitHub auth and review flow; no local write authority.
- Only works for plans still on an open PR (Draft phase) — which is exactly when text editing matters.

## Recommendation (if/when this is wanted)

Ladder: **A now → B when acting-from-the-board is proven wanted → C only with a public-server story (R2) and a real auth model.** D is a nice bolt-on to B for Draft-phase edits. Each rung preserves the property that plot skills — not the board — hold the write path and guardrails.

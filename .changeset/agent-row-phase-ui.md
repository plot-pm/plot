---
"@plot-pm/board": minor
---

An agent row now says which phase its work is in, and a shelved branch says it was shelved.

The Agents tab grouped rows by what they *wait for* — and every one of those groups is decided by time. That answers *is anything moving* and cannot answer *moving on what*. A human still drafting a plan and an agent building against it read identically, and NOT STARTED could not tell *ready for someone to pick up* from *no branch tip we can date*.

**The phase replaces the repo cell.** Not a seventh cell: the row already wraps on a branch called `feature/opus5-hardening-challenge-budget`. The repo is the right thing to give up — constant in a one-repo board, rendered nowhere else in the app, and a column showing the same word on every row is chrome that never varies. Wider than the repo's `w-16`, which fits 8–9 characters: "Development" is 11 and would have rendered "Developm…".

**The word is spelled out.** Initials cannot carry it — Discovery, Design and Development all begin with D, and `DE` covers two of them — and neither can the existing phase icons: `PHASE_LEADERSHIP` maps 👤 to three of the five phases, because it encodes *who leads* rather than *which phase*. The cell also carries an `sr-only` label, because this list is a `<li>` of `<span>`s with no table semantics: column position conveys nothing to a screen reader, and `Development` does not announce itself as a phase the way `plot` happened to read as a repo name.

**A `deferred` badge, beside the state rather than instead of it.** The phase has already fallen back a step for a handed-back branch, and a bare *Design* row is indistinguishable from one nobody ever started. The badge carries the half the phase cannot: this did not fall back because nobody began it, but because someone gave it up.

**Start work reaches the rows that can actually be started.** The button already existed on plan cards; nothing new is built. It appears only on `not-started` rows an earlier wave does not block — a button on a blocked row would offer to skip the ordering waves exist to express, and `plot-dispatch` refuses that branch anyway, so the board would be inviting an action the tool declines. No greyed-out control either. A row whose plan has no board card gets no button rather than a broken one.

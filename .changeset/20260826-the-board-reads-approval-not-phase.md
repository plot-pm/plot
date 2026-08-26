---
"@plot-pm/board": patch
---

The board carries no plan field it does not read.

`impl` left `PlanMetaSchema`. `plot-plan-meta.sh` emitted it, the schema
declared it with a default, and no producer, consumer or renderer ever read it
— a field declared and read nowhere is precisely the defect
`setup-names-an-unread-key` (PR #452) warns board adopters about. Plot was doing
to its own schema what `/plot-board-setup` now warns users about. Zod strips the
key the parser still sends; nothing downstream referenced it, so `tsc` stayed
green. The rule this settles — *no field joins the schema without a consumer* —
run backwards.

`review` stays, and its contract is now stated where it lives: it is read once,
by `planStatus`, where `review === 'pr'` decides the `open`/`draft` split for a
draft plan's own PR. That single internal use is the whole of its contract — the
word never reaches a row, only the derived status it drives. Done-when 2's first
branch (reaches a reader) was already met; what was missing was the schema
saying so.

The one fact still inferred from a phase — `if (phase === 'Development')
card.started = started` — is **kept**, with its argument tested rather than
assumed wrong. The gate and `started_raw.length > 0` agree on every plan today
and diverge only for a plan bumped out of Development that still carries
`Started:` records; there the phase gate correctly withholds the Ready/In-progress
badge, a Development affordance that must not ride into Testing. The phase is the
right gate; the record is not.

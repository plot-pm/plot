---
"plot": minor
---

The board shows the four workflow phases instead of the four plan states.

Columns are now **Discovery · Design · Development · Endgame · Released**, which asks *who leads* rather than *what has happened*: three phases are human-led and exactly one — Development — is agent-led.

**`Approved` spans a phase boundary**, and that is the substantive change. A plan with no `Started:` record sits at the end of Design, waiting for a person to begin; one with a record is in Development, where an agent is working. The board already carried that data as a Ready/In-progress badge and simply did not read it as a phase change. The badge stays only for the waiting half, since a card in Development is started by definition.

**Development ends at the merge.** A column is a partition, so Delivered belongs to Endgame alone: the code landed, the agents are done, and what remains — verification and signoff — is human-led.

Endgame cards carry the release checklist count (`22/27`), parsed from the newest `docs/releases/*-checklist.md`. "Delivered" does not answer what the column asks. A missing or unparseable file yields no badge rather than a guessed number, and the parser is pinned by tests over nested, malformed and prose-mentioning-brackets cases.

Leadership is carried by a **symbol and a word**, with colour only repeating it — roughly one man in twelve distinguishes red from green poorly, and boards turn up in greyscale screenshots.

`BOARD_PHASES` changes shape, which is a breaking change for `/api/board` consumers. All four inside this repo move with it: the client, both test suites, and the dev-server middleware.

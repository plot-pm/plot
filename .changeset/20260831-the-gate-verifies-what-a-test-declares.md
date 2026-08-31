---
'@plot-pm/board': patch
---

A browser test that starts a real board must say why, and the gate checks the
claim against the file's structure rather than taking the comment for it.

`// @needs-real-board: <reason>` declares; two structural arms entitle. A marker
alone would reintroduce the failure the gate's docblock already rejects a list
for — it fails open, one line at a time, and a test would join the exceptions by
asserting that it belongs there. The marker supplies the reason, which no
predicate can infer; the structure supplies the entitlement, which no comment
should be trusted for. A declaration nothing supports is an offence, reported
like any other.

**Two arms, not the three the plan named.** A write route entitles only when it
is UN-intercepted: six files touch a write endpoint, five `page.route` every one
they touch, and `approve.browser.test.ts` is the only one where a POST reaches
the configured `Approve command`. And `dead-fetch.browser.test.ts` asserts
neither a write nor a process — it needs a transport it can abandon, which is
structural, so it is an arm rather than an exception. *Asserts on process
behaviour* is absent because it has no population here: `lifetime.test.mjs` is a
node:test file the gate never reads, and inside the browser suite `pid` is fleet
payload data in all 11 files that carry it while `.kill('SIGTERM')` is teardown
every board-starting file performs.

**The count is now keyed on what a file does, not where it sits** — the files
under `test/` that drive a page, so a slice moving a test to `test/unit/` no
longer reads as a deletion. 48/479 → 44/454 with nothing deleted: the three
`tiny-garden.{data,plan,story}` server-route tests and the gate file itself leave
a scope they were never about. A test moves a real file between directories and
counts again to prove it.

The predicate is a module, because both failure directions need a test and one of
them cannot be proved from the live suite without checking in a broken file. It
takes source text and nothing else, so the unit tests hand it invented sources
while the gate applies it to real ones.

Two defects surfaced, both of the shape that passes rather than fails: an
entitlement judged on raw source read a file as reaching a script on the strength
of one docblock line, and the population predicate counted the test that tests
it, whose fixtures contain the imports under test.

No `bumps:` block: this slice changes the board's test suite and no skill prose,
and CI validates that every skill a block names is a real directory rather than
that a block exists.

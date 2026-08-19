// Contract test for the `changelog` field of skills/plot/scripts/plot-plan-meta.sh.
//
// A SEPARATE FILE from parser.test.mjs, deliberately. That file pins the fields
// the parser already reported, and the whole claim of this change is that the
// new field is ADDITIVE: if the contract test had to be edited to accommodate
// it, the claim would be false. Keeping the new assertions here means
// parser.test.mjs stays byte-identical and keeps passing as the untouched proof.
//
// `changelog` is the one field that says WHAT A PLAN CHANGES. Title says what a
// plan is called and story says what it belongs to; neither says what it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const parser = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-plan-meta.sh');
const repoRoot = path.join(here, '..', '..');

const parseFile = (...files) =>
  execFileSync('bash', [parser, ...files], { encoding: 'utf8' })
    .trim().split('\n').map((l) => JSON.parse(l));

function withPlan(body, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-changelog-'));
  try {
    const f = path.join(dir, '2026-01-01-plan.md');
    writeFileSync(f, body);
    fn(f, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('changelog: a plan with a changelog reports its entries, in document order', () => {
  // Document order, never sorted: a changelog is a narrative and its first
  // entry is the headline. A consumer ranking plans against a goal reads the
  // sequence as written.
  withPlan(`# A plan that changes things

## Status

- **Phase:** Approved
- **Type:** feature

## Changelog

- Zebra arrives first because the file says so.
- Aardvark arrives second for the same reason.

## Motivation

Prose here is not a changelog entry.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, [
      'Zebra arrives first because the file says so.',
      'Aardvark arrives second for the same reason.',
    ]);
  });
});

test('changelog: a plan without one reports an empty value rather than failing', () => {
  // Most plans have a changelog; some do not. A parser that failed on an absent
  // optional section would take down every consumer of this script for a
  // section nobody promised.
  withPlan(`# A plan with no changelog

## Status

- **Phase:** Draft
- **Type:** bug
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, [], 'absent is [], not an error');
    assert.equal(meta.phase, 'draft', 'and the rest of the plan still parses');
    assert.equal(meta.type, 'bug');
  });
});

test('changelog: backticks, a markdown link and a double quote survive the round trip', () => {
  // THE ESCAPING TEST. Asserted by parsing the parser's output back into
  // JavaScript and comparing strings — never by eyeballing the JSON, which is
  // exactly how a hand-rolled escape passes review and then breaks a consumer.
  const entry =
    'The `--ignore-sprint` flag is the named escape, see [the manifesto](skills/plot/MANIFESTO.md), '
    + 'and a release cut past a Must Have is "a decision nobody made".';
  withPlan(`# A plan with hostile punctuation

## Status

- **Phase:** Approved
- **Type:** feature

## Changelog

- ${entry}
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, [entry]);
    // Spelled out, so a partial escape cannot pass by accident.
    assert.ok(meta.changelog[0].includes('`--ignore-sprint`'), 'backticks survive');
    assert.ok(meta.changelog[0].includes('[the manifesto](skills/plot/MANIFESTO.md)'), 'the link survives');
    assert.ok(meta.changelog[0].includes('"a decision nobody made"'), 'the double quotes survive');
  });
});

test('changelog: a backslash survives the round trip too', () => {
  // The other half of what jesc() escapes. A backslash mishandled produces
  // output that still LOOKS like JSON and no longer parses — so the assertion
  // that matters is that JSON.parse got this far at all.
  withPlan(`# A plan with a backslash

## Status

- **Phase:** Draft

## Changelog

- Matches \`C:\\path\\to\` and the regex \`\\d+\` without breaking the JSON.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, ['Matches `C:\\path\\to` and the regex `\\d+` without breaking the JSON.']);
  });
});

test('changelog: a wrapped entry is ONE entry, its continuation lines joined', () => {
  // Measured on 2026-08-19: 9 of the 34 changelogs in this repo wrap their
  // bullets across lines. Reporting a line per line would have shredded a
  // quarter of them into fragments, and a ranking consumer reading fragments
  // reads noise.
  withPlan(`# A plan with wrapped entries

## Status

- **Phase:** Approved

## Changelog

- The first entry runs long and wraps onto
  a second line, and then onto
  a third.
- The second entry stands alone.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, [
      'The first entry runs long and wraps onto a second line, and then onto a third.',
      'The second entry stands alone.',
    ]);
  });
});

test('changelog: an indented sub-bullet folds into the entry above it', () => {
  // No changelog in the repo nests today (measured 2026-08-19, zero hits). The
  // rule exists so that the day one does, the sub-point does not get promoted
  // to a headline entry beside its own parent.
  withPlan(`# A plan with a nested bullet

## Status

- **Phase:** Draft

## Changelog

- The board gains a column.
  - Which is narrower on mobile.
- An unrelated second entry.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, [
      'The board gains a column. Which is narrower on mobile.',
      'An unrelated second entry.',
    ]);
  });
});

test('changelog: flush-left prose in the section is not an entry', () => {
  // 8 plans close their changelog with a flush-left "Board impact:" paragraph.
  // That is a note to a reviewer, not a release note, and a consumer asking
  // "what does this plan change?" must not be handed it as an answer.
  withPlan(`# A plan with a board-impact note

## Status

- **Phase:** Approved

## Changelog

- The board gains a column.

Board impact: **yes, throughout.** This paragraph is a remark to a reviewer
and continues over several lines.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, ['The board gains a column.']);
  });
});

test('changelog: a comment-only line is not content, at any indentation', () => {
  // The flush-left case was already handled; the INDENTED single-liner was not,
  // and it was measured pasting its own `<!-- ... -->` markup into the entry
  // above it. Multi-line comments are swallowed upstream, which is why only the
  // one-line shape needed saying.
  withPlan(`# A plan with comments between entries

## Status

- **Phase:** Draft

## Changelog

<!-- a flush-left one-liner -->
- A real entry.
  <!-- an indented one-liner, sitting where a continuation would -->
- Another real entry.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, ['A real entry.', 'Another real entry.']);
  });
});

test('changelog: an unfilled template section reports nothing', () => {
  // The shipped template's `## Changelog` is a guidance comment plus a
  // `<!-- ... -->` placeholder bullet. A template-fresh plan changes nothing
  // yet, and must not claim a placeholder as a release note.
  withPlan(`# Template-fresh plan

## Status

- **Phase:** Draft

## Changelog

<!-- Release note entry. Written during planning, refined during implementation.
     Skills are changeset-driven: add a \`.changeset/*.md\` with a bumps block. -->

- <!-- user-facing change description -->

<!-- Board impact: does this touch the plan format? "none" is a valid answer. -->

## Motivation
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, [], 'a placeholder describes no change');
  });
});

test('changelog: front matter wins and contributes one entry', () => {
  // The rule every other field follows. A scalar is one entry; a placeholder
  // counts as absent.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-changelog-fm-'));
  try {
    const fm = path.join(dir, '2026-01-01-fm.md');
    writeFileSync(fm, `---
status: Approved
changelog: "The parser \`reports\` a changelog."
---
# Front matter plan

## Changelog

- This body entry loses to the front matter, as every other field does.
`);
    const [meta] = parseFile(fm);
    assert.deepEqual(meta.changelog, ['The parser `reports` a changelog.']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changelog: only the first ## Changelog heading contributes entries', () => {
  // Same rule as `## Branches`, and for the same reason: a plan about the plan
  // format quotes the section in prose, and the later heading is illustration
  // rather than contract.
  withPlan(`# A plan documenting the plan format

## Status

- **Phase:** Draft

## Changelog

- The real entry.

## Design

The format looks like this:

## Changelog

- An illustration, not a promise.
`, (f) => {
    const [meta] = parseFile(f);
    assert.deepEqual(meta.changelog, ['The real entry.']);
  });
});

test('changelog: state resets between files in multi-file mode', () => {
  // Regression shape the parser has already been bitten by once: the
  // "already saw the heading" flag is per-file, and without a reset the second
  // plan silently reports nothing.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-changelog-multi-'));
  try {
    const a = path.join(dir, '2026-01-01-a.md');
    const b = path.join(dir, '2026-01-02-b.md');
    writeFileSync(a, `# A\n\n## Status\n\n- **Phase:** Draft\n\n## Changelog\n\n- Entry from A.\n`);
    writeFileSync(b, `# B\n\n## Status\n\n- **Phase:** Draft\n\n## Changelog\n\n- Entry from B.\n`);
    const [first, second] = parseFile(a, b);
    assert.deepEqual(first.changelog, ['Entry from A.']);
    assert.deepEqual(second.changelog, ['Entry from B.'], 'B keeps its own entries');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changelog: a missing file reports [] like every other list field', () => {
  const [meta] = parseFile(path.join(repoRoot, 'docs', 'plans', 'does-not-exist.md'));
  assert.equal(meta.error, 'file not found');
  assert.deepEqual(meta.changelog, []);
});

// --- against the real estate ------------------------------------------------
//
// Asserted against REAL plans, for the reason parser.test.mjs learned the hard
// way with `rounds`: a hand-written fixture proves the parser reads the shape
// the test author imagined, not the shape the repo actually contains.

test('changelog: the largest real changelog in the repo reports all 10 entries', () => {
  // Measured 2026-08-19: this is the largest changelog in the estate, and its
  // section is followed by a multi-line "Board impact" HTML comment that must
  // contribute nothing.
  const plan = path.join(repoRoot, 'docs', 'plans', '2026-08-14-parallel-agent-fleet.md');
  const [meta] = parseFile(plan);
  assert.equal(meta.changelog.length, 10);
  assert.ok(meta.changelog[0].startsWith('New `/plot-fleet` command'),
    'entries keep their backticks and their order');
  assert.ok(meta.changelog.every((e) => !e.includes('Board impact')),
    'the trailing comment block contributes no entry');
  // The rest of the record is untouched by the new field.
  assert.notEqual(meta.phase, 'NONE');
  assert.ok(meta.branches.length > 0);
});

test('changelog: every plan in the repo still parses as one valid JSON object', () => {
  // The escaping claim, made against the whole estate rather than one fixture:
  // 34 real changelogs carry backticks, links, quotes, em dashes and asterisks,
  // and JSON.parse is the judge of whether they survived.
  const plans = execFileSync('bash', ['-c',
    `ls ${JSON.stringify(path.join(repoRoot, 'docs', 'plans'))}/*.md`],
  { encoding: 'utf8' }).trim().split('\n');
  const metas = parseFile(...plans);
  assert.equal(metas.length, plans.length, 'one JSON line per plan');
  for (const meta of metas) {
    assert.ok(Array.isArray(meta.changelog), `${meta.file} reports an array`);
    for (const entry of meta.changelog) {
      assert.equal(typeof entry, 'string');
      assert.ok(entry.length > 0, `${meta.file} reports no empty entry`);
    }
  }
  assert.ok(metas.some((m) => m.changelog.length > 0), 'and some of them have entries');
});

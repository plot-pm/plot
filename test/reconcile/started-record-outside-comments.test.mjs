// Contract test for WHERE a hand-over writes its `Started:` record.
//
// The shipped plan template (`skills/plot/templates/plan.md`) ends `## Status`
// with a commented-out block that shows the SHAPE of the transition records
// rather than any record:
//
//     <!-- Transition records — written by the workflow commands, not by hand:
//     - **Approved:** <date>, <who>, <channel>
//     - **Started:** <date>, <who>, <branch>   (one line per started branch)
//     -->
//
// Those lines are list items. `append_started_line` scanned `## Status` for the
// last list item and appended after it, so on any plan written from the shipped
// template the record landed INSIDE the comment.
//
// THIS WRITER PRODUCED EVERY MEASURED LOSS. Swept over `docs/plans/*.md` on
// 2026-09-25: 38 swallowed records across 10 plans, all of them `Started:`
// lines. An earlier draft of the plan swept `docs/plans/2026-09-2*.md` and
// concluded the defect had never fired here — the window was the error.
//
// AND THE LOSS COMPOUNDS, which the `Approved:` case does not. Dispatch's
// already-recorded test greps the file for the branch in backticks, so it sees
// its own commented-out record and books nothing on a re-run — but every
// consumer reads `plot-plan-meta.sh`, which answers `started: null`. The plan
// then reads as never dispatched while the branch is being worked.
//
// `plot-deliver.sh:330` has shipped the guard since #597 (2026-09-01) with
// `deliver-record-outside-comments.test.mjs`, which this file is modelled on.
// The assertion is the round trip, not the line number: hand over, then ask
// `plot-plan-meta.sh` what the plan says.
//
// `--offline --no-start`, for the reason `dispatch.test.mjs`'s booking tests
// give: the record is what is under test, so no worker is started and no host
// is asked. NOT `--dry-run`, which prints what it WOULD write and never calls
// `append_started_line` at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(here, '../../skills/plot/scripts');
const dispatch = path.join(SCRIPTS, 'plot-dispatch.sh');
const meta = path.join(SCRIPTS, 'plot-plan-meta.sh');
const TEMPLATE = path.resolve(here, '../../skills/plot/templates/plan.md');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * Hand one branch over for real and read back what landed on the default
 * branch — the only copy any consumer reads.
 */
const handOverAndRead = (statusBlock) => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-started-comment-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  try {
    git(t, 'init', '--bare', '-q', '-b', 'main', o);
    git(t, 'clone', '-q', o, r);
    git(r, 'config', 'user.email', 'test@example.invalid');
    git(r, 'config', 'user.name', 'Plot Test');
    git(r, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
    fs.writeFileSync(path.join(r, 'CLAUDE.md'),
      '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
    const rel = 'plans/2026-01-01-s.md';
    fs.writeFileSync(path.join(r, rel),
      `# S\n\n${statusBlock}\n## Branches\n\n- \`feature/s\` — one\n`);
    fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
    // A brief, so the BOOKING is what this measures rather than the brief gate
    // refusing ahead of it.
    fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(r, '.plot', 'briefs', 's.md'), 'spec\n');
    git(r, 'add', '-A');
    git(r, 'commit', '-qm', 'plan');
    git(r, 'push', '-q', 'origin', 'main');

    // PLOT_REPO_ROOT IS SCRUBBED, and the sandbox is the point. Since
    // `config-takes-the-callers-root`, `plot-config.sh` prefers an exported
    // `PLOT_REPO_ROOT` over `git rev-parse`, so a run inheriting one from a
    // dispatched worker reads the HOST repo's `## Plot Config` and looks for
    // this plan under the host's `Plan directory`. Measured 2026-09-25 inside a
    // worker: `no plan for 's' on origin/main — looked in docs/plans/`, against
    // a sandbox that declares `plans/`. The env must not decide the answer.
    const env = { ...process.env };
    delete env.PLOT_REPO_ROOT;
    execFileSync('bash', [dispatch, '--offline', '--no-start', 's'],
      { encoding: 'utf8', cwd: r, timeout: 60_000, env });

    git(r, 'fetch', '-q', 'origin', 'main');
    const text = git(r, 'show', `origin/main:${rel}`);
    const readBack = path.join(t, 'read-back.md');
    fs.writeFileSync(readBack, text);
    const parsed = JSON.parse(execFileSync('bash', [meta, readBack], { encoding: 'utf8' }));
    return { parsed, text };
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(r), 'plot-wt-feature-s'), { recursive: true, force: true });
  }
};

/**
 * The `## Status` section of the SHIPPED template, read from disk and made
 * dispatchable. The comment block is the template's own text — a copy here
 * would keep passing after the template changed shape, which is the one way
 * this test could go quiet while the defect came back.
 */
const shippedStatus = () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const status = template.split(/^## /m).find((s) => s.startsWith('Status'));
  assert.ok(status, 'the shipped template has no ## Status section');
  assert.match(status, /<!-- Transition records/,
    'the shipped template no longer carries the comment block this test is about — '
    + 'if the placeholders moved out of the comment, re-read the plan before deleting this');
  return `## ${status}`
    .replace(/^- \*\*State:\*\* Draft$/m, '- **Phase:** Approved')
    .replace(/^- \*\*Impl:\*\* <!--.*-->$/m, '- **Impl:** own branches')
    .replace(/^- \*\*Rounds:\*\* <!--.*-->$/m, '- **Approved:** 2026-01-01, alice, in-session');
};

test('the Started record lands where the parser reads it, not in the template comment', () => {
  const { parsed } = handOverAndRead(shippedStatus());
  assert.ok(Array.isArray(parsed.started_raw), 'started_raw should be a list');
  assert.notEqual(parsed.started_raw.length, 0,
    'the plan reports no Started record — it was written into the template comment, '
    + 'where plot-plan-meta.sh cannot see it, so the plan reads as never dispatched '
    + 'while the branch is being worked');
  assert.ok(parsed.started_raw.some((s) => s.includes('`feature/s`')),
    `the handed-over branch is not on the record: ${JSON.stringify(parsed.started_raw)}`);
});

test('the record sits before the template comment, so a reader finds it with the others', () => {
  const { text } = handOverAndRead(shippedStatus());
  const record = text.indexOf('- **Started:** 2026');
  const comment = text.indexOf('<!-- Transition records');
  assert.ok(record > 0, 'no Started line was written at all');
  assert.ok(comment > 0, 'the template comment vanished — this test is asserting nothing');
  assert.ok(record < comment,
    'the Started line sits after the comment opens, so it is inside it');
});

test('a plan with no comment block is unchanged', () => {
  const { parsed, text } = handOverAndRead(
    '## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '- **Approved:** 2026-01-01, alice, in-session\n');
  assert.notEqual(parsed.started_raw.length, 0, 'no record was written at all');
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^\s*[-*]\s*\*\*Started:\*\*/.test(l));
  assert.equal(lines[at - 1], '- **Approved:** 2026-01-01, alice, in-session',
    'the record should still append after the last list item in `## Status`');
});

test('an empty placeholder outside a comment is FILLED, not duplicated', () => {
  const { parsed, text } = handOverAndRead(
    '## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '- **Approved:** 2026-01-01, alice, in-session\n- **Started:**\n');
  assert.notEqual(parsed.started_raw.length, 0, 'the placeholder was not filled');
  const lines = text.split('\n').filter((l) => /^\s*[-*]\s*\*\*Started:\*\*/.test(l));
  assert.equal(lines.length, 1, 'the placeholder was appended to rather than filled');
});

test('a comment block AFTER the live list items still gets the record in the right place', () => {
  // `break` rather than depth-tracking, which is what plot-deliver.sh:330 does.
  // Depth-tracking would resume past `-->` and place the record below the
  // comment; `break` stops at it and keeps the record above, with the other
  // live fields where a reader looks.
  const { parsed, text } = handOverAndRead(
    '## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n'
    + '- **Approved:** 2026-01-01, alice, in-session\n'
    + '<!-- Transition records — written by the workflow commands, not by hand:\n'
    + '- **Started:** <date>, <who>, <branch>   (one line per started branch)\n-->\n');
  assert.notEqual(parsed.started_raw.length, 0, 'the record is invisible to the parser');
  const record = text.indexOf('- **Started:** 2026');
  const comment = text.indexOf('<!-- Transition records');
  assert.ok(record < comment, 'the record landed inside or below the comment');
});
